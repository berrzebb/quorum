export default [
  { type: "class",  re: /^(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/m },
  { type: "iface",  re: /^(?:public\s+)?interface\s+(\w+)/m },
  { type: "enum",   re: /^(?:public\s+)?enum\s+(\w+)/m },
  { type: "fn",     re: /^(?:\s*)(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "method", re: /^\s+(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "import", re: /^import\s+(?:static\s+)?([^;]+);/m },
];
