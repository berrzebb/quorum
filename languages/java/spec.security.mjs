export default [
  { re: /Runtime\.getRuntime\(\)\.exec\s*\(/m, label: "runtime-exec", severity: "critical", msg: "Runtime.exec() — command injection risk" },
  { re: /ProcessBuilder/m, label: "process-builder", severity: "high", msg: "ProcessBuilder — validate all input" },
  { re: /new\s+ObjectInputStream/m, label: "deser-risk", severity: "critical", msg: "ObjectInputStream — deserialization vulnerability" },
  { re: /Statement.*execute\w*\s*\([^)]*\+/m, label: "sql-injection", severity: "critical", msg: "String concat in SQL — use PreparedStatement" },
  { re: /\.setAccessible\s*\(\s*true\s*\)/m, label: "reflection-access", severity: "high", msg: "setAccessible(true) — bypasses access control" },
  { re: /MessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"/m, label: "weak-crypto", severity: "medium", msg: "Weak hash algorithm — use SHA-256+" },
];
