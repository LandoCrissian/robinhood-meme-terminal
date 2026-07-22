import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import {
  ROBINHOOD_WETH,
  ponsFactoryAbi,
  ponsTokenAbi,
  safePonsImageUri,
  safePonsSocialUrl
} from "./pons-project-metadata";

export const NOXA_ACTIVE_FACTORY = getAddress("0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB");

const noxaSocialsAbi = [{
  type: "function",
  name: "socials",
  stateMutability: "view",
  inputs: [],
  outputs: [{
    name: "",
    type: "tuple",
    components: [
      { name: "telegram", type: "string" },
      { name: "twitter", type: "string" },
      { name: "website", type: "string" },
      { name: "discord", type: "string" },
      { name: "farcaster", type: "string" }
    ]
  }]
}] as const;

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

export type NoxaProjectMetadata = Readonly<{
  sourceId: "noxa";
  factory: Address;
  token: Address;
  creator: Address;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  pool: Address;
  pairedToken: Address;
  dexFactory: Address;
  positionManager: Address;
  positionId: bigint;
  poolFee: number;
  restrictionsEndBlock: bigint;
  initialBuyAmount: bigint;
  socials: Readonly<{
    x: string | null;
    telegram: string | null;
    discord: string | null;
    website: string | null;
    farcaster: string | null;
  }>;
  provenance: "factory-and-token-cross-checked";
}>;

export async function readNoxaProjectMetadata(
  client: PublicClient,
  tokenInput: Address,
  expectedPool?: Address
): Promise<NoxaProjectMetadata> {
  const token = getAddress(tokenInput);
  const launched = await client.readContract({
    address: NOXA_ACTIVE_FACTORY,
    abi: ponsFactoryAbi,
    functionName: "getLaunchedToken",
    args: [token]
  });
  if (!launched.exists || getAddress(launched.token) !== token) {
    throw new Error("Token is not recorded by the pinned Noxa factory");
  }

  const [name, symbol, logo, description, pool, creator, dexFactory, positionManager, pairedToken, poolFee, socials] =
    await Promise.all([
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "name" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "symbol" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "logo" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "description" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "liquidityPool" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "deployer" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "dexFactory" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "positionManager" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "pairToken" }),
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "poolFee" }),
      client.readContract({ address: token, abi: noxaSocialsAbi, functionName: "socials" })
    ]);

  const canonicalPool = getAddress(pool);
  if (expectedPool && canonicalPool !== getAddress(expectedPool)) {
    throw new Error("Noxa token pool does not match launch evidence");
  }
  if (
    getAddress(creator) !== getAddress(launched.deployer)
    || getAddress(positionManager) !== getAddress(launched.positionManager)
    || getAddress(pairedToken) !== getAddress(launched.pairedToken)
    || getAddress(pairedToken) !== ROBINHOOD_WETH
    || Number(poolFee) !== launched.poolFee
    || !isAddress(dexFactory)
  ) {
    throw new Error("Noxa token identity does not match its factory record");
  }

  return Object.freeze({
    sourceId: "noxa",
    factory: NOXA_ACTIVE_FACTORY,
    token,
    creator: getAddress(creator),
    name: bounded(name, 80),
    symbol: bounded(symbol, 20),
    description: bounded(description, 1_000),
    imageUri: safePonsImageUri(logo),
    pool: canonicalPool,
    pairedToken: getAddress(pairedToken),
    dexFactory: getAddress(dexFactory),
    positionManager: getAddress(positionManager),
    positionId: launched.positionId,
    poolFee: Number(poolFee),
    restrictionsEndBlock: launched.restrictionsEndBlock,
    initialBuyAmount: launched.initialBuyAmount,
    socials: Object.freeze({
      x: safePonsSocialUrl(socials.twitter),
      telegram: safePonsSocialUrl(socials.telegram),
      discord: safePonsSocialUrl(socials.discord),
      website: safePonsSocialUrl(socials.website),
      farcaster: safePonsSocialUrl(socials.farcaster)
    }),
    provenance: "factory-and-token-cross-checked"
  });
}

export async function readNoxaProjectMetadataBatch(
  client: PublicClient,
  tokenInputs: readonly Address[]
) {
  const tokens = [...new Map(tokenInputs.map((token) => {
    const address = getAddress(token);
    return [address.toLowerCase(), address] as const;
  })).values()];
  if (tokens.length === 0) return new Map<string, NoxaProjectMetadata>();

  const launchedTokens: Address[] = [];
  const maximumConcurrentReads = 8;
  for (let index = 0; index < tokens.length; index += maximumConcurrentReads) {
    const chunk = tokens.slice(index, index + maximumConcurrentReads);
    const launchRecords = await Promise.all(chunk.map((token) => client.readContract({
      address: NOXA_ACTIVE_FACTORY,
      abi: ponsFactoryAbi,
      functionName: "getLaunchedToken",
      args: [token]
    }).catch(() => null)));
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const token = chunk[offset];
      const record = launchRecords[offset];
      if (token && record?.exists && getAddress(record.token) === token) launchedTokens.push(token);
    }
  }

  const resolved = await Promise.all(launchedTokens.map(async (token) => {
    const metadata = await readNoxaProjectMetadata(client, token);
    return [token.toLowerCase(), metadata] as const;
  }));
  return new Map(resolved);
}
