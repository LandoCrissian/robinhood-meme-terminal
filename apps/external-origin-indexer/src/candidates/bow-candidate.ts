export const BOW_FACTORY =
  "0xc70e510e14710ea535cab7b2414860af63feab79" as const;
export const BOW_LAUNCHED_TOPIC =
  "0xec774f0683e9ac48e8d835f412f9f877a8a5dee9af3170d78cf3ef33149d15e7" as const;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const WORD_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export type BowRawLaunchedLog = Readonly<{
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  removed?: boolean;
}>;

export type DecodedBowLaunch = Readonly<{
  token: `0x${string}`;
  creator: `0x${string}`;
  pool: `0x${string}`;
  positionId: bigint;
  launchId: bigint;
}>;

function normalizeAddress(value: string, name: string): `0x${string}` {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(name + " must be an exact EVM address");
  }
  const normalized = value.toLowerCase() as `0x${string}`;
  if (normalized === ZERO_ADDRESS) {
    throw new Error(name + " must be nonzero");
  }
  return normalized;
}

function requireHash(value: string, name: string): `0x${string}` {
  if (!HASH_PATTERN.test(value)) {
    throw new Error(name + " must be a 32-byte hash");
  }
  const normalized = value.toLowerCase() as `0x${string}`;
  if (normalized === ZERO_HASH) {
    throw new Error(name + " must be nonzero");
  }
  return normalized;
}

function decodeAddressWord(value: string, name: string): `0x${string}` {
  if (!WORD_PATTERN.test(value)) {
    throw new Error(name + " must be one ABI word");
  }
  const word = value.slice(2).toLowerCase();
  if (word.slice(0, 24) !== "0".repeat(24)) {
    throw new Error(name + " must be a canonically padded address");
  }
  return normalizeAddress(`0x${word.slice(24)}`, name);
}

function splitDataWords(data: string) {
  if (!/^0x[0-9a-fA-F]{192}$/.test(data)) {
    throw new Error("Bow Launched data must contain exactly three ABI words");
  }
  const hex = data.slice(2);
  return [
    `0x${hex.slice(0, 64)}`,
    `0x${hex.slice(64, 128)}`,
    `0x${hex.slice(128, 192)}`
  ] as const;
}

export function decodeBowLaunchedLog(
  log: BowRawLaunchedLog
): DecodedBowLaunch {
  if (log.removed) throw new Error("Removed Bow logs are not canonical evidence");
  if (log.blockNumber < bowCandidate.deployment.blockNumber) {
    throw new Error("Bow log predates the pinned factory deployment");
  }
  requireHash(log.blockHash, "blockHash");
  requireHash(log.transactionHash, "transactionHash");
  if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) {
    throw new Error("logIndex must be a nonnegative safe integer");
  }
  if (normalizeAddress(log.address, "emitter") !== BOW_FACTORY) {
    throw new Error("Bow log emitter does not match the pinned factory");
  }
  if (log.topics.length !== 3) {
    throw new Error("Bow Launched must contain exactly three topics");
  }
  const topic0 = requireHash(log.topics[0] ?? "", "topic0");
  if (topic0 !== BOW_LAUNCHED_TOPIC) {
    throw new Error("Bow log topic0 does not match Launched");
  }
  const token = decodeAddressWord(log.topics[1] ?? "", "token");
  const creator = decodeAddressWord(log.topics[2] ?? "", "creator");
  const [poolWord, positionWord, launchWord] = splitDataWords(log.data);
  return Object.freeze({
    token,
    creator,
    pool: decodeAddressWord(poolWord, "pool"),
    positionId: BigInt(positionWord),
    launchId: BigInt(launchWord)
  });
}

export const bowCandidate = Object.freeze({
  candidateId: "bow-current-2026-07-11",
  sourceId: "bow",
  sourceName: "Bow.fun",
  sourceUrl: "https://bow.fun/",
  evidenceUrl: "https://bow.fun/docs.html",
  explorerUrl:
    "https://robinhoodchain.blockscout.com/address/0xC70E510E14710Ea535CAB7b2414860aF63FEab79",
  chainId: 4663,
  factory: BOW_FACTORY,
  deployment: Object.freeze({
    transactionHash:
      "0x54a20612978b020ac01cdf2ea9e38ae2d679373942502118ee614b40956d38e4",
    blockNumber: 7_158_095n,
    blockHash:
      "0xfe25444d15866ce7fcb22a009148836eb98b45670908d8144b5c5fb38d1a8409"
  }),
  runtime: Object.freeze({
    lengthBytes: 16_318,
    codeHash:
      "0x8d56cbcdf72dbf04ed8170d55878cc894997ccc54c2ab0aec782274eb7fe7a14"
  }),
  creationEvent: Object.freeze({
    abi: "Launched(address indexed token,address indexed deployer,address pool,uint256 positionId,uint256 launchId)",
    canonicalSignature: "Launched(address,address,address,uint256,uint256)",
    topic0: BOW_LAUNCHED_TOPIC
  }),
  sourceVerification: "unverified_at_review",
  activationEligible: false,
  activationBlockers: Object.freeze([
    "explorer_source_unverified",
    "rpc_backfill_not_implemented",
    "independent_shadow_comparison_not_completed"
  ]),
  reviewedAt: "2026-07-15"
} as const);
