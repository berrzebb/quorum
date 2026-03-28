#!/usr/bin/env node
/**
 * Gemini CLI Hook: BeforeModel
 *
 * Fires before sending request to LLM. Extension point for
 * request modification or synthetic responses.
 *
 * Input:  { llm_request: { model, messages, config, toolConfig } }
 * Output: { hookSpecificOutput.llm_request?, hookSpecificOutput.llm_response? }
 *
 * Currently a pass-through — no-op.
 */
process.exit(0);
