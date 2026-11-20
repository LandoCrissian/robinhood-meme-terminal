import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, hashTypedData, keccak256, parseAbi } = require("viem");
export const DIRECTORY = "0xe677a69a8124714dd0d88b73bdf1b89cc791ca9c";
export const FACTORY = "0x7281e1f9d8764ae6533b374dfd08ab2ecbc273c3";
export const FACTORY_HASH = "0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091";
export const SENDER = "0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca";
export const DIGEST = "0xad499113950f3410a60c6fe9fe40b4d1d98cf055eeafeb2b1736a5a38c5fea1e";
export const SCHEDULE = "0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65";
export const ZERO = "0x" + "0".repeat(64), ZERO_ADDRESS = "0x" + "0".repeat(40);
export const ACTION = Object.freeze({ kind: 0, nonce: "0", version: 1, factory: FACTORY,
  runtimeHash: FACTORY_HASH, signerSetEpoch: "1", deadline: "1795722606" });
export const actionTuple = (a = ACTION) => ({ ...a, nonce: BigInt(a.nonce), signerSetEpoch: BigInt(a.signerSetEpoch), deadline: BigInt(a.deadline) });
const tuple = "(uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)";
export const ABI = parseAbi([
  `function execute(${tuple})`, `function actionDigest(${tuple}) view returns(bytes32)`,
  "function pending() view returns(bytes32,uint48,uint48)", "function pendingRotation() view returns(bytes32,uint48,uint48)",
  "function nonce() view returns(uint64)", "function signerSetEpoch() view returns(uint64)", "function rotationNonce() view returns(uint64)",
  "function suspended() view returns(bool)", "function latestVersion() view returns(uint32)",
  "function factories(uint32) view returns(address,bytes32)", "function currentFactory() view returns((address factory,bytes32 runtimeHash))",
  "function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
  "function publicationDelay() view returns(uint48)", "function executionWindow() view returns(uint48)",
  "event ActionScheduled(bytes32 indexed digest,uint64 indexed nonce,uint48 executableAt,uint48 expiresAt)",
  "function engineVersion() view returns(uint32)", "function directory() view returns(address)", "function projectRegistry() view returns(address)",
  "function graduationEngine() view returns(address)", "function factory() view returns(address)",
  "function poolManager() view returns(address)", "function positionManager() view returns(address)", "function permit2() view returns(address)",
  "function initializationGuard() view returns(address)", "function successorDeployer() view returns(address)",
  "function successorDeployerRuntimeHash() view returns(bytes32)", "function operatingRecipient() view returns(address)",
  "function futureReserveRecipient() view returns(address)", "function creationFeeWei() view returns(uint256)",
  "function tokenSupply() view returns(uint256)", "function CHAIN_ID() view returns(uint256)",
  "function POOL_FEE() view returns(uint24)", "function TICK_SPACING() view returns(int24)",
]);
export const EXECUTE_DATA = encodeFunctionData({ abi: ABI, functionName: "execute", args: [actionTuple()] });
export function publicationDigest(action = ACTION) {
  return hashTypedData({ domain: { name: "RMT Launch Curve Directory", version: "2", chainId: 4663, verifyingContract: DIRECTORY },
    types: { Action: [{ name: "kind", type: "uint8" }, { name: "nonce", type: "uint64" }, { name: "version", type: "uint32" },
      { name: "factory", type: "address" }, { name: "runtimeHash", type: "bytes32" }, { name: "signerSetEpoch", type: "uint64" },
      { name: "deadline", type: "uint48" }] }, primaryType: "Action", message: actionTuple(action) });
}
// Offline admission only. A saved review packet is never executable authority.
export function validateReviewPacket(packet, current, nowSeconds) {
  assert.equal(packet.scope, "TASK091_REVIEW_ONLY_UNSIGNED_FACTORY_PUBLICATION");
  assert.equal(packet.signingAuthorized, false); assert.equal(packet.broadcastAuthorized, false);
  assert.equal(packet.chainId, 4663); assert.equal(packet.to, DIRECTORY); assert.equal(packet.from, SENDER);
  assert.equal(packet.valueWei, "0"); assert.deepEqual(packet.action, ACTION);
  assert.equal(publicationDigest(packet.action), DIGEST); assert.equal(packet.actionDigest, DIGEST);
  assert.equal(packet.data, EXECUTE_DATA); assert.equal(packet.dataHash, keccak256(EXECUTE_DATA));
  assert.equal(packet.request.type, "0x2"); assert.equal(packet.request.chainId, "0x1237");
  assert.equal(packet.request.from, SENDER); assert.equal(packet.request.to, DIRECTORY);
  assert.equal(packet.request.value, "0x0"); assert.equal(packet.request.data, EXECUTE_DATA);
  assert.deepEqual(Object.keys(packet.request).sort(), ["chainId", "data", "from", "nonce", "to", "type", "value"].sort());
  assert.ok(current.twoProvidersAgree && current.canonicalAnchorRechecked && current.allRuntimePinsMatch);
  assert.equal(current.status, "PENDING_TIME_ELIGIBLE");
  assert.deepEqual(current.state.pending, [DIGEST, "1795131148", "1795722606"]);
  assert.equal(current.state.nonce, "0"); assert.equal(current.state.signerSetEpoch, "1");
  assert.equal(current.state.latestVersion, "0"); assert.equal(current.state.suspended, false);
  assert.deepEqual(current.state.factories, [ZERO_ADDRESS, ZERO]);
  assert.deepEqual(current.state.pendingRotation, [ZERO, "0", "0"]);
  assert.equal(current.state.actionDigest, DIGEST); assert.equal(current.state.factoryEngineVersion, "1");
  assert.equal(current.account.confirmedNonce, current.account.pendingNonce);
  assert.equal(packet.request.nonce, "0x" + BigInt(current.account.confirmedNonce).toString(16));
  assert.equal(packet.accountNonce, current.account.confirmedNonce);
  assert.equal(packet.anchor.hash, current.anchor.hash); assert.equal(packet.anchor.number, current.anchor.number);
  assert.ok(BigInt(nowSeconds) >= 1795131148n && BigInt(nowSeconds) <= 1795722606n, "NOTICE_OR_EXPIRY");
  assert.ok(BigInt(nowSeconds) >= BigInt(current.anchor.timestamp) - 10n && BigInt(nowSeconds) <= BigInt(current.anchor.timestamp) + 180n, "STALE_REVIEW_RECAPTURE_REQUIRED");
  assert.ok(BigInt(packet.cost.gasLimit) > 0n && BigInt(packet.cost.maxFeePerGasWei) > 0n);
  assert.ok(BigInt(packet.cost.priorityFeeWei) <= BigInt(packet.cost.maxFeePerGasWei));
  assert.equal(packet.cost.maximumWei, (BigInt(packet.cost.gasLimit) * BigInt(packet.cost.maxFeePerGasWei)).toString());
  assert.ok(BigInt(current.account.balanceWei) >= BigInt(packet.cost.maximumWei));
  return { status: "VALID_REVIEW_ONLY_REQUIRES_FRESH_WALLET_OWNER_APPROVAL", signingAuthorized: false, broadcastAuthorized: false };
}
