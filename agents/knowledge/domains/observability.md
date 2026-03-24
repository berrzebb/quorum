# Observability Inspector — Domain Knowledge

**Primary tool**: `observability_check`

## Focus Areas
1. **Logging coverage** — error paths logged with context
2. **Structured logs** — consistent format, searchable fields
3. **Error context** — stack traces, request IDs, user context
4. **Metric instrumentation** — latency, throughput, error rates
5. **Trace propagation** — correlation IDs across service boundaries

## Checklist
- [ ] OBS-1: Error handlers include structured logging
- [ ] OBS-2: Log entries include correlation/request ID
- [ ] OBS-3: New endpoints have latency metrics
- [ ] OBS-4: Trace context propagated in async operations
- [ ] OBS-5: Alert-worthy conditions have explicit log levels

## Rejection Codes
- **observability-gap**: Missing logging, metrics, or tracing for critical path
