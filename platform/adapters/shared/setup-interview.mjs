/**
 * Setup Interview Protocol — dynamic questions based on project scan.
 *
 * PRD § 6.6 / FR-2: 3~5 questions, scanner-aware skip logic.
 * PRD § FR-4: Intent → Harness Mapping (composeHarness).
 *
 * @module adapters/shared/setup-interview
 */

/**
 * @typedef {Object} Question
 * @property {string} id - Question identifier
 * @property {string} text - Question text to show user
 * @property {string} type - "text" | "choice"
 * @property {string[]} [choices] - Available choices for "choice" type
 * @property {boolean} skipped - Whether scanner already answered this
 * @property {string} [prefilledValue] - Scanner-detected value (shown as confirmation)
 */

/**
 * @typedef {Object} Answer
 * @property {string} id - Matches Question.id
 * @property {string} value - User's answer text
 */

/**
 * @typedef {Object} SetupIntent
 * @property {string} agenda - Project goal (parliament input)
 * @property {"strict"|"balanced"|"fast"|"prototype"} gateProfile - Desired gate profile
 * @property {"solo"|"small"|"large"} teamSize - Team size
 * @property {string|null} ci - CI system (from scanner or answer)
 * @property {string[]} activeDomains - Confirmed active domains
 */

/**
 * Build interview questions based on project profile.
 * Questions already answered by scanner are marked as skipped.
 *
 * @param {import("./project-scanner.mjs").ProjectProfile} profile
 * @returns {Question[]}
 */
export function buildInterviewQuestions(profile) {
  const questions = [];

  // Q1: Project goal (always asked)
  questions.push({
    id: "goal",
    text: "이 프로젝트의 주요 목표는 무엇인가요? (예: 인증 시스템 구현, API 서버 개발)",
    type: "text",
    skipped: false,
  });

  // Q2: Priority (always asked — determines gate profile)
  questions.push({
    id: "priority",
    text: "어떤 부분이 가장 중요한가요?",
    type: "choice",
    choices: ["보안 (security)", "품질 (quality)", "속도 (speed)", "실험 (experiment)"],
    skipped: false,
  });

  // Q3: Team size (always asked — determines parliament depth)
  questions.push({
    id: "teamSize",
    text: "팀 규모는?",
    type: "choice",
    choices: ["solo (혼자)", "small (2-5명)", "large (6명+)"],
    skipped: false,
  });

  // Q4: CI — skip if scanner detected
  if (profile.ci) {
    questions.push({
      id: "ci",
      text: `CI/CD: ${profile.ci} 감지됨. 맞나요?`,
      type: "choice",
      choices: ["맞습니다", "아닙니다 (다른 CI 사용)"],
      skipped: true,
      prefilledValue: profile.ci,
    });
  } else {
    questions.push({
      id: "ci",
      text: "CI/CD 시스템이 있나요? (예: GitHub Actions, GitLab CI)",
      type: "text",
      skipped: false,
    });
  }

  // Q5: Domains — skip if scanner detected, show for confirmation
  if (profile.activeDomains.length > 0) {
    questions.push({
      id: "domains",
      text: `감지된 도메인: ${profile.activeDomains.join(", ")}. 추가할 도메인이 있나요?`,
      type: "text",
      skipped: true,
      prefilledValue: profile.activeDomains.join(", "),
    });
  } else {
    questions.push({
      id: "domains",
      text: "특별히 주의할 도메인이 있나요? (예: security, i18n, migration, a11y)",
      type: "text",
      skipped: false,
    });
  }

  return questions;
}

/**
 * Process answers into a SetupIntent.
 *
 * @param {Answer[]} answers
 * @param {import("./project-scanner.mjs").ProjectProfile} profile
 * @returns {SetupIntent}
 */
export function processAnswers(answers, profile) {
  const answerMap = new Map(answers.map(a => [a.id, a.value]));

  // Goal → agenda
  const agenda = answerMap.get("goal") ?? "프로젝트 개발";

  // Priority → gateProfile
  const priority = (answerMap.get("priority") ?? "").toLowerCase();
  let gateProfile = "balanced";
  if (/보안|security|strict/.test(priority)) gateProfile = "strict";
  else if (/속도|speed|fast|quick/.test(priority)) gateProfile = "fast";
  else if (/실험|experiment|proto/.test(priority)) gateProfile = "prototype";

  // Team size
  const teamStr = (answerMap.get("teamSize") ?? "").toLowerCase();
  let teamSize = "solo";
  if (/small|2-5|소규모/.test(teamStr)) teamSize = "small";
  else if (/large|6|대규모/.test(teamStr)) teamSize = "large";

  // CI — prefer scanner, override if user says different
  const ciAnswer = answerMap.get("ci") ?? "";
  const ci = /아닙니다|no|다른/.test(ciAnswer)
    ? ciAnswer.replace(/아닙니다.*|no.*/i, "").trim() || null
    : profile.ci;

  // Domains — merge scanner + user additions
  const domainsAnswer = answerMap.get("domains") ?? "";
  const userDomains = domainsAnswer.split(/[,\s]+/).filter(d => d.length > 1);
  const activeDomains = [...new Set([...profile.activeDomains, ...userDomains])];

  return { agenda, gateProfile, teamSize, ci, activeDomains };
}

/**
 * Compose a harness config from setup intent + project profile.
 * PRD § 6.6 P3: Harness Composer.
 *
 * @param {SetupIntent} intent
 * @param {import("./project-scanner.mjs").ProjectProfile} profile
 * @returns {object} Partial QuorumConfig
 */
export function composeHarness(intent, profile) {
  // Parliament depth based on team size
  const parliamentConfig = {
    solo: { maxRounds: 1, roles: {} },                    // skip/judge only
    small: { maxRounds: 3, roles: {} },                   // judge + minimal
    large: { maxRounds: 5, roles: {} },                   // full 3-role
  };

  // Verify commands from detected test framework
  const verifyCommands = [];
  if (profile.testFramework === "vitest") verifyCommands.push("npx vitest run");
  else if (profile.testFramework === "jest") verifyCommands.push("npx jest");
  else if (profile.testFramework === "node-test") verifyCommands.push("npm test");
  else if (profile.testFramework === "go-test") verifyCommands.push("go test ./...");
  else if (profile.testFramework === "cargo-test") verifyCommands.push("cargo test");
  else if (profile.testFramework === "pytest") verifyCommands.push("pytest");
  else if (profile.testFramework === "mocha") verifyCommands.push("npx mocha");

  // Type check
  if (profile.languages.includes("typescript")) verifyCommands.push("npx tsc --noEmit");

  return {
    gates: {
      gateProfile: intent.gateProfile,
    },
    pipeline: { agenda: intent.agenda },
    parliament: parliamentConfig[intent.teamSize] ?? parliamentConfig.solo,
    verify: { commands: verifyCommands },
    domains: { active: intent.activeDomains },
    _meta: {
      generatedBy: "quorum-setup",
      agenda: intent.agenda,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Get only the non-skipped questions (for display).
 * @param {Question[]} questions
 * @returns {Question[]}
 */
export function getActiveQuestions(questions) {
  return questions.filter(q => !q.skipped);
}
