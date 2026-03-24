# Concurrency Verifier — Domain Knowledge

**Primary tool**: `dependency_graph`

## Focus Areas
1. **Race conditions** — shared state without synchronization
2. **Deadlock potential** — circular lock dependencies
3. **Async coordination** — Promise.all error handling, cancellation
4. **TOCTOU patterns** — check-then-act without atomicity
5. **Worker communication** — message passing correctness, shared memory

## Checklist
- [ ] CONC-1: Shared mutable state protected by locks or atomics
- [ ] CONC-2: Promise.all has proper error handling (no silent swallowing)
- [ ] CONC-3: No TOCTOU patterns (file existence → use, lock check → acquire)
- [ ] CONC-4: Lock acquisition order consistent (no circular waits)
- [ ] CONC-5: Cancellation tokens propagated through async chains
- [ ] CONC-6: Worker/thread cleanup on error paths

## Rejection Codes
- **race-condition**: Shared state accessed without synchronization
- **deadlock-risk**: Circular dependency in lock acquisition
