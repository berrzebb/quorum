#!/usr/bin/env node
/**
 * Claude SDK Tool Bridge + Event Mapper Tests — SDK-10
 *
 * Tests:
 * - isClaudeSdkAvailable() returns false (SDK not installed in dev)
 * - loadClaudeSdk() returns { available: false, error: ... }
 * - ClaudeSdkToolBridge implements ProviderToolBridge (has provider + buildToolConfig)
 * - buildToolConfig() returns fallback config when SDK not available
 * - ClaudeSdkToolBridge.getAvailableTools() returns 26 tool names (from registry)
 * - All 26 tools are strings
 * - ClaudeSdkEventMapper normalizes known event types correctly
 * - ClaudeSdkEventMapper returns null for unknown event types
 * - Mapped events have correct kind values
 *
 * Run: node --test tests/claude-sdk-bridge.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  isClaudeSdkAvailable,
  loadClaudeSdk,
  ClaudeSdkToolBridge,
} = await import('../dist/platform/providers/claude-sdk/tool-bridge.js');

const {
  ClaudeSdkEventMapper,
} = await import('../dist/platform/providers/claude-sdk/mapper.js');

const {
  createRuntimeEvent,
} = await import('../dist/platform/providers/event-mapper.js');

// ═══ 1. SDK Availability ═════════════════════════════════════════════════

describe('isClaudeSdkAvailable', () => {
  it('returns false when SDK is not installed', () => {
    const result = isClaudeSdkAvailable();
    assert.equal(result, false);
  });

  it('returns a boolean', () => {
    assert.equal(typeof isClaudeSdkAvailable(), 'boolean');
  });
});

// ═══ 2. SDK Loading ══════════════════════════════════════════════════════

describe('loadClaudeSdk', () => {
  it('returns { available: false } when SDK is not installed', async () => {
    const result = await loadClaudeSdk();
    assert.equal(result.available, false);
  });

  it('includes an error message', async () => {
    const result = await loadClaudeSdk();
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0, 'error message should be non-empty');
  });

  it('does not include sdk property when unavailable', async () => {
    const result = await loadClaudeSdk();
    assert.equal(result.sdk, undefined);
  });
});

// ═══ 3. ClaudeSdkToolBridge — Interface ══════════════════════════════════

describe('ClaudeSdkToolBridge', () => {
  const bridge = new ClaudeSdkToolBridge({
    allowedTools: ['code_map', 'blast_radius'],
    useMcpServer: false,
    repoRoot: '/tmp/test-repo',
  });

  it('implements ProviderToolBridge with provider="claude"', () => {
    assert.equal(bridge.provider, 'claude');
  });

  it('has buildToolConfig method', () => {
    assert.equal(typeof bridge.buildToolConfig, 'function');
  });

  // ── buildToolConfig fallback ──────────────────

  describe('buildToolConfig (SDK unavailable)', () => {
    it('returns fallback config when SDK is not installed', async () => {
      const config = await bridge.buildToolConfig({
        repoRoot: '/tmp/test-repo',
        allowedTools: ['code_map'],
      });

      assert.equal(config.available, false);
      assert.equal(config.fallback, 'cli_exec');
      assert.equal(typeof config.reason, 'string');
      assert.ok(String(config.reason).length > 0);
    });

    it('fallback config has no tools array', async () => {
      const config = await bridge.buildToolConfig({
        repoRoot: '/tmp/test-repo',
        allowedTools: ['code_map'],
      });

      assert.equal(config.tools, undefined);
    });

    it('accepts contractId parameter', async () => {
      const config = await bridge.buildToolConfig({
        repoRoot: '/tmp/test-repo',
        contractId: 'sprint-42',
        allowedTools: ['code_map'],
      });

      assert.equal(config.available, false);
      // contractId is only included when SDK is available
    });
  });

  // ── getAvailableTools ─────────────────────────

  describe('getAvailableTools', () => {
    it('returns all 26 tools from capability registry', () => {
      const tools = ClaudeSdkToolBridge.getAvailableTools();
      assert.equal(tools.length, 26);
    });

    it('all entries are strings', () => {
      const tools = ClaudeSdkToolBridge.getAvailableTools();
      for (const tool of tools) {
        assert.equal(typeof tool, 'string', `Expected string, got ${typeof tool}: ${tool}`);
      }
    });

    it('includes expected core tools', () => {
      const tools = ClaudeSdkToolBridge.getAvailableTools();
      const expected = ['code_map', 'blast_radius', 'perf_scan', 'a11y_scan', 'rtm_parse', 'ai_guide'];
      for (const name of expected) {
        assert.ok(tools.includes(name), `Missing tool: ${name}`);
      }
    });

    it('includes all deterministic tool categories', () => {
      const tools = ClaudeSdkToolBridge.getAvailableTools();
      // Codebase tools
      assert.ok(tools.includes('code_map'));
      assert.ok(tools.includes('dependency_graph'));
      assert.ok(tools.includes('coverage_map'));
      // Domain tools
      assert.ok(tools.includes('perf_scan'));
      assert.ok(tools.includes('a11y_scan'));
      assert.ok(tools.includes('license_scan'));
      assert.ok(tools.includes('compat_check'));
      assert.ok(tools.includes('i18n_validate'));
      assert.ok(tools.includes('infra_scan'));
      assert.ok(tools.includes('observability_check'));
      // RTM/FVM tools
      assert.ok(tools.includes('rtm_parse'));
      assert.ok(tools.includes('rtm_merge'));
      assert.ok(tools.includes('fvm_generate'));
      assert.ok(tools.includes('fvm_validate'));
      // Audit/guide tools
      assert.ok(tools.includes('audit_scan'));
      assert.ok(tools.includes('audit_submit'));
      assert.ok(tools.includes('audit_history'));
      assert.ok(tools.includes('blast_radius'));
      assert.ok(tools.includes('doc_coverage'));
      assert.ok(tools.includes('blueprint_lint'));
      assert.ok(tools.includes('contract_drift'));
      assert.ok(tools.includes('ai_guide'));
      // Coordination/lifecycle tools
      assert.ok(tools.includes('agent_comm'));
      assert.ok(tools.includes('skill_sync'));
      assert.ok(tools.includes('track_archive'));
      assert.ok(tools.includes('act_analyze'));
    });

    it('returns a new array each call (no shared mutation)', () => {
      const a = ClaudeSdkToolBridge.getAvailableTools();
      const b = ClaudeSdkToolBridge.getAvailableTools();
      assert.notEqual(a, b); // different references
      assert.deepEqual(a, b); // same content
    });
  });
});

// ═══ 4. ClaudeSdkEventMapper ═════════════════════════════════════════════

describe('ClaudeSdkEventMapper', () => {
  const mapper = new ClaudeSdkEventMapper();
  const ref = {
    provider: 'claude',
    executionMode: 'agent_sdk',
    providerSessionId: 'test-session-1',
  };

  it('has provider="claude"', () => {
    assert.equal(mapper.provider, 'claude');
  });

  it('has normalize method', () => {
    assert.equal(typeof mapper.normalize, 'function');
  });

  // ── Known event types ─────────────────────────

  const eventMappings = [
    { sdkType: 'session_start',        expectedKind: 'thread_started' },
    { sdkType: 'message_start',        expectedKind: 'turn_started' },
    { sdkType: 'tool_use_start',       expectedKind: 'item_started' },
    { sdkType: 'content_block_delta',  expectedKind: 'item_delta' },
    { sdkType: 'tool_use_complete',    expectedKind: 'item_completed' },
    { sdkType: 'message_complete',     expectedKind: 'turn_completed' },
    { sdkType: 'permission_request',   expectedKind: 'approval_requested' },
    { sdkType: 'session_complete',     expectedKind: 'session_completed' },
    { sdkType: 'session_error',        expectedKind: 'session_failed' },
  ];

  for (const { sdkType, expectedKind } of eventMappings) {
    it(`maps "${sdkType}" to kind="${expectedKind}"`, () => {
      const raw = { type: sdkType, data: 'test-payload' };
      const event = mapper.normalize(raw, ref);
      assert.ok(event, `Expected event for type="${sdkType}"`);
      assert.equal(event.kind, expectedKind);
    });
  }

  // ── Event structure ───────────────────────────

  it('mapped events have providerRef', () => {
    const event = mapper.normalize({ type: 'session_start' }, ref);
    assert.ok(event);
    assert.deepEqual(event.providerRef, ref);
  });

  it('mapped events have ts timestamp', () => {
    const before = Date.now();
    const event = mapper.normalize({ type: 'session_start' }, ref);
    const after = Date.now();
    assert.ok(event);
    assert.ok(event.ts >= before && event.ts <= after, `ts ${event.ts} not in [${before}, ${after}]`);
  });

  it('mapped events include raw payload', () => {
    const raw = { type: 'message_start', model: 'claude-opus', usage: { tokens: 42 } };
    const event = mapper.normalize(raw, ref);
    assert.ok(event);
    assert.equal(event.payload.model, 'claude-opus');
    assert.deepEqual(event.payload.usage, { tokens: 42 });
  });

  it('tool_use_start includes kind="tool_call" in payload', () => {
    const event = mapper.normalize({ type: 'tool_use_start', name: 'code_map' }, ref);
    assert.ok(event);
    assert.equal(event.payload.kind, 'tool_call');
    assert.equal(event.payload.name, 'code_map');
  });

  it('tool_use_complete includes kind="tool_call" in payload', () => {
    const event = mapper.normalize({ type: 'tool_use_complete', name: 'blast_radius' }, ref);
    assert.ok(event);
    assert.equal(event.payload.kind, 'tool_call');
    assert.equal(event.payload.name, 'blast_radius');
  });

  // ── Unknown/missing types ─────────────────────

  it('returns null for unknown event type', () => {
    const event = mapper.normalize({ type: 'unknown_event_xyz' }, ref);
    assert.equal(event, null);
  });

  it('returns null for missing type', () => {
    const event = mapper.normalize({ data: 'no-type-field' }, ref);
    assert.equal(event, null);
  });

  it('returns null for empty object', () => {
    const event = mapper.normalize({}, ref);
    assert.equal(event, null);
  });
});
