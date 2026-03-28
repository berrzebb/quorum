#!/usr/bin/env node
/**
 * Gemini CLI Hook: AfterModel
 *
 * Fires after LLM response (per chunk in streaming mode).
 * Extension point for real-time redaction, PII filtering.
 *
 * Input:  { llm_request, llm_response }
 * Output: { hookSpecificOutput.llm_response?, decision? }
 *
 * Currently a pass-through — no-op.
 */
process.exit(0);
