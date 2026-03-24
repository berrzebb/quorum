/**
 * quorum parliament "<topic>" — run parliamentary deliberation on a topic.
 *
 * Assembles 3 parliament members (advocate/devil/judge) and runs
 * the diverge-converge protocol. Accumulates meeting logs, detects
 * convergence, generates CPS, and resolves amendments.
 *
 * Usage:
 *   quorum parliament "주문 앱에 결제 기능 추가"
 *   quorum parliament --rounds 3 "마이크로서비스 전환 전략"
 *   quorum parliament --committee architecture "시스템 설계 논의"
 *   quorum parliament --advocate claude --devil openai --judge codex "인증 재설계"
 *   quorum parliament --testimony "기존 DB 제약 있음" "주문 테이블 리팩토링"
 */

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { EventStore } from "../../bus/store.js";
import { createConsensusAuditors, checkAvailability } from "../../providers/auditors/factory.js";
import { routeToCommittee, type StandingCommittee, STANDING_COMMITTEES } from "../../bus/meeting-log.js";
import { runParliamentSession, type SessionResult, type SessionConfig } from "../../bus/parliament-session.js";
import type { AuditRequest } from "../../providers/provider.js";

// ── Arg parsing ─────────────────────────────

interface ParliamentArgs {
  topic: string;
  committee?: StandingCommittee;
  rounds: number;
  advocate?: string;
  devil?: string;
  judge?: string;
  testimony?: string;
  force?: boolean;
  resume?: string;
  history?: boolean;
  detail?: string;
}

export function parseArgs(args: string[]): ParliamentArgs {
  const result: ParliamentArgs = { topic: "", rounds: 1 };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--committee":
      case "-c":
        result.committee = args[++i] as StandingCommittee;
        break;
      case "--rounds":
      case "-r":
        result.rounds = Math.max(1, Math.min(10, parseInt(args[++i] ?? "1", 10) || 1));
        break;
      case "--advocate":
        result.advocate = args[++i];
        break;
      case "--devil":
        result.devil = args[++i];
        break;
      case "--judge":
        result.judge = args[++i];
        break;
      case "--testimony":
      case "-t":
        result.testimony = args[++i];
        break;
      case "--force":
      case "-f":
        result.force = true;
        break;
      case "--resume":
        result.resume = args[++i];
        break;
      case "--history":
        result.history = true;
        break;
      case "--detail":
        result.detail = args[++i];
        break;
      default:
        if (!arg.startsWith("-")) positional.push(arg);
    }
  }

  result.topic = positional.join(" ").trim();
  return result;
}

// ── Config loading ──────────────────────────

function loadConfig(): Record<string, unknown> {
  const candidates = [
    resolve(process.cwd(), ".claude", "quorum", "config.json"),
  ];
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
  }
  return {};
}

function resolveRoles(
  parsed: ParliamentArgs,
  cfg: Record<string, unknown>,
): Record<string, string> {
  // Priority: CLI flags > parliament.roles > consensus.roles > defaults
  const parliamentRoles = (cfg.parliament as Record<string, unknown>)?.roles as Record<string, string> | undefined;
  const consensusRoles = (cfg.consensus as Record<string, unknown>)?.roles as Record<string, string> | undefined;
  const defaults: Record<string, string> = { advocate: "claude", devil: "claude", judge: "claude" };
  return {
    advocate: parsed.advocate ?? parliamentRoles?.advocate ?? consensusRoles?.advocate ?? defaults.advocate,
    devil: parsed.devil ?? parliamentRoles?.devil ?? consensusRoles?.devil ?? defaults.devil,
    judge: parsed.judge ?? parliamentRoles?.judge ?? consensusRoles?.judge ?? defaults.judge,
  };
}

// ── Output formatting ───────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

function printHeader(topic: string, committee: string, roles: Record<string, string>, round: number, totalRounds: number): void {
  console.log(`
${C.cyan}${C.bold}═══ Parliament Session ═══${C.reset}
${C.bold}Topic:${C.reset}     ${topic}
${C.bold}Committee:${C.reset} ${committee}
${C.bold}Round:${C.reset}     ${round}/${totalRounds}
${C.bold}Members:${C.reset}   Advocate(${C.green}${roles.advocate}${C.reset}) Devil(${C.red}${roles.devil}${C.reset}) Judge(${C.blue}${roles.judge}${C.reset})
${C.dim}${"─".repeat(60)}${C.reset}
`);
}

function printPhaseResult(result: SessionResult, round: number): void {
  // Verdict
  if (result.verdict) {
    const v = result.verdict;
    const verdictColor = v.finalVerdict === "approved" ? C.green : v.finalVerdict === "changes_requested" ? C.yellow : C.red;
    console.log(`${C.bold}Verdict:${C.reset} ${verdictColor}${v.finalVerdict}${C.reset} (mode: ${v.mode})`);

    // Opinions
    if (v.opinions.length > 0) {
      console.log(`\n${C.dim}── Opinions ──${C.reset}`);
      for (const op of v.opinions) {
        const opColor = op.role === "advocate" ? C.green : C.red;
        console.log(`  ${opColor}${op.role}${C.reset}: ${op.verdict} (confidence: ${op.confidence.toFixed(2)})`);
        if (op.reasoning) {
          const short = op.reasoning.length > 200 ? op.reasoning.slice(0, 200) + "..." : op.reasoning;
          console.log(`    ${C.dim}${short}${C.reset}`);
        }
        if (op.codes.length > 0) {
          console.log(`    ${C.dim}codes: ${op.codes.join(", ")}${C.reset}`);
        }
      }
    }

    // Registers
    if (v.registers) {
      const r = v.registers;
      console.log(`\n${C.dim}── Registers (4 MECE) ──${C.reset}`);
      if (r.statusChanges.length > 0) console.log(`  ${C.cyan}Status Changes:${C.reset} ${r.statusChanges.join("; ")}`);
      if (r.decisions.length > 0) console.log(`  ${C.green}Decisions:${C.reset} ${r.decisions.join("; ")}`);
      if (r.requirementChanges.length > 0) console.log(`  ${C.yellow}Requirement Changes:${C.reset} ${r.requirementChanges.join("; ")}`);
      if (r.risks.length > 0) console.log(`  ${C.red}Risks:${C.reset} ${r.risks.join("; ")}`);
    }

    // Classifications
    if (v.classifications && v.classifications.length > 0) {
      console.log(`\n${C.dim}── Classifications (5-MECE) ──${C.reset}`);
      const byType: Record<string, string[]> = {};
      for (const c of v.classifications) {
        (byType[c.classification] ??= []).push(`${c.item} → ${c.action}`);
      }
      const colorMap: Record<string, string> = { gap: C.red, strength: C.green, out: C.dim, buy: C.blue, build: C.magenta };
      for (const [type, items] of Object.entries(byType)) {
        const color = colorMap[type] ?? C.reset;
        console.log(`  ${color}${type.toUpperCase()}${C.reset}:`);
        for (const item of items) console.log(`    • ${item}`);
      }
    }

    // Judge summary
    if (v.judgeSummary) {
      console.log(`\n${C.dim}── Judge Summary ──${C.reset}`);
      console.log(`  ${v.judgeSummary}`);
    }
  }

  // Convergence
  if (result.convergence) {
    const conv = result.convergence;
    const convIcon = conv.converged ? `${C.green}✓ CONVERGED${C.reset}` : `${C.yellow}○ pending${C.reset}`;
    console.log(`\n${C.bold}Convergence:${C.reset} ${convIcon} (stable: ${conv.stableRounds}/${conv.threshold}, delta: ${conv.lastDelta})`);
  }

  // CPS
  if (result.cps) {
    const cps = result.cps;
    console.log(`\n${C.cyan}${C.bold}═══ CPS Generated ═══${C.reset}`);
    console.log(`${C.bold}Context:${C.reset}  ${cps.context}`);
    console.log(`${C.bold}Problem:${C.reset}  ${cps.problem}`);
    console.log(`${C.bold}Solution:${C.reset} ${cps.solution}`);
    console.log(`${C.dim}Sources: ${cps.sourceLogIds.length} meeting logs, ${cps.gaps.length} gaps, ${cps.builds.length} builds${C.reset}`);
  }

  // Amendments
  if (result.amendments.length > 0) {
    console.log(`\n${C.dim}── Amendments ──${C.reset}`);
    for (const a of result.amendments) {
      const color = a.status === "approved" ? C.green : a.status === "rejected" ? C.red : C.yellow;
      console.log(`  ${color}${a.status}${C.reset}: ${a.votesFor} for / ${a.votesAgainst} against`);
    }
  }

  // Confluence
  if (result.confluence) {
    const cf = result.confluence;
    const cfIcon = cf.passed ? `${C.green}✓ PASSED${C.reset}` : `${C.red}✗ FAILED${C.reset}`;
    console.log(`\n${C.bold}Confluence:${C.reset} ${cfIcon}`);
    for (const check of cf.checks) {
      const icon = check.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
      console.log(`  ${icon} ${check.type}: ${check.detail ?? ""}`);
    }
  }

  // Errors
  if (result.errors.length > 0) {
    console.log(`\n${C.yellow}Errors (non-blocking):${C.reset}`);
    for (const e of result.errors) {
      console.log(`  ${C.dim}[${e.phase}]${C.reset} ${e.message}`);
    }
  }

  console.log(`\n${C.dim}Duration: ${result.duration}ms${C.reset}`);
}

// ── Main ─────────────────────────────────────

// ── Checkpoint types ─────────────────────────

interface SessionCheckpoint {
  sessionId: string;
  topic: string;
  committee: string;
  completedRounds: number;
  totalRounds: number;
  converged: boolean;
  timestamp: number;
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  // Handle --history (no topic required)
  if (parsed.history) {
    return showHistory(parsed.detail);
  }

  if (!parsed.topic && !parsed.resume) {
    showHelp();
    return;
  }

  const cfg = loadConfig();
  const roles = resolveRoles(parsed, cfg);

  // Auto-route topic to committee (or use override)
  const committees = parsed.committee
    ? [parsed.committee]
    : routeToCommittee(parsed.topic);
  const committee = committees[0]!;

  // Initialize EventStore
  const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
  const store = new EventStore({ dbPath });

  // Create auditors
  const cwd = process.cwd();
  const auditors = createConsensusAuditors(roles, cwd);

  // Pre-flight: check auditor availability (skip with --force)
  if (!parsed.force) {
    const availability = await checkAvailability(auditors);
    if (!availability.allAvailable) {
      const missing = availability.unavailable.map(u => `${u.role} (${roles[u.role]})`).join(", ");
      console.error(`${C.red}Unavailable auditors: ${missing}${C.reset}`);
      console.error(`${C.dim}Use --force to skip this check${C.reset}`);
      store.close();
      process.exit(1);
    }
  }

  // Build session config
  const sessionType = new Date().getHours() < 12 ? "morning" as const : "afternoon" as const;
  const parliamentCfg = cfg.parliament as Record<string, unknown> | undefined;

  // Session ID for checkpoint (stable across rounds)
  const sessionId = parsed.resume ?? `parliament-${committee}-${Date.now()}`;
  let startRound = 1;

  // Resume: load checkpoint and skip completed rounds
  if (parsed.resume) {
    const checkpoint = store.getKV(`parliament.checkpoint.${parsed.resume}`) as SessionCheckpoint | null;
    if (checkpoint) {
      startRound = checkpoint.completedRounds + 1;
      console.log(`${C.cyan}Resuming session ${parsed.resume} from round ${startRound}${C.reset}`);
      if (checkpoint.converged) {
        console.log(`${C.green}Session already converged.${C.reset}`);
        store.close();
        return;
      }
      // Restore topic from checkpoint if not provided
      if (!parsed.topic) parsed.topic = checkpoint.topic;
    } else {
      console.error(`${C.red}No checkpoint found for session: ${parsed.resume}${C.reset}`);
      store.close();
      process.exit(1);
    }
  }

  // Print session ID on first run for future resume
  if (!parsed.resume) {
    console.log(`${C.dim}Session ID: ${sessionId} (use --resume to continue)${C.reset}\n`);
  }

  // Run N rounds
  for (let round = startRound; round <= parsed.rounds; round++) {
    printHeader(parsed.topic, committee, roles, round, parsed.rounds);

    const request: AuditRequest = {
      evidence: parsed.topic,
      prompt: buildDeliberationPrompt(parsed.topic, committee, round),
      files: [],
      sessionId,
    };

    const sessionConfig: SessionConfig = {
      agendaId: committee,
      sessionType,
      consensus: auditors,
      eligibleVoters: (parliamentCfg?.eligibleVoters as number) ?? 3,
      implementerTestimony: parsed.testimony,
      confluenceInput: {},
    };

    console.log(`${C.dim}Running deliberation...${C.reset}\n`);

    const result = await runParliamentSession(store, request, sessionConfig);
    printPhaseResult(result, round);

    // Checkpoint after each round
    const converged = result.convergence?.converged ?? false;
    store.setKV(`parliament.checkpoint.${sessionId}`, {
      sessionId,
      topic: parsed.topic,
      committee,
      completedRounds: round,
      totalRounds: parsed.rounds,
      converged,
      timestamp: Date.now(),
    } satisfies SessionCheckpoint);

    // If converged and CPS generated, persist to file + stop
    if (converged && result.cps) {
      writeCPSFile(result.cps, committee);
      if (round < parsed.rounds) {
        console.log(`\n${C.green}${C.bold}Converged at round ${round}/${parsed.rounds} — stopping early.${C.reset}`);
      }
      break;
    }

    if (round < parsed.rounds) {
      console.log(`\n${C.dim}${"═".repeat(60)}${C.reset}\n`);
    }
  }

  // Close store
  store.close();
}

// ── Prompt builder ──────────────────────────

function buildDeliberationPrompt(topic: string, committee: string, round: number): string {
  const committeeInfo = STANDING_COMMITTEES[committee as StandingCommittee];
  const items = committeeInfo ? committeeInfo.items.join(", ") : "general";

  return `# Parliamentary Deliberation

## Topic
${topic}

## Standing Committee
${committeeInfo?.name ?? committee} — covers: ${items}

## Round
${round}

## Instructions
Analyze the given topic from your perspective. This is a parliamentary deliberation — speak freely about all aspects.

Consider:
- Feasibility and technical merit
- Risks and potential issues
- Missing requirements or unstated assumptions
- Alternative approaches
- Impact on existing systems

Provide your honest assessment regardless of your assigned role.`;
}

// ── History ──────────────────────────────────

function showHistory(detailId?: string): void {
  const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
  if (!existsSync(dbPath)) {
    console.log(`${C.dim}No parliament sessions found.${C.reset}`);
    return;
  }

  const store = new EventStore({ dbPath });
  const events = store.query({ eventType: "parliament.session.digest" as import("../../bus/events.js").EventType });

  if (events.length === 0) {
    console.log(`${C.dim}No parliament sessions found.${C.reset}`);
    store.close();
    return;
  }

  if (detailId) {
    // Show detail for a specific session
    const match = events.find(e =>
      (e.payload.sessionId as string)?.includes(detailId) ||
      (e.payload.agendaId as string)?.includes(detailId),
    );
    if (!match) {
      console.log(`${C.red}Session not found: ${detailId}${C.reset}`);
    } else {
      const p = match.payload;
      console.log(`\n${C.cyan}${C.bold}Session Detail${C.reset}`);
      console.log(`  Date:        ${new Date(match.timestamp).toISOString().slice(0, 19)}`);
      console.log(`  Agenda:      ${p.agendaId ?? "—"}`);
      console.log(`  Type:        ${p.sessionType ?? "—"}`);
      console.log(`  Verdict:     ${p.verdictResult ?? "—"}`);
      console.log(`  Converged:   ${p.converged ?? false}`);
      console.log(`  Amendments:  ${p.amendmentsResolved ?? 0} resolved`);
      console.log(`  Duration:    ${p.duration ?? "—"}ms`);
      if (p.summary) console.log(`  Summary:     ${p.summary}`);
    }
    store.close();
    return;
  }

  // Table listing
  console.log(`\n${C.cyan}${C.bold}Parliament Session History${C.reset} (${events.length} sessions)\n`);
  console.log(`${"Date".padEnd(20)} ${"Committee".padEnd(20)} ${"Verdict".padEnd(18)} ${"Conv".padEnd(6)}`);
  console.log(`${C.dim}${"─".repeat(65)}${C.reset}`);

  for (const e of events.slice(-20).reverse()) {
    const date = new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ");
    const agenda = String(e.payload.agendaId ?? "—").padEnd(20);
    const verdict = String(e.payload.verdictResult ?? "—").padEnd(18);
    const conv = (e.payload.converged as boolean) ? `${C.green}✓${C.reset}` : `${C.dim}○${C.reset}`;
    console.log(`${date}   ${agenda} ${verdict} ${conv}`);
  }

  store.close();
}

// ── CPS file output ─────────────────────────

function writeCPSFile(cps: { context: string; problem: string; solution: string; gaps: Array<{ item: string }>; builds: Array<{ item: string; action: string }>; sourceLogIds: string[]; generatedAt: number }, committee: string): void {
  try {
    const dir = resolve(process.cwd(), ".claude", "parliament");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const date = new Date(cps.generatedAt).toISOString().slice(0, 10);
    const filePath = resolve(dir, `cps-${committee}-${date}.md`);

    const content = `# CPS: ${committee} (${date})

## Context
${cps.context}

## Problem
${cps.problem}

## Solution
${cps.solution}

## Gaps (${cps.gaps.length})
${cps.gaps.map(g => `- ${g.item}`).join("\n") || "None"}

## Build Items (${cps.builds.length})
${cps.builds.map(b => `- ${b.item}: ${b.action}`).join("\n") || "None"}

---
Sources: ${cps.sourceLogIds.length} meeting logs
Generated: ${new Date(cps.generatedAt).toISOString()}
`;

    writeFileSync(filePath, content, "utf8");
    console.log(`\n${C.green}CPS saved:${C.reset} ${filePath}`);
  } catch {
    // Fail-open: file output is non-critical
  }
}

// ── Help ─────────────────────────────────────

function showHelp(): void {
  console.log(`
${C.cyan}quorum parliament${C.reset} — run parliamentary deliberation on a topic

${C.bold}Usage:${C.reset}
  quorum parliament "<topic>"
  quorum parliament [options] "<topic>"

${C.bold}Options:${C.reset}
  --committee, -c <name>   Standing committee (auto-detected from topic)
                           Committees: ${Object.keys(STANDING_COMMITTEES).join(", ")}
  --rounds, -r <n>         Number of deliberation rounds (default: 1, max: 10)
  --advocate <spec>        Advocate provider (default: from config or claude)
  --devil <spec>           Devil's advocate provider (default: from config or claude)
  --judge <spec>           Judge provider (default: from config or claude)
  --testimony, -t <text>   Implementer testimony (context only, no vote)

${C.bold}Provider specs:${C.reset}
  codex, claude, openai, gemini
  claude:claude-opus-4-6, openai:gpt-4o   (with model override)

${C.bold}Examples:${C.reset}
  quorum parliament "주문 앱에 결제 기능 추가"
  quorum parliament --rounds 3 "마이크로서비스 전환 전략"
  quorum parliament -c architecture "시스템 설계 논의"
  quorum parliament --advocate claude --devil openai --judge codex "인증 재설계"
  quorum parliament -t "DB 스키마 제약 있음" "주문 테이블 리팩토링"

${C.bold}Flow:${C.reset}
  1. Topic auto-routed to standing committee (or --committee override)
  2. 3 members deliberate (diverge-converge protocol):
     Phase A: Free speech (advocate + devil speak freely)
     Phase B: Judge converges into 4 MECE registers
     Phase C: 5-classification analysis (gap/strength/out/buy/build)
  3. Meeting log recorded → convergence checked
  4. If converged: CPS (Context-Problem-Solution) generated
  5. Pending amendments resolved, confluence verified
`);
}
