import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VNextDirectoryMarket } from "./market-directory";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "./robinhood-assets";
import type { VNextDetectedWalletAsset } from "./wallet-assets";
import { walletPortfolioSummary } from "./wallet-portfolio";
import {
  normalizeWalletDiscoveryResponse,
  parseBlockscoutWalletAssets
} from "./wallet-discovery";
import { RMT_TOKEN_ARTWORK, safeTokenArtworkUrl } from "./token-artwork";

const wallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";
const marketToken = "0x3333333333333333333333333333333333333333";
const fakeUsdg = "0x4444444444444444444444444444444444444444";
const trustedLogo = "https://assets.coingecko.com/coins/images/51281/standard/usdg.png";

const discovered = parseBlockscoutWalletAssets([
  { token: { address_hash: ROBINHOOD_USDG_ADDRESS, decimals: "6", icon_url: trustedLogo, name: "Global Dollar", reputation: "ok", symbol: "USDG", type: "ERC-20" }, value: "46000000" },
  { token: { address_hash: fakeUsdg, decimals: "18", name: "Not canonical", reputation: "scam", symbol: "USDG", type: "ERC-20" }, value: "31000000000000000000" },
  { token: { address_hash: marketToken, decimals: "18", name: "Market Token", reputation: "ok", symbol: "MKT", type: "ERC-20" }, value: "2000000000000000000" },
  { token: { address_hash: otherWallet, decimals: "18", name: "Empty", reputation: "ok", symbol: "ZERO", type: "ERC-20" }, value: "0" },
  { token: { address_hash: otherWallet, decimals: "0", name: "NFT", reputation: "ok", symbol: "NFT", type: "ERC-721" }, value: "1" }
]);
assert.equal(discovered.length, 3);
assert.equal(discovered[0]?.imageUrl, trustedLogo);
assert.equal(discovered[1]?.symbol, "USDG");
assert.equal(discovered[1]?.reputation, "suspicious");
assert.equal(safeTokenArtworkUrl(RMT_TOKEN_ARTWORK), RMT_TOKEN_ARTWORK);
assert.equal(safeTokenArtworkUrl("https://cdn.dexscreener.com/cms/images/token"), "https://cdn.dexscreener.com/cms/images/token");
assert.equal(safeTokenArtworkUrl("http://assets.coingecko.com/token.png"), null);
assert.equal(safeTokenArtworkUrl("https://untrusted.example/token.png"), null);
assert.equal(safeTokenArtworkUrl("javascript:alert(1)"), null);

const response = normalizeWalletDiscoveryResponse({
  chainId: 4_663,
  wallet,
  assets: discovered,
  complete: true,
  source: "robinhood-chain-blockscout",
  observedAt: "2026-08-12T12:00:00.000Z"
}, wallet);
assert.equal(response?.wallet, wallet);
assert.equal(response?.assets.length, 3);
assert.equal(normalizeWalletDiscoveryResponse({ ...response, wallet: otherWallet }, wallet), null);
assert.throws(() => parseBlockscoutWalletAssets({}), /invalid balance list/);

function heldAsset(input: Partial<VNextDetectedWalletAsset> & Pick<VNextDetectedWalletAsset, "address" | "symbol" | "name" | "decimals" | "balanceAtomic">): VNextDetectedWalletAsset {
  return {
    identityState: "verified",
    source: "wallet_index",
    reputation: "ok",
    imageUrl: null,
    routeState: "detected",
    ...input
  };
}

const assets = [
  heldAsset({ address: ROBINHOOD_USDG_ADDRESS, symbol: "USDG", name: "Global Dollar", decimals: 6, balanceAtomic: "46000000", source: "canonical" }),
  heldAsset({ address: ROBINHOOD_WETH_ADDRESS, symbol: "WETH", name: "Wrapped Ether", decimals: 18, balanceAtomic: "1000000000000000000", source: "canonical" }),
  heldAsset({ address: marketToken, symbol: "MKT", name: "Market Token", decimals: 18, balanceAtomic: "2000000000000000000" }),
  heldAsset({ address: fakeUsdg, symbol: "USDG", name: "Not canonical", decimals: 18, balanceAtomic: "31000000000000000000", reputation: "suspicious" })
];
const markets: VNextDirectoryMarket[] = [{
  address: marketToken,
  name: "Market Token",
  symbol: "MKT",
  priceUsd: 3,
  liquidityUsd: 10_000,
  marketCapUsd: 100_000,
  fdvUsd: 100_000,
  volume5m: null,
  volume1h: null,
  volume24h: 5_000,
  priceChange5m: null,
  priceChange1h: null,
  priceChange24h: 1,
  buys5m: null,
  sells5m: null,
  buys1h: null,
  sells1h: null,
  buys24h: null,
  sells24h: null,
  pairCreatedAt: null,
  ageMinutes: 60,
  momentumScore: null,
  buyPressureBps: null,
  riskFlags: null,
  signal: "active"
}];
const portfolio = walletPortfolioSummary({
  assets,
  markets,
  nativeBalance: 500000000000000000n,
  ethUsd: 2_000
});
assert.equal(portfolio.knownPortfolioUsd, 3_052);
assert.equal(portfolio.pricedPositionCount, 4);
assert.equal(portfolio.unpricedPositionCount, 1);
assert.equal(portfolio.valuations.find((item) => item.address === fakeUsdg)?.source, "unavailable");
assert.equal(portfolio.valuations.find((item) => item.address === ROBINHOOD_USDG_ADDRESS)?.source, "canonical_usdg");

const component = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../app/vnext/use-vnext-wallet-assets.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/vnext/wallet-assets/route.ts", import.meta.url), "utf8");
const presentations = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
const artwork = readFileSync(new URL("../../app/vnext/token-artwork.tsx", import.meta.url), "utf8");
const marketRoute = readFileSync(new URL("../../app/api/vnext/market-directory/route.ts", import.meta.url), "utf8");
const canonicalDirectoryServer = readFileSync(new URL("../server/vnext-canonical-market-directory.ts", import.meta.url), "utf8");
const marketDirectoryRouteServer = readFileSync(new URL("../server/vnext-market-directory-route.ts", import.meta.url), "utf8");

assert.match(route, /https:\/\/robinhoodchain\.blockscout\.com/);
assert.match(route, /token-balances/);
assert.match(route, /MAX_RESPONSE_CHARACTERS/);
assert.match(route, /private, no-store/);
assert.doesNotMatch(route, /searchParams\.get\("url"\)|process\.env/);
assert.match(hook, /publicClient\.multicall/);
assert.match(hook, /functionName: "balanceOf"/);
assert.match(hook, /sameCandidateAddresses/);
assert.match(component, />Portfolio</);
assert.match(component, />Trade balance</);
assert.match(component, /Value pending/);
assert.match(component, /Trade funding \+ network gas · reserve excluded/);
assert.match(component, /Canonical trade balance · settlement asset/);
assert.match(component, /Unconfirmed proceeds are never spendable/);
assert.match(component, /WalletTransferDialog/);
assert.match(component, /directReceive/);
assert.match(component, /Show all \$\{assets\.length\} assets/);
assert.match(component, /review token identity/);
assert.match(component, /imageUrl=\{asset\.imageUrl\}/);
assert.match(presentations, /onSelectAsset=\{props\.onSelectMarket\}/);
assert.match(presentations, /imageUrl=\{market\.imageUri\}/);
assert.match(artwork, /safeTokenArtworkUrl/);
assert.match(artwork, /onError=\{\(\) => setFailedImage\(safeImage\)\}/);
assert.match(artwork, /symbol\.trim\(\)\.slice\(0, 1\)/);
assert.match(marketRoute, /readVNextMarketDirectoryRequest/);
assert.match(marketDirectoryRouteServer, /return true;/);
assert.doesNotMatch(marketDirectoryRouteServer, /RMT_CANONICAL_BROWSE_ENABLED === "true"/);
assert.match(marketDirectoryRouteServer, /readVNextCanonicalMarketDirectoryPage/);
assert.match(canonicalDirectoryServer, /readRmtCuratedMarketSnapshot/);
assert.match(canonicalDirectoryServer, /inventory\.coverage\.complete/);
assert.match(canonicalDirectoryServer, /directoryMarketsFromCanonicalPools/);
assert.doesNotMatch(`${marketRoute}\n${canonicalDirectoryServer}`, /normalizeProviderPairForAsset|DIRECTORY_TOKENS|dexscreener/i);
assert.doesNotMatch(component, /href="\/portfolio"|href=\{"\/portfolio"\}/);
assert.doesNotMatch(component, /\$428\.16|\$1,862\.34|mock|fixture/i);

console.log("RMT VNext wallet holdings smoke checks passed.");
