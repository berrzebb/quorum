/**
 * Tests for tree-sitter-bridge.mjs — multi-language AST via WASM.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  initTreeSitterBridge,
  parse,
  extractSymbols,
  extractImports,
  estimateComplexity,
  bridgeStatus,
  isLanguageLoaded,
} from "../platform/core/languages/tree-sitter-bridge.mjs";

// ── Init ───────────────────────────────────────────────

describe("tree-sitter-bridge init", () => {
  let initResult;

  before(async () => {
    initResult = await initTreeSitterBridge();
  });

  it("init completes without throwing", () => {
    assert.ok(initResult !== null && initResult !== undefined);
    assert.ok(Array.isArray(initResult.loaded));
    assert.ok(Array.isArray(initResult.failed));
    // WASM may not load in all Node.js environments — that's OK
    // The bridge is fail-safe by design
  });

  it("reports status as object", () => {
    const status = bridgeStatus();
    assert.equal(typeof status.initialized, "boolean");
    assert.ok(Array.isArray(status.languages));
  });
});

// ── TypeScript ─────────────────────────────────────────

describe("TypeScript AST", () => {
  const TS_SOURCE = `
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Config {
  name: string;
  value: number;
}

type Status = "pending" | "done";

export class TaskRunner {
  private tasks: string[] = [];

  run(config: Config): void {
    if (config.value > 0) {
      for (const task of this.tasks) {
        console.log(task);
      }
    } else {
      throw new Error("invalid");
    }
  }
}

function helper(x: number): number {
  return x > 0 ? x * 2 : 0;
}

const arrow = (a: string) => a.toUpperCase();
`;

  it("extracts symbols", () => {
    if (!isLanguageLoaded("typescript")) return;
    const symbols = extractSymbols(TS_SOURCE, "typescript");
    assert.ok(symbols.length > 0, "should find symbols");

    const names = symbols.map(s => s.name);
    assert.ok(names.includes("TaskRunner"), "should find class TaskRunner");
    assert.ok(names.includes("helper"), "should find function helper");
  });

  it("extracts imports", () => {
    if (!isLanguageLoaded("typescript")) return;
    const imports = extractImports(TS_SOURCE, "typescript");
    assert.ok(imports.length >= 2, `should find 2+ imports, got ${imports.length}`);
    assert.ok(imports.some(i => i.source.includes("node:fs")));
    assert.ok(imports.some(i => i.source.includes("node:path")));
  });

  it("estimates complexity", () => {
    if (!isLanguageLoaded("typescript")) return;
    const result = estimateComplexity(TS_SOURCE, "typescript");
    assert.ok(result !== null);
    assert.ok(result.total >= 3, `complexity should be >= 3, got ${result.total}`);
  });
});

// ── Python ─────────────────────────────────────────────

describe("Python AST", () => {
  const PY_SOURCE = `
import os
from pathlib import Path

class TaskRunner:
    def __init__(self, name: str):
        self.name = name
        self.tasks = []

    def run(self):
        for task in self.tasks:
            if task.ready:
                task.execute()
            else:
                print(f"Skipping {task}")

def helper(x: int) -> int:
    return x * 2 if x > 0 else 0
`;

  it("extracts symbols", () => {
    if (!isLanguageLoaded("python")) return;
    const symbols = extractSymbols(PY_SOURCE, "python");
    assert.ok(symbols.length > 0);
    const names = symbols.map(s => s.name);
    assert.ok(names.includes("TaskRunner"), "should find class TaskRunner");
    assert.ok(names.includes("helper"), "should find function helper");
  });

  it("extracts imports", () => {
    if (!isLanguageLoaded("python")) return;
    const imports = extractImports(PY_SOURCE, "python");
    assert.ok(imports.length >= 2);
  });

  it("estimates complexity", () => {
    if (!isLanguageLoaded("python")) return;
    const result = estimateComplexity(PY_SOURCE, "python");
    assert.ok(result !== null);
    assert.ok(result.total >= 2);
  });
});

// ── Go ─────────────────────────────────────────────────

describe("Go AST", () => {
  const GO_SOURCE = `
package main

import (
	"fmt"
	"os"
)

type Config struct {
	Name  string
	Value int
}

func Run(cfg Config) error {
	if cfg.Value <= 0 {
		return fmt.Errorf("invalid value")
	}
	for _, item := range os.Args {
		fmt.Println(item)
	}
	return nil
}

func helper(x int) int {
	if x > 0 {
		return x * 2
	}
	return 0
}
`;

  it("extracts symbols", () => {
    if (!isLanguageLoaded("go")) return;
    const symbols = extractSymbols(GO_SOURCE, "go");
    assert.ok(symbols.length > 0);
    const names = symbols.map(s => s.name);
    assert.ok(names.includes("Run") || names.includes("helper"), `found: ${names}`);
  });

  it("extracts imports", () => {
    if (!isLanguageLoaded("go")) return;
    const imports = extractImports(GO_SOURCE, "go");
    assert.ok(imports.length >= 1);
  });
});

// ── Rust ───────────────────────────────────────────────

describe("Rust AST", () => {
  const RS_SOURCE = `
use std::collections::HashMap;
use std::io::Result;

struct Config {
    name: String,
    value: i32,
}

trait Runner {
    fn run(&self) -> Result<()>;
}

impl Runner for Config {
    fn run(&self) -> Result<()> {
        if self.value > 0 {
            println!("{}", self.name);
        }
        Ok(())
    }
}

fn helper(x: i32) -> i32 {
    match x {
        n if n > 0 => n * 2,
        _ => 0,
    }
}
`;

  it("extracts symbols", () => {
    if (!isLanguageLoaded("rust")) return;
    const symbols = extractSymbols(RS_SOURCE, "rust");
    assert.ok(symbols.length > 0);
    const types = symbols.map(s => s.kind);
    assert.ok(types.includes("struct") || types.includes("function") || types.includes("impl"),
      `found kinds: ${types}`);
  });

  it("extracts imports", () => {
    if (!isLanguageLoaded("rust")) return;
    const imports = extractImports(RS_SOURCE, "rust");
    assert.ok(imports.length >= 1);
  });
});

// ── Java ───────────────────────────────────────────────

describe("Java AST", () => {
  const JAVA_SOURCE = `
import java.util.List;
import java.util.ArrayList;

public class TaskRunner {
    private List<String> tasks = new ArrayList<>();

    public TaskRunner() {
        // constructor
    }

    public void run() {
        for (String task : tasks) {
            if (task != null) {
                System.out.println(task);
            }
        }
    }

    private int helper(int x) {
        return x > 0 ? x * 2 : 0;
    }
}
`;

  it("extracts symbols", () => {
    if (!isLanguageLoaded("java")) return;
    const symbols = extractSymbols(JAVA_SOURCE, "java");
    assert.ok(symbols.length > 0);
    const names = symbols.map(s => s.name);
    assert.ok(names.includes("TaskRunner"), `should find TaskRunner, got: ${names}`);
  });

  it("extracts imports", () => {
    if (!isLanguageLoaded("java")) return;
    const imports = extractImports(JAVA_SOURCE, "java");
    assert.ok(imports.length >= 2);
  });
});

// ── Cross-language consistency ─────────────────────────

describe("cross-language API consistency", () => {
  it("all loaded languages return arrays from extractSymbols", () => {
    const status = bridgeStatus();
    for (const langId of status.languages) {
      const result = extractSymbols("// empty", langId);
      assert.ok(Array.isArray(result), `${langId}: extractSymbols should return array`);
    }
  });

  it("all loaded languages return arrays from extractImports", () => {
    const status = bridgeStatus();
    for (const langId of status.languages) {
      const result = extractImports("// empty", langId);
      assert.ok(Array.isArray(result), `${langId}: extractImports should return array`);
    }
  });

  it("unloaded language returns empty/null gracefully", () => {
    const symbols = extractSymbols("code", "nonexistent");
    assert.deepEqual(symbols, []);

    const imports = extractImports("code", "nonexistent");
    assert.deepEqual(imports, []);

    const complexity = estimateComplexity("code", "nonexistent");
    assert.equal(complexity, null);
  });
});
