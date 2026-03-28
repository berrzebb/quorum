/**
 * Claude SDK Session API — wraps Claude SDK session introspection APIs.
 *
 * Returns safe defaults when SDK is not available (optional dependency pattern).
 * Lazy-loads and caches the SDK result on first access.
 *
 * @module providers/claude-sdk/session-api
 */

import { loadClaudeSdk, type ClaudeSdkLoadResult } from "./tool-bridge.js";

/**
 * Minimal session info from Claude SDK.
 */
export interface SdkSessionInfo {
  sessionId: string;
  status: "running" | "completed" | "failed" | "unknown";
  startedAt?: number;
  messageCount?: number;
}

/**
 * Wraps Claude SDK session introspection APIs.
 * Returns safe defaults when SDK is not available.
 */
export class ClaudeSdkSessionApi {
  private sdkResult: ClaudeSdkLoadResult | null = null;

  /**
   * Ensure SDK is loaded (lazy, cached).
   */
  async ensureLoaded(): Promise<ClaudeSdkLoadResult> {
    if (!this.sdkResult) {
      this.sdkResult = await loadClaudeSdk();
    }
    return this.sdkResult;
  }

  /**
   * Check if SDK is available.
   */
  async isAvailable(): Promise<boolean> {
    const result = await this.ensureLoaded();
    return result.available;
  }

  /**
   * List active sessions (stub — returns empty when SDK not available).
   */
  async listSessions(): Promise<SdkSessionInfo[]> {
    const result = await this.ensureLoaded();
    if (!result.available) return [];

    // When SDK is available, this would call sdk.listSessions()
    // For now, return empty — actual implementation comes when SDK is integrated
    return [];
  }

  /**
   * Get session info by ID (stub — returns unknown status when SDK not available).
   */
  async getSession(sessionId: string): Promise<SdkSessionInfo> {
    const result = await this.ensureLoaded();
    if (!result.available) {
      return { sessionId, status: "unknown" };
    }

    // When SDK is available, this would call sdk.getSession(sessionId)
    return { sessionId, status: "unknown" };
  }

  /**
   * Get message count for a session.
   */
  async getMessageCount(sessionId: string): Promise<number> {
    const session = await this.getSession(sessionId);
    return session.messageCount ?? 0;
  }
}
