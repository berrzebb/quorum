/**
 * Shared types for the planning module.
 * Extracted from cli/commands/orchestrate/shared.ts — shapes match exactly.
 */

/** WB complexity tier */
export type WBSize = 'XS' | 'S' | 'M';

/** Work breakdown item — single unit of implementation work. */
export interface WorkItem {
  id: string;
  /** Human-readable title from WB heading */
  title?: string;
  targetFiles: string[];
  dependsOn?: string[];
  /** WB complexity: XS (~15-50 lines), S (~60-150), M (~180-250) */
  size?: WBSize;
  /** Concrete action steps (what to do, not "implement X") */
  action?: string;
  /** Files to read (context) and files to skip */
  contextBudget?: { read: string[]; skip: string[] };
  /** Runnable verification command */
  verify?: string;
  /** Scope boundaries — what NOT to do */
  constraints?: string;
  /** Done criteria */
  done?: string;
  /** Parent feature ID (null for top-level parents) */
  parentId?: string;
  /** Whether this is a parent (feature) or child (task) item */
  isParent?: boolean;
  /** Integration target — what this parent's scenario test verifies */
  integrationTarget?: string;
}

/** Alias for WorkItem — used in task descriptions as WBItem. */
export type WBItem = WorkItem;

/** Track reference info — discovered from docs/plans directories. */
export interface TrackInfo {
  name: string;
  path: string;
  items: number;
}

/** Plan review output — structural validation result. */
export interface PlanReviewResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

/** Wave execution group — items that can run in parallel within a phase. */
export interface Wave {
  /** Wave index (0-based, global across all phases) */
  index: number;
  /** Phase parent ID (e.g., "Phase-0") or null for orphans */
  phaseId: string | null;
  /** Items in this wave — can run in parallel */
  items: WorkItem[];
}

/** Alias for Wave — used in task descriptions as WaveGroup. */
export type WaveGroup = Wave;

/** Loose bridge type — wraps dynamically loaded MJS bridge module. */
export type Bridge = Record<string, Function>;

/** Minimal mux interface — methods used by orchestrate execution modules. */
export interface MuxHandle {
  spawn(opts: Record<string, unknown>): Promise<{ id: string; name: string }>;
  send(sessionId: string, input: string): boolean;
  kill(sessionId: string): Promise<void>;
  capture(sessionId: string, lines?: number): { output: string } | null;
  getBackend(): string;
}

/** Parsed heading information from a WB markdown line. */
export interface HeadingInfo {
  /** Markdown heading level (2 = ##, 3 = ###) */
  level: number;
  /** Extracted ID — e.g. "ORC-3", "Phase-1", "Step-2A" */
  id: string;
  /** Human-readable title after the ID */
  title: string;
  /** Size extracted from heading parenthetical, if present */
  size?: WBSize;
  /** True for Phase/Step parent headings */
  isParent: boolean;
}
