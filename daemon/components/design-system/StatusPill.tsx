/**
 * StatusPill — icon + label status indicator.
 *
 * Adopted from Claude Code StatusIcon pattern.
 * Uses STATUS_GRAMMAR from density.ts as canonical color/icon source.
 *
 * Usage:
 *   <StatusPill status="gate.open" />
 *   <StatusPill status="agent.running" label="Agent-3" />
 *   <StatusPill icon="●" color="blue" label="Custom" />
 */

import React from "react";
import { Text } from "ink";
import { getStatusGrammar } from "../../shell/density.js";

export interface StatusPillProps {
  /** Status key from STATUS_GRAMMAR (e.g. "gate.open", "agent.running"). */
  status?: string;
  /** Override icon (emoji or character). */
  icon?: string;
  /** Override color. */
  color?: string;
  /** Override label. */
  label?: string;
  /** Whether to show the label text (default: true). */
  showLabel?: boolean;
  /** Whether the label should be bold. */
  bold?: boolean;
}

export function StatusPill({
  status,
  icon: iconOverride,
  color: colorOverride,
  label: labelOverride,
  showLabel = true,
  bold = false,
}: StatusPillProps): React.ReactElement {
  const grammar = status ? getStatusGrammar(status) : { icon: "?", color: "white", label: "" };
  const icon = iconOverride ?? grammar.icon;
  const color = colorOverride ?? grammar.color;
  const label = labelOverride ?? grammar.label;

  return (
    <Text>
      <Text color={color}>{icon}</Text>
      {showLabel && label ? (
        <Text bold={bold}>{" "}{label}</Text>
      ) : null}
    </Text>
  );
}
