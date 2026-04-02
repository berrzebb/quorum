/**
 * Shared audit trigger pipeline — bridge init → trigger eval → parliament → spawn gate.
 *
 * Extracted from codex/after-tool-use.mjs and gemini/after-tool.mjs to eliminate
 * the copy-pasted 50-line bridge orchestration block.
 *
 * Adapter-specific output (JSON vs plain text) is handled via the returned result.
 *
 * @param {object} params
 * @param {string} params.repoRoot — absolute path to repo root
 * @param {object} params.cfg — full config object
 * @param {string} params.content — evidence content (from SQLite or direct submission)
 * @param {string} params.source — provider name ("codex" | "gemini")
 * @param {function} [params.log] — debug logger
 * @returns {Promise<{ triggerResult: object|null, spawnAllowed: boolean, bridge: object|null }>}
 */

import { parseChangedFiles, buildTriggerContext, hasPlanDocuments } from "./trigger-runner.mjs";
import { runParliamentIfEnabled } from "./parliament-runner.mjs";

export async function evaluateAuditTrigger({ repoRoot, cfg, content, source, log = () => {} }) {
  const consensus = cfg.consensus ?? {};

  // 1. Bridge init
  let bridge;
  try {
    bridge = await import("../../core/bridge.mjs");
    await bridge.init(repoRoot);
    await bridge.hooks.initHookRunner(repoRoot, cfg.hooks);
  } catch (err) {
    log(`BRIDGE_INIT_FAIL: ${err.message}`);
    return { triggerResult: null, spawnAllowed: true, bridge: null };
  }

  // 2. Pre-audit hook gate
  const preGate = await bridge.hooks.checkHookGate("audit.submit", {
    cwd: repoRoot, metadata: { provider: source },
  });
  if (!preGate.allowed) {
    log(`HOOK_DENY: ${preGate.reason}`);
    bridge.close();
    return { triggerResult: null, spawnAllowed: false, bridge: null, denyReason: preGate.reason };
  }

  // 3. Domain detection + blast radius (parallel)
  const changedFiles = parseChangedFiles(content);
  const changedFileCount = changedFiles.length;

  const [detectionResult, blastResult] = await Promise.all([
    bridge.domain.detectDomains(changedFiles, content).catch(() => null),
    changedFiles.length > 0
      ? bridge.gate.computeBlastRadius(changedFiles).catch(() => null)
      : null,
  ]);
  const blastRadius = blastResult?.ratio;
  const priorRejections = (bridge.event.queryEvents?.({ eventType: "audit.verdict", limit: 50, descending: true }) ?? [])
    .filter((e) => e.payload?.verdict === "changes_requested").length;
  const hasPlanDoc = hasPlanDocuments(repoRoot);

  // 4. Evaluate trigger
  const triggerCtx = buildTriggerContext({
    content, changedFiles, changedFileCount, detectionResult, priorRejections, hasPlanDoc, blastRadius,
  });

  const triggerResult = bridge.gate.evaluateTrigger(triggerCtx);
  if (triggerResult) {
    log(`TRIGGER: mode=${triggerResult.mode} tier=${triggerResult.tier} score=${triggerResult.score.toFixed(2)}`);
    bridge.event.emitEvent("audit.submit", source, {
      tier: triggerResult.tier, mode: triggerResult.mode, score: triggerResult.score,
    });

    // Parliament session: T3 deliberative + parliament.enabled
    if (triggerResult.mode === "deliberative") {
      await runParliamentIfEnabled(bridge, cfg, content, source, undefined, log);
    }
  }

  // 5. Spawn gate
  const spawnGate = await bridge.hooks.checkHookGate("audit.spawn", {
    cwd: repoRoot, metadata: { provider: source },
  });
  bridge.close();

  if (!spawnGate.allowed) {
    log(`HOOK_DENY: audit.spawn blocked — ${spawnGate.reason}`);
    return { triggerResult, spawnAllowed: false, bridge: null };
  }

  return { triggerResult, spawnAllowed: true, bridge: null };
}
