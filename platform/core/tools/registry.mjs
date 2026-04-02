/**
 * registry.mjs — Tool Registry for all quorum MCP tools.
 *
 * Single source of truth for tool metadata (schemas), dispatch, and
 * category-based lookup. Replaces the inline TOOLS array and if/else
 * dispatch chain from mcp-server.mjs.
 *
 * Consumers:
 *   - mcp-server.mjs  (tools/list + tools/call)
 *   - tool-runner.mjs  (CLI dispatch)
 *   - tool-capabilities.mjs (capability overlay)
 *
 * @module core/tools/registry
 */
// Individual tool imports (bypassing tool-core.mjs shim)
import { toolCodeMap } from "./code-map/index.mjs";
import { toolAuditScan } from "./audit-scan/index.mjs";
import { toolCoverageMap } from "./coverage-map/index.mjs";
import { toolDependencyGraph } from "./dependency-graph/index.mjs";
import { toolBlastRadius } from "./blast-radius/index.mjs";
import { toolRtmParse } from "./rtm-parse/index.mjs";
import { toolRtmMerge } from "./rtm-merge/index.mjs";
import { toolAuditHistory } from "./audit-history/index.mjs";
import { toolActAnalyze } from "./act-analyze/index.mjs";
import { toolPerfScan } from "./perf-scan/index.mjs";
import { toolCompatCheck } from "./compat-check/index.mjs";
import { toolA11yScan } from "./a11y-scan/index.mjs";
import { toolLicenseScan } from "./license-scan/index.mjs";
import { toolI18nValidate } from "./i18n-validate/index.mjs";
import { toolInfraScan } from "./infra-scan/index.mjs";
import { toolObservabilityCheck } from "./observability-check/index.mjs";
import { toolDocCoverage } from "./doc-coverage/index.mjs";
import { toolBlueprintLint } from "./blueprint-lint/index.mjs";
import { toolAiGuide } from "./ai-guide/index.mjs";
import { toolAgentComm } from "./agent-comm/index.mjs";
import { toolAuditSubmit } from "./audit-submit/index.mjs";
import { toolSkillSync } from "./skill-sync/index.mjs";
import { toolTrackArchive } from "./track-archive/index.mjs";

// ═══ Lazy-loaded heavy tools ════════════════════════════════════════════
// Loaded on first execute() call to avoid upfront cost (~800 lines combined)
let _generateFvm = null;
let _runFvmValidation = null;
let _toolContractDrift = null;

async function lazyGenerateFvm(args) {
  if (!_generateFvm) {
    const mod = await import("./fvm-generator.mjs");
    _generateFvm = mod.generateFvm;
  }
  return _generateFvm(args.path, args.format);
}

async function lazyRunFvmValidation(args) {
  if (!_runFvmValidation) {
    const mod = await import("./fvm-validator.mjs");
    _runFvmValidation = mod.runFvmValidation;
  }
  return _runFvmValidation(args);
}

async function lazyToolContractDrift(args) {
  if (!_toolContractDrift) {
    const mod = await import("./contract-drift/index.mjs");
    _toolContractDrift = mod.toolContractDrift;
  }
  return _toolContractDrift(args);
}

// ═══ Tool name registry ══════════════════════════════════════════════════

export const TOOL_NAMES = [
  "code_map", "audit_scan", "coverage_map",
  "dependency_graph", "blast_radius", "rtm_parse", "rtm_merge",
  "audit_history", "fvm_generate", "fvm_validate",
  "act_analyze",
  // Specialist domain tools
  "perf_scan", "compat_check", "a11y_scan", "license_scan",
  "i18n_validate", "infra_scan", "observability_check", "doc_coverage",
  // Enforcement tools
  "blueprint_lint", "contract_drift",
  // Synthesis tools
  "ai_guide",
  // Agent communication / lifecycle
  "agent_comm", "audit_submit", "skill_sync", "track_archive",
];

// ═══ Tool definitions ════════════════════════════════════════════════════
//
// Each entry: { name, description, inputSchema, execute, async?, category }
// Schemas are preserved exactly from the original mcp-server.mjs TOOLS array.

/** @type {Array<{name: string, description: string, inputSchema: object, execute: Function, async?: boolean, category?: string}>} */
const TOOLS = [
  // ── Analysis ───────────────────────────────────────────
  {
    name: "code_map",
    description: "Generate a cached, matrix-formatted symbol index for a directory or file. Returns function/class/type declarations with line ranges, grouped by file. Results are cached — repeated calls for unchanged files cost zero. Use before Read to know exactly which lines to target.",
    inputSchema: {
      type: "object",
      properties: {
        path:       { type: "string", description: "File or directory path to scan" },
        filter:     { type: "string", description: "Comma-separated types: fn, method, class, iface, type, enum, import" },
        depth:      { type: "number", description: "Max directory depth (default: 5)" },
        extensions: { type: "string", description: "File extensions (default: .ts,.tsx,.js,.jsx,.mjs,.mts)" },
        format:     { type: "string", enum: ["detail", "matrix"], description: "Output format: detail (grouped symbols) or matrix (overview table with counts)" },
      },
      required: ["path"],
    },
    execute: (args) => toolCodeMap(args),
    category: "analysis",
  },
  {
    name: "audit_scan",
    description: "Run zero-token pattern scan. Detects type-safety issues (as any, @ts-ignore), hardcoded strings, console.log, and other anti-patterns.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Scan pattern: all, type-safety, hardcoded, console" },
        path:    { type: "string", description: "Target path to scan" },
      },
    },
    execute: (args) => toolAuditScan(args),
    category: "analysis",
  },
  {
    name: "coverage_map",
    description: "Map test coverage data to files. Returns per-file statement/branch/function/line percentages from vitest coverage JSON. Use after running `npm run test:coverage` to fill RTM Coverage columns.",
    inputSchema: {
      type: "object",
      properties: {
        path:         { type: "string", description: "Filter to files under this path (e.g., src/evals/)" },
        coverage_dir: { type: "string", description: "Coverage output directory (default: coverage/)" },
      },
    },
    execute: (args) => toolCoverageMap(args),
    category: "analysis",
  },
  {
    name: "dependency_graph",
    description: "Build a cached import/export dependency graph for a directory. Returns connected components (natural work boundaries), topological order (safe execution sequence), dependency table (imports/imported-by per file), and cycle detection. Use for work decomposition — components that share no edges can be assigned to parallel workers.",
    inputSchema: {
      type: "object",
      properties: {
        path:       { type: "string", description: "Directory or file to analyze" },
        depth:      { type: "number", description: "Max directory depth (default: 5)" },
        extensions: { type: "string", description: "File extensions (default: .ts,.tsx,.js,.jsx,.mjs,.mts)" },
      },
      required: ["path"],
    },
    execute: (args) => toolDependencyGraph(args),
    category: "analysis",
  },
  {
    name: "blast_radius",
    description: "Compute transitive impact of changed files via reverse import graph (BFS on inEdges). Returns affected file count, ratio, and per-file depth/via chain. Use before audit to assess change scope, or during planning to estimate risk.",
    inputSchema: {
      type: "object",
      properties: {
        changed_files: { type: "array", items: { type: "string" }, description: "Files that changed (relative paths)" },
        path:          { type: "string", description: "Repository root (default: cwd)" },
        max_depth:     { type: "number", description: "BFS depth limit (default: 10)" },
      },
      required: ["changed_files"],
    },
    execute: (args) => toolBlastRadius(args),
    category: "analysis",
  },
  {
    name: "act_analyze",
    description: "PDCA Act phase — analyze audit history + FVM results to produce structured improvement items. Returns metrics (rejection rates, FP rates, FVM pass rates) and work-catalog-ready improvement items with priority, type, and target file. Use during retrospective to close the Plan-Do-Check-Act loop.",
    inputSchema: {
      type: "object",
      properties: {
        audit_history_path: { type: "string", description: "Path to audit-history.jsonl (default: .claude/audit-history.jsonl)" },
        fvm_results_path:   { type: "string", description: "Path to FVM validation results markdown" },
        track:              { type: "string", description: "Filter audit history by track name" },
        thresholds: {
          type: "object",
          description: "Override default thresholds (fp_rate_warn, repeat_rejection_warn, correction_rounds_warn, fvm_auth_leak_block, fvm_false_deny_warn)",
        },
      },
    },
    execute: (args) => toolActAnalyze(args),
    category: "analysis",
  },

  // ── RTM ────────────────────────────────────────────────
  {
    name: "rtm_parse",
    description: "Parse an RTM markdown file and return structured rows. Supports forward, backward, and bidirectional matrices. Filter by Req ID or status. Use to read RTM state, distribute rows to workers, or verify row updates.",
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string", description: "Path to RTM markdown file" },
        matrix: { type: "string", enum: ["forward", "backward", "bidirectional"], description: "Which matrix to parse (default: forward)" },
        req_id: { type: "string", description: "Filter rows by Req ID prefix (e.g., 'EV-1')" },
        status: { type: "string", description: "Filter rows by status (e.g., 'open', 'fixed', 'verified')" },
      },
      required: ["path"],
    },
    execute: (args) => toolRtmParse(args),
    category: "rtm",
  },
  {
    name: "rtm_merge",
    description: "Merge multiple worktree RTM files into a base RTM. Row-level merge by Req ID × File key. Detects conflicts (same row modified by two workers), applies non-conflicting updates, and appends discovered rows. Use after parallel workers complete, before squash merge.",
    inputSchema: {
      type: "object",
      properties: {
        base:    { type: "string", description: "Path to the base RTM file (main repo)" },
        updates: { type: "array", items: { type: "string" }, description: "Paths to worktree RTM files to merge" },
      },
      required: ["base", "updates"],
    },
    execute: (args) => toolRtmMerge(args),
    category: "rtm",
  },

  // ── FVM ────────────────────────────────────────────────
  {
    name: "fvm_generate",
    description: "Generate a Functional Verification Matrix by cross-referencing FE routes, API calls, BE endpoints, and access policies. Returns route-to-endpoint mappings with expected auth status per role. Zero-token static analysis — no LLM reasoning needed.",
    inputSchema: {
      type: "object",
      properties: {
        path:   { type: "string", description: "Project root directory (must contain web/src/ and src/dashboard/)" },
        format: { type: "string", enum: ["full", "mismatches", "matrix"], description: "Output scope: full (all sections), mismatches (FE/BE gaps only), matrix (verification rows only). Default: full" },
      },
      required: ["path"],
    },
    execute: (args) => lazyGenerateFvm(args),
    async: true,
    category: "fvm",
  },
  {
    name: "fvm_validate",
    description: "Execute FVM rows against a live server. Authenticates as each role, sends HTTP requests, compares actual vs expected status codes. Classifies failures as AUTH_LEAK (security), FALSE_DENY (bug), ENDPOINT_MISSING, or PARAM_ERROR.",
    inputSchema: {
      type: "object",
      properties: {
        fvm_path:     { type: "string", description: "Path to FVM markdown file (from fvm_generate)" },
        base_url:     { type: "string", description: "Live server base URL (e.g., http://localhost:4200)" },
        credentials: {
          type: "object",
          description: "Role -> {username, password} map for authentication",
          additionalProperties: {
            type: "object",
            properties: {
              username: { type: "string" },
              password: { type: "string" },
            },
          },
        },
        filter_role:  { type: "string", description: "Only validate rows for this role" },
        filter_route: { type: "string", description: "Only validate rows for this route" },
        timeout_ms:   { type: "number", description: "Per-request timeout in ms (default: 5000)" },
      },
      required: ["fvm_path", "base_url", "credentials"],
    },
    execute: (args) => lazyRunFvmValidation(args),
    async: true,
    category: "fvm",
  },

  // ── Domain ─────────────────────────────────────────────
  {
    name: "perf_scan",
    description: "Scan for performance anti-patterns: nested loops, sync I/O, unbounded queries, heavy imports. Zero-cost static analysis — no LLM needed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file to scan (default: cwd)" },
      },
    },
    execute: (args) => toolPerfScan(args),
    category: "domain",
  },
  {
    name: "compat_check",
    description: "Check for API breaking changes: deprecated annotations, CJS/ESM mixing, pending removals, wildcard dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file to check (default: cwd)" },
      },
    },
    execute: (args) => toolCompatCheck(args),
    category: "domain",
  },
  {
    name: "a11y_scan",
    description: "Scan JSX/TSX for accessibility issues: missing alt, onClick without keyboard, form labels, aria violations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file to scan (default: cwd)" },
      },
    },
    execute: (args) => toolA11yScan(args),
    category: "domain",
  },
  {
    name: "license_scan",
    description: "Check dependency licenses for copyleft/unknown risks and scan source for hardcoded secrets or PII patterns.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root to scan (default: cwd)" },
      },
    },
    execute: (args) => toolLicenseScan(args),
    category: "domain",
  },
  {
    name: "i18n_validate",
    description: "Validate i18n locale key parity across language files and detect hardcoded UI strings in JSX components.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root to scan (default: cwd)" },
      },
    },
    execute: (args) => toolI18nValidate(args),
    category: "domain",
  },
  {
    name: "infra_scan",
    description: "Scan infrastructure files (Dockerfile, CI configs, docker-compose) for security and reliability anti-patterns.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root to scan (default: cwd)" },
      },
    },
    execute: (args) => toolInfraScan(args),
    category: "domain",
  },
  {
    name: "observability_check",
    description: "Detect observability gaps: empty catch blocks, missing error logging, console.log in production, hard exits without cleanup.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file to scan (default: cwd)" },
      },
    },
    execute: (args) => toolObservabilityCheck(args),
    category: "domain",
  },
  {
    name: "doc_coverage",
    description: "Measure documentation coverage: percentage of exported symbols with JSDoc comments. Returns undocumented exports list.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file to scan (default: cwd)" },
      },
    },
    execute: (args) => toolDocCoverage(args),
    category: "domain",
  },

  // ── Governance ─────────────────────────────────────────
  {
    name: "blueprint_lint",
    description: "Check source code against Blueprint naming conventions. Parses naming tables from design/ markdown, scans source for violations.",
    inputSchema: {
      type: "object",
      properties: {
        design_dir: { type: "string", description: "Path to design directory with Blueprint markdown (default: docs/design)" },
        path: { type: "string", description: "Source directory or file to scan (default: cwd)" },
      },
    },
    execute: (args) => toolBlueprintLint(args),
    category: "governance",
  },
  {
    name: "contract_drift",
    description: "Detect contract drift between type definitions and implementations. Finds re-declarations, signature mismatches, and missing members. Uses TypeScript program mode for cross-file analysis. Contract directories default to paths containing /types/, /contracts/, /interfaces/.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root (default: cwd)" },
        tsconfig: { type: "string", description: "Path to tsconfig.json (default: auto-detect)" },
        contract_dirs: { type: "string", description: "Comma-separated contract directory patterns (default: /types/,/contracts/,/interfaces/)" },
      },
    },
    execute: (args) => lazyToolContractDrift(args),
    async: true,
    category: "governance",
  },
  {
    name: "audit_history",
    description: "Query the persistent audit history log. Returns verdict timeline, rejection code frequency, track distribution, and risk pattern detection. Use for cross-session quality analysis, identifying structural issues, and tracking improvement trends.",
    inputSchema: {
      type: "object",
      properties: {
        path:    { type: "string", description: "Path to audit-history.jsonl (default: .claude/audit-history.jsonl)" },
        track:   { type: "string", description: "Filter by track name" },
        code:    { type: "string", description: "Filter by rejection code" },
        since:   { type: "string", description: "ISO timestamp — only entries after this time" },
        summary: { type: "boolean", description: "If true, return aggregate statistics instead of detail rows" },
      },
    },
    execute: (args) => toolAuditHistory(args),
    category: "governance",
  },

  // ── Agent ──────────────────────────────────────────────
  {
    name: "agent_comm",
    description: "Inter-agent communication: post queries, read responses, poll for incoming queries, list active agents",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["post", "respond", "poll", "responses", "roster"], description: "post=send query, respond=answer, poll=check inbox, responses=get answers, roster=list agents" },
        agent_id: { type: "string", description: "Your agent ID (e.g. impl-INT-2)" },
        to_agent: { type: "string", description: "(post) Target agent, omit for broadcast" },
        question: { type: "string", description: "(post) Question text" },
        query_id: { type: "string", description: "(respond/responses) Query ID" },
        answer: { type: "string", description: "(respond) Answer text" },
        confidence: { type: "number", description: "(respond) Confidence 0.0-1.0" },
        context: { type: "object", description: "(post) Additional context" },
        track_id: { type: "string", description: "(roster) Track name" },
      },
      required: ["action", "agent_id"],
    },
    execute: (args) => toolAgentComm(args),
    async: true,
    category: "agent",
  },
  {
    name: "audit_submit",
    description: "Submit evidence for audit review. Stores evidence in SQLite, evaluates trigger, and runs audit if threshold is met.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: { type: "string", description: "Full evidence text (markdown with ### Claim, ### Changed Files, ### Test Command, ### Test Result sections)" },
        changed_files: { type: "array", items: { type: "string" }, description: "List of changed file paths" },
        source: { type: "string", description: "Provider name (default: claude-code)" },
      },
      required: ["evidence"],
    },
    execute: (args) => toolAuditSubmit(args),
    async: true,
    category: "agent",
  },
  {
    name: "ai_guide",
    description: "Generate project onboarding guide by synthesizing code_map + dependency_graph + doc_coverage",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Directory to analyze" },
      },
      required: ["target"],
    },
    execute: (args) => toolAiGuide(args),
    category: "agent",
  },
  {
    name: "skill_sync",
    description: "Detect and fix mismatches between canonical skills (skills/) and adapter wrappers (adapters/*/skills/). Reports missing wrappers, outdated descriptions, and sync status. Use mode='fix' to auto-generate missing wrappers and update descriptions.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["check", "fix"], description: "check (default): report only. fix: create missing wrappers and update outdated descriptions." },
        path: { type: "string", description: "Repository root (default: cwd)" },
      },
    },
    execute: (args) => toolSkillSync(args),
    category: "agent",
  },
  {
    name: "track_archive",
    description: "Archive completed track planning artifacts (PRD, DRM, WB, RTM, design docs, wave state, handoff) to .claude/quorum/archive/{date}/{track}/. Writes a manifest.json summary. Use after track completion and retrospective.",
    inputSchema: {
      type: "object",
      properties: {
        track:   { type: "string", description: "Track name to archive" },
        path:    { type: "string", description: "Repository root (default: cwd)" },
        dry_run: { type: "boolean", description: "If true, report what would be archived without moving files (default: false)" },
      },
      required: ["track"],
    },
    execute: (args) => toolTrackArchive(args),
    category: "agent",
  },
];

// ═══ Lookup indexes ══════════════════════════════════════════════════════

/** @type {Map<string, typeof TOOLS[0]>} */
const _byName = new Map(TOOLS.map(t => [t.name, t]));

/** @type {Map<string, typeof TOOLS[0][]>} */
const _byCategory = new Map();
for (const t of TOOLS) {
  const cat = t.category || "uncategorized";
  if (!_byCategory.has(cat)) _byCategory.set(cat, []);
  _byCategory.get(cat).push(t);
}

// ═══ Public API ══════════════════════════════════════════════════════════

/**
 * Get all registered tool definitions.
 * @returns {Array<{name: string, description: string, inputSchema: object, execute: Function, async?: boolean, category?: string}>}
 */
export function getAllTools() {
  return TOOLS;
}

/**
 * Get a single tool by name.
 * @param {string} name
 * @returns {typeof TOOLS[0] | undefined}
 */
export function getTool(name) {
  return _byName.get(name);
}

/**
 * Get tools by category.
 * @param {string} category - e.g. "analysis", "domain", "governance", "agent"
 * @returns {Array<typeof TOOLS[0]>}
 */
export function getToolsByCategory(category) {
  return _byCategory.get(category) || [];
}

/**
 * Execute a tool by name.
 * @param {string} name
 * @param {object} [args={}]
 * @returns {Promise<{text?: string, summary?: string, error?: string, json?: any}>}
 */
export async function executeTool(name, args = {}) {
  const tool = _byName.get(name);
  if (!tool) {
    return { error: `Unknown tool: ${name}` };
  }
  try {
    const result = tool.async ? await tool.execute(args) : tool.execute(args);
    return result;
  } catch (err) {
    return { error: `Tool ${name} failed: ${err?.message ?? err}` };
  }
}
