/**
 * Track progress queries.
 */

import type { EventStore } from "../../../platform/bus/store.js";

// ── Types ────────────────────────────────────

export interface TrackInfo {
  trackId: string;
  total: number;
  completed: number;
  pending: number;
  blocked: number;
  lastUpdate: number;
}

// ── Query ────────────────────────────────────

/**
 * Track progress from track.progress events.
 */
export function queryTrackProgress(store: EventStore): TrackInfo[] {
  try {
    const trackEvents = store.query({
      eventType: "track.progress",
      limit: 100,
    });

    // Latest per track
    const trackMap = new Map<string, TrackInfo>();
    for (const evt of trackEvents) {
      const p = evt.payload;
      const trackId = (p.trackId ?? evt.trackId ?? "unknown") as string;
      trackMap.set(trackId, {
        trackId,
        total: (p.total ?? 0) as number,
        completed: (p.completed ?? 0) as number,
        pending: (p.pending ?? 0) as number,
        blocked: (p.blocked ?? 0) as number,
        lastUpdate: evt.timestamp,
      });
    }

    return [...trackMap.values()].sort((a, b) => b.lastUpdate - a.lastUpdate);
  } catch (err) {
    console.warn(`[tracks] queryTrackProgress failed: ${(err as Error).message}`);
    return [];
  }
}
