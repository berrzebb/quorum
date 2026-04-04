/**
 * Config Schema Validation — native validation without external dependencies.
 *
 * Validates QuorumConfig structure with passthrough (unknown keys preserved).
 * safeParse returns partial results even when errors exist (fail-open).
 *
 * @module core/config/schema
 */

import type { QuorumConfig, GateProfile } from "./types.js";
import { DEFAULT_CONFIG, GATE_PROFILES } from "./types.js";

// ── Validation Result ───────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

export interface ParseResult {
  /** Validated config (with defaults applied for invalid fields). */
  data: QuorumConfig;
  /** Validation errors found (empty if all valid). */
  errors: ValidationError[];
  /** Whether parsing was successful (no errors). */
  success: boolean;
}

// ── Validators ──────────────────────────────────────

function validateString(value: unknown, path: string, errors: ValidationError[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    errors.push({ path, message: `Expected string, got ${typeof value}`, value });
    return undefined;
  }
  return value;
}

function validateNumber(value: unknown, path: string, errors: ValidationError[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push({ path, message: `Expected number, got ${typeof value}`, value });
    return undefined;
  }
  return value;
}

function validateBoolean(value: unknown, path: string, errors: ValidationError[]): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    errors.push({ path, message: `Expected boolean, got ${typeof value}`, value });
    return undefined;
  }
  return value;
}

function validateArray(value: unknown, path: string, errors: ValidationError[]): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    errors.push({ path, message: `Expected array, got ${typeof value}`, value });
    return undefined;
  }
  return value;
}

function validateObject(value: unknown, path: string, errors: ValidationError[]): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push({ path, message: `Expected object, got ${typeof value}`, value });
    return undefined;
  }
  return value as Record<string, unknown>;
}

// ── Section Validators ──────────────────────────────

function validatePlugin(raw: unknown, errors: ValidationError[]): QuorumConfig["plugin"] {
  const obj = validateObject(raw, "plugin", errors);
  if (!obj) return DEFAULT_CONFIG.plugin;

  return {
    locale: validateString(obj.locale, "plugin.locale", errors) ?? DEFAULT_CONFIG.plugin!.locale,
    hooks_enabled: validateObject(obj.hooks_enabled, "plugin.hooks_enabled", errors) as Record<string, boolean> | undefined
      ?? DEFAULT_CONFIG.plugin!.hooks_enabled,
  };
}

function validateConsensus(raw: unknown, errors: ValidationError[]): QuorumConfig["consensus"] {
  const obj = validateObject(raw, "consensus", errors);
  if (!obj) return DEFAULT_CONFIG.consensus;

  return {
    trigger_tag: validateString(obj.trigger_tag, "consensus.trigger_tag", errors)
      ?? DEFAULT_CONFIG.consensus!.trigger_tag,
    agree_tag: validateString(obj.agree_tag, "consensus.agree_tag", errors)
      ?? DEFAULT_CONFIG.consensus!.agree_tag,
    pending_tag: validateString(obj.pending_tag, "consensus.pending_tag", errors)
      ?? DEFAULT_CONFIG.consensus!.pending_tag,
    roles: validateObject(obj.roles, "consensus.roles", errors) as Record<string, string> | undefined,
    eligibleVoters: validateArray(obj.eligibleVoters, "consensus.eligibleVoters", errors) as string[] | undefined,
  };
}

function validateGateProfile(value: unknown, path: string, errors: ValidationError[]): GateProfile | undefined {
  if (value === undefined || value === null) return undefined;
  const s = validateString(value, path, errors);
  if (s && !(GATE_PROFILES as readonly string[]).includes(s)) {
    errors.push({ path, message: `Invalid gate profile "${s}". Valid: ${GATE_PROFILES.join(", ")}`, value });
    return undefined;
  }
  return s as GateProfile | undefined;
}

function validateGates(raw: unknown, errors: ValidationError[]): QuorumConfig["gates"] {
  const obj = validateObject(raw, "gates", errors);
  if (!obj) return DEFAULT_CONFIG.gates;

  return {
    essential: validateArray(obj.essential, "gates.essential", errors) as string[] | undefined,
    optional: validateArray(obj.optional, "gates.optional", errors) as string[] | undefined,
    disabled: validateArray(obj.disabled, "gates.disabled", errors) as string[] | undefined,
    profile: validateString(obj.profile, "gates.profile", errors),
    gateProfile: validateGateProfile(obj.gateProfile, "gates.gateProfile", errors)
      ?? DEFAULT_CONFIG.gates!.gateProfile,
  };
}

function validateParliament(raw: unknown, errors: ValidationError[]): QuorumConfig["parliament"] {
  const obj = validateObject(raw, "parliament", errors);
  if (!obj) return DEFAULT_CONFIG.parliament;

  return {
    convergenceThreshold: validateNumber(obj.convergenceThreshold, "parliament.convergenceThreshold", errors),
    maxRounds: validateNumber(obj.maxRounds, "parliament.maxRounds", errors),
    maxAutoAmendments: validateNumber(obj.maxAutoAmendments, "parliament.maxAutoAmendments", errors),
    roles: validateObject(obj.roles, "parliament.roles", errors) as Record<string, string> | undefined,
  };
}

// ── Main API ────────────────────────────────────────

/**
 * Validate and parse a QuorumConfig object.
 *
 * - Valid fields are preserved as-is
 * - Invalid fields fall back to defaults
 * - Unknown keys are passed through (extensibility)
 * - Always returns a result (never throws)
 */
export function safeParseConfig(raw: unknown): ParseResult {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      data: structuredClone(DEFAULT_CONFIG),
      errors: [{ path: "", message: "Config is not an object", value: raw }],
      success: false,
    };
  }

  const input = raw as Record<string, unknown>;

  // Validate known sections
  const data: QuorumConfig = {
    plugin: validatePlugin(input.plugin, errors),
    consensus: validateConsensus(input.consensus, errors),
    quality_rules: validateArray(input.quality_rules, "quality_rules", errors) as QuorumConfig["quality_rules"]
      ?? DEFAULT_CONFIG.quality_rules,
    gates: validateGates(input.gates, errors),
    parliament: validateParliament(input.parliament, errors),
    stopReviewGate: {
      enabled: validateBoolean(
        (input.stopReviewGate as Record<string, unknown> | undefined)?.enabled,
        "stopReviewGate.enabled",
        errors,
      ) ?? DEFAULT_CONFIG.stopReviewGate!.enabled,
    },
    permission: {
      safeTools: validateArray(
        (input.permission as Record<string, unknown> | undefined)?.safeTools,
        "permission.safeTools",
        errors,
      ) as string[] | undefined ?? DEFAULT_CONFIG.permission!.safeTools,
      defaultMode: validateString(
        (input.permission as Record<string, unknown> | undefined)?.defaultMode,
        "permission.defaultMode",
        errors,
      ) ?? DEFAULT_CONFIG.permission!.defaultMode,
    },
  };

  // Passthrough: preserve unknown keys
  const KNOWN_KEYS = new Set([
    "plugin", "consensus", "quality_rules", "gates",
    "parliament", "stopReviewGate", "permission",
  ]);
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_KEYS.has(key)) {
      data[key] = value;
    }
  }

  return { data, errors, success: errors.length === 0 };
}
