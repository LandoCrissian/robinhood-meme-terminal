import {
  NFT_ADMISSION_PLAN,
  NFT_SOURCE_REGISTRY,
  OPEN_SEA_SEAPORT,
  ROBINHOOD_WETH,
  SEAPORT_1_6,
  UINT256_MAX,
  assessOrganicActivity,
  assertNoImplicitRmtFee,
  assertRegistration,
  assertRobinhoodSeaportObservation,
  bestAsk,
  bestBid,
  buyerTotalAtomic,
  erc1155Uri,
  expandConsecutiveTransfer,
  itemKey,
  nftCollectionId,
  nftItemId,
  pathIsRedZone,
  planSweep,
  quoteFromOrder,
  safeMetadataUri,
  sellerProceedsAtomic,
  sourceById,
  type NftMarketOrder
} from "../src/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`);
}

function expectThrows(run: () => unknown, message: string) {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

const ZERO = "0x0000000000000000000000000000000000000000";
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const H1 = `0x${"11".repeat(32)}`;
const H2 = `0x${"22".repeat(32)}`;
const collection = nftCollectionId(A);
const item1 = nftItemId(A, "1");
const item2 = nftItemId(A, "2");

assert(itemKey(nftItemId(A, UINT256_MAX.toString())).endsWith(UINT256_MAX.toString()), "max uint256 item should be accepted");
expectThrows(() => nftItemId(A, "01"), "non-canonical token id must be rejected");
expectThrows(() => nftItemId(A, (UINT256_MAX + 1n).toString()), "uint256 overflow must be rejected");
expectThrows(() => nftItemId("0x1234", "1"), "bad collection address must be rejected");

assert(erc1155Uri("ipfs://cid/{id}.json", "15").endsWith(`${"0".repeat(63)}f.json`), "ERC-1155 {id} substitution must be 64-char lowercase hex");
assert(safeMetadataUri("https://example.com/1.json").startsWith("https://"), "public HTTPS metadata URI should pass");
assert(safeMetadataUri("ipfs://bafybeigdyrzt/path/1.json").startsWith("ipfs://"), "IPFS metadata URI should pass");
expectThrows(() => safeMetadataUri("http://example.com/a"), "HTTP metadata must be rejected");
expectThrows(() => safeMetadataUri("https://127.0.0.1/a"), "localhost metadata target must be rejected");
expectThrows(() => safeMetadataUri("https://10.0.0.1/a"), "private metadata target must be rejected");

const clock = { rollupBlockNumber: "100", rollupBlockHash: H1, l1BlockNumber: "200" };
const consecutive = expandConsecutiveTransfer({
  contract: A,
  fromTokenId: "10",
  toTokenId: "12",
  from: ZERO,
  to: B,
  identity: { transactionHash: H2, logIndex: 7 },
  clock
});
assert(consecutive.length === 3 && consecutive[2].item.tokenId === "12", "ERC-2309 range must expand deterministically when bounded");
expectThrows(() => expandConsecutiveTransfer({ contract: A, fromTokenId: "1", toTokenId: "10001", from: ZERO, to: B, identity: { transactionHash: H2, logIndex: 7 }, clock }), "oversized ERC-2309 range must become a bounded range job");

const now = 2_000_000;
const eth = { chainId: 4663 as const, kind: "native" as const, symbol: "ETH" as const };
function listing(id: string, item: typeof item1, gross: string, buyerFee = "0"): NftMarketOrder {
  return {
    sourceId: "opensea-seaport", venueId: "opensea", protocolId: "seaport-1.6", orderId: id, orderHash: H1,
    kind: "listing", criteria: { kind: "item", item }, maker: B, taker: null, paymentAsset: eth,
    grossAmountAtomic: gross, quantityAtomic: "1", startTimeMs: now - 1000, endTimeMs: now + 100_000,
    status: "active", fillable: true,
    fees: buyerFee === "0" ? [] : [{ kind: "marketplace", recipient: C, payer: "buyer", asset: eth, amountAtomic: buyerFee, enforcement: "required_by_order", source: "fixture" }],
    observedAtMs: now, sourceRef: "fixture"
  };
}
function offer(id: string, gross: string, sellerFee: string): NftMarketOrder {
  return {
    sourceId: "opensea-seaport", venueId: "opensea", protocolId: "seaport-1.6", orderId: id, orderHash: H2,
    kind: "collection_offer", criteria: { kind: "collection", collection }, maker: C, taker: null, paymentAsset: eth,
    grossAmountAtomic: gross, quantityAtomic: "1", startTimeMs: now - 1000, endTimeMs: now + 100_000,
    status: "active", fillable: true,
    fees: [{ kind: "creator_royalty", recipient: B, payer: "seller", asset: eth, amountAtomic: sellerFee, enforcement: "required_by_order", source: "fixture" }],
    observedAtMs: now, sourceRef: "fixture"
  };
}

const listings = [listing("l1-high", item1, "100", "10"), listing("l1-low", item1, "90", "5"), listing("l2", item2, "120")];
assert(bestAsk(listings, item1, now)?.orderId === "l1-low", "best ask must use total buyer cost and item identity");
assert(buyerTotalAtomic(listings[1]) === "95", "buyer total must include buyer-paid fees");
const sweep = planSweep({ listings, desiredCount: 2, maxSpendAtomic: "300", nowMs: now });
assert(sweep.filledCount === 2 && sweep.totalCostAtomic === "215", "sweep must dedupe token IDs and choose unique best asks");

const offers = [offer("o-gross-high", "110", "30"), offer("o-net-high", "100", "5")];
assert(sellerProceedsAtomic(offers[0]) === "80", "seller proceeds should subtract seller-paid fees");
assert(bestBid(offers, item1, now)?.orderId === "o-net-high", "best bid must rank seller proceeds, not gross offer");
const sellQuote = quoteFromOrder({ order: offers[1], item: item1, side: "sell", nowMs: now });
assert(sellQuote.sellerProceedsAtomic === "95" && sellQuote.rmtFeeState === "not_admitted", "NFT quote must not silently inherit an RMT fee");
assertNoImplicitRmtFee([{ kind: "rmt", recipient: null, payer: "unknown", asset: eth, amountAtomic: "0", enforcement: "not_admitted", source: "research" }]);
expectThrows(() => assertNoImplicitRmtFee([{ kind: "rmt", recipient: C, payer: "buyer", asset: eth, amountAtomic: "1", enforcement: "required_by_order", source: "bad" }]), "implicit RMT NFT fee must fail closed");

for (const source of NFT_SOURCE_REGISTRY) assertRegistration(source);
assert(OPEN_SEA_SEAPORT.admission === "verification_ready", "OpenSea/Seaport should be first verification-ready source");
assert(sourceById("nightgarden")?.admission === "catalogue_only", "Nightgarden must not be represented as a live venue");
assert(sourceById("reservoir-hosted")?.admission === "unsupported", "Reservoir hosted API must not be assumed on Robinhood Chain");
assert(sourceById("hoodmarket")?.identityState === "candidate", "HoodMarket secondary protocol must remain candidate until verified");
assert(SEAPORT_1_6 === "0x0000000000000068f116a894984e2db1123eb395" && ROBINHOOD_WETH.endsWith("ad73"), "pinned Robinhood Seaport/WETH constants drifted");

assertRobinhoodSeaportObservation({
  chain: "robinhood", protocolAddress: SEAPORT_1_6, orderHash: H1, offerer: B, zone: ZERO,
  conduitKey: `0x${"00".repeat(32)}`, startTimeSeconds: "1000", endTimeSeconds: "3000", orderStatus: "ACTIVE"
}, 2_000_000);
expectThrows(() => assertRobinhoodSeaportObservation({
  chain: "ethereum", protocolAddress: SEAPORT_1_6, orderHash: H1, offerer: B, zone: ZERO,
  conduitKey: `0x${"00".repeat(32)}`, startTimeSeconds: "1000", endTimeSeconds: "3000", orderStatus: "ACTIVE"
}, 2_000_000), "wrong-chain Seaport order must fail closed");

const organic = assessOrganicActivity([
  { collection, tokenId: "1", buyer: B, seller: C, paymentUsd: 100, timestampMs: 1000, transactionHash: H1 },
  { collection, tokenId: "1", buyer: C, seller: B, paymentUsd: 105, timestampMs: 2000, transactionHash: H2 },
  { collection, tokenId: "2", buyer: B, seller: B, paymentUsd: 90, timestampMs: 3000, transactionHash: H1 }
]);
assert(organic.confidence === "low" && organic.selfTrades === 1 && organic.rapidRoundTrips === 1, "organic activity model must surface structural wash signals without claiming certainty");

assert(pathIsRedZone("apps/web/lib/vnext/authorization-plan.ts"), "current Codex execution file must be a red zone");
assert(NFT_ADMISSION_PLAN.find((gate) => gate.stage === "execution")?.current === "blocked", "NFT execution must remain release blocked");

console.log(`RMT_NFT_MARKET_PLUGIN_SMOKE: PASS (${NFT_SOURCE_REGISTRY.length} source registrations)`);
