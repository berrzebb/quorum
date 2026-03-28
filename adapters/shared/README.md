# adapters/shared/ — Relocated

All shared adapter modules now live at **`platform/adapters/shared/`**.

This directory previously held facade files (re-exporting from `platform/adapters/shared/`).
Those facades have been removed since no consumers remain.

For the canonical source, see:

```
platform/adapters/shared/
  api-adapter.mjs
  audit-state.mjs
  audit-trigger.mjs
  cli-adapter.mjs
  config-resolver.mjs
  context-reinforcement.mjs
  first-run.mjs
  hook-bridge.mjs
  hook-io.mjs
  hook-loader.mjs
  hook-runner.mjs
  jsonrpc-client.mjs
  mux-adapter.mjs
  ndjson-parser.mjs
  parliament-runner.mjs
  quality-runner.mjs
  repo-resolver.mjs
  sdk-tool-bridge.mjs
  tool-names.mjs
  trigger-runner.mjs
```
