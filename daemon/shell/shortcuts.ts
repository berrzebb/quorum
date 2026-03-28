/**
 * DUX-7: Shortcut binding registry with scope-aware resolution.
 *
 * All shortcut definitions live here. Help overlay and footer hints
 * read from these registries — no hardcoded shortcut text elsewhere.
 */

import type { DaemonView } from "./app-shell.js";

/**
 * Shortcut binding definition.
 */
export interface ShortcutBinding {
  key: string;
  description: string;
  action: string;
  scope: "global" | "view" | "panel" | "input";
}

/**
 * Global shortcuts (available in all views).
 */
export const GLOBAL_SHORTCUTS: ShortcutBinding[] = [
  { key: "1", description: "Overview view", action: "view:overview", scope: "global" },
  { key: "2", description: "Review view", action: "view:review", scope: "global" },
  { key: "3", description: "Chat view", action: "view:chat", scope: "global" },
  { key: "4", description: "Operations view", action: "view:operations", scope: "global" },
  { key: "tab", description: "Next focus region", action: "focus:next", scope: "global" },
  { key: "shift+tab", description: "Previous focus region", action: "focus:prev", scope: "global" },
  { key: "?", description: "Help overlay", action: "overlay:help", scope: "global" },
  { key: ":", description: "Command palette", action: "overlay:command", scope: "global" },
  { key: "q", description: "Quit daemon", action: "app:quit", scope: "global" },
];

/**
 * Chat view shortcuts.
 */
export const CHAT_SHORTCUTS: ShortcutBinding[] = [
  { key: "left", description: "Previous session", action: "session:prev", scope: "panel" },
  { key: "right", description: "Next session", action: "session:next", scope: "panel" },
  { key: "up", description: "Scroll up", action: "scroll:up", scope: "panel" },
  { key: "down", description: "Scroll down", action: "scroll:down", scope: "panel" },
  { key: "pageup", description: "Page up", action: "scroll:pageup", scope: "panel" },
  { key: "pagedown", description: "Page down", action: "scroll:pagedown", scope: "panel" },
  { key: "home", description: "Jump to top", action: "scroll:top", scope: "panel" },
  { key: "end", description: "Jump to bottom", action: "scroll:bottom", scope: "panel" },
  { key: "enter", description: "Focus composer / submit", action: "composer:focus", scope: "panel" },
  { key: "i", description: "Focus composer", action: "composer:focus", scope: "panel" },
  { key: "escape", description: "Leave composer", action: "composer:blur", scope: "input" },
  { key: "v", description: "Selection mode toggle", action: "selection:toggle", scope: "panel" },
  { key: "y", description: "Copy selection", action: "clipboard:copy", scope: "panel" },
  { key: "p", description: "Paste to composer", action: "clipboard:paste", scope: "input" },
  { key: "g", description: "Focus commit graph", action: "focus:git.commits", scope: "panel" },
  { key: "f", description: "Focus changed files", action: "focus:git.files", scope: "panel" },
  { key: "s", description: "Focus session list", action: "focus:sessions", scope: "panel" },
  { key: "t", description: "Focus transcript", action: "focus:transcript", scope: "panel" },
];

/**
 * Get effective shortcuts for a view + region.
 */
export function getEffectiveShortcuts(
  view: DaemonView,
  _focusedRegion: string | null,
  overlay: "none" | "help" | "command"
): ShortcutBinding[] {
  // Overlay shortcuts take priority
  if (overlay !== "none") {
    return [
      { key: "escape", description: "Close overlay", action: "overlay:close", scope: "global" },
      ...GLOBAL_SHORTCUTS.filter(s => s.key !== "?"),
    ];
  }

  const result = [...GLOBAL_SHORTCUTS];

  if (view === "chat") {
    result.push(...CHAT_SHORTCUTS);
  }

  return result;
}

/**
 * Get footer hint shortcuts (top N most relevant).
 */
export function getFooterHints(
  view: DaemonView,
  focusedRegion: string | null,
  overlay: "none" | "help" | "command",
  maxHints: number = 5
): ShortcutBinding[] {
  const effective = getEffectiveShortcuts(view, focusedRegion, overlay);
  return effective.slice(0, maxHints);
}

/**
 * Check for key collisions between scopes.
 */
export function findKeyCollisions(): Array<{ key: string; bindings: ShortcutBinding[] }> {
  const byKey = new Map<string, ShortcutBinding[]>();

  for (const binding of [...GLOBAL_SHORTCUTS, ...CHAT_SHORTCUTS]) {
    const existing = byKey.get(binding.key) ?? [];
    existing.push(binding);
    byKey.set(binding.key, existing);
  }

  return Array.from(byKey.entries())
    .filter(([_, bindings]) => {
      // Same scope = collision. Different scope = OK (panel overrides global).
      const scopes = new Set(bindings.map(b => b.scope));
      return bindings.length > 1 && scopes.size < bindings.length;
    })
    .map(([key, bindings]) => ({ key, bindings }));
}
