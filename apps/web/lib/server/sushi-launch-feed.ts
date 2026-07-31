import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { ExternalProjectMetadata } from "../external-market";

const SUSHI_DATA_API = "https://production.data-gcp.sushi.com/api/graphql";
const SUSHI_LAUNCHPAD = "0x104F1Ab42674565EC3DF0BFEbCcC4186f72fA7ED";
const ROBINHOOD_CHAIN_ID = 4663;
const TIMEOUT_MS = 7_000;
const RESULTS_PER_LENS = 30;
const MAX_CANDIDATES = 72;

const QUERY = `
  query RmtSushiLaunchDiscovery($input: LaunchpadTokensInput!) {
    launchpad {
      tokens(input: $input) {
        edges {
          node {
            chainId
            address
            creator
            factoryAddress
            name
            symbol
            indexingStatus
            pool { address }
            metadata {
              description
              links { kind url }
            }
            createdAt
          }
        }
      }
    }
  }
`;

const linkSchema = z.object({
  kind: z.string().max(40),
  url: z.string().max(500)
});
const nodeSchema = z.object({
  chainId: z.number().int(),
  address: z.string(),
  creator: z.string(),
  factoryAddress: z.string(),
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(40),
  indexingStatus: z.string(),
  pool: z.object({ address: z.string() }),
  metadata: z.object({
    description: z.string().nullable().optional(),
    links: z.array(linkSchema).max(20)
  }).nullable().optional(),
  createdAt: z.string()
});
const payloadSchema = z.object({
  data: z.object({
    launchpad: z.object({
      tokens: z.object({
        edges: z.array(z.object({ node: nodeSchema })).max(RESULTS_PER_LENS)
      })
    })
  })
});

type SushiLaunchNode = z.infer<typeof nodeSchema>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SushiLaunchSnapshot = {
  projects: Map<string, ExternalProjectMetadata>;
  candidateAddresses: string[];
  delayed: boolean;
};

function safeUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function socialUrl(node: SushiLaunchNode, kinds: string[]) {
  const link = node.metadata?.links.find((item) => kinds.includes(item.kind.toLowerCase()));
  return safeUrl(link?.url);
}

function logoUrl(address: string) {
  return `https://cdn.sushi.com/tokens/${ROBINHOOD_CHAIN_ID}/${address.toLowerCase()}.jpg`;
}

function eligibleNode(node: SushiLaunchNode) {
  return node.chainId === ROBINHOOD_CHAIN_ID
    && node.indexingStatus === "CONFIRMED"
    && isAddress(node.address)
    && isAddress(node.creator)
    && isAddress(node.pool.address)
    && isAddress(node.factoryAddress)
    && node.factoryAddress.toLowerCase() === SUSHI_LAUNCHPAD.toLowerCase();
}

export function parseSushiLaunchProjects(payloads: unknown[]) {
  const projects = new Map<string, ExternalProjectMetadata>();
  const candidateAddresses: string[] = [];
  const seen = new Set<string>();

  for (const rawPayload of payloads) {
    const payload = payloadSchema.safeParse(rawPayload);
    if (!payload.success) continue;
    for (const { node } of payload.data.data.launchpad.tokens.edges) {
      if (!eligibleNode(node)) continue;
      const address = getAddress(node.address);
      const key = address.toLowerCase();
      if (!projects.has(key)) {
        projects.set(key, Object.freeze({
          sourceId: "sushi",
          sourceName: "Sushi Launch",
          provenance: "public-api-and-dex-pool-cross-checked",
          creator: getAddress(node.creator),
          launchPool: getAddress(node.pool.address),
          name: node.name.trim().slice(0, 80),
          symbol: node.symbol.trim().slice(0, 20),
          description: (node.metadata?.description ?? "").trim().slice(0, 1_000),
          imageUri: logoUrl(address),
          socials: Object.freeze({
            x: socialUrl(node, ["x", "twitter"]),
            telegram: socialUrl(node, ["telegram"]),
            discord: socialUrl(node, ["discord"]),
            website: socialUrl(node, ["homepage", "website"]),
            farcaster: socialUrl(node, ["farcaster"])
          })
        }));
      }
      if (!seen.has(key) && candidateAddresses.length < MAX_CANDIDATES) {
        seen.add(key);
        candidateAddresses.push(address);
      }
    }
  }

  return { projects, candidateAddresses };
}

async function fetchLens(sortBy: "CREATED_AT" | "VOLUME_24H" | "CURRENT_TVL", fetcher: FetchLike) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(SUSHI_DATA_API, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://sushi.com"
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          input: {
            chainId: ROBINHOOD_CHAIN_ID,
            first: RESULTS_PER_LENS,
            sortBy,
            sortDirection: "DESC"
          }
        }
      }),
      next: { revalidate: 30 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Sushi Launch discovery failed with ${response.status}.`);
    const payload: unknown = await response.json();
    if (!payloadSchema.safeParse(payload).success) {
      throw new Error("Sushi Launch discovery returned invalid data.");
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSushiLaunchSnapshot(
  dependencies: { fetch?: FetchLike } = {}
): Promise<SushiLaunchSnapshot> {
  const fetcher = dependencies.fetch ?? fetch;
  const results = await Promise.allSettled([
    fetchLens("CREATED_AT", fetcher),
    fetchLens("VOLUME_24H", fetcher),
    fetchLens("CURRENT_TVL", fetcher)
  ]);
  const payloads = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const parsed = parseSushiLaunchProjects(payloads);
  return {
    ...parsed,
    delayed: results.some((result) => result.status === "rejected")
  };
}
