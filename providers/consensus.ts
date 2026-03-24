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
import { extractJson } from "./auditors/parse.js";

type Verdict = "approved" | "changes_requested" | "infra_failure";

function normalizeVerdict(v: unknown): Verdict {
  return v === "approved" ? "approved" : v === "infra_failure" ? "infra_failure" : "changes_requested";
}

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
  verdict: "approved" | "changes_requested" | "infra_failure";
  reasoning: string;
  codes: string[];
  confidence: number;
}

export interface ConsensusVerdict {
  mode: "simple" | "deliberative" | "diverge-converge";
  finalVerdict: "approved" | "changes_requested" | "infra_failure";
  opinions: RoleOpinion[];
  judgeSummary: string;
  duration: number;
  /** Parliament session registers (diverge-converge only). */
  registers?: ConvergenceRegisters;
  /** 5-classification results (diverge-converge only). */
  classifications?: ClassificationResult[];
}

export interface ConvergenceRegisters {
  statusChanges: string[];
  decisions: string[];
  requirementChanges: string[];
  risks: string[];
}

export type Classification = "gap" | "strength" | "out" | "buy" | "build";

export interface ClassificationResult {
  item: string;
  classification: Classification;
  action: string;
}

export interface DivergeConvergeOptions {
  /** Implementer testimony — context only, no vote. */
  implementerTestimony?: string;
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
  "verdict": "approved" | "changes_requested" | "infra_failure",
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
  "verdict": "approved" | "changes_requested" | "infra_failure",
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
  "verdict": "approved" | "changes_requested" | "infra_failure",
  "summary": "your final reasoning",
  "codes": ["final-rejection-codes-if-any"]
}`,
  };
}

// ── Diverge-Converge prompts ─────────────────

function buildDivergePrompt(request: AuditRequest, role: "advocate" | "devil", testimony?: string): AuditRequest {
  const testimonySection = testimony
    ? `\n### Implementer Testimony\n${testimony}\n`
    : "";

  return {
    ...request,
    prompt: `${request.prompt}
${testimonySection}
## Your Role: ${role.toUpperCase()} (Diverge Phase — Free Speech)

Speak freely. You are NOT limited to your role's traditional focus.
- If you see risks, say so — even as the advocate.
- If you see strengths, acknowledge them — even as the devil's advocate.
- Comment on anything: design, naming, architecture, missing tests, security, performance.

The goal is COMPLETE information, not role-adherence.

Respond with JSON:
{
  "verdict": "approved" | "changes_requested" | "infra_failure",
  "reasoning": "your full analysis — strengths AND weaknesses",
  "codes": ["any-issue-codes"],
  "confidence": 0.0-1.0,
  "items": [
    { "description": "specific observation", "type": "strength" | "risk" | "gap" | "suggestion" }
  ]
}`,
  };
}

function buildConvergeJudgePrompt(
  request: AuditRequest,
  advocateOpinion: RoleOpinion,
  devilOpinion: RoleOpinion,
  advocateItems: DivergenceItem[],
  devilItems: DivergenceItem[],
): AuditRequest {
  const allItems = [...advocateItems.map(i => `[Advocate] ${i.type}: ${i.description}`),
                    ...devilItems.map(i => `[Devil] ${i.type}: ${i.description}`)].join("\n");
  return {
    ...request,
    prompt: `${request.prompt}

## Your Role: JUDGE (Converge Phase)

Two reviewers have completed their free-form analysis. Your job:

### Confidence Weighting
When reviewers disagree, weight their opinions by confidence score.
A reviewer with 0.9 confidence outweighs one with 0.3 confidence.
If both have similar confidence, evaluate the reasoning quality instead.

### Phase B: Converge into 4 Registers
Classify all observations into:
1. **Status Changes**: What changed since last review?
2. **Decisions**: What technical decisions were made or need to be made?
3. **Requirement Changes**: Any scope/requirement additions or removals?
4. **Risks**: What risks or blockers were identified?

### Phase C: 5-Classification Analysis
For each substantive observation, classify as:
- **gap**: Something missing that needs to be built
- **strength**: Something done well, keep as pattern
- **out**: Not needed, remove from scope
- **buy**: Use external solution, don't build
- **build**: Must be implemented directly

### Reviewer Opinions

**Advocate** (confidence: ${advocateOpinion.confidence}):
Verdict: ${advocateOpinion.verdict}
${advocateOpinion.reasoning}

**Devil's Advocate** (confidence: ${devilOpinion.confidence}):
Verdict: ${devilOpinion.verdict}
${devilOpinion.reasoning}

### All Observations
${allItems}

### Respond with JSON:
{
  "verdict": "approved" | "changes_requested" | "infra_failure",
  "summary": "your synthesis",
  "codes": ["final-codes"],
  "registers": {
    "statusChanges": ["..."],
    "decisions": ["..."],
    "requirementChanges": ["..."],
    "risks": ["..."]
  },
  "classifications": [
    { "item": "description", "classification": "gap|strength|out|buy|build", "action": "what to do" }
  ]
}`,
  };
}

interface DivergenceItem {
  description: string;
  type: "strength" | "risk" | "gap" | "suggestion";
}

function parseDivergeOpinion(raw: string, role: "advocate" | "devil"): { opinion: RoleOpinion; items: DivergenceItem[] } {
  try {
    const json = extractJson(raw);
    if (!json) throw new Error("No JSON found");
    const parsed = JSON.parse(json);
    return {
      opinion: {
        role,
        verdict: normalizeVerdict(parsed.verdict),
        reasoning: parsed.reasoning ?? "",
        codes: Array.isArray(parsed.codes) ? parsed.codes : [],
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      },
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return {
      opinion: { role, verdict: "changes_requested", reasoning: `Failed to parse ${role} diverge response`, codes: ["parse-error"], confidence: 0 },
      items: [],
    };
  }
}

function parseConvergeVerdict(raw: string): {
  verdict: "approved" | "changes_requested" | "infra_failure";
  summary: string;
  codes: string[];
  registers: ConvergenceRegisters;
  classifications: ClassificationResult[];
} {
  try {
    const json = extractJson(raw);
    if (!json) throw new Error("No JSON found");
    const parsed = JSON.parse(json);
    return {
      verdict: normalizeVerdict(parsed.verdict),
      summary: parsed.summary ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      registers: {
        statusChanges: Array.isArray(parsed.registers?.statusChanges) ? parsed.registers.statusChanges : [],
        decisions: Array.isArray(parsed.registers?.decisions) ? parsed.registers.decisions : [],
        requirementChanges: Array.isArray(parsed.registers?.requirementChanges) ? parsed.registers.requirementChanges : [],
        risks: Array.isArray(parsed.registers?.risks) ? parsed.registers.risks : [],
      },
      classifications: Array.isArray(parsed.classifications) ? parsed.classifications : [],
    };
  } catch (err) {
    const hint = raw.length > 200 ? raw.slice(0, 200) + "..." : raw;
    return {
      verdict: "changes_requested",
      summary: `Failed to parse converge verdict: ${err instanceof Error ? err.message : "unknown"}. Raw: ${hint}`,
      codes: ["parse-error", "converge-verdict-malformed"],
      registers: { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      classifications: [],
    };
  }
}

// ── JSON extraction ──────────────────────────

// ── Parsers ───────────────────────────────────

function parseOpinion(raw: string, role: "advocate" | "devil"): RoleOpinion {
  try {
    const json = extractJson(raw);
    if (!json) throw new Error("No JSON found");
    const parsed = JSON.parse(json);
    return {
      role,
      verdict: normalizeVerdict(parsed.verdict),
      reasoning: parsed.reasoning ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch (err) {
    if (process.env.QUORUM_DEBUG) {
      console.error(`[consensus] Failed to parse ${role} opinion: ${(err as Error).message}`);
    }
    return {
      role,
      verdict: "changes_requested",
      reasoning: `Failed to parse ${role} response`,
      codes: ["parse-error"],
      confidence: 0,
    };
  }
}

function parseJudgeVerdict(raw: string): { verdict: "approved" | "changes_requested" | "infra_failure"; summary: string; codes: string[] } {
  try {
    const json = extractJson(raw);
    if (!json) throw new Error("No JSON found");
    const parsed = JSON.parse(json);
    return {
      verdict: normalizeVerdict(parsed.verdict),
      summary: parsed.summary ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
    };
  } catch (err) {
    if (process.env.QUORUM_DEBUG) {
      console.error(`[consensus] Failed to parse judge verdict: ${(err as Error).message}`);
    }
    return { verdict: "changes_requested", summary: "Failed to parse judge response", codes: ["parse-error"] };
  }
}

/** Build a fallback opinion when an auditor fails (infra_failure). */
function infraFailureOpinion(role: "advocate" | "devil", error: unknown): RoleOpinion {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    role,
    verdict: "infra_failure",
    reasoning: `${role} auditor failed: ${msg}`,
    codes: ["infra-failure"],
    confidence: 0,
  };
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

    // Round 1: parallel — one side failing doesn't block the other
    const [advocateSettled, devilSettled] = await Promise.allSettled([
      this.config.advocate.audit(buildAdvocatePrompt(request)),
      this.config.devil.audit(buildDevilPrompt(request)),
    ]);

    const advocateOpinion = advocateSettled.status === "fulfilled"
      ? parseOpinion(advocateSettled.value.raw, "advocate")
      : infraFailureOpinion("advocate", advocateSettled.reason);
    const devilOpinion = devilSettled.status === "fulfilled"
      ? parseOpinion(devilSettled.value.raw, "devil")
      : infraFailureOpinion("devil", devilSettled.reason);
    const opinions = [advocateOpinion, devilOpinion];

    // Round 2: judge — wrapped in try/catch so a judge failure doesn't crash the entire consensus
    const judgeRequest = buildJudgePrompt(request, advocateOpinion, devilOpinion);
    let judgeVerdict: { verdict: "approved" | "changes_requested" | "infra_failure"; summary: string; codes: string[] };
    try {
      const judgeResult = await this.config.judge.audit(judgeRequest);
      judgeVerdict = parseJudgeVerdict(judgeResult.raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (process.env.QUORUM_DEBUG) {
        console.error(`[consensus] Judge failed: ${msg}`);
      }
      // Fallback: majority vote from advocate + devil
      const advocateApproved = advocateOpinion.verdict === "approved";
      const devilApproved = devilOpinion.verdict === "approved";
      const bothInfra = advocateOpinion.verdict === "infra_failure" && devilOpinion.verdict === "infra_failure";
      judgeVerdict = {
        verdict: bothInfra ? "infra_failure"
          : (advocateApproved && devilApproved) ? "approved"
          : "changes_requested",
        summary: `Judge unavailable (${msg}). Verdict derived from advocate + devil majority.`,
        codes: [...new Set([...advocateOpinion.codes, ...devilOpinion.codes])],
      };
    }

    return {
      mode: "deliberative",
      finalVerdict: judgeVerdict.verdict,
      opinions,
      judgeSummary: judgeVerdict.summary,
      duration: Date.now() - start,
    };
  }

  /**
   * Run the diverge-converge consensus protocol (Parliament model).
   *
   * Phase A: Free divergence — all roles speak without role constraints (parallel)
   * Phase B: Judge converges into 4 MECE registers
   * Phase C: Judge classifies items into 5 categories (gap/strength/out/buy/build)
   */
  async runDivergeConverge(request: AuditRequest, options?: DivergeConvergeOptions): Promise<ConsensusVerdict> {
    const start = Date.now();

    // Phase A: Diverge — parallel, free speech
    const [advocateSettled, devilSettled] = await Promise.allSettled([
      this.config.advocate.audit(buildDivergePrompt(request, "advocate", options?.implementerTestimony)),
      this.config.devil.audit(buildDivergePrompt(request, "devil", options?.implementerTestimony)),
    ]);

    const advocateResult = advocateSettled.status === "fulfilled"
      ? parseDivergeOpinion(advocateSettled.value.raw, "advocate")
      : { opinion: infraFailureOpinion("advocate", advocateSettled.reason), items: [] as DivergenceItem[] };
    const devilResult = devilSettled.status === "fulfilled"
      ? parseDivergeOpinion(devilSettled.value.raw, "devil")
      : { opinion: infraFailureOpinion("devil", devilSettled.reason), items: [] as DivergenceItem[] };

    const opinions = [advocateResult.opinion, devilResult.opinion];

    // Phase B+C: Converge — Judge synthesizes into registers + classifications
    const convergeRequest = buildConvergeJudgePrompt(
      request, advocateResult.opinion, devilResult.opinion,
      advocateResult.items, devilResult.items,
    );

    let convergeVerdict: ReturnType<typeof parseConvergeVerdict>;
    try {
      const judgeResult = await this.config.judge.audit(convergeRequest);
      convergeVerdict = parseConvergeVerdict(judgeResult.raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fallback: majority vote
      const bothApproved = advocateResult.opinion.verdict === "approved" && devilResult.opinion.verdict === "approved";
      convergeVerdict = {
        verdict: bothApproved ? "approved" : "changes_requested",
        summary: `Judge unavailable (${msg}). Verdict from majority vote.`,
        codes: [...new Set([...advocateResult.opinion.codes, ...devilResult.opinion.codes])],
        registers: { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
        classifications: [],
      };
    }

    return {
      mode: "diverge-converge",
      finalVerdict: convergeVerdict.verdict,
      opinions,
      judgeSummary: convergeVerdict.summary,
      duration: Date.now() - start,
      registers: convergeVerdict.registers,
      classifications: convergeVerdict.classifications,
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
