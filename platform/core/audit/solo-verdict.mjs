/** Generate verdict from pre-verification results only (solo audit mode). */
export function generateSoloVerdict(preVerified) {
  const failures = [];

  // CQ-2 (tsc) failure
  if (preVerified.includes("\u274C FAILED") && preVerified.includes("CQ-2")) {
    failures.push("[CQ-2] TypeScript compilation failed");
  }
  // CQ-1 (eslint) failure
  if (preVerified.includes("\u274C") && preVerified.includes("CQ-1")) {
    failures.push("[CQ-1] ESLint errors detected");
  }
  // T-1 (test) failure
  if (preVerified.includes("\u274C FAIL") && preVerified.includes("T-1")) {
    failures.push("[T-1] Test failures detected");
  }
  // CC-2 (scope) empty
  if (preVerified.includes("(no changed files detected)")) {
    failures.push("[CC-2] No changed files in scope");
  }

  if (failures.length === 0) {
    return [
      `## [APPROVED]`,
      ``,
      `### Audit Mode`,
      `Solo (pre-verification only \u2014 no external model)`,
      ``,
      `### Pre-Verified Results`,
      preVerified,
      ``,
      `### Final Verdict`,
      `- Status: approved (all mechanical checks passed)`,
      `- Mode: solo \u2014 CL/S/I/CV not evaluated`,
      `- Note: security and architecture review skipped`,
    ].join("\n");
  }

  return [
    `## [CHANGES_REQUESTED]`,
    ``,
    `### Audit Mode`,
    `Solo (pre-verification only \u2014 no external model)`,
    ``,
    `### Failures`,
    ...failures.map(f => `- ${f}`),
    ``,
    `### Pre-Verified Results`,
    preVerified,
  ].join("\n");
}
