import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  robinhoodExplorerAddress,
  robinhoodExplorerPool,
  robinhoodExplorerToken,
  robinhoodExplorerTransaction
} from "./robinhood-chain-links";
import { safeExternalNavigationUrl, safeExternalSocialNavigationUrl } from "./external-navigation";
import { parseVNextTerminalLocation } from "./terminal-location";
import { VNEXT_MARKET_DIRECTORY_VIEWS } from "./market-directory";
import { externalMarketSocialsFromPairInfo } from "../external-market-socials";

const address = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const hash = `0x${"ab".repeat(32)}`;

assert.equal(VNEXT_MARKET_DIRECTORY_VIEWS[0]?.id, "active", "ACTIVE_FIRST");
assert.match(robinhoodExplorerToken(address), /^https:\/\/robinhoodchain\.blockscout\.com\/token\//, "EXPLORER_TOKEN_LINK");
assert.match(robinhoodExplorerAddress(address), /^https:\/\/robinhoodchain\.blockscout\.com\/address\//, "EXPLORER_ADDRESS_LINK");
assert.equal(robinhoodExplorerPool(address), robinhoodExplorerAddress(address), "POOL_LINK");
assert.equal(robinhoodExplorerTransaction(hash), `https://robinhoodchain.blockscout.com/tx/${hash}`, "EXPLORER_TX_LINK");
assert.throws(() => robinhoodExplorerToken("not-an-address"), /Invalid Robinhood Chain address/, "INVALID_ADDRESS_REJECTED");
assert.throws(() => robinhoodExplorerTransaction("0x1234"), /Invalid Robinhood Chain transaction hash/, "INVALID_TX_HASH_REJECTED");

assert.equal(safeExternalNavigationUrl("https://www.rmtlaunch.fun/project"), "https://www.rmtlaunch.fun/project", "HTTPS_EXTERNAL_LINK_ACCEPTED");
for (const unsafe of [
  "javascript:alert(1)", "data:text/html,unsafe", "file:///tmp/unsafe", "https://user:password@example.com",
  "https://localhost/project", "https://127.0.0.1/project", "https://192.168.1.2/project", "https://project.test"
]) assert.equal(safeExternalNavigationUrl(unsafe), null, `unsafe URL accepted: ${unsafe}`);
const projectSocials = externalMarketSocialsFromPairInfo({
  websites: [{ url: "https://www.rmtlaunch.fun" }, { url: "javascript:alert(1)" }],
  socials: [
    { type: "twitter", url: "https://x.com/project" },
    { type: "telegram", url: "https://t.me/project" },
    { type: "discord", url: "https://discord.gg/project" },
    { type: "farcaster", url: "https://warpcast.com/project" }
  ]
});
assert.equal(projectSocials?.website, "https://www.rmtlaunch.fun/", "PROJECT_SOCIAL_LINK_RENDERING");
assert.equal(projectSocials?.x, "https://x.com/project");
assert.equal(projectSocials?.telegram, "https://t.me/project");
assert.equal(projectSocials?.discord, "https://discord.gg/project");
assert.equal(projectSocials?.farcaster, "https://warpcast.com/project");
assert.equal(projectSocials?.provenance, "dex-pair-metadata", "DEX_METADATA_LINK_NOT_OVERCLAIMED");
assert.equal(externalMarketSocialsFromPairInfo({ websites: [], socials: [] }), undefined, "MISSING_SOCIAL_LINK_OMITTED");
assert.equal(safeExternalSocialNavigationUrl("https://x.com/project", "x"), "https://x.com/project");
assert.equal(safeExternalSocialNavigationUrl("https://t.me/project", "telegram"), "https://t.me/project");
assert.equal(safeExternalSocialNavigationUrl("https://discord.gg/project", "discord"), "https://discord.gg/project");
assert.equal(safeExternalSocialNavigationUrl("https://warpcast.com/project", "farcaster"), "https://warpcast.com/project");
assert.equal(safeExternalSocialNavigationUrl("https://example.org/not-x", "x"), null, "PROJECT_SOCIAL_HOST_LABEL");
assert.equal(safeExternalSocialNavigationUrl("https://x.com/not-telegram", "telegram"), null, "PROJECT_SOCIAL_HOST_LABEL");

assert.deepEqual(parseVNextTerminalLocation(`?market=${address}`), {
  context: "asset", market: "0x39dBED3a2bd333467115dE45665cC57F813C4571"
}, "MARKET_DEEP_LINK");
assert.equal(parseVNextTerminalLocation(`?market=${address}&side=buy`).context, "asset", "BUY_DEEP_LINK");
assert.equal(parseVNextTerminalLocation(`?market=${address}&side=sell`).context, "asset", "SELL_DEEP_LINK");
assert.deepEqual(parseVNextTerminalLocation("?market=malformed&side=sell"), { context: "markets" });
assert.deepEqual(parseVNextTerminalLocation("?side=sell"), { context: "markets" }, "stale side cannot select an action");

const presentation = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
const directoryHook = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../app/vnext/vnext-asset-workspace.tsx", import.meta.url), "utf8");
const receipt = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const recovery = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
const pageMetadata = readFileSync(new URL("../../app/vnext/page.tsx", import.meta.url), "utf8");

assert.match(shell, /useState<VNextMarketDirectoryView>\("active"\)/, "DEFAULT_VIEW_ACTIVE");
assert.match(shell, /parseVNextTerminalLocation/, "deep links use one validated parser");
assert.match(directoryHook, /requestSequence !== selectionSequence\.current/, "BACK_FORWARD_NAVIGATION selection races must fail closed");
assert.doesNotMatch(presentation, /Searching verified Robinhood Chain markets|Verified market found|No verified market found/i, "SEARCH_COPY_DOES_NOT_CALL_EXISTENCE_VERIFIED");
assert.match(workspace, /Project links · market metadata/);
assert.match(workspace, /CopyAddress/);
assert.match(workspace, /Unknown|Unavailable|Not reported/, "PARTIAL_METADATA_REMAINS_VISIBLE");
assert.match(receipt, /vnFeeV2Summary[\s\S]*RMT execution fee/, "V2_FEE_VISIBLE_MAIN_SURFACE");
assert.match(walletReview, /RMT execution fee on this approval: 0/, "APPROVAL_FEE_ZERO");
assert.match(walletReview, /VNextWalletFeeDisclosure/, "V2_FEE_VISIBLE_WALLET_REVIEW");
assert.match(receipt, /ExplorerLink[\s\S]*View confirmed transaction/, "RECEIPT_EXPLORER_LINK");
assert.match(pageMetadata, /Robinhood Meme Terminal/);
assert.match(pageMetadata, /canonical: "\/"/);
assert.match(pageMetadata, /openGraph:[\s\S]*twitter:/);
assert.doesNotMatch(pageMetadata, /launchpad/i, "PRODUCTION_METADATA must describe the Terminal");
assert.equal(existsSync(new URL("../../public/brand/rmt-master-logo.png", import.meta.url)), true, "production logo asset is missing");
for (const source of [workspace, receipt, walletReview, recovery]) {
  assert.doesNotMatch(source, /https:\/\/robinhoodchain\.blockscout\.com/, "Terminal explorer URL bypassed canonical helper");
  assert.doesNotMatch(source, /href=["']#|javascript:/i, "placeholder or unsafe static link found");
}
