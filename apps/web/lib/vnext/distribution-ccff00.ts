import {
  getAddress,
  isAddress,
  isHash,
  keccak256,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import {
  MAX_DISTRIBUTION_ROWS,
  RMT_DISTRIBUTION_CHAIN_ID,
  buildDistributionManifestV1,
  canonicalDistributionJson,
  type BuildDistributionManifestInput,
  type DistributionManifestV1
} from "./distribution-domain";

export const CCFF00_ADAPTER_ID = "ccff00_public_tba_v1" as const;
export const CCFF00_COLLECTION = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
export const CCFF00_TOKEN = getAddress("0x73CB777311Dc5e464C53Ddafb4496Fd87fE0eC97");
export const CCFF00_RMT_TOKEN = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");
export const CCFF00_ERC6551_REGISTRY = getAddress("0x000000006551c19487814612e58FE06813775758");
export const CCFF00_ACCOUNT_IMPLEMENTATION = getAddress("0x03dA8C9df253a4401b08629a6F50E4c4E8e248cC");
export const CCFF00_ERC6551_SALT = "0x448cc5ed5a52db42393a3d48476af932464724d8262648ad18b66d2ffef1a8e0" as Hex;
export const CCFF00_TOKENS_PER_NFT_ATOMIC = 10_000n * 10n ** 18n;
export const CCFF00_CANARY_TOKEN_IDS = [470n, 471n, 472n] as const;

const PUBLIC_START_ID = 1n;
const PUBLIC_SUPPLY = 9_750n;
const FOUNDER_START_ID = 9_751n;
const PROJECT_START_ID = 9_771n;
const FOUNDER_RESERVE = 20n;
const PROJECT_RESERVE = 230n;
const TOTAL_RESERVE = 250n;
const SNAPSHOT_SCHEMA_VERSION = 1 as const;
const SNAPSHOT_DOMAIN = keccak256(new TextEncoder().encode("RMT_CCFF00_PUBLIC_TBA_SNAPSHOT_V1"));
const ZERO_HASH = `0x${"0".repeat(64)}`;

const collectionAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function publicMinted() view returns (uint256)",
  "function reserveMinted() view returns (uint256)",
  "function PUBLIC_START_ID() view returns (uint256)",
  "function PUBLIC_SUPPLY() view returns (uint256)",
  "function FOUNDER_START_ID() view returns (uint256)",
  "function PROJECT_START_ID() view returns (uint256)",
  "function FOUNDER_RESERVE() view returns (uint256)",
  "function PROJECT_RESERVE() view returns (uint256)",
  "function TOTAL_RESERVE() view returns (uint256)",
  "function erc6551Registry() view returns (address)",
  "function erc6551Implementation() view returns (address)",
  "function erc6551Salt() view returns (bytes32)",
  "function accountChainId() view returns (uint256)",
  "function ccff00Token() view returns (address)",
  "function TOKENS_PER_NFT() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getTokenBoundAccount(uint256 tokenId) view returns (address)"
]);

const erc20BalanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export type Ccff00SnapshotCoverage = "canaries" | "full_public";

export type Ccff00SnapshotRowV1 = {
  tokenId: string;
  owner: Address;
  tokenBoundAccount: Address;
  activated: boolean;
  accountRuntimeHash: Hex | null;
  ccff00BalanceAtomic: string;
  rmtBalanceAtomic: string;
};

export type Ccff00PublicSnapshotV1 = {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  adapterId: typeof CCFF00_ADAPTER_ID;
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  coverage: Ccff00SnapshotCoverage;
  snapshotBlock: string;
  snapshotBlockHash: Hex;
  collection: Address;
  collectionRuntimeHash: Hex;
  ccff00Token: Address;
  ccff00RuntimeHash: Hex;
  rmtToken: Address;
  rmtRuntimeHash: Hex;
  erc6551Registry: Address;
  erc6551RegistryRuntimeHash: Hex;
  accountImplementation: Address;
  accountImplementationRuntimeHash: Hex;
  erc6551Salt: Hex;
  accountChainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  tokensPerNftAtomic: string;
  publicStartTokenId: string;
  publicSupply: string;
  publicMinted: string;
  founderStartTokenId: string;
  founderReserve: string;
  projectStartTokenId: string;
  projectReserve: string;
  reserveMinted: string;
  totalReserve: string;
  totalSupply: string;
  rows: Ccff00SnapshotRowV1[];
  snapshotHash: Hex;
};

export type Ccff00ReadClient = {
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ number: bigint; hash: Hex | null }>;
  getBytecode(input: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  readContract(input: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
  }): Promise<unknown>;
};

const rowSchema = z.object({
  tokenId: z.string(), owner: z.string(), tokenBoundAccount: z.string(), activated: z.boolean(),
  accountRuntimeHash: z.string().nullable(), ccff00BalanceAtomic: z.string(), rmtBalanceAtomic: z.string()
}).strict();

const snapshotSchema = z.object({
  schemaVersion: z.literal(1), adapterId: z.literal(CCFF00_ADAPTER_ID), chainId: z.literal(4_663),
  coverage: z.enum(["canaries", "full_public"]), snapshotBlock: z.string(), snapshotBlockHash: z.string(),
  collection: z.string(), collectionRuntimeHash: z.string(), ccff00Token: z.string(), ccff00RuntimeHash: z.string(),
  rmtToken: z.string(), rmtRuntimeHash: z.string(), erc6551Registry: z.string(), erc6551RegistryRuntimeHash: z.string(),
  accountImplementation: z.string(), accountImplementationRuntimeHash: z.string(), erc6551Salt: z.string(),
  accountChainId: z.literal(4_663), tokensPerNftAtomic: z.string(), publicStartTokenId: z.string(), publicSupply: z.string(),
  publicMinted: z.string(), founderStartTokenId: z.string(), founderReserve: z.string(), projectStartTokenId: z.string(),
  projectReserve: z.string(), reserveMinted: z.string(), totalReserve: z.string(), totalSupply: z.string(),
  rows: z.array(rowSchema), snapshotHash: z.string()
}).strict();

function reject(message: string): never {
  throw new Error(`RMT rejected CCFF00 snapshot evidence: ${message}`);
}

function unsigned(value: unknown, label: string, allowZero = true): bigint {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    return reject(`${label} is not an unsigned integer`);
  }
  if (parsed < 0n || (!allowZero && parsed === 0n)) reject(`${label} is outside its allowed range`);
  return parsed;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) reject(`${label} is not an address`);
  return getAddress(value);
}

function hash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHash(value) || value.toLowerCase() === ZERO_HASH) reject(`${label} is not a nonzero bytes32 hash`);
  return value.toLowerCase() as Hex;
}

function runtimeHash(bytecode: Hex | undefined, label: string): Hex {
  if (!bytecode || bytecode === "0x") reject(`${label} has no runtime bytecode`);
  return keccak256(bytecode);
}

function snapshotContent(value: Omit<Ccff00PublicSnapshotV1, "snapshotHash">): Hex {
  return keccak256(new TextEncoder().encode(canonicalDistributionJson({ domain: SNAPSHOT_DOMAIN, ...value })));
}

async function inChunks<T, R>(
  values: readonly T[],
  size: number,
  interChunkDelayMs: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const output: R[] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(...await Promise.all(values.slice(offset, offset + size).map(task)));
    if (interChunkDelayMs > 0 && offset + size < values.length) {
      await new Promise((resolve) => setTimeout(resolve, interChunkDelayMs));
    }
  }
  return output;
}

async function read(client: Ccff00ReadClient, functionName: string, blockNumber: bigint, args: readonly unknown[] = []) {
  return client.readContract({ address: CCFF00_COLLECTION, abi: collectionAbi, functionName, args, blockNumber });
}

function assertExact(label: string, actual: bigint | Address | Hex, expected: bigint | Address | Hex) {
  if (typeof actual === "bigint" && typeof expected === "bigint") {
    if (actual !== expected) reject(`${label} is inconsistent`);
    return;
  }
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) reject(`${label} is inconsistent`);
}

export async function readCcff00PublicSnapshotV1(
  client: Ccff00ReadClient,
  options: { coverage?: Ccff00SnapshotCoverage; snapshotBlock?: bigint; concurrency?: number; interChunkDelayMs?: number } = {}
): Promise<Ccff00PublicSnapshotV1> {
  const coverage = options.coverage ?? "canaries";
  const blockNumber = options.snapshotBlock ?? await client.getBlockNumber();
  if (blockNumber <= 0n) reject("snapshot block is invalid");
  const concurrency = options.concurrency ?? 20;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 50) reject("read concurrency is invalid");
  const interChunkDelayMs = options.interChunkDelayMs ?? 0;
  if (!Number.isSafeInteger(interChunkDelayMs) || interChunkDelayMs < 0 || interChunkDelayMs > 10_000) reject("read throttle is invalid");
  const block = await client.getBlock({ blockNumber });
  if (block.number !== blockNumber || !block.hash) reject("snapshot block identity is unavailable");

  const [
    totalSupplyValue, publicMintedValue, reserveMintedValue, publicStartValue, publicSupplyValue,
    founderStartValue, projectStartValue, founderReserveValue, projectReserveValue, totalReserveValue,
    registryValue, implementationValue, saltValue, accountChainValue, ccff00Value, tokensPerNftValue,
    collectionCode, registryCode, implementationCode, ccff00Code, rmtCode
  ] = await Promise.all([
    read(client, "totalSupply", blockNumber), read(client, "publicMinted", blockNumber), read(client, "reserveMinted", blockNumber),
    read(client, "PUBLIC_START_ID", blockNumber), read(client, "PUBLIC_SUPPLY", blockNumber),
    read(client, "FOUNDER_START_ID", blockNumber), read(client, "PROJECT_START_ID", blockNumber),
    read(client, "FOUNDER_RESERVE", blockNumber), read(client, "PROJECT_RESERVE", blockNumber), read(client, "TOTAL_RESERVE", blockNumber),
    read(client, "erc6551Registry", blockNumber), read(client, "erc6551Implementation", blockNumber),
    read(client, "erc6551Salt", blockNumber), read(client, "accountChainId", blockNumber), read(client, "ccff00Token", blockNumber),
    read(client, "TOKENS_PER_NFT", blockNumber),
    client.getBytecode({ address: CCFF00_COLLECTION, blockNumber }), client.getBytecode({ address: CCFF00_ERC6551_REGISTRY, blockNumber }),
    client.getBytecode({ address: CCFF00_ACCOUNT_IMPLEMENTATION, blockNumber }), client.getBytecode({ address: CCFF00_TOKEN, blockNumber }),
    client.getBytecode({ address: CCFF00_RMT_TOKEN, blockNumber })
  ]);

  const totalSupply = unsigned(totalSupplyValue, "total supply");
  const publicMinted = unsigned(publicMintedValue, "public minted");
  const reserveMinted = unsigned(reserveMintedValue, "reserve minted");
  assertExact("public start", unsigned(publicStartValue, "public start"), PUBLIC_START_ID);
  assertExact("public supply", unsigned(publicSupplyValue, "public supply"), PUBLIC_SUPPLY);
  assertExact("founder start", unsigned(founderStartValue, "founder start"), FOUNDER_START_ID);
  assertExact("project start", unsigned(projectStartValue, "project start"), PROJECT_START_ID);
  assertExact("founder reserve", unsigned(founderReserveValue, "founder reserve"), FOUNDER_RESERVE);
  assertExact("project reserve", unsigned(projectReserveValue, "project reserve"), PROJECT_RESERVE);
  assertExact("total reserve", unsigned(totalReserveValue, "total reserve"), TOTAL_RESERVE);
  assertExact("registry", address(registryValue, "registry"), CCFF00_ERC6551_REGISTRY);
  assertExact("account implementation", address(implementationValue, "account implementation"), CCFF00_ACCOUNT_IMPLEMENTATION);
  assertExact("salt", hash(saltValue, "ERC-6551 salt"), CCFF00_ERC6551_SALT);
  assertExact("account chain", unsigned(accountChainValue, "account chain"), BigInt(RMT_DISTRIBUTION_CHAIN_ID));
  assertExact("CCFF00 token", address(ccff00Value, "CCFF00 token"), CCFF00_TOKEN);
  assertExact("tokens per NFT", unsigned(tokensPerNftValue, "tokens per NFT"), CCFF00_TOKENS_PER_NFT_ATOMIC);
  if (publicMinted > PUBLIC_SUPPLY || publicMinted > BigInt(MAX_DISTRIBUTION_ROWS)) reject("public mint count exceeds the admitted boundary");
  if (reserveMinted > TOTAL_RESERVE || totalSupply !== publicMinted + reserveMinted) reject("public/reserve supply accounting is inconsistent");
  if (coverage === "canaries" && publicMinted < CCFF00_CANARY_TOKEN_IDS.at(-1)!) reject("canary token IDs are not yet public-minted");

  const tokenIds = coverage === "full_public"
    ? Array.from({ length: Number(publicMinted) }, (_, index) => PUBLIC_START_ID + BigInt(index))
    : [...CCFF00_CANARY_TOKEN_IDS];
  const rows = await inChunks(tokenIds, concurrency, interChunkDelayMs, async (tokenId): Promise<Ccff00SnapshotRowV1> => {
    const [ownerValue, tbaValue] = await Promise.all([
      read(client, "ownerOf", blockNumber, [tokenId]),
      read(client, "getTokenBoundAccount", blockNumber, [tokenId])
    ]);
    const owner = address(ownerValue, `ownerOf(${tokenId})`);
    const tokenBoundAccount = address(tbaValue, `getTokenBoundAccount(${tokenId})`);
    const [code, ccff00Balance, rmtBalance] = await Promise.all([
      client.getBytecode({ address: tokenBoundAccount, blockNumber }),
      client.readContract({ address: CCFF00_TOKEN, abi: erc20BalanceAbi, functionName: "balanceOf", args: [tokenBoundAccount], blockNumber }),
      client.readContract({ address: CCFF00_RMT_TOKEN, abi: erc20BalanceAbi, functionName: "balanceOf", args: [tokenBoundAccount], blockNumber })
    ]);
    return {
      tokenId: tokenId.toString(),
      owner,
      tokenBoundAccount,
      activated: Boolean(code && code !== "0x"),
      accountRuntimeHash: code && code !== "0x" ? keccak256(code) : null,
      ccff00BalanceAtomic: unsigned(ccff00Balance, `CCFF00 balance for ${tokenId}`).toString(),
      rmtBalanceAtomic: unsigned(rmtBalance, `RMT balance for ${tokenId}`).toString()
    };
  });

  const content: Omit<Ccff00PublicSnapshotV1, "snapshotHash"> = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    adapterId: CCFF00_ADAPTER_ID,
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    coverage,
    snapshotBlock: blockNumber.toString(),
    snapshotBlockHash: hash(block.hash, "snapshot block hash"),
    collection: CCFF00_COLLECTION,
    collectionRuntimeHash: runtimeHash(collectionCode, "CCFF00 collection"),
    ccff00Token: CCFF00_TOKEN,
    ccff00RuntimeHash: runtimeHash(ccff00Code, "CCFF00 token"),
    rmtToken: CCFF00_RMT_TOKEN,
    rmtRuntimeHash: runtimeHash(rmtCode, "RMT token"),
    erc6551Registry: CCFF00_ERC6551_REGISTRY,
    erc6551RegistryRuntimeHash: runtimeHash(registryCode, "ERC-6551 registry"),
    accountImplementation: CCFF00_ACCOUNT_IMPLEMENTATION,
    accountImplementationRuntimeHash: runtimeHash(implementationCode, "CCFF00 account implementation"),
    erc6551Salt: CCFF00_ERC6551_SALT,
    accountChainId: RMT_DISTRIBUTION_CHAIN_ID,
    tokensPerNftAtomic: CCFF00_TOKENS_PER_NFT_ATOMIC.toString(),
    publicStartTokenId: PUBLIC_START_ID.toString(),
    publicSupply: PUBLIC_SUPPLY.toString(),
    publicMinted: publicMinted.toString(),
    founderStartTokenId: FOUNDER_START_ID.toString(),
    founderReserve: FOUNDER_RESERVE.toString(),
    projectStartTokenId: PROJECT_START_ID.toString(),
    projectReserve: PROJECT_RESERVE.toString(),
    reserveMinted: reserveMinted.toString(),
    totalReserve: TOTAL_RESERVE.toString(),
    totalSupply: totalSupply.toString(),
    rows
  };
  return parseCcff00PublicSnapshotV1({ ...content, snapshotHash: snapshotContent(content) });
}

export function parseCcff00PublicSnapshotV1(value: unknown): Ccff00PublicSnapshotV1 {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) reject("snapshot schema is malformed");
  const candidate = result.data as Ccff00PublicSnapshotV1;
  const normalized: Ccff00PublicSnapshotV1 = {
    ...candidate,
    snapshotBlock: unsigned(candidate.snapshotBlock, "snapshot block", false).toString(),
    snapshotBlockHash: hash(candidate.snapshotBlockHash, "snapshot block hash"),
    collection: address(candidate.collection, "collection"),
    collectionRuntimeHash: hash(candidate.collectionRuntimeHash, "collection runtime"),
    ccff00Token: address(candidate.ccff00Token, "CCFF00 token"),
    ccff00RuntimeHash: hash(candidate.ccff00RuntimeHash, "CCFF00 runtime"),
    rmtToken: address(candidate.rmtToken, "RMT token"),
    rmtRuntimeHash: hash(candidate.rmtRuntimeHash, "RMT runtime"),
    erc6551Registry: address(candidate.erc6551Registry, "ERC-6551 registry"),
    erc6551RegistryRuntimeHash: hash(candidate.erc6551RegistryRuntimeHash, "registry runtime"),
    accountImplementation: address(candidate.accountImplementation, "account implementation"),
    accountImplementationRuntimeHash: hash(candidate.accountImplementationRuntimeHash, "account implementation runtime"),
    erc6551Salt: hash(candidate.erc6551Salt, "ERC-6551 salt"),
    tokensPerNftAtomic: unsigned(candidate.tokensPerNftAtomic, "tokens per NFT", false).toString(),
    publicStartTokenId: unsigned(candidate.publicStartTokenId, "public start", false).toString(),
    publicSupply: unsigned(candidate.publicSupply, "public supply", false).toString(),
    publicMinted: unsigned(candidate.publicMinted, "public minted").toString(),
    founderStartTokenId: unsigned(candidate.founderStartTokenId, "founder start", false).toString(),
    founderReserve: unsigned(candidate.founderReserve, "founder reserve", false).toString(),
    projectStartTokenId: unsigned(candidate.projectStartTokenId, "project start", false).toString(),
    projectReserve: unsigned(candidate.projectReserve, "project reserve", false).toString(),
    reserveMinted: unsigned(candidate.reserveMinted, "reserve minted").toString(),
    totalReserve: unsigned(candidate.totalReserve, "total reserve", false).toString(),
    totalSupply: unsigned(candidate.totalSupply, "total supply").toString(),
    rows: candidate.rows.map((row) => ({
      tokenId: unsigned(row.tokenId, "row token ID", false).toString(),
      owner: address(row.owner, "row owner"),
      tokenBoundAccount: address(row.tokenBoundAccount, "row token-bound account"),
      activated: row.activated,
      accountRuntimeHash: row.accountRuntimeHash === null ? null : hash(row.accountRuntimeHash, "account runtime"),
      ccff00BalanceAtomic: unsigned(row.ccff00BalanceAtomic, "row CCFF00 balance").toString(),
      rmtBalanceAtomic: unsigned(row.rmtBalanceAtomic, "row RMT balance").toString()
    })),
    snapshotHash: hash(candidate.snapshotHash, "snapshot hash")
  };
  assertExact("collection", normalized.collection, CCFF00_COLLECTION);
  assertExact("CCFF00 token", normalized.ccff00Token, CCFF00_TOKEN);
  assertExact("RMT token", normalized.rmtToken, CCFF00_RMT_TOKEN);
  assertExact("registry", normalized.erc6551Registry, CCFF00_ERC6551_REGISTRY);
  assertExact("account implementation", normalized.accountImplementation, CCFF00_ACCOUNT_IMPLEMENTATION);
  assertExact("salt", normalized.erc6551Salt, CCFF00_ERC6551_SALT);
  assertExact("tokens per NFT", BigInt(normalized.tokensPerNftAtomic), CCFF00_TOKENS_PER_NFT_ATOMIC);
  assertExact("public start", BigInt(normalized.publicStartTokenId), PUBLIC_START_ID);
  assertExact("public supply", BigInt(normalized.publicSupply), PUBLIC_SUPPLY);
  assertExact("founder start", BigInt(normalized.founderStartTokenId), FOUNDER_START_ID);
  assertExact("founder reserve", BigInt(normalized.founderReserve), FOUNDER_RESERVE);
  assertExact("project start", BigInt(normalized.projectStartTokenId), PROJECT_START_ID);
  assertExact("project reserve", BigInt(normalized.projectReserve), PROJECT_RESERVE);
  assertExact("total reserve", BigInt(normalized.totalReserve), TOTAL_RESERVE);
  if (BigInt(normalized.publicMinted) > PUBLIC_SUPPLY || BigInt(normalized.publicMinted) > BigInt(MAX_DISTRIBUTION_ROWS)) reject("public mint count exceeds the admitted boundary");
  if (BigInt(normalized.reserveMinted) > TOTAL_RESERVE || BigInt(normalized.totalSupply) !== BigInt(normalized.publicMinted) + BigInt(normalized.reserveMinted)) {
    reject("public/reserve supply accounting is inconsistent");
  }
  const sortedRows = [...normalized.rows].sort((left, right) => BigInt(left.tokenId) < BigInt(right.tokenId) ? -1 : BigInt(left.tokenId) > BigInt(right.tokenId) ? 1 : 0);
  if (canonicalDistributionJson(sortedRows) !== canonicalDistributionJson(normalized.rows)) reject("snapshot rows are not canonically ordered");
  if (new Set(normalized.rows.map((row) => row.tokenId)).size !== normalized.rows.length) reject("snapshot contains duplicate token IDs");
  if (new Set(normalized.rows.map((row) => row.tokenBoundAccount.toLowerCase())).size !== normalized.rows.length) reject("snapshot contains duplicate token-bound accounts");
  for (const row of normalized.rows) {
    if (row.activated !== (row.accountRuntimeHash !== null)) reject("account activation and runtime evidence disagree");
  }
  const expectedIds = normalized.coverage === "full_public"
    ? Array.from({ length: Number(BigInt(normalized.publicMinted)) }, (_, index) => (PUBLIC_START_ID + BigInt(index)).toString())
    : CCFF00_CANARY_TOKEN_IDS.map(String);
  if (canonicalDistributionJson(normalized.rows.map((row) => row.tokenId)) !== canonicalDistributionJson(expectedIds)) {
    reject("snapshot coverage does not match its declared token IDs");
  }
  const { snapshotHash, ...content } = normalized;
  if (snapshotContent(content) !== snapshotHash) reject("snapshot content hash is inconsistent");
  return normalized;
}

export function validateCcff00Canaries(snapshotValue: unknown) {
  const snapshot = parseCcff00PublicSnapshotV1(snapshotValue);
  const expected = new Map<string, Address>([
    ["470", getAddress("0xFd1fDC1d3aA3AeEA37b265C691C7D367cBb20a6e")],
    ["471", getAddress("0xF26b9c1ecA9489A1AdCe201fB82630889cfe6246")],
    ["472", getAddress("0x3b71916De0aE9a4e2303dD6fCe66A8f6555c83D5")]
  ]);
  const rows = CCFF00_CANARY_TOKEN_IDS.map((tokenId) => {
    const row = snapshot.rows.find((candidate) => candidate.tokenId === tokenId.toString());
    if (!row) reject(`canary #${tokenId} is absent`);
    assertExact(`canary #${tokenId} TBA`, row.tokenBoundAccount, expected.get(tokenId.toString())!);
    if (BigInt(row.ccff00BalanceAtomic) !== CCFF00_TOKENS_PER_NFT_ATOMIC) reject(`canary #${tokenId} CCFF00 funding is inconsistent`);
    return row;
  });
  const blockers: string[] = [];
  if (!rows.every((row) => BigInt(row.rmtBalanceAtomic) >= 10n ** 18n)) blockers.push("three 1-RMT canary deposits are not proven");
  if (!rows.some((row) => row.activated)) blockers.push("no canary token-bound account is activated");
  blockers.push("owner-controlled RMT withdrawal proof has not been admitted");
  return {
    canaries: rows,
    exactAddressesVerified: true,
    exactCcff00FundingVerified: true,
    oneRmtEachVerified: rows.every((row) => BigInt(row.rmtBalanceAtomic) >= 10n ** 18n),
    activatedCanaryCount: rows.filter((row) => row.activated).length,
    ownerWithdrawalProofVerified: false,
    massDistributionEligible: false,
    blockers
  };
}

export function buildCcff00RmtDropManifestV1(input: {
  snapshot: unknown;
  sender: string;
  rmtPerTokenBoundAccount: string;
  infrastructure: BuildDistributionManifestInput["infrastructure"];
  gasEvidence: BuildDistributionManifestInput["gasEvidence"];
}): { manifest: DistributionManifestV1; releaseBlockers: string[] } {
  const snapshot = parseCcff00PublicSnapshotV1(input.snapshot);
  if (snapshot.coverage !== "full_public") reject("a complete public snapshot is required for manifest generation");
  if (getAddress(input.infrastructure.rmtToken) !== snapshot.rmtToken) reject("planner RMT identity differs from snapshot evidence");
  if (String(input.infrastructure.rmtTokenRuntimeHash).toLowerCase() !== snapshot.rmtRuntimeHash) reject("planner RMT runtime differs from snapshot evidence");
  if (!snapshot.rows.every((row) => BigInt(row.ccff00BalanceAtomic) === CCFF00_TOKENS_PER_NFT_ATOMIC)) {
    reject("not every public token-bound account has the configured CCFF00 funding evidence");
  }
  const manifest = buildDistributionManifestV1({
    sender: input.sender,
    actionKind: "erc20_equal",
    asset: { chainId: RMT_DISTRIBUTION_CHAIN_ID, address: snapshot.rmtToken, standard: "erc20", decimals: 18 },
    csv: `recipient\n${snapshot.rows.map((row) => row.tokenBoundAccount).join("\n")}\n`,
    equalAmount: input.rmtPerTokenBoundAccount,
    sourceEvidence: {
      snapshotBlock: snapshot.snapshotBlock,
      sourceId: "ccff00.public-tba.snapshot-v1",
      evidenceHash: snapshot.snapshotHash
    },
    infrastructure: input.infrastructure,
    gasEvidence: input.gasEvidence
  });
  return {
    manifest,
    releaseBlockers: [
      "three 1-RMT canary deposits are not proven",
      "an activated canary account is not proven",
      "owner-controlled RMT withdrawal is not proven",
      "distribution engine is not deployed or publicly activated",
      "wallet and server submission remain disabled"
    ]
  };
}
