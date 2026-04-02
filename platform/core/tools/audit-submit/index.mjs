/**
 * audit-submit/index.mjs — Tool: audit_submit
 *
 * Submit evidence for audit — stores in SQLite and evaluates trigger.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ═══ Tool: audit_submit ═══════════════════════════════════════════════

/**
 * Submit evidence for audit — stores in SQLite EventStore, evaluates trigger, runs audit if needed.
 */
export async function toolAuditSubmit(params) {
  const { evidence, changed_files, source = "claude-code" } = params;
  if (!evidence) return { error: "evidence is required (markdown text with ### Claim, ### Changed Files, etc.)" };

  const repoRoot = process.cwd();
  const bridgePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "bridge.mjs");

  let bridge;
  try {
    bridge = await import(pathToFileURL(bridgePath).href);
    await bridge.init(repoRoot);
  } catch (err) {
    return { error: `Bridge init failed: ${err.message}` };
  }

  // Extract changed files from evidence if not provided
  const changedFiles = changed_files ?? [];
  if (changedFiles.length === 0) {
    const section = evidence.match(/###\s*Changed Files[\s\S]*?(?=###|$)/i);
    if (section) {
      const filePattern = /^[\s-]*`([^`]+)`/gm;
      let m;
      while ((m = filePattern.exec(section[0])) !== null) changedFiles.push(m[1]);
    }
  }

  // Store evidence in SQLite
  bridge.event.emitEvent("evidence.write", source, {
    content: evidence,
    changedFiles,
    triggerTag: "[REVIEW_NEEDED]",
  });
  bridge.query.setState("evidence:latest", {
    content: evidence,
    changedFiles,
    timestamp: Date.now(),
  });

  // Evaluate trigger via bridge public API
  const ctx = {
    changedFiles: changedFiles.length,
    securitySensitive: changedFiles.some(f => /auth|secret|key|cred|token|password/i.test(f)),
    priorRejections: 0,
    apiSurfaceChanged: false,
    crossLayerChange: false,
    isRevert: false,
  };
  const trigger = bridge.gate.evaluateTrigger(ctx);
  if (!trigger) {
    return { text: "Evidence stored in SQLite. Trigger evaluation unavailable." };
  }

  bridge.event.emitEvent("audit.submit", source, {
    tier: trigger.tier,
    score: trigger.score,
    mode: trigger.mode,
    changedFiles,
  });

  if (trigger.mode === "skip") {
    return { text: `Evidence stored. ${trigger.tier} skip (score: ${trigger.score.toFixed(2)}) — audit not needed.` };
  }

  // Trigger audit
  const auditScript = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "audit", "index.mjs");
  if (existsSync(auditScript)) {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [auditScript], {
      stdio: "inherit", cwd: repoRoot, windowsHide: true,
    });
    return { text: `Evidence stored. ${trigger.tier} ${trigger.mode} (score: ${trigger.score.toFixed(2)}). Audit ${result.status === 0 ? "completed" : "failed"}.` };
  }

  return { text: `Evidence stored. ${trigger.tier} ${trigger.mode} (score: ${trigger.score.toFixed(2)}). Audit module not found.` };
}
