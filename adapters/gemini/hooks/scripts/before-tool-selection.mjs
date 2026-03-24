#!/usr/bin/env node
/**
 * Gemini CLI Hook: BeforeToolSelection
 *
 * Fires before LLM selects tools. Can filter tool availability
 * via toolConfig.allowedFunctionNames.
 *
 * Input:  { llm_request: { model, messages, config, toolConfig } }
 * Output: { hookSpecificOutput.toolConfig? }
 *
 * Currently a pass-through — no-op.
 */
process.exit(0);
