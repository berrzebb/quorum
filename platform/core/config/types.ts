/**
 * Config Types — shared type definitions for the settings hierarchy.
 *
 * @module core/config/types
 */

// ── Config Tiers ────────────────────────────────────

/** Configuration source tier (ordered by priority, policy is highest). */
export type ConfigTier = "defaults" | "user" | "project" | "local" | "policy";

/** All tiers in priority order (lowest to highest). */
export const CONFIG_TIERS: readonly ConfigTier[] = [
  "defaults",
  "user",
  "project",
  "local",
  "policy",
];

// ── Config Shape ────────────────────────────────────

/** Plugin-specific config. */
export interface PluginConfig {
  locale?: string;
  hooks_enabled?: Record<string, boolean>;
}

/** Consensus tag config. */
export interface ConsensusConfig {
  trigger_tag?: string;
  agree_tag?: string;
  pending_tag?: string;
  roles?: Record<string, string>;
  eligibleVoters?: string[];
}

/** Quality rule entry. */
export interface QualityRule {
  pattern?: string;
  preset?: string;
  severity?: string;
  [key: string]: unknown;
}

/** Gate profile config. */
export interface GatesConfig {
  essential?: string[];
  optional?: string[];
  disabled?: string[];
  profile?: string;
}

/** Parliament config. */
export interface ParliamentConfig {
  convergenceThreshold?: number;
  maxRounds?: number;
  maxAutoAmendments?: number;
  roles?: Record<string, string>;
}

/** Stop review gate config. */
export interface StopReviewGateConfig {
  enabled?: boolean;
}

/** Permission config (v0.6.2). */
export interface PermissionConfig {
  safeTools?: string[];
  defaultMode?: string;
}

/** Full quorum config shape. */
export interface QuorumConfig {
  plugin?: PluginConfig;
  consensus?: ConsensusConfig;
  quality_rules?: QualityRule[];
  gates?: GatesConfig;
  parliament?: ParliamentConfig;
  stopReviewGate?: StopReviewGateConfig;
  permission?: PermissionConfig;
  /** Passthrough — unknown keys allowed for extensibility. */
  [key: string]: unknown;
}

/** Default config values. */
export const DEFAULT_CONFIG: QuorumConfig = {
  plugin: { locale: "en", hooks_enabled: {} },
  consensus: {
    trigger_tag: "[REVIEW_NEEDED]",
    agree_tag: "[APPROVED]",
    pending_tag: "[CHANGES_REQUESTED]",
  },
  quality_rules: [],
  gates: { essential: [], optional: [], disabled: [] },
  parliament: { convergenceThreshold: 0.7, maxRounds: 5, maxAutoAmendments: 3 },
  stopReviewGate: { enabled: false },
  permission: { safeTools: [], defaultMode: "default" },
};
