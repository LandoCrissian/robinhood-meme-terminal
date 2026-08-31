import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletGatewayKey } from "../wallet-gateway";
import {
  bindVNextExternalWallet,
  inspectVNextWalletTransport,
  isVNextMobileBrowser,
  invokeVNextExternalWalletRequest,
  openVNextSelectedWallet,
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
  assert.equal(binding.selectedConnectorType, scenario.wallet.connectorType);
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
assert.equal(vNextMobileHandoffLabel("ready_to_open", "MetaMask"), "Open MetaMask & review");
assert.equal(vNextMobileHandoffLabel("opening", "MetaMask"), "Opening MetaMask…");
assert.equal(vNextMobileHandoffLabel("provider_pending", "MetaMask"), "Transaction request sent to MetaMask");
assert.equal(vNextMobileHandoffLabel("unresolved", "MetaMask"), "Wallet request unresolved");

const walletConnectProvider = {
  isWalletConnect: true,
  session: {
    peer: {
      metadata: {
        name: "MetaMask",
        redirect: { native: "metamask://", universal: "https://metamask.app.link" }
      }
    }
  }
};
const transport = inspectVNextWalletTransport(walletConnectProvider, "wallet_connect");
assert.equal(transport.kind, "walletconnect");
assert.equal(transport.sessionPeerBound, true);
assert.equal(transport.peerWalletName, "MetaMask");
assert.equal(transport.safeMobileOpenUri, "metamask://");
assert.equal(transport.mobileOpenSource, "session_peer_redirect_native");
assert.equal(inspectVNextWalletTransport({ isWalletConnect: true }, "wallet_connect").safeMobileOpenUri, null,
  "RMT does not invent a wallet URL when exact session metadata has none");
assert.equal(inspectVNextWalletTransport({
  isWalletConnect: true,
  session: { peer: { metadata: { name: "Unsafe", redirect: { native: "javascript:alert(1)" } } } }
}, "wallet_connect").safeMobileOpenUri, null);
assert.equal(inspectVNextWalletTransport({ request() {} }, "injected").kind, "injected");
assert.equal(isVNextMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
assert.equal(isVNextMobileBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);

const openedWallets: string[] = [];
assert.equal(openVNextSelectedWallet(transport.safeMobileOpenUri!, (uri) => openedWallets.push(uri)), true);
assert.deepEqual(openedWallets, ["metamask://"]);
assert.equal(providerInvocations, 1, "opening or reopening the wallet never sends another transaction request");

const storage = memoryStorage();
const nowMs = 1_786_000_000_000;
const requestId = "abababab-abab-4bab-8bab-abababababab";
const expiredPreparedStorage = memoryStorage();
const expiredPreparedRequestId = "acacacac-acac-4cac-8cac-acacacacacac";
assert.ok(recordPreparedVNextWalletRequest({
  requestId: expiredPreparedRequestId,
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: DIRECT_SMOKE_SWAP_PLAN,
  walletNonceBeforeRequest: 7n,
  requestBlockNumber: 50_000_000n
}, expiredPreparedStorage, nowMs));
assert.equal(transitionVNextWalletRequest(
  expiredPreparedRequestId,
  "EXPIRED_UNSUBMITTED",
  expiredPreparedStorage,
  nowMs + 1
)?.state, "EXPIRED_UNSUBMITTED", "an expired prepared plan is cleared without invoking the provider");
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
const openBoundary = review.slice(review.indexOf("function openPreparedWalletRequest"), review.indexOf("const prepareWalletReview"));
const prepareBoundary = review.slice(review.indexOf("const prepareWalletReview"), review.indexOf("const reopenSelectedWallet"));
assert.doesNotMatch(openBoundary, /\bawait\b/, "the second owner action performs no awaited RPC before provider invocation");
assert.match(openBoundary, /transitionVNextWalletRequest\(prepared\.requestId, "PROMPT_REQUESTED"\)[\s\S]*walletClient\.request\(\{[\s\S]*method: "eth_sendTransaction"/,
  "the durable prompt record must precede the provider invocation");
assert.doesNotMatch(openBoundary, /walletClient\.sendTransaction/, "the mobile click must not insert Viem's asynchronous chain lookup");
assert.doesNotMatch(prepareBoundary, /eth_sendTransaction|walletClient\.request/,
  "mobile preflight prepares and journals the request without invoking the provider");
assert.match(openBoundary, /walletClient\.request[\s\S]*"PROVIDER_PENDING"/,
  "provider-pending follows the single provider invocation");
assert.ok(review.indexOf("recordPreparedVNextWalletRequest") < review.indexOf("function openPreparedWalletRequest")
  || review.indexOf("recordPreparedVNextWalletRequest") < review.lastIndexOf("walletClient.request"));
assert.match(review, /Open \{walletName\}/, "an exact session-bound wallet can be reopened without resending");
assert.match(review, /Transaction request sent to/);
assert.match(review, /Verified request prepared/);
assert.match(review, /Transaction request sent to/);
assert.doesNotMatch(review, /Complete review in wallet/);
assert.doesNotMatch(review, /metamask:\/\/|rabby:\/\//i, "RMT must not invent wallet URL schemes");
assert.doesNotMatch(review, /autoRequest/);
assert.match(css, /@media \(max-width: 639px\)[\s\S]*\.vnWalletPrimaryReview > dl,[\s\S]*grid-template-columns: 1fr/,
  "the verified wallet request must collapse to one column on 390px and 430px mobile widths");
assert.match(css, /\.vnWalletSubmission\s*\{[\s\S]*display: grid/,
  "the same bounded wallet lifecycle surface remains usable at 1440x900");

console.log("RMT iOS external-wallet handoff uses the exact selected connector, exposes the real explicit action, and preserves provider-pending recovery.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
