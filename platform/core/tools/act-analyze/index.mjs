/**
 * act-analyze/index.mjs — Tool: act_analyze
 *
 * Analyze audit history + FVM results -> produce structured improvement items
 * for the PDCA Act phase. Output is work-catalog-ready.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { readJsonlFile } from "../../context.mjs";

// ═══ Constants ═════════════════════════════════════════════════════════

const IMPROVEMENT_THRESHOLDS = {
  fp_rate_warn: 0.3,          // flag rejection code if FP rate > 30%
  repeat_rejection_warn: 3,   // flag if same code appears 3+ times on a track
  correction_rounds_warn: 3,  // flag if avg correction rounds > 3
  fvm_auth_leak_block: 1,     // any AUTH_LEAK is critical
  fvm_false_deny_warn: 0.2,   // flag if FALSE_DENY rate > 20%
};

// ═══ Tool: act_analyze ═══════════════════════════════════════════════════

export function toolActAnalyze(params) {
  const {
    audit_history_path,
    fvm_results_path,
    track,
    thresholds: customThresholds,
  } = params;

  const T = { ...IMPROVEMENT_THRESHOLDS, ...customThresholds };
  const cwd = process.cwd();
  const items = [];
  let auditMetrics = null;
  let fvmMetrics = null;

  // ── Audit history analysis ──

  const histPath = audit_history_path
    ? resolve(audit_history_path)
    : resolve(cwd, ".claude", "audit-history.jsonl");

  if (existsSync(histPath)) {
    let entries = readJsonlFile(histPath);
    if (track) {
      entries = entries.filter(e => (e.track || "").toLowerCase().includes(track.toLowerCase()));
    }

    if (entries.length > 0) {
      // Compute metrics
      const byCode = {};
      const byTrack = {};
      const byVerdict = { agree: 0, pending: 0 };
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

      const approvalRate = totalRounds > 0 ? (byVerdict.agree || 0) / totalRounds : 1;
      const avgCorrections = totalRounds > 0
        ? (byVerdict.pending || 0) / Math.max(byVerdict.agree || 1, 1)
        : 0;

      auditMetrics = {
        total: totalRounds,
        approval_rate: Math.round(approvalRate * 100),
        avg_corrections: Math.round(avgCorrections * 10) / 10,
        by_code: byCode,
        by_track: byTrack,
      };

      // Generate improvement items from audit patterns
      for (const [code, count] of Object.entries(byCode)) {
        if (count >= T.repeat_rejection_warn) {
          items.push({
            id: `ACT-A-${items.length + 1}`,
            type: "policy",
            source: "audit_history",
            metric: `${code}: ${count} rejections`,
            description: `Rejection code \`${code}\` appeared ${count} times — review policy in rejection-codes.md`,
            priority: count >= 5 ? "high" : "medium",
            target_file: `templates/references/\${locale}/rejection-codes.md`,
          });
        }
      }

      if (avgCorrections > T.correction_rounds_warn) {
        items.push({
          id: `ACT-A-${items.length + 1}`,
          type: "process",
          source: "audit_history",
          metric: `avg ${auditMetrics.avg_corrections} correction rounds`,
          description: `Average correction rounds (${auditMetrics.avg_corrections}) exceeds threshold (${T.correction_rounds_warn}) — review evidence format or done-criteria clarity`,
          priority: "high",
          target_file: `templates/references/\${locale}/evidence-format.md`,
        });
      }
    }
  }

  // ── FVM results analysis ──

  if (fvm_results_path && existsSync(resolve(fvm_results_path))) {
    const fvmContent = readFileSync(resolve(fvm_results_path), "utf8");

    // Parse summary line: "N rows, N passed, N failed"
    const summaryMatch = fvmContent.match(/Total:\s*(\d+)\s*rows?,\s*(\d+)\s*passed,\s*(\d+)\s*failed/i);
    if (summaryMatch) {
      const total = parseInt(summaryMatch[1]);
      const passed = parseInt(summaryMatch[2]);
      const failed = parseInt(summaryMatch[3]);

      // Count failure types from table
      const authLeaks = (fvmContent.match(/AUTH_LEAK/g) || []).length;
      const falseDenies = (fvmContent.match(/FALSE_DENY/g) || []).length;
      const paramErrors = (fvmContent.match(/PARAM_ERROR/g) || []).length;

      fvmMetrics = {
        total, passed, failed,
        pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
        auth_leaks: authLeaks,
        false_denies: falseDenies,
        param_errors: paramErrors,
      };

      if (authLeaks >= T.fvm_auth_leak_block) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "security",
          source: "fvm_validate",
          metric: `${authLeaks} AUTH_LEAK(s)`,
          description: `${authLeaks} endpoint(s) accessible by unauthorized roles — add auth guards`,
          priority: "critical",
          target_file: "src/dashboard/routes/",
        });
      }

      if (total > 0 && falseDenies / total > T.fvm_false_deny_warn) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "tooling",
          source: "fvm_validate",
          metric: `${falseDenies} FALSE_DENY (${Math.round(falseDenies / total * 100)}%)`,
          description: `FVM FALSE_DENY rate ${Math.round(falseDenies / total * 100)}% — improve fvm_generate page-to-endpoint tier mapping`,
          priority: "medium",
          target_file: "scripts/fvm-generator.mjs",
        });
      }

      if (paramErrors > 0) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "testing",
          source: "fvm_validate",
          metric: `${paramErrors} PARAM_ERROR(s)`,
          description: `${paramErrors} endpoint(s) return 400/422 — add request body fixtures to FVM validator`,
          priority: "low",
          target_file: "scripts/fvm-validator.mjs",
        });
      }
    }
  }

  // ── Format output ──

  const out = [];
  out.push("## Act Analysis — PDCA Improvement Items\n");
  out.push(`Generated: ${new Date().toISOString()}\n`);

  // Metrics summary
  if (auditMetrics) {
    out.push("### Audit Metrics\n");
    out.push(`- Total rounds: ${auditMetrics.total}`);
    out.push(`- Approval rate: ${auditMetrics.approval_rate}%`);
    out.push(`- Avg correction rounds: ${auditMetrics.avg_corrections}`);
    const topCodes = Object.entries(auditMetrics.by_code).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(", ");
    out.push(`- Top rejection codes: ${topCodes}`);
    out.push("");
  }

  if (fvmMetrics) {
    out.push("### FVM Metrics\n");
    out.push(`- Pass rate: ${fvmMetrics.pass_rate}% (${fvmMetrics.passed}/${fvmMetrics.total})`);
    out.push(`- AUTH_LEAK: ${fvmMetrics.auth_leaks}`);
    out.push(`- FALSE_DENY: ${fvmMetrics.false_denies}`);
    out.push(`- PARAM_ERROR: ${fvmMetrics.param_errors}`);
    out.push("");
  }

  // Improvement items in work-catalog format
  if (items.length > 0) {
    out.push("### Improvement Items (work-catalog format)\n");
    out.push("| ID | Type | Priority | Source | Description | Target |");
    out.push("|---|---|---|---|---|---|");
    for (const item of items) {
      out.push(`| ${item.id} | ${item.type} | ${item.priority} | ${item.source} | ${item.description} | ${item.target_file} |`);
    }
    out.push("");
    out.push("**Action**: Append approved items to the track's `work-catalog.md` under a new `## Act Improvements` section.");
  } else {
    out.push("### No Improvement Items\n");
    out.push("All metrics within thresholds. No structural improvements needed this cycle.");
  }

  const summary = `${items.length} improvement items` +
    (auditMetrics ? `, audit: ${auditMetrics.approval_rate}% approval` : "") +
    (fvmMetrics ? `, fvm: ${fvmMetrics.pass_rate}% pass` : "");

  return {
    text: out.join("\n"),
    summary,
    json: {
      items,
      audit_metrics: auditMetrics,
      fvm_metrics: fvmMetrics,
      thresholds: T,
    },
  };
}
