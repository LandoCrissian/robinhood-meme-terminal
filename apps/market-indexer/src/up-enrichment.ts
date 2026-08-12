import {
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { UP_VOTER, type MarketSource } from "./sources.js";

const factoryAbi = parseAbi([
  "function isPool(address pool) view returns (bool)"
]);
const v2FactoryAbi = parseAbi([
  "function getFee(address pool, bool stable) view returns (uint256)"
]);
const clPoolAbi = parseAbi([
  "function fee() view returns (uint24)"
]);
const voterAbi = parseAbi([
  "function gauges(address pool) view returns (address)",
  "function isAlive(address gauge) view returns (bool)",
  "function weights(address pool) view returns (uint256)",
  "function claimable(address gauge) view returns (uint256)",
  "function gaugeToFees(address gauge) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)"
]);

export type UpPoolEvidence = Readonly<{
  sourceId: "up-v2" | "up-cl";
  poolAddress: string;
  liveFee: number;
  feeDenominator: 10_000 | 1_000_000;
  gaugeAddress: string | null;
  gaugeAlive: boolean | null;
  gaugeWeight: string | null;
  gaugeClaimable: string | null;
  feesAddress: string | null;
  bribeAddress: string | null;
  observedBlock: bigint;
  observedBlockHash: Hex;
}>;

function lower(value: Address) {
  return getAddress(value).toLowerCase();
}

function checkedFee(value: number | bigint, maximum: number, label: string) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} is outside the reviewed fee domain`);
  }
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > BigInt(maximum)) {
    throw new Error(`${label} is outside the reviewed fee domain`);
  }
  return Number(normalized);
}

export function isUpSource(
  source: MarketSource
): source is MarketSource & { id: "up-v2" | "up-cl" } {
  return source.id === "up-v2" || source.id === "up-cl";
}

export async function readUpPoolEvidence(
  rpc: PublicClient,
  source: MarketSource,
  poolAddress: Address,
  stable: boolean | null,
  observedBlock: bigint,
  observedBlockHash: Hex
): Promise<UpPoolEvidence> {
  if (!isUpSource(source)) throw new Error("up enrichment requires an up source");
  if (source.id === "up-v2" && stable === null) {
    throw new Error("up v2 enrichment requires the pool's stable identity");
  }
  if (source.id === "up-cl" && stable !== null) {
    throw new Error("up CL pools must not carry a v2 stable identity");
  }

  const [registered, gauge, rawFee] = await Promise.all([
    rpc.readContract({
      address: source.contract,
      abi: factoryAbi,
      functionName: "isPool",
      args: [poolAddress],
      blockNumber: observedBlock
    }),
    rpc.readContract({
      address: UP_VOTER.contract,
      abi: voterAbi,
      functionName: "gauges",
      args: [poolAddress],
      blockNumber: observedBlock
    }),
    source.id === "up-v2"
      ? rpc.readContract({
          address: source.contract,
          abi: v2FactoryAbi,
          functionName: "getFee",
          args: [poolAddress, stable!],
          blockNumber: observedBlock
        })
      : rpc.readContract({
          address: poolAddress,
          abi: clPoolAbi,
          functionName: "fee",
          blockNumber: observedBlock
        })
  ]);

  if (!registered) {
    throw new Error(`${source.id} factory no longer recognizes ${poolAddress}`);
  }
  const feeDenominator = source.id === "up-v2" ? 10_000 : 1_000_000;
  const liveFee = checkedFee(
    rawFee,
    source.id === "up-v2" ? 300 : feeDenominator,
    `${source.id} live fee`
  );
  const normalizedPool = lower(poolAddress);
  if (gauge === zeroAddress) {
    return Object.freeze({
      sourceId: source.id,
      poolAddress: normalizedPool,
      liveFee,
      feeDenominator,
      gaugeAddress: null,
      gaugeAlive: null,
      gaugeWeight: null,
      gaugeClaimable: null,
      feesAddress: null,
      bribeAddress: null,
      observedBlock,
      observedBlockHash: observedBlockHash.toLowerCase() as Hex
    });
  }

  const [gaugeAlive, gaugeWeight, gaugeClaimable, feesAddress, bribeAddress] =
    await Promise.all([
      rpc.readContract({
        address: UP_VOTER.contract,
        abi: voterAbi,
        functionName: "isAlive",
        args: [gauge],
        blockNumber: observedBlock
      }),
      rpc.readContract({
        address: UP_VOTER.contract,
        abi: voterAbi,
        functionName: "weights",
        args: [poolAddress],
        blockNumber: observedBlock
      }),
      rpc.readContract({
        address: UP_VOTER.contract,
        abi: voterAbi,
        functionName: "claimable",
        args: [gauge],
        blockNumber: observedBlock
      }),
      rpc.readContract({
        address: UP_VOTER.contract,
        abi: voterAbi,
        functionName: "gaugeToFees",
        args: [gauge],
        blockNumber: observedBlock
      }),
      rpc.readContract({
        address: UP_VOTER.contract,
        abi: voterAbi,
        functionName: "gaugeToBribe",
        args: [gauge],
        blockNumber: observedBlock
      })
    ]);

  if (feesAddress === zeroAddress || bribeAddress === zeroAddress) {
    throw new Error(`${source.id} gauge incentive evidence is incomplete`);
  }
  return Object.freeze({
    sourceId: source.id,
    poolAddress: normalizedPool,
    liveFee,
    feeDenominator,
    gaugeAddress: lower(gauge),
    gaugeAlive,
    gaugeWeight: gaugeWeight.toString(),
    gaugeClaimable: gaugeClaimable.toString(),
    feesAddress: lower(feesAddress),
    bribeAddress: lower(bribeAddress),
    observedBlock,
    observedBlockHash: observedBlockHash.toLowerCase() as Hex
  });
}
