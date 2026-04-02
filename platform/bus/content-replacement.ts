/**
 * Content Replacement — large tool result → disk persist + preview pointer.
 *
 * When tool output exceeds a threshold, the full content is persisted to disk
 * and replaced with a preview + artifact pointer in the prompt context.
 *
 * Both prompt path and remote UI consume the same replacement record.
 *
 * @module bus/content-replacement
 * @since RAI-6
 * @experimental Not part of v0.6.0 simplified flow — retained for future integration.
 */

import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Types ────────────────────────────────────

export interface ContentReplacementRecord {
  /** Unique artifact identifier. */
  artifactId: string;
  /** Preview text for prompt/UI. */
  preview: string;
  /** Path to full artifact on disk. */
  path: string;
  /** Original content size in bytes. */
  originalSize: number;
  /** Preview size in bytes. */
  previewSize: number;
  /** Reduction ratio (0.0 - 1.0). */
  reduction: number;
  /** Session that produced this artifact. */
  sessionId: string;
  /** When the replacement was created. */
  createdAt: number;
}

export interface ReplacementConfig {
  /** Minimum content size to trigger replacement (bytes). Default: 10000. */
  minSize: number;
  /** Maximum preview length (chars). Default: 500. */
  maxPreviewChars: number;
  /** Artifact storage directory. */
  artifactDir: string;
  /** Maximum artifacts to retain. Default: 50. */
  maxArtifacts: number;
}

// ── Default Config ───────────────────────────

export function defaultReplacementConfig(repoRoot: string): ReplacementConfig {
  return {
    minSize: 10_000,
    maxPreviewChars: 500,
    artifactDir: resolve(repoRoot, ".session-state", "artifacts"),
    maxArtifacts: 50,
  };
}

// ── Replacement Logic ────────────────────────

/**
 * Check if content should be replaced.
 */
export function shouldReplace(content: string, config: ReplacementConfig): boolean {
  return content.length >= config.minSize;
}

/**
 * Replace large content with a preview + artifact pointer.
 *
 * Returns the replacement record and the preview string for prompt injection.
 */
export function replaceContent(
  content: string,
  sessionId: string,
  config: ReplacementConfig,
): ContentReplacementRecord {
  const artifactId = `artifact-${sessionId}-${Date.now()}`;
  const artifactPath = resolve(config.artifactDir, `${artifactId}.txt`);

  // Persist full content to disk
  mkdirSync(config.artifactDir, { recursive: true });
  writeFileSync(artifactPath, content, "utf8");

  // Generate preview
  const preview = generatePreview(content, config.maxPreviewChars);

  const record: ContentReplacementRecord = {
    artifactId,
    preview,
    path: artifactPath,
    originalSize: content.length,
    previewSize: preview.length,
    reduction: 1 - (preview.length / content.length),
    sessionId,
    createdAt: Date.now(),
  };

  // Enforce retention limit
  enforceRetention(config);

  return record;
}

/**
 * Fetch full artifact content by path.
 * Used by remote clients when they need the complete output.
 */
export function fetchArtifact(artifactPath: string): string | null {
  try {
    return readFileSync(artifactPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Format a replacement record as prompt-friendly text.
 */
export function formatReplacement(record: ContentReplacementRecord): string {
  return [
    `[Content replaced — ${record.originalSize} bytes → ${record.previewSize} byte preview]`,
    `[Full artifact: ${record.artifactId}]`,
    "",
    record.preview,
    "",
    `[... ${record.originalSize - record.previewSize} bytes truncated]`,
  ].join("\n");
}

/**
 * Process content: replace if large, pass through if small.
 */
export function processContent(
  content: string,
  sessionId: string,
  config: ReplacementConfig,
): { content: string; replaced: boolean; record?: ContentReplacementRecord } {
  if (!shouldReplace(content, config)) {
    return { content, replaced: false };
  }
  const record = replaceContent(content, sessionId, config);
  return { content: formatReplacement(record), replaced: true, record };
}

// ── Helpers ──────────────────────────────────

function generatePreview(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  // Take first portion and last portion
  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = maxChars - headSize - 5; // 5 for "\n...\n"
  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);
  return `${head}\n...\n${tail}`;
}

function enforceRetention(config: ReplacementConfig): void {
  try {
    const files = readdirSync(config.artifactDir)
      .filter(f => f.startsWith("artifact-"))
      .map(f => {
        // Extract timestamp from filename (artifact-{session}-{timestamp}.txt)
        const match = f.match(/(\d{13,})\.txt$/);
        return { name: f, mtime: match ? Number(match[1]) : 0 };
      })
      .sort((a, b) => a.mtime - b.mtime);

    // Remove oldest if over limit
    while (files.length > config.maxArtifacts) {
      const oldest = files.shift();
      if (oldest) {
        try { unlinkSync(join(config.artifactDir, oldest.name)); } catch { /* best effort */ }
      }
    }
  } catch { /* retention is best-effort */ }
}
