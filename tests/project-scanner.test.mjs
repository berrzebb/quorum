/**
 * Tests: Project Scanner (SETUP WB-1 + WB-2)
 * scanProject() — language, framework, CI, test, package manager, domain detection.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { scanProject } from "../platform/adapters/shared/project-scanner.mjs";

/** Create temp project dir with given files. */
function createTempProject(files = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), "scan-"));
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(dir, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("scanProject", () => {
  // ── Language Detection ─────────────────────────
  describe("languages", () => {
    it("detects TypeScript from .ts files in src/", () => {
      const dir = createTempProject({ "src/index.ts": "" });
      const p = scanProject(dir);
      assert.ok(p.languages.includes("typescript"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects Python from .py files", () => {
      const dir = createTempProject({ "app.py": "" });
      const p = scanProject(dir);
      assert.ok(p.languages.includes("python"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects Go from .go files", () => {
      const dir = createTempProject({ "main.go": "" });
      const p = scanProject(dir);
      assert.ok(p.languages.includes("go"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("empty dir → no languages", () => {
      const dir = createTempProject({});
      const p = scanProject(dir);
      assert.equal(p.languages.length, 0);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── Package Manager ───────────────────────────
  describe("packageManager", () => {
    it("detects npm from package-lock.json", () => {
      const dir = createTempProject({ "package-lock.json": "{}" });
      assert.equal(scanProject(dir).packageManager, "npm");
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects yarn from yarn.lock", () => {
      const dir = createTempProject({ "yarn.lock": "" });
      assert.equal(scanProject(dir).packageManager, "yarn");
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects go from go.mod", () => {
      const dir = createTempProject({ "go.mod": "module test" });
      assert.equal(scanProject(dir).packageManager, "go");
      rmSync(dir, { recursive: true, force: true });
    });

    it("no files → null", () => {
      const dir = createTempProject({});
      assert.equal(scanProject(dir).packageManager, null);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── Framework Detection ───────────────────────
  describe("frameworks", () => {
    it("detects react from package.json", () => {
      const dir = createTempProject({
        "package.json": JSON.stringify({ dependencies: { react: "^18" } }),
      });
      const p = scanProject(dir);
      assert.ok(p.frameworks.includes("react"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects express", () => {
      const dir = createTempProject({
        "package.json": JSON.stringify({ dependencies: { express: "^4" } }),
      });
      assert.ok(scanProject(dir).frameworks.includes("express"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("no deps → empty", () => {
      const dir = createTempProject({ "package.json": "{}" });
      assert.equal(scanProject(dir).frameworks.length, 0);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── CI Detection ──────────────────────────────
  describe("ci", () => {
    it("detects github-actions", () => {
      const dir = createTempProject({ ".github/workflows/ci.yml": "" });
      assert.equal(scanProject(dir).ci, "github-actions");
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects gitlab-ci", () => {
      const dir = createTempProject({ ".gitlab-ci.yml": "" });
      assert.equal(scanProject(dir).ci, "gitlab-ci");
      rmSync(dir, { recursive: true, force: true });
    });

    it("no CI → null", () => {
      const dir = createTempProject({});
      assert.equal(scanProject(dir).ci, null);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── Test Framework Detection ──────────────────
  describe("testFramework", () => {
    it("detects vitest from config", () => {
      const dir = createTempProject({ "vitest.config.ts": "" });
      assert.equal(scanProject(dir).testFramework, "vitest");
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects jest from devDeps", () => {
      const dir = createTempProject({
        "package.json": JSON.stringify({ devDependencies: { jest: "^29" } }),
      });
      assert.equal(scanProject(dir).testFramework, "jest");
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects node-test from script", () => {
      const dir = createTempProject({
        "package.json": JSON.stringify({ scripts: { test: "node --test tests/" } }),
      });
      assert.equal(scanProject(dir).testFramework, "node-test");
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects go-test", () => {
      const dir = createTempProject({ "go.mod": "module test" });
      assert.equal(scanProject(dir).testFramework, "go-test");
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── Domain Detection (WB-2) ───────────────────
  describe("activeDomains", () => {
    it("detects security from auth/ dir", () => {
      const dir = createTempProject({ "src/auth/login.ts": "" });
      const p = scanProject(dir);
      assert.ok(p.activeDomains.includes("security"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects i18n from locales/", () => {
      const dir = createTempProject({ "locales/en.json": "{}" });
      const p = scanProject(dir);
      assert.ok(p.activeDomains.includes("i18n"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects migration from .sql", () => {
      const dir = createTempProject({ "migrations/001.sql": "" });
      const p = scanProject(dir);
      assert.ok(p.activeDomains.includes("migration"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects infrastructure from Dockerfile", () => {
      const dir = createTempProject({ "Dockerfile": "" });
      const p = scanProject(dir);
      assert.ok(p.activeDomains.includes("infrastructure"));
      rmSync(dir, { recursive: true, force: true });
    });

    it("detects testing from test files", () => {
      const dir = createTempProject({ "src/app.test.ts": "" });
      const p = scanProject(dir);
      assert.ok(p.activeDomains.includes("testing"));
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── Size Estimation ───────────────────────────
  describe("estimatedSize", () => {
    it("small for few files", () => {
      const dir = createTempProject({ "index.ts": "" });
      assert.equal(scanProject(dir).estimatedSize, "small");
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ── Quorum Self-Scan ──────────────────────────
  describe("quorum self-scan", () => {
    it("detects TypeScript + npm + node-test + github-actions", () => {
      const p = scanProject(process.cwd());
      assert.ok(p.languages.includes("typescript"), "should detect TypeScript");
      assert.equal(p.packageManager, "npm");
      assert.equal(p.testFramework, "node-test");
      assert.equal(p.ci, "github-actions");
    });
  });
});
