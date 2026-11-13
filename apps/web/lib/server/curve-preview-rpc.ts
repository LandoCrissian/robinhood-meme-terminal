import { keccak256, zeroAddress, type Address, type Hex } from "viem";
import { curveAbi, curveFactoryAbi, curveGraduationAbi, curveRegistryAbi, sameCurveAddress } from "../launchpad/curve-v1";
import { launchPoolId } from "../launchpad/launch-record";
import type { CurveRuntime, verifiedCurveRuntime } from "./curve-launch-config";
import { CurveLaunchIndex } from "./curve-launch-index";
import type { CurvePreviewProject, CurvePreviewRpcPolicy } from "./launchpad-preview-rpc";

export type CurvePreviewGatewayConfig = {
  curveRuntime: CurveRuntime;
  verified: Awaited<ReturnType<typeof verifiedCurveRuntime>>;
};

export function createCurvePreviewRpcPolicy({ curveRuntime, verified }: CurvePreviewGatewayConfig, wallet: Address): CurvePreviewRpcPolicy {
  const { rpc, browser, economicRules } = verified;
  const { deployment, curve } = browser;
  if (!curve || !deployment.initializationGuard || !deployment.privateCurvePreview || deployment.universalRouterVersion !== "2.1.2"
    || new URL(curveRuntime.rpcUrl).hostname !== "127.0.0.1") throw new Error("Missing isolated curve preview bindings.");
  const hook = deployment.initializationGuard;
  const { graduationEngine, projectRegistry, creationFee } = curve;
  const pinnedTargets = { factory: deployment.factory, graduationEngine, projectRegistry, poolManager: deployment.poolManager,
    positionManager: deployment.positionManager, permit2: deployment.permit2, router: deployment.universalRouter,
    quoter: deployment.quoter, stateView: deployment.stateView, guard: hook };

  async function canonicalBlock(hash: Hex, height: bigint) {
    return (await rpc.getBlock({ blockNumber: height, includeTransactions: false })).hash === hash;
  }

  async function lookup(target: Address): Promise<CurvePreviewProject | undefined> {
    const index = new CurveLaunchIndex(curveRuntime);
    let launch, graduation, collection;
    try {
      launch = index.previewTarget(target, wallet);
      if (!launch) return;
      graduation = index.graduation(launch.token);
      collection = index.collection(launch.token);
    } finally { index.close(); }

    const { token, ledger } = launch;
    const block = await rpc.getBlock({ includeTransactions: false });
    if (!block.hash || block.number === null || block.number < BigInt(launch.blockNumber)
      || !await canonicalBlock(launch.blockHash, BigInt(launch.blockNumber))) return;
    const at = { blockHash: block.hash, requireCanonical: true } as const;
    const factory = { address: deployment.factory, abi: curveFactoryAbi, args: [token], ...at } as const;
    const [activeCurve, origin, [registeredFactory, registeredCurve, version, registeredEngine]] = await Promise.all([
      rpc.readContract({ ...factory, functionName: "curveForToken" }),
      rpc.readContract({ ...factory, functionName: "originCurveForToken" }),
      rpc.readContract({ address: projectRegistry, abi: curveRegistryAbi, functionName: "project", args: [token], ...at }),
    ]);
    if (activeCurve === zeroAddress || !sameCurveAddress(origin, launch.curve) || !sameCurveAddress(registeredFactory, deployment.factory)
      || !sameCurveAddress(registeredCurve, activeCurve) || !sameCurveAddress(registeredEngine, activeCurve)) return;
    const active = { address: activeCurve, abi: curveAbi, ...at } as const;
    const [isActive, graduated, rules, currentVersion, currentLedger, lpLedger] = await Promise.all([
      rpc.readContract({ ...active, functionName: "active" }), rpc.readContract({ ...active, functionName: "graduated" }),
      rpc.readContract({ ...active, functionName: "economicRules" }), rpc.readContract({ ...active, functionName: "executionVersion" }),
      rpc.readContract({ ...active, functionName: "revenueLedger" }),
      rpc.readContract({ address: graduationEngine, abi: curveGraduationAbi, functionName: "lpFeeLedger", args: [token], ...at }),
    ]);
    if ((!isActive && !graduated) || rules !== economicRules || version !== currentVersion || !sameCurveAddress(ledger, currentLedger)) return;
    let poolId: Hex | undefined;
    if (graduated) {
      if (!graduation || !await canonicalBlock(graduation.blockHash, BigInt(graduation.blockNumber))) return;
      poolId = await rpc.readContract({ ...active, functionName: "poolId" });
      if (poolId !== launchPoolId({ currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook })) return;
    }
    let targetRole: CurvePreviewProject["targetRole"];
    if (sameCurveAddress(target, token)) targetRole = "token";
    else if (sameCurveAddress(target, activeCurve)) targetRole = "activeCurve";
    else if (sameCurveAddress(target, ledger)) targetRole = "curveLedger";
    else if (sameCurveAddress(target, lpLedger) && collection && sameCurveAddress(collection.ledger, lpLedger)
      && await canonicalBlock(collection.blockHash, BigInt(collection.blockNumber))) targetRole = "lpLedger";
    else {
      // Prior engines can supply historical trace evidence. They can never receive another signed trade.
      const prior = { address: target, abi: curveAbi, ...at } as const;
      const [priorToken, priorFactory, priorLedger] = await Promise.all([
        rpc.readContract({ ...prior, functionName: "token" }), rpc.readContract({ ...prior, functionName: "factory" }),
        rpc.readContract({ ...prior, functionName: "revenueLedger" }),
      ]);
      if (!sameCurveAddress(priorToken, token) || !sameCurveAddress(priorFactory, deployment.factory) || !sameCurveAddress(priorLedger, ledger)) return;
      targetRole = "previousCurve";
    }
    if (!await canonicalBlock(block.hash, block.number)) return;
    return { token, activeCurve, poolId, targetRole };
  }

  return {
    runtime: { deployment, startBlock: curveRuntime.startBlock,
      contracts: Object.fromEntries(Object.entries(pinnedTargets).map(([name, address]) => [name, { address }])) },
    wallet, readTransaction: (hash) => rpc.getTransaction({ hash }),
    curve: { creationFee: BigInt(creationFee.amountWei), graduationEngine, lookup, canonicalBlock,
      async timestamp() {
        if (await rpc.getChainId() !== 31337) throw new Error("The isolated test chain changed.");
        const block = await rpc.getBlock({ includeTransactions: false });
        if (!block.hash || block.number === null || block.number < curveRuntime.startBlock) throw new Error("The isolated test chain is unavailable.");
        const code = await rpc.getCode({ address: deployment.factory, blockHash: block.hash, requireCanonical: true });
        if (!code || keccak256(code) !== curveRuntime.factoryHash.toLowerCase()) throw new Error("The isolated factory changed.");
        return block.timestamp;
      } },
  };
}
