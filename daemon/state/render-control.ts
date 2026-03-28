/**
 * Render-control utilities — debounce + timer registry.
 *
 * Reduces flicker by coalescing rapid state updates into single renders,
 * and prevents timer overlap by tracking active intervals.
 */

// ── Render Debounce ──────────────────────────

/**
 * Debounce utility for render updates.
 */
export function createRenderDebounce(delayMs: number = 100): {
  schedule: (fn: () => void) => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn: () => void) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn(); }, delayMs);
    },
    cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}

// ── Timer Registry ───────────────────────────

/**
 * Timer registry — tracks active timers to prevent overlap.
 */
export class TimerRegistry {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  register(id: string, fn: () => void, intervalMs: number): void {
    this.unregister(id);
    this.timers.set(id, setInterval(fn, intervalMs));
  }

  unregister(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  unregisterAll(): void {
    for (const [id] of this.timers) this.unregister(id);
  }

  activeCount(): number {
    return this.timers.size;
  }

  has(id: string): boolean {
    return this.timers.has(id);
  }
}
