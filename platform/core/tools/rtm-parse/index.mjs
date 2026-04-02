/**
 * rtm-parse — Parse and query RTM (Requirements Traceability Matrix) tables.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { safePathOrError } from "../tool-utils.mjs";

export function toolRtmParse(params) {
  const { path: targetPath, matrix = "forward", req_id, status: statusFilter } = params;
  if (!targetPath) return { error: "path is required" };

  const pathCheck = safePathOrError(targetPath);
  if (pathCheck.error) return pathCheck;
  const fullPath = pathCheck.path;
  if (!existsSync(fullPath)) return { error: `Not found: ${targetPath}` };

  const content = readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);

  const matrixPatterns = {
    forward:       /^##\s+(?:순방향|Forward)\s+RTM/i,
    backward:      /^##\s+(?:역방향|Backward)\s+RTM/i,
    bidirectional: /^##\s+(?:양방향|Bidirectional)\s+RTM/i,
  };
  const sectionRe = matrixPatterns[matrix];
  if (!sectionRe) return { error: `Unknown matrix type: ${matrix}. Use: forward, backward, bidirectional` };

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sectionRe.test(lines[i].trim())) { sectionStart = i; break; }
  }
  const searchStart = sectionStart >= 0 ? sectionStart : 0;

  let headerLine = -1;
  let headerCols = [];
  const rows = [];

  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];

    if (i > searchStart && /^##\s+/.test(line) && sectionStart >= 0) break;

    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map(c => c.trim()).filter((_, idx, a) => idx > 0 && idx < a.length);

    if (headerLine < 0 && cells.some(c => /Req\s*ID|Test\s*File/i.test(c))) {
      headerCols = cells;
      headerLine = i;
      continue;
    }
    if (headerLine >= 0 && cells.every(c => c === "" || /^[-:]+$/.test(c))) continue;
    if (headerLine < 0) continue;

    const row = {};
    for (let j = 0; j < headerCols.length && j < cells.length; j++) {
      const key = headerCols[j]
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      row[key] = cells[j];
    }
    rows.push(row);
  }

  let filtered = rows;
  if (req_id) {
    filtered = filtered.filter(r => (r.req_id || "").includes(req_id));
  }
  if (statusFilter) {
    filtered = filtered.filter(r => (r.status || "").toLowerCase() === statusFilter.toLowerCase());
  }

  const output = [];
  output.push(`## ${matrix} RTM — ${filtered.length} rows${req_id ? ` (filtered: ${req_id})` : ""}${statusFilter ? ` (status: ${statusFilter})` : ""}\n`);

  if (filtered.length === 0) {
    output.push("No matching rows found.");
  } else {
    output.push("| " + headerCols.join(" | ") + " |");
    output.push("|" + headerCols.map(() => "---").join("|") + "|");
    for (const row of filtered) {
      const cells = headerCols.map(h => {
        const key = h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        return row[key] || "—";
      });
      output.push("| " + cells.join(" | ") + " |");
    }

    if (matrix === "forward") {
      const statuses = {};
      for (const r of filtered) {
        const s = (r.status || "unknown").toLowerCase();
        statuses[s] = (statuses[s] || 0) + 1;
      }
      output.push("");
      output.push("**Status summary**: " + Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(", "));
    }
  }

  return {
    text: output.join("\n"),
    summary: `${filtered.length}/${rows.length} rows`,
    json: {
      matrix,
      total: rows.length,
      filtered: filtered.length,
      rows: filtered,
    },
  };
}
