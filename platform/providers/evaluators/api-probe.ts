import { request } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

/**
 * API probe evaluator — verifies HTTP endpoints respond correctly.
 *
 * For each 'api' scenario:
 *   - target = URL to probe (e.g., "http://localhost:3000/health")
 *   - verifier = expected HTTP method (GET by default)
 *   - successCriteria = strings that must appear in the response body
 */
export class ApiProbeEvaluator implements RuntimeEvaluator {
  name = 'api-probe';
  surfaces = ['api' as const];

  private timeout: number;

  constructor(private baseUrl?: string, timeout = 5000) {
    this.timeout = timeout;
  }

  async run(spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    const apiScenarios = spec.scenarios.filter(s => s.surface === 'api');
    if (apiScenarios.length === 0) {
      return { passed: true, findings: [], evidence: [] };
    }

    const findings: string[] = [];
    const evidence: string[] = [];

    for (const scenario of apiScenarios) {
      const url = scenario.target.startsWith("http")
        ? scenario.target
        : `${this.baseUrl ?? "http://localhost:3000"}${scenario.target}`;

      try {
        const { statusCode, body } = await this.probe(url);

        if (statusCode < 200 || statusCode >= 400) {
          findings.push(`${scenario.target}: HTTP ${statusCode}`);
          continue;
        }

        for (const criterion of scenario.successCriteria) {
          if (!body.includes(criterion)) {
            findings.push(`${scenario.target}: response missing "${criterion}"`);
          }
        }

        evidence.push(`${scenario.target}: HTTP ${statusCode} (${body.length} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Connection refused = server not running → non-blocking informational failure
        if (msg.includes("ECONNREFUSED")) {
          findings.push(`${scenario.target}: server not reachable (ECONNREFUSED)`);
        } else {
          findings.push(`${scenario.target}: probe failed — ${msg}`);
        }
      }
    }

    return { passed: findings.length === 0, findings, evidence };
  }

  private probe(url: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith("https");
      const fn = isHttps ? httpsRequest : request;

      const req = fn(url, { method: "GET", timeout: this.timeout }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });

      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });
  }
}
