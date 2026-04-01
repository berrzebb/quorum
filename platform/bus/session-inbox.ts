/**
 * Session Inbox — async cross-session message queue.
 *
 * Messages are queued and drained at receiver's idle/turn boundary.
 * Never synchronous RPC — sender doesn't wait for receiver response.
 *
 * @module bus/session-inbox
 * @since RAI-9
 */

// ── Types ────────────────────────────────────

export interface InboxMessage {
  messageId: string;
  from: string;
  to: string;
  body: string;
  queuedAt: number;
  deliveredAt?: number;
}

export interface InboxConfig {
  /** Max messages per recipient before oldest are dropped. Default: 50. */
  maxPerRecipient: number;
  /** Max age before message expires (ms). Default: 1 hour. */
  maxAgeMs: number;
}

// ── Default Config ───────────────────────────

export function defaultInboxConfig(): InboxConfig {
  return { maxPerRecipient: 50, maxAgeMs: 60 * 60 * 1000 };
}

// ── Inbox ────────────────────────────────────

export class SessionInbox {
  private queues = new Map<string, InboxMessage[]>();

  constructor(private readonly config: InboxConfig = defaultInboxConfig()) {}

  /** Queue a message for a recipient. */
  send(msg: Omit<InboxMessage, "messageId" | "queuedAt">): InboxMessage {
    const full: InboxMessage = {
      ...msg,
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: Date.now(),
    };

    const queue = this.queues.get(msg.to) ?? [];
    queue.push(full);

    // Enforce bounds
    while (queue.length > this.config.maxPerRecipient) queue.shift();

    this.queues.set(msg.to, queue);
    return full;
  }

  /** Drain all pending messages for a recipient. Marks as delivered. */
  drain(recipient: string, now?: number): InboxMessage[] {
    const queue = this.queues.get(recipient);
    if (!queue || queue.length === 0) return [];

    const currentTime = now ?? Date.now();
    const valid = queue.filter(m => currentTime - m.queuedAt < this.config.maxAgeMs);

    for (const m of valid) m.deliveredAt = currentTime;
    this.queues.delete(recipient);

    return valid;
  }

  /** Peek at pending message count without draining. */
  pendingCount(recipient: string): number {
    return this.queues.get(recipient)?.length ?? 0;
  }

  /** Clear all queues. */
  clear(): void {
    this.queues.clear();
  }
}
