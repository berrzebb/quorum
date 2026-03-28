/** Performance anti-patterns for TypeScript / JavaScript. */
export default [
  { re: /\.forEach\s*\([^)]*=>\s*\{[\s\S]{0,200}\.forEach/m, label: "nested-loop", severity: "high", msg: "Nested .forEach() — potential O(n²)" },
  { re: /\.filter\([^)]*\)\s*\.map\(/m, label: "chain-inefficiency", severity: "low", msg: "filter().map() — consider single reduce()" },
  { re: /readFileSync|writeFileSync|execSync/m, label: "sync-io", severity: "medium", msg: "Synchronous I/O — blocks event loop" },
  { re: /new RegExp\([^)]+\)/m, label: "dynamic-regex", severity: "low", msg: "Dynamic RegExp construction in potential hot path" },
  { re: /SELECT\s+\*\s+FROM/im, label: "select-star", severity: "medium", msg: "SELECT * — fetch only needed columns" },
  { re: /(?:import|require)\s*\(\s*["']lodash["']\s*\)/m, label: "heavy-import", severity: "medium", msg: "Full lodash import — use lodash/specific" },
  { re: /JSON\.parse\(.*readFileSync/m, label: "sync-json", severity: "medium", msg: "Sync file read + JSON.parse — consider async" },
  { re: /\.findAll\s*\(\s*\)/m, label: "unbounded-query", severity: "high", msg: "Unbounded findAll() — add limit/pagination" },
  { re: /while\s*\(\s*true\s*\)/m, label: "busy-loop", severity: "high", msg: "while(true) — potential busy loop" }, // scan-ignore
];
