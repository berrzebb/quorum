#!/usr/bin/env node
/**
 * Runtime Evaluation Gate Tests — PLT-6I
 *
 * Tests runRuntimeEvaluationGate from the orchestrate/governance layer.
 *
 * Run: node --test tests/runtime-evaluation-gate.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  createEvaluationScenario,
  createRuntimeEvaluationSpec,
} = await import('../dist/platform/core/harness/index.js');

const {
  runRuntimeEvaluationGate,
} = await import('../dist/platform/orchestrate/governance/index.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock evaluator that always passes */
function passingEvaluator(name, surfaces) {
  return {
    name,
    surfaces,
    async run(_spec) {
      return { passed: true, findings: [], evidence: ['ok'] };
    },
  };
}

/** Create a mock evaluator that always fails */
function failingEvaluator(name, surfaces, findings = ['failed']) {
  return {
    name,
    surfaces,
    async run(_spec) {
      return { passed: false, findings, evidence: [] };
    },
  };
}

// ═══ runRuntimeEvaluationGate ═══════════════════════════════════════════════

describe('runRuntimeEvaluationGate', () => {
  it('passes with all evaluators present and passing', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: true }),
        createEvaluationScenario({ surface: 'api', target: '/health', blocking: true }),
      ],
    });
    const evaluators = [
      passingEvaluator('cli-eval', ['cli']),
      passingEvaluator('api-eval', ['api']),
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, true);
    assert.equal(result.surfaceResults.length, 2);
    assert.equal(result.missingEvaluators.length, 0);
    assert.equal(result.blockingFailures.length, 0);
  });

  it('passes with missing evaluator for non-blocking surface', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: true }),
        createEvaluationScenario({ surface: 'browser', target: 'index.html', blocking: false }),
      ],
    });
    const evaluators = [
      passingEvaluator('cli-eval', ['cli']),
      // No browser evaluator
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, true);
    assert.deepEqual(result.missingEvaluators, ['browser']);
    assert.equal(result.blockingFailures.length, 0);
  });

  it('fails with missing evaluator for blocking surface', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: true }),
        createEvaluationScenario({ surface: 'browser', target: 'index.html', blocking: true }),
      ],
    });
    const evaluators = [
      passingEvaluator('cli-eval', ['cli']),
      // No browser evaluator — blocking
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, false);
    assert.deepEqual(result.missingEvaluators, ['browser']);
    assert.equal(result.blockingFailures.length, 1);
    assert.ok(result.blockingFailures[0].includes('browser'));
  });

  it('fails with failing evaluator for blocking surface', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: true }),
        createEvaluationScenario({ surface: 'api', target: '/health', blocking: true }),
      ],
    });
    const evaluators = [
      passingEvaluator('cli-eval', ['cli']),
      failingEvaluator('api-eval', ['api'], ['timeout', '500 error']),
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, false);
    assert.equal(result.blockingFailures.length, 1);
    assert.ok(result.blockingFailures[0].includes('api'));
    assert.ok(result.blockingFailures[0].includes('timeout'));
  });

  it('passes with empty spec (no scenarios)', async () => {
    const spec = createRuntimeEvaluationSpec();
    const evaluators = [passingEvaluator('cli-eval', ['cli'])];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, true);
    assert.equal(result.surfaceResults.length, 0);
    assert.equal(result.missingEvaluators.length, 0);
    assert.equal(result.blockingFailures.length, 0);
  });

  it('passes with empty evaluators and only non-blocking surfaces', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: false }),
      ],
    });

    const result = await runRuntimeEvaluationGate(spec, []);
    assert.equal(result.passed, true);
    assert.deepEqual(result.missingEvaluators, ['cli']);
  });

  it('populates surfaceResults with evaluator names', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: false }),
        createEvaluationScenario({ surface: 'api', target: '/v1', blocking: false }),
      ],
    });
    const evaluators = [
      passingEvaluator('my-cli-eval', ['cli']),
      passingEvaluator('my-api-eval', ['api']),
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.surfaceResults.length, 2);

    const cliResult = result.surfaceResults.find(r => r.surface === 'cli');
    assert.equal(cliResult.evaluatorName, 'my-cli-eval');
    assert.equal(cliResult.result.passed, true);

    const apiResult = result.surfaceResults.find(r => r.surface === 'api');
    assert.equal(apiResult.evaluatorName, 'my-api-eval');
    assert.equal(apiResult.result.passed, true);
  });

  it('sets null evaluatorName and result for missing evaluators', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'tui', target: 'dashboard', blocking: false }),
      ],
    });

    const result = await runRuntimeEvaluationGate(spec, []);
    assert.equal(result.surfaceResults.length, 1);
    assert.equal(result.surfaceResults[0].evaluatorName, null);
    assert.equal(result.surfaceResults[0].result, null);
  });

  it('deduplicates surfaces from multiple scenarios', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app1', blocking: false }),
        createEvaluationScenario({ surface: 'cli', target: 'app2', blocking: false }),
        createEvaluationScenario({ surface: 'cli', target: 'app3', blocking: false }),
      ],
    });
    const evaluators = [passingEvaluator('cli-eval', ['cli'])];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    // Should only have 1 surface result since all scenarios are 'cli'
    assert.equal(result.surfaceResults.length, 1);
    assert.equal(result.surfaceResults[0].surface, 'cli');
  });

  it('handles mixed blocking and non-blocking for same surface', async () => {
    // If any scenario on a surface is blocking, the surface is blocking
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'api', target: '/health', blocking: true }),
        createEvaluationScenario({ surface: 'api', target: '/status', blocking: false }),
      ],
    });

    const result = await runRuntimeEvaluationGate(spec, []);
    assert.equal(result.passed, false);
    assert.ok(result.blockingFailures[0].includes('api'));
  });

  it('passes when failing evaluator is on non-blocking surface', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: false }),
      ],
    });
    const evaluators = [
      failingEvaluator('cli-eval', ['cli'], ['lint error']),
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, true);
    assert.equal(result.blockingFailures.length, 0);
    // But result should still capture the failure
    assert.equal(result.surfaceResults[0].result.passed, false);
  });

  it('accumulates multiple blocking failures', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: true }),
        createEvaluationScenario({ surface: 'api', target: '/health', blocking: true }),
        createEvaluationScenario({ surface: 'browser', target: 'index.html', blocking: true }),
      ],
    });
    // All evaluators fail
    const evaluators = [
      failingEvaluator('cli-eval', ['cli'], ['crash']),
      failingEvaluator('api-eval', ['api'], ['timeout']),
      // browser missing entirely
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, false);
    assert.equal(result.blockingFailures.length, 3);
    assert.equal(result.missingEvaluators.length, 1);
    assert.deepEqual(result.missingEvaluators, ['browser']);
  });

  it('evaluator with multiple surfaces matches correctly', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'app', blocking: false }),
        createEvaluationScenario({ surface: 'tui', target: 'dashboard', blocking: false }),
      ],
    });
    // Single evaluator covers both surfaces
    const evaluators = [
      passingEvaluator('terminal-eval', ['cli', 'tui']),
    ];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.equal(result.passed, true);
    assert.equal(result.surfaceResults.length, 2);
    assert.equal(result.missingEvaluators.length, 0);
    // Both should use the same evaluator
    assert.equal(result.surfaceResults[0].evaluatorName, 'terminal-eval');
    assert.equal(result.surfaceResults[1].evaluatorName, 'terminal-eval');
  });

  it('returns evidence from evaluator results', async () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'api', target: '/health', blocking: false }),
      ],
    });
    const evaluators = [passingEvaluator('api-eval', ['api'])];

    const result = await runRuntimeEvaluationGate(spec, evaluators);
    assert.deepEqual(result.surfaceResults[0].result.evidence, ['ok']);
  });
});
