# quorum

Cross-model audit gate with structural enforcement.

## Commands

```bash
npm run build    # tsc compile
npm test         # node tests/run-suite.mjs all
npm run dev      # tsx daemon/index.ts
# Individual: node --test tests/{name}.test.mjs
```

## Rules

- Fail-open: all hooks pass through on error, no system lockout
- Orchestrator never implements — always delegate to worker agents
- Design before WB — Blueprint naming conventions are binding law
- Fragment-only: spec.mjs = metadata, domain data in spec.{domain}.mjs fragments only
- `// scan-ignore` suppresses runPatternScan findings on that line
- SQLite (EventStore) = single source of truth — no verdict/state files
- Deny rules bypass-immune (NFR-18) — no permission mode overrides deny
