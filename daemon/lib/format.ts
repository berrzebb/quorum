/** Shared formatting utilities for daemon TUI panels. */

/** Map finding severity to Ink color name. */
export function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "red";
    case "major": return "yellow";
    case "minor": return "green";
    default: return "gray";
  }
}

/** Pad string to length, truncating if longer. */
export function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}
