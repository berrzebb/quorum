/**
 * Density modes and status grammar — consistent visual language across panels.
 *
 * Density modes control padding, borders, and list truncation.
 * Status grammar provides icon/color/label triples for every state.
 */

// ── Density Modes ────────────────────────────

export type DensityMode = "comfortable" | "compact";

/**
 * Density configuration for panels.
 */
export interface DensityConfig {
  mode: DensityMode;
  panelPadding: number;
  showBorders: boolean;
  maxListItems: number;
  showSparklines: boolean;
}

export function getDensityConfig(mode: DensityMode): DensityConfig {
  switch (mode) {
    case "compact":
      return { mode, panelPadding: 0, showBorders: false, maxListItems: 5, showSparklines: false };
    case "comfortable":
    default:
      return { mode, panelPadding: 1, showBorders: true, maxListItems: 10, showSparklines: true };
  }
}

// ── Status Grammar ───────────────────────────

/**
 * Status grammar — consistent status display across panels.
 */
export interface StatusGrammar {
  icon: string;
  color: string;
  label: string;
}

export const STATUS_GRAMMAR: Record<string, StatusGrammar> = {
  "gate.open": { icon: "\u25CF", color: "green", label: "Open" },
  "gate.blocked": { icon: "\u25CF", color: "red", label: "Blocked" },
  "gate.pending": { icon: "\u25CF", color: "yellow", label: "Pending" },
  "gate.error": { icon: "\u26A0", color: "red", label: "Error" },
  "agent.running": { icon: "\u25CF", color: "green", label: "Running" },
  "agent.idle": { icon: "\u25CB", color: "white", label: "Idle" },
  "agent.auditing": { icon: "\u25CF", color: "yellow", label: "Auditing" },
  "agent.correcting": { icon: "\u25CF", color: "blue", label: "Correcting" },
  "agent.done": { icon: "\u2713", color: "green", label: "Done" },
  "agent.error": { icon: "\u25CF", color: "red", label: "Error" },
  "finding.critical": { icon: "!", color: "red", label: "Critical" },
  "finding.major": { icon: "\u25B2", color: "yellow", label: "Major" },
  "finding.minor": { icon: "\u00B7", color: "white", label: "Minor" },
  "verdict.approved": { icon: "\u2713", color: "green", label: "Approved" },
  "verdict.changes_requested": { icon: "\u2717", color: "red", label: "Changes Requested" },
  "verdict.infra_failure": { icon: "\u26A0", color: "yellow", label: "Infra Failure" },
};

export function getStatusGrammar(key: string): StatusGrammar {
  return STATUS_GRAMMAR[key] ?? { icon: "?", color: "white", label: key };
}
