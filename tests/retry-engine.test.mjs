#!/usr/bin/env node
/**
 * Retry Engine Tests — ERROR-2
 *
 * Run: node --test tests/retry-engine.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RetryEngine,
  computeDelay,
  DEFAULT_RETRY_POLICY,
} from "../dist/platform/core/retry-engine.js";

// ═══ 1. computeDelay ════════════════════════════════════

describe("computeDelay", () => {
  it("attempt 1 → ~500ms", () => {
    const delay = computeDelay(1, { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 });
    assert.equal(delay, 500);
  });

  it("attempt 2 → ~1000ms", () => {
    const delay = computeDelay(2, { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 });
    assert.equal(delay, 1000);
  });

  it("attempt 3 → ~2000ms", () => {
    const delay = computeDelay(3, { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 });
    assert.equal(delay, 2000);
  });

  it("attempt 6 → ~16000ms", () => {
    const delay = computeDelay(6, { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 });
    assert.equal(delay, 16000);
  });

  it("attempt 7+ → capped at 32000ms", () => {
    const delay = computeDelay(7, { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 });
    assert.equal(delay, 32000);
    const delay8 = computeDelay(8, { ...DEFAULT_RETRY_POLICY, jitterFraction: 0 });
    assert.equal(delay8, 32000);
  });

  it("jitter within ±25% range", () => {
    const samples = Array.from({ length: 100 }, () =>
      computeDelay(1, DEFAULT_RETRY_POLICY),
    );
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    // Base is 500, jitter ±25% → 375..625
    assert.ok(min >= 375, `min ${min} should be >= 375`);
    assert.ok(max <= 625, `max ${max} should be <= 625`);
  });

  it("retryAfter takes precedence", () => {
    const delay = computeDelay(1, DEFAULT_RETRY_POLICY, 5);
    assert.equal(delay, 5000); // 5 seconds → 5000ms
  });
});

// ═══ 2. RetryEngine.execute — success ═══════════════════

describe("RetryEngine.execute — success", () => {
  it("returns result on first success", async () => {
    const engine = new RetryEngine();
    const result = await engine.execute(() => 42);
    assert.equal(result, 42);
  });

  it("returns result after transient failure", async () => {
    const engine = new RetryEngine({ ...DEFAULT_RETRY_POLICY, baseDelayMs: 1, maxDelayMs: 1 });
    let attempt = 0;
    const result = await engine.execute(() => {
      attempt++;
      if (attempt < 3) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(attempt, 3);
  });

  it("handles async functions", async () => {
    const engine = new RetryEngine();
    const result = await engine.execute(async () => {
      return Promise.resolve("async-result");
    });
    assert.equal(result, "async-result");
  });
});

// ═══ 3. RetryEngine.execute — failures ══════════════════

describe("RetryEngine.execute — failures", () => {
  it("throws immediately for validation errors (no retry)", async () => {
    const engine = new RetryEngine({ ...DEFAULT_RETRY_POLICY, baseDelayMs: 1 });
    let attempts = 0;

    await assert.rejects(
      () => engine.execute(() => {
        attempts++;
        throw Object.assign(new Error("bad request"), { status: 400 });
      }),
      { message: "bad request" },
    );
    assert.equal(attempts, 1); // No retry
  });

  it("throws immediately for auth errors (no retry)", async () => {
    const engine = new RetryEngine({ ...DEFAULT_RETRY_POLICY, baseDelayMs: 1 });
    let attempts = 0;

    await assert.rejects(
      () => engine.execute(() => {
        attempts++;
        throw Object.assign(new Error("unauthorized"), { status: 401 });
      }),
    );
    assert.equal(attempts, 1);
  });

  it("exhausts maxAttempts then throws", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });
    let attempts = 0;

    await assert.rejects(
      () => engine.execute(() => {
        attempts++;
        throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      }),
    );
    assert.equal(attempts, 3);
  });

  it("throws original error (not wrapper)", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
      baseDelayMs: 1,
    });
    const original = new Error("original-error");

    await assert.rejects(
      () => engine.execute(() => { throw original; }),
      (err) => err === original,
    );
  });
});

// ═══ 4. onAttempt callback ══════════════════════════════

describe("RetryEngine — onAttempt callback", () => {
  it("called for each attempt", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    const attempts = [];
    engine.onAttempt((info) => attempts.push(info));

    let callCount = 0;
    await assert.rejects(() =>
      engine.execute(() => {
        callCount++;
        throw Object.assign(new Error("fail"), { status: 500 });
      }),
    );

    assert.equal(attempts.length, 3);
    assert.equal(attempts[0].attempt, 1);
    assert.ok(attempts[0].willRetry);
    assert.equal(attempts[2].attempt, 3);
    assert.ok(!attempts[2].willRetry);
  });

  it("includes error kind", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
      baseDelayMs: 1,
    });

    const infos = [];
    engine.onAttempt((info) => infos.push(info));

    await assert.rejects(() =>
      engine.execute(() => {
        throw Object.assign(new Error("rate limit"), { status: 429 });
      }),
    );

    assert.equal(infos[0].kind, "transient");
  });

  it("callback errors don't break retry", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    engine.onAttempt(() => { throw new Error("callback crash"); });

    let attempts = 0;
    await assert.rejects(() =>
      engine.execute(() => {
        attempts++;
        throw Object.assign(new Error("fail"), { code: "ECONNRESET" });
      }),
    );
    assert.equal(attempts, 2); // Retry still works despite callback error
  });
});

// ═══ 5. Custom retry categories ═════════════════════════

describe("RetryEngine — custom categories", () => {
  it("can override to retry auth errors", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
      categories: { auth: true },
    });

    let attempts = 0;
    await assert.rejects(() =>
      engine.execute(() => {
        attempts++;
        throw Object.assign(new Error("auth"), { status: 401 });
      }),
    );
    assert.equal(attempts, 2); // Retried because of category override
  });

  it("can override to NOT retry transient", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 3,
      baseDelayMs: 1,
      categories: { transient: false },
    });

    let attempts = 0;
    await assert.rejects(() =>
      engine.execute(() => {
        attempts++;
        throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      }),
    );
    assert.equal(attempts, 1); // No retry
  });
});

// ═══ 6. Performance ═════════════════════════════════════

describe("RetryEngine — performance", () => {
  it("overhead < 5ms per attempt (no delay)", async () => {
    const engine = new RetryEngine({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
      baseDelayMs: 0,
    });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await engine.execute(() => "ok");
    }
    const elapsed = performance.now() - start;
    // 100 successful calls should be well under 500ms (5ms each)
    assert.ok(elapsed < 500, `100 calls took ${elapsed}ms (limit: 500ms = 5ms/call)`);
  });
});
