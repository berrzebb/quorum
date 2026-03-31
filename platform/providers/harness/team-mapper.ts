/**
 * Harness Team Mapper — maps Harness-generated roles to quorum's role system.
 *
 * When Harness auto-generates an agent team, the roles may not directly
 * align with quorum's 9-role system. This mapper:
 * 1. Maps Harness role names to quorum roles
 * 2. Validates consensus coverage (advocate/devil/judge)
 * 3. Auto-supplements missing roles
 *
 * This enables "any language, any domain → automatic quality governance".
 */

// ── quorum Role System ──────────────────────────────────

export type QuorumRole =
  | "implementer"
  | "self-checker"
  | "fixer"
  | "scout"
  | "designer"
  | "fde-analyst"
  | "wb-parser"
  | "rtm-scanner"
  | "gap-detector"
  | "generic-specialist";

/** Mapping from common Harness/domain role names to quorum roles. */
const ROLE_MAP: Record<string, QuorumRole> = {
  // Builder variants → implementer
  builder: "implementer",
  developer: "implementer",
  coder: "implementer",
  programmer: "implementer",
  engineer: "implementer",
  writer: "implementer",
  creator: "implementer",
  "prose-stylist": "implementer",

  // Reviewer/QA variants → self-checker
  reviewer: "self-checker",
  qa: "self-checker",
  tester: "self-checker",
  validator: "self-checker",
  checker: "self-checker",
  verifier: "self-checker",
  "quality-assurance": "self-checker",
  "continuity-manager": "self-checker",

  // Analyst/Research variants → scout
  analyst: "scout",
  researcher: "scout",
  investigator: "scout",
  explorer: "scout",
  auditor: "scout",
  "background-researcher": "scout",
  "official-researcher": "scout",
  "media-researcher": "scout",
  "community-researcher": "scout",

  // Architect/Design variants → designer
  architect: "designer",
  designer: "designer",
  planner: "designer",
  strategist: "designer",
  "worldbuilder": "designer",
  "plot-architect": "designer",
  "character-designer": "designer",

  // Fix/repair variants → fixer
  fixer: "fixer",
  "bug-fixer": "fixer",
  debugger: "fixer",
  "error-handler": "fixer",

  // Science/domain expert → generic-specialist
  "science-consultant": "generic-specialist",
  specialist: "generic-specialist",
  expert: "generic-specialist",
  consultant: "generic-specialist",
};

// ── Types ───────────────────────────────────────────────

export interface HarnessAgent {
  /** Agent name from Harness output. */
  name: string;
  /** Role description from Harness. */
  role?: string;
  /** Architecture pattern used. */
  pattern?: string;
}

export interface MappedAgent {
  /** Original Harness agent name. */
  harnessName: string;
  /** Mapped quorum role. */
  quorumRole: QuorumRole;
  /** Confidence of the mapping (1.0 = exact match, 0.5 = fuzzy). */
  confidence: number;
  /** Whether this agent was auto-supplemented (not from Harness). */
  supplemented: boolean;
}

export interface TeamMappingResult {
  /** All mapped agents (Harness + supplemented). */
  agents: MappedAgent[];
  /** Whether the team satisfies consensus requirements. */
  consensusReady: boolean;
  /** Missing consensus roles (if any). */
  missingRoles: string[];
  /** Warnings about the mapping. */
  warnings: string[];
}

// ── Mapping ─────────────────────────────────────────────

/**
 * Map a single Harness agent name to a quorum role.
 */
export function mapRole(agentName: string): { role: QuorumRole; confidence: number } {
  const lower = agentName.toLowerCase().replace(/[_\s]+/g, "-");

  // 1. Exact match
  if (ROLE_MAP[lower]) {
    return { role: ROLE_MAP[lower], confidence: 1.0 };
  }

  // 2. Partial match — check if any key is contained in the name
  for (const [key, role] of Object.entries(ROLE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return { role, confidence: 0.8 };
    }
  }

  // 3. Keyword-based fuzzy match
  if (/build|implement|code|write|creat/i.test(agentName)) {
    return { role: "implementer", confidence: 0.6 };
  }
  if (/review|test|check|valid|verif|qa/i.test(agentName)) {
    return { role: "self-checker", confidence: 0.6 };
  }
  if (/analy|research|investigat|explor|scout/i.test(agentName)) {
    return { role: "scout", confidence: 0.6 };
  }
  if (/design|architect|plan|strateg/i.test(agentName)) {
    return { role: "designer", confidence: 0.6 };
  }
  if (/fix|debug|repair|patch/i.test(agentName)) {
    return { role: "fixer", confidence: 0.6 };
  }

  // 4. Unknown → generic specialist
  return { role: "generic-specialist", confidence: 0.3 };
}

/**
 * Map a full Harness team to quorum roles.
 * Validates consensus coverage and supplements missing roles.
 */
export function mapTeam(agents: HarnessAgent[]): TeamMappingResult {
  const mapped: MappedAgent[] = agents.map(a => {
    const { role, confidence } = mapRole(a.name);
    return {
      harnessName: a.name,
      quorumRole: role,
      confidence,
      supplemented: false,
    };
  });

  const warnings: string[] = [];

  // Check for low-confidence mappings
  for (const m of mapped) {
    if (m.confidence < 0.5) {
      warnings.push(
        `Agent "${m.harnessName}" mapped to "${m.quorumRole}" with low confidence (${m.confidence}). Consider manual role assignment.`
      );
    }
  }

  // Check consensus coverage
  // For audit consensus, we need at least:
  // - An implementer (produces code to audit)
  // - A self-checker or scout (provides independent verification)
  const roles = new Set(mapped.map(m => m.quorumRole));
  const missingRoles: string[] = [];

  if (!roles.has("implementer")) {
    missingRoles.push("implementer");
  }
  if (!roles.has("self-checker") && !roles.has("scout")) {
    missingRoles.push("self-checker");
  }

  // Auto-supplement missing roles
  for (const missing of missingRoles) {
    mapped.push({
      harnessName: `quorum-${missing}`,
      quorumRole: missing as QuorumRole,
      confidence: 1.0,
      supplemented: true,
    });
    warnings.push(`Auto-supplemented "${missing}" agent for consensus coverage.`);
  }

  return {
    agents: mapped,
    consensusReady: missingRoles.length === 0 || mapped.some(m => m.supplemented),
    missingRoles,
    warnings,
  };
}

/**
 * Get the quorum protocol file path for a given role.
 * Returns null if no specific protocol exists.
 */
export function getProtocolPath(role: QuorumRole): string | null {
  switch (role) {
    case "implementer": return "agents/knowledge/implementer-protocol.md";
    case "scout": return "agents/knowledge/scout-protocol.md";
    case "self-checker": return "agents/knowledge/specialist-base.md";
    case "fixer": return "agents/knowledge/implementer-protocol.md";
    case "designer": return null; // designer uses skill-specific protocol
    case "fde-analyst": return null;
    case "wb-parser": return null;
    case "rtm-scanner": return "agents/knowledge/scout-protocol.md";
    case "gap-detector": return "agents/knowledge/scout-protocol.md";
    case "generic-specialist": return "agents/knowledge/specialist-base.md";
    default: return null;
  }
}
