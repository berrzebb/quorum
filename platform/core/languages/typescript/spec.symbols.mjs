/** Symbol extraction patterns for TypeScript / JavaScript. */
export default [
  { type: "fn",     re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "fn",     re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/m },
  { type: "fn",     re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?function/m },
  { type: "method", re: /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/m },
  { type: "class",  re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
  { type: "iface",  re: /^(?:export\s+)?interface\s+(\w+)/m },
  { type: "type",   re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/m },
  { type: "enum",   re: /^(?:export\s+)?enum\s+(\w+)/m },
  { type: "import", re: /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/m },
];
