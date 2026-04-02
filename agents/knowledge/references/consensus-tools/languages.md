# Language Registry Reference

The language registry (`languages/registry.mjs`) provides language-aware analysis for all domain scan tools. Read this when you need to understand what patterns a tool checks or when adding a new language.

## Architecture

```
languages/
├── registry.mjs              ← Auto-discover + fragment merge engine
├── typescript/
│   ├── spec.mjs              ← Core metadata only (id, name, extensions)
│   ├── spec.symbols.mjs      ← Symbol detection regexes → spec.symbols
│   ├── spec.imports.mjs      ← Import/export parsing → spec.imports
│   ├── spec.perf.mjs         ← Performance anti-patterns → spec.qualityRules.perf
│   ├── spec.a11y.mjs         ← Accessibility rules → spec.qualityRules.a11y
│   ├── spec.compat.mjs       ← API compat rules → spec.qualityRules.compat
│   ├── spec.observability.mjs ← Logging/metrics rules → spec.qualityRules.observability
│   └── spec.doc.mjs          ← Doc comment patterns → spec.docPatterns
├── go/                        ← Same fragment structure (security instead of a11y)
├── python/
├── rust/
└── java/
```

## Fragment → Tool Mapping

Each fragment powers specific analysis tools:

| Fragment | Target Field | Used By Tools |
|----------|-------------|--------------|
| `spec.symbols.mjs` | `spec.symbols` | `code_map` — symbol detection (functions, classes, types) |
| `spec.imports.mjs` | `spec.imports` | `dependency_graph` — import/export parsing |
| `spec.perf.mjs` | `spec.qualityRules.perf` | `perf_scan` — performance anti-patterns |
| `spec.a11y.mjs` | `spec.qualityRules.a11y` | `a11y_scan` — accessibility issues |
| `spec.compat.mjs` | `spec.qualityRules.compat` | `compat_check` — API compatibility |
| `spec.security.mjs` | `spec.qualityRules.security` | `audit_scan` — security patterns |
| `spec.observability.mjs` | `spec.qualityRules.observability` | `observability_check` — logging/metrics |
| `spec.doc.mjs` | `spec.docPatterns` | `doc_coverage` — documentation completeness |

## Core Fields (spec.mjs)

`spec.mjs` is **metadata only**. The registry enforces `CORE_FIELDS` whitelist:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Language identifier (e.g., `"typescript"`) |
| `name` | string | Display name (e.g., `"TypeScript / JavaScript"`) |
| `extensions` | string[] | File extensions (e.g., `[".ts", ".tsx", ".js"]`) |
| `endBlock` | string | Block end strategy: `"brace"` / `"indent"` / `"end-keyword"` |
| `commentPrefixes` | string[] | Comment markers for filtering |
| `jsxExtensions` | string[] | JSX-capable extensions (a11y_scan uses this) |
| `i18nHardcodedRe` | RegExp | Hardcoded string detection pattern (`i18n_validate` uses this) |

Non-core fields in `spec.mjs` are **stripped with a warning**. All domain data MUST be in fragments.

## Language Coverage Matrix

| Language | extensions | perf | security | a11y | compat | observability | doc |
|----------|-----------|:----:|:--------:|:----:|:------:|:------------:|:---:|
| **TypeScript** | .ts .tsx .js .jsx .mjs .mts | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| **Go** | .go | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Python** | .py .pyi | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Rust** | .rs | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Java** | .java | ✓ | ✓ | — | ✓ | ✓ | ✓ |

## Pattern Format

Each quality rule in a fragment is an object:

```javascript
{
  re: /pattern/flags,         // Regex to match
  label: "pattern-name",      // Unique identifier
  severity: "high|medium|low",
  msg: "Human-readable explanation"
}
```

Example from TypeScript `spec.perf.mjs`:
```javascript
{ re: /\.forEach\s*\([^)]*=>\s*\{[\s\S]{0,200}\.forEach/m,
  label: "nested-loop", severity: "high",
  msg: "Nested .forEach() — potential O(n²)" }
```

## Hybrid Scanning

`perf_scan` uses hybrid scanning: regex first pass (speed) → AST second pass (precision, TypeScript only). The `astRefine` callback in `runPatternScan` enables this.

Other domain scans currently use regex-only scanning. AST refinement may be extended to more tools.

## Adding a New Language

1. Create `languages/{lang}/spec.mjs` with core metadata
2. Add domain fragments: `spec.symbols.mjs`, `spec.imports.mjs`, etc.
3. No code changes needed — the registry auto-discovers at import time
4. Run tests: `node --test tests/language-registry.test.mjs`

## `scan-ignore` Pragma

Add `// scan-ignore` to any source line to suppress `runPatternScan` findings on that line. Used for self-referential pattern definitions (e.g., perf_scan's own regex patterns).
