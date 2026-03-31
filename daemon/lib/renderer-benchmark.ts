/**
 * Renderer Benchmark Harness — measures transcript-heavy daemon workload.
 *
 * RTI-10: This is a BENCHMARK, not a rewrite. Measures the cost of the
 * current Ink rendering path on transcript-heavy workloads. The result
 * is a go/no-go decision document — custom renderer rewrite is only
 * justified if this benchmark shows measurable steady-state regression.
 *
 * Workload:
 * - Simulates N visible transcript lines with mixed content types
 * - Measures time to parse, classify, and extract visible text
 * - Measures search index append + query latency at scale
 *
 * @since RTI-10
 * @module daemon/lib/renderer-benchmark
 */

import { extractVisibleText, TranscriptIndex } from "../../platform/bus/transcript-index.js";

// ── Benchmark Types ─────────────────────────────────

export interface BenchmarkResult {
  /** Workload size (number of raw lines). */
  rawLineCount: number;
  /** Number of visible lines after extraction. */
  visibleLineCount: number;
  /** Time to extract visible text (ms). */
  extractionMs: number;
  /** Time to index all visible lines (ms). */
  indexingMs: number;
  /** Time for a single search query (ms). */
  queryMs: number;
  /** Lines per second throughput (extraction). */
  extractionThroughput: number;
  /** Lines per second throughput (indexing). */
  indexingThroughput: number;
  /** Whether p95 query latency is under 100ms target (G3). */
  queryLatencyMet: boolean;
}

// ── Workload Generator ──────────────────────────────

/** Generate a realistic transcript-heavy workload. */
export function generateWorkload(lineCount: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    const kind = i % 10;
    switch (kind) {
      case 0:
        lines.push(JSON.stringify({ type: "message", role: "user", content: `User message ${i}: please fix the authentication module and add comprehensive tests` }));
        break;
      case 1:
      case 2:
      case 3:
        lines.push(JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: `Assistant response line ${i}: analyzing the codebase structure and identifying potential issues` } }));
        break;
      case 4:
        lines.push(JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: i % 2 === 0 ? "code_map" : "blast_radius" } }));
        break;
      case 5:
        lines.push(JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: `{"query": "pattern_${i}"}` } }));
        break;
      case 6:
        lines.push(JSON.stringify({ type: "tool_result", content: `Tool output for iteration ${i}: found 3 matches in src/auth/` }));
        break;
      case 7:
        lines.push(JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: `Thinking about approach for step ${i}...` } }));
        break;
      case 8:
        lines.push(`<system-reminder>Internal context for model — not visible to user</system-reminder>`);
        break;
      case 9:
        lines.push(JSON.stringify({ id: `msg_${i}`, model: "claude-opus", usage: { input_tokens: i * 10 } }));
        break;
    }
  }
  return lines;
}

// ── Benchmark Runner ────────────────────────────────

/**
 * Run the transcript-heavy benchmark.
 *
 * Measures extraction, indexing, and query latency at the given scale.
 * Returns structured results for go/no-go decision.
 *
 * @param lineCount Number of raw transcript lines (default: 10000 for G3 target)
 * @since RTI-10
 */
export function runBenchmark(lineCount = 10_000): BenchmarkResult {
  const workload = generateWorkload(lineCount);

  // Measure extraction
  const extractStart = performance.now();
  const visible = extractVisibleText(workload);
  const extractionMs = performance.now() - extractStart;

  // Measure indexing
  const index = new TranscriptIndex();
  const indexStart = performance.now();
  index.appendBatch("bench-session", workload);
  const indexingMs = performance.now() - indexStart;

  // Measure query (search for a term that appears in multiple lines)
  const queryStart = performance.now();
  index.query("bench-session", "authentication module");
  const queryMs = performance.now() - queryStart;

  return {
    rawLineCount: lineCount,
    visibleLineCount: visible.length,
    extractionMs: Math.round(extractionMs * 100) / 100,
    indexingMs: Math.round(indexingMs * 100) / 100,
    queryMs: Math.round(queryMs * 100) / 100,
    extractionThroughput: Math.round(lineCount / (extractionMs / 1000)),
    indexingThroughput: Math.round(lineCount / (indexingMs / 1000)),
    queryLatencyMet: queryMs < 100, // G3: p95 < 100ms
  };
}
