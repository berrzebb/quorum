export default [
  { re: /unsafe\s*\{/m, label: "unsafe-block", severity: "high", msg: "unsafe block — audit memory safety" },
  { re: /\*mut\s+/m, label: "raw-mut-pointer", severity: "high", msg: "Raw mutable pointer — memory safety risk" },
  { re: /transmute/m, label: "transmute", severity: "critical", msg: "mem::transmute — extremely unsafe, verify correctness" },
  { re: /std::process::Command/m, label: "command-exec", severity: "high", msg: "Process spawn — validate input" },
  { re: /format!\s*\([^)]*\)[\s\S]{0,30}(?:query|sql|execute)/im, label: "sql-injection", severity: "critical", msg: "String formatting near SQL — use parameterized queries" },
];
