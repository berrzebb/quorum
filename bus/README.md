# bus/

This directory has been removed as part of the platform consolidation (PLT track).

All event bus source code now lives in `platform/bus/`.

Key modules:
- `platform/bus/bus.ts` -- QuorumBus (EventEmitter + SQLite/JSONL)
- `platform/bus/store.ts` -- EventStore (SQLite WAL)
- `platform/bus/events.ts` -- Event type definitions
- `platform/bus/lock.ts` -- LockService (atomic SQL lock)
- `platform/bus/parliament-gate.ts` -- Parliament enforcement gates
