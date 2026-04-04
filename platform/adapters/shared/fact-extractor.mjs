/**
 * Fact Extractor — extracts learning facts from session events.
 *
 * PRD § FR-10: session-stop에서 EventStore의 audit verdict, trigger outcome,
 * specialist finding을 fact 후보로 추출.
 *
 * @module adapters/shared/fact-extractor
 */

/**
 * @typedef {Object} FactCandidate
 * @property {string} category - 'audit_pattern' | 'trigger_insight' | 'domain_finding' | 'code_convention' | 'error_pattern'
 * @property {string} content - Fact text
 * @property {string} [scope] - 'project' | 'global'
 */

/**
 * Extract fact candidates from session events.
 *
 * @param {Array<{type: string, payload: Record<string, unknown>}>} events
 * @returns {FactCandidate[]}
 */
export function extractFacts(events) {
  if (!Array.isArray(events)) return [];
  const facts = [];

  for (const event of events) {
    const { type, payload } = event;
    if (!payload) continue;

    switch (type) {
      // audit.verdict → rejection reasons as error/audit patterns
      case "audit.verdict": {
        if (payload.verdict === "changes_requested") {
          const codes = payload.codes ?? [];
          const summary = payload.summary ?? "";
          if (codes.length > 0) {
            facts.push({
              category: "audit_pattern",
              content: `Audit rejection: ${codes.join(", ")}${summary ? ` — ${summary.toString().slice(0, 200)}` : ""}`,
            });
          }
        }
        break;
      }

      // quality.fail → error patterns
      case "quality.fail": {
        const label = payload.label ?? "quality";
        const file = payload.file ?? "";
        const output = (payload.output ?? "").toString().slice(0, 150);
        facts.push({
          category: "error_pattern",
          content: `${label} failure${file ? ` in ${file}` : ""}: ${output}`.trim(),
        });
        break;
      }

      // specialist.review → domain findings
      case "specialist.review": {
        if (payload.verdict === "changes_requested" && payload.codes?.length > 0) {
          facts.push({
            category: "domain_finding",
            content: `${payload.domain ?? "specialist"} review: ${payload.codes.join(", ")}`,
          });
        }
        break;
      }

      // fitness.gate → self-correction triggers
      case "fitness.gate": {
        if (payload.decision === "self-correct" || payload.decision === "auto-reject") {
          facts.push({
            category: "trigger_insight",
            content: `Fitness ${payload.decision}: delta=${payload.delta}, reason=${payload.reason ?? "unknown"}`,
          });
        }
        break;
      }
    }
  }

  return facts;
}
