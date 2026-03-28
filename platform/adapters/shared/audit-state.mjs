/**
 * Shared audit state reader — reads audit status and retro marker.
 *
 * Deduplicates state reading logic from session-start.mjs and prompt-submit.mjs.
 * Returns pure data — no stdout writes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { t } from "../../core/context.mjs";

/** Canonical audit verdict status values. */
export const AUDIT_STATUS = /** @type {const} */ ({
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  INFRA_FAILURE: "infra_failure",
});

/**
 * Read audit-status.json marker.
 *
 * @param {string} repoRoot — absolute path to repo root
 * @returns {object|null} Parsed audit status or null
 */
export function readAuditStatus(repoRoot) {
  try {
    return JSON.parse(readFileSync(resolve(repoRoot, ".claude", "audit-status.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Read retro-marker.json from adapter's .session-state directory.
 *
 * @param {string} adapterDir — __dirname of the adapter
 * @returns {object|null} Parsed retro marker or null
 */
export function readRetroMarker(adapterDir) {
  try {
    return JSON.parse(readFileSync(resolve(adapterDir, ".session-state", "retro-marker.json"), "utf8"));
  } catch {
    return null;
  }
}

// readWatchContent removed — evidence is now in SQLite via audit_submit tool.
// Legacy hooks read from tool_input.content, not from file.

/**
 * Build resume actions for interrupted audit cycles.
 * Returns an array of action descriptions (strings) and context lines.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.adapterDir
 * @param {object} params.cfg — parsed config.json
 * @param {string} [params.handoffContent] — session handoff file content
 * @returns {{ resumeActions: string[], contextLines: string[] }}
 */
export function buildResumeState({ repoRoot, adapterDir, cfg, handoffContent = "" }) {
  const resumeActions = [];
  const contextLines = [];
  const c = cfg.consensus ?? {};
  const triggerTag = c.trigger_tag ?? "[REVIEW_NEEDED]";
  const agreeTag = c.agree_tag ?? "[APPROVED]";
  const pendingTag = c.pending_tag ?? "[CHANGES_REQUESTED]";
  // 1. Audit status from marker (SQLite audit-status.json)
  const auditStatus = readAuditStatus(repoRoot);
  const isPending = auditStatus?.status === AUDIT_STATUS.CHANGES_REQUESTED;
  const isApproved = auditStatus?.status === AUDIT_STATUS.APPROVED;

  if (isPending) {
    const rejectionCodes = auditStatus.rejectionCodes ?? [];
    const codes = rejectionCodes.length > 0 ? `\n  Rejection codes: ${rejectionCodes.join(", ")}` : "";
    resumeActions.push(t("resume.pending_corrections", { tag: pendingTag, codes, file: "audit_submit", triggerTag }));
  } else if (auditStatus && !isPending && !isApproved) {
    resumeActions.push(t("resume.no_audit_result", { tag: triggerTag }));
  } else if (isApproved) {
    contextLines.push(t("resume.approved_status", { tag: agreeTag }));
  }

  // 3. Retro marker
  const retroMarker = readRetroMarker(adapterDir);
  if (retroMarker?.retro_pending) {
    if (retroMarker.deferred_to_orchestrator) {
      resumeActions.push(
        t("resume.retro_deferred", { id: retroMarker.rx_id ?? "unknown" })
        + (retroMarker.agreed_items ? `\n  Agreed items:\n${retroMarker.agreed_items}` : "")
      );
    } else {
      resumeActions.push(t("resume.retro_pending", { id: retroMarker.rx_id ?? "unknown" }));
    }
  }

  // 4. Active orchestrator tasks from handoff
  if (handoffContent) {
    const taskBlocks = handoffContent.split(/(?=^### \[)/m);
    const activeTasks = [];
    for (const block of taskBlocks) {
      const titleMatch = block.match(/^### \[([^\]]+)\]\s*(.+)/m);
      if (!titleMatch) continue;
      const statusMatch = block.match(/\*\*(?:상태|status)\*\*:\s*(.+)/i);
      if (!statusMatch) continue;
      const status = statusMatch[1].trim();
      if (/진행\s*중|in.?progress/i.test(status)) {
        activeTasks.push({ id: titleMatch[1], title: titleMatch[2].trim(), status });
      }
    }
    if (activeTasks.length > 0) {
      const taskList = activeTasks.map((tk) => `  - [${tk.id}] ${tk.title}`).join("\n");
      resumeActions.push(t("resume.active_tasks", { count: activeTasks.length, list: taskList }));
    }
  }

  return { resumeActions, contextLines };
}

/**
 * Build status signals for prompt injection (used by UserPromptSubmit-equivalent hooks).
 * Returns an array of signal strings — empty array means no active state.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.adapterDir
 * @param {object} params.cfg
 * @returns {string[]}
 */
export function buildStatusSignals({ repoRoot, adapterDir, cfg }) {
  const signals = [];
  const c = cfg.consensus ?? {};
  const triggerTag = c.trigger_tag ?? "[REVIEW_NEEDED]";
  const agreeTag = c.agree_tag ?? "[APPROVED]";
  const pendingTag = c.pending_tag ?? "[CHANGES_REQUESTED]";
  // 1. Retro pending
  const retroMarker = readRetroMarker(adapterDir);
  if (retroMarker?.retro_pending) {
    signals.push(t("signal.retro_pending"));
  }

  // 2. Audit status from marker (SQLite audit-status.json)
  const auditStatus = readAuditStatus(repoRoot);
  const isPending = auditStatus?.status === AUDIT_STATUS.CHANGES_REQUESTED;
  const isApproved = auditStatus?.status === AUDIT_STATUS.APPROVED;

  if (isPending) {
    const codeCount = auditStatus.rejectionCodes?.length ?? 0;
    signals.push(t("signal.pending_corrections", { tag: pendingTag, count: codeCount }));
  } else if (auditStatus && !isPending && !isApproved) {
    signals.push(t("signal.submitted_waiting", { tag: triggerTag }));
  } else if (isApproved) {
    signals.push(t("signal.approved", { tag: agreeTag }));
  }

  return signals;
}
