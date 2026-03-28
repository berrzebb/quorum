/**
 * TypeScript / JavaScript — core language spec.
 *
 * Fragment files (all optional):
 *   spec.symbols.mjs, spec.imports.mjs, spec.doc.mjs,
 *   spec.perf.mjs, spec.compat.mjs, spec.a11y.mjs, spec.observability.mjs
 */
export default {
  id: "typescript",
  name: "TypeScript / JavaScript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"],
  endBlock: "brace",
  commentPrefixes: ["//", "/*", "*"],
  jsxExtensions: [".tsx", ".jsx"],
  i18nHardcodedRe: />\s*[A-Z가-힣][A-Za-z가-힣\s]{2,30}\s*</m,
  verify: {
    CQ:   { cmd: "npx eslint", detect: ["package.json"] },
    T:    { cmd: "npx tsc --noEmit", detect: ["tsconfig.json"] },
    TEST: { cmd: "npm test", detect: ["package.json"] },
    DEP:  { cmd: "npm audit --audit-level=high", detect: ["package-lock.json"] },
  },
};
