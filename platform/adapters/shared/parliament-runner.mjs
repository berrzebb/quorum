/**
 * Run parliament session if enabled in config.
 * Extracted from 3 adapter hooks to eliminate copy-paste.
 *
 * NOTE: `cfg.consensus.roles` is a Record<string, string> (e.g. {advocate: "openai"}).
 * `parliament-session.ts` expects `ConsensusConfig` with actual Auditor instances.
 * `bridge.runParliamentSession()` passes the config through to parliament-session unchanged,
 * so the caller MUST supply pre-constructed auditors via `cfg.consensus.auditors` if available,
 * or this will only work in environments where bridge handles auditor creation externally.
 * When roles are plain strings, the session will fail-open at the deliberation phase
 * (parliament-session wraps each phase in try/catch).
 *
 * @param {object} bridge - core/bridge.mjs module
 * @param {object} cfg - full config object
 * @param {string} content - evidence content (from SQLite EventStore)
 * @param {string} source - provider name ("claude-code" | "codex" | "gemini")
 * @param {string} [sessionId] - optional session ID for event metadata
 * @param {function} [log] - optional logger function
 * @returns {Promise<object|null>} parliament session result or null
 */
export async function runParliamentIfEnabled(bridge, cfg, content, source, sessionId, log) {
  if (!cfg.parliament?.enabled) return null;

  const consensus = cfg.consensus ?? {};

  // Build actual Auditor instances. Strings are NOT valid — must be converted.
  let consensusConfig = consensus.auditors; // Pre-built Auditor instances
  if (!consensusConfig || !consensusConfig.advocate?.audit) {
    // Roles are strings (e.g. "claude") — convert to Auditor instances
    if (bridge.createConsensusAuditors) {
      try {
        const roles = cfg.parliament?.roles ?? consensus.roles ?? {};
        consensusConfig = await bridge.createConsensusAuditors(roles);
      } catch (err) {
        if (log) log(`PARLIAMENT: failed to create auditors: ${err.message}`);
        return null; // Strict: cannot proceed without real Auditors
      }
    }
    if (!consensusConfig?.advocate?.audit) {
      if (log) log("PARLIAMENT: no valid auditors — skipping session");
      return null; // Strict: do not pass strings through to parliament-session
    }
  }

  const parliamentCfg = {
    agendaId: cfg.parliament?.defaultAgenda ?? "research-questions",
    sessionType: cfg.parliament?.sessionType ?? (new Date().getHours() < 12 ? "morning" : "afternoon"),
    consensus: consensusConfig,
    eligibleVoters: cfg.parliament?.eligibleVoters ?? 3,
    implementerTestimony: cfg.parliament?.testimony,
  };

  try {
    const sessionResult = await bridge.runParliamentSession(
      { prompt: content, evidence: content, files: [] },
      parliamentCfg,
    );

    if (sessionResult?.verdict?.finalVerdict) {
      if (log) log(`PARLIAMENT: verdict=${sessionResult.verdict.finalVerdict} converged=${sessionResult.convergence?.converged ?? false}`);
      bridge.emitEvent("audit.verdict", source, {
        itemId: `parliament:${sessionId ?? "session"}`,
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
