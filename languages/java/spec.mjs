/**
 * Java language spec — core metadata.
 *
 * Covers: .java
 * Fragments: spec.symbols, spec.imports, spec.doc, spec.perf, spec.security, spec.observability, spec.compat
 */

/** @type {import('../registry.mjs').LanguageSpec} */
export default {
  id: "java",
  name: "Java",
  extensions: [".java"],
  endBlock: "brace",
  commentPrefixes: ["//", "/*", "*"],
};
