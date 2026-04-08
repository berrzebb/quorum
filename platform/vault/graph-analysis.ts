/**
 * Vault Graph Analysis — community detection, centrality, and reporting.
 *
 * Operates on the existing SQLite entities + relations tables.
 * No external graph library needed — pure SQL + TypeScript.
 *
 * Features:
 * - Edge classification: extracted / inferred / ambiguous
 * - Louvain community detection (modularity optimization)
 * - Degree + betweenness centrality (hub/god node discovery)
 * - GRAPH_REPORT.md generation for wiki/
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { slug } from "./exporter.js";

type DB = import("../bus/sqlite-adapter.js").SQLiteDatabase;

// ── Types ───────────────────────────────────────

export type EdgeConfidence = "extracted" | "inferred" | "ambiguous";

export interface GraphNode {
  id: string;
  type: string;
  title: string;
  degree: number;
  inDegree: number;
  outDegree: number;
  community: number;
  centrality: number;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  type: string;
  confidence: EdgeConfidence;
  weight: number;
}

export interface Community {
  id: number;
  nodes: GraphNode[];
  label: string;  // derived from most common node type or highest-degree node
  size: number;
}

export interface GraphReport {
  nodeCount: number;
  edgeCount: number;
  communities: Community[];
  godNodes: GraphNode[];       // top-10 by degree
  bridges: GraphNode[];        // high betweenness centrality
  orphans: GraphNode[];        // degree = 0
  surprisingEdges: GraphEdge[];  // cross-community edges
}

// ── Schema Migration ────────────────────────────

/**
 * Add confidence column to relations table (idempotent).
 */
export function migrateRelationsConfidence(db: DB): void {
  try {
    db.exec("ALTER TABLE relations ADD COLUMN confidence TEXT NOT NULL DEFAULT 'extracted'");
  } catch {
    // Column already exists
  }
}

// ── Graph Loading ───────────────────────────────

function loadGraph(db: DB): { nodes: Map<string, GraphNode>; edges: GraphEdge[] } {
  const entities = db.prepare(`
    SELECT id, type, title FROM entities WHERE type != 'Reference' LIMIT 10000
  `).all() as Array<{ id: string; type: string; title: string }>;

  const relations = db.prepare(`
    SELECT from_id, to_id, type, weight, confidence FROM relations LIMIT 50000
  `).all() as Array<{ from_id: string; to_id: string; type: string; weight: number; confidence?: string }>;

  const nodes = new Map<string, GraphNode>();
  for (const e of entities) {
    nodes.set(e.id, {
      id: e.id,
      type: e.type,
      title: e.title,
      degree: 0,
      inDegree: 0,
      outDegree: 0,
      community: -1,
      centrality: 0,
    });
  }

  const edges: GraphEdge[] = [];
  for (const r of relations) {
    if (!nodes.has(r.from_id) || !nodes.has(r.to_id)) continue;

    edges.push({
      fromId: r.from_id,
      toId: r.to_id,
      type: r.type,
      confidence: (r.confidence as EdgeConfidence) ?? "extracted",
      weight: r.weight,
    });

    const from = nodes.get(r.from_id)!;
    const to = nodes.get(r.to_id)!;
    from.outDegree++;
    from.degree++;
    to.inDegree++;
    to.degree++;
  }

  return { nodes, edges };
}

// ── Louvain Community Detection ─────────────────

/**
 * Simplified Louvain algorithm for modularity-based community detection.
 * Assigns community IDs to each node.
 */
function detectCommunities(nodes: Map<string, GraphNode>, edges: GraphEdge[]): void {
  const nodeList = [...nodes.values()];
  if (nodeList.length === 0) return;

  // Initialize: each node is its own community
  const communityOf = new Map<string, number>();
  nodeList.forEach((n, i) => communityOf.set(n.id, i));

  // Build adjacency list with weights
  const adj = new Map<string, Map<string, number>>();
  for (const n of nodeList) adj.set(n.id, new Map());

  const totalWeight = edges.reduce((s, e) => s + e.weight, 0) || 1;

  for (const e of edges) {
    const fwd = adj.get(e.fromId)!;
    fwd.set(e.toId, (fwd.get(e.toId) ?? 0) + e.weight);
    const bwd = adj.get(e.toId)!;
    bwd.set(e.fromId, (bwd.get(e.fromId) ?? 0) + e.weight);
  }

  // Node strength (sum of edge weights)
  const strength = new Map<string, number>();
  for (const n of nodeList) {
    let s = 0;
    for (const w of (adj.get(n.id)?.values() ?? [])) s += w;
    strength.set(n.id, s);
  }

  // Community internal weight + total weight
  const commWeight = new Map<number, number>();   // total weight of edges involving community
  const commInternal = new Map<number, number>(); // weight of edges within community

  for (const [id, comm] of communityOf) {
    commWeight.set(comm, (commWeight.get(comm) ?? 0) + (strength.get(id) ?? 0));
  }
  for (const e of edges) {
    const cf = communityOf.get(e.fromId)!;
    const ct = communityOf.get(e.toId)!;
    if (cf === ct) {
      commInternal.set(cf, (commInternal.get(cf) ?? 0) + e.weight);
    }
  }

  // Iterate: move each node to the community that maximizes modularity gain
  let improved = true;
  let iterations = 0;

  while (improved && iterations < 20) {
    improved = false;
    iterations++;

    for (const node of nodeList) {
      const currentComm = communityOf.get(node.id)!;
      const ki = strength.get(node.id) ?? 0;

      // Calculate modularity gain for moving to each neighbor's community
      const neighborComms = new Map<number, number>(); // comm → weight of edges to that comm
      for (const [neighbor, w] of (adj.get(node.id) ?? [])) {
        const nc = communityOf.get(neighbor)!;
        neighborComms.set(nc, (neighborComms.get(nc) ?? 0) + w);
      }

      let bestComm = currentComm;
      let bestGain = 0;

      for (const [targetComm, kiIn] of neighborComms) {
        if (targetComm === currentComm) continue;

        const sigmaTot = commWeight.get(targetComm) ?? 0;
        const gain = kiIn - (sigmaTot * ki) / (2 * totalWeight);

        if (gain > bestGain) {
          bestGain = gain;
          bestComm = targetComm;
        }
      }

      if (bestComm !== currentComm) {
        // Remove from current community
        commWeight.set(currentComm, (commWeight.get(currentComm) ?? 0) - ki);
        // Add to new community
        commWeight.set(bestComm, (commWeight.get(bestComm) ?? 0) + ki);
        communityOf.set(node.id, bestComm);
        improved = true;
      }
    }
  }

  // Renumber communities to be consecutive (0, 1, 2, ...)
  const commMap = new Map<number, number>();
  let nextId = 0;
  for (const n of nodeList) {
    const c = communityOf.get(n.id)!;
    if (!commMap.has(c)) commMap.set(c, nextId++);
    n.community = commMap.get(c)!;
  }
}

// ── Betweenness Centrality (approximate) ────────

/**
 * Approximate betweenness centrality using BFS from sampled source nodes.
 * O(V * (V + E)) for full computation — we sample min(50, V) sources.
 */
function computeCentrality(nodes: Map<string, GraphNode>, edges: GraphEdge[]): void {
  const nodeIds = [...nodes.keys()];
  if (nodeIds.length === 0) return;

  // Build undirected adjacency
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    adj.get(e.fromId)?.push(e.toId);
    adj.get(e.toId)?.push(e.fromId);
  }

  // Sample sources for approximation
  const sampleSize = Math.min(50, nodeIds.length);
  const sources = nodeIds.slice(0, sampleSize);

  const centrality = new Map<string, number>();
  for (const id of nodeIds) centrality.set(id, 0);

  for (const source of sources) {
    // BFS
    const dist = new Map<string, number>();
    const sigma = new Map<string, number>(); // shortest path count
    const pred = new Map<string, string[]>();
    const stack: string[] = [];

    dist.set(source, 0);
    sigma.set(source, 1);
    const queue = [source];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);

      for (const w of (adj.get(v) ?? [])) {
        if (!dist.has(w)) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 1));
          if (!pred.has(w)) pred.set(w, []);
          pred.get(w)!.push(v);
        }
      }
    }

    // Accumulation
    const delta = new Map<string, number>();
    for (const id of nodeIds) delta.set(id, 0);

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of (pred.get(w) ?? [])) {
        const d = ((sigma.get(v) ?? 1) / (sigma.get(w) ?? 1)) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + d);
      }
      if (w !== source) {
        centrality.set(w, (centrality.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  }

  // Normalize
  const scale = nodeIds.length > 2 ? 1 / ((nodeIds.length - 1) * (nodeIds.length - 2)) : 1;
  for (const [id, c] of centrality) {
    const node = nodes.get(id);
    if (node) node.centrality = c * scale;
  }
}

// ── Analysis Entry Point ────────────────────────

/**
 * Run full graph analysis: community detection + centrality + report generation.
 */
export function analyzeGraph(db: DB): GraphReport {
  migrateRelationsConfidence(db);

  const { nodes, edges } = loadGraph(db);

  // Community detection
  detectCommunities(nodes, edges);

  // Centrality
  computeCentrality(nodes, edges);

  // Build communities
  const commGroups = new Map<number, GraphNode[]>();
  for (const n of nodes.values()) {
    if (!commGroups.has(n.community)) commGroups.set(n.community, []);
    commGroups.get(n.community)!.push(n);
  }

  const communities: Community[] = [...commGroups.entries()]
    .map(([id, cnodes]) => ({
      id,
      nodes: cnodes,
      size: cnodes.length,
      label: deriveLabel(cnodes),
    }))
    .sort((a, b) => b.size - a.size);

  // God nodes: top-10 by degree
  const godNodes = [...nodes.values()]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  // Bridges: high betweenness centrality
  const bridges = [...nodes.values()]
    .sort((a, b) => b.centrality - a.centrality)
    .slice(0, 10)
    .filter(n => n.centrality > 0);

  // Orphans: no edges
  const orphans = [...nodes.values()].filter(n => n.degree === 0);

  // Surprising edges: cross-community with high weight
  const surprisingEdges = edges
    .filter(e => {
      const fn = nodes.get(e.fromId);
      const tn = nodes.get(e.toId);
      return fn && tn && fn.community !== tn.community;
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);

  return {
    nodeCount: nodes.size,
    edgeCount: edges.length,
    communities,
    godNodes,
    bridges,
    orphans,
    surprisingEdges,
  };
}

// ── Report Generation ───────────────────────────

/** Obsidian wikilink: [[slug|display title]] */
function wikilink(title: string): string {
  return `[[${slug(title)}|${title}]]`;
}

/**
 * Generate GRAPH_REPORT.md in wiki/ directory.
 */
export function generateGraphReport(db: DB, vaultRoot: string): string {
  const report = analyzeGraph(db);
  const lines: string[] = [];

  lines.push("---");
  lines.push("generated: true");
  lines.push(`updated: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push("# Graph Report");
  lines.push("");
  lines.push(`**${report.nodeCount}** nodes, **${report.edgeCount}** edges, **${report.communities.length}** communities`);
  lines.push("");

  // God nodes
  if (report.godNodes.length > 0) {
    lines.push("## Hub Nodes (Highest Connectivity)");
    lines.push("");
    for (const n of report.godNodes) {
      lines.push(`- **${wikilink(n.title)}** (${n.type}) — ${n.degree} connections (in: ${n.inDegree}, out: ${n.outDegree})`);
    }
    lines.push("");
  }

  // Bridges
  if (report.bridges.length > 0) {
    lines.push("## Bridge Nodes (Cross-Community Connectors)");
    lines.push("");
    for (const n of report.bridges) {
      lines.push(`- **${wikilink(n.title)}** (${n.type}) — centrality: ${n.centrality.toFixed(4)}, community ${n.community}`);
    }
    lines.push("");
  }

  // Communities
  if (report.communities.length > 0) {
    lines.push("## Communities");
    lines.push("");
    for (const c of report.communities.slice(0, 15)) {
      const topNodes = c.nodes.sort((a, b) => b.degree - a.degree).slice(0, 5);
      lines.push(`### Community ${c.id}: ${c.label} (${c.size} nodes)`);
      for (const n of topNodes) {
        lines.push(`- ${wikilink(n.title)} (${n.type}, ${n.degree} edges)`);
      }
      lines.push("");
    }
  }

  // Surprising connections
  if (report.surprisingEdges.length > 0) {
    lines.push("## Cross-Community Connections");
    lines.push("");
    for (const e of report.surprisingEdges.slice(0, 10)) {
      const from = db.prepare("SELECT title FROM entities WHERE id = ?").get(e.fromId) as { title: string } | undefined;
      const to = db.prepare("SELECT title FROM entities WHERE id = ?").get(e.toId) as { title: string } | undefined;
      lines.push(`- ${wikilink(from?.title ?? e.fromId)} → ${wikilink(to?.title ?? e.toId)} (${e.type}, ${e.confidence})`);
    }
    lines.push("");
  }

  // Orphans
  if (report.orphans.length > 0) {
    lines.push("## Orphan Nodes (No Connections)");
    lines.push("");
    lines.push(`${report.orphans.length} nodes with zero edges:`);
    for (const n of report.orphans.slice(0, 20)) {
      lines.push(`- ${wikilink(n.title)} (${n.type})`);
    }
    if (report.orphans.length > 20) lines.push(`- ... and ${report.orphans.length - 20} more`);
    lines.push("");
  }

  // Suggested questions
  lines.push("## Suggested Questions");
  lines.push("");
  if (report.godNodes[0]) {
    lines.push(`- Why is **${report.godNodes[0].title}** so central? What depends on it?`);
  }
  if (report.orphans.length > 5) {
    lines.push(`- ${report.orphans.length} orphan nodes exist — should they be linked or removed?`);
  }
  if (report.surprisingEdges.length > 0) {
    const e = report.surprisingEdges[0]!;
    const from = db.prepare("SELECT title FROM entities WHERE id = ?").get(e.fromId) as { title: string } | undefined;
    const to = db.prepare("SELECT title FROM entities WHERE id = ?").get(e.toId) as { title: string } | undefined;
    lines.push(`- What connects **${from?.title}** to **${to?.title}** across communities?`);
  }
  lines.push("");

  const content = lines.join("\n");
  const wikiDir = join(vaultRoot, "wiki");
  mkdirSync(wikiDir, { recursive: true });
  const reportPath = join(wikiDir, "GRAPH_REPORT.md");
  writeFileSync(reportPath, content, "utf8");

  return reportPath;
}

// ── Helpers ─────────────────────────────────────

function deriveLabel(nodes: GraphNode[]): string {
  // Most common type + highest-degree node title
  const typeCounts = new Map<string, number>();
  for (const n of nodes) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);
  const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Mixed";
  const topNode = nodes.sort((a, b) => b.degree - a.degree)[0];
  return topNode ? `${topType} — ${topNode.title}` : topType;
}

// ── Edge Classification ─────────────────────────

/**
 * Classify a relation edge's confidence level.
 * - extracted: directly from source material (tool results, code imports)
 * - inferred: reasonable deduction (semantic similarity, pattern matching)
 * - ambiguous: uncertain (needs human review)
 */
export function classifyEdge(
  edgeType: string,
  source: "code" | "session" | "wiki" | "manual",
): EdgeConfidence {
  // Code-derived edges are always extracted
  if (source === "code") return "extracted";
  if (source === "manual") return "extracted";

  // Session-derived: tool calls are extracted, text references are inferred
  if (source === "session") {
    if (["imports", "implements", "tested-by", "calls"].includes(edgeType)) return "extracted";
    return "inferred";
  }

  // Wiki-derived: wikilinks are inferred, explicit tags are extracted
  if (source === "wiki") {
    if (["tagged", "categorized-as"].includes(edgeType)) return "extracted";
    return "inferred";
  }

  return "ambiguous";
}
