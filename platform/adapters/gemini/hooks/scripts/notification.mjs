#!/usr/bin/env node
/**
 * Gemini CLI Hook: Notification
 *
 * Fires on system notifications (e.g., ToolPermission alerts).
 * Observability only — cannot block or modify.
 *
 * Input:  { notification_type, message, details }
 * Output: { systemMessage? }
 *
 * Currently a pass-through — no-op.
 */
process.exit(0);
