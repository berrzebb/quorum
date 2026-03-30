#!/usr/bin/env node
/**
 * MCP Server — Exposes quorum deterministic scripts as native tools.
 *
 * Tools:
 *   code_map         — Zero-token symbol index with caching + matrix output
 *   dependency_graph — Import/export DAG, components, topological sort, cycles
 *   audit_scan       — Pattern scanner (type-safety, hardcoded, console, etc.)
 *   coverage_map     — Per-file coverage percentages from vitest JSON
 *   rtm_parse        — Parse RTM markdown → structured rows
 *   rtm_merge        — Row-level merge of worktree RTMs
 *   audit_history    — Query persistent audit history
 *   fvm_generate     — FE route × API × BE endpoint × access policy → FVM table
 *   fvm_validate     — HTTP runner: execute FVM rows against live server
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard)
 *
 * Configuration (.claude/settings.json or project settings):
 *   "mcpServers": {
 *     "quorum": {
 *       "command": "node",
 *       "args": [".claude/quorum/platform/core/tools/mcp-server.mjs"]
 *     }
 *   }
 *
 * Tool logic lives in tool-core.mjs (shared with tool-runner.mjs CLI).
 */
import { createInterface } from "node:readline";
import {
  toolCodeMap,
  toolAuditScan,
  toolCoverageMap,
  toolDependencyGraph,
  toolBlastRadius,
  toolRtmParse,
  toolRtmMerge,
  toolAuditHistory,
  generateFvm,
  runFvmValidation,
  toolActAnalyze,
  toolPerfScan,
  toolCompatCheck,
  toolA11yScan,
  toolLicenseScan,
  toolI18nValidate,
  toolInfraScan,
  toolObservabilityCheck,
  toolDocCoverage,
  toolBlueprintLint,
  toolAiGuide,
  toolSkillSync,
  toolTrackArchive,
} from "./tool-core.mjs";

// ═══ MCP Protocol ═══════════════════════════════════════════════════════

const SERVER_INFO = { name: "quorum", version: "0.4.5" };

const TOOLS = [
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
  },
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
  },
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
  },
  // ── Specialist domain tools ──────────────────
  {
    name: "perf_scan",
    description: "Scan for performance anti-patterns: nested loops, sync I/O, unbounded queries, heavy imports. Zero-cost static analysis — no LLM needed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file to scan (default: cwd)" },
      },
    },
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
  },
  // ── Enforcement tools ─────────────────
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
  },
  // ── Synthesis tools ──────────────────
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
  },
  // ── Agent communication ───────────
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
  },
  // ── Skill sync ──
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
  },
  // ── Track archive ──
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
  },
  // ── Evidence submission ──
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
  },
];

// ═══ Request handler ════════════════════════════════════════════════════

async function handleRequest(req) {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const { name, arguments: args } = req.params;

      if (name === "code_map") {
        const result = toolCodeMap(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        const tag = result.cached ? " [cached]" : "";
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary}${tag})` }] };
      }

      if (name === "audit_scan") {
        const result = toolAuditScan(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.stdout || result.error }], isError: true };
        }
        return { content: [{ type: "text", text: result.text }] };
      }

      if (name === "dependency_graph") {
        const result = toolDependencyGraph(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        const tag = result.cached ? " [cached]" : "";
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary}${tag})` }] };
      }

      if (name === "blast_radius") {
        const result = toolBlastRadius(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        const tag = result.cached ? " [cached]" : "";
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary}${tag})` }] };
      }

      if (name === "rtm_parse") {
        const result = toolRtmParse(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "rtm_merge") {
        const result = toolRtmMerge(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "audit_history") {
        const result = toolAuditHistory(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "coverage_map") {
        const result = toolCoverageMap(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "fvm_generate") {
        const result = generateFvm(args?.path, args?.format);
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "fvm_validate") {
        const result = await runFvmValidation(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: result.text + "\n\n(" + result.summary + ")" }] };
      }

      if (name === "act_analyze") {
        const result = toolActAnalyze(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "ai_guide") {
        const result = toolAiGuide(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "skill_sync") {
        const result = toolSkillSync(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "track_archive") {
        const result = toolTrackArchive(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      if (name === "agent_comm") {
        const { toolAgentComm } = await import("./tool-core.mjs");
        const result = await toolAgentComm(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: result.summary ? `${result.text}\n\n(${result.summary})` : result.text }] };
      }

      if (name === "audit_submit") {
        const { toolAuditSubmit } = await import("./tool-core.mjs");
        const result = await toolAuditSubmit(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: result.text }] };
      }

      if (name === "contract_drift") {
        const { toolContractDrift } = await import("./tool-core.mjs");
        const result = await toolContractDrift(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
      }

      // ── Specialist domain tools (unified handler pattern) ──
      const SPECIALIST_DISPATCH = {
        perf_scan: toolPerfScan,
        compat_check: toolCompatCheck,
        a11y_scan: toolA11yScan,
        license_scan: toolLicenseScan,
        i18n_validate: toolI18nValidate,
        infra_scan: toolInfraScan,
        observability_check: toolObservabilityCheck,
        doc_coverage: toolDocCoverage,
        blueprint_lint: toolBlueprintLint,
      };
      if (SPECIALIST_DISPATCH[name]) {
        const result = SPECIALIST_DISPATCH[name](args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary || ""})` }] };
      }

      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    default:
      return null;
  }
}

// ═══ stdio transport ════════════════════════════════════════════════════

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch (err) { console.warn("[mcp-server] JSON parse failed:", err?.message ?? err); return; }

  const result = await handleRequest(req);
  if (result === null || req.id === undefined) return;

  const response = { jsonrpc: "2.0", id: req.id };
  if (result.error?.code) {
    response.error = result.error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});

rl.on("close", () => process.exit(0));
