/**
 * audit-history/index.mjs — Tool: audit_history
 *
 * Query and summarize audit history from JSONL log.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readJsonlFile } from "../../context.mjs";
import { safePathOrError } from "../tool-utils.mjs";

// ═══ Tool: audit_history ════════════════════════════════════════════════

export function toolAuditHistory(params) {
  const { path: historyPath, track, code, since, summary = false } = params;
  if (historyPath) { const c = safePathOrError(historyPath); if (c.error) return c; }

  const defaultPath = resolve(process.cwd(), ".claude", "audit-history.jsonl");
  const fullPath = historyPath ? resolve(historyPath) : defaultPath;

  if (!existsSync(fullPath)) {
    return { text: `No audit history yet. The file ${fullPath} will be created automatically after the first audit verdict (respond.mjs appends to it).`, summary: "0 entries", json: { total: 0 } };
  }

  let entries = readJsonlFile(fullPath);

  if (track) {
    entries = entries.filter(e => (e.track || "").toLowerCase().includes(track.toLowerCase()));
  }
  if (code) {
    entries = entries.filter(e =>
      (e.rejection_codes || []).some(rc =>
        (typeof rc === "string" ? rc : rc.code || "").includes(code)
      )
    );
  }
  if (since) {
    const sinceMs = new Date(since).getTime();
    if (!isNaN(sinceMs)) {
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }
  }

  if (entries.length === 0) {
    return { text: "No matching audit history entries.", summary: "0 entries", json: { total: 0 } };
  }

  const output = [];

  if (summary) {
    const byVerdict = { agree: 0, pending: 0 };
    const byTrack = {};
    const byCode = {};
    let totalRounds = 0;

    for (const e of entries) {
      byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;
      if (e.track) byTrack[e.track] = (byTrack[e.track] || 0) + 1;
      for (const rc of (e.rejection_codes || [])) {
        const c = typeof rc === "string" ? rc : rc.code || "unknown";
        byCode[c] = (byCode[c] || 0) + 1;
      }
      totalRounds++;
    }

    output.push("## Audit History Summary\n");
    output.push(`- Total entries: ${totalRounds}`);
    output.push(`- Agree: ${byVerdict.agree || 0}, Pending: ${byVerdict.pending || 0}`);
    output.push(`- Approval rate: ${totalRounds > 0 ? Math.round(((byVerdict.agree || 0) / totalRounds) * 100) : 0}%\n`);

    if (Object.keys(byTrack).length > 0) {
      output.push("### By Track\n");
      output.push("| Track | Entries |");
      output.push("|-------|--------|");
      for (const [t, count] of Object.entries(byTrack).sort((a, b) => b[1] - a[1])) {
        output.push(`| ${t} | ${count} |`);
      }
      output.push("");
    }

    if (Object.keys(byCode).length > 0) {
      output.push("### By Rejection Code\n");
      output.push("| Code | Count |");
      output.push("|------|-------|");
      for (const [c, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
        output.push(`| ${c} | ${count} |`);
      }
      output.push("");
    }

    const patterns = [];
    for (const [c, count] of Object.entries(byCode)) {
      if (count >= 3) patterns.push(`\u26a0\ufe0f \`${c}\` appeared ${count} times — structural issue likely`);
    }
    if (patterns.length > 0) {
      output.push("### Risk Patterns\n");
      for (const p of patterns) output.push(`- ${p}`);
    }

    return {
      text: output.join("\n"),
      summary: `${totalRounds} entries, ${byVerdict.agree || 0} agree, ${byVerdict.pending || 0} pending`,
      json: { total: totalRounds, byVerdict, byTrack, byCode },
    };
  }

  // Detail mode
  output.push("## Audit History\n");
  output.push("| Timestamp | Track | Verdict | Req IDs | Rejection Codes |");
  output.push("|-----------|-------|---------|---------|-----------------|");

  for (const e of entries.slice(-50)) {
    const codes = (e.rejection_codes || []).map(rc =>
      typeof rc === "string" ? rc : `${rc.code}[${rc.severity}]`
    ).join(", ") || "\u2014";
    const reqIds = (e.req_ids || []).join(", ") || "\u2014";
    const ts = e.timestamp ? e.timestamp.slice(0, 16).replace("T", " ") : "\u2014";
    output.push(`| ${ts} | ${e.track || "\u2014"} | ${e.verdict} | ${reqIds} | ${codes} |`);
  }

  return {
    text: output.join("\n"),
    summary: `${entries.length} entries (showing last ${Math.min(entries.length, 50)})`,
    json: { total: entries.length, entries: entries.slice(-50) },
  };
}
