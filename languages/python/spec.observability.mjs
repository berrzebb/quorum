export default [
  { re: /except\s*:/m, label: "bare-except", severity: "high", msg: "Bare except: catches SystemExit, KeyboardInterrupt — be specific" },
  { re: /except\s+\w+.*:\s*\n\s*pass/m, label: "except-pass", severity: "high", msg: "except: pass — error silently swallowed" },
  { re: /print\s*\(/m, label: "print-debug", severity: "low", msg: "print() in source — use logging module" },
  { re: /except\s+.*:\s*\n\s*print\(/m, label: "print-error-only", severity: "medium", msg: "except: print() — no structured error reporting" },
  { re: /sys\.exit\s*\(\s*[^0)]/m, label: "hard-exit", severity: "medium", msg: "sys.exit() with error code — may skip cleanup" },
  { re: /raise\s+Exception\s*\(\s*\)/m, label: "empty-exception", severity: "medium", msg: "raise Exception() with no message" },
];
