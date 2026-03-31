/**
 * Transcript Search Controller — coordinates search pipeline for daemon UI.
 *
 * Pure logic module (no React/Ink dependency) that wires:
 * - TranscriptIndex (RTI-3B) for indexing and querying
 * - SearchStateProjection (RTI-3C) for UI state
 * - TranscriptPane navigation (line jump to hit)
 *
 * The UI components (chat-view, transcript-pane) consume this via
 * the projection interface — they never call the index directly.
 *
 * @since RTI-4
 * @module daemon/lib/transcript-search
 */

import { TranscriptIndex } from "../../platform/bus/transcript-index.js";
import type { TranscriptHit } from "../../platform/bus/transcript-index.js";
import {
  emptySearchState,
  projectSearchState,
  nextSearchHit,
  prevSearchHit,
} from "../../platform/bus/provider-session-projector.js";
import type { SearchStateProjection } from "../../platform/bus/provider-session-projector.js";

// ── Search Controller ───────────────────────────────

export interface TranscriptSearchController {
  /** Underlying index. */
  readonly index: TranscriptIndex;
  /** Current search state (for UI). */
  state: SearchStateProjection;

  /** Feed raw transcript lines into the index. */
  feedLines(sessionId: string, rawLines: string[]): number;
  /** Execute a search and update state. */
  search(query: string, sessionId: string): SearchStateProjection;
  /** Navigate to next hit. */
  next(): SearchStateProjection;
  /** Navigate to previous hit. */
  prev(): SearchStateProjection;
  /** Clear search state. */
  clear(): SearchStateProjection;
  /** Get the scroll offset to jump to the focused hit. */
  scrollToFocusedHit(): number | null;
}

/**
 * Create a transcript search controller.
 *
 * This is the single coordination point for transcript search in the daemon.
 * UI components call feedLines() as transcript grows, search() on user input,
 * next()/prev() on navigation, and scrollToFocusedHit() for jump-to-line.
 *
 * @since RTI-4
 */
export function createSearchController(
  maxEntriesPerSession?: number,
): TranscriptSearchController {
  const index = new TranscriptIndex(maxEntriesPerSession);
  let currentState = emptySearchState();

  return {
    get index() { return index; },
    get state() { return currentState; },
    set state(s: SearchStateProjection) { currentState = s; },

    feedLines(sessionId: string, rawLines: string[]): number {
      return index.appendBatch(sessionId, rawLines);
    },

    search(query: string, sessionId: string): SearchStateProjection {
      if (!query.trim()) {
        currentState = emptySearchState();
        return currentState;
      }

      const start = Date.now();
      const hits = index.query(sessionId, query);
      const elapsed = Date.now() - start;

      currentState = projectSearchState(
        query,
        "session",
        hits.map(h => ({
          sessionId: h.sessionId,
          line: h.line,
          excerpt: h.excerpt,
          score: h.score,
          section: h.section,
        })),
        index.entryCount(sessionId),
        elapsed,
        sessionId,
      );

      return currentState;
    },

    next(): SearchStateProjection {
      currentState = nextSearchHit(currentState);
      return currentState;
    },

    prev(): SearchStateProjection {
      currentState = prevSearchHit(currentState);
      return currentState;
    },

    clear(): SearchStateProjection {
      currentState = emptySearchState();
      return currentState;
    },

    scrollToFocusedHit(): number | null {
      if (currentState.focusedHitIndex < 0) return null;
      if (currentState.focusedHitIndex >= currentState.hits.length) return null;
      return currentState.hits[currentState.focusedHitIndex].line;
    },
  };
}

/**
 * Check if a transcript line matches the current search query.
 * Used for hit highlighting in TranscriptPane.
 *
 * @since RTI-4
 */
export function isSearchHitLine(
  state: SearchStateProjection,
  lineIndex: number,
): boolean {
  if (!state.active) return false;
  return state.hits.some(h => h.line === lineIndex);
}

/**
 * Check if a transcript line is the currently focused hit.
 * Used for focused-hit styling in TranscriptPane.
 *
 * @since RTI-4
 */
export function isFocusedHitLine(
  state: SearchStateProjection,
  lineIndex: number,
): boolean {
  if (!state.active || state.focusedHitIndex < 0) return false;
  const focused = state.hits[state.focusedHitIndex];
  return focused?.line === lineIndex;
}
