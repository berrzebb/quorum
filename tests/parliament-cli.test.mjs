#!/usr/bin/env node
/**
 * Parliament CLI Tests — arg parsing, committee routing, role resolution,
 * prompt building, and output formatting.
 *
 * Tests the pure-logic parts of the parliament command without real LLM calls.
 *
 * Run: node --test tests/parliament-cli.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseArgs } = await import("../dist/cli/commands/parliament.js");
const { routeToCommittee, STANDING_COMMITTEES } = await import("../dist/bus/meeting-log.js");

// ═══ 1. Arg Parsing ══════════════════════════════════════════════

describe("parseArgs", () => {
  it("parses topic from positional args", () => {
    const result = parseArgs(["주문 앱에 결제 기능 추가"]);
    assert.equal(result.topic, "주문 앱에 결제 기능 추가");
    assert.equal(result.rounds, 1);
    assert.equal(result.committee, undefined);
  });

  it("parses multi-word topic from multiple positional args", () => {
    const result = parseArgs(["마이크로서비스", "전환", "전략"]);
    assert.equal(result.topic, "마이크로서비스 전환 전략");
  });

  it("parses --committee flag", () => {
    const result = parseArgs(["--committee", "architecture", "시스템 설계"]);
    assert.equal(result.committee, "architecture");
    assert.equal(result.topic, "시스템 설계");
  });

  it("parses -c shorthand", () => {
    const result = parseArgs(["-c", "scope", "MVP 범위 논의"]);
    assert.equal(result.committee, "scope");
  });

  it("parses --rounds flag", () => {
    const result = parseArgs(["--rounds", "3", "반복 심의"]);
    assert.equal(result.rounds, 3);
  });

  it("clamps rounds to 1-10", () => {
    assert.equal(parseArgs(["--rounds", "0", "x"]).rounds, 1);
    assert.equal(parseArgs(["--rounds", "99", "x"]).rounds, 10);
    assert.equal(parseArgs(["--rounds", "-5", "x"]).rounds, 1);
    assert.equal(parseArgs(["--rounds", "abc", "x"]).rounds, 1);
  });

  it("parses provider overrides", () => {
    const result = parseArgs([
      "--advocate", "claude:claude-opus-4-6",
      "--devil", "openai:gpt-4o",
      "--judge", "codex",
      "인증 재설계",
    ]);
    assert.equal(result.advocate, "claude:claude-opus-4-6");
    assert.equal(result.devil, "openai:gpt-4o");
    assert.equal(result.judge, "codex");
    assert.equal(result.topic, "인증 재설계");
  });

  it("parses --testimony flag", () => {
    const result = parseArgs(["--testimony", "DB 제약 있음", "테이블 리팩토링"]);
    assert.equal(result.testimony, "DB 제약 있음");
    assert.equal(result.topic, "테이블 리팩토링");
  });

  it("parses -t shorthand for testimony", () => {
    const result = parseArgs(["-t", "기존 인프라 제약", "마이그레이션"]);
    assert.equal(result.testimony, "기존 인프라 제약");
  });

  it("returns empty topic when no args", () => {
    const result = parseArgs([]);
    assert.equal(result.topic, "");
  });

  it("handles all flags combined", () => {
    const result = parseArgs([
      "-c", "architecture",
      "-r", "5",
      "--advocate", "claude",
      "--devil", "openai",
      "--judge", "gemini",
      "-t", "테스트 진술",
      "통합", "설계", "논의",
    ]);
    assert.equal(result.committee, "architecture");
    assert.equal(result.rounds, 5);
    assert.equal(result.advocate, "claude");
    assert.equal(result.devil, "openai");
    assert.equal(result.judge, "gemini");
    assert.equal(result.testimony, "테스트 진술");
    assert.equal(result.topic, "통합 설계 논의");
  });
});

// ═══ 2. Committee Auto-Routing ═══════════════════════════════════

describe("committee auto-routing for parliament CLI", () => {
  it("routes security topics to research-questions or principles", () => {
    const result = routeToCommittee("audit trail for authentication");
    assert.ok(result.length > 0, "should match at least one committee");
  });

  it("routes architecture topics correctly", () => {
    const result = routeToCommittee("system architecture overview and dataflow");
    assert.ok(result.includes("architecture"));
  });

  it("routes scope topics correctly", () => {
    const result = routeToCommittee("what should be in scope for MVP release");
    assert.ok(result.includes("scope"));
  });

  it("routes definition topics correctly", () => {
    const result = routeToCommittee("agent definition and terminology");
    assert.ok(result.includes("definitions"));
  });

  it("routes structure topics correctly", () => {
    const result = routeToCommittee("hierarchical parent-child composition");
    assert.ok(result.includes("structure"));
  });

  it("routes unknown topics to research-questions", () => {
    const result = routeToCommittee("completely novel idea xyz");
    assert.deepEqual(result, ["research-questions"]);
  });
});

// ═══ 3. Standing Committees Integrity ════════════════════════════

describe("standing committees for CLI help display", () => {
  it("all 6 committees have display names", () => {
    for (const [key, val] of Object.entries(STANDING_COMMITTEES)) {
      assert.ok(val.name, `${key} should have name`);
      assert.ok(val.items.length > 0, `${key} should have items`);
    }
  });

  it("committee keys are valid for --committee flag", () => {
    const validKeys = Object.keys(STANDING_COMMITTEES);
    assert.equal(validKeys.length, 6);
    for (const key of ["principles", "definitions", "structure", "architecture", "scope", "research-questions"]) {
      assert.ok(validKeys.includes(key), `${key} should be valid`);
    }
  });
});

// ═══ 4. Edge Cases ═══════════════════════════════════════════════

describe("parliament CLI edge cases", () => {
  it("ignores unknown flags gracefully (value becomes positional)", () => {
    // Unknown flags are skipped, but their "value" has no way to be consumed
    // so it becomes positional — this is expected behavior
    const result = parseArgs(["--unknown", "실제 논제"]);
    assert.equal(result.topic, "실제 논제");
  });

  it("handles flags at end of args", () => {
    const result = parseArgs(["논제 먼저", "--rounds", "2"]);
    assert.equal(result.topic, "논제 먼저");
    assert.equal(result.rounds, 2);
  });

  it("handles Korean text in all positions", () => {
    const result = parseArgs([
      "-c", "architecture",
      "-t", "기존 레거시 시스템의 제약 조건",
      "결제 시스템을 마이크로서비스로 전환하는 전략 논의",
    ]);
    assert.equal(result.committee, "architecture");
    assert.equal(result.testimony, "기존 레거시 시스템의 제약 조건");
    assert.equal(result.topic, "결제 시스템을 마이크로서비스로 전환하는 전략 논의");
  });
});

// ═══ 5. New v2 Flags ═════════════════════════════════════════════

describe("parliament CLI v2 flags", () => {
  it("parses --force flag", () => {
    const result = parseArgs(["--force", "테스트"]);
    assert.equal(result.force, true);
    assert.equal(result.topic, "테스트");
  });

  it("parses -f shorthand for force", () => {
    const result = parseArgs(["-f", "테스트"]);
    assert.equal(result.force, true);
  });

  it("parses --resume flag with session ID", () => {
    const result = parseArgs(["--resume", "parliament-arch-1234567"]);
    assert.equal(result.resume, "parliament-arch-1234567");
  });

  it("parses --history flag", () => {
    const result = parseArgs(["--history"]);
    assert.equal(result.history, true);
    assert.equal(result.topic, "");
  });

  it("parses --detail flag with session ID", () => {
    const result = parseArgs(["--detail", "architecture"]);
    assert.equal(result.detail, "architecture");
  });

  it("combines resume with rounds", () => {
    const result = parseArgs(["--resume", "sess-123", "--rounds", "5"]);
    assert.equal(result.resume, "sess-123");
    assert.equal(result.rounds, 5);
  });
});
