export default [
  { type: "fn",     re: /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/m },
  { type: "method", re: /^\s+(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/m },
  { type: "struct", re: /^(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+(\w+)/m },
  { type: "enum",   re: /^(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+(\w+)/m },
  { type: "trait",  re: /^(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+(\w+)/m },
  { type: "type",   re: /^(?:pub(?:\s*\([^)]*\))?\s+)?type\s+(\w+)/m },
  { type: "import", re: /^use\s+(\S+);/m },
  { type: "iface",  re: /^impl(?:<[^>]*>)?\s+(\w+)/m },
];
