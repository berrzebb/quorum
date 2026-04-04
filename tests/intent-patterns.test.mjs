/**
 * Tests: Intent Pattern Registry
 * WB-1 — detects gate profile from user prompts (Korean + English).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectIntent, getPatterns } from "../platform/adapters/shared/intent-patterns.mjs";

describe("intent-patterns", () => {
  // ── strict ────────────────────────────────────
  describe("strict detection", () => {
    const cases = [
      "빡세게 해줘",
      "엄격하게 검토해",
      "보안 중요하니까 잘 해",
      "꼼꼼하게 봐줘",
      "철저하게 리뷰해",
      "security first approach please",
      "be strict about this",
      "review thoroughly",
      "please check carefully",
    ];
    for (const prompt of cases) {
      it(`detects strict: "${prompt}"`, () => {
        const r = detectIntent(prompt);
        assert.ok(r, `should detect intent for: ${prompt}`);
        assert.equal(r.profile, "strict");
      });
    }
  });

  // ── fast ──────────────────────────────────────
  describe("fast detection", () => {
    const cases = [
      "빨리 해줘",
      "빠르게 처리해",
      "간단하게 해",
      "급해! 빨리",
      "대충 해줘",
      "do it quickly",
      "fast implementation please",
      "just a rough draft",
    ];
    for (const prompt of cases) {
      it(`detects fast: "${prompt}"`, () => {
        const r = detectIntent(prompt);
        assert.ok(r, `should detect intent for: ${prompt}`);
        assert.equal(r.profile, "fast");
      });
    }
  });

  // ── prototype ─────────────────────────────────
  describe("prototype detection", () => {
    const cases = [
      "프로토타입으로 만들어",
      "MVP 먼저 해보자",
      "PoC 작성해줘",
      "spike 해보자",
      "실험적으로 해봐",
      "실험 해 보자",
      "throwaway code is fine",
      "just an experiment",
    ];
    for (const prompt of cases) {
      it(`detects prototype: "${prompt}"`, () => {
        const r = detectIntent(prompt);
        assert.ok(r, `should detect intent for: ${prompt}`);
        assert.equal(r.profile, "prototype");
      });
    }
  });

  // ── balanced (explicit reset) ─────────────────
  describe("balanced detection", () => {
    const cases = [
      "기본으로 돌려줘",
      "기본 모드로",
      "원래대로",
      "normal mode please",
      "switch to balanced",
      "reset gate profile",
    ];
    for (const prompt of cases) {
      it(`detects balanced: "${prompt}"`, () => {
        const r = detectIntent(prompt);
        assert.ok(r, `should detect intent for: ${prompt}`);
        assert.equal(r.profile, "balanced");
      });
    }
  });

  // ── no match ──────────────────────────────────
  describe("no match", () => {
    const cases = [
      "함수 하나 만들어줘",
      "버그 수정해",
      "implement the login page",
      "add unit tests",
      "",
    ];
    for (const prompt of cases) {
      it(`returns null: "${prompt || "(empty)"}"`, () => {
        assert.equal(detectIntent(prompt), null);
      });
    }
  });

  // ── edge cases ────────────────────────────────
  describe("edge cases", () => {
    it("returns null for null input", () => {
      assert.equal(detectIntent(null), null);
    });

    it("returns null for undefined", () => {
      assert.equal(detectIntent(undefined), null);
    });

    it("returns null for non-string", () => {
      assert.equal(detectIntent(42), null);
    });

    it("returns match text", () => {
      const r = detectIntent("빡세게 해");
      assert.ok(r);
      assert.equal(r.match, "빡세게");
    });

    it("strict wins over fast when both present", () => {
      // "빡세게 빨리" → strict (priority order)
      const r = detectIntent("빡세게 빨리 해줘");
      assert.ok(r);
      assert.equal(r.profile, "strict");
    });
  });

  // ── pattern registry ──────────────────────────
  describe("getPatterns", () => {
    it("returns all 4 patterns", () => {
      const p = getPatterns();
      assert.equal(p.length, 4);
      const profiles = p.map(x => x.profile);
      assert.ok(profiles.includes("strict"));
      assert.ok(profiles.includes("fast"));
      assert.ok(profiles.includes("prototype"));
      assert.ok(profiles.includes("balanced"));
    });
  });
});
