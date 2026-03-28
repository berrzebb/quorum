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
  verify: {
    CQ:   { cmd: "golangci-lint run", detect: ["go.mod"] },
    T:    { cmd: "go vet ./...", detect: ["go.mod"] },
    TEST: { cmd: "go test ./...", detect: ["go.mod"] },
    DEP:  { cmd: "govulncheck ./...", detect: ["go.sum"] },
  },
};
