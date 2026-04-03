/**
 * Typed Error System — discriminated error union with cause chain walking.
 *
 * Classifies unknown errors into 7 kinds via cause chain walking (max 5 levels).
 * Core invariant: classifyError() NEVER throws — always returns a QuorumError.
 *
 * @module core/errors
 */

// ── Error Kinds ─────────────────────────────────────

/**
 * 7 discriminated error kinds.
 *
 * - transient: temporary failure, retryable (429, ECONNRESET, ETIMEDOUT)
 * - auth: authentication/authorization failure (401, 403)
 * - validation: bad input, never retry (400, 422)
 * - server: remote server error (500+)
 * - resource: local resource issue (ENOENT, EACCES, EMFILE)
 * - sdk: SDK-specific error (AnthropicError, OpenAI API Error)
 * - unknown: unclassifiable (fallback)
 */
export type ErrorKind =
  | "transient"
  | "auth"
  | "validation"
  | "server"
  | "resource"
  | "sdk"
  | "unknown";

// ── QuorumError ─────────────────────────────────────

/**
 * Structured error with classified kind and optional metadata.
 */
export interface QuorumError {
  /** Discriminated error kind. */
  kind: ErrorKind;
  /** Original error (preserved for stack trace). */
  cause: Error;
  /** Error message (from original or synthesized). */
  message: string;
  /** HTTP status code if available. */
  statusCode?: number;
  /** Node.js error code if available (e.g., "ECONNRESET"). */
  code?: string;
  /** User-friendly hint for resolution (e.g., SSL cert guidance). */
  hint?: string;
  /** Retry-After header value in seconds, if present. */
  retryAfter?: number;
}

// ── HTTP Status → Kind Mapping ──────────────────────

const HTTP_STATUS_MAP: Record<number, ErrorKind> = {
  400: "validation",
  401: "auth",
  403: "auth",
  404: "resource",
  408: "transient",
  409: "transient",
  422: "validation",
  429: "transient",
  500: "server",
  502: "server",
  503: "transient",
  504: "transient",
};

/** Map HTTP status code to error kind. 5xx default to server. */
function kindFromStatus(status: number): ErrorKind | null {
  const mapped = HTTP_STATUS_MAP[status];
  if (mapped) return mapped;
  if (status >= 500) return "server";
  return null;
}

// ── Node.js Error Code → Kind Mapping ───────────────

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const RESOURCE_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "EISDIR",
  "ENOTDIR",
  "EROFS",
]);

function kindFromNodeCode(code: string): ErrorKind | null {
  if (TRANSIENT_CODES.has(code)) return "transient";
  if (RESOURCE_CODES.has(code)) return "resource";
  return null;
}

// ── SSL/TLS Error Detection ─────────────────────────

const SSL_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_UNSUPPORTED_PROTOCOL",
  "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_CRL",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "CERT_CHAIN_TOO_LONG",
  "CRL_HAS_EXPIRED",
  "CRL_NOT_YET_VALID",
  "CRL_SIGNATURE_FAILURE",
  "PATH_LENGTH_EXCEEDED",
  "INVALID_PURPOSE",
  "HOSTNAME_MISMATCH",
  "ERR_SSL_CIPHER_OPERATION_FAILED",
  "ERR_TLS_PROTOCOL_VERSION_CONFLICT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_SSL_NO_PROTOCOLS_AVAILABLE",
]);

function detectSSLError(code: string): string | null {
  if (!SSL_ERROR_CODES.has(code)) return null;

  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "Corporate proxy or custom CA detected. Set NODE_EXTRA_CA_CERTS to your CA bundle path.";
  }
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return "Self-signed certificate. For development: NODE_TLS_REJECT_UNAUTHORIZED=0 (not for production).";
  }
  if (code === "CERT_HAS_EXPIRED") {
    return "Server certificate has expired. Contact the server administrator to renew.";
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || code === "HOSTNAME_MISMATCH") {
    return "Certificate hostname mismatch. Verify the server URL is correct.";
  }
  return `SSL/TLS error (${code}). Check your certificate configuration or set NODE_EXTRA_CA_CERTS.`;
}

// ── SDK Error Detection ─────────────────────────────

const SDK_ERROR_NAMES = new Set([
  "AnthropicError",
  "APIError",
  "APIConnectionError",
  "RateLimitError",
  "AuthenticationError",
  "BadRequestError",
  "InternalServerError",
  "NotFoundError",
  "PermissionDeniedError",
  "UnprocessableEntityError",
  // OpenAI
  "OpenAIError",
]);

function isSDKError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name ?? (err as { constructor?: { name?: string } }).constructor?.name ?? "";
  return SDK_ERROR_NAMES.has(name);
}

// ── Cause Chain Walker ──────────────────────────────

interface WalkResult {
  kind: ErrorKind;
  statusCode?: number;
  code?: string;
  hint?: string;
  retryAfter?: number;
}

/**
 * Walk the cause chain up to maxDepth levels, looking for classifiable error info.
 */
function walkCauseChain(err: unknown, maxDepth: number): WalkResult {
  let current: unknown = err;

  for (let depth = 0; depth < maxDepth; depth++) {
    if (!current || typeof current !== "object") break;

    const errObj = current as Record<string, unknown>;

    // 1. HTTP status code
    const status = (errObj.status ?? errObj.statusCode ?? errObj.httpStatusCode) as number | undefined;
    if (typeof status === "number" && status >= 100) {
      const kind = kindFromStatus(status);
      if (kind) {
        // Extract retryAfter from headers if available
        let retryAfter: number | undefined;
        const headers = errObj.headers as Record<string, string> | undefined;
        if (headers) {
          const ra = headers["retry-after"] ?? headers["Retry-After"];
          if (ra) {
            const parsed = Number(ra);
            if (!Number.isNaN(parsed)) retryAfter = parsed;
          }
        }
        // Special: 429 with retryAfter on the error object itself
        if (!retryAfter && typeof errObj.retryAfter === "number") {
          retryAfter = errObj.retryAfter as number;
        }
        return { kind, statusCode: status, retryAfter };
      }
    }

    // 2. Node.js error code
    const code = errObj.code as string | undefined;
    if (typeof code === "string") {
      // SSL/TLS check first
      const sslHint = detectSSLError(code);
      if (sslHint) {
        return { kind: "transient", code, hint: sslHint };
      }

      const kindFromCode = kindFromNodeCode(code);
      if (kindFromCode) {
        return { kind: kindFromCode, code };
      }
    }

    // 3. SDK error detection
    if (isSDKError(current)) {
      // SDK errors often carry status codes too — check if already mapped
      const sdkStatus = status ?? (errObj.status_code as number | undefined);
      if (typeof sdkStatus === "number") {
        const kind = kindFromStatus(sdkStatus);
        if (kind) return { kind, statusCode: sdkStatus, code: code ?? undefined };
      }
      return { kind: "sdk", code: code ?? undefined };
    }

    // 4. Walk to cause
    const cause = errObj.cause;
    if (cause && typeof cause === "object") {
      current = cause;
      continue;
    }

    // No more causes to walk
    break;
  }

  return { kind: "unknown" };
}

// ── classifyError ───────────────────────────────────

/**
 * Classify an unknown error into a structured QuorumError.
 *
 * Core invariant: NEVER throws. Always returns a valid QuorumError.
 * - null/undefined → kind='unknown'
 * - cause chain walked up to 5 levels
 * - Fail-open: classification failure → kind='unknown'
 */
export function classifyError(error: unknown): QuorumError {
  try {
    // Handle null/undefined/primitive
    if (error === null || error === undefined) {
      return {
        kind: "unknown",
        cause: new Error("null or undefined error"),
        message: "Unknown error (null/undefined)",
      };
    }

    if (typeof error === "string") {
      return {
        kind: "unknown",
        cause: new Error(error),
        message: error,
      };
    }

    if (typeof error !== "object") {
      return {
        kind: "unknown",
        cause: new Error(String(error)),
        message: String(error),
      };
    }

    // Walk the cause chain
    const result = walkCauseChain(error, 5);

    // Build the cause Error
    const cause = error instanceof Error
      ? error
      : new Error((error as { message?: string }).message ?? String(error));

    return {
      kind: result.kind,
      cause,
      message: cause.message,
      statusCode: result.statusCode,
      code: result.code,
      hint: result.hint,
      retryAfter: result.retryAfter,
    };
  } catch {
    // Fail-open: classification itself failed
    return {
      kind: "unknown",
      cause: error instanceof Error ? error : new Error(String(error)),
      message: "Error classification failed",
    };
  }
}

// ── isRetryable ─────────────────────────────────────

/** Kinds that should be retried. */
const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set([
  "transient",
  "server",
  "sdk",
  "unknown",
]);

/** Kinds that should NEVER be retried. */
const NEVER_RETRY_KINDS: ReadonlySet<ErrorKind> = new Set([
  "validation",
  "auth",
]);

/**
 * Determine if a QuorumError should be retried.
 *
 * - transient, server, sdk, unknown → retryable
 * - validation, auth → never retry
 * - resource → retryable only for EMFILE/ENFILE (fd exhaustion)
 */
export function isRetryable(err: QuorumError): boolean {
  if (NEVER_RETRY_KINDS.has(err.kind)) return false;
  if (RETRYABLE_KINDS.has(err.kind)) return true;

  // resource: only fd exhaustion is retryable
  if (err.kind === "resource") {
    return err.code === "EMFILE" || err.code === "ENFILE";
  }

  return false;
}
