import assert from "node:assert/strict";
import { getAddress } from "viem";
import type { TokenRiskEvidence } from "../token-risk-evidence";
import {
  buildWalletConstellationGraph,
  fetchWalletConstellationTransfers,
  type TransferRow
} from "./wallet-constellation";

const token = getAddress("0x1111111111111111111111111111111111111111");
const pair = getAddress("0x2222222222222222222222222222222222222222");
const creator = getAddress("0x3333333333333333333333333333333333333333");
const holder = getAddress("0x4444444444444444444444444444444444444444");
const intermediary = getAddress("0x5555555555555555555555555555555555555555");
const unrelatedA = getAddress("0x6666666666666666666666666666666666666666");
const unrelatedB = getAddress("0x7777777777777777777777777777777777777777");
const flagged = getAddress("0x8888888888888888888888888888888888888888");

const evidence: TokenRiskEvidence = {
  token,
  pair,
  marketVerified: true,
  coverage: "complete",
  contract: {
    sourcePublished: true,
    isProxy: false,
    bytecodeChanged: false,
    controls: {
      assessment: "no-common-controls-found",
      detected: [],
      customWriteFunctions: [],
      administrator: null,
      activeLaunchRestrictions: false,
      restrictionEndBlock: null,
      maxTransactionBps: null,
      maxWalletBps: null
    }
  },
  liquidity: {
    controlStatus: "burn-address",
    evidenceSource: "launchpad-registry",
    positionManager: null,
    positionId: null,
    owner: null,
    approvedOperator: null,
    creatorCanTransfer: false,
    positionLiquidity: null
  },
  holders: {
    count: 20,
    poolShareBps: 4_000,
    topNonPoolShareBps: 1_500,
    topNonPoolHolders: [
      { address: creator, shareBps: 900, isContract: false, isScam: false },
      { address: holder, shareBps: 600, isContract: false, isScam: false }
    ],
    largestNonPoolHolder: { address: creator, shareBps: 900 },
    creator,
    creatorShareBps: 900
  },
  sellSimulation: {
    status: "passed",
    method: "holder-to-pool-transfer",
    holder,
    amount: "1",
    returnStyle: "boolean-true"
  },
  warnings: [],
  checkedAt: "2026-07-28T00:00:00.000Z"
};

function transfer(input: {
  from: string;
  to: string;
  value: string;
  hash: string;
  timestamp: string;
  fromContract?: boolean;
  toContract?: boolean;
  fromScam?: boolean;
  toScam?: boolean;
}): TransferRow {
  return {
    from: {
      hash: input.from,
      is_contract: input.fromContract ?? false,
      is_scam: input.fromScam ?? false,
      name: null
    },
    to: {
      hash: input.to,
      is_contract: input.toContract ?? false,
      is_scam: input.toScam ?? false,
      name: null
    },
    total: { value: input.value },
    transaction_hash: input.hash,
    timestamp: input.timestamp
  };
}

const transfers = [
  transfer({
    from: creator,
    to: intermediary,
    value: "10",
    hash: `0x${"1".repeat(64)}`,
    timestamp: "2026-07-28T00:00:00.000Z"
  }),
  transfer({
    from: creator,
    to: intermediary,
    value: "15",
    hash: `0x${"2".repeat(64)}`,
    timestamp: "2026-07-28T01:00:00.000Z"
  }),
  transfer({
    from: pair,
    to: holder,
    value: "4",
    hash: `0x${"3".repeat(64)}`,
    timestamp: "2026-07-28T02:00:00.000Z",
    fromContract: true
  }),
  transfer({
    from: holder,
    to: creator,
    value: "5",
    hash: `0x${"5".repeat(64)}`,
    timestamp: "2026-07-28T02:30:00.000Z"
  }),
  transfer({
    from: creator,
    to: flagged,
    value: "2",
    hash: `0x${"6".repeat(64)}`,
    timestamp: "2026-07-28T02:45:00.000Z",
    toScam: true
  }),
  transfer({
    from: unrelatedA,
    to: unrelatedB,
    value: "99",
    hash: `0x${"4".repeat(64)}`,
    timestamp: "2026-07-28T03:00:00.000Z"
  })
];

const graph = buildWalletConstellationGraph({
  evidence,
  transfers,
  hasMoreTransfers: true,
  now: 0
});
assert.equal(graph.schemaVersion, 1);
assert.equal(graph.nodes.some((node) => node.address === unrelatedA), false);
assert.equal(graph.nodes.find((node) => node.address === creator)?.role, "creator");
assert.equal(graph.nodes.find((node) => node.address === pair)?.role, "pool");
assert.equal(graph.nodes.find((node) => node.address === intermediary)?.role, "intermediary");
assert.equal(graph.edges.length, 4);
const creatorEdge = graph.edges.find(
  (edge) => edge.from === creator && edge.to === intermediary
);
assert.equal(creatorEdge?.transferCount, 2);
assert.equal(creatorEdge?.rawAmount, "25");
assert.equal(creatorEdge?.confidence, "confirmed");
assert.equal(creatorEdge?.interpretation, "transfer-only");
assert.equal(graph.coverage.sampledTransfers, 6);
assert.equal(graph.coverage.hasMoreTransfers, true);
assert.equal(graph.holderSnapshot.count, 20);
assert.equal(graph.holderSnapshot.topNonPoolShareBps, 1_500);
assert.equal(graph.holderSnapshot.creatorShareBps, 900);
assert.equal(graph.signals[0]?.severity, "review");
assert.equal(
  graph.signals.some((signal) => signal.code === "creator-holder-direct-link"),
  true
);
assert.equal(
  graph.signals.some((signal) => signal.code === "provider-flagged-participant"),
  true
);
assert.equal(
  graph.signals.some((signal) => signal.code === "repeated-direct-transfer"),
  true
);
assert.equal(
  graph.signals.every((signal) => signal.interpretation === "evidence-only"),
  true
);
assert.equal(
  graph.signals.some((signal) =>
    signal.relatedAddresses.some((address) => address === pair)
  ),
  false
);
assert.match(graph.limitations.join(" "), /not common ownership/);

const normalPoolActivityGraph = buildWalletConstellationGraph({
  evidence,
  transfers: [
    transfer({
      from: pair,
      to: holder,
      value: "4",
      hash: `0x${"7".repeat(64)}`,
      timestamp: "2026-07-28T04:00:00.000Z",
      fromContract: true
    })
  ],
  hasMoreTransfers: false,
  now: 0
});
assert.deepEqual(
  normalPoolActivityGraph.signals,
  [],
  "Ordinary verified-pool activity must not be presented as a relationship warning."
);

async function main() {
  const page = await fetchWalletConstellationTransfers(token, {
    fetch: async () => Response.json({
      items: transfers,
      next_page_params: { block_number: 1 }
    })
  });
  assert.equal(page.transfers.length, 6);
  assert.equal(page.hasMoreTransfers, true);

  await assert.rejects(
    fetchWalletConstellationTransfers(token, {
      fetch: async () => Response.json({ items: [{ bad: true }] })
    }),
    /invalid/
  );

  console.log("Wallet constellation graph preserves confirmed evidence and avoids ownership claims.");
}

void main();
