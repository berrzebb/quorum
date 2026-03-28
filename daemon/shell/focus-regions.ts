/**
 * DUX-7: Focus region registry with cycle management.
 *
 * Defines all focusable regions, per-view focus cycles, and cycle navigation.
 * Pure data + functions — no React/Ink dependency.
 */

/**
 * Focus region definition.
 */
export interface FocusRegion {
  id: string;
  scope: "global" | "view" | "panel" | "input" | "overlay";
  purpose: string;
}

/**
 * All 16 focus regions.
 */
export const FOCUS_REGIONS: FocusRegion[] = [
  { id: "header.tabs", scope: "global", purpose: "view tab navigation" },
  { id: "footer.hints", scope: "global", purpose: "current scope shortcut hints" },
  { id: "overlay.help", scope: "overlay", purpose: "shortcut/help overlay" },
  { id: "overlay.command", scope: "overlay", purpose: "command palette" },
  { id: "overview.summary", scope: "view", purpose: "overview key cards" },
  { id: "overview.gates", scope: "panel", purpose: "gate summary" },
  { id: "overview.tracks", scope: "panel", purpose: "track progress" },
  { id: "review.findings", scope: "panel", purpose: "finding list" },
  { id: "review.thread", scope: "panel", purpose: "thread inspector" },
  { id: "chat.sessions", scope: "panel", purpose: "mux session list" },
  { id: "chat.transcript", scope: "panel", purpose: "transcript viewport" },
  { id: "chat.composer", scope: "input", purpose: "message composer" },
  { id: "chat.git.commits", scope: "panel", purpose: "commit graph" },
  { id: "chat.git.files", scope: "panel", purpose: "changed files" },
  { id: "operations.providers", scope: "panel", purpose: "provider/runtime status" },
  { id: "operations.worktrees", scope: "panel", purpose: "git/worktree/lock status" },
];

/**
 * Focus cycles per view.
 */
export const FOCUS_CYCLES: Record<string, string[]> = {
  overview: ["overview.summary", "overview.gates", "overview.tracks"],
  review: ["review.findings", "review.thread"],
  chat: ["chat.sessions", "chat.transcript", "chat.composer", "chat.git.commits", "chat.git.files"],
  operations: ["operations.providers", "operations.worktrees"],
};

/**
 * Get the next focus region in the cycle for a view.
 */
export function nextFocusInCycle(view: string, currentRegion: string | null): string {
  const cycle = FOCUS_CYCLES[view];
  if (!cycle || cycle.length === 0) return currentRegion ?? "";
  if (!currentRegion) return cycle[0];
  const idx = cycle.indexOf(currentRegion);
  if (idx === -1) return cycle[0];
  return cycle[(idx + 1) % cycle.length];
}

/**
 * Get the previous focus region in the cycle for a view.
 */
export function prevFocusInCycle(view: string, currentRegion: string | null): string {
  const cycle = FOCUS_CYCLES[view];
  if (!cycle || cycle.length === 0) return currentRegion ?? "";
  if (!currentRegion) return cycle[0];
  const idx = cycle.indexOf(currentRegion);
  if (idx === -1) return cycle[0];
  return cycle[(idx - 1 + cycle.length) % cycle.length];
}

/**
 * Get regions for a view (filter by view prefix).
 */
export function regionsForView(view: string): FocusRegion[] {
  return FOCUS_REGIONS.filter(r => r.id.startsWith(`${view}.`));
}

/**
 * Adjust focus cycle for terminal width (hide git sidebar regions when narrow).
 */
export function adjustedChatCycle(termWidth: number): string[] {
  const full = FOCUS_CYCLES.chat;
  if (termWidth < 100) {
    return full.filter(r => !r.startsWith("chat.git."));
  }
  return [...full];
}
