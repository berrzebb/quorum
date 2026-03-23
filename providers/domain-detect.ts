/**
 * Domain Detection — deterministic analysis of changed files and diffs.
 *
 * Detects which quality domains are affected by a change set.
 * Zero-cost (no LLM calls) — uses file path patterns and diff content matching.
 *
 * The detected domains drive conditional activation of specialist reviewers
 * via the DomainRouter, ensuring only relevant reviewers are invoked.
 */

// ── Domain flags ─────────────────────────────

export interface DetectedDomains {
  /** DB queries, bundle size, loop complexity, heavy computation. */
  performance: boolean;
  /** Schema changes, migration files, backward-incompatible API changes. */
  migration: boolean;
  /** JSX/TSX with aria-*, role=, WCAG-related patterns. */
  accessibility: boolean;
  /** License files, PII handling, GDPR/regulatory patterns. */
  compliance: boolean;
  /** Logging, metrics, tracing, error reporting code. */
  observability: boolean;
  /** README, CHANGELOG, JSDoc, API docs, markdown. */
  documentation: boolean;
  /** Shared state, async coordination, locks, workers. */
  concurrency: boolean;
  /** Locale files, translation keys, i18n utilities. */
  i18n: boolean;
  /** Dockerfile, CI/CD, K8s manifests, env config. */
  infrastructure: boolean;
}

export interface DomainDetectionResult {
  domains: DetectedDomains;
  /** Which domains were detected and why. */
  reasons: Map<keyof DetectedDomains, string[]>;
  /** Count of active domains. */
  activeCount: number;
}

// ── Path patterns ────────────────────────────

const PATH_PATTERNS: Record<keyof DetectedDomains, RegExp[]> = {
  performance: [
    /query|repository|\.sql$/i,
    /cache|redis|memcache/i,
    /bundle|webpack|vite\.config|rollup/i,
    /worker|pool|queue/i,
  ],
  migration: [
    /migrat/i,
    /schema\.(ts|js|sql|prisma)$/i,
    /\.sql$/i,
    /prisma\/.*\.prisma$/i,
    /drizzle|knex|typeorm/i,
  ],
  accessibility: [
    /\.(tsx|jsx)$/,
    /a11y|accessibility|wcag/i,
    /components?\//i,
  ],
  compliance: [
    /license/i,
    /privacy|gdpr|compliance|policy/i,
    /terms/i,
  ],
  observability: [
    /log(ger|ging)?[\./]/i,
    /metric|monitor|trace|telemetry|sentry|datadog/i,
    /instrument/i,
  ],
  documentation: [
    /README|CHANGELOG|CONTRIBUTING|docs?\//i,
    /\.mdx?$/,
    /swagger|openapi/i,
    /jsdoc|typedoc/i,
  ],
  concurrency: [
    /worker|thread|pool|queue|mutex|lock/i,
    /concurrent|parallel|atomic/i,
    /pubsub|event-?bus|message/i,
  ],
  i18n: [
    /locale|i18n|l10n|messages?\./i,
    /translations?\//i,
    /intl/i,
  ],
  infrastructure: [
    /Dockerfile|docker-compose/i,
    /\.ya?ml$/,
    /\.github\//,
    /k8s|kubernetes|helm/i,
    /terraform|pulumi|cdk/i,
    /nginx|caddy|\.conf$/i,
    /\.env(\.|$)/i,
  ],
};

// ── Content patterns ─────────────────────────

const CONTENT_PATTERNS: Record<keyof DetectedDomains, RegExp[]> = {
  performance: [
    /SELECT\s.+FROM|INSERT\s+INTO|JOIN\s/i,
    /\.findMany|\.aggregate|\.groupBy/,
    /new\s+Map\s*\(|new\s+Set\s*\(/,
    /for\s*\(.*;.*<\s*\w+\.length/,
    /O\(n[\s²³]|O\(n\s*\*\s*n/i,
    /lazy|chunk|split|paginate|batch/i,
    /memo(ize)?|useMemo|useCallback/,
    /index|INDEX|CREATE\s+INDEX/i,
  ],
  migration: [
    /ALTER\s+TABLE|DROP\s+(TABLE|COLUMN)|ADD\s+COLUMN/i,
    /createTable|dropTable|addColumn|removeColumn/,
    /migration|migrate/i,
    /schema\.(create|drop|alter)/i,
  ],
  accessibility: [
    /aria-[\w-]+\s*=/,
    /role\s*=\s*["']/,
    /tabIndex|tabindex/i,
    /<(img|input|button|a)\s/i,
    /alt\s*=\s*["']/,
    /sr-only|visually-?hidden|screen-?reader/i,
    /focus(Trap|Ring|Visible|Within)/i,
  ],
  compliance: [
    /license|LICENSE|SPDX/i,
    /personal\s*data|PII|GDPR|CCPA|HIPAA/i,
    /encrypt|hash|mask|redact|anonymize/i,
    /consent|opt[_-]?(in|out)|cookie/i,
    /data[_-]?retention|TTL|expir/i,
  ],
  observability: [
    /console\.(log|error|warn|info|debug)\s*\(/,
    /logger\.(log|error|warn|info|debug)\s*\(/,
    /\.trace\(|\.span\(|opentelemetry|tracing/i,
    /metrics?\.(inc|dec|observe|record|gauge|counter)/i,
    /sentry\.capture|bugsnag|rollbar/i,
  ],
  documentation: [
    /\/\*\*[\s\S]*?\*\//,
    /@param\s|@returns?\s|@throws\s|@example/,
    /^#+\s/m,
    /swagger|openapi.*spec/i,
  ],
  concurrency: [
    /Promise\.all(Settled)?\s*\(/,
    /new\s+Worker\s*\(/,
    /Mutex|Semaphore|Lock|Barrier/,
    /async\s+(function|.*=>)/,
    /race\s*\(|deadlock|atomic/i,
    /SharedArrayBuffer|Atomics\./,
    /channel\.(send|post)|BroadcastChannel/i,
  ],
  i18n: [
    /\bt\s*\(\s*["'`]/,
    /useTranslation|i18next|intl\.formatMessage/,
    /locale|getLocale|setLocale/i,
    /\{\{\s*\$t\s*\(/,
    /formatNumber|formatDate|formatCurrency/i,
  ],
  infrastructure: [
    /FROM\s+[\w./-]+:\s*[\w.-]+/,
    /EXPOSE\s+\d+|CMD\s+\[/,
    /apiVersion:|kind:\s*(Deployment|Service|Ingress)/,
    /resource:|replicas:|containers:/,
    /env:|secret:|configMap:/i,
  ],
};

// ── Detector ─────────────────────────────────

/**
 * Detect which quality domains are affected by a set of file changes.
 *
 * @param changedFiles - Array of relative file paths that were modified.
 * @param diff - Combined diff content (optional — improves accuracy).
 * @returns Detection result with domains, reasons, and active count.
 */
export function detectDomains(
  changedFiles: string[],
  diff?: string,
): DomainDetectionResult {
  const domains: DetectedDomains = {
    performance: false,
    migration: false,
    accessibility: false,
    compliance: false,
    observability: false,
    documentation: false,
    concurrency: false,
    i18n: false,
    infrastructure: false,
  };

  const reasons = new Map<keyof DetectedDomains, string[]>();

  for (const domain of Object.keys(domains) as (keyof DetectedDomains)[]) {
    const domainReasons: string[] = [];

    // Check file path patterns
    const pathPatterns = PATH_PATTERNS[domain];
    for (const file of changedFiles) {
      for (const pattern of pathPatterns) {
        if (pattern.test(file)) {
          domainReasons.push(`path: ${file}`);
          break; // one match per file is enough
        }
      }
    }

    // Check diff content patterns (if provided)
    if (diff) {
      const contentPatterns = CONTENT_PATTERNS[domain];
      for (const pattern of contentPatterns) {
        if (pattern.test(diff)) {
          domainReasons.push(`content: ${pattern.source.slice(0, 40)}`);
          break; // one content match is enough to flag
        }
      }
    }

    // Accessibility requires BOTH path match (JSX/TSX) and content match
    if (domain === "accessibility") {
      const hasJsx = changedFiles.some(f => /\.(tsx|jsx)$/.test(f));
      const hasA11yContent = diff
        ? CONTENT_PATTERNS.accessibility.some(p => p.test(diff))
        : false;
      if (hasJsx && !hasA11yContent) {
        // JSX file changed but no a11y-related content — skip
        // unless there's an explicit a11y file match
        const hasExplicitA11y = changedFiles.some(f => /a11y|accessibility|wcag/i.test(f));
        if (!hasExplicitA11y) {
          domainReasons.length = 0;
        }
      }
    }

    if (domainReasons.length > 0) {
      domains[domain] = true;
      reasons.set(domain, domainReasons);
    }
  }

  return {
    domains,
    reasons,
    activeCount: Object.values(domains).filter(Boolean).length,
  };
}

/**
 * Get a human-readable summary of detected domains.
 */
export function formatDomainSummary(result: DomainDetectionResult): string {
  if (result.activeCount === 0) return "No specialist domains detected.";

  const lines: string[] = [`${result.activeCount} domain(s) detected:`];
  for (const [domain, domainReasons] of result.reasons) {
    lines.push(`  ${domain}: ${domainReasons[0]}`);
  }
  return lines.join("\n");
}
