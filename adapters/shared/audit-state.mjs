/**
 * Shared audit state reader — reads audit status, retro marker, audit lock.
 *
 * Deduplicates state reading logic from session-start.mjs (L124-262)
 * and prompt-submit.mjs (L52-109). Returns pure data — no stdout writes.
 */

import { readFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Read audit-status.json marker.
 *
 * @param {string} repoRoot — absolute path to repo root
 * @returns {object|null} Parsed audit status or null
 */
export function readAuditStatus(repoRoot) {
  const p = resolve(repoRoot, ".claude", "audit-status.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
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
  const p = resolve(adapterDir, ".session-state", "retro-marker.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Check audit.lock status — is an audit process currently running?
 *
 * @param {string} repoRoot — absolute path to repo root
 * @returns {{ exists: boolean, alive: boolean, pid?: number, ageMin?: number, cleaned?: boolean }}
 */
export function checkAuditLock(repoRoot) {
  const lockPath = resolve(repoRoot, ".claude", "audit.lock");
  if (!existsSync(lockPath)) return { exists: false, alive: false };

  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const ageMin = Math.round((Date.now() - (lock.startedAt ?? 0)) / 60000);

    let alive = false;
    if (lock.pid) {
      try { process.kill(lock.pid, 0); alive = true; } catch { /* dead */ }
    }

    if (!alive) {
      // Stale lock — clean up
      rmSync(lockPath, { force: true });
      return { exists: true, alive: false, pid: lock.pid, ageMin, cleaned: true };
    }

    return { exists: true, alive: true, pid: lock.pid, ageMin };
  } catch {
    // Corrupt lock file — clean up
    rmSync(lockPath, { force: true });
    return { exists: true, alive: false, cleaned: true };
  }
}

/**
 * Read watch_file content.
 *
 * @param {string} repoRoot — absolute path to repo root
 * @param {string} watchFile — relative path (e.g. "docs/feedback/claude.md")
 * @returns {string} File content or empty string
 */
export function readWatchContent(repoRoot, watchFile) {
  const p = resolve(repoRoot, watchFile);
  if (!existsSync(p)) return "";
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

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
  const triggerTag = c.trigger_tag ?? "[GPT미검증]";
  const agreeTag = c.agree_tag ?? "[합의완료]";
  const pendingTag = c.pending_tag ?? "[계류]";
  const watchFile = c.watch_file ?? "docs/feedback/claude.md";

  // 1. Audit lock check
  const lockState = checkAuditLock(repoRoot);
  if (lockState.exists) {
    if (lockState.cleaned) {
      resumeActions.push(
        `감사 프로세스(PID ${lockState.pid ?? "?"})가 ${lockState.ageMin ?? "?"}분 전 시작 후 종료됨. audit.lock 자동 정리 완료.`
        + `\n  → watch_file의 ${triggerTag} 상태를 확인하고 필요 시 증거를 재제출하세요.`
      );
    } else if (lockState.alive) {
      contextLines.push(`Background audit in progress (PID ${lockState.pid}, ${lockState.ageMin}min ago)`);
    }
  }

  // 2. Audit status from marker
  const watchContent = readWatchContent(repoRoot, watchFile);
  const auditStatus = readAuditStatus(repoRoot);
  const hasTrigger = watchContent.includes(triggerTag);
  const isPending = auditStatus?.status === "changes_requested";
  const isApproved = auditStatus?.status === "approved";

  if (isPending && hasTrigger) {
    const rejectionCodes = auditStatus.rejectionCodes ?? [];
    resumeActions.push(
      `${pendingTag} 보정이 필요합니다.`
      + (rejectionCodes.length > 0 ? `\n  반려 코드: ${rejectionCodes.join(", ")}` : "")
      + `\n  → 감사 결과를 확인하고 코드를 수정한 뒤 증거를 재제출하세요.`
      + `\n  → 파일: ${watchFile} (${triggerTag} 유지)`
    );
  } else if (hasTrigger && !isPending && !isApproved && !lockState.alive) {
    resumeActions.push(
      `${triggerTag} 증거가 제출되었으나 감사 결과가 없습니다.`
      + `\n  → 감사가 실행되지 않았거나 실패했을 수 있습니다. 증거를 재제출하세요.`
    );
  } else if (isApproved && !hasTrigger) {
    contextLines.push(`Current audit status: ${agreeTag} — 합의 완료 상태`);
  }

  // 3. Retro marker
  const retroMarker = readRetroMarker(adapterDir);
  if (retroMarker?.retro_pending) {
    if (retroMarker.deferred_to_orchestrator) {
      resumeActions.push(
        `서브에이전트 회고가 orchestrator에 위임됨 (${retroMarker.rx_id ?? "unknown"}).`
        + `\n  → 즉시 회고를 시작하세요:`
        + `\n    1. 잘된 것 / 문제인 것 / 개선할 것`
        + `\n    2. 사용자와 피드백 교환`
        + `\n    3. 메모리에 원칙 기록`
        + `\n    4. echo session-self-improvement-complete`
        + (retroMarker.agreed_items ? `\n  합의된 항목:\n${retroMarker.agreed_items}` : "")
      );
    } else {
      resumeActions.push(
        `회고가 미완료 (${retroMarker.rx_id ?? "unknown"}). session-gate가 Bash/Agent를 차단합니다.`
        + `\n  → 즉시 회고를 진행한 뒤 echo session-self-improvement-complete`
      );
    }
  }

  // 4. Active orchestrator tasks from handoff
  if (handoffContent) {
    const taskBlocks = handoffContent.split(/(?=^### \[)/m);
    const activeTasks = [];
    for (const block of taskBlocks) {
      const titleMatch = block.match(/^### \[([^\]]+)\]\s*(.+)/m);
      if (!titleMatch) continue;
      const statusMatch = block.match(/\*\*상태\*\*:\s*(.+)/);
      if (!statusMatch) continue;
      const status = statusMatch[1].trim();
      if (/진행\s*중|in.?progress/i.test(status)) {
        activeTasks.push({ id: titleMatch[1], title: titleMatch[2].trim(), status });
      }
    }
    if (activeTasks.length > 0) {
      const taskList = activeTasks.map((t) => `  - [${t.id}] ${t.title}`).join("\n");
      resumeActions.push(
        `이전 세션에서 ${activeTasks.length}개 작업이 진행 중이었습니다:`
        + `\n${taskList}`
        + `\n  → /quorum:orchestrator 로 미완료 트랙을 이어서 진행하세요.`
      );
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
  const triggerTag = c.trigger_tag ?? "[GPT미검증]";
  const agreeTag = c.agree_tag ?? "[합의완료]";
  const pendingTag = c.pending_tag ?? "[계류]";
  const watchFile = c.watch_file ?? "docs/feedback/claude.md";

  // 1. Retro pending
  const retroMarker = readRetroMarker(adapterDir);
  if (retroMarker?.retro_pending) {
    signals.push("회고 미완료 — Bash/Agent 차단 중. `echo session-self-improvement-complete` 로 해제");
  }

  // 2. Audit lock
  const lockState = checkAuditLock(repoRoot);
  if (lockState.alive) {
    signals.push(`감사 진행 중 (PID ${lockState.pid}, ${lockState.ageMin}분 경과) — 커밋 대기`);
  }

  // 3. Audit status
  const watchContent = readWatchContent(repoRoot, watchFile);
  const auditStatus = readAuditStatus(repoRoot);
  const hasTrigger = watchContent.includes(triggerTag);
  const isPending = auditStatus?.status === "changes_requested";
  const isApproved = auditStatus?.status === "approved";

  if (isPending && hasTrigger) {
    const codeCount = auditStatus.rejectionCodes?.length ?? 0;
    signals.push(`${pendingTag} 보정 필요 (반려 ${codeCount}건) — 감사 결과 확인 후 수정 & 재제출`);
  } else if (hasTrigger && !isPending && !isApproved && !lockState.alive) {
    signals.push(`${triggerTag} 제출됨 — 감사 대기 중`);
  } else if (isApproved && !hasTrigger) {
    signals.push(`${agreeTag} — 커밋 가능`);
  }

  return signals;
}
