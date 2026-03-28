/**
 * DUX-6: View navigation utilities.
 *
 * Pure functions for view switching, shortcut resolution, and focus management.
 */

import { VIEW_REGISTRY, type DaemonView } from "./app-shell.js";

/**
 * Get the view for a shortcut key.
 */
export function viewForKey(key: string): DaemonView | null {
  const view = VIEW_REGISTRY.find(v => v.shortcut === key);
  return view?.id ?? null;
}

/**
 * Get the next view in sequence.
 */
export function nextView(current: DaemonView): DaemonView {
  const idx = VIEW_REGISTRY.findIndex(v => v.id === current);
  return VIEW_REGISTRY[(idx + 1) % VIEW_REGISTRY.length].id;
}

/**
 * Get the previous view in sequence.
 */
export function prevView(current: DaemonView): DaemonView {
  const idx = VIEW_REGISTRY.findIndex(v => v.id === current);
  return VIEW_REGISTRY[(idx - 1 + VIEW_REGISTRY.length) % VIEW_REGISTRY.length].id;
}

/**
 * Get the default focus region for a view.
 */
export function defaultFocusForView(view: DaemonView): string | null {
  const desc = VIEW_REGISTRY.find(v => v.id === view);
  return desc?.defaultFocus ?? null;
}
