#!/usr/bin/env node
/**
 * Facade — main implementation at platform/core/context.mjs
 *
 * All exports are re-exported unchanged. No import paths in consumers need updating.
 */

// ── Paths ──
export {
  HOOKS_DIR,
  QUORUM_ROOT,
  REPO_ROOT,
  PROJECT_CONFIG_DIR,
} from "../platform/core/context.mjs";

// ── Config ──
export {
  configMissing,
  cfg,
  plugin,
  consensus,
  refreshConfigIfChanged,
} from "../platform/core/context.mjs";

// ── Path resolvers ──
export {
  resolvePluginPath,
  resolveReferencesDir,
} from "../platform/core/context.mjs";

// ── Hook toggles ──
export { isHookEnabled } from "../platform/core/context.mjs";

// ── Locale ──
export { safeLocale, createT, t } from "../platform/core/context.mjs";

// ── Section / tag constants ──
export {
  SEC,
  DOC_PATTERNS,
  escapeRe,
  triggerInner,
  agreeInner,
  pendingInner,
  STATUS_TAG_RE,
  STATUS_TAG_RE_GLOBAL,
} from "../platform/core/context.mjs";

// ── Markdown parser ──
export {
  extractStatusFromLine,
  readSection,
  replaceSection,
  removeSection,
  parseStatusLines,
  stripStatusFormatting,
  replaceStatusTag,
  collectIdsFromLine,
  readBulletSection,
  isEmptyMarker,
} from "../platform/core/context.mjs";

// ── ID extraction ──
export {
  extractApprovedIds,
  extractPendingIds,
  extractApprovedIdsFromSection,
  mergeIdSets,
} from "../platform/core/context.mjs";

// ── JSONL ──
export { readJsonlFile } from "../platform/core/context.mjs";
