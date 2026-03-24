export default [
  { type: "fn",     re: /^func\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "method", re: /^func\s+\([^)]+\)\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "struct", re: /^type\s+(\w+)\s+struct\b/m },
  { type: "iface",  re: /^type\s+(\w+)\s+interface\b/m },
  { type: "type",   re: /^type\s+(\w+)\s+/m },
  { type: "import", re: /^\s+"([^"]+)"/m },
];
