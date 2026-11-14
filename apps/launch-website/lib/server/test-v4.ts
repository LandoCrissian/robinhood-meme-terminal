import { erc20Abi, getAddress, keccak256, parseAbi, parseEventLogs, zeroAddress,
  type Address, type Hash, type TransactionReceipt } from "viem";
import { testLpClaimSignature, testLpCollectSignature, testPermit2Lifetime, testPoolFeePips, testV4PermitSignature,
  testV4Pins, testV4PoolId, type TestLpAmounts, type TestV4Binding } from "../test-v4";
import { sameLifecycleValue as same, type TestLifecycleRequest, type TestLifecycleState } from "../test-lifecycle";
import type { CurveFixture, fixtureRpc, verifyCurveFixture } from "./curve-fixture";
import type { FixtureLaunch } from "./fixture-discovery";

const factoryAbi = parseAbi(["function graduationEngine() view returns (address)"]);
const graduationAbi = parseAbi([
  "function factory() view returns (address)", "function initializationGuard() view returns (address)",
  "function poolManager() view returns (address)", "function positionManager() view returns (address)", "function permit2() view returns (address)",
  "function lpFeeLedger(address token) view returns (address)", "function canonicalPoolKey(address token) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "function positions(address token) view returns (uint256 tokenId,uint128 liquidity)",
  "function previewLpFees(address token) view returns (uint256 nativeAmount,uint256 tokenAmount)",
  testLpCollectSignature,
]);
const lpLedgerAbi = parseAbi([
  "function engine() view returns (address)", "function poolManager() view returns (address)", "function token() view returns (address)",
  "function creator() view returns (address)", "function treasury() view returns (address)", "function treasuryShareBps() view returns (uint16)",
  "function operatingRecipient() view returns (address)", "function futureReserveRecipient() view returns (address)",
  "function totalAccrued() view returns (uint256 nativeAmount,uint256 tokenAmount)", "function totalClaimed() view returns (uint256 nativeAmount,uint256 tokenAmount)",
  "function claimable(address recipient) view returns (uint256 nativeAmount,uint256 tokenAmount)", testLpClaimSignature,
]);
const positionAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)", "function getApproved(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const curveAbi = parseAbi([
  "function graduated() view returns (bool)", "function poolId() view returns (bytes32)", "function positionTokenId() view returns (uint256)",
  "function operatingRecipient() view returns (address)", "function futureReserveRecipient() view returns (address)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  testV4PermitSignature,
  "event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)",
]);
type Rpc = ReturnType<typeof fixtureRpc>;
type Head = Awaited<ReturnType<typeof verifyCurveFixture>>;

export const fixtureLpAmounts = ([native, token]: readonly [bigint, bigint]): TestLpAmounts =>
  ({ nativeWei: native.toString(), tokenWei: token.toString() });
const equalAmounts = (a: TestLpAmounts, b: TestLpAmounts) => a.nativeWei === b.nativeWei && a.tokenWei === b.tokenWei;

async function assertRuntime(rpc: Rpc, address: Address, hash: Hash, blockNumber: bigint) {
  const code = await rpc.getCode({ address, blockNumber });
  if (!code || !same(keccak256(code), hash)) throw new Error("Fixture v4 runtime mismatch");
}

export async function assertV4Binding(rpc: Rpc, fixture: CurveFixture, token: Address, binding: TestV4Binding, blockNumber: bigint) {
  const pin = fixture.graduation;
  if (!pin || !same(pin.engine, binding.engine) || !same(pin.guard, binding.poolKey.hooks)) {
    throw new Error("Fixture graduation binding unavailable");
  }
  const at = { blockNumber };
  const read = { address: pin.engine, abi: graduationAbi, ...at } as const;
  const [boundEngine, boundFactory, guard, manager, positions, permit, ledger, poolKey] = await Promise.all([
    rpc.readContract({ address: fixture.factory, abi: factoryAbi, functionName: "graduationEngine", ...at }),
    rpc.readContract({ ...read, functionName: "factory" }), rpc.readContract({ ...read, functionName: "initializationGuard" }),
    rpc.readContract({ ...read, functionName: "poolManager" }), rpc.readContract({ ...read, functionName: "positionManager" }),
    rpc.readContract({ ...read, functionName: "permit2" }), rpc.readContract({ ...read, functionName: "lpFeeLedger", args: [token] }),
    rpc.readContract({ ...read, functionName: "canonicalPoolKey", args: [token] }),
    ...Object.values(testV4Pins).map(dependency => assertRuntime(rpc, dependency.address, dependency.hash, blockNumber)),
    assertRuntime(rpc, pin.engine, pin.engineRuntimeHash, blockNumber), assertRuntime(rpc, pin.guard, pin.guardRuntimeHash, blockNumber),
  ]);
  if (!same(boundEngine, pin.engine) || !same(boundFactory, fixture.factory) || !same(guard, pin.guard) ||
      !same(manager, testV4Pins.poolManager.address) || !same(positions, testV4Pins.positionManager.address)
      || !same(permit, testV4Pins.permit2.address) || !same(ledger, binding.ledger)
      || !same(await testV4PoolId(poolKey), binding.poolId)) throw new Error("Fixture v4 dependency binding mismatch");
}

export async function fixtureV4State(rpc: Rpc, fixture: CurveFixture, head: Head, launch: FixtureLaunch, account?: Address) {
  const { graduation, postGraduation } = launch.lifecycle;
  if (!graduation || !postGraduation || !fixture.graduation) throw new Error("Verified v4 graduation unavailable");
  const token = getAddress(launch.token.toLowerCase());
  const curve = getAddress(launch.initialCurve.toLowerCase());
  const binding: TestV4Binding = {
    engine: fixture.graduation.engine, ledger: getAddress(postGraduation.ledger.toLowerCase()), poolId: graduation.poolId as Hash,
    poolKey: { ...graduation.poolKey, currency0: zeroAddress, currency1: token, hooks: getAddress(graduation.poolKey.hooks.toLowerCase()) },
  };
  if (!same(postGraduation.router, testV4Pins.router.address) || !same(postGraduation.permit2, testV4Pins.permit2.address)
      || !same(postGraduation.quoter, testV4Pins.quoter.address) || !same(graduation.owner, binding.engine)
      || !same(graduation.poolManager, testV4Pins.poolManager.address) || !same(graduation.positionManager, testV4Pins.positionManager.address)) {
    throw new Error("Indexed post-graduation dependencies mismatch");
  }
  const at = { blockNumber: head.number };
  const lockedId = BigInt(graduation.positionTokenId);
  const engine = { address: binding.engine, abi: graduationAbi, ...at } as const;
  const curveCheck = { address: curve, abi: curveAbi, ...at } as const;
  const position = { address: testV4Pins.positionManager.address, abi: positionAbi, args: [lockedId], ...at } as const;
  const view = { address: testV4Pins.stateView.address, abi: stateViewAbi, args: [binding.poolId], ...at } as const;
  const ledger = { address: binding.ledger, abi: lpLedgerAbi, ...at } as const;
  const [locked, isGraduated, poolId, tokenId, owner, approval, liquidity, [positionKey, info], slot, activeLiquidity,
    uncollected, accrued, claimed, ledgerEngine, ledgerManager, ledgerToken, creator, treasury, share, operating, reserve, curveOperating,
    curveReserve, privateState] = await Promise.all([
    rpc.readContract({ ...engine, functionName: "positions", args: [token] }), rpc.readContract({ ...curveCheck, functionName: "graduated" }),
    rpc.readContract({ ...curveCheck, functionName: "poolId" }), rpc.readContract({ ...curveCheck, functionName: "positionTokenId" }),
    rpc.readContract({ ...position, functionName: "ownerOf" }), rpc.readContract({ ...position, functionName: "getApproved" }),
    rpc.readContract({ ...position, functionName: "getPositionLiquidity" }), rpc.readContract({ ...position, functionName: "getPoolAndPositionInfo" }),
    rpc.readContract({ ...view, functionName: "getSlot0" }), rpc.readContract({ ...view, functionName: "getLiquidity" }),
    rpc.readContract({ ...engine, functionName: "previewLpFees", args: [token] }),
    rpc.readContract({ ...ledger, functionName: "totalAccrued" }), rpc.readContract({ ...ledger, functionName: "totalClaimed" }),
    rpc.readContract({ ...ledger, functionName: "engine" }), rpc.readContract({ ...ledger, functionName: "poolManager" }),
    rpc.readContract({ ...ledger, functionName: "token" }), rpc.readContract({ ...ledger, functionName: "creator" }),
    rpc.readContract({ ...ledger, functionName: "treasury" }), rpc.readContract({ ...ledger, functionName: "treasuryShareBps" }),
    rpc.readContract({ ...ledger, functionName: "operatingRecipient" }), rpc.readContract({ ...ledger, functionName: "futureReserveRecipient" }),
    rpc.readContract({ ...curveCheck, functionName: "operatingRecipient" }), rpc.readContract({ ...curveCheck, functionName: "futureReserveRecipient" }),
    account ? Promise.all([
      rpc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, testV4Pins.permit2.address], ...at }),
      rpc.readContract({ address: testV4Pins.permit2.address, abi: permit2Abi, functionName: "allowance", args: [account, token, testV4Pins.router.address], ...at }),
      rpc.readContract({ ...ledger, functionName: "claimable", args: [account] }),
    ]) : undefined,
    assertV4Binding(rpc, fixture, token, binding, head.number),
  ]);
  const observedAtHead = head.number === BigInt(launch.lifecycle.observed.blockNumber);
  if (!isGraduated || !same(poolId, binding.poolId) || tokenId !== lockedId || locked[0] !== lockedId
      || !same(owner, binding.engine) || approval !== zeroAddress || liquidity !== BigInt(graduation.liquidityWei) || locked[1] !== liquidity
      || !same(await testV4PoolId(positionKey), binding.poolId) || BigInt.asIntN(24, info >> 8n) !== -887_220n || BigInt.asIntN(24, info >> 32n) !== 887_220n
      || slot[0] === 0n || slot[3] !== testPoolFeePips || activeLiquidity < liquidity
      || (observedAtHead && (slot[0].toString() !== graduation.spotSqrtPriceX96 || activeLiquidity.toString() !== graduation.poolLiquidityWei))
      || !same(ledgerEngine, binding.engine) || !same(ledgerManager, testV4Pins.poolManager.address) || !same(ledgerToken, token)
      || !same(creator, launch.creator) || !same(treasury, launch.treasury ?? zeroAddress) || share !== launch.treasuryShareBps
      || !same(operating, curveOperating) || !same(reserve, curveReserve)
      || !equalAmounts(fixtureLpAmounts(accrued), postGraduation.accrued) || !equalAmounts(fixtureLpAmounts(claimed), postGraduation.claimed)) {
    throw new Error("v4 live position and checkpoint disagree");
  }
  const provenCredit = account && postGraduation.beneficiaries.find(entry => same(entry.address, account));
  const expected = provenCredit ? provenCredit.claimable : fixtureLpAmounts([0n, 0n]);
  if ((privateState && !equalAmounts(fixtureLpAmounts(privateState[2]), expected)) || !head.hash
      || !same((await rpc.getBlock({ ...at, includeTransactions: false })).hash, head.hash)) throw new Error("LP credit or review block mismatch");
  const state: NonNullable<TestLifecycleState["postGraduation"]> = {
    poolId: binding.poolId, poolKey: binding.poolKey, router: testV4Pins.router.address, permit2: testV4Pins.permit2.address,
    ledger: binding.ledger, feeBps: 30,
    fees: { uncollected: fixtureLpAmounts(uncollected), collected: fixtureLpAmounts(accrued), claimed: fixtureLpAmounts(claimed),
      ...(privateState && { claimable: expected }) },
    ...(privateState && { balances: { erc20AllowanceWei: privateState[0].toString(), permit2AllowanceWei: privateState[1][0].toString(),
      permit2Expiration: privateState[1][1], chainTimestamp: Number(head.timestamp) } }),
  };
  return { state, binding };
}

export async function quoteFixtureV4(rpc: Rpc, head: Head, binding: TestV4Binding, account: Address, buy: boolean, amount: bigint) {
  const { result: [output] } = await rpc.simulateContract({
    address: testV4Pins.quoter.address, abi: quoterAbi, functionName: "quoteExactInputSingle", account, blockNumber: head.number,
    args: [{ poolKey: binding.poolKey, zeroForOne: buy, exactAmount: amount, hookData: "0x" }],
  });
  return output;
}

export function exactV4Approval(receipt: TransactionReceipt, request: TestLifecycleRequest) {
  if (request.operation === "v4-token-approve") {
    const events = parseEventLogs({ abi: erc20Abi, eventName: "Approval", logs: receipt.logs.filter(log => same(log.address, request.token)) });
    return events.length === 1 && same(events[0].args.owner, request.from) && same(events[0].args.spender, testV4Pins.permit2.address)
      && events[0].args.value === BigInt(request.amountWei);
  }
  const events = parseEventLogs({ abi: permit2Abi, eventName: "Approval", logs: receipt.logs.filter(log => same(log.address, testV4Pins.permit2.address)) });
  return events.length === 1 && same(events[0].args.owner, request.from) && same(events[0].args.token, request.token)
    && same(events[0].args.spender, testV4Pins.router.address) && events[0].args.amount === BigInt(request.amountWei)
    && BigInt(events[0].args.expiration) === BigInt(request.deadline) + testPermit2Lifetime;
}
