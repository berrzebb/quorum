/**
 * Daemon Store — subscription-based state management for TUI panels.
 *
 * Adopted from Claude Code state/AppStateStore.ts pattern:
 * - Store holds FullState snapshot
 * - Panels subscribe to slices via selectors
 * - Re-render only when selected slice changes (fingerprint comparison)
 * - Replaces props drilling in app.tsx
 *
 * Usage:
 *   const store = createStore(initialState);
 *   const unsub = store.subscribe(s => s.gates, gates => { render(gates); });
 *   store.setState(newState);  // triggers subscribers whose slice changed
 *
 * @module daemon/state/store
 */

import type { FullState } from "./snapshot.js";

// ── Types ───────────────────────────────────────────

export type Selector<T> = (state: FullState) => T;
export type Listener<T> = (slice: T, prevSlice: T) => void;

export interface Subscription {
  /** Unsubscribe from state changes. */
  unsubscribe(): void;
}

export interface DaemonStore {
  /** Get current state snapshot. */
  getState(): FullState;

  /** Replace state entirely (triggers all relevant subscribers). */
  setState(next: FullState): void;

  /** Update state via a producer function. */
  update(fn: (prev: FullState) => FullState): void;

  /**
   * Subscribe to a slice of state via selector.
   * Listener fires only when the selected slice changes
   * (by reference or shallow fingerprint).
   */
  subscribe<T>(selector: Selector<T>, listener: Listener<T>): Subscription;

  /**
   * Subscribe to the full state.
   * Listener fires on every setState call.
   */
  subscribeAll(listener: Listener<FullState>): Subscription;

  /** Number of active subscriptions (for diagnostics). */
  subscriberCount(): number;

  /** Destroy store and remove all subscriptions. */
  destroy(): void;
}

// ── Fingerprinting ──────────────────────────────────

/**
 * Cheap fingerprint for arrays — length + first/last element identity.
 * Avoids deep comparison while catching most real changes.
 */
function arrayFingerprint(arr: unknown[]): string {
  if (arr.length === 0) return "[]";
  return `[${arr.length}:${arr[0] === arr[arr.length - 1] ? "same" : "diff"}]`;
}

/**
 * Determine if a selected slice has changed.
 * Uses reference equality first, then shallow fingerprint for arrays.
 */
function hasChanged<T>(prev: T, next: T): boolean {
  if (prev === next) return false;
  if (prev == null || next == null) return true;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return true;
    // Check first and last elements by reference (cheap heuristic)
    if (prev.length > 0) {
      if (prev[0] !== next[0]) return true;
      if (prev[prev.length - 1] !== next[next.length - 1]) return true;
    }
    return false; // Same length + same endpoints → likely same
  }
  if (typeof prev === "object" && typeof next === "object") {
    // Shallow comparison for plain objects
    const prevKeys = Object.keys(prev as Record<string, unknown>);
    const nextKeys = Object.keys(next as Record<string, unknown>);
    if (prevKeys.length !== nextKeys.length) return true;
    for (const key of prevKeys) {
      if ((prev as Record<string, unknown>)[key] !== (next as Record<string, unknown>)[key]) return true;
    }
    return false;
  }
  return true;
}

// ── Store implementation ────────────────────────────

interface Sub<T = unknown> {
  selector: Selector<T>;
  listener: Listener<T>;
  prevSlice: T;
}

/**
 * Create a daemon state store.
 */
export function createStore(initial: FullState): DaemonStore {
  let state = initial;
  let subs: Sub[] = [];
  let destroyed = false;

  function notifySubscribers(): void {
    for (const sub of subs) {
      const nextSlice = sub.selector(state);
      if (hasChanged(sub.prevSlice, nextSlice)) {
        const prev = sub.prevSlice;
        sub.prevSlice = nextSlice;
        try {
          sub.listener(nextSlice, prev);
        } catch (err) {
          console.warn(`[daemon-store] subscriber error: ${(err as Error).message}`);
        }
      }
    }
  }

  return {
    getState() {
      return state;
    },

    setState(next: FullState) {
      if (destroyed) return;
      state = next;
      notifySubscribers();
    },

    update(fn: (prev: FullState) => FullState) {
      if (destroyed) return;
      state = fn(state);
      notifySubscribers();
    },

    subscribe<T>(selector: Selector<T>, listener: Listener<T>): Subscription {
      const sub: Sub<T> = {
        selector,
        listener,
        prevSlice: selector(state),
      };
      subs.push(sub as Sub);

      return {
        unsubscribe() {
          subs = subs.filter(s => s !== (sub as Sub));
        },
      };
    },

    subscribeAll(listener: Listener<FullState>): Subscription {
      return this.subscribe(s => s, listener);
    },

    subscriberCount() {
      return subs.length;
    },

    destroy() {
      destroyed = true;
      subs = [];
    },
  };
}
