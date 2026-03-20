/**
 * quorum interview — interactive requirement clarification.
 *
 * Socratic questioning to reduce ambiguity before planning.
 * Produces a structured requirement summary that feeds into `quorum plan`.
 *
 * Flow:
 * 1. User provides initial requirement
 * 2. System asks clarifying questions (scope, constraints, priorities)
 * 3. User answers → system scores ambiguity
 * 4. When ambiguity is low enough → generate requirement summary
 * 5. Summary feeds into planner skill for PRD + work breakdown
 */

import { createInterface } from "node:readline";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RequirementState {
  initial: string;
  answers: { question: string; answer: string }[];
  scope: string[];
  constraints: string[];
  priorities: string[];
  ambiguityScore: number;
}

const QUESTION_TEMPLATES = [
  {
    category: "scope",
    questions: [
      "What is the primary goal? What problem does this solve?",
      "Who are the users? (roles, permissions, access levels)",
      "What are the boundaries? What is explicitly NOT included?",
      "Are there existing systems this needs to integrate with?",
    ],
  },
  {
    category: "constraints",
    questions: [
      "Are there performance requirements? (latency, throughput, concurrency)",
      "Security constraints? (auth, encryption, data sensitivity)",
      "Technology constraints? (specific frameworks, languages, infrastructure)",
      "Timeline or budget constraints?",
    ],
  },
  {
    category: "priorities",
    questions: [
      "What is the minimum viable version? What can be deferred?",
      "Which features are must-have vs nice-to-have?",
      "What is the expected scale? (users, data volume, geographic distribution)",
    ],
  },
];

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const initialReq = args.join(" ");

  if (!initialReq && !args.includes("--resume")) {
    console.log(`
\x1b[36mquorum interview\x1b[0m — interactive requirement clarification

\x1b[1mUsage:\x1b[0m
  quorum interview "build a task management API"
  quorum interview --resume   (continue previous session)

Asks clarifying questions to reduce ambiguity before planning.
When requirements are clear, generates a structured summary for the planner.
`);
    return;
  }

  // Check for resume
  const summaryDir = resolve(repoRoot, ".claude", "quorum");
  const sessionPath = resolve(summaryDir, "interview-session.json");

  let state: RequirementState;

  if (args.includes("--resume") && existsSync(sessionPath)) {
    state = JSON.parse(readFileSync(sessionPath, "utf8"));
    console.log(`\n\x1b[36mResuming interview\x1b[0m — "${state.initial}"\n`);
    console.log(`  ${state.answers.length} questions answered so far.\n`);
  } else {
    state = {
      initial: initialReq,
      answers: [],
      scope: [],
      constraints: [],
      priorities: [],
      ambiguityScore: 1.0,
    };
    console.log(`\n\x1b[36mquorum interview\x1b[0m — "${initialReq}"\n`);
    console.log("  I'll ask some questions to clarify the requirement.");
    console.log("  Type your answer, or 'skip' to skip, 'done' to finish early.\n");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  // Ask questions by category
  for (const category of QUESTION_TEMPLATES) {
    const answeredInCategory = state.answers.filter((a) =>
      category.questions.includes(a.question),
    ).length;

    if (answeredInCategory >= category.questions.length) continue;

    console.log(`\x1b[1m  [${category.category.toUpperCase()}]\x1b[0m`);

    for (const question of category.questions) {
      if (state.answers.some((a) => a.question === question)) continue;

      const answer = await ask(`  ${question}\n  > `);

      if (answer.trim().toLowerCase() === "done") break;
      if (answer.trim().toLowerCase() === "skip") continue;

      state.answers.push({ question, answer: answer.trim() });

      // Classify answer
      if (category.category === "scope") state.scope.push(answer.trim());
      if (category.category === "constraints") state.constraints.push(answer.trim());
      if (category.category === "priorities") state.priorities.push(answer.trim());

      // Update ambiguity score
      state.ambiguityScore = computeAmbiguity(state);

      // Save session after each answer
      if (!existsSync(summaryDir)) mkdirSync(summaryDir, { recursive: true });
      writeFileSync(sessionPath, JSON.stringify(state, null, 2));

      if (state.ambiguityScore <= 0.2) {
        console.log(`\n  \x1b[32mAmbiguity score: ${state.ambiguityScore.toFixed(2)} — requirements are clear.\x1b[0m\n`);
        break;
      }

      console.log(`  \x1b[2m(ambiguity: ${state.ambiguityScore.toFixed(2)})\x1b[0m\n`);
    }

    if (state.ambiguityScore <= 0.2) break;
  }

  rl.close();

  // Generate summary
  const summary = generateSummary(state);
  const summaryPath = resolve(summaryDir, "interview-summary.md");
  writeFileSync(summaryPath, summary);

  console.log(`\x1b[32m  Summary written to:\x1b[0m ${summaryPath}`);
  console.log(`\n  Next steps:`);
  console.log(`    quorum plan           — view existing tracks`);
  console.log(`    /quorum:planner       — generate PRD + work breakdowns from this summary\n`);
}

function computeAmbiguity(state: RequirementState): number {
  const totalQuestions = QUESTION_TEMPLATES.reduce((sum, c) => sum + c.questions.length, 0);
  const answered = state.answers.length;
  const substantive = state.answers.filter((a) => a.answer.length > 20).length;

  // Base: fraction of questions unanswered
  const unanswered = 1 - (answered / totalQuestions);

  // Quality: short answers are less helpful
  const quality = answered > 0 ? substantive / answered : 0;

  // Coverage: all 3 categories should be covered
  const categories = new Set(QUESTION_TEMPLATES
    .filter((c) => state.answers.some((a) => c.questions.includes(a.question)))
    .map((c) => c.category));
  const coverage = categories.size / 3;

  return Math.max(0, Math.min(1, unanswered * 0.5 + (1 - quality) * 0.25 + (1 - coverage) * 0.25));
}

function generateSummary(state: RequirementState): string {
  const lines: string[] = [
    `# Interview Summary`,
    ``,
    `> Generated by \`quorum interview\``,
    `> Ambiguity score: ${state.ambiguityScore.toFixed(2)}`,
    ``,
    `## Original Requirement`,
    ``,
    state.initial,
    ``,
  ];

  if (state.scope.length > 0) {
    lines.push(`## Scope`, ``);
    for (const s of state.scope) lines.push(`- ${s}`);
    lines.push(``);
  }

  if (state.constraints.length > 0) {
    lines.push(`## Constraints`, ``);
    for (const c of state.constraints) lines.push(`- ${c}`);
    lines.push(``);
  }

  if (state.priorities.length > 0) {
    lines.push(`## Priorities`, ``);
    for (const p of state.priorities) lines.push(`- ${p}`);
    lines.push(``);
  }

  if (state.answers.length > 0) {
    lines.push(`## Q&A`, ``);
    for (const { question, answer } of state.answers) {
      lines.push(`**Q:** ${question}`);
      lines.push(`**A:** ${answer}`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}
