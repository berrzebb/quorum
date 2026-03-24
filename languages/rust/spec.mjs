/**
 * Rust language spec — core metadata.
 *
 * Covers: .rs
 * Fragments: spec.symbols, spec.imports, spec.doc, spec.perf, spec.security, spec.observability, spec.compat
 */

/** @type {import('../registry.mjs').LanguageSpec} */
export default {
  id: "rust",
  name: "Rust",
  extensions: [".rs"],
  endBlock: "brace",
  commentPrefixes: ["//", "///", "/*"],
};
