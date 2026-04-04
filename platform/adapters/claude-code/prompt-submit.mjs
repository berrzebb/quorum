#!/usr/bin/env node
/**
 * Hook: UserPromptSubmit
 * 1. Injects real-time audit/retro status as additionalContext.
 * 2. [STEER] Detects gate profile intent from user prompt (regex, < 500ms).
 *    On match: writes gateProfile to config.json, outputs steering message.
 *
 * Design: fast-path exit when no state AND no steering intent → zero overhead.
 * PRD § 6.3: Intent Detector → Profile Switcher → Feedback.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readAuditStatus, readRetroMarker, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { resolveRepoRoot } from "../../adapters/shared/repo-resolver.mjs";
import { createT } from "../../core/context.mjs";
import { detectIntent } from "../../adapters/shared/intent-patterns.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read stdin (UserPromptSubmit payload) ────────────────────
let input = {};
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) input = JSON.parse(raw);
} catch { /* fail-open: proceed without prompt */ }

// ── Config ──────────────────────────────────────────────────
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });

// ── [SETUP WB-5] Interview answer processing ────────────────
// If setup-state.json exists with interview_pending, process user's answer.
const setupStatePath = resolve(REPO_ROOT, ".claude", "quorum", "setup-state.json");
if (existsSync(setupStatePath)) {
  try {
    const setupState = JSON.parse(readFileSync(setupStatePath, "utf8"));
    if (setupState.status === "interview_pending" && input.prompt) {
      const { processAnswers, composeHarness } = await import("../../adapters/shared/setup-interview.mjs");
      const { mkdirSync } = await import("node:fs");

      // Parse free-form answers from user prompt
      const prompt = input.prompt;
      const answers = [];

      // Extract goal: everything that isn't a priority/team keyword
      answers.push({ id: "goal", value: prompt });

      // Extract priority from keywords
      if (/보안|security|strict|엄격/i.test(prompt)) answers.push({ id: "priority", value: "보안 (security)" });
      else if (/속도|speed|fast|빨리|quick/i.test(prompt)) answers.push({ id: "priority", value: "속도 (speed)" });
      else if (/실험|experiment|proto|MVP/i.test(prompt)) answers.push({ id: "priority", value: "실험 (experiment)" });
      else answers.push({ id: "priority", value: "품질 (quality)" });

      // Extract team size
      if (/혼자|solo|1명|나 혼자/i.test(prompt)) answers.push({ id: "teamSize", value: "solo (혼자)" });
      else if (/large|대규모|6명|많/i.test(prompt)) answers.push({ id: "teamSize", value: "large (6명+)" });
      else if (/small|소규모|2-5|2명|3명|4명|5명/i.test(prompt)) answers.push({ id: "teamSize", value: "small (2-5명)" });
      else answers.push({ id: "teamSize", value: "solo (혼자)" }); // default

      const intent = processAnswers(answers, setupState.profile);
      const harnessConfig = composeHarness(intent, setupState.profile);

      // Merge with example config if available
      const configDir = resolve(REPO_ROOT, ".claude", "quorum");
      const configDest = resolve(configDir, "config.json");
      let baseConfig = {};
      const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;
      const examplePath = resolve(pluginRoot, "examples", "config.example.json");
      if (existsSync(examplePath)) {
        try { baseConfig = JSON.parse(readFileSync(examplePath, "utf8")); } catch { /* use empty */ }
      }
      const finalConfig = { ...baseConfig, ...harnessConfig, gates: { ...baseConfig.gates, ...harnessConfig.gates } };

      mkdirSync(configDir, { recursive: true });
      writeFileSync(configDest, JSON.stringify(finalConfig, null, 2) + "\n", "utf8");

      // Update setup state
      writeFileSync(setupStatePath, JSON.stringify({
        ...setupState,
        status: "interview_complete",
        intent,
        completedAt: new Date().toISOString(),
      }, null, 2));

      // Output confirmation
      const msg = [
        `[quorum setup complete] config.json 생성 완료!`,
        `  프로필: ${intent.gateProfile}`,
        `  의제: ${intent.agenda}`,
        `  팀: ${intent.teamSize}`,
        intent.activeDomains.length > 0 ? `  도메인: ${intent.activeDomains.join(", ")}` : null,
      ].filter(Boolean).join("\n");

      process.stdout.write(`{"additionalContext": ${JSON.stringify(msg)}}`);
      process.exit(0);
    }
  } catch (err) {
    console.warn(`[prompt-submit] interview processing failed: ${err?.message}`);
    // fail-open: continue to normal prompt-submit logic
  }
}

let isProjectScoped = false;
const configPath = (() => {
  // Project-scoped first (only this path is safe for steering writes)
  if (REPO_ROOT) {
    const p = resolve(REPO_ROOT, ".claude", "quorum", "config.json");
    if (existsSync(p)) { isProjectScoped = true; return p; }
  }
  const pr = process.env.CLAUDE_PLUGIN_ROOT;
  if (pr) { const p = resolve(pr, "config.json"); if (existsSync(p)) return p; }
  const local = resolve(__dirname, "config.json");
  return existsSync(local) ? local : null;
})();
if (!configPath) process.exit(0);

let cfg;
try { cfg = JSON.parse(readFileSync(configPath, "utf8")); } catch (err) { console.warn(`[prompt-submit] config parse error: ${err?.message}`); process.exit(0); }

const locale = cfg.plugin?.locale ?? "en";
const t = createT(locale);
const triggerTag = cfg.consensus?.trigger_tag ?? "[REVIEW_NEEDED]";
const agreeTag = cfg.consensus?.agree_tag ?? "[APPROVED]";
const pendingTag = cfg.consensus?.pending_tag ?? "[CHANGES_REQUESTED]";

// ── Collect status signals ──────────────────────────────────
const signals = [];

// 1. Retro pending?
{
  const m = readRetroMarker(__dirname);
  if (m?.retro_pending) {
    signals.push(`⏳ ${t("signal.retro_pending")}`);
  }
}

// 2. Audit status
const auditStatus = readAuditStatus(REPO_ROOT);
if (auditStatus) {
  if (auditStatus.status === AUDIT_STATUS.CHANGES_REQUESTED) {
    const codeCount = auditStatus.rejectionCodes?.length ?? 0;
    signals.push(`❌ ${t("signal.pending_corrections", { tag: pendingTag, count: codeCount })}`);
  } else if (auditStatus.status === AUDIT_STATUS.APPROVED) {
    signals.push(`✅ ${t("signal.approved", { tag: agreeTag })}`);
  }
}

// ── [STEER] Intent detection (PRD § 6.3) ────────────────────
const prompt = input.prompt ?? "";
const intent = detectIntent(prompt);
let steeringEvent = null; // { from, to, trigger } — emitted via bridge later

if (intent) {
  // Write gateProfile to config.json (triggers refreshConfigIfChanged)
  // Only write to project-scoped config — never pollute shared plugin config (P2 fix)
  try {
    if (!cfg.gates) cfg.gates = {};
    const prevProfile = cfg.gates.gateProfile ?? "balanced";
    if (prevProfile !== intent.profile) {
      cfg.gates.gateProfile = intent.profile;
      if (isProjectScoped) {
        writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      }

      // Track for EventStore emission (WB-6)
      steeringEvent = { from: prevProfile, to: intent.profile, trigger: intent.match };

      // Profile-specific feedback messages (PRD § 6.3)
      const PROFILE_LABELS = {
        strict: "security-focused review enabled",
        balanced: "standard review mode",
        fast: "fast mode — minimal review",
        prototype: "prototype mode — audit skipped",
      };
      signals.push(`[quorum] Gate switched to "${intent.profile}" — ${PROFILE_LABELS[intent.profile]}`);
    }
  } catch (err) {
    console.warn(`[prompt-submit] steering config write failed: ${err?.message}`);
    // fail-open: steering message still shown even if config write fails
    signals.push(`[quorum] Gate → "${intent.profile}" (config write failed, transient)`);
  }
}

// ── [HIDE WB-3] Pipeline Detection + Auto-Execution ─────────
// Detect large task intent → output pipeline directive + write state.
// PRD § 6.2: "사용자 명령 0개" — directive drives Claude's execution.
if (prompt && cfg?.pipeline?.autoSuggest !== false) {
  const PIPELINE_PATTERNS = /구현해\s*줘|만들어\s*줘|추가해\s*줘|개발해\s*줘|build\s+(?:a|the|me)\s+\w+|implement|create\s+(?:a|the)\s+\w+|add\s+(?:a|the)\s+\w+.*system|set\s*up/i;
  const SMALL_PATTERNS = /수정해|고쳐|fix|bug|typo|rename|변수|함수\s*하나|one\s+function|한\s*줄/i;
  if (PIPELINE_PATTERNS.test(prompt) && !SMALL_PATTERNS.test(prompt) && prompt.length > 5) {
    try {
      const { buildPipelineDirective } = await import("../../adapters/shared/pipeline-runner.mjs");
      const directive = buildPipelineDirective(prompt, cfg);
      signals.push(directive);

      // Write pipeline state for tracking
      const pipeDir = resolve(REPO_ROOT, ".claude", "quorum", "pipeline");
      const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs");
      mkd(pipeDir, { recursive: true });
      wfs(resolve(pipeDir, "state.json"), JSON.stringify({
        status: "active",
        agenda: prompt,
        gateProfile: cfg?.gates?.gateProfile ?? "balanced",
        startedAt: new Date().toISOString(),
      }, null, 2), "utf8");
    } catch (err) {
      // Fallback: simple directive without pipeline-runner
      signals.push(`[quorum auto-pipeline] "${prompt}" — 자동 개발 파이프라인으로 실행합니다. 설계 → 구현 → 검증 순으로 진행하세요.`);
    }
  }
}

// ── [WB-5] Error Context Auto-Injection ─────────────────────
// Inject recent errors from EventStore into additionalContext.
// Bridge loading is fail-open — skip if unavailable or slow.
try {
  const bridge = await import("../../core/bridge.mjs");
  if (await bridge.init(REPO_ROOT)) {
    try {
      // [WB-6] Emit steering.switch event to EventStore
      if (steeringEvent) {
        bridge.event.emitEvent("steering.switch", "claude-code", steeringEvent);
      }

      // [WB-5] Error context auto-injection
      const recentErrors = bridge.event.queryEvents({
        eventType: "quality.fail",
        limit: 3,
        descending: true,
      });
      if (recentErrors.length > 0) {
        const errorSummaries = recentErrors.map(e => {
          const p = e.payload ?? {};
          return `${p.label ?? "quality"}: ${p.file ?? "unknown"} — ${p.output?.toString().slice(0, 100) ?? "failed"}`;
        });
        signals.push(`[recent errors] ${errorSummaries.join("; ")}`);
      }
    } finally {
      bridge.close();
    }
  }
} catch { /* fail-open: no error context / steering event if bridge unavailable */ }

// ── Output ──────────────────────────────────────────────────
if (signals.length === 0) process.exit(0);

const context = `[quorum status] ${signals.join(" | ")}`;
const escaped = JSON.stringify(context);
process.stdout.write(`{"additionalContext": ${escaped}}`);
