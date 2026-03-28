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
  verify: {
    CQ:   { cmd: "cargo clippy -- -D warnings", detect: ["Cargo.toml"] },
    T:    { cmd: "cargo check", detect: ["Cargo.toml"] },
    TEST: { cmd: "cargo test", detect: ["Cargo.toml"] },
    DEP:  { cmd: "cargo audit", detect: ["Cargo.lock"] },
  },
};
