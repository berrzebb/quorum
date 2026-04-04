/**
 * Tests: Setup Interview (SETUP WB-3 + WB-4)
 * buildInterviewQuestions + processAnswers + composeHarness.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInterviewQuestions,
  processAnswers,
  composeHarness,
  getActiveQuestions,
} from "../platform/adapters/shared/setup-interview.mjs";

/** Minimal project profile for testing. */
const emptyProfile = {
  languages: [], packageManager: null, frameworks: [],
  ci: null, testFramework: null, activeDomains: [], estimatedSize: "small",
};

const richProfile = {
  languages: ["typescript"], packageManager: "npm", frameworks: ["react", "express"],
  ci: "github-actions", testFramework: "vitest",
  activeDomains: ["security", "i18n"], estimatedSize: "medium",
};

describe("buildInterviewQuestions", () => {
  it("returns 5 questions", () => {
    const qs = buildInterviewQuestions(emptyProfile);
    assert.equal(qs.length, 5);
  });

  it("Q1-Q3 are never skipped", () => {
    const qs = buildInterviewQuestions(richProfile);
    assert.equal(qs[0].skipped, false); // goal
    assert.equal(qs[1].skipped, false); // priority
    assert.equal(qs[2].skipped, false); // teamSize
  });

  it("Q4 (CI) is skipped when scanner detected CI", () => {
    const qs = buildInterviewQuestions(richProfile);
    const ciQ = qs.find(q => q.id === "ci");
    assert.equal(ciQ.skipped, true);
    assert.equal(ciQ.prefilledValue, "github-actions");
  });

  it("Q4 (CI) is NOT skipped when no CI detected", () => {
    const qs = buildInterviewQuestions(emptyProfile);
    const ciQ = qs.find(q => q.id === "ci");
    assert.equal(ciQ.skipped, false);
  });

  it("Q5 (domains) is skipped when domains detected", () => {
    const qs = buildInterviewQuestions(richProfile);
    const domQ = qs.find(q => q.id === "domains");
    assert.equal(domQ.skipped, true);
    assert.ok(domQ.prefilledValue.includes("security"));
  });

  it("getActiveQuestions filters skipped", () => {
    const qs = buildInterviewQuestions(richProfile);
    const active = getActiveQuestions(qs);
    assert.equal(active.length, 3); // goal, priority, teamSize
  });
});

describe("processAnswers", () => {
  it("strict from security priority", () => {
    const intent = processAnswers([
      { id: "goal", value: "인증 시스템 구현" },
      { id: "priority", value: "보안 (security)" },
      { id: "teamSize", value: "solo (혼자)" },
    ], emptyProfile);
    assert.equal(intent.gateProfile, "strict");
    assert.equal(intent.teamSize, "solo");
    assert.equal(intent.agenda, "인증 시스템 구현");
  });

  it("fast from speed priority", () => {
    const intent = processAnswers([
      { id: "goal", value: "프로토타입" },
      { id: "priority", value: "속도 (speed)" },
      { id: "teamSize", value: "small (2-5명)" },
    ], emptyProfile);
    assert.equal(intent.gateProfile, "fast");
    assert.equal(intent.teamSize, "small");
  });

  it("prototype from experiment priority", () => {
    const intent = processAnswers([
      { id: "priority", value: "실험 (experiment)" },
    ], emptyProfile);
    assert.equal(intent.gateProfile, "prototype");
  });

  it("balanced as default", () => {
    const intent = processAnswers([
      { id: "priority", value: "품질 (quality)" },
    ], emptyProfile);
    assert.equal(intent.gateProfile, "balanced");
  });

  it("merges scanner domains with user additions", () => {
    const intent = processAnswers([
      { id: "domains", value: "performance, compliance" },
    ], richProfile);
    assert.ok(intent.activeDomains.includes("security"));    // from scanner
    assert.ok(intent.activeDomains.includes("i18n"));         // from scanner
    assert.ok(intent.activeDomains.includes("performance"));  // from user
    assert.ok(intent.activeDomains.includes("compliance"));   // from user
  });

  it("uses scanner CI when user confirms", () => {
    const intent = processAnswers([
      { id: "ci", value: "맞습니다" },
    ], richProfile);
    assert.equal(intent.ci, "github-actions");
  });

  it("defaults when no answers", () => {
    const intent = processAnswers([], emptyProfile);
    assert.equal(intent.gateProfile, "balanced");
    assert.equal(intent.teamSize, "solo");
    assert.equal(intent.agenda, "프로젝트 개발");
  });
});

describe("composeHarness (WB-4)", () => {
  it("generates config for strict/solo with vitest", () => {
    const intent = { agenda: "인증", gateProfile: "strict", teamSize: "solo", ci: "github-actions", activeDomains: ["security"] };
    const cfg = composeHarness(intent, richProfile);
    assert.equal(cfg.gates.gateProfile, "strict");
    assert.equal(cfg.parliament.maxRounds, 1); // solo
    assert.ok(cfg.verify.commands.includes("npx vitest run"));
    assert.ok(cfg.verify.commands.includes("npx tsc --noEmit")); // TypeScript
    assert.ok(cfg.domains.active.includes("security"));
  });

  it("generates config for balanced/large", () => {
    const intent = { agenda: "서비스", gateProfile: "balanced", teamSize: "large", ci: null, activeDomains: [] };
    const cfg = composeHarness(intent, richProfile);
    assert.equal(cfg.gates.gateProfile, "balanced");
    assert.equal(cfg.parliament.maxRounds, 5); // large → full
  });

  it("go project gets go test command", () => {
    const goProfile = { ...emptyProfile, languages: ["go"], testFramework: "go-test" };
    const intent = { agenda: "서버", gateProfile: "balanced", teamSize: "solo", ci: null, activeDomains: [] };
    const cfg = composeHarness(intent, goProfile);
    assert.ok(cfg.verify.commands.includes("go test ./..."));
  });

  it("includes _meta with agenda and timestamp", () => {
    const intent = { agenda: "테스트 주제", gateProfile: "balanced", teamSize: "solo", ci: null, activeDomains: [] };
    const cfg = composeHarness(intent, emptyProfile);
    assert.equal(cfg._meta.generatedBy, "quorum-setup");
    assert.equal(cfg._meta.agenda, "테스트 주제");
    assert.ok(cfg._meta.timestamp);
  });
});
