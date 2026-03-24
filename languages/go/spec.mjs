/**
 * Go language spec — core metadata.
 *
 * Covers: .go
 * Fragments: spec.symbols, spec.imports, spec.doc, spec.perf, spec.security, spec.observability, spec.compat
 */

/** @type {import('../registry.mjs').LanguageSpec} */
export default {
  id: "go",
  name: "Go",
  extensions: [".go"],
  endBlock: "brace",
  commentPrefixes: ["//", "/*"],
};
