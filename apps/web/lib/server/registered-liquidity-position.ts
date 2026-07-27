import {
  createPublicClient,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type PublicClient
} from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import type { TokenRiskEvidence } from "../token-risk-evidence";
import {
  NOXA_ACTIVE_FACTORY
} from "./noxa-project-metadata";
import {
  PONS_ACTIVE_FACTORY,
  ponsFactoryAbi
} from "./pons-project-metadata";

const DEAD_ADDRESS = getAddress("0x000000000000000000000000000000000000dEaD");

const positionManagerAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getApproved", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "uint96" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "int24" },
      { type: "uint128" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" }
    ]
  }
] as const;

const v3FactoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
  outputs: [{ type: "address" }]
}] as const;

export type RegisteredLiquiditySource = "pons" | "noxa";

export type RegisteredLiquidityPositionRead = {
  manager: Address;
  positionId: bigint;
  owner: Address;
  approvedOperator: Address;
  creatorApprovedForAll: boolean | null;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  canonicalPair: Address;
  managerCode: `0x${string}` | undefined;
  ownerCode: `0x${string}` | undefined;
};

export function classifyRegisteredLiquidityPosition(params: {
  creator?: Address;
  owner: Address;
  approvedOperator: Address;
  creatorApprovedForAll: boolean | null;
  ownerHasCode: boolean;
}): Pick<
  TokenRiskEvidence["liquidity"],
  "controlStatus" | "creatorCanTransfer"
> {
  const creatorCanTransfer = params.creator
    ? params.owner.toLowerCase() === params.creator.toLowerCase()
      || params.approvedOperator.toLowerCase() === params.creator.toLowerCase()
      || params.creatorApprovedForAll === true
    : null;
  if (params.owner.toLowerCase() === DEAD_ADDRESS.toLowerCase()) {
    return { controlStatus: "burn-address", creatorCanTransfer: false };
  }
  if (creatorCanTransfer) {
    return { controlStatus: "creator-controlled", creatorCanTransfer: true };
  }
  if (params.ownerHasCode) {
    return {
      controlStatus: "contract-held",
      creatorCanTransfer: null
    };
  }
  return {
    controlStatus: "third-party-wallet",
    creatorCanTransfer
  };
}

const defaultClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

async function readRegisteredPosition(
  client: PublicClient,
  params: {
    token: Address;
    pair: Address;
    creator?: Address;
    sourceId: RegisteredLiquiditySource;
  }
): Promise<RegisteredLiquidityPositionRead> {
  const launchFactory = params.sourceId === "pons" ? PONS_ACTIVE_FACTORY : NOXA_ACTIVE_FACTORY;
  const launched = await client.readContract({
    address: launchFactory,
    abi: ponsFactoryAbi,
    functionName: "getLaunchedToken",
    args: [params.token]
  });
  if (
    !launched.exists
    || getAddress(launched.token) !== params.token
    || launched.positionId <= 0n
    || getAddress(launched.positionManager) === zeroAddress
  ) {
    throw new Error("The launchpad did not publish a valid liquidity position.");
  }

  const manager = getAddress(launched.positionManager);
  const positionId = launched.positionId;
  const [factory, owner, approvedOperator, position, managerCode] = await Promise.all([
    client.readContract({ address: manager, abi: positionManagerAbi, functionName: "factory" }),
    client.readContract({ address: manager, abi: positionManagerAbi, functionName: "ownerOf", args: [positionId] }),
    client.readContract({ address: manager, abi: positionManagerAbi, functionName: "getApproved", args: [positionId] }),
    client.readContract({ address: manager, abi: positionManagerAbi, functionName: "positions", args: [positionId] }),
    client.getBytecode({ address: manager })
  ]);
  const token0 = getAddress(position[2]);
  const token1 = getAddress(position[3]);
  const fee = Number(position[4]);
  const ownerAddress = getAddress(owner);
  const factoryAddress = getAddress(factory);
  const [canonicalPair, ownerCode, creatorApprovedForAll] = await Promise.all([
    client.readContract({
      address: factoryAddress,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [token0, token1, fee]
    }),
    client.getBytecode({ address: ownerAddress }),
    params.creator
      ? client.readContract({
          address: manager,
          abi: positionManagerAbi,
          functionName: "isApprovedForAll",
          args: [ownerAddress, params.creator]
        }).catch(() => null)
      : Promise.resolve(null)
  ]);
  return {
    manager,
    positionId,
    owner: ownerAddress,
    approvedOperator: getAddress(approvedOperator),
    creatorApprovedForAll,
    token0,
    token1,
    fee,
    liquidity: position[7],
    canonicalPair: getAddress(canonicalPair),
    managerCode,
    ownerCode
  };
}

export async function resolveRegisteredLiquidityPosition(
  params: {
    token: Address;
    pair: Address;
    creator?: Address;
    sourceId?: RegisteredLiquiditySource;
  },
  dependencies: {
    client?: PublicClient;
    readPosition?: (
      params: {
        token: Address;
        pair: Address;
        creator?: Address;
        sourceId: RegisteredLiquiditySource;
      }
    ) => Promise<RegisteredLiquidityPositionRead>;
  } = {}
): Promise<TokenRiskEvidence["liquidity"]> {
  const empty: TokenRiskEvidence["liquidity"] = {
    controlStatus: "not-proven",
    evidenceSource: "none",
    positionManager: null,
    positionId: null,
    owner: null,
    approvedOperator: null,
    creatorCanTransfer: null,
    positionLiquidity: null
  };
  if (!params.sourceId) return empty;

  try {
    const read = dependencies.readPosition
      ? await dependencies.readPosition({ ...params, sourceId: params.sourceId })
      : await readRegisteredPosition(dependencies.client ?? defaultClient, { ...params, sourceId: params.sourceId });
    const poolTokens = [read.token0.toLowerCase(), read.token1.toLowerCase()];
    if (
      !read.managerCode
      || read.managerCode === "0x"
      || read.canonicalPair.toLowerCase() !== params.pair.toLowerCase()
      || !poolTokens.includes(params.token.toLowerCase())
      || read.fee <= 0
      || read.fee >= 1_000_000
      || read.liquidity <= 0n
    ) {
      return empty;
    }
    const classified = classifyRegisteredLiquidityPosition({
      creator: params.creator,
      owner: read.owner,
      approvedOperator: read.approvedOperator,
      creatorApprovedForAll: read.creatorApprovedForAll,
      ownerHasCode: Boolean(read.ownerCode && read.ownerCode !== "0x")
    });
    return {
      ...classified,
      evidenceSource: "launchpad-registry",
      positionManager: read.manager,
      positionId: read.positionId.toString(),
      owner: read.owner,
      approvedOperator: read.approvedOperator === zeroAddress ? null : read.approvedOperator,
      positionLiquidity: read.liquidity.toString()
    };
  } catch {
    return empty;
  }
}
