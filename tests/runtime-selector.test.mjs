#!/usr/bin/env node
/**
 * Runtime Selector Tests — SDK-14
 *
 * Tests config surface and runtime selection policy:
 * defaultRuntimeConfig, resolveExecutionMode, mergeRuntimeConfig,
 * isSessionRuntimeEnabled.
 *
 * Run: node --test tests/runtime-selector.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  defaultRuntimeConfig,
  resolveExecutionMode,
  mergeRuntimeConfig,
  isSessionRuntimeEnabled,
} = await import('../dist/platform/providers/runtime-selector.js');

// ═══ 1. defaultRuntimeConfig ════════════════════════════════════════════

describe('defaultRuntimeConfig', () => {
  it('should return cli_exec for both providers', () => {
    const config = defaultRuntimeConfig();
    assert.equal(config.codex.mode, 'cli_exec');
    assert.equal(config.claude.mode, 'cli_exec');
  });

  it('should not include optional fields by default', () => {
    const config = defaultRuntimeConfig();
    assert.equal(config.codex.binary, undefined);
    assert.equal(config.codex.timeout, undefined);
    assert.equal(config.claude.binary, undefined);
    assert.equal(config.claude.timeout, undefined);
  });
});

// ═══ 2. resolveExecutionMode ════════════════════════════════════════════

describe('resolveExecutionMode', () => {
  it('cli_exec always passes through for codex', () => {
    const result = resolveExecutionMode('codex', 'cli_exec', {});
    assert.equal(result.mode, 'cli_exec');
    assert.equal(result.fallback, false);
    assert.equal(result.reason, undefined);
  });

  it('cli_exec always passes through for claude', () => {
    const result = resolveExecutionMode('claude', 'cli_exec', {});
    assert.equal(result.mode, 'cli_exec');
    assert.equal(result.fallback, false);
    assert.equal(result.reason, undefined);
  });

  it('claude + agent_sdk + SDK available → agent_sdk', () => {
    const result = resolveExecutionMode('claude', 'agent_sdk', {
      claudeSdkAvailable: true,
    });
    assert.equal(result.mode, 'agent_sdk');
    assert.equal(result.fallback, false);
    assert.equal(result.reason, undefined);
  });

  it('claude + agent_sdk + SDK NOT available → cli_exec fallback', () => {
    const result = resolveExecutionMode('claude', 'agent_sdk', {
      claudeSdkAvailable: false,
    });
    assert.equal(result.mode, 'cli_exec');
    assert.equal(result.fallback, true);
    assert.ok(result.reason, 'should have a fallback reason');
    assert.match(result.reason, /claude/i);
  });

  it('claude + agent_sdk + capabilities empty → cli_exec fallback', () => {
    const result = resolveExecutionMode('claude', 'agent_sdk', {});
    assert.equal(result.mode, 'cli_exec');
    assert.equal(result.fallback, true);
  });

  it('invalid mode for provider → fallback with reason', () => {
    // codex requesting agent_sdk (only valid for claude)
    const result = resolveExecutionMode('codex', 'agent_sdk', {
      claudeSdkAvailable: true,
    });
    assert.equal(result.mode, 'cli_exec');
    assert.equal(result.fallback, true);
    assert.ok(result.reason);
    assert.match(result.reason, /invalid/i);
  });

});

// ═══ 3. mergeRuntimeConfig ══════════════════════════════════════════════

describe('mergeRuntimeConfig', () => {
  it('no partial → returns defaults', () => {
    const config = mergeRuntimeConfig();
    assert.equal(config.codex.mode, 'cli_exec');
    assert.equal(config.claude.mode, 'cli_exec');
  });

  it('undefined partial → returns defaults', () => {
    const config = mergeRuntimeConfig(undefined);
    assert.equal(config.codex.mode, 'cli_exec');
    assert.equal(config.claude.mode, 'cli_exec');
  });

  it('partial codex only → codex merged, claude defaults', () => {
    const config = mergeRuntimeConfig({
      codex: { mode: 'cli_exec', binary: '/usr/bin/codex', timeout: 30000 },
    });
    assert.equal(config.codex.mode, 'cli_exec');
    assert.equal(config.codex.binary, '/usr/bin/codex');
    assert.equal(config.codex.timeout, 30000);
    assert.equal(config.claude.mode, 'cli_exec');
  });

  it('partial claude only → claude merged, codex defaults', () => {
    const config = mergeRuntimeConfig({
      claude: { mode: 'agent_sdk', timeout: 60000 },
    });
    assert.equal(config.codex.mode, 'cli_exec');
    assert.equal(config.claude.mode, 'agent_sdk');
    assert.equal(config.claude.timeout, 60000);
  });

  it('full override → both merged', () => {
    const config = mergeRuntimeConfig({
      codex: { mode: 'cli_exec', binary: '/opt/codex' },
      claude: { mode: 'agent_sdk', binary: '/opt/claude', timeout: 45000 },
    });
    assert.equal(config.codex.mode, 'cli_exec');
    assert.equal(config.codex.binary, '/opt/codex');
    assert.equal(config.claude.mode, 'agent_sdk');
    assert.equal(config.claude.binary, '/opt/claude');
    assert.equal(config.claude.timeout, 45000);
  });
});

// ═══ 4. isSessionRuntimeEnabled ═════════════════════════════════════════

describe('isSessionRuntimeEnabled', () => {
  it('both cli_exec → false', () => {
    const config = defaultRuntimeConfig();
    assert.equal(isSessionRuntimeEnabled(config), false);
  });

  it('claude agent_sdk → true', () => {
    const config = {
      codex: { mode: 'cli_exec' },
      claude: { mode: 'agent_sdk' },
    };
    assert.equal(isSessionRuntimeEnabled(config), true);
  });

  it('both non-default → true', () => {
    const config = {
      codex: { mode: 'cli_exec' },
      claude: { mode: 'agent_sdk' },
    };
    assert.equal(isSessionRuntimeEnabled(config), true);
  });
});
