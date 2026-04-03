#!/usr/bin/env node
/**
 * Runtime Evaluation Spec, Quality Rubric & Iteration Policy Tests — PLT-6G
 *
 * Tests EvaluationScenario, RuntimeEvaluationSpec, QualityRubric,
 * QualityDimension, IterationPolicy types and their helper functions.
 *
 * Run: node --test tests/runtime-evaluation-spec.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  createEvaluationScenario,
  createRuntimeEvaluationSpec,
  getSurfacesFromSpec,
  getBlockingScenarios,
  createQualityRubric,
  evaluateRubric,
  createIterationPolicy,
  shouldEscalate,
  shouldAmend,
  isExhausted,
} = await import('../dist/platform/core/harness/index.js');

// ═══ 1. EvaluationScenario ══════════════════════════════════════════════════

describe('EvaluationScenario', () => {
  it('should create with defaults and generated ID', () => {
    const s = createEvaluationScenario({ surface: 'cli', target: 'main.ts' });
    assert.ok(s.scenarioId, 'scenarioId is generated');
    assert.equal(s.surface, 'cli');
    assert.equal(s.target, 'main.ts');
    assert.equal(s.verifier, '');
    assert.deepEqual(s.successCriteria, []);
    assert.deepEqual(s.requiredEvidence, []);
    assert.equal(s.blocking, false);
  });

  it('should accept full overrides', () => {
    const s = createEvaluationScenario({
      scenarioId: 'custom-id',
      surface: 'browser',
      target: 'index.html',
      verifier: 'playwright',
      successCriteria: ['renders without error'],
      requiredEvidence: ['screenshot'],
      blocking: true,
    });
    assert.equal(s.scenarioId, 'custom-id');
    assert.equal(s.surface, 'browser');
    assert.equal(s.verifier, 'playwright');
    assert.deepEqual(s.successCriteria, ['renders without error']);
    assert.deepEqual(s.requiredEvidence, ['screenshot']);
    assert.equal(s.blocking, true);
  });

  it('should support all 6 surface types', () => {
    const surfaces = ['browser', 'cli', 'tui', 'api', 'artifact', 'data'];
    for (const surface of surfaces) {
      const s = createEvaluationScenario({ surface, target: 'x' });
      assert.equal(s.surface, surface);
    }
  });
});

// ═══ 2. RuntimeEvaluationSpec ═══════════════════════════════════════════════

describe('RuntimeEvaluationSpec', () => {
  it('should create with defaults', () => {
    const spec = createRuntimeEvaluationSpec();
    assert.ok(spec.specId, 'specId is generated');
    assert.deepEqual(spec.scenarios, []);
    assert.deepEqual(spec.requiredEnvironments, []);
    assert.deepEqual(spec.evidenceOutputs, []);
  });

  it('should accept overrides', () => {
    const scenario = createEvaluationScenario({ surface: 'cli', target: 'app' });
    const spec = createRuntimeEvaluationSpec({
      specId: 'spec-1',
      scenarios: [scenario],
      requiredEnvironments: ['node-20'],
      evidenceOutputs: ['coverage.json'],
    });
    assert.equal(spec.specId, 'spec-1');
    assert.equal(spec.scenarios.length, 1);
    assert.deepEqual(spec.requiredEnvironments, ['node-20']);
    assert.deepEqual(spec.evidenceOutputs, ['coverage.json']);
  });

  it('getSurfacesFromSpec returns unique surfaces', () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'a' }),
        createEvaluationScenario({ surface: 'cli', target: 'b' }),
        createEvaluationScenario({ surface: 'api', target: 'c' }),
        createEvaluationScenario({ surface: 'browser', target: 'd' }),
      ],
    });
    const surfaces = getSurfacesFromSpec(spec);
    assert.equal(surfaces.length, 3);
    assert.ok(surfaces.includes('cli'));
    assert.ok(surfaces.includes('api'));
    assert.ok(surfaces.includes('browser'));
  });

  it('getSurfacesFromSpec returns empty for no scenarios', () => {
    const spec = createRuntimeEvaluationSpec();
    assert.deepEqual(getSurfacesFromSpec(spec), []);
  });

  it('getBlockingScenarios filters only blocking', () => {
    const spec = createRuntimeEvaluationSpec({
      scenarios: [
        createEvaluationScenario({ surface: 'cli', target: 'a', blocking: true }),
        createEvaluationScenario({ surface: 'api', target: 'b', blocking: false }),
        createEvaluationScenario({ surface: 'tui', target: 'c', blocking: true }),
      ],
    });
    const blocking = getBlockingScenarios(spec);
    assert.equal(blocking.length, 2);
    assert.ok(blocking.every((s) => s.blocking));
  });

});

// ═══ 3. QualityRubric ═══════════════════════════════════════════════════════

describe('QualityRubric', () => {
  it('should create with defaults', () => {
    const rubric = createQualityRubric();
    assert.ok(rubric.rubricId, 'rubricId is generated');
    assert.deepEqual(rubric.dimensions, []);
  });

  it('should accept dimensions', () => {
    const rubric = createQualityRubric({
      rubricId: 'r-1',
      dimensions: [
        { name: 'coverage', kind: 'objective', threshold: 80 },
        { name: 'readability', kind: 'qualitative' },
      ],
    });
    assert.equal(rubric.rubricId, 'r-1');
    assert.equal(rubric.dimensions.length, 2);
  });

  it('evaluateRubric passes when all objectives met', () => {
    const rubric = createQualityRubric({
      dimensions: [
        { name: 'coverage', kind: 'objective', threshold: 80 },
        { name: 'perf', kind: 'objective', threshold: 0.5 },
      ],
    });
    const result = evaluateRubric(rubric, { coverage: 90, perf: 0.7 });
    assert.equal(result.passed, true);
    assert.deepEqual(result.failures, []);
  });

  it('evaluateRubric fails when objective below threshold', () => {
    const rubric = createQualityRubric({
      dimensions: [
        { name: 'coverage', kind: 'objective', threshold: 80 },
        { name: 'perf', kind: 'objective', threshold: 0.5 },
      ],
    });
    const result = evaluateRubric(rubric, { coverage: 70, perf: 0.7 });
    assert.equal(result.passed, false);
    assert.deepEqual(result.failures, ['coverage']);
  });

  it('evaluateRubric fails when score missing for objective', () => {
    const rubric = createQualityRubric({
      dimensions: [
        { name: 'coverage', kind: 'objective', threshold: 80 },
      ],
    });
    const result = evaluateRubric(rubric, {});
    assert.equal(result.passed, false);
    assert.deepEqual(result.failures, ['coverage']);
  });

  it('evaluateRubric ignores qualitative dimensions', () => {
    const rubric = createQualityRubric({
      dimensions: [
        { name: 'readability', kind: 'qualitative' },
      ],
    });
    const result = evaluateRubric(rubric, {});
    assert.equal(result.passed, true);
    assert.deepEqual(result.failures, []);
  });

  it('evaluateRubric ignores objective dimensions without threshold', () => {
    const rubric = createQualityRubric({
      dimensions: [
        { name: 'flexibility', kind: 'objective' },
      ],
    });
    const result = evaluateRubric(rubric, {});
    assert.equal(result.passed, true);
    assert.deepEqual(result.failures, []);
  });
});

// ═══ 4. IterationPolicy ═════════════════════════════════════════════════════

describe('IterationPolicy', () => {
  it('should create with defaults', () => {
    const p = createIterationPolicy();
    assert.ok(p.policyId, 'policyId is generated');
    assert.equal(p.maxAttempts, 3);
    assert.equal(p.escalationAt, 2);
    assert.equal(p.amendAfter, 3);
    assert.equal(p.allowStrategicRewrite, false);
  });

  it('should accept overrides', () => {
    const p = createIterationPolicy({
      policyId: 'p-1',
      maxAttempts: 5,
      escalationAt: 3,
      amendAfter: 4,
      allowStrategicRewrite: true,
    });
    assert.equal(p.policyId, 'p-1');
    assert.equal(p.maxAttempts, 5);
    assert.equal(p.escalationAt, 3);
    assert.equal(p.amendAfter, 4);
    assert.equal(p.allowStrategicRewrite, true);
  });

  it('shouldEscalate returns false before escalationAt', () => {
    const p = createIterationPolicy({ escalationAt: 3 });
    assert.equal(shouldEscalate(p, 1), false);
    assert.equal(shouldEscalate(p, 2), false);
  });

  it('shouldEscalate returns true at and after escalationAt', () => {
    const p = createIterationPolicy({ escalationAt: 2 });
    assert.equal(shouldEscalate(p, 2), true);
    assert.equal(shouldEscalate(p, 5), true);
  });

  it('shouldAmend returns false before amendAfter', () => {
    const p = createIterationPolicy({ amendAfter: 3 });
    assert.equal(shouldAmend(p, 1), false);
    assert.equal(shouldAmend(p, 2), false);
  });

  it('shouldAmend returns true at and after amendAfter', () => {
    const p = createIterationPolicy({ amendAfter: 3 });
    assert.equal(shouldAmend(p, 3), true);
    assert.equal(shouldAmend(p, 4), true);
  });

  it('isExhausted returns false before maxAttempts', () => {
    const p = createIterationPolicy({ maxAttempts: 3 });
    assert.equal(isExhausted(p, 1), false);
    assert.equal(isExhausted(p, 2), false);
  });

  it('isExhausted returns true at maxAttempts', () => {
    const p = createIterationPolicy({ maxAttempts: 3 });
    assert.equal(isExhausted(p, 3), true);
  });

  it('isExhausted returns true beyond maxAttempts', () => {
    const p = createIterationPolicy({ maxAttempts: 3 });
    assert.equal(isExhausted(p, 10), true);
  });
});
