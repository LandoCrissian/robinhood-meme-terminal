import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { createPublicClient, createWalletClient, defineChain, hashTypedData, http, parseAbi, parseEther } = requireWeb("viem");
const plan = "(uint256 nonce,uint128 maxNativeIn,uint128 maxTokenIn,uint128 minLiquidity,uint160 referenceSqrtPriceX96,uint16 maxSqrtDeviationBps,uint64 observedAt,uint64 deadline)";
const abi = parseAbi([
  "function launchContext() view returns (address token,bytes32 poolId)",
  "function nextNonce() view returns (uint256)",
  "function snapshot() view returns ((uint256 nativeCollected,uint256 tokenCollected,uint256 nativePositionFees,uint256 tokenPositionFees,uint256 nativeHeld,uint256 tokenHeld,uint256 nativeAdded,uint256 tokenAdded,uint128 liquidityAdded,uint256 positionTokenId,uint64 lastAttemptAt,uint8 outcome) state)",
  "function collectReserve(uint256 deadline) returns (uint256 nativeAmount,uint256 tokenAmount)",
  `function planDigest(${plan} order) view returns (bytes32)`,
  `function reinvest(${plan} order,bytes signatureA,bytes signatureB) returns (uint8)`,
]);
const previewAbi = parseAbi([
  "function preview(uint8 supplyPreset,uint16 poolAllocationBps,uint128 nativeAmount) pure returns (uint256 totalSupply,uint128 tokenMaximum,uint160 sqrtPriceX96,uint128 liquidity,uint128 amount0,uint128 amount1)",
]);
const reviewTypes = {
  Reinvestment: [
    { name: "poolId", type: "bytes32" }, { name: "token", type: "address" },
    { name: "nonce", type: "uint256" }, { name: "maxNativeIn", type: "uint128" },
    { name: "maxTokenIn", type: "uint128" }, { name: "minLiquidity", type: "uint128" },
    { name: "referenceSqrtPriceX96", type: "uint160" }, { name: "maxSqrtDeviationBps", type: "uint16" },
    { name: "observedAt", type: "uint64" }, { name: "deadline", type: "uint64" },
  ],
};

export async function exerciseLocalGrowth({ rpcUrl, fixture, launch, onDeferred }) {
  const url = new URL(rpcUrl);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(fixture.chainId, 31337);
  const chain = defineChain({
    id: 31337, name: "Growth fixture", nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url.href] } },
  });
  const transport = http(url.href, { retryCount: 0 });
  const rpc = createPublicClient({ chain, transport, cacheTime: 0 });
  assert.equal(await rpc.getChainId(), 31337);
  const accounts = await rpc.request({ method: "eth_accounts" });
  const submitter = accounts[3];
  assert.ok(submitter);
  const wallet = (account) => createWalletClient({ account, chain, transport });
  const call = { address: fixture.vault, abi };
  const [token, poolId] = await rpc.readContract({ ...call, functionName: "launchContext" });
  assert.equal(token.toLowerCase(), launch.token.toLowerCase());
  assert.equal(poolId, launch.poolId);
  const [, , reference] = await rpc.readContract({ address: launch.factory, abi: previewAbi, functionName: "preview",
    args: [0, 8000, parseEther("0.1")] });
  assert.equal(reference, BigInt(launch.sqrtPriceX96));

  async function send(functionName, args) {
    const hash = await wallet(submitter).writeContract({ ...call, functionName, args, gas: 2_500_000n });
    const receipt = await rpc.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt.transactionHash;
  }
  const state = () => rpc.readContract({ ...call, functionName: "snapshot" });
  async function reviewedAttempt(referenceSqrtPriceX96, maxNativeIn, maxTokenIn, minLiquidity, expected) {
    const observedAt = (await rpc.getBlock()).timestamp;
    const order = {
      nonce: await rpc.readContract({ ...call, functionName: "nextNonce" }),
      maxNativeIn, maxTokenIn, minLiquidity, referenceSqrtPriceX96, maxSqrtDeviationBps: 50,
      observedAt, deadline: observedAt + 180n,
    };
    const typed = {
      domain: { name: "RMT V4 Growth Vault", version: "1", chainId: 31337, verifyingContract: fixture.vault },
      types: reviewTypes, primaryType: "Reinvestment", message: { poolId, token, ...order },
    };
    assert.equal(hashTypedData(typed), await rpc.readContract({ ...call, functionName: "planDigest", args: [order] }));
    // Both accounts are disposable fork fixtures. The review references the launch calculation before the small swaps.
    const [a, b] = await Promise.all([wallet(fixture.reviewerA).signTypedData(typed), wallet(fixture.reviewerB).signTypedData(typed)]);
    const hash = await send("reinvest", [order, a, b]);
    const after = await state();
    assert.equal(after.outcome, expected);
    assert.equal(await rpc.readContract({ ...call, functionName: "nextNonce" }), order.nonce + (expected === 1 ? 1n : 0n));
    return { hash, after };
  }

  assert.equal((await state()).nativeHeld, 0n);
  const insufficient = await reviewedAttempt(reference, parseEther("0.01"), parseEther("10"), 1n, 2);
  const collection = await send("collectReserve", [(await rpc.getBlock()).timestamp + 180n]);
  const held = await state();
  assert.ok(held.nativeHeld > 0n && held.tokenHeld > 0n);
  const deferred = await reviewedAttempt(reference * 102n / 100n, held.nativeHeld, held.tokenHeld, 1n, 3);
  assert.equal(deferred.after.nativeHeld, held.nativeHeld);
  assert.equal(deferred.after.tokenHeld, held.tokenHeld);
  await onDeferred();

  // Full-range limiting-leg lower bounds, with a conservative allowance for reviewed price movement.
  const q96 = 1n << 96n;
  const fromNative = held.nativeHeld * reference / q96;
  const fromToken = held.tokenHeld * q96 / reference;
  const minimum = (fromNative < fromToken ? fromNative : fromToken) * 99n / 100n;
  assert.ok(minimum > 0n);
  const added = await reviewedAttempt(reference, held.nativeHeld, held.tokenHeld, minimum, 1);
  assert.ok(added.after.liquidityAdded >= minimum && added.after.positionTokenId > 0n);
  assert.equal(added.after.nativeHeld + added.after.nativeAdded, held.nativeHeld);
  assert.equal(added.after.tokenHeld + added.after.tokenAdded, held.tokenHeld);
  return { insufficient: insufficient.hash, collection, deferred: deferred.hash, added: added.hash };
}
