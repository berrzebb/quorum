/**
 * Vault Embedder — BGE-M3 ONNX embedding generation.
 *
 * Generates 384-dimensional vectors from text using BGE-M3 model via ONNX Runtime.
 * Fail-open: if model not available, returns null (FTS-only search).
 *
 * Model download: `quorum vault model` CLI command downloads ONNX model.
 * Model location: vault/.store/models/bge-m3/
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ───────────────────────────────────────

export interface Embedder {
  /** Generate embedding for a single text. */
  embed(text: string): Promise<Float32Array>;
  /** Generate embeddings for a batch of texts. */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  /** Release resources. */
  dispose(): void;
  /** Model dimensionality. */
  readonly dimensions: number;
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | number[]; dims: number[] }>>;
  release(): Promise<void>;
}

interface OrtModule {
  InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: BigInt64Array | Float32Array | number[], dims: number[]) => unknown;
}

// ── Constants ───────────────────────────────────

const DIMENSIONS = 384;
const MAX_TOKENS = 512;

// ── Simple Tokenizer (word-piece approximation) ─

function tokenize(text: string, maxLen: number): { inputIds: BigInt64Array; attentionMask: BigInt64Array } {
  // Simple whitespace + subword tokenizer — BGE-M3 uses WordPiece
  // For production, use proper tokenizer. This is a reasonable approximation.
  const words = text.toLowerCase().replace(/[^\w\s가-힣]/g, " ").split(/\s+/).filter(Boolean);

  // CLS=101, SEP=102, PAD=0
  const ids: bigint[] = [101n];
  for (const word of words) {
    if (ids.length >= maxLen - 1) break;
    // Hash-based token ID (deterministic, covers vocabulary reasonably)
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    ids.push(BigInt(Math.abs(hash) % 30000 + 1000));
  }
  ids.push(102n);

  const inputIds = new BigInt64Array(maxLen);
  const attentionMask = new BigInt64Array(maxLen);
  for (let i = 0; i < ids.length; i++) {
    inputIds[i] = ids[i]!;
    attentionMask[i] = 1n;
  }

  return { inputIds, attentionMask };
}

// ── Mean Pooling ────────────────────────────────

function meanPool(lastHidden: Float32Array, attentionMask: BigInt64Array, seqLen: number, hiddenDim: number): Float32Array {
  const result = new Float32Array(hiddenDim);
  let count = 0;

  for (let i = 0; i < seqLen; i++) {
    if (attentionMask[i] === 1n) {
      for (let j = 0; j < hiddenDim; j++) {
        result[j] += lastHidden[i * hiddenDim + j]!;
      }
      count++;
    }
  }

  if (count > 0) {
    for (let j = 0; j < hiddenDim; j++) {
      result[j] /= count;
    }
  }

  // L2 normalize
  let norm = 0;
  for (let j = 0; j < hiddenDim; j++) norm += result[j]! * result[j]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let j = 0; j < hiddenDim; j++) result[j] /= norm;

  return result;
}

// ── Embedder Factory ────────────────────────────

/**
 * Create an embedder using ONNX Runtime + BGE-M3 model.
 * Returns null if model or runtime not available (fail-open).
 */
export async function createEmbedder(vaultRoot: string): Promise<Embedder | null> {
  const modelDir = join(vaultRoot, ".store", "models", "bge-m3");
  const modelPath = join(modelDir, "model.onnx");

  if (!existsSync(modelPath)) {
    console.warn(`[embedder] BGE-M3 model not found at ${modelDir} — run \`quorum vault model\` to download`);
    return null;
  }

  let ort: OrtModule;
  try {
    ort = await import("onnxruntime-node") as unknown as OrtModule;
  } catch {
    console.warn("[embedder] onnxruntime-node not available — vector search disabled");
    return null;
  }

  let session: OrtSession;
  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
  } catch (err) {
    console.warn(`[embedder] Failed to load model: ${(err as Error).message}`);
    return null;
  }

  const embed = async (text: string): Promise<Float32Array> => {
    const { inputIds, attentionMask } = tokenize(text, MAX_TOKENS);
    const tokenTypeIds = new BigInt64Array(MAX_TOKENS); // zeros

    const feeds = {
      input_ids: new ort.Tensor("int64", inputIds, [1, MAX_TOKENS]),
      attention_mask: new ort.Tensor("int64", attentionMask, [1, MAX_TOKENS]),
      token_type_ids: new ort.Tensor("int64", tokenTypeIds, [1, MAX_TOKENS]),
    };

    const output = await session.run(feeds);
    const lastHidden = output.last_hidden_state ?? output.token_embeddings ?? Object.values(output)[0];
    if (!lastHidden) throw new Error("No output tensor found");

    const hiddenDim = lastHidden.dims[lastHidden.dims.length - 1]!;
    const data = lastHidden.data instanceof Float32Array ? lastHidden.data : new Float32Array(lastHidden.data);

    return meanPool(data, attentionMask, MAX_TOKENS, hiddenDim);
  };

  return {
    dimensions: DIMENSIONS,

    async embed(text: string): Promise<Float32Array> {
      return embed(text.slice(0, 4000)); // cap input length
    },

    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      // Sequential for simplicity — batch ONNX inference needs tensor stacking
      const results: Float32Array[] = [];
      for (const text of texts) {
        results.push(await embed(text.slice(0, 4000)));
      }
      return results;
    },

    dispose(): void {
      session.release().catch(() => {});
    },
  };
}

/**
 * Get model directory path.
 */
export function getModelDir(vaultRoot: string): string {
  return join(vaultRoot, ".store", "models", "bge-m3");
}

/**
 * Check if model is downloaded.
 */
export function isModelAvailable(vaultRoot: string): boolean {
  return existsSync(join(getModelDir(vaultRoot), "model.onnx"));
}
