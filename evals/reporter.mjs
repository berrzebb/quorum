/**
 * Quorum Skill Eval Reporter
 *
 * Formats benchmark results as markdown, detailed report, or JSON summary.
 */

function pct(n, d) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "N/A";
}

/**
 * Basic markdown report with summary table.
 */
export function formatMarkdownReport(benchmarkResult) {
  const { timestamp, version, model, summary, results } = benchmarkResult;
  const lines = [
    `# Quorum Skill Eval Report`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Date | ${timestamp} |`,
    `| Version | ${version} |`,
    `| Model | ${model} |`,
    `| Total | ${summary.total} |`,
    `| Passed | ${summary.passed} |`,
    `| Pass Rate | ${summary.passRate}% |`,
    ``,
    `## By Classification`,
    ``,
    `| Classification | Total | Passed | Rate |`,
    `|---------------|-------|--------|------|`,
    `| workflow | ${summary.workflow.total} | ${summary.workflow.passed} | ${pct(summary.workflow.passed, summary.workflow.total)} |`,
    `| capability | ${summary.capability.total} | ${summary.capability.passed} | ${pct(summary.capability.passed, summary.capability.total)} |`,
    ``,
    `## Results`,
    ``,
    `| Skill | Classification | Pass | Score |`,
    `|-------|---------------|------|-------|`,
  ];

  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.skill} | - | ERROR | ${r.error} |`);
    } else {
      const avgScore = r.evals.length > 0
        ? Math.round(r.evals.reduce((s, e) => s + (e.score || 0), 0) / r.evals.length * 100) / 100
        : 0;
      lines.push(`| ${r.skill} | ${r.classification} | ${r.pass ? "PASS" : "FAIL"} | ${avgScore} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Detailed report with failed criteria breakdown and score distribution.
 */
export function formatDetailedReport(benchmarkResult) {
  const { summary, results } = benchmarkResult;
  const lines = [formatMarkdownReport(benchmarkResult)];

  // Failed skills detail
  const failed = results.filter(r => !r.pass && !r.error);
  if (failed.length > 0) {
    lines.push("", "## Failed Skills — Detail", "");
    for (const r of failed) {
      lines.push(`### ${r.skill} (${r.classification})`);
      for (const ev of r.evals) {
        lines.push(`- **${ev.eval}**: ${ev.pass ? "PASS" : "FAIL"} (score: ${ev.score})`);
        if (ev.details) {
          for (const d of ev.details) {
            lines.push(`  - [${d.status}] ${d.criterion} (match: ${Math.round(d.matchRatio * 100)}%)`);
          }
        }
      }
      lines.push("");
    }
  }

  // Score distribution
  const allScores = results
    .filter(r => !r.error)
    .flatMap(r => r.evals.map(e => e.score || 0));

  if (allScores.length > 0) {
    const avg = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length * 100) / 100;
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);
    lines.push(
      "", "## Score Distribution", "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Average | ${avg} |`,
      `| Min | ${min} |`,
      `| Max | ${max} |`,
      `| Eval Count | ${allScores.length} |`,
    );
  }

  return lines.join("\n");
}

/**
 * Compact JSON summary.
 */
export function formatJsonSummary(benchmarkResult) {
  const { timestamp, summary } = benchmarkResult;
  return JSON.stringify({
    timestamp,
    total: summary.total,
    passed: summary.passed,
    passRate: `${summary.passRate}%`,
  });
}
