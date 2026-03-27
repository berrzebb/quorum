/**
 * Quorum Skill Eval Runner
 *
 * Executes skill evaluations: workflow (process compliance) and capability (output quality).
 * Usage:
 *   node evals/runner.mjs --skill audit
 *   node evals/runner.mjs --classification workflow
 *   node evals/runner.mjs --benchmark
 *   node evals/runner.mjs --parity planner
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMarkdownReport, formatDetailedReport, formatJsonSummary } from "./reporter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────

export function loadConfig() {
  const raw = readFileSync(join(__dirname, "config.json"), "utf8");
  return JSON.parse(raw);
}

// ── YAML Parser (no external deps) ──────────────

export function parseEvalYaml(content) {
  const result = { name: "", classification: "", version: "", description: "", evals: [], parity: { enabled: false }, benchmark: {} };
  const lines = content.split("\n");
  let currentSection = null;
  let currentEval = null;
  let currentCriteria = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level fields
    if (/^name:\s*/.test(trimmed)) {
      result.name = trimmed.replace(/^name:\s*/, "").replace(/^["']|["']$/g, "");
    } else if (/^classification:\s*/.test(trimmed)) {
      result.classification = trimmed.replace(/^classification:\s*/, "").replace(/^["']|["']$/g, "");
    } else if (/^version:\s*/.test(trimmed)) {
      result.version = trimmed.replace(/^version:\s*/, "").replace(/^["']|["']$/g, "");
    } else if (/^description:\s*/.test(trimmed)) {
      result.description = trimmed.replace(/^description:\s*/, "").replace(/^["']|["']$/g, "");
    }

    // Section detection
    else if (trimmed === "evals:") { currentSection = "evals"; }
    else if (trimmed === "parity:" || trimmed === "parity_test:") { currentSection = "parity"; }
    else if (trimmed === "benchmark:") { currentSection = "benchmark"; }

    // Evals section
    else if (currentSection === "evals") {
      if (/^\s*-\s*name:\s*/.test(line)) {
        if (currentEval) {
          currentEval.criteria = [...currentCriteria];
          result.evals.push(currentEval);
        }
        currentEval = { name: line.replace(/.*name:\s*/, "").replace(/^["']|["']$/g, ""), prompt: "", expected: "", criteria: [], timeout: 120000 };
        currentCriteria = [];
      } else if (currentEval) {
        if (/prompt:\s*/.test(trimmed)) currentEval.prompt = trimmed.replace(/.*prompt:\s*/, "").replace(/^["']|["']$/g, "");
        else if (/expected:\s*/.test(trimmed)) currentEval.expected = trimmed.replace(/.*expected:\s*/, "").replace(/^["']|["']$/g, "");
        else if (/timeout:\s*/.test(trimmed)) currentEval.timeout = parseInt(trimmed.replace(/.*timeout:\s*/, ""), 10);
        else if (/^\s*-\s*"/.test(line)) currentCriteria.push(trimmed.replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
      }
    }

    // Parity section
    else if (currentSection === "parity") {
      if (/enabled:\s*/.test(trimmed)) result.parity.enabled = trimmed.includes("true");
      else if (/threshold:\s*/.test(trimmed)) result.parity.threshold = parseFloat(trimmed.replace(/.*threshold:\s*/, ""));
      else if (/description:\s*/.test(trimmed)) result.parity.description = trimmed.replace(/.*description:\s*/, "").replace(/^["']|["']$/g, "");
    }

    // Benchmark section
    else if (currentSection === "benchmark") {
      if (/model_baseline:\s*/.test(trimmed)) result.benchmark.modelBaseline = trimmed.replace(/.*model_baseline:\s*/, "").replace(/^["']|["']$/g, "");
      else if (/^\s*-\s*\w/.test(line)) {
        if (!result.benchmark.metrics) result.benchmark.metrics = [];
        result.benchmark.metrics.push(trimmed.replace(/^-\s*/, ""));
      }
    }
  }

  // Push last eval
  if (currentEval) {
    currentEval.criteria = [...currentCriteria];
    result.evals.push(currentEval);
  }

  return result;
}

// ── Eval Loading ────────────────────────────────

export function loadEvalDefinition(skillName) {
  const classifications = ["workflow", "capability"];
  for (const cls of classifications) {
    const dir = join(__dirname, cls, skillName);
    const yamlPath = join(dir, "eval.yaml");
    if (existsSync(yamlPath)) {
      const content = readFileSync(yamlPath, "utf8");
      return { ...parseEvalYaml(content), _dir: dir, _classification: cls };
    }
  }
  return null;
}

export function listSkills(classification) {
  const results = [];
  const classifications = classification ? [classification] : ["workflow", "capability"];
  for (const cls of classifications) {
    const dir = join(__dirname, cls);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory() && existsSync(join(dir, name.name, "eval.yaml"))) {
        results.push({ name: name.name, classification: cls });
      }
    }
  }
  return results;
}

// ── Criteria Evaluation ─────────────────────────

export function evaluateAgainstCriteria(promptContent, expectedContent, criteria) {
  // Placeholder detection
  if (!expectedContent || expectedContent.trim().length < 50 || expectedContent.trim().split("\n").length < 2) {
    return { pass: false, score: 0, reason: "Expected output is placeholder or too short" };
  }

  if (!promptContent || promptContent.trim().length < 20) {
    return { pass: false, score: 0, reason: "Prompt is placeholder or too short" };
  }

  // Criteria keyword matching against expected content
  let matched = 0;
  const details = [];

  for (const criterion of criteria) {
    // Extract meaningful keywords (skip stopwords, keep domain terms)
    const STOPWORDS = new Set(["the", "and", "for", "not", "does", "must", "via", "use", "all", "any", "this", "that", "with", "from", "based", "look"]);
    const keywords = criterion.toLowerCase()
      .replace(/[^a-z0-9가-힣_\s-]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w));

    const expectedLower = expectedContent.toLowerCase();
    const matchCount = keywords.filter(kw => expectedLower.includes(kw)).length;
    const ratio = keywords.length > 0 ? matchCount / keywords.length : 0;

    if (ratio >= 0.4) {
      matched++;
      details.push({ criterion, status: "pass", matchRatio: ratio });
    } else {
      details.push({ criterion, status: "fail", matchRatio: ratio });
    }
  }

  const score = criteria.length > 0 ? matched / criteria.length : 0;
  const config = loadConfig();
  const pass = score >= config.passThreshold;

  return { pass, score: Math.round(score * 100) / 100, matched, total: criteria.length, details };
}

// ── Run Eval ────────────────────────────────────

export function runEval(skillName, evalName) {
  const def = loadEvalDefinition(skillName);
  if (!def) return { skill: skillName, error: `Skill eval not found: ${skillName}` };

  const targetEvals = evalName
    ? def.evals.filter(e => e.name === evalName)
    : def.evals;

  if (targetEvals.length === 0) {
    return { skill: skillName, error: `No eval found: ${evalName || "(all)"}` };
  }

  const results = [];
  for (const ev of targetEvals) {
    const promptPath = join(def._dir, ev.prompt);
    const expectedPath = join(def._dir, ev.expected);

    const promptContent = existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
    const expectedContent = existsSync(expectedPath) ? readFileSync(expectedPath, "utf8") : "";

    const result = evaluateAgainstCriteria(promptContent, expectedContent, ev.criteria);
    results.push({
      eval: ev.name,
      ...result,
    });
  }

  const allPass = results.every(r => r.pass);
  return {
    skill: skillName,
    classification: def._classification,
    pass: allPass,
    evals: results,
  };
}

// ── Run All ─────────────────────────────────────

export function runAllEvals(classification) {
  const skills = listSkills(classification);
  const results = [];
  for (const { name } of skills) {
    results.push(runEval(name));
  }
  return results;
}

// ── Run Benchmark ───────────────────────────────

export function runBenchmark() {
  const config = loadConfig();
  const workflow = runAllEvals("workflow");
  const capability = runAllEvals("capability");
  const all = [...workflow, ...capability];

  const passed = all.filter(r => r.pass).length;
  const total = all.length;

  return {
    timestamp: new Date().toISOString(),
    version: config.version,
    model: config.benchmark.modelBaseline,
    summary: {
      total,
      passed,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      workflow: { total: workflow.length, passed: workflow.filter(r => r.pass).length },
      capability: { total: capability.length, passed: capability.filter(r => r.pass).length },
    },
    results: all,
  };
}

// ── Parity Test (framework stub) ────────────────

export function runParityTest(skillName) {
  const def = loadEvalDefinition(skillName);
  if (!def) return { skill: skillName, error: `Skill eval not found: ${skillName}` };
  if (!def.parity?.enabled) return { skill: skillName, parity: "disabled", reason: "Parity test not enabled for this skill" };

  return {
    skill: skillName,
    parity: "ready",
    threshold: def.parity.threshold || loadConfig().parityThreshold,
    description: def.parity.description || "Model parity test",
    status: "stub — requires LLM execution to compare with/without skill",
  };
}

// ── CLI ─────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const flagIdx = (flag) => args.indexOf(flag);

  if (flagIdx("--benchmark") >= 0) {
    const result = runBenchmark();
    if (flagIdx("--json") >= 0) {
      console.log(formatJsonSummary(result));
    } else if (flagIdx("--detailed") >= 0) {
      console.log(formatDetailedReport(result));
    } else {
      console.log(formatMarkdownReport(result));
    }
    process.exitCode = result.summary.passRate === 100 ? 0 : 1;
    return;
  }

  if (flagIdx("--parity") >= 0) {
    const name = args[flagIdx("--parity") + 1];
    if (!name) { console.error("Usage: --parity <skill-name>"); process.exitCode = 1; return; }
    console.log(JSON.stringify(runParityTest(name), null, 2));
    return;
  }

  if (flagIdx("--classification") >= 0) {
    const cls = args[flagIdx("--classification") + 1];
    const results = runAllEvals(cls);
    const passed = results.filter(r => r.pass).length;
    console.log(JSON.stringify({ classification: cls, total: results.length, passed, results }, null, 2));
    process.exitCode = passed === results.length ? 0 : 1;
    return;
  }

  if (flagIdx("--skill") >= 0) {
    const name = args[flagIdx("--skill") + 1];
    const evalName = flagIdx("--eval") >= 0 ? args[flagIdx("--eval") + 1] : undefined;
    if (!name) { console.error("Usage: --skill <name> [--eval <eval-name>]"); process.exitCode = 1; return; }
    const result = runEval(name, evalName);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.pass ? 0 : 1;
    return;
  }

  if (flagIdx("--list") >= 0) {
    const cls = flagIdx("--classification") >= 0 ? args[flagIdx("--classification") + 1] : undefined;
    const skills = listSkills(cls);
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  console.log(`Quorum Skill Eval Runner

Usage:
  node evals/runner.mjs --skill <name> [--eval <eval-name>]
  node evals/runner.mjs --classification <workflow|capability>
  node evals/runner.mjs --benchmark [--json|--detailed]
  node evals/runner.mjs --parity <skill-name>
  node evals/runner.mjs --list [--classification <type>]`);
}

main();
