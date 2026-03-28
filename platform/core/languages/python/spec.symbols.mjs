export default [
  { type: "fn",     re: /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "method", re: /^\s+(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "class",  re: /^class\s+(\w+)(?:\s*\([^)]*\))?:/m },
  { type: "import", re: /^from\s+(\S+)\s+import\s+(.+)/m },
  { type: "import", re: /^import\s+(\S+)/m },
];
