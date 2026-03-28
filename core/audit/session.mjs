/**
 * Facade — delegates to platform/core/audit/session.mjs (canonical location).
 */
export {
  initSessionDir,
  getSessionPath,
  sessionKVKey,
  readSavedSession,
  writeSavedSession,
  deleteSavedSessionId,
} from "../../platform/core/audit/session.mjs";
