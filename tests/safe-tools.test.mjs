#!/usr/bin/env node
/**
 * Safe Tool Registry Tests — PERM-6
 *
 * Run: node --test tests/safe-tools.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SafeToolRegistry, DEFAULT_SAFE_TOOLS } from "../dist/platform/bus/safe-tools.js";

describe("SafeToolRegistry", () => {
  it("Read is safe by default", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("Read", {}));
  });

  it("Glob is safe by default", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("Glob"));
  });

  it("Grep is safe by default", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("Grep"));
  });

  it("ToolSearch is safe by default", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("ToolSearch"));
  });

  it("Bash(ls) is safe", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("Bash", { command: "ls -la" }));
  });

  it("Bash(rm) is NOT safe", () => {
    const reg = new SafeToolRegistry();
    assert.ok(!reg.isSafe("Bash", { command: "rm -rf /" }));
  });

  it("Bash(git status) is safe", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("Bash", { command: "git status" }));
  });

  it("Write is NOT safe by default", () => {
    const reg = new SafeToolRegistry();
    assert.ok(!reg.isSafe("Write", { file_path: "test.ts" }));
  });

  it("Edit is NOT safe by default", () => {
    const reg = new SafeToolRegistry();
    assert.ok(!reg.isSafe("Edit", { file_path: "test.ts" }));
  });

  it("unknown tool is NOT safe", () => {
    const reg = new SafeToolRegistry();
    assert.ok(!reg.isSafe("CustomTool"));
  });

  it("addSafe adds new entry", () => {
    const reg = new SafeToolRegistry();
    assert.ok(!reg.isSafe("CustomTool"));
    reg.addSafe({ tool: "CustomTool" });
    assert.ok(reg.isSafe("CustomTool"));
  });

  it("removeSafe removes entry", () => {
    const reg = new SafeToolRegistry();
    assert.ok(reg.isSafe("Read"));
    reg.removeSafe("Read");
    assert.ok(!reg.isSafe("Read"));
  });

  it("loadFromConfig parses Tool(content) format", () => {
    const reg = new SafeToolRegistry([]);
    reg.loadFromConfig(["Read", "Bash(prefix:npm test)"]);
    assert.ok(reg.isSafe("Read"));
    assert.ok(reg.isSafe("Bash", { command: "npm test --coverage" }));
    assert.ok(!reg.isSafe("Bash", { command: "rm file" }));
  });

  it("custom entries replace defaults", () => {
    const reg = new SafeToolRegistry([{ tool: "OnlyThis" }]);
    assert.ok(reg.isSafe("OnlyThis"));
    assert.ok(!reg.isSafe("Read")); // Default not included
  });

  it("default safe tools list has expected entries", () => {
    assert.ok(DEFAULT_SAFE_TOOLS.length >= 7);
    assert.ok(DEFAULT_SAFE_TOOLS.some(e => e.tool === "Read"));
    assert.ok(DEFAULT_SAFE_TOOLS.some(e => e.tool === "Bash" && e.content === "prefix:ls"));
  });

  it("performance: isSafe < 0.1ms", () => {
    const reg = new SafeToolRegistry();
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      reg.isSafe("Read");
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `10000 calls took ${elapsed}ms (limit: 1000ms)`);
  });
});
