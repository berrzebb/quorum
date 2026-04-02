/**
 * rtm-merge — Merge RTM tables from multiple worktree branches.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { safePathOrError } from "../tool-utils.mjs";

function parseRtmTable(content) {
  const rows = new Map();
  const lines = content.split(/\r?\n/);
  let inTable = false;
  let headerCols = [];

  for (const line of lines) {
    if (!line.startsWith("|")) { inTable = false; continue; }

    const cells = line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length);

    if (!inTable && cells.some(c => /Req\s*ID/i.test(c))) {
      headerCols = cells;
      inTable = true;
      continue;
    }
    if (inTable && cells.every(c => c === "" || /^[-:]+$/.test(c))) continue;

    if (!inTable) continue;

    const reqIdx = headerCols.findIndex(c => /Req\s*ID/i.test(c));
    const fileIdx = headerCols.findIndex(c => /^File$/i.test(c));
    if (reqIdx < 0 || fileIdx < 0 || reqIdx >= cells.length || fileIdx >= cells.length) continue;

    const key = `${cells[reqIdx]}|${cells[fileIdx]}`;
    rows.set(key, { cells, raw: line });
  }
  return rows;
}

export function toolRtmMerge(params) {
  const { base, updates } = params;
  if (!base) return { error: "base path is required" };
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return { error: "updates array is required (paths to worktree RTM files)" };
  }

  const baseCheck = safePathOrError(base);
  if (baseCheck.error) return baseCheck;
  for (const u of updates) { const c = safePathOrError(u); if (c.error) return c; }
  const basePath = baseCheck.path;
  if (!existsSync(basePath)) return { error: `Base RTM not found: ${base}` };
  const baseContent = readFileSync(basePath, "utf8");
  const baseRows = parseRtmTable(baseContent);

  const merged = new Map(baseRows);
  const conflicts = [];
  const additions = [];
  const updates_applied = [];
  const sourceMap = new Map();

  for (const updatePath of updates) {
    const fullPath = resolve(updatePath);
    if (!existsSync(fullPath)) {
      conflicts.push({ path: updatePath, error: "file not found" });
      continue;
    }
    const updateContent = readFileSync(fullPath, "utf8");
    const updateRows = parseRtmTable(updateContent);

    for (const [key, row] of updateRows) {
      if (!merged.has(key)) {
        merged.set(key, row);
        sourceMap.set(key, updatePath);
        additions.push({ key, source: updatePath });
      } else {
        const existing = merged.get(key);
        if (sourceMap.has(key) && sourceMap.get(key) !== updatePath) {
          conflicts.push({
            key,
            sources: [sourceMap.get(key), updatePath],
            base: existing.raw,
            update: row.raw,
          });
        } else if (existing.raw !== row.raw) {
          merged.set(key, row);
          sourceMap.set(key, updatePath);
          updates_applied.push({ key, source: updatePath });
        }
      }
    }
  }

  const output = [];
  output.push("## RTM Merge Result\n");
  output.push(`- Base: ${base}`);
  output.push(`- Updates: ${updates.length} files`);
  output.push(`- Rows: ${merged.size} total, ${updates_applied.length} updated, ${additions.length} added, ${conflicts.length} conflicts\n`);

  if (conflicts.length > 0) {
    output.push("### Conflicts (require manual resolution)\n");
    for (const c of conflicts) {
      if (c.error) {
        output.push(`- **${c.path}**: ${c.error}`);
      } else {
        output.push(`- **${c.key}**: modified by \`${c.sources[0]}\` and \`${c.sources[1]}\``);
        output.push(`  - Source 1: ${c.base}`);
        output.push(`  - Source 2: ${c.update}`);
      }
    }
    output.push("");
  }

  if (updates_applied.length > 0) {
    output.push("### Updated Rows\n");
    output.push("| Req ID | File | Source |");
    output.push("|--------|------|--------|");
    for (const u of updates_applied) {
      const [reqId, file] = u.key.split("|");
      const rel = relative(process.cwd(), u.source).replace(/\\/g, "/");
      output.push(`| ${reqId} | ${file} | ${rel} |`);
    }
    output.push("");
  }

  if (additions.length > 0) {
    output.push("### New Rows (discovered)\n");
    output.push("| Req ID | File | Source |");
    output.push("|--------|------|--------|");
    for (const a of additions) {
      const [reqId, file] = a.key.split("|");
      const rel = relative(process.cwd(), a.source).replace(/\\/g, "/");
      output.push(`| ${reqId} | ${file} | ${rel} |`);
    }
    output.push("");
  }

  output.push("### Merged Forward RTM\n");
  const allRows = [...merged.values()];
  if (allRows.length > 0) {
    const headers = ["Req ID", "Description", "Track", "Design Ref", "File", "Exists", "Impl", "Test Case", "Test Result", "Connected", "Status"];
    output.push("| " + allRows[0].cells.map((_, i) => headers[i] || `Col${i}`).join(" | ") + " |");
    output.push("|" + allRows[0].cells.map(() => "---").join("|") + "|");
    for (const row of allRows) {
      output.push(row.raw);
    }
  }

  return {
    text: output.join("\n"),
    summary: `${merged.size} rows, ${updates_applied.length} updated, ${additions.length} added, ${conflicts.length} conflicts`,
    json: {
      total: merged.size,
      updated: updates_applied.length,
      added: additions.length,
      conflicts: conflicts.length,
    },
  };
}
