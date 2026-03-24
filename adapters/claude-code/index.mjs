#!/usr/bin/env node
/* global process, Buffer */
/**
 * PostToolUse hook: tag-based consensus loop + code quality auto-checks.
 *
 * (A) consensus.watch_file edited + trigger_tag present → run audit_script → wait for agree_tag
 * (B) quality_rules — run ESLint/npm audit immediately on matching file edits
 *
 * All behavior is controlled by config.json.
 * Verdicts and evidence are stored in SQLite (single source of truth).
 */
import { readFileSync, existsSync, appendFileSync, statSync, writeFileSync, openSync, closeSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { execResolved } from "../../core/cli-runner.mjs";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus as c,
  findWatchFile, t, isHookEnabled, configMissing,
} from "../../core/context.mjs";
import { readAuditStatus, AUDIT_STATUS, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { runParliamentIfEnabled } from "../../adapters/shared/parliament-runner.mjs";
import { runParliamentIfEnabled } from "../../adapters/shared/parliament-runner.mjs";
import * as bridge from "../../core/bridge.mjs";

const debugLog = resolve(HOOKS_DIR, plugin.debug_log ?? "debug.log");
const ackFile  = resolve(HOOKS_DIR, plugin.ack_file ?? "ack.timestamp");

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(debugLog, `[${ts}] ${msg}\n`);
}

// Use memoized path resolvers from context.mjs
const find_watch_file = findWatchFile;

/** Pre-computed required section patterns (cached on first call). */
let _cachedRequired = null;

/** Cached plan doc existence check (stable within session). */
let _hasPlanDoc = null;

/** Pre-validate evidence package format — regex-based, zero tokens. */
function validate_evidence_format(content) {
  const errors = [];
  const warnings = [];
  const triggerSection = content.split(/^## /m).find((s) => s.includes(c.trigger_tag));
  if (!triggerSection) return { errors, warnings };

  // ── Required sections — configurable via consensus.evidence_sections, fallback to defaults ──
  if (!_cachedRequired) {
    const configSections = c.evidence_sections ?? [];
    const defaultSections = ["Claim", "Changed Files", "Test Command", "Test Result", "Residual Risk"];
    const sectionNames = configSections.length > 0 ? configSections : defaultSections;
    _cachedRequired = sectionNames.map((label) => ({
      label,
      pattern: new RegExp(`### ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
    }));
  }
  const required = _cachedRequired;

  for (const { label, pattern } of required) {
    if (!pattern.test(triggerSection)) {
      errors.push(t("index.format.missing_section", { label }));
    }
  }

  // ── Test Command: reject glob patterns ──
  if (/### Test Command/.test(triggerSection)) {
    const cmdSection = triggerSection.split(/### Test Command/i)[1]?.split(/### /)[0] || "";
    if (/\*\*?\/|\*\.\w+/.test(cmdSection)) {
      errors.push(t("index.format.glob_in_test"));
    }
  }

  // ── Test Result: check non-empty ──
  if (/### Test Result/.test(triggerSection)) {
    const resultSection = triggerSection.split(/### Test Result/i)[1]?.split(/### /)[0] || "";
    if (resultSection.trim().length < 10) {
      errors.push(t("index.format.empty_result"));
    }
  }

  // ── Quick audit: verify Changed Files exist ──
  const filesSection = /### Changed Files/.test(triggerSection)
    ? (triggerSection.split(/### Changed Files/i)[1]?.split(/### /)[0] || "")
    : "";
  const listedFiles = [...filesSection.matchAll(/`([^`]+\.[a-zA-Z]+)`/g)].map((m) => m[1]);
  if (filesSection) {
    for (const f of listedFiles) {
      const fullPath = resolve(REPO_ROOT, f);
      if (!existsSync(fullPath)) {
        warnings.push(t("index.quick_audit.file_not_found", { file: f }));
      }
    }
    if (listedFiles.length === 0 && filesSection.trim().length > 0) {
      warnings.push(t("index.quick_audit.no_backtick_paths"));
    }
  }

  // ── Quick audit: compare git diff vs Changed Files ──
  if (/### Changed Files/.test(triggerSection) && listedFiles.length > 0) {
    try {
      const diffFiles = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true })
        .trim().split("\n").filter(Boolean);
      if (diffFiles.length === 0) {
        // no staged files — check unstaged
        const unstaged = execFileSync("git", ["diff", "--name-only"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true })
          .trim().split("\n").filter(Boolean);
        if (unstaged.length > 0) {
          const missing = listedFiles.filter((f) => !unstaged.some((d) => d.endsWith(f) || f.endsWith(d)));
          for (const f of missing) {
            warnings.push(t("index.quick_audit.not_in_diff", { file: f }));
          }
        }
      }
    } catch { /* skip if git unavailable */ }
  }

  // ── Quick audit: tag conflict (agree + trigger on same line) ──
  const lines = triggerSection.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes(c.trigger_tag) && line.includes(cfg.consensus.agree_tag)) {
      warnings.push(t("index.quick_audit.tag_conflict", { trigger: c.trigger_tag, agree: cfg.consensus.agree_tag }));
    }
  }

  return { errors, warnings };
}

function get_mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }
function read_ack()   { try { return Number(readFileSync(ackFile, "utf8").trim()) || 0; } catch { return 0; } }
function write_ack(ms) { writeFileSync(ackFile, String(ms), "utf8"); }

function has_trigger(content) { return content.includes(c.trigger_tag); }
function has_agreed(content)  { return !content.includes(c.trigger_tag); }

function run_script(absPath, args = []) {
  if (!existsSync(absPath)) { log(`SKIP: ${absPath} not found`); return null; }
  const result = spawnSync(process.execPath, [absPath, ...args], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    windowsHide: true,
  });
  if (result.error) { log(`ERROR: ${result.error.message}`); return null; }
  const err = (result.stderr || "").trim();
  if (err) log(`STDERR: ${err.split("\n")[0]}`);
  const out = (result.stdout || "").trim();
  if (out) log(`OUT: ${out.split("\n")[0]}`);
  return { status: result.status, stdout: out };
}

/** (A) Detected trigger_tag → spawn audit_script in background, return immediately.
 *  ProcessMux handles agent coordination — no lock needed. */
function run_audit(watchFilePath) {
  if (process.env.FEEDBACK_HOOK_DRY_RUN === "1") {
    process.stdout.write(t("index.dry_run.audit", { script: plugin.audit_script }));
    return;
  }

  // Derive worktree root for log path
  let worktreeRoot = REPO_ROOT;
  if (watchFilePath) {
    const wMatch = watchFilePath.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/([^/]+))\//);
    if (wMatch) worktreeRoot = wMatch[1];
  }

  const auditScript = resolve(HOOKS_DIR, plugin.audit_script);
  if (!existsSync(auditScript)) {
    log("SKIP: " + auditScript + " not found");
    process.stdout.write(t("index.audit.failed"));
    return;
  }

  // Spawn audit in background — hook returns immediately
  const logPath = resolve(worktreeRoot, ".claude", "audit-bg.log");
  const logFd = openSync(logPath, "w");

  let child;
  try {
    const auditArgs = [auditScript];
    if (watchFilePath) auditArgs.push("--watch-file", watchFilePath);
    child = spawn(process.execPath, auditArgs, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
      windowsHide: true,
    });
  } catch (err) {
    closeSync(logFd);
    log("SPAWN_ERROR: " + (err.message ?? err));
    process.stdout.write(t("index.audit.failed"));
    return;
  }

  // Handle spawn errors (ENOENT etc — async)
  child.on("error", (err) => {
    log("CHILD_ERROR: " + (err.message ?? err));
    try { closeSync(logFd); } catch { /* already closed by normal path */ }
  });

  child.unref();
  closeSync(logFd);

  log("AUDIT_STARTED: pid=" + child.pid);
  process.stdout.write(t("index.audit.started_async", { tag: c.trigger_tag, pid: child.pid, log: logPath }));
}

/** If audit-status.json is newer than last ack → auto-sync via respond_script. */
function check_pending_response() {
  const auditStatusPath = resolve(REPO_ROOT, ".claude", "audit-status.json");
  const statusMtime = get_mtime(auditStatusPath);
  if (statusMtime === 0) return;

  const lastAck = read_ack();
  if (statusMtime <= lastAck) return;

  log("NOTIFY: pending response — auto-sync");
  const result = run_script(resolve(HOOKS_DIR, plugin.respond_script));
  write_ack(Math.max(statusMtime, get_mtime(auditStatusPath)));
  if (result?.stdout) process.stdout.write(t("index.sync.output", { out: result.stdout }));

  const status = readAuditStatus(REPO_ROOT);
  if (status?.status === AUDIT_STATUS.APPROVED) {
    process.stdout.write(t("index.sync.arrived_agreed", { tag: c.agree_tag }));
  } else if (status) {
    const statusMsg = `status: ${status.status}, pending: ${status.pendingCount}, codes: ${(status.rejectionCodes ?? []).join(", ")}`;
    process.stdout.write(t("index.sync.arrived_pending", { tag: c.pending_tag, content: statusMsg }));
  }
}

/** (C) quality_rules — match file extension/name → run immediate check. */
function run_quality_checks(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const filename   = filePath.split(/[\\/]/).pop() ?? "";
  if (normalized.includes("/node_modules/")) return;

  // Support both legacy array format and new preset object format
  const qr = cfg.quality_rules;
  const rules = Array.isArray(qr) ? qr : [];

  // If preset format: resolve active presets by detect file presence
  if (qr && !Array.isArray(qr) && Array.isArray(qr.presets)) {
    const activePresets = qr.presets.filter(p => existsSync(resolve(REPO_ROOT, p.detect)));
    for (const preset of activePresets) {
      for (const check of preset.checks ?? []) {
        if (check.per_file) {
          const envRef = process.platform === "win32" ? "%HOOK_TARGET_FILE%" : "$HOOK_TARGET_FILE";
          const cmd = check.command.replace("{file}", envRef);
          const result = spawnSync(cmd, {
            cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
            env: { ...process.env, HOOK_TARGET_FILE: filePath },
          });
          const output = ((result.stdout || "") + (result.stderr || "")).trim();
          if (result.status !== 0 && output && !check.optional) {
            process.stdout.write(t("index.check.error", { label: check.label, file: filename, output }));
          }
        }
      }
    }
    return;
  }

  // Legacy array format
  for (const rule of rules) {
    const m = rule.match;
    if (m.extension && !normalized.endsWith(m.extension)) continue;
    if (m.path_contains && !m.path_contains.some((p) => normalized.includes(p))) continue;
    if (m.filenames && !m.filenames.includes(filename)) continue;

    const envRef = process.platform === "win32" ? "%HOOK_TARGET_FILE%" : "$HOOK_TARGET_FILE";
    const cmd = rule.command.replace("{file}", envRef);
    const result = spawnSync(cmd, {
      cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
      env: { ...process.env, HOOK_TARGET_FILE: filePath },
    });
    const output = ((result.stdout || "") + (result.stderr || "")).trim();
    if (result.status !== 0 && output) {
      process.stdout.write(t("index.check.error", { label: rule.label, file: filename, output }));
    }
  }
}

async function main() {
  log("Hook triggered");
  if (configMissing) {
    process.stdout.write("[quorum] config.json not found. Run a new session to trigger auto-setup, or see README.md for manual configuration.");
    return;
  }
  if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); return; }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) { log("EXIT: empty stdin"); return; }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    log("EXIT: JSON parse error");
    check_pending_response();
    return;
  }

  // Propagate session_id via env — downstream scripts (retrospective.mjs) record it in markers
  const sessionId = payload?.session_id || "";
  if (sessionId) {
    process.env.RETRO_SESSION_ID = sessionId;
  }

  const toolName = String(payload?.tool_name ?? "unknown");
  const filePath = String(payload?.tool_input?.file_path ?? "");
  log(`tool=${toolName} file_path=${filePath}`);
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  // (C) Code quality immediate check (skip consensus watch_file)
  if (isHookEnabled("quality_rules") && !normalized.endsWith(c.watch_file.toLowerCase())) {
    run_quality_checks(filePath);
  }

  // (A) Detect watch_file edit — with debounce for sequential edits
  if (isHookEnabled("audit") && normalized.endsWith(c.watch_file.toLowerCase())) {
    // Use the actual file_path from tool input — not findWatchFile() which only checks main repo.
    // This ensures worktree watch_file edits are detected correctly.
    const watchPath = existsSync(filePath) ? filePath : find_watch_file();
    if (!watchPath) { log("EXIT: watch_file not found"); return; }

    const content = readFileSync(watchPath, "utf8");
    if (!has_trigger(content)) { log("EXIT: no trigger_tag"); return; }

    // Derive worktree root for debounce isolation
    let debounceRoot = REPO_ROOT;
    const wm = watchPath.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
    if (wm) debounceRoot = wm[1];

    // Debounce: only trigger audit on last Edit in a sequence (per-worktree)
    const DEBOUNCE_MS = 10_000;
    const debounceDir = resolve(debounceRoot, ".claude");
    if (!existsSync(debounceDir)) { try { mkdirSync(debounceDir, { recursive: true }); } catch { /* race-safe */ } }
    const debouncePath = resolve(debounceDir, "audit-debounce.ts");
    const now = Date.now();
    writeFileSync(debouncePath, String(now), "utf8");
    log(`DEBOUNCE: scheduled at ${now}, waiting ${DEBOUNCE_MS}ms`);

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

    // Debounce check: is my timestamp still current?
    try {
      const current = readFileSync(debouncePath, "utf8").trim();
      if (current !== String(now)) {
        log(`DEBOUNCE: superseded by ${current}, skipping`);
        return;
      }
    } catch {
      log("DEBOUNCE: file removed, skipping");
      return;
    }

    // Debounce passed — last Edit confirmed. Re-read latest content.
    const freshContent = readFileSync(watchPath, "utf8");
    if (!has_trigger(freshContent)) { log("EXIT: trigger_tag removed during debounce"); return; }

    // Pre-validate format + quick audit — zero tokens, blocks before Codex invocation
    const { errors: formatErrors, warnings: quickAuditWarnings } = validate_evidence_format(freshContent);
    if (formatErrors.length > 0) {
      const errorList = formatErrors.map((e) => `  • ${e}`).join("\n");
      process.stdout.write(t("index.format.check_header", { errors: errorList }));
      log(`FORMAT_INCOMPLETE: ${formatErrors.length} errors`);
      return;
    }

    // Quick audit warnings (non-blocking — informational only)
    if (quickAuditWarnings.length > 0) {
      const warnList = quickAuditWarnings.map((w) => `  ⚠ ${w}`).join("\n");
      process.stdout.write(t("index.quick_audit.header", { count: quickAuditWarnings.length, warnings: warnList }));
      log(`QUICK_AUDIT: ${quickAuditWarnings.length} warnings`);
    }

    // ── Bridge: evaluate trigger + emit events ──
    const bridgeReady = await bridge.init(REPO_ROOT);
    if (bridgeReady) {
      // Initialize HookRunner from config + HOOK.md (fail-safe)
      await bridge.initHookRunner(REPO_ROOT, cfg.hooks);

      // Fire pre-audit hooks — user can deny to block audit (e.g., code freeze)
      const preAuditGate = await bridge.checkHookGate("audit.submit", {
        session_id: sessionId, cwd: REPO_ROOT,
        metadata: { provider: "claude-code", watchFile: watchPath },
      });
      if (!preAuditGate.allowed) {
        log(`HOOK_DENY: audit.submit blocked — ${preAuditGate.reason}`);
        process.stdout.write(`[quorum] Audit blocked by hook: ${preAuditGate.reason}\n`);
        bridge.close();
        return;
      }
      // Count changed files from evidence
      const changedFileSection = freshContent.match(/### Changed Files[\s\S]*?(?=###|$)/)?.[0] ?? "";
      const changedFileCount = (changedFileSection.match(/^- `/gm) ?? []).length;
      const changedFilesRaw = (changedFileSection.match(/^- `([^`]+)`/gm) ?? [])
        .map(m => m.replace(/^- `|`$/g, ""));

      // ── Store evidence in SQLite — single source of truth ──
      bridge.emitEvent("evidence.write", "claude-code", {
        watchFile: watchPath,
        content: freshContent,
        changedFiles: changedFilesRaw,
        triggerTag: c.trigger_tag,
      }, { sessionId });
      bridge.setState("evidence:latest", {
        watchFile: watchPath,
        content: freshContent,
        changedFiles: changedFilesRaw,
        timestamp: Date.now(),
      });

      // Run domain detection + blast radius in parallel (independent I/O)
      const [detectionResult, blastResult] = await Promise.all([
        bridge.detectDomains(changedFilesRaw, changedFileSection),
        changedFilesRaw.length > 0
          ? bridge.computeBlastRadius(changedFilesRaw).catch(() => null)
          : null,
      ]);
      const blastRadius = blastResult?.ratio;

      // Check prior rejections
      const priorRejections = bridge.queryEvents({ eventType: "audit.verdict" })
        .filter((e) => e.payload.verdict === "changes_requested").length;

      // Check if plan docs exist (cached — directory presence is session-stable)
      if (_hasPlanDoc === null) {
        const planDirs = ["docs/plan", "docs/plans", "plans"];
        _hasPlanDoc = planDirs.some(d => {
          try { return existsSync(resolve(REPO_ROOT, d)); } catch { return false; }
        });
      }
      const hasPlanDoc = _hasPlanDoc;

      const triggerResult = bridge.evaluateTrigger({
        changedFiles: changedFileCount || 1,
        securitySensitive: /auth|token|secret|crypt/i.test(changedFileSection),
        priorRejections,
        apiSurfaceChanged: /api|endpoint|route/i.test(changedFileSection),
        crossLayerChange: changedFileSection.includes("src/") && changedFileSection.includes("tests/"),
        isRevert: /revert|rollback/i.test(freshContent),
        domains: detectionResult?.domains,
        hasPlanDoc,
        blastRadius,
      });

      if (triggerResult) {
        log(`TRIGGER: mode=${triggerResult.mode} tier=${triggerResult.tier} score=${triggerResult.score.toFixed(2)}`);
        if (triggerResult.requiresPlan) {
          log("PLAN-FIRST: T3 change without plan document — consider adding docs/plan/ before audit");
        }
        bridge.emitEvent("audit.submit", "claude-code", {
          file: watchPath,
          tier: triggerResult.tier,
          mode: triggerResult.mode,
          score: triggerResult.score,
          reasons: triggerResult.reasons,
        }, { sessionId });

        // Parliament session: T3 deliberative + parliament.enabled → diverge-converge protocol
        if (triggerResult.mode === "deliberative") {
          await runParliamentIfEnabled(bridge, cfg, freshContent, watchPath, "claude-code", sessionId, log);
        }

        // T1 skip: no audit needed — unless minimum_tier overrides
        const minTier = cfg.experiment?.minimum_tier ?? 0;
        if (triggerResult.mode === "skip" && minTier < 2) {
          log("SKIP: T1 micro change — no audit needed");
          process.stdout.write(`[quorum] T1 micro change (score: ${triggerResult.score.toFixed(2)}) — audit skipped.\n`);
          bridge.close();
          return;
        }
        if (triggerResult.mode === "skip" && minTier >= 2) {
          log(`OVERRIDE: T1 would skip, but minimum_tier=${minTier} forces audit`);
          process.stdout.write(`[quorum] minimum_tier=${minTier} — T1 skip overridden, audit forced.\n`);
        }
      }

      // ── Domain detection + specialist tools ──
      const activeDomainNames = detectionResult
        ? Object.entries(detectionResult.domains).filter(([, v]) => v).map(([k]) => k)
        : [];
      if (detectionResult && activeDomainNames.length > 0) {
        const tier = triggerResult?.tier ?? "T2";
        const selection = await bridge.selectReviewers(detectionResult.domains, tier);

        if (selection && selection.tools.length > 0) {
          log(`SPECIALIST: ${selection.summary}`);
          bridge.emitEvent("specialist.detect", "claude-code", {
            domains: activeDomainNames,
            tools: selection.tools,
            agents: selection.agents,
            tier,
          }, { sessionId });

          // Run deterministic tools (zero cost, <30s each)
          const specialistResult = await bridge.runSpecialistTools(selection, freshContent, REPO_ROOT);
          if (specialistResult) {
            for (const tr of specialistResult.toolResults) {
              bridge.emitEvent("specialist.tool", "claude-code", {
                tool: tr.tool, domain: tr.domain, status: tr.status, duration: tr.duration,
              }, { sessionId });
            }

            // Submit tool findings to MessageBus for granular tracking
            const mb = bridge.getMessageBus();
            if (mb) {
              for (const tr of specialistResult.toolResults) {
                const findings = bridge.parseToolFindings(tr);
                if (findings.length > 0) {
                  mb.submitFindings(findings, "claude-code", `specialist-${tr.tool}`, tr.domain);
                }
              }
            }

            // If tools have findings, log them (non-blocking — auditor sees enriched evidence)
            if (specialistResult.hasBlockingToolFailure) {
              log(`SPECIALIST_FAIL: ${specialistResult.codes.join(",")}`);
            }
            log(`SPECIALIST_DONE: ${specialistResult.toolResults.length} tools, ${specialistResult.duration}ms`);
          }
        }
      }

      // Check stagnation before spawning audit
      const stagnation = bridge.detectStagnation(REPO_ROOT);
      if (stagnation?.detected) {
        log(`STAGNATION: ${stagnation.patterns.map((p) => p.type).join(",")} → ${stagnation.recommendation}`);
        bridge.emitEvent("quality.fail", "claude-code", {
          stagnation: true,
          patterns: stagnation.patterns.map((p) => p.type),
          recommendation: stagnation.recommendation,
        }, { sessionId });
      }
    }

    // Pre-spawn hook gate (last chance to deny before audit process starts)
    const spawnGate = await bridge.checkHookGate("audit.spawn", {
      session_id: sessionId, cwd: REPO_ROOT,
      metadata: { provider: "claude-code", watchFile: watchPath },
    });
    if (!spawnGate.allowed) {
      log(`HOOK_DENY: audit.spawn blocked — ${spawnGate.reason}`);
      process.stdout.write(`[quorum] Audit spawn blocked: ${spawnGate.reason}\n`);
      bridge.close();
      return;
    }

    run_audit(watchPath);
    if (bridgeReady) bridge.close();
    return;
  }

  // Other file edited → check for pending response
  check_pending_response();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => log(`FATAL: ${err.message}`));
}

