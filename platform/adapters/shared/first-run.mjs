/**
 * Shared first-run setup — copies example config to project directory.
 *
 * Templates are NOT copied — resolvePluginPath() fallback chain provides
 * core/templates/ as the default. Users only create override files when customizing.
 */

import { existsSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Run first-time setup: copy example config to project directory.
 *
 * @param {object} params
 * @param {string} params.adapterRoot — adapter root (CLAUDE_PLUGIN_ROOT or equivalent)
 * @param {string} params.projectConfigDir — target directory (e.g. REPO_ROOT/.claude/quorum/)
 * @returns {{ copied: string[], projectConfigDir: string, needsManualSetup: boolean }}
 */
export function firstRunSetup({ adapterRoot, projectConfigDir }) {
  const exampleConfig = resolve(adapterRoot, "examples", "config.example.json");
  const configDest = resolve(projectConfigDir, "config.json");

  const copied = [];

  // config.json → project directory (survives plugin updates)
  // Only copy if config.json does NOT already exist — never overwrite user customizations.
  if (!existsSync(configDest) && existsSync(exampleConfig)) {
    try {
      mkdirSync(projectConfigDir, { recursive: true });
      cpSync(exampleConfig, configDest);
      copied.push("config.json");
    } catch (err) { console.warn(`[first-run] config copy failed: ${err?.message}`); }
  }

  // If examples/ directory is missing entirely
  const needsManualSetup = copied.length === 0 && !existsSync(exampleConfig);

  return { copied, projectConfigDir, needsManualSetup };
}

/**
 * Build first-run guidance message.
 *
 * @param {object} result — return value from firstRunSetup()
 * @param {string} readmePath — path to README.md for reference
 * @returns {string|null} Guidance message or null if no setup occurred
 */
export function buildFirstRunMessage(result, readmePath) {
  if (result.copied.length > 0) {
    return [
      `[quorum — First-Run Setup Complete]`,
      ``,
      `Auto-copied: ${result.copied.join(", ")}`,
      `Location: ${result.projectConfigDir}`,
      `(Project-scoped — safe across plugin updates)`,
      ``,
      `Customize for your project:`,
      `- config.json → consensus.trigger_tag/agree_tag/pending_tag, quality_rules`,
      ``,
      `Full guide: ${readmePath}`,
    ].join("\n");
  }

  if (result.needsManualSetup) {
    return [
      `[SETUP REQUIRED — quorum]`,
      ``,
      `config.json not found and examples/ directory is missing.`,
      `Reinstall the plugin or manually create config.json.`,
      `See: https://github.com/berrzebb/quorum`,
    ].join("\n");
  }

  return null;
}
