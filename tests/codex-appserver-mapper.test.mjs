#!/usr/bin/env node
/**
 * Codex App Server Mapper Tests — SDK-7
 *
 * Tests CodexAppServerMapper: converts Codex App Server JSON-RPC
 * notifications to normalized ProviderRuntimeEvent.
 *
 * Run: node --test tests/codex-appserver-mapper.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { CodexAppServerMapper } = await import(
  '../dist/platform/providers/codex/app-server/mapper.js'
);
const { CODEX_NOTIFICATIONS } = await import(
  '../dist/platform/providers/codex/app-server/protocol.js'
);

/** Helper: create a minimal ProviderSessionRef for tests. */
function makeRef(overrides = {}) {
  return {
    provider: 'codex',
    executionMode: 'app_server',
    providerSessionId: 'session-42',
    threadId: 'thread-1',
    ...overrides,
  };
}

// ═══ 1. Interface contract ═══════════════════════════════════════════

describe('CodexAppServerMapper — interface', () => {
  it('has provider = "codex"', () => {
    const mapper = new CodexAppServerMapper();
    assert.equal(mapper.provider, 'codex');
  });

  it('implements normalize() method', () => {
    const mapper = new CodexAppServerMapper();
    assert.equal(typeof mapper.normalize, 'function');
  });
});

// ═══ 2. Notification mapping ═════════════════════════════════════════

describe('CodexAppServerMapper — notification mapping', () => {
  const mapper = new CodexAppServerMapper();
  const ref = makeRef();

  const cases = [
    {
      notification: CODEX_NOTIFICATIONS.THREAD_STARTED,
      expectedKind: 'thread_started',
      params: { threadId: 'th-1', createdAt: 1700000000 },
    },
    {
      notification: CODEX_NOTIFICATIONS.TURN_STARTED,
      expectedKind: 'turn_started',
      params: { threadId: 'th-1', turnId: 'tu-1', role: 'assistant' },
    },
    {
      notification: CODEX_NOTIFICATIONS.ITEM_STARTED,
      expectedKind: 'item_started',
      params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'it-1', kind: 'message' },
    },
    {
      notification: CODEX_NOTIFICATIONS.ITEM_DELTA,
      expectedKind: 'item_delta',
      params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'it-1', delta: 'hello ' },
    },
    {
      notification: CODEX_NOTIFICATIONS.ITEM_COMPLETED,
      expectedKind: 'item_completed',
      params: {
        threadId: 'th-1',
        turnId: 'tu-1',
        itemId: 'it-1',
        kind: 'message',
        status: 'completed',
        content: 'hello world',
      },
    },
    {
      notification: CODEX_NOTIFICATIONS.TURN_COMPLETED,
      expectedKind: 'turn_completed',
      params: { threadId: 'th-1', turnId: 'tu-1', itemCount: 3 },
    },
    {
      notification: CODEX_NOTIFICATIONS.APPROVAL_REQUESTED,
      expectedKind: 'approval_requested',
      params: {
        requestId: 'req-1',
        threadId: 'th-1',
        kind: 'tool',
        reason: 'bash command',
      },
    },
    {
      notification: CODEX_NOTIFICATIONS.SESSION_COMPLETED,
      expectedKind: 'session_completed',
      params: { threadId: 'th-1', summary: 'done' },
    },
    {
      notification: CODEX_NOTIFICATIONS.SESSION_FAILED,
      expectedKind: 'session_failed',
      params: { threadId: 'th-1', error: 'timeout' },
    },
  ];

  for (const { notification, expectedKind, params } of cases) {
    it(`maps ${notification} → ${expectedKind}`, () => {
      const raw = { method: notification, params };
      const event = mapper.normalize(raw, ref);

      assert.ok(event, 'event should not be null');
      assert.equal(event.kind, expectedKind);
      assert.deepEqual(event.payload, params);
      assert.deepEqual(event.providerRef, ref);
      assert.equal(typeof event.ts, 'number');
      assert.ok(event.ts > 0, 'ts should be positive');
    });
  }
});

// ═══ 3. Edge cases ═══════════════════════════════════════════════════

describe('CodexAppServerMapper — edge cases', () => {
  const mapper = new CodexAppServerMapper();
  const ref = makeRef();

  it('returns null for unknown method', () => {
    const raw = { method: 'custom/unknown', params: { data: 1 } };
    const event = mapper.normalize(raw, ref);
    assert.equal(event, null);
  });

  it('returns null when method field is missing', () => {
    const raw = { params: { data: 1 } };
    const event = mapper.normalize(raw, ref);
    assert.equal(event, null);
  });

  it('returns null for empty object', () => {
    const event = mapper.normalize({}, ref);
    assert.equal(event, null);
  });

  it('handles missing params gracefully (defaults to empty object)', () => {
    const raw = { method: CODEX_NOTIFICATIONS.THREAD_STARTED };
    const event = mapper.normalize(raw, ref);

    assert.ok(event, 'event should not be null');
    assert.equal(event.kind, 'thread_started');
    assert.deepEqual(event.payload, {});
  });

  it('handles explicitly null params', () => {
    const raw = { method: CODEX_NOTIFICATIONS.SESSION_COMPLETED, params: null };
    const event = mapper.normalize(raw, ref);

    assert.ok(event, 'event should not be null');
    assert.equal(event.kind, 'session_completed');
    assert.deepEqual(event.payload, {});
  });

  it('preserves providerRef fields exactly', () => {
    const customRef = makeRef({
      providerSessionId: 'custom-session',
      threadId: 'custom-thread',
      turnId: 'custom-turn',
    });
    const raw = { method: CODEX_NOTIFICATIONS.ITEM_DELTA, params: { delta: 'x' } };
    const event = mapper.normalize(raw, customRef);

    assert.ok(event);
    assert.equal(event.providerRef.providerSessionId, 'custom-session');
    assert.equal(event.providerRef.threadId, 'custom-thread');
    assert.equal(event.providerRef.turnId, 'custom-turn');
    assert.equal(event.providerRef.provider, 'codex');
    assert.equal(event.providerRef.executionMode, 'app_server');
  });

  it('ts is a recent timestamp (within last 10 seconds)', () => {
    const raw = { method: CODEX_NOTIFICATIONS.THREAD_STARTED, params: {} };
    const before = Date.now();
    const event = mapper.normalize(raw, ref);
    const after = Date.now();

    assert.ok(event);
    assert.ok(event.ts >= before, `ts (${event.ts}) should be >= before (${before})`);
    assert.ok(event.ts <= after, `ts (${event.ts}) should be <= after (${after})`);
  });
});
