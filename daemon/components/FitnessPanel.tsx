/**
 * FitnessPanel — real-time fitness score visualization for the TUI dashboard.
 *
 * Shows:
 * - Current score + gate decision
 * - ASCII sparkline of score history
 * - Component breakdown with proportional bars
 * - Trend indicator (slope direction)
 */

import React from "react";
import { Box, Text } from "ink";
import type { FitnessInfo } from "../state-reader.js";
import { bar } from "../lib/progress-bar.js";

interface FitnessPanelProps {
  fitness: FitnessInfo;
}

export function FitnessPanel({ fitness }: FitnessPanelProps) {
  const { current, baseline, gate, history, trend, components } = fitness;
  const hasData = current !== null || history.length > 0;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={36}>
      <Text bold>Fitness Score</Text>
      <Text dimColor>{"─".repeat(32)}</Text>

      {!hasData ? (
        <Text dimColor>No fitness data yet</Text>
      ) : (
        <>
          {/* Score + gate */}
          <Box gap={1}>
            <Text>Score: </Text>
            <Text color={scoreColor(current ?? 0)} bold>
              {(current ?? 0).toFixed(3)}
            </Text>
            {baseline !== null && (
              <Text dimColor> base:{baseline.toFixed(3)}</Text>
            )}
          </Box>

          {gate && (
            <Box gap={1}>
              <Text>Gate:  </Text>
              <Text color={gateColor(gate.decision)} bold>
                {gateIcon(gate.decision)} {gate.decision}
              </Text>
              {gate.delta !== 0 && (
                <Text color={gate.delta > 0 ? "green" : "red"}>
                  {" "}{gate.delta > 0 ? "+" : ""}{gate.delta.toFixed(3)}
                </Text>
              )}
            </Box>
          )}

          {/* Trend */}
          {trend && (
            <Box gap={1}>
              <Text>Trend: </Text>
              <Text color={trend.slope > 0.001 ? "green" : trend.slope < -0.001 ? "red" : "yellow"}>
                {trendArrow(trend.slope)} avg:{trend.movingAverage.toFixed(3)}
              </Text>
            </Box>
          )}

          {/* Sparkline */}
          {history.length > 1 && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>History ({history.length} pts)</Text>
              <Text>{sparkline(history)}</Text>
            </Box>
          )}

          {/* Component breakdown */}
          {components && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Components</Text>
              {Object.entries(components).map(([key, comp]) => (
                <Box key={key}>
                  <Text>{padRight(comp.label ?? key, 13)}</Text>
                  <Text color={scoreColor(comp.value)}>
                    {bar(comp.value, 10)}
                  </Text>
                  <Text dimColor> {(Number.isFinite(comp.value) ? (comp.value * 100).toFixed(0) : "?").padStart(3)}%</Text>
                  <Text dimColor> w:{comp.weight}</Text>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// ── Helpers ──────────────────────────────────

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  // Show last 24 data points max
  const recent = values.slice(-24);
  return recent.map((v) => {
    const idx = Math.min(Math.floor(((v - min) / range) * (SPARK_CHARS.length - 1)), SPARK_CHARS.length - 1);
    return SPARK_CHARS[idx];
  }).join("");
}

function scoreColor(score: number): string {
  if (!Number.isFinite(score)) return "red";
  if (score < 0.3) return "red";
  if (score < 0.6) return "yellow";
  return "green";
}

function gateColor(decision: string): string {
  switch (decision) {
    case "proceed": return "green";
    case "self-correct": return "yellow";
    case "auto-reject": return "red";
    default: return "gray";
  }
}

function gateIcon(decision: string): string {
  switch (decision) {
    case "proceed": return "✓";
    case "self-correct": return "⚠";
    case "auto-reject": return "✕";
    default: return "?";
  }
}

function trendArrow(slope: number): string {
  if (slope > 0.01) return "↑↑";
  if (slope > 0.001) return "↑";
  if (slope < -0.01) return "↓↓";
  if (slope < -0.001) return "↓";
  return "→";
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}
