/**
 * Shared audit prompt formatter — used by all auditor implementations.
 */

import type { AuditRequest } from "../provider.js";

export function formatAuditPrompt(request: AuditRequest): string {
  return [
    request.prompt,
    "",
    "## Evidence",
    "",
    request.evidence,
    "",
    "## Changed Files",
    "",
    ...request.files.map(f => `- ${f}`),
    "",
    'Respond with ONLY a JSON object:',
    '{"verdict": "approved" | "changes_requested" | "infra_failure", "codes": [], "summary": "..."}',
  ].join("\n");
}
