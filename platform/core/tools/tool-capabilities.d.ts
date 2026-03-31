/**
 * TypeScript declarations for tool-capabilities.mjs
 *
 * Canonical tool metadata types — adopted from Claude Code Tool.ts patterns.
 */

export interface ToolCapability {
  /** Canonical tool name (matches MCP server registration). */
  name: string;
  /** Safe to run in parallel with other tools. */
  isConcurrencySafe: boolean;
  /** Does not modify filesystem or state. */
  isReadOnly: boolean;
  /** Deletes or overwrites data. */
  isDestructive: boolean;
  /** Hidden until discovered via ToolSearch. */
  shouldDefer?: boolean;
  /** Always appears in initial prompt (never deferred). */
  alwaysLoad?: boolean;
  /** Space-separated keywords for ToolSearch deferred discovery. */
  searchHint?: string;
  /** Quorum domains this tool serves. Empty = domain-agnostic. */
  domain: string[];
  /** Orchestrator roles permitted to invoke this tool. */
  allowedRoles: string[];
  /** Output size threshold for disk persistence (chars). */
  maxResultSizeChars: number;
  /** Functional category. */
  category: "analysis" | "scanning" | "matrix" | "domain" | "synthesis" | "coordination" | "lifecycle" | "pdca";
}

export declare const TOOL_CAPABILITIES: readonly ToolCapability[];

export declare function getCapability(name: string): ToolCapability | undefined;
export declare function isConcurrencySafe(name: string): boolean;
export declare function isReadOnly(name: string): boolean;
export declare function isDestructive(name: string): boolean;
export declare function shouldDefer(name: string): boolean;
export declare function alwaysLoad(name: string): boolean;
export declare function toolsForRole(role: string): ToolCapability[];
export declare function toolsForDomain(domain: string): ToolCapability[];
export declare function alwaysLoadTools(): ToolCapability[];
export declare function deferredTools(): ToolCapability[];
export declare function searchTools(query: string, maxResults?: number): ToolCapability[];
export declare function allToolNames(): string[];
export declare function isKnownTool(name: string): boolean;
