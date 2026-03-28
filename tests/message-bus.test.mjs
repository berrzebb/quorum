import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const { EventStore } = await import("../dist/platform/bus/store.js");
const { MessageBus } = await import("../dist/platform/bus/message-bus.js");

const TMP = resolve(import.meta.dirname, ".tmp-message-bus");

describe("MessageBus", () => {
  let store;
  let bus;

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    store = new EventStore({ dbPath: resolve(TMP, "test.db") });
    bus = new MessageBus(store);
  });

  afterEach(() => {
    store.close();
    rmSync(TMP, { recursive: true, force: true });
  });

  it("submitFindings stores findings and returns IDs", () => {
    const ids = bus.submitFindings([
      { reviewerId: "code-reviewer", provider: "openai", severity: "major", category: "performance", description: "N+1 query in UserService" },
      { reviewerId: "code-reviewer", provider: "openai", severity: "minor", category: "style", description: "Inconsistent naming" },
    ], "codex", "code-reviewer", "openai");

    assert.equal(ids.length, 2);
    assert.ok(ids[0].startsWith("F-"));
    assert.ok(ids[1].startsWith("F-"));
  });

  it("pollFindings returns findings after timestamp", () => {
    const before = Date.now() - 1;
    bus.submitFindings([
      { reviewerId: "devil", provider: "claude", severity: "critical", category: "security", description: "SQL injection risk" },
    ], "claude-code", "devil", "claude");

    const findings = bus.pollFindings(before);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "critical");
    assert.equal(findings[0].description, "SQL injection risk");
    assert.equal(findings[0].status, "open");
  });

  it("ackFinding marks finding as confirmed or dismissed", () => {
    const ids = bus.submitFindings([
      { reviewerId: "judge", provider: "codex", severity: "major", category: "logic", description: "Off-by-one error" },
      { reviewerId: "judge", provider: "codex", severity: "style", category: "naming", description: "Variable name too short" },
    ], "codex", "judge", "codex");

    bus.ackFinding(ids[0], "fix");
    bus.ackFinding(ids[1], "dismiss");

    const open = bus.getOpenFindings();
    // The first finding was acked as "fix" (confirmed, not dismissed) — still open until resolved
    // The second was dismissed — closed
    assert.equal(open.length, 1);
    assert.equal(open[0].id, ids[0]);
  });

  it("resolveFinding removes finding from open list", () => {
    const ids = bus.submitFindings([
      { reviewerId: "advocate", provider: "openai", severity: "major", category: "perf", description: "Slow query" },
    ], "codex", "advocate", "openai");

    bus.ackFinding(ids[0], "fix");
    bus.resolveFinding(ids[0], "fixed");

    const open = bus.getOpenFindings();
    assert.equal(open.length, 0);
  });

  it("getStats returns correct counts", () => {
    const ids = bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "a", description: "Issue 1" },
      { reviewerId: "r1", provider: "openai", severity: "minor", category: "b", description: "Issue 2" },
      { reviewerId: "r1", provider: "openai", severity: "style", category: "c", description: "Issue 3" },
    ], "codex", "r1", "openai");

    bus.ackFinding(ids[0], "fix");
    bus.ackFinding(ids[1], "dismiss");
    bus.resolveFinding(ids[0], "fixed");

    const stats = bus.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.open, 1);      // ids[2] untouched
    assert.equal(stats.confirmed, 0); // ids[0] was confirmed then resolved → fixed
    assert.equal(stats.dismissed, 1); // ids[1] dismissed
    assert.equal(stats.fixed, 1);     // ids[0] resolved as fixed
  });

  it("multiple reviewers submit findings independently", () => {
    bus.submitFindings([
      { reviewerId: "code-reviewer", provider: "openai", severity: "major", category: "perf", description: "From GPT" },
    ], "codex", "code-reviewer", "openai");

    bus.submitFindings([
      { reviewerId: "quality-reviewer", provider: "claude", severity: "minor", category: "style", description: "From Claude" },
    ], "claude-code", "quality-reviewer", "claude");

    bus.submitFindings([
      { reviewerId: "ux-reviewer", provider: "gemini", severity: "minor", category: "ux", description: "From Gemini" },
    ], "generic", "ux-reviewer", "gemini");

    const open = bus.getOpenFindings();
    assert.equal(open.length, 3);

    const providers = new Set(open.map(f => f.provider));
    assert.ok(providers.has("openai"));
    assert.ok(providers.has("claude"));
    assert.ok(providers.has("gemini"));
  });

  it("findings include file and line when provided", () => {
    bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "perf", description: "N+1", file: "src/user.ts", line: 42 },
    ], "codex", "r1", "openai");

    const findings = bus.pollFindings(0);
    assert.equal(findings[0].file, "src/user.ts");
    assert.equal(findings[0].line, 42);
  });

  // ── detected_by Dedup ───────────────────────

  it("deduplicates findings by file+line+category across reviewers", () => {
    // 3 reviewers independently find the same N+1 issue
    bus.submitFindings([
      { reviewerId: "code-reviewer", provider: "openai", severity: "major", category: "perf", description: "N+1 query in findAll()", file: "src/user.ts", line: 42 },
    ], "codex", "code-reviewer", "openai");

    bus.submitFindings([
      { reviewerId: "quality-reviewer", provider: "claude", severity: "major", category: "perf", description: "N+1 detected", file: "src/user.ts", line: 42 },
    ], "claude-code", "quality-reviewer", "claude");

    bus.submitFindings([
      { reviewerId: "ux-reviewer", provider: "gemini", severity: "critical", category: "perf", description: "Potential N+1", file: "src/user.ts", line: 42 },
    ], "generic", "ux-reviewer", "gemini");

    const open = bus.getOpenFindings();
    // Dedup: 3 findings → 1 merged finding
    assert.equal(open.length, 1);
    assert.deepStrictEqual(open[0].detectedBy.sort(), ["code-reviewer", "quality-reviewer", "ux-reviewer"].sort());
    assert.equal(open[0].consensusScore, 1.0); // 3/3 providers
    // Highest severity wins
    assert.equal(open[0].severity, "critical");
  });

  it("dedup keeps distinct findings separate", () => {
    bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "perf", description: "N+1", file: "src/user.ts", line: 42 },
      { reviewerId: "r1", provider: "openai", severity: "minor", category: "style", description: "Bad name", file: "src/user.ts", line: 10 },
    ], "codex", "r1", "openai");

    bus.submitFindings([
      { reviewerId: "r2", provider: "claude", severity: "major", category: "perf", description: "N+1 query", file: "src/user.ts", line: 42 },
    ], "claude-code", "r2", "claude");

    const open = bus.getOpenFindings();
    // 2 distinct findings: perf@42 (merged) + style@10 (unique)
    assert.equal(open.length, 2);

    const perf = open.find(f => f.category === "perf");
    const style = open.find(f => f.category === "style");
    assert.ok(perf);
    assert.ok(style);
    assert.equal(perf.detectedBy.length, 2);
    assert.equal(style.detectedBy.length, 1);
  });

  // ── Progressive Disclosure (3-layer) ────────

  it("searchFindings returns lightweight summaries with filters", () => {
    bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "perf", description: "N+1", file: "src/user.ts", line: 42 },
      { reviewerId: "r1", provider: "openai", severity: "minor", category: "style", description: "Bad name", file: "src/auth.ts", line: 10 },
      { reviewerId: "r1", provider: "openai", severity: "critical", category: "security", description: "SQL injection", file: "src/auth.ts", line: 20 },
    ], "codex", "r1", "openai");

    // No filter — all findings
    const all = bus.searchFindings();
    assert.equal(all.length, 3);

    // Filter by file
    const authOnly = bus.searchFindings({ file: "src/auth.ts" });
    assert.equal(authOnly.length, 2);

    // Filter by severity
    const criticalOnly = bus.searchFindings({ severity: "critical" });
    assert.equal(criticalOnly.length, 1);
    assert.equal(criticalOnly[0].category, "security");

    // Summary should NOT have description (lightweight)
    assert.ok(!("description" in all[0]));
  });

  it("getFindingContext returns description + nearby findings + timeline", () => {
    const ids = bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "perf", description: "N+1 query", file: "src/user.ts", line: 42 },
      { reviewerId: "r1", provider: "openai", severity: "minor", category: "style", description: "Bad name", file: "src/user.ts", line: 10 },
      { reviewerId: "r1", provider: "openai", severity: "critical", category: "security", description: "Injection", file: "src/auth.ts", line: 5 },
    ], "codex", "r1", "openai");

    bus.ackFinding(ids[0], "fix");

    const ctx = bus.getFindingContext(ids[0]);
    assert.ok(ctx);
    assert.equal(ctx.description, "N+1 query");
    assert.equal(ctx.provider, "openai");
    // Nearby: other findings in the same file (src/user.ts)
    assert.equal(ctx.nearbyFindings.length, 1);
    assert.equal(ctx.nearbyFindings[0].category, "style");
    // Timeline: should have the ack event
    assert.equal(ctx.timeline.length, 1);
    assert.ok(ctx.timeline[0].action.startsWith("ack:"));
  });

  it("getFindingDetail returns suggestion + per-reviewer breakdown", () => {
    bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "perf", description: "N+1 from GPT", file: "src/user.ts", line: 42, suggestion: "Use eager loading" },
    ], "codex", "r1", "openai");

    bus.submitFindings([
      { reviewerId: "r2", provider: "claude", severity: "major", category: "perf", description: "N+1 from Claude", file: "src/user.ts", line: 42 },
    ], "claude-code", "r2", "claude");

    const open = bus.getOpenFindings();
    assert.equal(open.length, 1); // deduped

    const detail = bus.getFindingDetail(open[0].id);
    assert.ok(detail);
    assert.equal(detail.suggestion, "Use eager loading");
    // Both reviewers should appear in breakdown
    assert.equal(detail.reviewerDetails.length, 2);
    const reviewerNames = detail.reviewerDetails.map(r => r.reviewerId).sort();
    assert.deepStrictEqual(reviewerNames, ["r1", "r2"]);
  });

  it("getFindingContext returns null for unknown ID", () => {
    assert.equal(bus.getFindingContext("F-nonexistent"), null);
  });

  it("getFindingDetail returns null for unknown ID", () => {
    assert.equal(bus.getFindingDetail("F-nonexistent"), null);
  });

  // ── Conversation Threading ──────────────────

  it("replyToFinding creates a linked reply finding", () => {
    const ids = bus.submitFindings([
      { reviewerId: "code-reviewer", provider: "openai", severity: "major", category: "perf", description: "N+1 query", file: "src/user.ts", line: 42 },
    ], "codex", "code-reviewer", "openai");

    const replyId = bus.replyToFinding(
      ids[0],
      { reviewerId: "quality-reviewer", provider: "claude", severity: "major", category: "perf", description: "Confirmed, suggest eager loading", file: "src/user.ts", line: 42 },
      "claude-code", "quality-reviewer", "claude",
    );

    assert.ok(replyId.startsWith("F-"));
    assert.notEqual(replyId, ids[0]);

    // Reply should NOT appear in deduped open findings (replies excluded from dedup)
    const open = bus.getOpenFindings();
    assert.equal(open.length, 1);
    assert.equal(open[0].id, ids[0]);
  });

  it("getThread returns root + replies + timeline", () => {
    const ids = bus.submitFindings([
      { reviewerId: "advocate", provider: "openai", severity: "major", category: "security", description: "SQL injection risk", file: "src/auth.ts", line: 15 },
    ], "codex", "advocate", "openai");

    const replyId = bus.replyToFinding(
      ids[0],
      { reviewerId: "devil", provider: "claude", severity: "critical", category: "security", description: "Confirmed critical — needs parameterized queries", file: "src/auth.ts", line: 15 },
      "claude-code", "devil", "claude",
    );

    bus.ackFinding(ids[0], "fix", "claude-code", "Will use parameterized queries");

    const thread = bus.getThread(ids[0]);
    assert.ok(thread);
    assert.equal(thread.root.id, ids[0]);
    assert.equal(thread.replies.length, 1);
    assert.equal(thread.replies[0].id, replyId);
    assert.equal(thread.replies[0].replyTo, ids[0]);

    // Timeline should have: detect, reply, ack
    assert.ok(thread.timeline.length >= 3);
    const actions = thread.timeline.map(t => t.action);
    assert.ok(actions.includes("detect"));
    assert.ok(actions.includes("reply"));
    assert.ok(actions.some(a => a.startsWith("ack:")));
  });

  it("getThread walks up replyTo chain to find root", () => {
    const ids = bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "logic", description: "Root finding", file: "src/app.ts", line: 1 },
    ], "codex", "r1", "openai");

    const reply1 = bus.replyToFinding(
      ids[0],
      { reviewerId: "r2", provider: "claude", severity: "major", category: "logic", description: "Reply 1", file: "src/app.ts", line: 1 },
      "claude-code", "r2", "claude",
    );

    const reply2 = bus.replyToFinding(
      reply1,
      { reviewerId: "r3", provider: "gemini", severity: "major", category: "logic", description: "Reply to reply", file: "src/app.ts", line: 1 },
      "generic", "r3", "gemini",
    );

    // getThread from deepest reply should still find root
    const thread = bus.getThread(reply2);
    assert.ok(thread);
    assert.equal(thread.root.id, ids[0]);
    assert.equal(thread.replies.length, 2);
  });

  it("getThreadsByFile groups threads by file", () => {
    bus.submitFindings([
      { reviewerId: "r1", provider: "openai", severity: "major", category: "perf", description: "Issue in user.ts", file: "src/user.ts", line: 10 },
      { reviewerId: "r1", provider: "openai", severity: "minor", category: "style", description: "Issue in auth.ts", file: "src/auth.ts", line: 5 },
    ], "codex", "r1", "openai");

    bus.submitFindings([
      { reviewerId: "r2", provider: "claude", severity: "major", category: "security", description: "Another auth issue", file: "src/auth.ts", line: 20 },
    ], "claude-code", "r2", "claude");

    const byFile = bus.getThreadsByFile();
    assert.ok(byFile.has("src/user.ts"));
    assert.ok(byFile.has("src/auth.ts"));
    assert.equal(byFile.get("src/user.ts").length, 1);
    assert.equal(byFile.get("src/auth.ts").length, 2);
  });

  it("getThread returns null for unknown ID", () => {
    assert.equal(bus.getThread("F-nonexistent"), null);
  });
});
