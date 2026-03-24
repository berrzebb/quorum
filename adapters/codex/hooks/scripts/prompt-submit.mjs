#!/usr/bin/env node
/**
 * Codex CLI Hook: UserPromptSubmit — status signals + prompt gating.
 */
import { createHookContext, readStdinJson, withBridge } from "../../../shared/hook-io.mjs";
import { buildStatusSignals } from "../../../shared/audit-state.mjs";

const { REPO_ROOT, ADAPTER_DIR, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

const input = await readStdinJson();
const signals = buildStatusSignals({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR, cfg });

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  const gate = await bridge.checkHookGate("prompt.submit", {
    session_id: input.session_id, cwd: REPO_ROOT,
    metadata: { provider: "codex", prompt: input.prompt?.slice(0, 200) },
  });
  if (!gate.allowed) {
    process.stderr.write(`[quorum] Prompt blocked: ${gate.reason}\n`);
    process.exit(2);
  }
});

if (signals.length > 0) {
  process.stdout.write(`[quorum status] ${signals.join(" | ")}\n`);
}
