/**
 * Claude SDK Session API — wraps Claude SDK session introspection APIs.
 *
 * Returns safe defaults when SDK is not available (optional dependency pattern).
 * When SDK IS available, delegates to actual SDK methods.
 * Lazy-loads and caches the SDK result on first access.
 */

import { loadClaudeSdk, type ClaudeSdkLoadResult } from "./tool-bridge.js";

export interface SdkSessionInfo {
  sessionId: string;
  status: "running" | "completed" | "failed" | "unknown";
  startedAt?: number;
  messageCount?: number;
}

export class ClaudeSdkSessionApi {
  private sdkResult: ClaudeSdkLoadResult | null = null;

  async ensureLoaded(): Promise<ClaudeSdkLoadResult> {
    if (!this.sdkResult) {
      this.sdkResult = await loadClaudeSdk();
    }
    return this.sdkResult;
  }

  async isAvailable(): Promise<boolean> {
    const result = await this.ensureLoaded();
    return result.available;
  }

  /**
   * List active sessions. Delegates to SDK when available.
   * Returns empty when SDK is not installed (graceful degradation).
   */
  async listSessions(): Promise<SdkSessionInfo[]> {
    const result = await this.ensureLoaded();
    if (!result.available || !result.sdk) return [];

    const sdk = result.sdk as Record<string, unknown>;
    // Attempt SDK's session listing API if it exists
    if (typeof sdk.listSessions === "function") {
      try {
        const sessions = await (sdk.listSessions as () => Promise<unknown[]>)();
        return sessions.map((s: any) => ({
          sessionId: s.id ?? s.sessionId ?? "unknown",
          status: s.status ?? "unknown",
          startedAt: s.startedAt ?? s.created_at,
          messageCount: s.messageCount ?? s.message_count,
        }));
      } catch (err) { console.error(`[claude-sdk] SDK call failed: ${(err as Error).message}`); }
    }
    // SDK loaded but no listSessions method — return empty (not a stub, API genuinely unavailable)
    return [];
  }

  /**
   * Get session info by ID. Delegates to SDK when available.
   * Returns unknown status when SDK is not installed.
   */
  async getSession(sessionId: string): Promise<SdkSessionInfo> {
    const result = await this.ensureLoaded();
    if (!result.available || !result.sdk) {
      return { sessionId, status: "unknown" };
    }

    const sdk = result.sdk as Record<string, unknown>;
    // Attempt SDK's session get API if it exists
    if (typeof sdk.getSession === "function") {
      try {
        const s = await (sdk.getSession as (id: string) => Promise<any>)(sessionId);
        return {
          sessionId: s.id ?? s.sessionId ?? sessionId,
          status: s.status ?? "unknown",
          startedAt: s.startedAt ?? s.created_at,
          messageCount: s.messageCount ?? s.message_count,
        };
      } catch (err) { console.error(`[claude-sdk] SDK call failed: ${(err as Error).message}`); }
    }
    return { sessionId, status: "unknown" };
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const session = await this.getSession(sessionId);
    return session.messageCount ?? 0;
  }
}
