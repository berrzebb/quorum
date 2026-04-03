import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ── Load registry ───────────────────────────────────────────

let registry, loadAll, findEndLineBrace, findEndLineIndent, findEndLineKeyword, getEndLineFinder;

before(async () => {
  const mod = await import("../platform/core/languages/registry.mjs");
  registry = mod.registry;
  loadAll = mod.loadAll;
  findEndLineBrace = mod.findEndLineBrace;
  findEndLineIndent = mod.findEndLineIndent;
  findEndLineKeyword = mod.findEndLineKeyword;
  getEndLineFinder = mod.getEndLineFinder;
  await loadAll();
});

// ── Registry loading ────────────────────────────────────────

describe("LanguageRegistry — loading", () => {
  it("loads builtin languages", () => {
    assert.ok(registry.size >= 4, `Expected >=4 languages, got ${registry.size}`);
    assert.ok(registry.ids().includes("typescript"));
    assert.ok(registry.ids().includes("python"));
    assert.ok(registry.ids().includes("go"));
    assert.ok(registry.ids().includes("rust"));
  });

});

// ── Extension mapping ───────────────────────────────────────

describe("LanguageRegistry — extension mapping", () => {
  it("maps .ts to typescript", () => {
    const spec = registry.forFile("src/index.ts");
    assert.equal(spec.id, "typescript");
  });

  it("returns null for unknown extensions", () => {
    assert.equal(registry.forFile("data.csv"), null);
    assert.equal(registry.forFile("notes.txt"), null);
  });

});

// ── Domain-specific extension lookup ────────────────────────

describe("LanguageRegistry — domain patterns", () => {
  it("extensionsForDomain('perf') includes multiple languages", () => {
    const exts = registry.extensionsForDomain("perf");
    assert.ok(exts.has(".ts"), "typescript should have perf rules");
    assert.ok(exts.has(".py"), "python should have perf rules");
    assert.ok(exts.has(".go"), "go should have perf rules");
    assert.ok(exts.has(".rs"), "rust should have perf rules");
  });

  it("extensionsForDomain('security') includes python/go/rust/java", () => {
    const exts = registry.extensionsForDomain("security");
    assert.ok(exts.has(".py"), "python should have security rules");
    assert.ok(exts.has(".go"), "go should have security rules");
    assert.ok(exts.has(".rs"), "rust should have security rules");
    assert.ok(exts.has(".java"), "java should have security rules");
  });

  it("patternsForDomain returns grouped patterns", () => {
    const groups = registry.patternsForDomain("perf");
    assert.ok(groups.length >= 4, "should have patterns from 4+ languages");
    for (const g of groups) {
      assert.ok(g.langId);
      assert.ok(g.extensions instanceof Set);
      assert.ok(Array.isArray(g.patterns));
      assert.ok(g.patterns.length > 0);
    }
  });

});

// ── Symbol patterns ─────────────────────────────────────────

describe("LanguageRegistry — symbol patterns", () => {
  it("typescript spec detects JS function", () => {
    const spec = registry.forId("typescript");
    const line = "export async function handleRequest(req, res) {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match JS function");
    assert.equal(match.type, "fn");
  });

  it("python spec detects def", () => {
    const spec = registry.forId("python");
    const line = "def process_data(items):";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Python def");
    assert.equal(match.type, "fn");
  });

  it("python spec detects class", () => {
    const spec = registry.forId("python");
    const line = "class UserService(BaseService):";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Python class");
    assert.equal(match.type, "class");
  });

  it("go spec detects func", () => {
    const spec = registry.forId("go");
    const line = "func HandleRequest(w http.ResponseWriter, r *http.Request) {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Go func");
    assert.equal(match.type, "fn");
  });

  it("go spec detects receiver method", () => {
    const spec = registry.forId("go");
    const line = "func (s *Server) Start(addr string) error {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Go method");
    assert.equal(match.type, "method");
  });

  it("go spec detects struct", () => {
    const spec = registry.forId("go");
    const line = "type Config struct {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Go struct");
    assert.equal(match.type, "struct");
  });

  it("rust spec detects fn", () => {
    const spec = registry.forId("rust");
    const line = "pub async fn handle_connection(stream: TcpStream) -> Result<()> {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Rust fn");
    assert.equal(match.type, "fn");
  });

  it("rust spec detects struct", () => {
    const spec = registry.forId("rust");
    const line = "pub struct AppState {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Rust struct");
    assert.equal(match.type, "struct");
  });

  it("java spec detects class", () => {
    const spec = registry.forId("java");
    const line = "public abstract class AbstractService {";
    const match = spec.symbols.find(s => s.re.test(line));
    assert.ok(match, "should match Java class");
    assert.equal(match.type, "class");
  });
});

// ── Import patterns ─────────────────────────────────────────

describe("LanguageRegistry — import patterns", () => {
  it("typescript matches ES import", () => {
    const spec = registry.forId("typescript");
    const line = 'import { Router } from "express"';
    const match = spec.imports.patterns.find(re => re.test(line));
    assert.ok(match, "should match ES import");
  });

  it("python matches from-import", () => {
    const spec = registry.forId("python");
    const line = "from fastapi import FastAPI";
    const match = spec.imports.patterns.find(re => re.test(line));
    assert.ok(match, "should match Python from-import");
  });

  it("go matches import string", () => {
    const spec = registry.forId("go");
    const line = '  "net/http"';
    const match = spec.imports.patterns.find(re => re.test(line));
    assert.ok(match, "should match Go import");
  });

  it("rust matches use statement", () => {
    const spec = registry.forId("rust");
    const line = "use std::collections::HashMap;";
    const match = spec.imports.patterns.find(re => re.test(line));
    assert.ok(match, "should match Rust use");
  });
});

// ── findEndLine strategies ──────────────────────────────────

describe("findEndLine strategies", () => {
  it("brace: finds matching brace", () => {
    const lines = [
      "function foo() {",
      "  if (true) {",
      "    return 1;",
      "  }",
      "}",
      "next line",
    ];
    assert.equal(findEndLineBrace(lines, 0), 5);
  });

  it("indent: finds end of indented block", () => {
    const lines = [
      "def foo():",
      "    x = 1",
      "    y = 2",
      "    return x + y",
      "",
      "def bar():",
    ];
    assert.equal(findEndLineIndent(lines, 0), 5); // line 5 = "def bar():" at same indent
  });

  it("indent: handles EOF", () => {
    const lines = [
      "def foo():",
      "    x = 1",
      "    return x",
    ];
    assert.equal(findEndLineIndent(lines, 0), 3); // EOF
  });

  it("end-keyword: finds matching end", () => {
    const lines = [
      "def foo",
      "  if true",
      "    bar()",
      "  end",
      "end",
      "next",
    ];
    assert.equal(findEndLineKeyword(lines, 0), 5);
  });

  it("getEndLineFinder resolves from spec", () => {
    const braceSpec = { endBlock: "brace" };
    const indentSpec = { endBlock: "indent" };
    assert.equal(getEndLineFinder(braceSpec), findEndLineBrace);
    assert.equal(getEndLineFinder(indentSpec), findEndLineIndent);
  });
});

// ── Quality patterns smoke test ─────────────────────────────

describe("Quality patterns — smoke", () => {
  it("python perf: detects while True", () => {
    const spec = registry.forId("python");
    const rules = spec.qualityRules.perf;
    const line = "while True:";
    const match = rules.find(r => r.re.test(line));
    assert.ok(match, "should detect while True");
    assert.equal(match.label, "busy-loop");
  });

  it("python security: detects eval", () => {
    const spec = registry.forId("python");
    const rules = spec.qualityRules.security;
    const line = "result = eval(user_input)";
    const match = rules.find(r => r.re.test(line));
    assert.ok(match, "should detect eval");
    assert.equal(match.label, "eval-usage");
  });

  it("go security: detects sql injection", () => {
    const spec = registry.forId("go");
    const rules = spec.qualityRules.security;
    const line = 'query := fmt.Sprintf("SELECT * FROM users WHERE id = %s", sql)';
    const match = rules.find(r => r.re.test(line));
    assert.ok(match);
  });

  it("rust observability: detects unwrap", () => {
    const spec = registry.forId("rust");
    const rules = spec.qualityRules.observability;
    const line = "let value = result.unwrap();";
    const match = rules.find(r => r.re.test(line));
    assert.ok(match, "should detect unwrap");
    assert.equal(match.label, "unwrap-usage");
  });

  it("java security: detects ObjectInputStream", () => {
    const spec = registry.forId("java");
    const rules = spec.qualityRules.security;
    const line = "ObjectInputStream ois = new ObjectInputStream(input);";
    const match = rules.find(r => r.re.test(line));
    assert.ok(match, "should detect ObjectInputStream deserialization");
  });
});
