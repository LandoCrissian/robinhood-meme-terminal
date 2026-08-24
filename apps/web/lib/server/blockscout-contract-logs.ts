import { getAddress, isAddress, type Address, type Hash } from "viem";

const BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api/v2";
const MAX_RESPONSE_BYTES = 1_000_000;

export type VerifiedContractLog = {
  blockNumber: bigint;
  blockTimestamp: string;
  transactionHash: Hash;
  topics: readonly (Hash | null)[];
  data: Hash;
  method: string | null;
  parameters: ReadonlyMap<string, string>;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseLog(value: unknown): VerifiedContractLog | null {
  const item = object(value);
  const decoded = object(item.decoded);
  const blockNumber = typeof item.block_number === "number" && Number.isSafeInteger(item.block_number) && item.block_number >= 0
    ? BigInt(item.block_number)
    : null;
  const timestamp = typeof item.block_timestamp === "string" && Number.isFinite(Date.parse(item.block_timestamp))
    ? item.block_timestamp
    : null;
  const transactionHash = typeof item.transaction_hash === "string" && /^0x[0-9a-f]{64}$/i.test(item.transaction_hash)
    ? item.transaction_hash as Hash
    : null;
  const data = typeof item.data === "string" && /^0x[0-9a-f]*$/i.test(item.data)
    ? item.data as Hash
    : null;
  const rawTopics = Array.isArray(item.topics) ? item.topics : [];
  const topics = rawTopics.map((topic) => (
    typeof topic === "string" && /^0x[0-9a-f]{64}$/i.test(topic) ? topic as Hash : null
  ));
  if (blockNumber === null || !timestamp || !transactionHash || !data || topics.length < 1) return null;
  const parameters = new Map<string, string>();
  if (Array.isArray(decoded.parameters)) {
    for (const rawParameter of decoded.parameters) {
      const parameter = object(rawParameter);
      if (typeof parameter.name === "string" && typeof parameter.value === "string") {
        parameters.set(parameter.name, parameter.value);
      }
    }
  }
  return {
    blockNumber,
    blockTimestamp: timestamp,
    transactionHash,
    topics,
    data,
    method: typeof decoded.method_call === "string" ? decoded.method_call.slice(0, 500) : null,
    parameters
  };
}

function nextPageUrl(address: Address, value: unknown) {
  const next = object(object(value).next_page_params);
  const blockNumber = next.block_number;
  const index = next.index;
  const itemsCount = next.items_count;
  if (![blockNumber, index, itemsCount].every((entry) => typeof entry === "number" && Number.isSafeInteger(entry))) return null;
  const url = new URL(`${BLOCKSCOUT_API}/addresses/${address}/logs`);
  url.searchParams.set("block_number", String(blockNumber));
  url.searchParams.set("index", String(index));
  url.searchParams.set("items_count", String(itemsCount));
  return url;
}

async function readJson(url: URL, fetcher: FetchLike) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Blockscout log discovery failed with ${response.status}.`);
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) throw new Error("Blockscout log response exceeded its size limit.");
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new Error("Blockscout log response exceeded its size limit.");
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchVerifiedContractLogs(
  addressInput: string,
  options: { pages?: number; fetch?: FetchLike } = {}
) {
  if (!isAddress(addressInput, { strict: false })) throw new Error("A contract address is required for log discovery.");
  const address = getAddress(addressInput);
  const pages = Math.min(6, Math.max(1, Math.trunc(options.pages ?? 1)));
  const fetcher = options.fetch ?? fetch;
  const logs: VerifiedContractLog[] = [];
  let url: URL | null = new URL(`${BLOCKSCOUT_API}/addresses/${address}/logs`);
  for (let page = 0; page < pages && url; page += 1) {
    const payload = await readJson(url, fetcher);
    const items = object(payload).items;
    if (!Array.isArray(items)) throw new Error("Blockscout log discovery returned malformed data.");
    logs.push(...items.flatMap((item) => {
      const parsed = parseLog(item);
      return parsed ? [parsed] : [];
    }));
    url = nextPageUrl(address, payload);
  }
  return logs;
}
