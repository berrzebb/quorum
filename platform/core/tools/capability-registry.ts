/**
 * TypeScript bridge for tool-capabilities.mjs
 *
 * NodeNext module resolution requires .d.mts declarations for .mjs files.
 * This module provides a typed TypeScript entry point that loads the
 * .mjs registry at module init (top-level await, ESM) and re-exports
 * all functions with proper types.
 *
 * Path resolution: compiled code lives in dist/platform/core/tools/
 * but the .mjs stays in platform/core/tools/. We use import.meta.url
 * to navigate from dist back to source.
 *
 * Usage from any .ts file:
 *   import { getCapability, isDestructive } from "../../core/tools/capability-registry.js";
 *
 * @module core/tools/capability-registry
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ── Types (mirrored from tool-capabilities.d.ts) ──────────

export interface ToolCapability {
  name: string;
  isConcurrencySafe: boolean;
  isReadOnly: boolean;
  isDestructive: boolean;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  searchHint?: string;
  domain: string[];
  allowedRoles: string[];
  maxResultSizeChars: number;
  category: "analysis" | "scanning" | "matrix" | "domain" | "synthesis" | "coordination" | "lifecycle" | "pdca";
}

export interface ToolSurface {
  tools: string[];
  deferred: string[];
  env: Record<string, string>;
}

// ── Dynamic module load ───────────────────────────────────

// Resolve tool-capabilities.mjs from either source or dist location.
// Compiled: dist/platform/core/tools/ → navigate up to find platform/core/tools/
// Source:   platform/core/tools/ → same directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const MJS_NAME = "tool-capabilities.mjs";

let mjsPath = resolve(__dirname, MJS_NAME);
if (!existsSync(mjsPath)) {
  // Running from dist/ — walk up to project root, then into source
  mjsPath = resolve(__dirname, "..", "..", "..", "..", "platform", "core", "tools", MJS_NAME);
}

const _mod = await import(pathToFileURL(mjsPath).href) as Record<string, unknown>;

// ── Re-exports ────────────────────────────────────────────

export const TOOL_CAPABILITIES: readonly ToolCapability[] =
  _mod.TOOL_CAPABILITIES as readonly ToolCapability[];

export const getCapability: (name: string) => ToolCapability | undefined =
  _mod.getCapability as (name: string) => ToolCapability | undefined;

export const isConcurrencySafe: (name: string) => boolean =
  _mod.isConcurrencySafe as (name: string) => boolean;

export const isReadOnly: (name: string) => boolean =
  _mod.isReadOnly as (name: string) => boolean;

export const isDestructive: (name: string) => boolean =
  _mod.isDestructive as (name: string) => boolean;

export const shouldDefer: (name: string) => boolean =
  _mod.shouldDefer as (name: string) => boolean;

export const alwaysLoad: (name: string) => boolean =
  _mod.alwaysLoad as (name: string) => boolean;

export const toolsForRole: (role: string) => ToolCapability[] =
  _mod.toolsForRole as (role: string) => ToolCapability[];

export const toolsForDomain: (domain: string) => ToolCapability[] =
  _mod.toolsForDomain as (domain: string) => ToolCapability[];

export const alwaysLoadTools: () => ToolCapability[] =
  _mod.alwaysLoadTools as () => ToolCapability[];

export const deferredTools: () => ToolCapability[] =
  _mod.deferredTools as () => ToolCapability[];

export const searchTools: (query: string, maxResults?: number) => ToolCapability[] =
  _mod.searchTools as (query: string, maxResults?: number) => ToolCapability[];

export const allToolNames: () => string[] =
  _mod.allToolNames as () => string[];

export const isKnownTool: (name: string) => boolean =
  _mod.isKnownTool as (name: string) => boolean;

export const buildToolSurface: (role: string, domains?: string[]) => ToolSurface =
  _mod.buildToolSurface as (role: string, domains?: string[]) => ToolSurface;
