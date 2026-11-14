import { isLaunchAddress, robinhoodChainId, type LaunchBlock, type LaunchReceipt } from "./launch-data";

export type CurveRegistration = {
  kind: "curve-launch-v1";
  status: "created";
  chainId: typeof robinhoodChainId;
  engineVersion: 1;
  factory: string;
  projectRegistry: string;
  token: string;
  initialCurve: string;
  creator: string;
  name: string;
  symbol: string;
  creation: LaunchReceipt;
  checkpoint: LaunchBlock & { confirmations: number; finality: "l2-confirmed"; l1Finality: "unverified" };
};

type CurveObservation = {
  at: LaunchBlock;
  engine: string;
  version: number;
  soldWei: string;
  backingWei: string;
  targetSoldWei: string;
  targetBackingWei: string;
};

type GraduationObservation = {
  receipt: LaunchReceipt;
  engine: string;
  version: number;
  market: {
    poolManager: string;
    positionManager: string;
    poolId: string;
    poolKey: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
    positionId: string;
    owner: string;
    liquidity: string;
    nativeDepositedWei: string;
    tokenDepositedWei: string;
  };
};

export type CurveLaunch = { registration: CurveRegistration } & (
  | { state: "created" | "unknown" }
  | { state: "active" | "graduating"; observation: CurveObservation }
  | { state: "graduated"; observation: GraduationObservation }
);

export type CurveLifecycle =
  | { stage: "proposed"; label: "Proposed token draft" }
  | { stage: "created" | "unknown"; label: string }
  | { stage: "active" | "graduating"; label: string; observation: CurveObservation }
  | { stage: "graduated"; label: string; observation: GraduationObservation };

export type NewEngineDirectory =
  | { status: "prelaunch" | "unavailable" }
  | { status: "ready"; launches: readonly CurveLaunch[] };

export const proposedCurveLifecycle = { stage: "proposed", label: "Proposed token draft" } as const;

const unknown = { stage: "unknown", label: "Lifecycle unverified" } as const;
const native = "0x" + "0".repeat(40);
const hash = (value: string) => /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value);
const address = (value: string) => isLaunchAddress(value) && value.toLowerCase() !== native;
const uint = (value: string) => /^(0|[1-9][0-9]{0,77})$/.test(value);

function isBlock(block: LaunchBlock) {
  return uint(block.blockNumber) && hash(block.blockHash)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(block.timestamp) && Number.isFinite(Date.parse(block.timestamp));
}

function between(block: LaunchBlock, start: LaunchBlock, end: LaunchBlock) {
  return isBlock(block) && BigInt(block.blockNumber) >= BigInt(start.blockNumber)
    && BigInt(block.blockNumber) <= BigInt(end.blockNumber)
    && Date.parse(block.timestamp) >= Date.parse(start.timestamp) && Date.parse(block.timestamp) <= Date.parse(end.timestamp)
    && [start, end].every((bound) => bound.blockNumber !== block.blockNumber
      || bound.blockHash.toLowerCase() === block.blockHash.toLowerCase());
}

function isReceipt(value: LaunchReceipt) {
  return isBlock(value) && hash(value.transactionHash) && Number.isSafeInteger(value.logIndex) && value.logIndex >= 0;
}

function comesAfter(receipt: LaunchReceipt, creation: LaunchReceipt) {
  return BigInt(receipt.blockNumber) > BigInt(creation.blockNumber) || receipt.logIndex > creation.logIndex;
}

export function hasCurveRegistration(record: CurveRegistration) {
  const { creation, checkpoint } = record;
  return record.kind === "curve-launch-v1" && record.status === "created" && record.chainId === robinhoodChainId
    && record.engineVersion === 1 && [record.factory, record.projectRegistry, record.token, record.initialCurve, record.creator].every(address)
    && isReceipt(creation) && isBlock(checkpoint) && between(creation, creation, checkpoint)
    && checkpoint.finality === "l2-confirmed" && checkpoint.l1Finality === "unverified"
    && Number.isSafeInteger(checkpoint.confirmations) && checkpoint.confirmations >= 20;
}

function isEngine(registration: CurveRegistration, engine: string, version: number) {
  return address(engine) && Number.isSafeInteger(version) && version >= 1 && version <= 32 &&
    (engine.toLowerCase() === registration.initialCurve.toLowerCase()) === (version === 1);
}

export function describeCurveLifecycle(launch: CurveLaunch): CurveLifecycle {
  const { registration } = launch;
  if (!hasCurveRegistration(registration)) return unknown;
  if (launch.state === "created") return { stage: "created", label: "Creation confirmed" };
  if (launch.state === "active" || launch.state === "graduating") {
    const observation = launch.observation;
    const { soldWei, backingWei, targetSoldWei, targetBackingWei } = observation;
    if (!isEngine(registration, observation.engine, observation.version)
        || !between(observation.at, registration.creation, registration.checkpoint)
        || ![soldWei, backingWei, targetSoldWei, targetBackingWei].every(uint)
        || targetSoldWei === "0" || targetBackingWei === "0"
        || BigInt(soldWei) > BigInt(targetSoldWei) || BigInt(backingWei) > BigInt(targetBackingWei)) return unknown;
    const ready = soldWei === targetSoldWei && backingWei === targetBackingWei;
    if (ready !== (launch.state === "graduating")) return unknown;
    return { stage: launch.state, label: ready ? "Ready to graduate" : "Active bonding curve", observation };
  }
  if (launch.state === "graduated") {
    const observation = launch.observation;
    const { market, receipt } = observation;
    const { poolKey } = market;
    if (!isEngine(registration, observation.engine, observation.version) || !isReceipt(receipt)
        || !between(receipt, registration.creation, registration.checkpoint)
        || !comesAfter(receipt, registration.creation)
        || ![market.poolManager, market.positionManager, market.owner, poolKey.hooks].every(address)
        || !hash(market.poolId) || poolKey.currency0.toLowerCase() !== native
        || poolKey.currency1.toLowerCase() !== registration.token.toLowerCase()
        || poolKey.fee !== 3000 || poolKey.tickSpacing !== 60
        || ![market.positionId, market.liquidity, market.nativeDepositedWei, market.tokenDepositedWei]
          .every((amount) => uint(amount) && amount !== "0")) return unknown;
    return { stage: "graduated", label: "Graduated to Uniswap v4", observation };
  }
  return unknown;
}
