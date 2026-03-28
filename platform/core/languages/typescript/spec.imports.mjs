/** Import / dependency parsing for TypeScript / JavaScript. */
export default {
  patterns: [
    /^import\s+(?:type\s+)?(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+["']([^"']+)["']/,
    /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/,
    /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/,
    /import\s*\(\s*["']([^"']+)["']\s*\)/,
  ],
  resolve: "extension-probe",
  packageIndicator: /^[^.]/,
};
