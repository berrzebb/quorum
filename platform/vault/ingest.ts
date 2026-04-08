/**
 * Vault Ingest — scan session files, parse, store in vault.db, copy to raw/.
 *
 * Entry points:
 * - ingestFile(store, filePath, vaultRoot) — single file
 * - ingestAuto(store, vaultRoot) — auto-detect Claude Code sessions
 * - ingestDirectory(store, dir, vaultRoot) — scan a directory
 */

import { existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { parseSession } from "./parsers/index.js";
import type { VaultStore } from "./store.js";

export interface IngestResult {
  ingested: number;
  skipped: number;
  errors: number;
  details: Array<{ file: string; status: "ingested" | "skipped" | "error"; turns?: number; error?: string }>;
}

/**
 * Ingest a single session file.
 * Parses → stores in vault.db → copies raw file to vault/raw/sessions/{date}/.
 */
export function ingestFile(store: VaultStore, filePath: string, vaultRoot: string): IngestResult {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: 0, details: [] };

  try {
    const session = parseSession(filePath);

    if (store.hasSession(session.id)) {
      result.skipped++;
      result.details.push({ file: filePath, status: "skipped" });
      return result;
    }

    // Store in vault.db
    const { turns } = store.insertSession(session);

    // Copy raw file to vault/raw/sessions/{date}/
    const date = session.startedAt > 0
      ? new Date(session.startedAt).toISOString().slice(0, 10)
      : "unknown";
    const rawDir = join(vaultRoot, "raw", "sessions", date);
    mkdirSync(rawDir, { recursive: true });
    const destName = `${session.provider}-${basename(filePath)}`;
    const destPath = join(rawDir, destName);
    if (!existsSync(destPath)) {
      copyFileSync(filePath, destPath);
    }

    result.ingested++;
    result.details.push({ file: filePath, status: "ingested", turns });
  } catch (err) {
    result.errors++;
    result.details.push({ file: filePath, status: "error", error: (err as Error).message });
  }

  return result;
}

/**
 * Auto-detect and ingest Claude Code sessions from default locations.
 */
export function ingestAuto(store: VaultStore, vaultRoot: string): IngestResult {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: 0, details: [] };

  // Claude Code: ~/.claude/projects/*/
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  if (existsSync(claudeProjectsDir)) {
    try {
      for (const project of readdirSync(claudeProjectsDir)) {
        const projectDir = join(claudeProjectsDir, project);
        const files = readdirSync(projectDir).filter(f => f.endsWith(".jsonl"));
        for (const file of files) {
          const r = ingestFile(store, join(projectDir, file), vaultRoot);
          result.ingested += r.ingested;
          result.skipped += r.skipped;
          result.errors += r.errors;
          result.details.push(...r.details);
        }
      }
    } catch { /* access error */ }
  }

  // Codex: ~/.codex/sessions/* (if exists)
  const codexDir = join(homedir(), ".codex", "sessions");
  if (existsSync(codexDir)) {
    try {
      for (const file of readdirSync(codexDir).filter(f => f.endsWith(".jsonl"))) {
        const r = ingestFile(store, join(codexDir, file), vaultRoot);
        result.ingested += r.ingested;
        result.skipped += r.skipped;
        result.errors += r.errors;
        result.details.push(...r.details);
      }
    } catch { /* access error */ }
  }

  // Gemini: ~/.gemini/sessions/* (if exists)
  const geminiDir = join(homedir(), ".gemini", "sessions");
  if (existsSync(geminiDir)) {
    try {
      for (const file of readdirSync(geminiDir).filter(f => f.endsWith(".json") || f.endsWith(".jsonl"))) {
        const r = ingestFile(store, join(geminiDir, file), vaultRoot);
        result.ingested += r.ingested;
        result.skipped += r.skipped;
        result.errors += r.errors;
        result.details.push(...r.details);
      }
    } catch { /* access error */ }
  }

  return result;
}

/**
 * Ingest all session files from a directory.
 */
export function ingestDirectory(store: VaultStore, dir: string, vaultRoot: string): IngestResult {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: 0, details: [] };

  if (!existsSync(dir)) return result;

  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl") || f.endsWith(".json"));
  for (const file of files) {
    const r = ingestFile(store, join(dir, file), vaultRoot);
    result.ingested += r.ingested;
    result.skipped += r.skipped;
    result.errors += r.errors;
    result.details.push(...r.details);
  }

  return result;
}
