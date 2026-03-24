/** Compatibility check patterns for TypeScript / JavaScript. */
export default [
  { re: /@deprecated/m, label: "deprecated-usage", severity: "medium", msg: "Contains @deprecated annotation" },
  { re: /\/\*\*[\s\S]*?@breaking[\s\S]*?\*\//m, label: "breaking-change", severity: "high", msg: "Marked as @breaking change" },
  { re: /(?:module\.exports|exports\.)\s*=\s*/m, label: "cjs-export", severity: "low", msg: "CommonJS export in ESM project" },
  { re: /require\s*\(\s*["'][^"']+["']\s*\)/m, label: "cjs-require", severity: "low", msg: "CommonJS require() in ESM project" },
  { re: /\/\/\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
];
