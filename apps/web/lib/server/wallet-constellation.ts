import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { z } from "zod";
import { tokenRiskDecision } from "../token-risk-policy";
import type { TokenRiskEvidence } from "../token-risk-evidence";
import type {
  WalletConstellationEdge,
  WalletConstellationGraph,
  WalletConstellationNode,
  WalletConstellationNodeRole
} from "../wallet-constellation";

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const MAX_TIMEOUT_MS = 12_000;
const MAX_TRANSACTION_HASHES_PER_EDGE = 5;

const addressEvidenceSchema = z.object({
  hash: z.string(),
  is_contract: z.boolean().optional(),
  is_scam: z.boolean().optional(),
  name: z.string().nullable().optional()
}).passthrough();

const transferSchema = z.object({
  from: addressEvidenceSchema,
  to: addressEvidenceSchema,
  total: z.object({
    value: z.string().regex(/^\d+$/)
  }).passthrough(),
  transaction_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  timestamp: z.string().datetime({ offset: true })
}).passthrough();

const transferPageSchema = z.object({
  items: z.array(transferSchema).max(100),
  next_page_params: z.record(z.unknown()).nullable().optional()
}).passthrough();

type TransferPage = z.infer<typeof transferPageSchema>;
type TransferRow = z.infer<typeof transferSchema>;
type ConstellationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function normalizedAddress(value: string) {
  return isAddress(value) ? getAddress(value) : null;
}

function nodeRole(
  address: Address,
  input: {
    pair: Address;
    creator: Address | null;
    isContract: boolean;
  }
): WalletConstellationNodeRole {
  const normalized = address.toLowerCase();
  if (normalized === zeroAddress.toLowerCase()) return "mint-source";
  if (normalized === DEAD_ADDRESS) return "burn-address";
  if (normalized === input.pair.toLowerCase()) return "pool";
  if (input.creator && normalized === input.creator.toLowerCase()) return "creator";
  if (input.isContract) return "contract";
  return "intermediary";
}

function rolePriority(role: WalletConstellationNodeRole) {
  if (role === "creator") return 7;
  if (role === "pool") return 6;
  if (role === "mint-source") return 5;
  if (role === "burn-address") return 5;
  if (role === "holder") return 4;
  if (role === "contract") return 3;
  return 2;
}

function upsertNode(
  nodes: Map<string, WalletConstellationNode>,
  input: WalletConstellationNode
) {
  const key = input.address.toLowerCase();
  const current = nodes.get(key);
  if (!current) {
    nodes.set(key, input);
    return;
  }
  nodes.set(key, {
    ...current,
    role: rolePriority(input.role) > rolePriority(current.role) ? input.role : current.role,
    label: current.label ?? input.label,
    holderRank: current.holderRank ?? input.holderRank,
    supplyShareBps: current.supplyShareBps ?? input.supplyShareBps,
    isContract: current.isContract || input.isContract,
    isFlagged: current.isFlagged || input.isFlagged,
    evidence: Array.from(new Set([...current.evidence, ...input.evidence]))
  });
}

function edgeRelation(from: Address, to: Address) {
  if (from.toLowerCase() === zeroAddress.toLowerCase()) return "mint" as const;
  if (to.toLowerCase() === DEAD_ADDRESS) return "burn" as const;
  return "token-transfer" as const;
}

export function buildWalletConstellationGraph(input: {
  evidence: TokenRiskEvidence;
  transfers: TransferRow[];
  hasMoreTransfers: boolean;
  now?: number;
}): WalletConstellationGraph {
  const token = getAddress(input.evidence.token);
  const pair = getAddress(input.evidence.pair);
  const creator = input.evidence.holders.creator
    ? getAddress(input.evidence.holders.creator)
    : null;
  const nodes = new Map<string, WalletConstellationNode>();
  const tracked = new Set<string>([pair.toLowerCase()]);

  upsertNode(nodes, {
    address: pair,
    role: "pool",
    label: "Verified market pool",
    holderRank: null,
    supplyShareBps: input.evidence.holders.poolShareBps,
    isContract: true,
    isFlagged: false,
    evidence: ["verified-market-pair"]
  });
  if (creator) {
    tracked.add(creator.toLowerCase());
    upsertNode(nodes, {
      address: creator,
      role: "creator",
      label: "Reported creator",
      holderRank: null,
      supplyShareBps: input.evidence.holders.creatorShareBps,
      isContract: false,
      isFlagged: false,
      evidence: ["verified-project-record"]
    });
  }
  input.evidence.holders.topNonPoolHolders.forEach((holder, index) => {
    const address = getAddress(holder.address);
    tracked.add(address.toLowerCase());
    upsertNode(nodes, {
      address,
      role: creator && address.toLowerCase() === creator.toLowerCase() ? "creator" : "holder",
      label: null,
      holderRank: index + 1,
      supplyShareBps: holder.shareBps,
      isContract: holder.isContract,
      isFlagged: holder.isScam,
      evidence: [
        "current-holder-snapshot",
        ...(holder.isScam ? ["provider-flagged"] : [])
      ]
    });
  });

  const relevantTransfers = input.transfers.flatMap((transfer) => {
    const from = normalizedAddress(transfer.from.hash);
    const to = normalizedAddress(transfer.to.hash);
    if (!from || !to) return [];
    if (!tracked.has(from.toLowerCase()) && !tracked.has(to.toLowerCase())) return [];
    return [{ transfer, from, to }];
  });
  for (const { transfer, from, to } of relevantTransfers) {
    for (const [address, details] of [[from, transfer.from], [to, transfer.to]] as const) {
      upsertNode(nodes, {
        address,
        role: nodeRole(address, {
          pair,
          creator,
          isContract: details.is_contract === true
        }),
        label: details.name ?? null,
        holderRank: null,
        supplyShareBps: null,
        isContract: details.is_contract === true,
        isFlagged: details.is_scam === true,
        evidence: [
          "confirmed-token-transfer",
          ...(details.is_scam === true ? ["provider-flagged"] : [])
        ]
      });
    }
  }

  const edges = new Map<string, WalletConstellationEdge>();
  for (const { transfer, from, to } of relevantTransfers) {
    const relation = edgeRelation(from, to);
    const id = `${relation}:${from.toLowerCase()}:${to.toLowerCase()}`;
    const current = edges.get(id);
    const timestamp = new Date(transfer.timestamp).toISOString();
    if (!current) {
      edges.set(id, {
        id,
        from,
        to,
        relation,
        transferCount: 1,
        rawAmount: transfer.total.value,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        transactionHashes: [transfer.transaction_hash.toLowerCase()],
        confidence: "confirmed",
        interpretation: "transfer-only"
      });
      continue;
    }
    const hashes = current.transactionHashes.includes(transfer.transaction_hash.toLowerCase())
      ? current.transactionHashes
      : [...current.transactionHashes, transfer.transaction_hash.toLowerCase()]
          .slice(0, MAX_TRANSACTION_HASHES_PER_EDGE);
    edges.set(id, {
      ...current,
      transferCount: current.transferCount + 1,
      rawAmount: (BigInt(current.rawAmount) + BigInt(transfer.total.value)).toString(),
      firstSeenAt: timestamp < current.firstSeenAt ? timestamp : current.firstSeenAt,
      lastSeenAt: timestamp > current.lastSeenAt ? timestamp : current.lastSeenAt,
      transactionHashes: hashes
    });
  }

  const decision = tokenRiskDecision({ status: "ready", evidence: input.evidence }, "buy");
  return {
    schemaVersion: 1,
    token,
    pair,
    nodes: Array.from(nodes.values()).sort((left, right) =>
      rolePriority(right.role) - rolePriority(left.role)
      || (right.supplyShareBps ?? -1) - (left.supplyShareBps ?? -1)
      || left.address.localeCompare(right.address)
    ),
    edges: Array.from(edges.values()).sort((left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt) || left.id.localeCompare(right.id)
    ),
    decision: {
      state: decision.state,
      findingCodes: decision.findings.map((finding) => finding.code)
    },
    coverage: {
      holderLimit: input.evidence.holders.topNonPoolHolders.length,
      sampledTransfers: input.transfers.length,
      hasMoreTransfers: input.hasMoreTransfers,
      description: "Current verified holders plus direct relationships found in the latest public token-transfer sample."
    },
    checkedAt: new Date(input.now ?? Date.now()).toISOString(),
    limitations: [
      "A transfer proves an onchain interaction, not common ownership, coordination, or malicious intent.",
      "This first version samples recent token transfers and may omit older, indirect, cross-token, or cross-chain relationships.",
      "Provider labels and reported creator records can be incomplete or incorrect and must remain attributable."
    ]
  };
}

export async function fetchWalletConstellationTransfers(
  token: Address,
  dependencies: {
    fetch?: ConstellationFetch;
    timeoutMs?: number;
  } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? MAX_TIMEOUT_MS
  );
  try {
    const response = await (dependencies.fetch ?? fetch)(
      `${BLOCKSCOUT}/api/v2/tokens/${token}/transfers`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      }
    );
    if (!response.ok) throw new Error("Wallet relationship evidence is unavailable.");
    const parsed = transferPageSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Wallet relationship evidence is invalid.");
    return {
      transfers: parsed.data.items,
      hasMoreTransfers: Boolean(parsed.data.next_page_params)
    };
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error("Wallet relationship evidence timed out.");
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

export type { TransferPage, TransferRow };
