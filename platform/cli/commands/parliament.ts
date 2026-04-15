/**
 * quorum parliament "<topic>" — run parliamentary deliberation on a topic.
 *
 * Assembles 3 parliament members (advocate/devil/judge) and runs
 * the diverge-converge protocol. Accumulates meeting logs, detects
 * convergence, generates CPS, and resolves amendments.
 *
 * Usage:
 *   quorum parliament "add payment feature to order app"
 *   quorum parliament --rounds 3 "microservice migration strategy"
 *   quorum parliament --committee architecture "system design discussion"
 *   quorum parliament --advocate claude --devil openai --judge codex "auth redesign"
 *   quorum parliament --testimony "DB schema constraints" "order table refactoring"
 */

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { EventStore } from "../../bus/store.js";
import { AUDIT_VERDICT, AMENDMENT_STATUS, createEvent } from "../../bus/events.js";
import { createConsensusAuditors, checkAvailability } from "../../providers/auditors/factory.js";
import { createMuxConsensusAuditors } from "../../providers/auditors/mux.js";
import { ProcessMux } from "../../bus/mux.js";
import { routeToCommittee, type StandingCommittee, STANDING_COMMITTEES, getMeetingLogs, generateCPS, type CPS } from "../../bus/meeting-log.js";
import { runParliamentSession, type SessionResult, type SessionConfig } from "../../bus/parliament-session.js";
import type { AuditRequest, Auditor } from "../../providers/provider.js";
import { interactivePlanner } from "./orchestrate/planner.js";

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
  mux?: boolean;
  noPlan?: boolean;
}

export function parseArgs(args: string[]): ParliamentArgs {
  const result: ParliamentArgs = { topic: "", rounds: 10 };
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
        result.rounds = Math.max(1, Math.min(10, parseInt(args[++i] ?? "10", 10) || 10));
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
      case "--mux":
        result.mux = true;
        break;
      case "--no-plan":
        result.noPlan = true;
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
    ...(process.env.QUORUM_ADAPTER_ROOT ? [resolve(process.env.QUORUM_ADAPTER_ROOT, "config.json")] : []),
    ...(process.env.CLAUDE_PLUGIN_ROOT ? [resolve(process.env.CLAUDE_PLUGIN_ROOT, "config.json")] : []),
    ...(process.env.GEMINI_EXTENSION_ROOT ? [resolve(process.env.GEMINI_EXTENSION_ROOT, "config.json")] : []),
  ];
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(p, "utf8")); } catch (err) { console.warn(`[parliament] config parse failed for ${p}: ${(err as Error).message}`); continue; }
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
    const verdictColor = v.finalVerdict === AUDIT_VERDICT.APPROVED ? C.green : v.finalVerdict === AUDIT_VERDICT.CHANGES_REQUESTED ? C.yellow : C.red;
    console.log(`${C.bold}Verdict:${C.reset} ${verdictColor}${v.finalVerdict}${C.reset} (mode: ${v.mode})`);

    // Opinions (full deliberation, not truncated)
    if (v.opinions.length > 0) {
      const labels = ["Reviewer A", "Reviewer B"];
      const colors = [C.cyan, C.magenta];

      for (let i = 0; i < v.opinions.length; i++) {
        const op = v.opinions[i]!;
        const label = labels[i] ?? op.role;
        const color = colors[i] ?? C.reset;

        console.log(`\n${color}${C.bold}── ${label} ──${C.reset}  ${op.verdict} (confidence: ${op.confidence.toFixed(2)})`);

        if (op.reasoning) {
          console.log(`${op.reasoning}`);
        }

        // Divergence items per reviewer
        const items = i === 0 ? v.divergenceItems?.reviewerA : v.divergenceItems?.reviewerB;
        if (items && items.length > 0) {
          const typeIcon: Record<string, string> = { strength: `${C.green}+`, risk: `${C.red}!`, gap: `${C.yellow}?`, suggestion: `${C.blue}>` };
          for (const item of items) {
            console.log(`  ${typeIcon[item.type] ?? " "}${C.reset} ${item.description}`);
          }
        }

        if (op.codes.length > 0) {
          console.log(`  ${C.dim}codes: ${op.codes.join(", ")}${C.reset}`);
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
    const pathInfo = conv.convergencePath ? ` [${conv.convergencePath}]` : "";
    console.log(`\n${C.bold}Convergence:${C.reset} ${convIcon} (exact: ${conv.stableRounds}, items: ${conv.noNewItemsRounds}, relaxed: ${conv.relaxedRounds} /${conv.threshold}, delta: ${conv.lastDelta})${pathInfo}`);
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
      const color = a.status === AMENDMENT_STATUS.APPROVED ? C.green : a.status === AMENDMENT_STATUS.REJECTED ? C.red : C.yellow;
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

  // Handle --history or --detail (no topic required)
  if (parsed.history || parsed.detail) {
    return showHistory(parsed.detail);
  }

  if (!parsed.topic && !parsed.resume) {
    showHelp();
    return;
  }

  const cfg = loadConfig();
  const roles = resolveRoles(parsed, cfg);

  // Auto-route topic to committee (or use override)
  // May be overridden by checkpoint below for --resume
  let committee = parsed.committee
    ? parsed.committee
    : routeToCommittee(parsed.topic)[0]!;

  // Initialize EventStore
  const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
  const store = new EventStore({ dbPath });

  let mux: ProcessMux | null = null;
  let interrupted = false;

  // Graceful Ctrl+C — clean up mux sessions + store
  const onInterrupt = () => {
    if (interrupted) process.exit(1);  // second Ctrl+C = force kill
    interrupted = true;
    console.log(`\n${C.yellow}Interrupted. Cleaning up...${C.reset}`);
    if (mux) { try { mux.cleanup(); } catch (err) { console.warn(`[parliament] mux cleanup on interrupt failed: ${(err as Error).message}`); } }
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);

  try {
    // Create auditors — MuxAuditor if --mux, standalone otherwise
    const cwd = process.cwd();
    let auditors: { advocate: Auditor; devil: Auditor; judge: Auditor };

    if (parsed.mux) {
      mux = new ProcessMux();
      const roleColors: Record<string, string> = { advocate: C.green, devil: C.red, judge: C.blue };
      auditors = createMuxConsensusAuditors(roles, cwd, mux, {
        onProgress: (role, chunk) => {
          const color = roleColors[role] ?? C.reset;
          // Stream each chunk with role label, no newline for inline flow
          process.stdout.write(`${color}[${role}]${C.reset} ${chunk}`);
        },
      });
      console.log(`${C.dim}Mux mode: ${mux.getBackend()} (sessions visible in daemon TUI)${C.reset}\n`);
    } else {
      auditors = createConsensusAuditors(roles, cwd);
    }

    // Pre-flight: check auditor availability (skip with --force)
    if (!parsed.force) {
      const availability = await checkAvailability(auditors, roles);
      if (!availability.allAvailable) {
        const missing = availability.unavailable.map(u => `${u.role} (${u.provider})`).join(", ");
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
          return;
        }
        // Restore topic + committee from checkpoint if not provided
        if (!parsed.topic) parsed.topic = checkpoint.topic;
        if (!parsed.committee && checkpoint.committee) committee = checkpoint.committee as StandingCommittee;
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

    // Run rounds until convergence or max reached
    let previousResult: SessionResult | null = null;

    for (let round = startRound; round <= parsed.rounds; round++) {
      printHeader(parsed.topic, committee, roles, round, parsed.rounds);

      const request: AuditRequest = {
        evidence: parsed.topic,
        prompt: buildDeliberationPrompt(parsed.topic, committee, round, previousResult),
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

      console.log(`${C.dim}Running deliberation (round ${round}/${parsed.rounds})...${C.reset}\n`);

      const result = await runParliamentSession(store, request, sessionConfig);
      printPhaseResult(result, round);
      previousResult = result;

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

      // If converged and CPS generated, persist to file + auto-plan
      if (converged && result.cps) {
        writeCPSFile(result.cps, committee);
        if (round < parsed.rounds) {
          console.log(`\n${C.green}${C.bold}Converged at round ${round}/${parsed.rounds} — stopping early.${C.reset}`);
        }

        // Auto-launch planner (parliament → CPS → plan is the natural flow)
        if (!parsed.noPlan) {
          // Release parliament mux sessions BEFORE planner creates its own
          if (mux) {
            try { await mux.cleanup(); } catch (err) { console.warn(`[parliament] mux cleanup before planner failed: ${(err as Error).message}`); }
            mux = null as unknown as typeof mux;
          }
          console.log(`\n${C.cyan}${C.bold}═══ Planning Phase ═══${C.reset}`);
          console.log(`${C.dim}CPS generated. Launching planner for "${parsed.topic}"...${C.reset}\n`);
          const planArgs = [parsed.topic, "--auto"];
          if (parsed.mux) planArgs.push("--mux");
          await interactivePlanner(cwd, planArgs);
        }
        break;
      }

      if (interrupted) break;

      if (round < parsed.rounds) {
        console.log(`\n${C.dim}${"═".repeat(60)}${C.reset}\n`);
      }
    }

    // Best-effort CPS: max rounds reached without convergence
    // Pipeline must not break — generate CPS from accumulated analysis
    const lastConverged = previousResult?.convergence?.converged ?? false;
    if (!interrupted && !lastConverged && previousResult) {
      console.log(`\n${C.yellow}${C.bold}Max rounds (${parsed.rounds}) reached without full convergence.${C.reset}`);
      console.log(`${C.dim}Generating best-effort CPS from accumulated analysis...${C.reset}\n`);

      try {
        const agendaLogs = getMeetingLogs(store, committee);
        if (agendaLogs.length > 0) {
          const bestEffortCps = generateCPS(agendaLogs);

          // Persist as event + KV (same path as converged CPS)
          store.append(createEvent("parliament.cps.generated", "generic", {
            context: bestEffortCps.context,
            problem: bestEffortCps.problem,
            solution: bestEffortCps.solution,
            sourceLogIds: bestEffortCps.sourceLogIds,
            gapCount: bestEffortCps.gaps.length,
            buildCount: bestEffortCps.builds.length,
            agendaId: committee,
            bestEffort: true,
          }));
          store.setKV("parliament.cps.latest", {
            ...bestEffortCps,
            agendaId: committee,
            bestEffort: true,
          });

          writeCPSFile(bestEffortCps, committee);

          // Do NOT auto-launch planner on best-effort CPS.
          // Unconverged requirements produce incomplete WBs — waste of time.
          console.log(`\n${C.yellow}Planner skipped — CPS did not converge.${C.reset}`);
          console.log(`${C.dim}Options: increase --rounds, narrow the topic, or run 'quorum orchestrate plan <track>' manually after review.${C.reset}\n`);
        } else {
          console.log(`${C.red}No meeting logs found — cannot generate CPS.${C.reset}`);
        }
      } catch (err) {
        console.error(`${C.red}Failed to generate best-effort CPS: ${(err as Error).message}${C.reset}`);
      }
    }
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
    if (mux) {
      try { await mux.cleanup(); } catch (err) { console.warn(`[parliament] mux cleanup in finally failed: ${(err as Error).message}`); }
    }
    store.close();
  }
}

// ── Prompt builder ──────────────────────────

function buildDeliberationPrompt(topic: string, committee: string, round: number, previousResult?: SessionResult | null): string {
  const committeeInfo = STANDING_COMMITTEES[committee as StandingCommittee];
  const items = committeeInfo ? committeeInfo.items.join(", ") : "general";

  // Chain previous round's output as context for this round
  let previousContext = "";
  if (previousResult?.verdict) {
    const v = previousResult.verdict;
    previousContext = `\n## Previous Round Findings\n`;
    if (v.registers) {
      const r = v.registers;
      if (r.statusChanges.length > 0) previousContext += `- **Status**: ${r.statusChanges.join("; ")}\n`;
      if (r.decisions.length > 0) previousContext += `- **Decisions**: ${r.decisions.join("; ")}\n`;
      if (r.requirementChanges.length > 0) previousContext += `- **Requirements**: ${r.requirementChanges.join("; ")}\n`;
      if (r.risks.length > 0) previousContext += `- **Risks**: ${r.risks.join("; ")}\n`;
    }
    if (v.classifications && v.classifications.length > 0) {
      previousContext += `\n### Classifications from previous round\n`;
      for (const c of v.classifications) {
        previousContext += `- [${c.classification.toUpperCase()}] ${c.item} → ${c.action}\n`;
      }
    }
    if (v.judgeSummary) {
      previousContext += `\n### Judge synthesis\n${v.judgeSummary}\n`;
    }
    previousContext += `\nBuild on these findings. Refine, challenge, or extend — do NOT simply repeat them.\n`;
    previousContext += `CRITICAL CONVERGENCE RULE: You MUST use the EXACT SAME items and classifications as the previous round. You may ONLY:\n`;
    previousContext += `1. Sharpen the "action" field for existing items\n`;
    previousContext += `2. Change a classification ONLY with explicit justification (e.g., "Reclassify X from GAP to BUILD because...")\n`;
    previousContext += `3. Merge two items into one (with justification)\n`;
    previousContext += `You MUST NOT add new items, split existing items, or rephrase item names. The item set is FROZEN.\n`;
  }

  return `# Parliamentary Deliberation

## Topic
${topic}

## Standing Committee
${committeeInfo?.name ?? committee} — covers: ${items}

## Round
${round}
${previousContext}
## Instructions
Analyze the given topic thoroughly. This is a parliamentary deliberation — speak freely about all aspects.

Consider:
- Feasibility and technical merit
- Risks and potential issues
- Missing requirements or unstated assumptions
- Alternative approaches
- Impact on existing systems

CRITICAL: Only report bugs or issues that you have DIRECTLY VERIFIED in the actual source code.
Do NOT infer bugs from function signatures, comments, or general assumptions about how code might work.
If you cannot read the actual file, state "unverified" rather than reporting a false bug.
Hallucinated bugs waste implementation time and erode trust in the deliberation process.

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
  try {
    const events = store.query({ eventType: "parliament.session.digest" as import("../../bus/events.js").EventType });

    if (events.length === 0) {
      console.log(`${C.dim}No parliament sessions found.${C.reset}`);
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
  } finally {
    store.close();
  }
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
  } catch (err) {
    console.warn(`[parliament] CPS file write failed: ${(err as Error).message}`);
  }
}

// ── Help ─────────────────────────────────────

function showHelp(): void {
  console.log(`
${C.cyan}quorum parliament${C.reset} — run parliamentary deliberation on a topic

${C.yellow}💡 일반적으로 자동 실행됩니다.${C.reset} 수동 실행이 필요한 경우에만 이 명령을 사용하세요.
${C.dim}   자동: setup 완료 시 의제 기반으로 파이프라인이 parliament를 자동 호출합니다.${C.reset}

${C.bold}Usage:${C.reset}
  quorum parliament "<topic>"
  quorum parliament [options] "<topic>"

${C.bold}Options:${C.reset}
  --committee, -c <name>   Standing committee (auto-detected from topic)
                           Committees: ${Object.keys(STANDING_COMMITTEES).join(", ")}
  --rounds, -r <n>         Max deliberation rounds (default: 10, stops early on convergence)
  --advocate <spec>        Advocate provider (default: from config or claude)
  --devil <spec>           Devil's advocate provider (default: from config or claude)
  --judge <spec>           Judge provider (default: from config or claude)
  --testimony, -t <text>   Implementer testimony (context only, no vote)
  --mux                    Use ProcessMux (tmux/psmux) for LLM sessions (visible in daemon TUI)
  --force                  Bypass parliament enforcement gates
  --resume <id>            Resume a previous session
  --history                Show parliament session history
  --detail <id>            Show detail for a specific session

${C.bold}Provider specs:${C.reset}
  codex, claude, openai, gemini, ollama, vllm
  claude:claude-opus-4-6, openai:gpt-4o, ollama:qwen3:8b   (with model override)

${C.bold}Examples:${C.reset}
  quorum parliament "add payment feature"
  quorum parliament --rounds 3 "microservice migration"
  quorum parliament -c architecture "system design review"
  quorum parliament --advocate claude --devil openai --judge codex "auth redesign"
  quorum parliament -t "DB schema constraints" "order table refactoring"

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
