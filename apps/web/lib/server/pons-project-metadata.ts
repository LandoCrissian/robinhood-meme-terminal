import { getAddress, isAddress, type Address, type PublicClient } from "viem";

export const PONS_ACTIVE_FACTORY = getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB");
export const ROBINHOOD_WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");

export const ponsFactoryAbi = [{
  type: "function",
  name: "getLaunchedToken",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{
    name: "launched",
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "deployer", type: "address" },
      { name: "pairedToken", type: "address" },
      { name: "positionManager", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "dexId", type: "uint256" },
      { name: "launchConfigId", type: "uint256" },
      { name: "restrictionsEndBlock", type: "uint256" },
      { name: "supply", type: "uint256" },
      { name: "isToken0", type: "bool" },
      { name: "poolFee", type: "uint24" },
      { name: "exists", type: "bool" },
      { name: "initialBuyAmount", type: "uint256" }
    ]
  }]
}] as const;

export const ponsTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "liquidityPool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "dexFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "positionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pairToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  {
    type: "function",
    name: "socials",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" }
    ]
  }
] as const;

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

export function safePonsImageUri(value: string) {
  const uri = bounded(value, 500);
  if (uri.startsWith("ipfs://") && uri.length > 7) return uri;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (/\.(?:svg|html?|xml)(?:$|[?#])/i.test(parsed.pathname)) return null;
    return parsed.href.slice(0, 500);
  } catch {
    return null;
  }
}

export function safePonsSocialUrl(value: string) {
  const uri = bounded(value, 500);
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href.slice(0, 500);
  } catch {
    return null;
  }
}

export type PonsProjectMetadata = Readonly<{
  sourceId: "pons";
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

export async function readPonsProjectMetadata(
  client: PublicClient,
  tokenInput: Address,
  expectedPool?: Address
): Promise<PonsProjectMetadata> {
  const token = getAddress(tokenInput);
  const launched = await client.readContract({
    address: PONS_ACTIVE_FACTORY,
    abi: ponsFactoryAbi,
    functionName: "getLaunchedToken",
    args: [token]
  });
  if (!launched.exists || getAddress(launched.token) !== token) {
    throw new Error("Token is not recorded by the pinned pons factory");
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
      client.readContract({ address: token, abi: ponsTokenAbi, functionName: "socials" })
    ]);

  const canonicalPool = getAddress(pool);
  if (expectedPool && canonicalPool !== getAddress(expectedPool)) {
    throw new Error("pons token pool does not match launch evidence");
  }
  if (
    getAddress(creator) !== getAddress(launched.deployer)
    || getAddress(positionManager) !== getAddress(launched.positionManager)
    || getAddress(pairedToken) !== getAddress(launched.pairedToken)
    || getAddress(pairedToken) !== ROBINHOOD_WETH
    || Number(poolFee) !== launched.poolFee
    || !isAddress(dexFactory)
  ) {
    throw new Error("pons token identity does not match its factory record");
  }

  return Object.freeze({
    sourceId: "pons",
    factory: PONS_ACTIVE_FACTORY,
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
      x: safePonsSocialUrl(socials[0]),
      telegram: safePonsSocialUrl(socials[1]),
      discord: safePonsSocialUrl(socials[2]),
      website: safePonsSocialUrl(socials[3]),
      farcaster: safePonsSocialUrl(socials[4])
    }),
    provenance: "factory-and-token-cross-checked"
  });
}

export async function readPonsProjectMetadataBatch(
  client: PublicClient,
  tokenInputs: readonly Address[]
) {
  const tokens = [...new Map(tokenInputs.map((token) => {
    const address = getAddress(token);
    return [address.toLowerCase(), address] as const;
  })).values()];
  if (tokens.length === 0) return new Map<string, PonsProjectMetadata>();

  const launchedTokens: Address[] = [];
  const maximumConcurrentReads = 8;
  for (let index = 0; index < tokens.length; index += maximumConcurrentReads) {
    const chunk = tokens.slice(index, index + maximumConcurrentReads);
    const launchRecords = await Promise.all(chunk.map((token) => client.readContract({
      address: PONS_ACTIVE_FACTORY,
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
    const metadata = await readPonsProjectMetadata(client, token);
    return [token.toLowerCase(), metadata] as const;
  }));
  return new Map(resolved);
}
