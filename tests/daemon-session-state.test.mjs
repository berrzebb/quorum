#!/usr/bin/env node
/**
 * DUX-11: Per-session scroll/copy/paste state management.
 *
 * Tests SessionStateManager — viewport, selection, clipboard,
 * composer, session isolation, and cross-session clipboard.
 *
 * Run: node --test tests/daemon-session-state.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const MOD_PATH = "../dist/daemon/panels/sessions/session-state.js";

async function createManager() {
  const mod = await import(MOD_PATH);
  return new mod.SessionStateManager();
}

// ═══ 1. SessionViewportState ═════════════════════════════════════════

describe("DUX-11: SessionViewportState", () => {
  it("getViewport returns same instance on second call", async () => {
    const mgr = await createManager();
    const vp1 = mgr.getViewport("s1");
    const vp2 = mgr.getViewport("s1");
    assert.equal(vp1, vp2, "Should return same object reference");
  });

  it("scrollTo sets offset", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 42);
    assert.equal(mgr.getViewport("s1").transcriptOffset, 42);
  });

  it("scrollTo clamps to 0 (no negative)", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", -10);
    assert.equal(mgr.getViewport("s1").transcriptOffset, 0);
  });

  it("scrollBy adds to current offset", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 10);
    mgr.scrollBy("s1", 5);
    assert.equal(mgr.getViewport("s1").transcriptOffset, 15);
  });

  it("scrollBy clamps to 0", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 3);
    mgr.scrollBy("s1", -10);
    assert.equal(mgr.getViewport("s1").transcriptOffset, 0);
  });
});

// ═══ 2. Selection mode ═══════════════════════════════════════════════

describe("DUX-11: Selection mode", () => {
  it("toggleSelectionMode: none → line (sets selectionStart/End to current offset)", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 5);
    mgr.toggleSelectionMode("s1");
    const vp = mgr.getViewport("s1");
    assert.equal(vp.selectionMode, "line");
    assert.equal(vp.selectionStart, 5);
    assert.equal(vp.selectionEnd, 5);
  });

  it("toggleSelectionMode: line → none (clears selectionStart/End)", async () => {
    const mgr = await createManager();
    mgr.toggleSelectionMode("s1");
    mgr.toggleSelectionMode("s1");
    const vp = mgr.getViewport("s1");
    assert.equal(vp.selectionMode, "none");
    assert.equal(vp.selectionStart, undefined);
    assert.equal(vp.selectionEnd, undefined);
  });

  it("extendSelection moves selectionEnd by delta", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 3);
    mgr.toggleSelectionMode("s1");
    mgr.extendSelection("s1", 4);
    assert.equal(mgr.getViewport("s1").selectionEnd, 7);
  });

  it("extendSelection clamps to 0", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 2);
    mgr.toggleSelectionMode("s1");
    mgr.extendSelection("s1", -10);
    assert.equal(mgr.getViewport("s1").selectionEnd, 0);
  });

  it("extendSelection is no-op when not in line mode", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 5);
    mgr.extendSelection("s1", 3);
    const vp = mgr.getViewport("s1");
    assert.equal(vp.selectionMode, "none");
    assert.equal(vp.selectionEnd, undefined);
  });
});

// ═══ 3. Copy/Paste ══════════════════════════════════════════════════

describe("DUX-11: Copy/Paste", () => {
  const lines = ["line 0", "line 1", "line 2", "line 3", "line 4"];

  it("copySelection with valid selection returns ClipboardSelection", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 1);
    mgr.toggleSelectionMode("s1");
    mgr.extendSelection("s1", 2); // selectionEnd = 3
    const clip = mgr.copySelection("s1", lines);
    assert.notEqual(clip, null);
    assert.equal(clip.sessionId, "s1");
    assert.equal(clip.text, "line 1\nline 2\nline 3");
    assert.deepEqual(clip.lineRange, [1, 3]);
    assert.equal(clip.source, "transcript");
  });

  it("copySelection handles reversed selection (start > end)", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 4);
    mgr.toggleSelectionMode("s1"); // start=4, end=4
    // Manually set reversed range via extend
    const vp = mgr.getViewport("s1");
    vp.selectionEnd = 1; // end < start
    const clip = mgr.copySelection("s1", lines);
    assert.notEqual(clip, null);
    assert.equal(clip.text, "line 1\nline 2\nline 3\nline 4");
    assert.deepEqual(clip.lineRange, [1, 4]);
  });

  it("getClipboard returns last copy", async () => {
    const mgr = await createManager();
    assert.equal(mgr.getClipboard(), null, "Initially null");
    mgr.scrollTo("s1", 0);
    mgr.toggleSelectionMode("s1");
    mgr.extendSelection("s1", 1);
    mgr.copySelection("s1", lines);
    const clip = mgr.getClipboard();
    assert.notEqual(clip, null);
    assert.equal(clip.text, "line 0\nline 1");
  });

  it("pasteToComposer appends clipboard text to buffer", async () => {
    const mgr = await createManager();
    mgr.setComposerBuffer("s1", "prefix-");
    // Set up clipboard
    mgr.scrollTo("s1", 2);
    mgr.toggleSelectionMode("s1");
    mgr.copySelection("s1", lines);
    const result = mgr.pasteToComposer("s1");
    assert.equal(result, "prefix-line 2");
  });

  it("pasteToComposer returns empty string when no clipboard", async () => {
    const mgr = await createManager();
    const result = mgr.pasteToComposer("s1");
    assert.equal(result, "");
  });
});

// ═══ 4. ComposerState ═══════════════════════════════════════════════

describe("DUX-11: ComposerState", () => {
  it("getComposer creates default (empty buffer, idle mode)", async () => {
    const mgr = await createManager();
    const comp = mgr.getComposer("s1");
    assert.equal(comp.sessionId, "s1");
    assert.equal(comp.buffer, "");
    assert.equal(comp.mode, "idle");
  });

  it("setComposerMode changes mode", async () => {
    const mgr = await createManager();
    mgr.setComposerMode("s1", "input");
    assert.equal(mgr.getComposer("s1").mode, "input");
  });

  it("setComposerBuffer changes buffer", async () => {
    const mgr = await createManager();
    mgr.setComposerBuffer("s1", "hello world");
    assert.equal(mgr.getComposer("s1").buffer, "hello world");
  });

  it("submitComposer returns buffer and clears", async () => {
    const mgr = await createManager();
    mgr.setComposerBuffer("s1", "send this");
    mgr.setComposerMode("s1", "input");
    const text = mgr.submitComposer("s1");
    assert.equal(text, "send this");
    assert.equal(mgr.getComposer("s1").buffer, "");
  });

  it("submitComposer sets mode to idle", async () => {
    const mgr = await createManager();
    mgr.setComposerMode("s1", "input");
    mgr.setComposerBuffer("s1", "text");
    mgr.submitComposer("s1");
    assert.equal(mgr.getComposer("s1").mode, "idle");
  });
});

// ═══ 5. Session isolation ═══════════════════════════════════════════

describe("DUX-11: Session isolation", () => {
  it("two sessions have independent viewport states", async () => {
    const mgr = await createManager();
    const vpA = mgr.getViewport("a");
    const vpB = mgr.getViewport("b");
    assert.notEqual(vpA, vpB);
    assert.equal(vpA.sessionId, "a");
    assert.equal(vpB.sessionId, "b");
  });

  it("scrolling session A does not affect session B", async () => {
    const mgr = await createManager();
    mgr.scrollTo("a", 100);
    mgr.scrollTo("b", 5);
    assert.equal(mgr.getViewport("a").transcriptOffset, 100);
    assert.equal(mgr.getViewport("b").transcriptOffset, 5);
  });

  it("session A composer is independent from session B", async () => {
    const mgr = await createManager();
    mgr.setComposerBuffer("a", "alpha");
    mgr.setComposerBuffer("b", "beta");
    assert.equal(mgr.getComposer("a").buffer, "alpha");
    assert.equal(mgr.getComposer("b").buffer, "beta");
  });

  it("removeSession cleans up viewport and composer", async () => {
    const mgr = await createManager();
    mgr.scrollTo("s1", 50);
    mgr.setComposerBuffer("s1", "data");
    mgr.removeSession("s1");
    // After removal, getViewport/getComposer should create fresh defaults
    const vp = mgr.getViewport("s1");
    const comp = mgr.getComposer("s1");
    assert.equal(vp.transcriptOffset, 0, "viewport should be reset");
    assert.equal(comp.buffer, "", "composer should be reset");
  });
});

// ═══ 6. Cross-session clipboard ═════════════════════════════════════

describe("DUX-11: Cross-session clipboard", () => {
  const lines = ["alpha", "beta", "gamma", "delta"];

  it("copy from session A, paste to session B works", async () => {
    const mgr = await createManager();
    // Copy from session A
    mgr.scrollTo("a", 1);
    mgr.toggleSelectionMode("a");
    mgr.extendSelection("a", 1); // select lines 1-2
    mgr.copySelection("a", lines);
    // Paste to session B
    const result = mgr.pasteToComposer("b");
    assert.equal(result, "beta\ngamma");
    assert.equal(mgr.getComposer("b").buffer, "beta\ngamma");
  });

  it("clipboard persists across session switches", async () => {
    const mgr = await createManager();
    // Copy from session A
    mgr.scrollTo("a", 0);
    mgr.toggleSelectionMode("a");
    mgr.copySelection("a", lines);
    // Access session B (switch context)
    mgr.getViewport("b");
    mgr.getComposer("b");
    // Clipboard still available
    const clip = mgr.getClipboard();
    assert.notEqual(clip, null);
    assert.equal(clip.sessionId, "a");
    assert.equal(clip.text, "alpha");
  });
});
