export default [
  { re: /catch\s*\([^)]*\)\s*\{\s*\}/m, label: "empty-catch", severity: "high", msg: "Empty catch block — error silently swallowed" },
  { re: /catch\s*\([^)]*\)\s*\{[^}]*\/\//m, label: "comment-only-catch", severity: "medium", msg: "Catch with only comment — no error handling" },
  { re: /System\.out\.print/m, label: "sysout-debug", severity: "low", msg: "System.out in source — use SLF4J/Log4j" },
  { re: /System\.err\.print/m, label: "syserr-debug", severity: "low", msg: "System.err in source — use structured logging" },
  { re: /e\.printStackTrace\s*\(\)/m, label: "print-stacktrace", severity: "medium", msg: "printStackTrace() — use logger.error(msg, e)" },
  { re: /System\.exit\s*\(\s*[^0)]/m, label: "hard-exit", severity: "medium", msg: "System.exit() — may skip shutdown hooks" },
];
