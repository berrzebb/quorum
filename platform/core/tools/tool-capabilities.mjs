/**
 * Tool Capability Registry — canonical metadata for all quorum MCP tools.
 *
 * Adopted from Claude Code Tool.ts patterns:
 * - isConcurrencySafe: can this tool run in parallel with others?
 * - isReadOnly: does this tool modify any state?
 * - isDestructive: does this tool delete or overwrite?
 * - shouldDefer: should this tool be hidden until ToolSearch discovers it?
 * - alwaysLoad: must this tool always appear in the initial prompt?
 * - searchHint: keyword hints for ToolSearch deferred discovery
 * - domain: which quorum domain(s) this tool serves
 * - allowedRoles: which orchestrator roles may invoke this tool
 * - maxResultSizeChars: threshold for persisting output to disk
 *
 * This is the SINGLE SOURCE OF TRUTH for tool policy.
 * mcp-server, sdk-tool-bridge, permissions, approval gate, and
 * ParallelPlanner all consume this registry.
 *
 * @module core/tools/tool-capabilities
 */

// ── Role sets ───────────────────────────────────────────

const ALL_ROLES = ["implementer", "self-checker", "fixer", "scout", "designer", "gap-detector", "wb-parser", "rtm-scanner", "fde-analyst"];
const READ_ROLES = ALL_ROLES;
const CHECK_ROLES = ["self-checker", "fixer", "scout", "gap-detector"];
const PLAN_ROLES = ["scout", "designer", "wb-parser", "fde-analyst"];
const IMPL_ROLES = ["implementer", "fixer"];

// ── Tool capability entries ─────────────────────────────

/**
 * @typedef {Object} ToolCapability
 * @property {string} name — canonical tool name (matches MCP server)
 * @property {boolean} isConcurrencySafe — safe to run in parallel
 * @property {boolean} isReadOnly — does not modify filesystem/state
 * @property {boolean} isDestructive — deletes/overwrites data
 * @property {boolean} [shouldDefer] — hidden until ToolSearch
 * @property {boolean} [alwaysLoad] — always in initial prompt
 * @property {string} [searchHint] — keywords for ToolSearch
 * @property {string[]} domain — quorum domains served
 * @property {string[]} allowedRoles — orchestrator roles allowed
 * @property {number} maxResultSizeChars — output disk-persist threshold
 * @property {string} category — tool functional category
 */

/** @type {ToolCapability[]} */
export const TOOL_CAPABILITIES = Object.freeze([
  // ── Always-loaded core tools (analysis) ──────────────

  {
    name: "code_map",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: "symbol index function class type enum scan",
    domain: [],
    allowedRoles: READ_ROLES,
    maxResultSizeChars: 50_000,
    category: "analysis",
  },
  {
    name: "blast_radius",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: "dependency impact transitive import reverse graph",
    domain: [],
    allowedRoles: READ_ROLES,
    maxResultSizeChars: 30_000,
    category: "analysis",
  },
  {
    name: "dependency_graph",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: "import export DAG cycle topological component",
    domain: [],
    allowedRoles: READ_ROLES,
    maxResultSizeChars: 50_000,
    category: "analysis",
  },
  {
    name: "audit_scan",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: "pattern type-safety console hardcoded anti-pattern lint",
    domain: [],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 30_000,
    category: "scanning",
  },
  {
    name: "audit_submit",
    isConcurrencySafe: false,
    isReadOnly: false,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: "evidence review trigger audit verdict",
    domain: [],
    allowedRoles: ALL_ROLES,
    maxResultSizeChars: 10_000,
    category: "lifecycle",
  },

  // ── Deferred domain tools ────────────────────────────

  {
    name: "perf_scan",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "performance N+1 hot-path bundle size memory leak",
    domain: ["perf"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 30_000,
    category: "scanning",
  },
  {
    name: "a11y_scan",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "accessibility WCAG aria label contrast screen-reader",
    domain: ["a11y"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "compat_check",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "browser compatibility polyfill caniuse cross-browser",
    domain: ["compat"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "i18n_validate",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "internationalization locale translation key missing",
    domain: ["i18n"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "infra_scan",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "infrastructure docker kubernetes terraform CI CD pipeline",
    domain: ["infra"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "observability_check",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "logging metrics tracing telemetry monitoring",
    domain: ["observability"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "license_scan",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "license SPDX GPL MIT Apache compliance OSS",
    domain: ["compliance"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 15_000,
    category: "scanning",
  },
  {
    name: "doc_coverage",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "documentation JSDoc coverage readme changelog API docs",
    domain: ["docs"],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "blueprint_lint",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "naming convention PascalCase camelCase blueprint design",
    domain: [],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 15_000,
    category: "scanning",
  },
  {
    name: "contract_drift",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "contract API drift breaking change interface mismatch",
    domain: [],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "scanning",
  },
  {
    name: "coverage_map",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "test coverage vitest per-file percentage",
    domain: [],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 30_000,
    category: "analysis",
  },

  // ── RTM / FVM matrix tools ───────────────────────────

  {
    name: "rtm_parse",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "requirements traceability matrix RTM parse row",
    domain: [],
    allowedRoles: PLAN_ROLES,
    maxResultSizeChars: 30_000,
    category: "matrix",
  },
  {
    name: "rtm_merge",
    isConcurrencySafe: false,
    isReadOnly: false,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "RTM merge worktree requirement row reconcile",
    domain: [],
    allowedRoles: PLAN_ROLES,
    maxResultSizeChars: 30_000,
    category: "matrix",
  },
  {
    name: "fvm_generate",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "FVM feature verification matrix route API endpoint",
    domain: [],
    allowedRoles: PLAN_ROLES,
    maxResultSizeChars: 30_000,
    category: "matrix",
  },
  {
    name: "fvm_validate",
    isConcurrencySafe: false,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "FVM validate HTTP runner live server endpoint test",
    domain: [],
    allowedRoles: CHECK_ROLES,
    maxResultSizeChars: 20_000,
    category: "matrix",
  },

  // ── Coordination / lifecycle tools ───────────────────

  {
    name: "audit_history",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "audit history verdict past rejection pattern",
    domain: [],
    allowedRoles: READ_ROLES,
    maxResultSizeChars: 20_000,
    category: "lifecycle",
  },
  {
    name: "ai_guide",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "guide help explain rule why convention pattern",
    domain: [],
    allowedRoles: ALL_ROLES,
    maxResultSizeChars: 15_000,
    category: "synthesis",
  },
  {
    name: "agent_comm",
    isConcurrencySafe: false,
    isReadOnly: false,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "agent communicate message finding submit acknowledge",
    domain: [],
    allowedRoles: ALL_ROLES,
    maxResultSizeChars: 10_000,
    category: "coordination",
  },
  {
    name: "skill_sync",
    isConcurrencySafe: false,
    isReadOnly: false,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "skill sync adapter wrapper generate protocol",
    domain: [],
    allowedRoles: PLAN_ROLES,
    maxResultSizeChars: 15_000,
    category: "coordination",
  },
  {
    name: "track_archive",
    isConcurrencySafe: false,
    isReadOnly: false,
    isDestructive: true,
    shouldDefer: true,
    searchHint: "track archive complete close finalize cleanup",
    domain: [],
    allowedRoles: PLAN_ROLES,
    maxResultSizeChars: 5_000,
    category: "lifecycle",
  },
  {
    name: "act_analyze",
    isConcurrencySafe: true,
    isReadOnly: true,
    isDestructive: false,
    shouldDefer: true,
    searchHint: "PDCA act analyze retrospective improvement pattern",
    domain: [],
    allowedRoles: READ_ROLES,
    maxResultSizeChars: 15_000,
    category: "pdca",
  },
]);

// ── Lookup helpers ──────────────────────────────────────

/** @type {Map<string, ToolCapability>} */
const _byName = new Map(TOOL_CAPABILITIES.map(t => [t.name, t]));

/**
 * Get capability metadata for a tool by name.
 * @param {string} name
 * @returns {ToolCapability | undefined}
 */
export function getCapability(name) {
  return _byName.get(name);
}

/**
 * Check if a tool is concurrency-safe (can run in parallel).
 * Unknown tools are assumed NOT safe (fail-closed).
 * @param {string} name
 * @returns {boolean}
 */
export function isConcurrencySafe(name) {
  return _byName.get(name)?.isConcurrencySafe ?? false;
}

/**
 * Check if a tool is read-only (does not modify state).
 * Unknown tools are assumed NOT read-only (fail-closed).
 * @param {string} name
 * @returns {boolean}
 */
export function isReadOnly(name) {
  return _byName.get(name)?.isReadOnly ?? false;
}

/**
 * Check if a tool is destructive (deletes/overwrites).
 * Unknown tools are assumed NOT destructive.
 * @param {string} name
 * @returns {boolean}
 */
export function isDestructive(name) {
  return _byName.get(name)?.isDestructive ?? false;
}

/**
 * Check if a tool should be deferred (hidden until ToolSearch).
 * @param {string} name
 * @returns {boolean}
 */
export function shouldDefer(name) {
  return _byName.get(name)?.shouldDefer ?? false;
}

/**
 * Check if a tool must always be loaded in the prompt.
 * @param {string} name
 * @returns {boolean}
 */
export function alwaysLoad(name) {
  return _byName.get(name)?.alwaysLoad ?? false;
}

/**
 * Get tools allowed for a specific orchestrator role.
 * @param {string} role
 * @returns {ToolCapability[]}
 */
export function toolsForRole(role) {
  return TOOL_CAPABILITIES.filter(t => t.allowedRoles.includes(role));
}

/**
 * Get tools for a detected domain.
 * Returns tools that serve the domain OR have no domain restriction.
 * @param {string} domain
 * @returns {ToolCapability[]}
 */
export function toolsForDomain(domain) {
  return TOOL_CAPABILITIES.filter(
    t => t.domain.length === 0 || t.domain.includes(domain),
  );
}

/**
 * Get tools that should always be loaded (not deferred).
 * @returns {ToolCapability[]}
 */
export function alwaysLoadTools() {
  return TOOL_CAPABILITIES.filter(t => t.alwaysLoad);
}

/**
 * Get deferred tools — available only via ToolSearch.
 * @returns {ToolCapability[]}
 */
export function deferredTools() {
  return TOOL_CAPABILITIES.filter(t => t.shouldDefer);
}

/**
 * Search deferred tools by keyword (for ToolSearch pattern).
 * @param {string} query — space-separated keywords
 * @param {number} [maxResults=5]
 * @returns {ToolCapability[]}
 */
export function searchTools(query, maxResults = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored = TOOL_CAPABILITIES
    .filter(t => t.shouldDefer && t.searchHint)
    .map(t => {
      const hint = (t.searchHint + " " + t.name + " " + t.domain.join(" ")).toLowerCase();
      const score = terms.reduce((sum, term) => sum + (hint.includes(term) ? 1 : 0), 0);
      return { tool: t, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map(s => s.tool);
}

/**
 * Get all tool names (for validation).
 * @returns {string[]}
 */
export function allToolNames() {
  return TOOL_CAPABILITIES.map(t => t.name);
}

/**
 * Validate that a tool name exists in the registry.
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownTool(name) {
  return _byName.has(name);
}
