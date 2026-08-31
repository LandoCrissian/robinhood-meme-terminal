import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletGatewayKey } from "../wallet-gateway";
import {
  bindVNextExternalWallet,
  invokeVNextExternalWalletRequest,
  vNextMobileHandoffLabel
} from "./wallet-handoff";
import {
  readVNextWalletRequestJournal,
  recordPreparedVNextWalletRequest,
  transitionVNextWalletRequest,
  type VNextExecutionStorage
} from "./execution-recovery";
import { DIRECT_SMOKE_RECIPIENT, DIRECT_SMOKE_SWAP_PLAN } from "./direct-no-rmt-fee-smoke-fixture";

function memoryStorage(): VNextExecutionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

async function main() {

const metaMask = {
  address: DIRECT_SMOKE_RECIPIENT,
  connectorType: "wallet_connect",
  walletClientType: "metamask",
  meta: { id: "io.metamask", name: "MetaMask" },
  type: "ethereum" as const
};
const rabby = {
  ...metaMask,
  walletClientType: "rabby",
  meta: { id: "io.rabby", name: "Rabby Wallet" }
};

for (const scenario of [
  { name: "MetaMask Mobile Safari", wallet: metaMask },
  { name: "Rabby Mobile Safari", wallet: rabby },
  { name: "MetaMask in-app browser", wallet: { ...metaMask, connectorType: "injected" } },
  { name: "Rabby in-app browser", wallet: { ...rabby, connectorType: "injected" } }
]) {
  const binding = bindVNextExternalWallet({
    selectedWalletKey: walletGatewayKey(scenario.wallet),
    selectedWalletKind: "external",
    selectedWalletName: scenario.wallet.meta.name,
    connectedAddress: scenario.wallet.address,
    connectedChainId: 4_663,
    connectorId: scenario.wallet.meta.id,
    connectorType: scenario.wallet.connectorType,
    walletClientAddress: scenario.wallet.address,
    walletClientChainId: 4_663,
    recipient: scenario.wallet.address
  });
  assert.equal(binding.connectorId, scenario.wallet.meta.id, `${scenario.name} must reach its exact selected connector`);
  assert.equal(binding.walletName, scenario.wallet.meta.name);
  assert.equal(binding.chainId, 4_663);
}

assert.throws(() => bindVNextExternalWallet({
  selectedWalletKey: walletGatewayKey(rabby),
  selectedWalletKind: "external",
  selectedWalletName: "Rabby Wallet",
  connectedAddress: rabby.address,
  connectedChainId: 4_663,
  connectorId: "io.metamask",
  connectorType: "wallet_connect",
  walletClientAddress: rabby.address,
  walletClientChainId: 4_663,
  recipient: rabby.address
}), /connector no longer matches/, "RMT must never send a Rabby-selected request through MetaMask");

assert.throws(() => bindVNextExternalWallet({
  selectedWalletKey: walletGatewayKey(metaMask),
  selectedWalletKind: "external",
  selectedWalletName: "MetaMask",
  connectedAddress: metaMask.address,
  connectedChainId: 4_663,
  connectorId: metaMask.meta.id,
  connectorType: "wallet_connect",
  walletClientAddress: metaMask.address,
  walletClientChainId: 1,
  recipient: metaMask.address
}), /not on Robinhood Chain 4663/, "a chain change during handoff must fail closed");

let providerInvocations = 0;
const expectedHash = `0x${"a".repeat(64)}` as const;
const providerResult = await invokeVNextExternalWalletRequest(async () => {
  providerInvocations += 1;
  return expectedHash;
});
assert.equal(providerResult, expectedHash);
assert.equal(providerInvocations, 1, "the exact connector-native request is invoked once");
assert.equal(vNextMobileHandoffLabel("opening", "MetaMask"), "Opening MetaMask…");
assert.equal(vNextMobileHandoffLabel("provider_pending", "MetaMask"), "Waiting for wallet review…");
assert.equal(vNextMobileHandoffLabel("unresolved", "MetaMask"), "Wallet request unresolved");

const storage = memoryStorage();
const nowMs = 1_786_000_000_000;
const requestId = "abababab-abab-4bab-8bab-abababababab";
assert.ok(recordPreparedVNextWalletRequest({
  requestId,
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: DIRECT_SMOKE_SWAP_PLAN,
  walletNonceBeforeRequest: 7n,
  requestBlockNumber: 50_000_000n,
  requestBlockHash: `0x${"b".repeat(64)}`,
  connectorId: metaMask.meta.id,
  connectorType: metaMask.connectorType,
  walletClientType: metaMask.walletClientType,
  walletName: metaMask.meta.name
}, storage, nowMs));
assert.equal(transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", storage, nowMs + 1)?.promptRequestedAtMs, nowMs + 1);
assert.equal(transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", storage, nowMs + 2)?.providerPendingAtMs, nowMs + 2);
const restored = readVNextWalletRequestJournal(storage, nowMs + 3)[0]!;
assert.equal(restored.connectorId, "io.metamask");
assert.equal(restored.connectorType, "wallet_connect");
assert.equal(restored.walletClientType, "metamask");
assert.equal(restored.walletName, "MetaMask");
assert.equal(restored.state, "PROVIDER_PENDING", "background, unmount, and reload retain the same durable request");

const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const review = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
assert.doesNotMatch(composer, /Complete review in wallet/, "authorization preparation must not impersonate a wallet handoff");
assert.ok(composer.indexOf("<VNextWalletReview") < composer.indexOf('<details className="vnRouteCard">'),
  "the real explicit wallet action must be on the primary surface above Advanced details");
assert.doesNotMatch(composer, /vnRouteCard" open=/, "authorization must not open a nested mobile detail surface");
assert.match(composer, /Nothing opens automatically/);
assert.match(review, /useWalletClient\(\{ connector \}\)/, "the transaction client must be bound to the exact active connector");
assert.match(review, /bindVNextExternalWallet/);
assert.match(review, /invokeVNextExternalWalletRequest/);
assert.match(review, /transitionVNextWalletRequest\(requestId, "PROMPT_REQUESTED"\)[\s\S]*invokeVNextExternalWalletRequest/,
  "the durable prompt record must precede the provider invocation");
assert.doesNotMatch(review, /metamask:\/\/|rabby:\/\//i, "RMT must not invent wallet URL schemes");
assert.doesNotMatch(review, /autoRequest/);
assert.match(css, /@media \(max-width: 639px\)[\s\S]*\.vnWalletPrimaryReview > dl,[\s\S]*grid-template-columns: 1fr/,
  "the verified wallet request must collapse to one column on 390px and 430px mobile widths");

console.log("RMT iOS external-wallet handoff uses the exact selected connector, exposes the real explicit action, and preserves provider-pending recovery.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
