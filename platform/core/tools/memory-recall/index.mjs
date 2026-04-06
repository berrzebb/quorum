/**
 * memory_recall — Auto-extract relevant context for current work (v0.6.5 DCM FR-8).
 *
 * Called by hooks (PostToolUse, audit-start) or agents directly.
 * Returns compact natural-language lines optimized for AI consumption:
 *
 *   Pattern: bridge 배선 끊김 6회 — stub 반환 후 완료 선언
 *   Trust: agent-X 신뢰도 20%, 실행 검증 필수
 *   Rule(HARD): console.log in production 금지
 *
 * No markdown headers, no brackets — pure information, minimal tokens.
 */

let _search = null;
let _query = null;

async function mods() {
  if (!_search) _search = await import("../../../dist/platform/bus/graph-search.js");
  if (!_query) _query = await import("../../../dist/platform/bus/graph-query.js");
  return { search: _search, query: _query };
}

async function getDb() {
  try {
    const bridge = await import("../../bridge.mjs");
    const store = bridge.getStore?.();
    if (store) return store.getDb();
  } catch { /* bridge unavailable */ }

  try {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
    if (!existsSync(dbPath)) return null;
    const { openDatabase } = await import("../../../dist/platform/bus/sqlite-adapter.js");
    return openDatabase(dbPath);
  } catch { return null; }
}

/** @param {object} args */
export async function toolMemoryRecall(args) {
  const { context, files = [], agent_id, limit = 5 } = args;
  if (!context) return { error: "context is required" };

  const db = await getDb();
  if (!db) return { text: "" }; // fail-open: empty context is fine

  const { search, query: gq } = await mods();

  try {
    const lines = [];
    const seen = new Set();

    // 1. Keyword search on context (fast, primary)
    const kwResults = search.searchKeyword(db, context, { limit: limit * 2 });
    for (const r of kwResults) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const line = formatRecallLine(r);
      if (line) lines.push(line);
    }

    // 2. File-based pattern history (if files provided)
    for (const file of files.slice(0, 5)) {
      const patterns = gq.queryPatternHistory(db, file, 3);
      for (const p of patterns) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const line = formatRecallLine(p);
        if (line) lines.push(line);
      }
    }

    // 3. Agent trust score (if agent_id provided)
    if (agent_id) {
      const trust = gq.queryAgentTrust(db, agent_id);
      if (trust.total > 0 && trust.trustPct < 80) {
        const urgency = trust.trustPct < 50 ? "실행 검증 필수" : "완료 선언 검증 권장";
        lines.push(`Trust: ${agent_id} 신뢰도 ${trust.trustPct}%, ${urgency}`);
      }
    }

    // 4. Active HARD rules (always relevant)
    try {
      const hardRules = gq.queryNodes(db, { type: "Rule", status: "hard", limit: 5 });
      for (const rule of hardRules) {
        if (seen.has(rule.id)) continue;
        seen.add(rule.id);
        lines.push(`Rule(HARD): ${rule.title}`);
      }
    } catch { /* no rules yet — fine */ }

    // Trim to limit
    const finalLines = lines.slice(0, limit);

    return {
      text: finalLines.join("\n"),
      summary: `${finalLines.length} context line(s) recalled`,
      json: { count: finalLines.length, sources: [...seen].slice(0, limit) },
    };
  } catch (err) {
    return { text: "", summary: `recall failed: ${err.message}` };
  }
}

/**
 * Format a single entity into a recall line.
 * AI-optimized: type prefix + natural language, no decoration.
 */
function formatRecallLine(entity) {
  const desc = entity.description || entity.title;
  if (!desc) return null;

  const content = desc.length > 150 ? desc.slice(0, 147) + "..." : desc;

  switch (entity.type) {
    case "Pattern":
      return `Pattern: ${content}`;
    case "Fact":
      return `Fact: ${content}`;
    case "Decision":
      return `Decision: ${content}`;
    case "Trend":
      return `Trend: ${content}`;
    case "Rule": {
      const level = entity.status === "hard" ? "HARD" : "soft";
      return `Rule(${level}): ${content}`;
    }
    default:
      return `${entity.type}: ${content}`;
  }
}
