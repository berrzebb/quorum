/**
 * Project Scanner — detects language, framework, CI, test, package manager, and domains.
 *
 * PRD § 6.6 / FR-1: SessionStart에서 프로젝트 프로필 자동 생성.
 * Language Registry 활용 + file-pattern 기반 감지.
 *
 * @module adapters/shared/project-scanner
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} ProjectProfile
 * @property {string[]} languages - Detected language ids (e.g. ["typescript", "python"])
 * @property {string|null} packageManager - npm | yarn | pnpm | go | cargo | pip | maven | null
 * @property {string[]} frameworks - Detected frameworks (e.g. ["react", "express"])
 * @property {string|null} ci - Detected CI system (e.g. "github-actions", "gitlab-ci")
 * @property {string|null} testFramework - Detected test framework (e.g. "vitest", "jest")
 * @property {string[]} activeDomains - Auto-detected domains (e.g. ["security", "i18n"])
 * @property {string} estimatedSize - "small" (<20 files) | "medium" (20-100) | "large" (100+)
 */

// ── Package Manager Detection ───────────────────────────────

const PKG_MANAGERS = [
  { file: "package-lock.json", id: "npm" },
  { file: "yarn.lock", id: "yarn" },
  { file: "pnpm-lock.yaml", id: "pnpm" },
  { file: "package.json", id: "npm" },  // fallback if no lockfile
  { file: "go.mod", id: "go" },
  { file: "Cargo.toml", id: "cargo" },
  { file: "pyproject.toml", id: "pip" },
  { file: "requirements.txt", id: "pip" },
  { file: "pom.xml", id: "maven" },
  { file: "build.gradle", id: "gradle" },
];

function detectPackageManager(dir) {
  for (const { file, id } of PKG_MANAGERS) {
    if (existsSync(resolve(dir, file))) return id;
  }
  return null;
}

// ── Framework Detection ─────────────────────────────────────

function detectFrameworks(dir) {
  const frameworks = [];
  const pkgPath = resolve(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const FW_MAP = [
        [/^react$/, "react"],
        [/^next$/, "nextjs"],
        [/^express$/, "express"],
        [/^fastify$/, "fastify"],
        [/^vue$/, "vue"],
        [/^@angular\/core$/, "angular"],
        [/^svelte$/, "svelte"],
        [/^hono$/, "hono"],
        [/^nestjs|@nestjs\/core/, "nestjs"],
      ];
      for (const dep of Object.keys(allDeps)) {
        for (const [re, name] of FW_MAP) {
          if (re.test(dep) && !frameworks.includes(name)) frameworks.push(name);
        }
      }
    } catch { /* fail-open */ }
  }

  // Go frameworks
  const goMod = resolve(dir, "go.mod");
  if (existsSync(goMod)) {
    try {
      const content = readFileSync(goMod, "utf8");
      if (/github\.com\/gin-gonic\/gin/.test(content)) frameworks.push("gin");
      if (/github\.com\/labstack\/echo/.test(content)) frameworks.push("echo");
      if (/github\.com\/gofiber\/fiber/.test(content)) frameworks.push("fiber");
    } catch { /* fail-open */ }
  }

  // Python frameworks
  const pyFiles = ["pyproject.toml", "requirements.txt"];
  for (const f of pyFiles) {
    const p = resolve(dir, f);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf8");
        if (/django/i.test(content)) frameworks.push("django");
        if (/fastapi/i.test(content)) frameworks.push("fastapi");
        if (/flask/i.test(content)) frameworks.push("flask");
      } catch { /* fail-open */ }
    }
  }

  return frameworks;
}

// ── CI Detection ────────────────────────────────────────────

const CI_PATTERNS = [
  { path: ".github/workflows", id: "github-actions" },
  { path: ".gitlab-ci.yml", id: "gitlab-ci" },
  { path: "Jenkinsfile", id: "jenkins" },
  { path: ".circleci", id: "circleci" },
  { path: ".travis.yml", id: "travis" },
  { path: "azure-pipelines.yml", id: "azure-pipelines" },
  { path: "bitbucket-pipelines.yml", id: "bitbucket" },
];

function detectCI(dir) {
  for (const { path, id } of CI_PATTERNS) {
    if (existsSync(resolve(dir, path))) return id;
  }
  return null;
}

// ── Test Framework Detection ────────────────────────────────

function detectTestFramework(dir) {
  // Config file patterns
  const TEST_CONFIGS = [
    { files: ["vitest.config.ts", "vitest.config.mts", "vitest.config.js"], id: "vitest" },
    { files: ["jest.config.ts", "jest.config.js", "jest.config.mjs"], id: "jest" },
    { files: [".mocharc.yml", ".mocharc.json", ".mocharc.js"], id: "mocha" },
    { files: ["pytest.ini", "pyproject.toml"], id: null }, // pytest checked via pyproject
    { files: ["Cargo.toml"], id: null }, // rust test is builtin
  ];

  for (const { files, id } of TEST_CONFIGS) {
    if (id && files.some(f => existsSync(resolve(dir, f)))) return id;
  }

  // package.json deps
  const pkgPath = resolve(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const devDeps = pkg.devDependencies ?? {};
      if (devDeps.vitest) return "vitest";
      if (devDeps.jest) return "jest";
      if (devDeps.mocha) return "mocha";
      // test script
      const testScript = pkg.scripts?.test ?? "";
      if (/vitest/.test(testScript)) return "vitest";
      if (/jest/.test(testScript)) return "jest";
      if (/mocha/.test(testScript)) return "mocha";
      if (/node\s+(--test|tests?\/)/.test(testScript)) return "node-test";
    } catch { /* fail-open */ }
  }

  // pytest in pyproject.toml
  const pyproject = resolve(dir, "pyproject.toml");
  if (existsSync(pyproject)) {
    try {
      if (/pytest/i.test(readFileSync(pyproject, "utf8"))) return "pytest";
    } catch { /* fail-open */ }
  }

  // Go: always has `go test`
  if (existsSync(resolve(dir, "go.mod"))) return "go-test";

  // Rust: always has `cargo test`
  if (existsSync(resolve(dir, "Cargo.toml"))) return "cargo-test";

  return null;
}

// ── Domain Detection ────────────────────────────────────────

/**
 * Detect active domains from file patterns.
 * Reuses patterns from domain-detect.ts without importing (MJS boundary).
 */
function detectDomains(dir) {
  const domains = [];
  const entries = new Set();

  // Collect entries from root + common dirs
  const sampleDirs = [dir];
  for (const sub of ["src", "lib", "app", "pages", "components", "platform", "server", "client"]) {
    const p = resolve(dir, sub);
    if (existsSync(p) && statSync(p).isDirectory()) sampleDirs.push(p);
  }
  for (const d of sampleDirs) {
    try { for (const e of readdirSync(d)) entries.add(e); } catch { /* skip */ }
  }

  const allEntries = [...entries].join("\n");

  // Pattern → domain mapping
  if (/auth|secret|cred|token|password|jwt|oauth/i.test(allEntries)) domains.push("security");
  if (/i18n|locales?|translations?|messages\./i.test(allEntries)) domains.push("i18n");
  if (/migrations?|\.sql|prisma|drizzle|knex/i.test(allEntries)) domains.push("migration");
  if (/Dockerfile|docker-compose|\.terraform|k8s|kubernetes/i.test(allEntries)) domains.push("infrastructure");
  if (/\.test\.|\.spec\.|__tests__|tests?\//.test(allEntries)) domains.push("testing");
  if (/aria|a11y|accessibility|wcag/i.test(allEntries)) domains.push("a11y");
  if (/perf|benchmark|lighthouse/i.test(allEntries)) domains.push("performance");
  if (/observability|monitoring|metrics|tracing|logging/i.test(allEntries)) domains.push("observability");

  return domains;
}

// ── Size Estimation ─────────────────────────────────────────

function estimateSize(dir) {
  let count = 0;
  const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".swift", ".cpp", ".c", ".cs"]);
  const sampleDirs = [dir];
  for (const sub of ["src", "lib", "app", "platform", "cmd", "pkg", "internal"]) {
    const p = resolve(dir, sub);
    if (existsSync(p) && statSync(p).isDirectory()) sampleDirs.push(p);
  }
  for (const d of sampleDirs) {
    try {
      for (const entry of readdirSync(d)) {
        if (CODE_EXT.has(extname(entry).toLowerCase())) count++;
      }
    } catch { /* skip */ }
  }
  if (count < 20) return "small";
  if (count < 100) return "medium";
  return "large";
}

// ── Main Scanner ────────────────────────────────────────────

/**
 * Scan a project directory and produce a ProjectProfile.
 *
 * Uses Language Registry if available, falls back to file extension detection.
 *
 * @param {string} dir - Project root directory
 * @param {object} [registry] - Optional LanguageRegistry instance
 * @returns {ProjectProfile}
 */
export function scanProject(dir, registry) {
  // Languages
  let languages = [];
  if (registry && typeof registry.detectLanguages === "function") {
    languages = registry.detectLanguages(dir).map(spec => spec.id);
  } else {
    // Fallback: check for common file types
    const LANG_FILES = [
      { ext: [".ts", ".tsx"], id: "typescript" },
      { ext: [".js", ".jsx", ".mjs"], id: "javascript" },
      { ext: [".py"], id: "python" },
      { ext: [".go"], id: "go" },
      { ext: [".rs"], id: "rust" },
      { ext: [".java"], id: "java" },
    ];
    const found = new Set();
    const dirs = [dir];
    for (const sub of ["src", "lib", "app", "platform", "cmd", "pkg", "internal", "server", "client"]) {
      const p = resolve(dir, sub);
      if (existsSync(p)) dirs.push(p);
    }
    for (const d of dirs) {
      try {
        for (const entry of readdirSync(d)) {
          const e = extname(entry).toLowerCase();
          for (const { ext, id } of LANG_FILES) {
            if (ext.includes(e)) found.add(id);
          }
        }
      } catch { /* skip */ }
    }
    languages = [...found];
  }

  return {
    languages,
    packageManager: detectPackageManager(dir),
    frameworks: detectFrameworks(dir),
    ci: detectCI(dir),
    testFramework: detectTestFramework(dir),
    activeDomains: detectDomains(dir),
    estimatedSize: estimateSize(dir),
  };
}
