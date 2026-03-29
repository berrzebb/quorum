/** Shared time formatting utilities for daemon TUI panels. */

/** Format timestamp as "Xs ago" / "Xm ago" / "Xh ago". Clamps to 0 for future timestamps. */
export function elapsed(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/** Seconds since timestamp, rounded. Returns 0 for future timestamps or invalid input. */
export function ageSeconds(ts: number): number {
  if (!ts || !Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}
