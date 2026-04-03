#!/usr/bin/env node
/**
 * Integrated Approval Gate Tests — PERM-4
 *
 * Tests the integration of RulesEngine + PermissionModes + ProviderApprovalGate.
 * Core invariant: deny rules are bypass-immune (NFR-18).
 *
 * Run: node --test tests/integrated-gate.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { ProviderApprovalGate, AllowAllPolicy } from "../dist/platform/bus/provider-approval-gate.js";
import { RulesEngine } from "../dist/platform/bus/permission-rules.js";
import { setMode, resetMode } from "../dist/platform/bus/permission-modes.js";

// ── Mock SessionLedger ──────────────────────────────

function createMockLedger() {
  const approvals = [];
  const states = [];
  return {
    recordApproval(a) { approvals.push(a); },
    resolveApproval(_id, _decision) {},
    findByProviderSession(_id) {
      return { quorumSessionId: "qs-1", contractId: undefined };
    },
    updateState(id, state) { states.push({ id, state }); },
    approvals,
    states,
  };
}

function createRequest(tool, toolInput) {
  return {
    providerRef: { provider: "claude", providerSessionId: "ps-1" },
    requestId: `req-${Date.now()}`,
    kind: "tool",
    reason: tool,
    toolInput,
  };
}

// ═══ 1. Rules Engine Integration ════════════════════════

describe("IntegratedGate — rules engine", () => {
  let gate;
  let ledger;

  beforeEach(() => {
    ledger = createMockLedger();
    gate = new ProviderApprovalGate(ledger);
    resetMode();
  });

  afterEach(() => resetMode());

  it("deny rule blocks tool", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny" });
    gate.setRulesEngine(engine);

    const result = gate.process(createRequest("Bash", { command: "rm -rf /tmp" }));
    assert.equal(result.decision, "deny");
  });

  it("allow rule permits tool", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Read", behavior: "allow" });
    gate.setRulesEngine(engine);

    const result = gate.process(createRequest("Read", { file_path: "src/main.ts" }));
    assert.equal(result.decision, "allow");
  });

  it("no rule match falls through to policy chain", () => {
    const engine = new RulesEngine();
    // No rules added — everything falls through
    gate.setRulesEngine(engine);
    gate.addPolicy(new AllowAllPolicy());

    const result = gate.process(createRequest("Bash", { command: "ls" }));
    assert.equal(result.decision, "allow"); // AllowAllPolicy catches it
  });

  it("deny beats allow for same tool", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", behavior: "allow" });
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny" });
    gate.setRulesEngine(engine);

    const rmResult = gate.process(createRequest("Bash", { command: "rm -rf /" }));
    assert.equal(rmResult.decision, "deny");

    const lsResult = gate.process(createRequest("Bash", { command: "ls" }));
    assert.equal(lsResult.decision, "allow");
  });
});

// ═══ 2. NFR-18: Bypass-Immune Deny Rules ════════════════

describe("IntegratedGate — NFR-18 bypass-immune", () => {
  let gate;

  beforeEach(() => {
    const ledger = createMockLedger();
    gate = new ProviderApprovalGate(ledger);
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny" });
    engine.addRule({ tool: "Bash", behavior: "allow" }); // Allow everything else
    gate.setRulesEngine(engine);
    gate.addPolicy(new AllowAllPolicy());
  });

  afterEach(() => resetMode());

  it("bypass mode: deny rule still blocks rm", () => {
    setMode("bypass");
    const result = gate.process(createRequest("Bash", { command: "rm -rf /" }));
    assert.equal(result.decision, "deny");
  });

  it("bypass mode: non-denied tools are allowed", () => {
    setMode("bypass");
    const result = gate.process(createRequest("Bash", { command: "ls -la" }));
    assert.equal(result.decision, "allow");
  });

  it("auto mode: deny rule still blocks rm", () => {
    setMode("auto");
    const result = gate.process(createRequest("Bash", { command: "rm -rf /" }));
    assert.equal(result.decision, "deny");
  });

  it("dontAsk mode: deny rule still blocks rm", () => {
    setMode("dontAsk");
    const result = gate.process(createRequest("Bash", { command: "rm -rf /" }));
    assert.equal(result.decision, "deny");
  });

  it("acceptEdits mode: deny rule still blocks rm", () => {
    setMode("acceptEdits");
    const result = gate.process(createRequest("Bash", { command: "rm -rf /" }));
    assert.equal(result.decision, "deny");
  });

  it("all 6 modes: deny rule ALWAYS blocks", () => {
    const modes = ["default", "plan", "auto", "bypass", "dontAsk", "acceptEdits"];
    for (const mode of modes) {
      setMode(mode);
      const result = gate.process(createRequest("Bash", { command: "rm -rf /" }));
      assert.equal(result.decision, "deny", `deny must hold in "${mode}" mode`);
    }
  });
});

// ═══ 3. Mode Integration ════════════════════════════════

describe("IntegratedGate — mode integration", () => {
  let gate;

  beforeEach(() => {
    const ledger = createMockLedger();
    gate = new ProviderApprovalGate(ledger);
    gate.setRulesEngine(new RulesEngine());
  });

  afterEach(() => resetMode());

  it("plan mode: read-only tools auto-allow", () => {
    setMode("plan");
    gate.addPolicy(new AllowAllPolicy());

    const result = gate.process(createRequest("Read", { file_path: "test.ts" }));
    assert.equal(result.decision, "allow");
  });

  it("bypass mode: all tools auto-allow (no deny rules)", () => {
    setMode("bypass");

    const result = gate.process(createRequest("Write", { file_path: "x.ts" }));
    assert.equal(result.decision, "allow");
  });

  it("acceptEdits mode: Write auto-allow", () => {
    setMode("acceptEdits");
    gate.addPolicy(new AllowAllPolicy());

    const result = gate.process(createRequest("Write", { file_path: "test.ts" }));
    assert.equal(result.decision, "allow");
  });
});

// ═══ 4. Telemetry ═══════════════════════════════════════

describe("IntegratedGate — telemetry", () => {
  it("telemetry includes rule decision", () => {
    const ledger = createMockLedger();
    const gate = new ProviderApprovalGate(ledger);
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny", source: "policy" });
    gate.setRulesEngine(engine);

    const records = [];
    gate.onTelemetry((r) => records.push(r));

    gate.process(createRequest("Bash", { command: "rm -rf /" }));

    assert.equal(records.length, 1);
    assert.ok(records[0].ruleDecision, "should have ruleDecision");
    assert.equal(records[0].ruleDecision.behavior, "deny");
  });

  it("telemetry includes permission mode", () => {
    const ledger = createMockLedger();
    const gate = new ProviderApprovalGate(ledger);
    gate.setRulesEngine(new RulesEngine());
    gate.addPolicy(new AllowAllPolicy());
    setMode("auto");

    const records = [];
    gate.onTelemetry((r) => records.push(r));

    gate.process(createRequest("Read", {}));

    assert.equal(records[0].permissionMode, "auto");
    resetMode();
  });
});

// ═══ 5. Regression — existing gate still works ══════════

describe("IntegratedGate — regression", () => {
  it("works without rules engine (legacy mode)", () => {
    const ledger = createMockLedger();
    const gate = new ProviderApprovalGate(ledger);
    // No setRulesEngine — legacy mode
    gate.addPolicy(new AllowAllPolicy());

    const result = gate.process(createRequest("Bash", { command: "anything" }));
    assert.equal(result.decision, "allow");
  });

  it("fail-closed without policies or rules", () => {
    const ledger = createMockLedger();
    const gate = new ProviderApprovalGate(ledger);
    // No rules, no policies

    const result = gate.process(createRequest("Bash", { command: "ls" }));
    assert.equal(result.decision, "deny"); // fail-closed default
  });
});
