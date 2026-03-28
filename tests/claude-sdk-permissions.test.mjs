import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Import compiled modules
const { ProviderApprovalGate, AllowAllPolicy, ScopeBasedPolicy, DenyNetworkPolicy } =
  await import("../dist/platform/bus/provider-approval-gate.js");
const { InMemorySessionLedger } = await import(
  "../dist/platform/providers/session-ledger.js"
);
const { ClaudePermissionBridge } = await import(
  "../dist/platform/providers/claude-sdk/permissions.js"
);

/** Helper: create a minimal ProviderSessionRef */
function makeSessionRef(providerSessionId = "sdk-session-1") {
  return {
    provider: "claude",
    executionMode: "agent_sdk",
    providerSessionId,
  };
}

/** Helper: register a session in the ledger so gate can look it up */
function registerSession(ledger, sessionRef, opts = {}) {
  ledger.upsert({
    quorumSessionId: opts.quorumSessionId || "q-session-1",
    contractId: opts.contractId,
    providerRef: sessionRef,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    state: "running",
  });
}

// ── ClaudePermissionBridge with quorum gate enforced ──────────

describe("ClaudePermissionBridge (gate enforced)", () => {
  /** @type {InstanceType<typeof InMemorySessionLedger>} */
  let ledger;
  /** @type {InstanceType<typeof ProviderApprovalGate>} */
  let gate;
  let sessionRef;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    sessionRef = makeSessionRef();
    registerSession(ledger, sessionRef);
  });

  it("defaultConfig has enforceQuorumGate: true", () => {
    const config = ClaudePermissionBridge.defaultConfig();
    assert.equal(config.enforceQuorumGate, true);
    assert.equal(config.mode, "default");
    assert.deepStrictEqual(config.settingSources, ["project"]);
  });

  it("checkToolPermission with no policies → denied (fail-closed)", () => {
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const result = bridge.checkToolPermission("code_map", sessionRef);
    assert.equal(result.allowed, false);
    assert.equal(result.source, "quorum-gate");
    assert.ok(result.reason.includes("denied") || result.reason.includes("deny"));
  });

  it("checkToolPermission with AllowAllPolicy → allowed via quorum gate", () => {
    gate.addPolicy(new AllowAllPolicy());
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const result = bridge.checkToolPermission("code_map", sessionRef);
    assert.equal(result.allowed, true);
    assert.equal(result.source, "quorum-gate");
    assert.ok(result.reason.includes("allow-all"));
  });

  it("checkToolPermission with ScopeBasedPolicy + matching tool → allowed", () => {
    gate.addPolicy(new ScopeBasedPolicy());
    // Register session with contract that has allowed tools
    const contractLedger = {
      getSprintContract: (id) => ({ scope: ["blast_radius", "code_map"] }),
    };
    const gateWithContract = new ProviderApprovalGate(ledger, contractLedger);
    gateWithContract.addPolicy(new ScopeBasedPolicy());

    // Need to bind session to a contract
    const ref = makeSessionRef("sdk-session-scope");
    registerSession(ledger, ref, { contractId: "c-1" });

    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gateWithContract
    );
    const result = bridge.checkToolPermission("code_map", ref);
    assert.equal(result.allowed, true);
    assert.equal(result.source, "quorum-gate");
    assert.ok(result.reason.includes("scope-based"));
  });

  it("checkToolPermission with DenyNetworkPolicy → deferred for tool, then denied by default", () => {
    gate.addPolicy(new DenyNetworkPolicy());
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    // DenyNetworkPolicy only denies "network" kind; for "tool" kind it defers
    // With no other policy, falls through to fail-closed default
    const result = bridge.checkToolPermission("some_tool", sessionRef);
    assert.equal(result.allowed, false);
    assert.equal(result.source, "quorum-gate");
  });

  it("buildCanUseTool returns a function", () => {
    gate.addPolicy(new AllowAllPolicy());
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const canUseTool = bridge.buildCanUseTool(sessionRef);
    assert.equal(typeof canUseTool, "function");
  });

  it("canUseTool function returns boolean matching gate decision", () => {
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    // No policies → fail-closed → false
    const canUseToolDenied = bridge.buildCanUseTool(sessionRef);
    assert.equal(canUseToolDenied("some_tool", {}), false);

    // Add AllowAll → true
    gate.addPolicy(new AllowAllPolicy());
    const canUseToolAllowed = bridge.buildCanUseTool(sessionRef);
    assert.equal(canUseToolAllowed("some_tool", {}), true);
  });

  it("KEY INVARIANT: bypassPermissions SDK mode does NOT bypass quorum gate", () => {
    // Even with bypassPermissions, if enforceQuorumGate is true, quorum gate decides
    const config = {
      mode: "bypassPermissions",
      enforceQuorumGate: true,
    };
    // No policies registered → fail-closed
    const bridge = new ClaudePermissionBridge(config, gate);
    const result = bridge.checkToolPermission("dangerous_tool", sessionRef);
    assert.equal(result.allowed, false);
    assert.equal(result.source, "quorum-gate");
  });
});

// ── ClaudePermissionBridge with quorum gate NOT enforced ─────

describe("ClaudePermissionBridge (gate not enforced)", () => {
  /** @type {InstanceType<typeof InMemorySessionLedger>} */
  let ledger;
  /** @type {InstanceType<typeof ProviderApprovalGate>} */
  let gate;
  let sessionRef;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    sessionRef = makeSessionRef();
    registerSession(ledger, sessionRef);
  });

  it("bypassPermissions mode → always allowed", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "bypassPermissions", enforceQuorumGate: false },
      gate
    );
    const result = bridge.checkToolPermission("any_tool", sessionRef);
    assert.equal(result.allowed, true);
    assert.equal(result.source, "sdk-mode");
    assert.ok(result.reason.includes("bypassPermissions"));
  });

  it("acceptEdits mode → always allowed", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "acceptEdits", enforceQuorumGate: false },
      gate
    );
    const result = bridge.checkToolPermission("write_file", sessionRef);
    assert.equal(result.allowed, true);
    assert.equal(result.source, "sdk-mode");
    assert.ok(result.reason.includes("acceptEdits"));
  });

  it("plan mode → read-only tools allowed", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate
    );
    const readOnlyTools = [
      "code_map", "blast_radius", "dependency_graph",
      "audit_scan", "coverage_map", "doc_coverage",
    ];
    for (const tool of readOnlyTools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, true, `Expected ${tool} to be allowed in plan mode`);
      assert.equal(result.source, "sdk-mode");
      assert.ok(result.reason.includes("read-only"));
    }
  });

  it("plan mode → write tools denied", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate
    );
    const writeTools = ["write_file", "bash", "edit_file"];
    for (const tool of writeTools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, false, `Expected ${tool} to be denied in plan mode`);
      assert.equal(result.source, "sdk-mode");
      assert.ok(result.reason.includes("write tool blocked"));
    }
  });

  it("default mode → denied (requires approval)", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "default", enforceQuorumGate: false },
      gate
    );
    const result = bridge.checkToolPermission("any_tool", sessionRef);
    assert.equal(result.allowed, false);
    assert.equal(result.source, "sdk-mode");
    assert.ok(result.reason.includes("requires approval"));
  });
});

// ── buildSdkPermissionConfig ────────────────────────────────

describe("buildSdkPermissionConfig", () => {
  let ledger;
  let gate;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
  });

  it("returns correct shape with mode, settingSources, quorumGateEnforced", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "acceptEdits", settingSources: ["project", "user"], enforceQuorumGate: true },
      gate
    );
    const config = bridge.buildSdkPermissionConfig();
    assert.equal(config.permissionMode, "acceptEdits");
    assert.deepStrictEqual(config.settingSources, ["project", "user"]);
    assert.equal(config.quorumGateEnforced, true);
  });

  it("default settingSources is ['project']", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "default", enforceQuorumGate: false },
      gate
    );
    const config = bridge.buildSdkPermissionConfig();
    assert.deepStrictEqual(config.settingSources, ["project"]);
  });
});
