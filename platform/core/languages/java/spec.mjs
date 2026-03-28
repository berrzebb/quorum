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
  verify: {
    CQ:   { cmd: "mvn checkstyle:check", detect: ["pom.xml"] },
    T:    { cmd: "mvn compile -q", detect: ["pom.xml"] },
    TEST: { cmd: "mvn test -q", detect: ["pom.xml"] },
    DEP:  { cmd: "mvn dependency-check:check", detect: ["pom.xml"] },
  },
};
