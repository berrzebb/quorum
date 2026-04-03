/**
 * Backpressure Queue — bounded async queue with blocking enqueue and serial drain.
 *
 * - enqueue() blocks (returns pending Promise) when queue is full
 * - drain() processes items serially (1 in-flight at a time)
 * - Handler failure → item re-queued at front for retry
 *
 * @module core/backpressure-queue
 */

// ── Types ───────────────────────────────────────────

/** Handler function for processing items. */
export type DrainHandler<T> = (items: T[]) => Promise<void>;

// ── Queue ───────────────────────────────────────────

/**
 * Bounded async queue with backpressure.
 *
 * When the queue is full, enqueue() returns a Promise that resolves
 * only when space becomes available (blocking, not dropping).
 */
export class BackpressureQueue<T> {
  private queue: T[] = [];
  private waiters: Array<{ resolve: () => void; item: T }> = [];
  private draining = false;
  private handler: DrainHandler<T> | null = null;
  private disposed = false;

  constructor(private readonly maxQueueSize: number = 100, private readonly batchSize: number = 1) {
    if (maxQueueSize < 1) throw new RangeError("maxQueueSize must be >= 1");
    if (batchSize < 1) throw new RangeError("batchSize must be >= 1");
  }

  /**
   * Add an item to the queue.
   *
   * If the queue is full, the returned Promise will not resolve until
   * space becomes available (via drain processing).
   */
  async enqueue(item: T): Promise<void> {
    if (this.disposed) throw new Error("Queue is disposed");

    if (this.queue.length < this.maxQueueSize) {
      this.queue.push(item);
      this.tryDrain();
      return;
    }

    // Queue is full — block until space available
    return new Promise<void>(resolve => {
      this.waiters.push({ resolve, item });
    });
  }

  /**
   * Set the drain handler and start processing.
   * Items are processed serially in batches.
   */
  drain(handler: DrainHandler<T>): void {
    this.handler = handler;
    this.tryDrain();
  }

  /** Current queue size. */
  size(): number {
    return this.queue.length;
  }

  /** Whether the queue is at capacity. */
  isFull(): boolean {
    return this.queue.length >= this.maxQueueSize;
  }

  /**
   * Flush the queue — process all remaining items.
   * Returns when the queue is empty.
   */
  async flush(): Promise<void> {
    while (this.queue.length > 0 || this.draining) {
      await new Promise<void>(resolve => setTimeout(resolve, 1));
    }
  }

  /** Dispose the queue. No more items can be enqueued. */
  dispose(): void {
    this.disposed = true;
    // Resolve any blocked waiters
    for (const w of this.waiters) {
      w.resolve();
    }
    this.waiters = [];
  }

  // ── Internal ────────────────────────────────────

  private tryDrain(): void {
    if (this.draining || !this.handler || this.queue.length === 0) return;
    this.draining = true;
    this.drainLoop();
  }

  private async drainLoop(): Promise<void> {
    while (this.queue.length > 0 && this.handler) {
      // Take a batch
      const batch = this.queue.splice(0, this.batchSize);

      try {
        await this.handler(batch);
      } catch {
        // Handler failed — re-queue at front
        this.queue.unshift(...batch);
        // Break to avoid infinite retry loop. Will resume on next enqueue.
        break;
      }

      // Admit waiters if space available
      this.admitWaiters();
    }

    this.draining = false;
  }

  private admitWaiters(): void {
    while (this.waiters.length > 0 && this.queue.length < this.maxQueueSize) {
      const waiter = this.waiters.shift()!;
      this.queue.push(waiter.item);
      waiter.resolve();
    }
  }
}
