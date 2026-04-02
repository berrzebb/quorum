/**
 * agent-comm/index.mjs — Tool: agent_comm
 *
 * Agent-to-agent communication via bridge MessageBus.
 * Extracted from tool-core.mjs (SPLIT-4).
 */

// ═══ Lazy bridge import ════════════════════════════════════════════════

let _commBridge = null;
async function _getCommBridge() {
  if (_commBridge) return _commBridge;
  try {
    _commBridge = await import("../../bridge.mjs");
    if (!_commBridge._store) await _commBridge.init(process.cwd());
    return _commBridge;
  } catch (err) { console.warn("[agent-comm] operation failed:", err?.message ?? err); return null; }
}

// ═══ Tool: agent_comm ═══════════════════════════════════════════════════

export async function toolAgentComm(params) {
  const { action, agent_id, to_agent, question, query_id, answer, confidence, context, track_id } = params;

  if (!action) return { error: "action is required: post, respond, poll, responses, roster" };
  if (!agent_id) return { error: "agent_id is required" };

  const bridge = await _getCommBridge();
  if (!bridge) return { error: "Bridge unavailable — agent_comm requires initialized event store" };

  switch (action) {
    case "post": {
      if (!question) return { error: "question is required for post action" };
      const qid = bridge.agent.postAgentQuery(agent_id, question, to_agent || undefined, context);
      if (!qid) return { error: "Failed to post query" };
      return { text: `Query posted: ${qid}${to_agent ? ` \u2192 ${to_agent}` : " (broadcast)"}`, json: { queryId: qid } };
    }
    case "respond": {
      if (!query_id || !answer) return { error: "query_id and answer are required for respond action" };
      bridge.agent.respondToAgentQuery(query_id, agent_id, answer, confidence);
      return { text: `Response posted to ${query_id}`, json: { queryId: query_id, status: "responded" } };
    }
    case "poll": {
      const queries = bridge.agent.pollAgentQueries(agent_id, 0);
      if (queries.length === 0) return { text: "No pending queries.", json: { queries: [] } };
      const lines = queries.map(q => `[${q.queryId}] from ${q.fromAgent}: ${q.question}`);
      return { text: lines.join("\n"), json: { queries }, summary: `${queries.length} pending query(ies)` };
    }
    case "responses": {
      if (!query_id) return { error: "query_id is required for responses action" };
      const responses = bridge.agent.getQueryResponses(query_id);
      if (responses.length === 0) return { text: `No responses yet for ${query_id}`, json: { responses: [] } };
      const lines = responses.map(r => `[${r.fromAgent}] (confidence: ${r.confidence ?? "N/A"}): ${r.answer}`);
      return { text: lines.join("\n"), json: { responses }, summary: `${responses.length} response(s)` };
    }
    case "roster": {
      const roster = bridge.agent.getAgentRoster(track_id);
      if (!roster) return { text: "No active agent roster.", json: { agents: [] } };
      return { text: JSON.stringify(roster, null, 2), json: roster };
    }
    default:
      return { error: `Unknown action: ${action}. Use: post, respond, poll, responses, roster` };
  }
}
