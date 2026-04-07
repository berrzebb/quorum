/**
 * quorum steer — switch gate profile from CLI.
 *
 * Usage:
 *   quorum steer <profile>   Set profile (strict|balanced|fast|prototype)
 *   quorum steer             Show current profile
 *
 * Mirrors the intent-detection steering from UserPromptSubmit hook,
 * but as an explicit CLI command for daemon/script use.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VALID_PROFILES = ["strict", "balanced", "fast", "prototype"] as const;
type GateProfile = typeof VALID_PROFILES[number];

const PROFILE_LABELS: Record<GateProfile, string> = {
  strict:    "엄격 — T3 deliberative, push 차단",
  balanced:  "균형 — T2 simple, push 경고",
  fast:      "빠름 — T1 skip, 최소 검증",
  prototype: "실험 — T1 skip, CQ만 검증",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUORUM_PKG_ROOT = resolve(__dirname, "..", "..", "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");

  if (!existsSync(configPath)) {
    console.error("\x1b[31m✗\x1b[0m config.json not found — run `quorum setup` first.");
    process.exitCode = 1;
    return;
  }

  let cfg: Record<string, any>;
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    console.error("\x1b[31m✗\x1b[0m config.json parse error.");
    process.exitCode = 1;
    return;
  }

  const currentProfile: GateProfile = cfg.gates?.gateProfile ?? "balanced";

  // No argument → show current
  const target = args[0]?.toLowerCase();
  if (!target) {
    console.log(`\n\x1b[36mquorum steer\x1b[0m — gate profile\n`);
    for (const p of VALID_PROFILES) {
      const marker = p === currentProfile ? "\x1b[32m▶\x1b[0m" : " ";
      console.log(`  ${marker} \x1b[1m${p}\x1b[0m — ${PROFILE_LABELS[p]}`);
    }
    console.log(`\n  Usage: quorum steer <profile>\n`);
    return;
  }

  // Validate
  if (!VALID_PROFILES.includes(target as GateProfile)) {
    console.error(`\x1b[31m✗\x1b[0m Unknown profile "${target}". Valid: ${VALID_PROFILES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const newProfile = target as GateProfile;

  // No-op if same
  if (newProfile === currentProfile) {
    console.log(`\x1b[36m◈\x1b[0m Already on "${newProfile}" — ${PROFILE_LABELS[newProfile]}`);
    return;
  }

  // Update config
  if (!cfg.gates) cfg.gates = {};
  cfg.gates.gateProfile = newProfile;
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");

  // Emit steering.switch event to EventStore
  try {
    const bridgePath = pathToFileURL(resolve(QUORUM_PKG_ROOT, "platform", "core", "bridge.mjs")).href;
    const bridge = await import(bridgePath);
    await bridge.init(repoRoot);
    bridge.event.emitEvent("steering.switch", "generic", {
      from: currentProfile,
      to: newProfile,
      trigger: `cli: quorum steer ${newProfile}`,
    });
    bridge.close();
  } catch {
    // fail-open: config was already written
  }

  console.log(`\x1b[32m✓\x1b[0m ${currentProfile} → \x1b[1m${newProfile}\x1b[0m — ${PROFILE_LABELS[newProfile]}`);
}
