export default [
  { re: /if\s+err\s*!=\s*nil\s*\{\s*\}/m, label: "empty-err-check", severity: "high", msg: "Empty error check — error silently discarded" },
  { re: /if\s+err\s*!=\s*nil\s*\{[^}]*return\s+nil\s*\}/m, label: "nil-on-error", severity: "medium", msg: "Returning nil on error — consider wrapping or propagating" },
  { re: /fmt\.Print(?:ln|f)?\s*\(/m, label: "fmt-print", severity: "low", msg: "fmt.Print in source — use structured logger" },
  { re: /log\.Fatal\s*\(/m, label: "log-fatal", severity: "medium", msg: "log.Fatal calls os.Exit(1) — may skip defers" },
  { re: /panic\s*\(/m, label: "panic-usage", severity: "medium", msg: "panic() — use error return in library code" },
];
