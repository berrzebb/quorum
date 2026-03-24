# Performance Analyst — Domain Knowledge

**Primary tool**: `perf_scan`

## Focus Areas
1. **Query efficiency** — N+1 queries, missing indexes, unbounded SELECTs
2. **Bundle size** — unnecessary dependencies, tree-shaking failures
3. **Algorithmic complexity** — O(n^2) loops, missing memoization
4. **Memory** — event listener leaks, unbounded caches
5. **Network** — waterfall API calls, missing pagination

## Checklist
- [ ] PF-1: No new N+1 query patterns
- [ ] PF-2: No unbounded data fetching
- [ ] PF-3: No O(n^2) or worse inside hot paths
- [ ] PF-4: New dependencies are necessary and tree-shakeable
- [ ] PF-5: Memoization used where appropriate
- [ ] PF-6: No synchronous blocking on main thread

## Rejection Codes
- **perf-regression**: Existing performance degraded
- **perf-gap**: Clear optimization opportunity missed
