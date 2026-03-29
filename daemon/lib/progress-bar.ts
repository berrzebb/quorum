/** Shared progress bar rendering for daemon TUI panels. */

/** Render a filled/empty bar. value: 0–1 ratio, width: character count. */
export function bar(value: number, width: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const filled = Math.max(0, Math.min(width, Math.round(v * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
