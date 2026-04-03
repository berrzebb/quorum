#!/usr/bin/env node
/**
 * Typed Error System Tests — ERROR-1
 *
 * Run: node --test tests/errors.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyError, isRetryable } from "../dist/platform/core/errors.js";

// ═══ 1. classifyError — 7 kinds ═════════════════════════

describe("classifyError — kind classification", () => {
  it("transient: HTTP 429", () => {
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    const result = classifyError(err);
    assert.equal(result.kind, "transient");
    assert.equal(result.statusCode, 429);
  });

  it("transient: HTTP 503", () => {
    const err = Object.assign(new Error("service unavailable"), { status: 503 });
    assert.equal(classifyError(err).kind, "transient");
  });

  it("transient: ECONNRESET", () => {
    const err = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    assert.equal(classifyError(err).kind, "transient");
    assert.equal(classifyError(err).code, "ECONNRESET");
  });

  it("transient: ETIMEDOUT", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    assert.equal(classifyError(err).kind, "transient");
  });

  it("auth: HTTP 401", () => {
    const err = Object.assign(new Error("unauthorized"), { status: 401 });
    assert.equal(classifyError(err).kind, "auth");
  });

  it("auth: HTTP 403", () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    assert.equal(classifyError(err).kind, "auth");
  });

  it("validation: HTTP 400", () => {
    const err = Object.assign(new Error("bad request"), { status: 400 });
    assert.equal(classifyError(err).kind, "validation");
  });

  it("validation: HTTP 422", () => {
    const err = Object.assign(new Error("unprocessable"), { status: 422 });
    assert.equal(classifyError(err).kind, "validation");
  });

  it("server: HTTP 500", () => {
    const err = Object.assign(new Error("internal"), { status: 500 });
    assert.equal(classifyError(err).kind, "server");
  });

  it("server: HTTP 502", () => {
    const err = Object.assign(new Error("bad gateway"), { status: 502 });
    assert.equal(classifyError(err).kind, "server");
  });

  it("resource: ENOENT", () => {
    const err = Object.assign(new Error("file not found"), { code: "ENOENT" });
    assert.equal(classifyError(err).kind, "resource");
  });

  it("resource: EACCES", () => {
    const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
    assert.equal(classifyError(err).kind, "resource");
  });

  it("sdk: AnthropicError", () => {
    const err = new Error("api error");
    Object.defineProperty(err, "name", { value: "AnthropicError" });
    assert.equal(classifyError(err).kind, "sdk");
  });

  it("sdk: SDK error with status code maps to specific kind", () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 });
    Object.defineProperty(err, "name", { value: "RateLimitError" });
    const result = classifyError(err);
    assert.equal(result.kind, "transient"); // 429 maps to transient, not sdk
  });

  it("unknown: plain Error", () => {
    assert.equal(classifyError(new Error("something")).kind, "unknown");
  });

  it("unknown: null", () => {
    const result = classifyError(null);
    assert.equal(result.kind, "unknown");
    assert.ok(result.cause instanceof Error);
  });

  it("unknown: undefined", () => {
    assert.equal(classifyError(undefined).kind, "unknown");
  });

  it("unknown: string error", () => {
    const result = classifyError("something went wrong");
    assert.equal(result.kind, "unknown");
    assert.equal(result.message, "something went wrong");
  });

  it("unknown: number", () => {
    assert.equal(classifyError(42).kind, "unknown");
  });
});

// ═══ 2. Cause chain walking ═════════════════════════════

describe("classifyError — cause chain", () => {
  it("walks 1-level cause", () => {
    const inner = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const outer = new Error("request failed");
    outer.cause = inner;
    assert.equal(classifyError(outer).kind, "transient");
  });

  it("walks 2-level cause", () => {
    const innermost = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const middle = new Error("fetch error");
    middle.cause = innermost;
    const outer = new Error("request failed");
    outer.cause = middle;
    assert.equal(classifyError(outer).kind, "transient");
  });

  it("walks max 5 levels", () => {
    // Build a 6-level chain — classifiable error at level 6 (unreachable)
    let current = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    for (let i = 0; i < 6; i++) {
      const wrapper = new Error(`level ${i}`);
      wrapper.cause = current;
      current = wrapper;
    }
    // Level 6 is beyond maxDepth=5, so it won't find ETIMEDOUT
    // Actually, the walker starts at the outermost error (level 6 wrapper),
    // and walks down. Let me think... depth 0 = current (level 6 wrapper),
    // depth 1 = level 5 wrapper, ..., depth 5 would be level 1 wrapper.
    // The actual ETIMEDOUT error is at depth 6 — unreachable.
    assert.equal(classifyError(current).kind, "unknown");
  });

  it("stops at non-object cause", () => {
    const err = new Error("outer");
    err.cause = "not an object";
    assert.equal(classifyError(err).kind, "unknown");
  });
});

// ═══ 3. retryAfter extraction ═══════════════════════════

describe("classifyError — retryAfter", () => {
  it("extracts retryAfter from headers", () => {
    const err = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: { "retry-after": "5" },
    });
    const result = classifyError(err);
    assert.equal(result.retryAfter, 5);
  });

  it("extracts retryAfter from error property", () => {
    const err = Object.assign(new Error("rate limited"), {
      status: 429,
      retryAfter: 10,
    });
    assert.equal(classifyError(err).retryAfter, 10);
  });
});

// ═══ 4. SSL/TLS detection ═══════════════════════════════

describe("classifyError — SSL/TLS", () => {
  it("detects SELF_SIGNED_CERT_IN_CHAIN with hint", () => {
    const err = Object.assign(new Error("ssl"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    const result = classifyError(err);
    assert.equal(result.kind, "transient");
    assert.ok(result.hint);
    assert.ok(result.hint.includes("NODE_EXTRA_CA_CERTS"));
  });

  it("detects DEPTH_ZERO_SELF_SIGNED_CERT with hint", () => {
    const err = Object.assign(new Error("ssl"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    const result = classifyError(err);
    assert.ok(result.hint);
    assert.ok(result.hint.includes("NODE_TLS_REJECT_UNAUTHORIZED"));
  });

  it("detects CERT_HAS_EXPIRED with hint", () => {
    const err = Object.assign(new Error("ssl"), { code: "CERT_HAS_EXPIRED" });
    assert.ok(classifyError(err).hint?.includes("expired"));
  });
});

// ═══ 5. isRetryable ═════════════════════════════════════

describe("isRetryable", () => {
  it("transient → retryable", () => {
    assert.ok(isRetryable(classifyError(Object.assign(new Error(""), { status: 429 }))));
  });

  it("server → retryable", () => {
    assert.ok(isRetryable(classifyError(Object.assign(new Error(""), { status: 500 }))));
  });

  it("sdk → retryable", () => {
    const err = new Error("api");
    Object.defineProperty(err, "name", { value: "OpenAIError" });
    assert.ok(isRetryable(classifyError(err)));
  });

  it("unknown → retryable", () => {
    assert.ok(isRetryable(classifyError(new Error("mystery"))));
  });

  it("validation → NOT retryable", () => {
    assert.ok(!isRetryable(classifyError(Object.assign(new Error(""), { status: 400 }))));
  });

  it("auth → NOT retryable", () => {
    assert.ok(!isRetryable(classifyError(Object.assign(new Error(""), { status: 401 }))));
  });

  it("resource ENOENT → NOT retryable", () => {
    assert.ok(!isRetryable(classifyError(Object.assign(new Error(""), { code: "ENOENT" }))));
  });

  it("resource EMFILE → retryable (fd exhaustion)", () => {
    assert.ok(isRetryable(classifyError(Object.assign(new Error(""), { code: "EMFILE" }))));
  });
});

// ═══ 6. Fail-open guarantee ═════════════════════════════

describe("classifyError — fail-open", () => {
  it("never throws on any input", () => {
    const inputs = [null, undefined, 0, "", false, {}, [], Symbol("x"), () => {}, NaN, Infinity];
    for (const input of inputs) {
      assert.doesNotThrow(() => classifyError(input));
    }
  });

  it("always returns a valid QuorumError", () => {
    const result = classifyError({});
    assert.ok(result.kind);
    assert.ok(result.cause instanceof Error);
    assert.ok(typeof result.message === "string");
  });
});

// ═══ 7. Performance ═════════════════════════════════════

describe("classifyError — performance", () => {
  it("classifyError < 1ms per call (1000 iterations)", () => {
    const err = Object.assign(new Error("test"), { status: 429 });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      classifyError(err);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `1000 calls took ${elapsed}ms (limit: 1000ms = 1ms/call)`);
  });
});
