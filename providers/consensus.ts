/**
 * Deliberative Consensus — 3-role audit protocol.
 *
 * Round 1 (parallel): Advocate + Devil's Advocate analyze evidence independently
 * Round 2: Judge reviews both opinions and delivers final verdict
 *
 * The Devil's Advocate specifically checks:
 * "Does this fix the root cause, or only treat symptoms?"
 *
 * Each role can use a different model via the Auditor interface.
 */

import type { Auditor, AuditRequest, AuditResult } from "./provider.js";

// ── Role definitions ──────────────────────────

export interface ConsensusRole {
  name: "advocate" | "devil" | "judge";
  auditor: Auditor;
}

export interface ConsensusConfig {
  advocate: Auditor;
  devil: Auditor;
  judge: Auditor;
}

export interface RoleOpinion {
  role: "advocate" | "devil";
  verdict: "approved" | "changes_requested";
  reasoning: string;
  codes: string[];
  confidence: number;
}

export interface ConsensusVerdict {
  mode: "simple" | "deliberative";
  finalVerdict: "approved" | "changes_requested";
  opinions: RoleOpinion[];
  judgeSummary: string;
  duration: number;
}

// ── Prompt builders ───────────────────────────

function buildAdvocatePrompt(request: AuditRequest): AuditRequest {
  return {
    ...request,
    prompt: `${request.prompt}

## Your Role: ADVOCATE

You are the advocate for this submission. Your job is to find merit in the work.

Focus on:
1. Does the evidence match the claim?
2. Are the tests adequate for the scope?
3. Is the implementation approach sound?

Be fair but look for reasons to APPROVE. If issues exist, assess whether they are blocking or acceptable.

Respond with JSON:
{
  "verdict": "approved" | "changes_requested",
  "reasoning": "your analysis",
  "codes": ["rejection-code-if-any"],
  "confidence": 0.0-1.0
}`,
  };
}

function buildDevilPrompt(request: AuditRequest): AuditRequest {
  return {
    ...request,
    prompt: `${request.prompt}

## Your Role: DEVIL'S ADVOCATE

You are the devil's advocate. Your job is to find weaknesses.

You MUST check:
1. **Root cause vs symptom**: Does this fix address the actual problem, or does it only treat a symptom?
2. **Scope creep**: Are there changes not mentioned in the evidence?
3. **Missing edge cases**: What failure modes are not tested?
4. **Security**: Any OWASP concerns introduced?

Be thorough. If the submission is genuinely solid, say so — but look hard.

Respond with JSON:
{
  "verdict": "approved" | "changes_requested",
  "reasoning": "your analysis",
  "codes": ["rejection-code-if-any"],
  "confidence": 0.0-1.0
}`,
  };
}

function buildJudgePrompt(
  request: AuditRequest,
  advocateOpinion: RoleOpinion,
  devilOpinion: RoleOpinion,
): AuditRequest {
  return {
    ...request,
    prompt: `${request.prompt}

## Your Role: JUDGE

Two reviewers have analyzed this submission. Deliver the final verdict.

### Advocate Opinion
Verdict: ${advocateOpinion.verdict}
Confidence: ${advocateOpinion.confidence}
Reasoning: ${advocateOpinion.reasoning}
${advocateOpinion.codes.length > 0 ? `Codes: ${advocateOpinion.codes.join(", ")}` : ""}

### Devil's Advocate Opinion
Verdict: ${devilOpinion.verdict}
Confidence: ${devilOpinion.confidence}
Reasoning: ${devilOpinion.reasoning}
${devilOpinion.codes.length > 0 ? `Codes: ${devilOpinion.codes.join(", ")}` : ""}

### Your Task
1. Weigh both opinions
2. If they agree, confirm with your own assessment
3. If they disagree, determine which argument is stronger
4. Pay special attention to the devil's advocate's root-cause analysis

Respond with JSON:
{
  "verdict": "approved" | "changes_requested",
  "summary": "your final reasoning",
  "codes": ["final-rejection-codes-if-any"]
}`,
  };
}

// ── Parsers ───────────────────────────────────

function parseOpinion(raw: string, role: "advocate" | "devil"): RoleOpinion {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      role,
      verdict: parsed.verdict === "approved" ? "approved" : "changes_requested",
      reasoning: parsed.reasoning ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return {
      role,
      verdict: "changes_requested",
      reasoning: `Failed to parse ${role} response`,
      codes: ["parse-error"],
      confidence: 0,
    };
  }
}

function parseJudgeVerdict(raw: string): { verdict: "approved" | "changes_requested"; summary: string; codes: string[] } {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      verdict: parsed.verdict === "approved" ? "approved" : "changes_requested",
      summary: parsed.summary ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
    };
  } catch {
    return { verdict: "changes_requested", summary: "Failed to parse judge response", codes: ["parse-error"] };
  }
}

// ── Consensus executor ────────────────────────

export class DeliberativeConsensus {
  private config: ConsensusConfig;

  constructor(config: ConsensusConfig) {
    this.config = config;
  }

  /**
   * Run the full deliberative consensus protocol.
   *
   * Round 1: Advocate + Devil's Advocate (parallel)
   * Round 2: Judge (sequential, sees both opinions)
   */
  async run(request: AuditRequest): Promise<ConsensusVerdict> {
    const start = Date.now();

    // Round 1: parallel
    const [advocateResult, devilResult] = await Promise.all([
      this.config.advocate.audit(buildAdvocatePrompt(request)),
      this.config.devil.audit(buildDevilPrompt(request)),
    ]);

    const advocateOpinion = parseOpinion(advocateResult.raw, "advocate");
    const devilOpinion = parseOpinion(devilResult.raw, "devil");
    const opinions = [advocateOpinion, devilOpinion];

    // Round 2: judge
    const judgeRequest = buildJudgePrompt(request, advocateOpinion, devilOpinion);
    const judgeResult = await this.config.judge.audit(judgeRequest);
    const judgeVerdict = parseJudgeVerdict(judgeResult.raw);

    return {
      mode: "deliberative",
      finalVerdict: judgeVerdict.verdict,
      opinions,
      judgeSummary: judgeVerdict.summary,
      duration: Date.now() - start,
    };
  }

  /**
   * Run simple consensus: single auditor, no deliberation.
   * Used for T1/T2 tasks that don't need full protocol.
   */
  async runSimple(request: AuditRequest): Promise<ConsensusVerdict> {
    const start = Date.now();
    const result = await this.config.advocate.audit(request);

    return {
      mode: "simple",
      finalVerdict: result.verdict,
      opinions: [{
        role: "advocate",
        verdict: result.verdict,
        reasoning: result.summary,
        codes: result.codes,
        confidence: 1.0,
      }],
      judgeSummary: result.summary,
      duration: Date.now() - start,
    };
  }
}
