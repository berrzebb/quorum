# providers/

This directory has been removed as part of the platform consolidation (PLT track).

All provider source code now lives in `platform/providers/`.

Key modules:
- `platform/providers/provider.ts` -- QuorumProvider + Auditor interfaces
- `platform/providers/consensus.ts` -- DeliberativeConsensus
- `platform/providers/trigger.ts` -- 13-factor conditional trigger
- `platform/providers/auditors/` -- Provider-specific auditor implementations
- `platform/providers/evaluators/` -- Runtime evaluation adapters
