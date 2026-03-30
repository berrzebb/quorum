import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

/**
 * Data probe evaluator — verifies data artifacts exist and contain expected content.
 *
 * For each 'data' scenario:
 *   - target = relative file path to data artifact (CSV, JSON, DB, etc.)
 *   - successCriteria = strings that must appear in the file content
 *   - verifier = optional JSON path expression (e.g., "$.results.length > 0")
 */
export class DataProbeEvaluator implements RuntimeEvaluator {
  name = 'data-probe';
  surfaces = ['data' as const];

  constructor(private cwd: string = process.cwd()) {}

  async run(spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    const dataScenarios = spec.scenarios.filter(s => s.surface === 'data');
    if (dataScenarios.length === 0) {
      return { passed: true, findings: [], evidence: [] };
    }

    const findings: string[] = [];
    const evidence: string[] = [];

    for (const scenario of dataScenarios) {
      const targetPath = resolve(this.cwd, scenario.target);

      if (!existsSync(targetPath)) {
        findings.push(`Data artifact missing: ${scenario.target}`);
        continue;
      }

      const stat = statSync(targetPath);

      if (stat.isFile() && stat.size === 0) {
        findings.push(`Data artifact empty: ${scenario.target} (0 bytes)`);
        continue;
      }

      if (stat.isFile()) {
        try {
          const content = readFileSync(targetPath, "utf8");

          // Check string-contains criteria
          for (const criterion of scenario.successCriteria) {
            if (!content.includes(criterion)) {
              findings.push(`${scenario.target}: missing criterion "${criterion}"`);
            }
          }

          // JSON structure validation via verifier field
          if (scenario.verifier && scenario.target.endsWith(".json")) {
            try {
              const parsed = JSON.parse(content);
              const result = evaluateJsonPath(parsed, scenario.verifier);
              if (!result.valid) {
                findings.push(`${scenario.target}: JSON check failed — ${result.reason}`);
              }
            } catch {
              findings.push(`${scenario.target}: invalid JSON`);
            }
          }

          evidence.push(`${scenario.target}: exists (${stat.size} bytes, ${content.split("\n").length} lines)`);
        } catch {
          findings.push(`${scenario.target}: unreadable`);
        }
      } else if (stat.isDirectory()) {
        evidence.push(`${scenario.target}: directory exists`);
      }
    }

    return { passed: findings.length === 0, findings, evidence };
  }
}

/** Simple JSON path evaluator for basic checks (e.g., "$.length > 0", "$.status === ok"). */
function evaluateJsonPath(obj: unknown, expr: string): { valid: boolean; reason?: string } {
  try {
    // $.key.subkey — traverse
    const pathMatch = expr.match(/^\$\.(\S+?)\s*(>|<|>=|<=|===|!==)\s*(.+)$/);
    if (!pathMatch) return { valid: false, reason: `unparseable expression: ${expr}` };

    const [, path, op, rhs] = pathMatch;
    let value: any = obj;
    for (const key of (path ?? "").split(".")) {
      if (value == null) return { valid: false, reason: `path $.${path} is null` };
      value = (value as Record<string, unknown>)[key];
    }

    const numRhs = Number(rhs);
    const cmpRhs = isNaN(numRhs) ? rhs : numRhs;

    switch (op) {
      case ">":   return { valid: value > cmpRhs, reason: `${value} > ${cmpRhs}` };
      case "<":   return { valid: value < cmpRhs, reason: `${value} < ${cmpRhs}` };
      case ">=":  return { valid: value >= cmpRhs, reason: `${value} >= ${cmpRhs}` };
      case "<=":  return { valid: value <= cmpRhs, reason: `${value} <= ${cmpRhs}` };
      case "===": return { valid: String(value) === String(cmpRhs), reason: `${value} === ${cmpRhs}` };
      case "!==": return { valid: String(value) !== String(cmpRhs), reason: `${value} !== ${cmpRhs}` };
      default:    return { valid: true };
    }
  } catch {
    return { valid: false, reason: `evaluation error: ${expr}` };
  }
}
