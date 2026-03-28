/**
 * Per-session viewport state — scroll position, selection mode.
 */
export interface SessionViewportState {
  sessionId: string;
  transcriptOffset: number;
  selectionStart?: number;
  selectionEnd?: number;
  selectionMode: "none" | "line";
}

/**
 * Per-session composer state — input buffer, mode.
 */
export interface ComposerState {
  sessionId: string;
  buffer: string;
  mode: "idle" | "input";
}

/**
 * Clipboard selection — copied text with source info.
 */
export interface ClipboardSelection {
  sessionId: string;
  text: string;
  lineRange: [number, number];
  source: "transcript" | "composer";
}

/**
 * Session state manager — maintains per-session viewport and composer state.
 */
export class SessionStateManager {
  private viewports = new Map<string, SessionViewportState>();
  private composers = new Map<string, ComposerState>();
  private clipboard: ClipboardSelection | null = null;

  /**
   * Get or create viewport state for a session.
   */
  getViewport(sessionId: string): SessionViewportState {
    let state = this.viewports.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        transcriptOffset: 0,
        selectionMode: "none",
      };
      this.viewports.set(sessionId, state);
    }
    return state;
  }

  /**
   * Update scroll offset for a session.
   */
  scrollTo(sessionId: string, offset: number): void {
    const state = this.getViewport(sessionId);
    state.transcriptOffset = Math.max(0, offset);
  }

  /**
   * Scroll by delta.
   */
  scrollBy(sessionId: string, delta: number): void {
    const state = this.getViewport(sessionId);
    state.transcriptOffset = Math.max(0, state.transcriptOffset + delta);
  }

  /**
   * Toggle selection mode.
   */
  toggleSelectionMode(sessionId: string): void {
    const state = this.getViewport(sessionId);
    if (state.selectionMode === "none") {
      state.selectionMode = "line";
      state.selectionStart = state.transcriptOffset;
      state.selectionEnd = state.transcriptOffset;
    } else {
      state.selectionMode = "none";
      state.selectionStart = undefined;
      state.selectionEnd = undefined;
    }
  }

  /**
   * Extend selection by delta lines.
   */
  extendSelection(sessionId: string, delta: number): void {
    const state = this.getViewport(sessionId);
    if (state.selectionMode !== "line" || state.selectionEnd === undefined) return;
    state.selectionEnd = Math.max(0, state.selectionEnd + delta);
  }

  /**
   * Copy selected text to clipboard.
   */
  copySelection(sessionId: string, lines: string[]): ClipboardSelection | null {
    const state = this.getViewport(sessionId);
    if (state.selectionMode !== "line" ||
        state.selectionStart === undefined ||
        state.selectionEnd === undefined) {
      return null;
    }
    const start = Math.min(state.selectionStart, state.selectionEnd);
    const end = Math.max(state.selectionStart, state.selectionEnd);
    const selectedLines = lines.slice(start, end + 1);
    this.clipboard = {
      sessionId,
      text: selectedLines.join("\n"),
      lineRange: [start, end],
      source: "transcript",
    };
    return this.clipboard;
  }

  /**
   * Get current clipboard.
   */
  getClipboard(): ClipboardSelection | null {
    return this.clipboard;
  }

  /**
   * Get or create composer state for a session.
   */
  getComposer(sessionId: string): ComposerState {
    let state = this.composers.get(sessionId);
    if (!state) {
      state = { sessionId, buffer: "", mode: "idle" };
      this.composers.set(sessionId, state);
    }
    return state;
  }

  /**
   * Set composer mode.
   */
  setComposerMode(sessionId: string, mode: "idle" | "input"): void {
    const state = this.getComposer(sessionId);
    state.mode = mode;
  }

  /**
   * Update composer buffer.
   */
  setComposerBuffer(sessionId: string, buffer: string): void {
    const state = this.getComposer(sessionId);
    state.buffer = buffer;
  }

  /**
   * Paste clipboard text into composer buffer.
   */
  pasteToComposer(sessionId: string): string {
    if (!this.clipboard) return "";
    const composer = this.getComposer(sessionId);
    composer.buffer += this.clipboard.text;
    return composer.buffer;
  }

  /**
   * Clear and return composer buffer (for submit).
   */
  submitComposer(sessionId: string): string {
    const composer = this.getComposer(sessionId);
    const text = composer.buffer;
    composer.buffer = "";
    composer.mode = "idle";
    return text;
  }

  /**
   * Clean up state for a closed session.
   */
  removeSession(sessionId: string): void {
    this.viewports.delete(sessionId);
    this.composers.delete(sessionId);
  }
}
