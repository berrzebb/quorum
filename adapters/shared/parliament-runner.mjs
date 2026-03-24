/**
 * Run parliament session if enabled in config.
 * Extracted from 3 adapter hooks to eliminate copy-paste.
 *
 * @param {object} bridge - core/bridge.mjs module
 * @param {object} cfg - full config object
 * @param {string} content - watch file content (evidence)
 * @param {string} watchPath - absolute path to watch file
 * @param {string} source - provider name ("claude-code" | "codex" | "gemini")
 * @param {string} [sessionId] - optional session ID for event metadata
 * @param {function} [log] - optional logger function
 * @returns {Promise<object|null>} parliament session result or null
 */
export async function runParliamentIfEnabled(bridge, cfg, content, watchPath, source, sessionId, log) {
  if (!cfg.parliament?.enabled) return null;

  const consensus = cfg.consensus ?? {};
  const parliamentCfg = {
    agendaId: cfg.parliament?.defaultAgenda ?? "research-questions",
    sessionType: new Date().getHours() < 12 ? "morning" : "afternoon",
    consensus: consensus.roles ?? {},
    eligibleVoters: cfg.parliament?.eligibleVoters ?? 3,
    implementerTestimony: cfg.parliament?.testimony,
    confluenceInput: { auditVerdict: undefined },
  };

  try {
    const sessionResult = await bridge.runParliamentSession(
      { prompt: content, evidence: watchPath },
      parliamentCfg,
    );

    if (sessionResult?.verdict?.finalVerdict) {
      if (log) log(`PARLIAMENT: verdict=${sessionResult.verdict.finalVerdict} converged=${sessionResult.convergence?.converged ?? false}`);
      bridge.emitEvent("audit.verdict", source, {
        verdict: sessionResult.verdict.finalVerdict,
        summary: sessionResult.verdict.judgeSummary,
        codes: sessionResult.verdict.opinions?.flatMap(o => o.codes) ?? [],
        mode: "parliament",
      }, sessionId ? { sessionId } : {});
    }

    return sessionResult;
  } catch (err) {
    // Fail-open: parliament errors don't block the audit flow
    if (log) log(`PARLIAMENT_ERROR: ${err.message}`);
    return null;
  }
}
