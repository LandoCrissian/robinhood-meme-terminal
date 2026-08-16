import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectMetaMaskAgentWallet,
  READ_ONLY_MM_COMMANDS
} from "./metamask-agent-wallet-preflight.mjs";

const address = "0x1111111111111111111111111111111111111111";

function success(data) {
  return { status: 0, stdout: JSON.stringify({ ok: true, data }), errorCode: null };
}

function healthyOutputs() {
  return new Map([
    ["--version", { status: 0, stdout: "@metamask/agent-wallet/6.1.0 darwin-x64 node-v22.23.1\n", errorCode: null }],
    ["doctor --json", success({
      cli: "6.1.0",
      authenticated: true,
      initialized: true,
      recommendedSkills: { "metamask-agent-wallet": { found: true, version: "7.1.0", cliVersion: "6.1.0" } },
      compatible: true
    })],
    ["chains list --json", success({ chains: [
      { key: "robinhood", chainNamespace: "eip155", caip2: "eip155:4663", chainId: 4663, name: "Robinhood Chain", relaySupported: true, features: ["swap"] },
      { key: "robinhood-testnet", chainNamespace: "eip155", caip2: "eip155:46630", chainId: 46630, name: "Robinhood Chain Testnet", relaySupported: false, features: [] }
    ] })],
    ["init show --json", success({ walletMode: "server-wallet", tradingMode: "guard" })],
    ["wallet address --json", success({ mode: "server-wallet", chainNamespace: "eip155", address })],
    ["wallet trading-mode get --json", success({ mode: "guard", address })],
    ["wallet policy get --json", success({ policy: { schema_version: 1 }, address })],
    ["wallet policy template --json", success({ policyYaml: "schema_version: 1" })]
  ]);
}

function runner(outputs = healthyOutputs()) {
  return (args) => outputs.get(args.join(" ")) ?? { status: 1, stdout: "", errorCode: null };
}

test("healthy compatible Guard Mode environment is read-only ready but transaction-disabled", () => {
  const result = inspectMetaMaskAgentWallet(runner());
  assert.equal(result.cliInstalled, true);
  assert.equal(result.doctorHealthy, true);
  assert.equal(result.skillsCompatible, true);
  assert.equal(result.robinhoodMainnet.present, true);
  assert.equal(result.robinhoodMainnet.swapAdvertised, true);
  assert.equal(result.robinhoodMainnet.relaySupported, true);
  assert.deepEqual(result.robinhoodMainnet.features, ["swap"]);
  assert.equal(result.robinhoodTestnet.present, true);
  assert.equal(result.guardModeActive, true);
  assert.equal(result.transactionPrerequisitesMet, true);
  assert.equal(result.transactionUseAuthorized, false);
  assert.equal(result.safeForTransactionUse, false);
});

test("missing CLI fails closed", () => {
  const result = inspectMetaMaskAgentWallet(() => ({ status: null, stdout: "", errorCode: "ENOENT" }));
  assert.equal(result.cliInstalled, false);
  assert.equal(result.safeForReadOnlyAgentUse, false);
  assert.ok(result.blockers.includes("CLI_NOT_INSTALLED"));
});

test("incompatible skill fails closed", () => {
  const outputs = healthyOutputs();
  outputs.set("doctor --json", success({
    cli: "6.1.0", authenticated: true, initialized: true,
    recommendedSkills: { "metamask-agent-wallet": { found: true, version: "6.0.0", cliVersion: "5.4.0" } },
    compatible: false
  }));
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.skillsCompatible, false);
  assert.equal(result.transactionPrerequisitesMet, false);
});

test("missing Robinhood mainnet is distinct from unknown", () => {
  const outputs = healthyOutputs();
  outputs.set("chains list --json", success({ chains: [
    { key: "robinhood-testnet", chainNamespace: "eip155", caip2: "eip155:46630", chainId: 46630, name: "Robinhood Chain Testnet", features: [] }
  ] }));
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.robinhoodMainnet.present, false);
  assert.equal(result.transactionPrerequisitesMet, false);
});

test("missing Robinhood testnet fails the foundation gate", () => {
  const outputs = healthyOutputs();
  outputs.set("chains list --json", success({ chains: [
    { key: "robinhood", chainNamespace: "eip155", caip2: "eip155:4663", chainId: 4663, name: "Robinhood Chain", features: ["swap"] }
  ] }));
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.robinhoodTestnet.present, false);
  assert.equal(result.transactionPrerequisitesMet, false);
});

test("Robinhood mainnet without swap never advertises swap", () => {
  const outputs = healthyOutputs();
  const chainEnvelope = JSON.parse(outputs.get("chains list --json").stdout);
  chainEnvelope.data.chains[0].features = [];
  outputs.set("chains list --json", { status: 0, stdout: JSON.stringify(chainEnvelope), errorCode: null });
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.robinhoodMainnet.present, true);
  assert.equal(result.robinhoodMainnet.swapAdvertised, false);
  assert.deepEqual(result.robinhoodMainnet.features, []);
});

test("malformed JSON is reported without throwing", () => {
  const outputs = healthyOutputs();
  outputs.set("doctor --json", { status: 0, stdout: "not-json", errorCode: null });
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.doctorError, "MALFORMED_JSON");
  assert.equal(result.safeForReadOnlyAgentUse, false);
});

test("a successful JSON envelope from a failed process is rejected", () => {
  const outputs = healthyOutputs();
  outputs.set("doctor --json", {
    status: 1,
    stdout: JSON.stringify({
      ok: true,
      data: {
        cli: "6.1.0",
        authenticated: true,
        initialized: true,
        recommendedSkills: { "metamask-agent-wallet": { found: true, version: "7.1.0", cliVersion: "6.1.0" } },
        compatible: true
      }
    }),
    errorCode: null
  });
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.doctorError, "NONZERO_EXIT");
  assert.equal(result.safeForReadOnlyAgentUse, false);
});

test("unauthenticated state remains read-only safe but chain facts unknown", () => {
  const outputs = healthyOutputs();
  outputs.set("doctor --json", success({
    cli: "6.1.0", authenticated: false, initialized: false,
    recommendedSkills: { "metamask-agent-wallet": { found: true, version: "7.1.0", cliVersion: "6.1.0" } },
    compatible: true
  }));
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.authenticated, false);
  assert.equal(result.safeForReadOnlyAgentUse, true);
  assert.equal(result.robinhoodMainnet.present, null);
  assert.equal(result.chainsError, "AUTH_OR_INIT_REQUIRED");
});

test("authenticated but uninitialized state remains blocked", () => {
  const outputs = healthyOutputs();
  outputs.set("doctor --json", success({
    cli: "6.1.0", authenticated: true, initialized: false,
    recommendedSkills: { "metamask-agent-wallet": { found: true, version: "7.1.0", cliVersion: "6.1.0" } },
    compatible: true
  }));
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.authenticated, true);
  assert.equal(result.initialized, false);
  assert.equal(result.readOnlyWalletQueriesAvailable, false);
  assert.equal(result.walletAddress, null);
});

test("Beast Mode is detected and rejected", () => {
  const outputs = healthyOutputs();
  outputs.set("init show --json", success({ walletMode: "server-wallet", tradingMode: "beast" }));
  outputs.set("wallet trading-mode get --json", success({ mode: "beast", address }));
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.beastModeDetected, true);
  assert.equal(result.guardModeActive, false);
  assert.equal(result.transactionPrerequisitesMet, false);
});

test("Guard Mode is detected only for a server wallet", () => {
  const result = inspectMetaMaskAgentWallet(runner());
  assert.equal(result.walletMode, "server-wallet");
  assert.equal(result.tradingMode, "guard");
  assert.equal(result.guardModeActive, true);
});

test("unknown security-relevant chain features and malformed relay state fail closed", () => {
  const outputs = healthyOutputs();
  const chainEnvelope = JSON.parse(outputs.get("chains list --json").stdout);
  chainEnvelope.data.chains[0].features = ["swap", "automatic-outflow"];
  chainEnvelope.data.chains[0].relaySupported = "yes";
  chainEnvelope.data.chains[0].newDisplayField = "ignored for authority";
  outputs.set("chains list --json", { status: 0, stdout: JSON.stringify(chainEnvelope), errorCode: null });
  const result = inspectMetaMaskAgentWallet(runner(outputs));
  assert.equal(result.robinhoodMainnet.swapAdvertised, true);
  assert.deepEqual(result.robinhoodMainnet.unknownFeatures, ["automatic-outflow"]);
  assert.equal(result.robinhoodMainnet.relaySupported, null);
  assert.equal(result.robinhoodMainnet.schemaValid, false);
  assert.equal(result.transactionPrerequisitesMet, false);
});

test("the preflight command surface contains no transaction or signing commands", async () => {
  assert.deepEqual(Object.values(READ_ONLY_MM_COMMANDS).map((args) => args.join(" ")), [
    "--version",
    "doctor --json",
    "chains list --json",
    "init show --json",
    "wallet address --json",
    "wallet trading-mode get --json",
    "wallet policy get --json",
    "wallet policy template --json"
  ]);
  const source = await readFile(fileURLToPath(new URL("./metamask-agent-wallet-preflight.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /spawnSync\([^\n]+shell\s*:/u);
  assert.doesNotMatch(source, /\b(?:transfer|sign-message|sign-typed-data|send-transaction|swap execute|perps open|earn supply)\b/u);
});
