export default [
  { re: /exec\.Command\s*\(/m, label: "command-exec", severity: "high", msg: "exec.Command — validate input, avoid shell injection" },
  { re: /fmt\.Sprintf\s*\([^)]*%s[\s\S]{0,60}sql/im, label: "sql-injection", severity: "critical", msg: "String formatting in SQL — use parameterized queries" },
  { re: /http\.ListenAndServe\(\s*"/m, label: "plain-http", severity: "medium", msg: "Plain HTTP — consider TLS" },
  { re: /os\.Setenv\s*\(.*(?:KEY|SECRET|TOKEN|PASS)/im, label: "env-secret", severity: "high", msg: "Setting secret in environment variable programmatically" },
  { re: /unsafe\.Pointer/m, label: "unsafe-pointer", severity: "high", msg: "unsafe.Pointer — audit memory safety" },
  { re: /crypto\/md5|crypto\/sha1/m, label: "weak-crypto", severity: "medium", msg: "Weak hash algorithm — use sha256+" },
];
