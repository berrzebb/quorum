// platform/skills — 36 Markdown-based skill definitions (no runtime TS code)
// Skill definitions live in {skill}/SKILL.md; this barrel exports the catalog only.

export const SKILL_NAMES = [
  "audit", "btw", "commit-convention", "consensus-tools", "convergence-loop",
  "designer", "doc-sync", "docx", "fde-analyst", "fixer", "gap-detector",
  "guide", "html-report", "implementer", "mcp-builder", "merge-worktree",
  "mermaid", "orchestrator", "pdf", "planner", "pptx", "qa-strategist",
  "report", "retrospect", "rollback", "rtm-scanner", "scout", "self-checker",
  "skill-authoring", "skill-gap", "skill-status", "specialist-review",
  "status", "ui-review", "verify-implementation", "wb-parser",
] as const;

export type SkillName = typeof SKILL_NAMES[number];
