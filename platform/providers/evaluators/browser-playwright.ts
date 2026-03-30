import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

/**
 * Browser evaluator — uses Playwright when available, graceful skip otherwise.
 *
 * For each 'browser' scenario:
 *   - target = URL to navigate to
 *   - verifier = CSS selector that must exist on page
 *   - successCriteria = text content checks on the page
 *
 * Playwright is an optional dependency. When not installed, the evaluator
 * returns passed:true (fail-open) with an informational evidence note.
 */
export class BrowserPlaywrightEvaluator implements RuntimeEvaluator {
  name = 'browser-playwright';
  surfaces = ['browser' as const];

  async run(spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    const browserScenarios = spec.scenarios.filter(s => s.surface === 'browser');
    if (browserScenarios.length === 0) {
      return { passed: true, findings: [], evidence: [] };
    }

    // Try to load Playwright — optional dependency
    let playwright: any;
    try {
      // Optional dependency — not in package.json, loaded at runtime if available
      playwright = await (Function('return import("playwright")')() as Promise<any>);
    } catch (err) {
      console.warn(`[browser-playwright] playwright not available: ${(err as Error).message}`);
      return {
        passed: true,
        findings: [],
        evidence: [`browser-playwright: skipped (playwright not installed)`],
      };
    }

    const findings: string[] = [];
    const evidence: string[] = [];
    let browser: any;

    try {
      browser = await playwright.chromium.launch({ headless: true });
      const context = await browser.newContext();

      for (const scenario of browserScenarios) {
        const page = await context.newPage();
        try {
          await page.goto(scenario.target, { timeout: 10_000, waitUntil: "domcontentloaded" });

          // Selector check via verifier field
          if (scenario.verifier) {
            const el = await page.$(scenario.verifier);
            if (!el) {
              findings.push(`${scenario.target}: selector "${scenario.verifier}" not found`);
            }
          }

          // Text content checks
          const bodyText = await page.textContent("body") ?? "";
          for (const criterion of scenario.successCriteria) {
            if (!bodyText.includes(criterion)) {
              findings.push(`${scenario.target}: page missing text "${criterion}"`);
            }
          }

          evidence.push(`${scenario.target}: loaded (${bodyText.length} chars)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          findings.push(`${scenario.target}: navigation failed — ${msg}`);
        } finally {
          await page.close();
        }
      }

      await context.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push(`browser launch failed: ${msg}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    return { passed: findings.length === 0, findings, evidence };
  }
}
