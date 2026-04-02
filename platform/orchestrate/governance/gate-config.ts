/**
 * Gate Configuration — essential/optional/disabled gate classification.
 *
 * Controls which governance gates run during wave execution.
 * Essential gates always run. Optional gates require --full-gates
 * or explicit config activation. cross-model-audit cannot be disabled.
 *
 * @module orchestrate/governance/gate-config
 */

// ── Types ────────────────────────────────────

export type GateTier = 'essential' | 'optional' | 'disabled';

export type GateName =
  // Wave-level gates (audit-loop.ts)
  | 'changed-files'     // 1. Changed files + dep audit
  | 'regression'        // 2. Regression detection
  | 'stub-scan'         // 3. Stub/placeholder scan
  | 'perf-scan'         // 4. Perf anti-pattern scan
  | 'blueprint-lint'    // 5. Blueprint naming lint
  | 'scope-check'       // 6. File scope enforcement
  | 'fitness'           // 7. Fitness gate
  | 'test-file-check'   // 8. Test file creation check
  | 'wb-constraints'    // 9. WB constraint check
  // Track-level gates
  | 'cross-model-audit' // Cross-model audit (INVARIANT)
  | 'build-verify'      // Build verification (tsc)
  | 'test-pass'         // Project test execution
  | 'runtime-eval'      // Runtime evaluation gate
  | 'phase-completion'  // Phase completion check
  | 'confluence'        // Confluence integrity check
  | 'e2e-verify'        // E2E verification
  | 'contract-promotion'// Contract promotion gate
  | 'wave-commit'       // WIP commit
  | 'orphan-detect'     // Orphan file detection
  | 'license-audit'     // License/copyleft audit
  | 'fix-stagnation';   // Fix loop stagnation

export interface GateClassification {
  essential: GateName[];
  optional: GateName[];
  disabled: GateName[];
}

// ── Default classification ──────────────────

export const DEFAULT_CLASSIFICATION: GateClassification = {
  essential: [
    'changed-files',
    'stub-scan',
    'scope-check',
    'cross-model-audit',
    'build-verify',
    'test-pass',
    'runtime-eval',
  ],
  optional: [
    'regression',
    'perf-scan',
    'blueprint-lint',
    'fitness',
    'test-file-check',
    'wb-constraints',
    'confluence',
    'e2e-verify',
    'phase-completion',
  ],
  disabled: [
    'contract-promotion',
    'wave-commit',
    'orphan-detect',
    'license-audit',
    'fix-stagnation',
  ],
};

/** Gate that can NEVER be disabled — core invariant. */
const INVARIANT_GATE: GateName = 'cross-model-audit';

// ── GateConfig ──────────────────────────────

export class GateConfig {
  private readonly _enabled: Set<GateName>;

  constructor(classification?: GateClassification, fullGates = false) {
    const cls = classification ?? DEFAULT_CLASSIFICATION;
    this._enabled = new Set<GateName>();

    // Essential always enabled
    for (const g of cls.essential) this._enabled.add(g);

    if (fullGates) {
      // Full mode: enable optional too
      for (const g of cls.optional) this._enabled.add(g);
      // Disabled gates also run in full mode
      for (const g of cls.disabled) this._enabled.add(g);
    }

    // Invariant: cross-model-audit is ALWAYS enabled
    this._enabled.add(INVARIANT_GATE);
  }

  isEnabled(gate: GateName): boolean {
    return this._enabled.has(gate);
  }

  get enabledGates(): GateName[] {
    return [...this._enabled];
  }

  get enabledCount(): number {
    return this._enabled.size;
  }
}

// ── Factory helpers ─────────────────────────

/** Default config: essential gates only. */
export function createDefaultGateConfig(): GateConfig {
  return new GateConfig();
}

/** Full gates config: all 21 gates enabled. */
export function createFullGateConfig(): GateConfig {
  return new GateConfig(undefined, true);
}

/** Create from user-provided classification (e.g., config.json). */
export function createGateConfigFromClassification(
  classification: GateClassification,
  fullGates = false,
): GateConfig {
  // Enforce invariant: cross-model-audit must be in essential
  if (!classification.essential.includes(INVARIANT_GATE)) {
    classification.essential.push(INVARIANT_GATE);
    // Remove from disabled/optional if present
    classification.optional = classification.optional.filter(g => g !== INVARIANT_GATE);
    classification.disabled = classification.disabled.filter(g => g !== INVARIANT_GATE);
  }
  return new GateConfig(classification, fullGates);
}

/**
 * Load GateConfig from config.json `gates` section.
 * Merges user overrides with DEFAULT_CLASSIFICATION.
 * Warns if cross-model-audit is in disabled.
 */
export function loadGateConfigFromJson(
  gatesJson: Partial<GateClassification> | undefined,
  fullGates = false,
): { config: GateConfig; warnings: string[] } {
  const warnings: string[] = [];

  if (!gatesJson) {
    return { config: new GateConfig(undefined, fullGates), warnings };
  }

  // Merge with defaults: user can override individual tiers
  const classification: GateClassification = {
    essential: (gatesJson.essential as GateName[]) ?? [...DEFAULT_CLASSIFICATION.essential],
    optional: (gatesJson.optional as GateName[]) ?? [...DEFAULT_CLASSIFICATION.optional],
    disabled: (gatesJson.disabled as GateName[]) ?? [...DEFAULT_CLASSIFICATION.disabled],
  };

  // Warn if cross-model-audit is in disabled
  if (classification.disabled.includes(INVARIANT_GATE)) {
    warnings.push(
      `⚠ cross-model-audit cannot be disabled — ignoring config override. ` +
      `This gate is a core invariant and will always run.`,
    );
  }

  const config = createGateConfigFromClassification(classification, fullGates);
  return { config, warnings };
}
