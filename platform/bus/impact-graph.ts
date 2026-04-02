/**
 * Impact Graph — unified view from 4 tool results.
 *
 * Calls blast_radius, dependency_graph, rtm_parse, coverage_map
 * and merges into a single ImpactGraph structure.
 * Optionally upserts affected entities/relations into the graph tables.
 *
 * @module bus/impact-graph
 */

import { addEntity, getEntity } from "./graph-schema.js";
import { addRelation, getRelations } from "./graph-relations.js";
import type { EntityType } from "./graph-schema.js";
import type { RelationType } from "./graph-relations.js";

// ── Types ────────────────────────────────────

export interface AffectedNode {
  id: string;
  type: 'file' | 'requirement' | 'test';
  impact: 'direct' | 'transitive' | 'trace' | 'coverage';
  depth?: number;
  via?: string | null;
}

export interface ImpactGap {
  type: 'no_test' | 'no_impl' | 'no_trace' | 'low_coverage';
  entityId?: string;
  file?: string;
  detail: string;
}

export interface ImpactSummary {
  totalAffected: number;
  blastRatio: number;
  components: number;
  cycles: number;
  rtmRows: number;
  gapCount: number;
}

export interface ImpactGraph {
  sources: string[];
  affected: AffectedNode[];
  gaps: ImpactGap[];
  summary: ImpactSummary;
}

// ── Tool interface (DI for testability) ──────

export interface ToolResult {
  text?: string;
  summary?: string;
  json?: any;
  error?: string;
}

export interface ImpactTools {
  blastRadius: (params: { changed_files: string[]; path?: string; max_depth?: number }) => ToolResult;
  dependencyGraph: (params: { path: string; depth?: number }) => ToolResult;
  rtmParse: (params: { path: string; matrix?: string }) => ToolResult;
  coverageMap: (params: { path?: string; coverage_dir?: string }) => ToolResult;
}

// ── Database interface ──────────────────────

interface SQLiteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
}

// ── Default tool loader ─────────────────────

async function loadDefaultTools(): Promise<ImpactTools> {
  const mod = await import("../core/tools/tool-core.mjs" as any);
  return {
    blastRadius: mod.toolBlastRadius,
    dependencyGraph: mod.toolDependencyGraph,
    rtmParse: mod.toolRtmParse,
    coverageMap: mod.toolCoverageMap,
  };
}

// ── Options ─────────────────────────────────

export interface BuildImpactGraphOptions {
  repoRoot?: string;
  rtmPath?: string;
  coverageDir?: string;
  db?: SQLiteDatabase;
  tools?: ImpactTools;
}

// ── Core function ───────────────────────────

export async function buildImpactGraph(
  changedFiles: string[],
  options?: BuildImpactGraphOptions,
): Promise<ImpactGraph> {
  if (!changedFiles || changedFiles.length === 0) {
    return { sources: [], affected: [], gaps: [], summary: emptySummary() };
  }

  const tools = options?.tools ?? await loadDefaultTools();
  const repoRoot = options?.repoRoot ?? process.cwd();

  // ── 1. Blast radius ───────────────────────
  const blastResult = tools.blastRadius({
    changed_files: changedFiles,
    path: repoRoot,
  });

  // ── 2. Dependency graph ───────────────────
  const depResult = tools.dependencyGraph({ path: repoRoot });

  // ── 3. RTM parse (optional) ───────────────
  let rtmResult: ToolResult | null = null;
  if (options?.rtmPath) {
    rtmResult = tools.rtmParse({ path: options.rtmPath, matrix: "forward" });
    if (rtmResult.error) rtmResult = null;
  }

  // ── 4. Coverage map (optional) ────────────
  const covResult = tools.coverageMap({
    path: repoRoot,
    coverage_dir: options?.coverageDir ?? "coverage",
  });
  const hasCoverage = !covResult.error;

  // ── Build affected list ───────────────────
  const affected: AffectedNode[] = [];
  const affectedIds = new Set<string>();

  // From blast radius
  if (!blastResult.error && blastResult.json?.files) {
    for (const f of blastResult.json.files) {
      if (!affectedIds.has(f.file)) {
        affectedIds.add(f.file);
        affected.push({
          id: f.file,
          type: 'file',
          impact: f.depth <= 1 ? 'direct' : 'transitive',
          depth: f.depth,
          via: f.via,
        });
      }
    }
  }

  // From RTM — requirements traced to changed files
  if (rtmResult?.json?.rows) {
    for (const row of rtmResult.json.rows) {
      const rowFile = row.file || row.test_file || '';
      const reqId = row.req_id || '';
      const isTraced = changedFiles.some(f => rowFile.includes(f)) ||
                       affectedIds.has(rowFile);
      if (isTraced && reqId && !affectedIds.has(reqId)) {
        affectedIds.add(reqId);
        affected.push({
          id: reqId,
          type: 'requirement',
          impact: 'trace',
        });
      }
    }
  }

  // ── Build gaps ────────────────────────────
  const gaps: ImpactGap[] = [];

  // RTM gaps: requirements without implementation or with open status
  if (rtmResult?.json?.rows) {
    for (const row of rtmResult.json.rows) {
      const reqId = row.req_id || '';
      const file = row.file || '';
      const status = (row.status || '').toLowerCase();

      if (reqId && (!file || file === '—' || file === '')) {
        gaps.push({
          type: 'no_impl',
          entityId: reqId,
          detail: `Requirement ${reqId} has no implementation file`,
        });
      }
      if (reqId && (status === 'open' || status === 'gap')) {
        gaps.push({
          type: 'no_trace',
          entityId: reqId,
          detail: `Requirement ${reqId} status: ${status}`,
        });
      }
    }
  }

  // ── Build summary ─────────────────────────
  const summary: ImpactSummary = {
    totalAffected: affected.length,
    blastRatio: blastResult.json?.ratio ?? 0,
    components: depResult.json?.components ?? 0,
    cycles: depResult.json?.cycles ?? 0,
    rtmRows: rtmResult?.json?.filtered ?? 0,
    gapCount: gaps.length,
  };

  // ── Upsert entities (optional) ────────────
  if (options?.db) {
    upsertGraphEntities(options.db, affected);
  }

  return { sources: changedFiles, affected, gaps, summary };
}

// ── Entity upsert helper ────────────────────

function upsertGraphEntities(db: SQLiteDatabase, affected: AffectedNode[]): void {
  for (const node of affected) {
    if (node.type !== 'requirement' && node.type !== 'test') continue;

    const entityType: EntityType = node.type === 'requirement' ? 'requirement' : 'test';
    const existing = getEntity(db, node.id);
    if (!existing) {
      try {
        addEntity(db, {
          id: node.id,
          type: entityType,
          title: node.id,
          metadata: { source: 'impact-graph', impact: node.impact },
        });
      } catch (_) {
        // Entity may have been created concurrently — ignore
      }
    }
  }
}

// ── Helpers ─────────────────────────────────

function emptySummary(): ImpactSummary {
  return { totalAffected: 0, blastRatio: 0, components: 0, cycles: 0, rtmRows: 0, gapCount: 0 };
}
