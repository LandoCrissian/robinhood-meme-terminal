import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizePrivyAppId } from "./privy-config";
import { isMobileWebUserAgent, metaMaskDappLink, walletBrowserEnvironment } from "./mobile-wallet-link";

const appRoot = fileURLToPath(new URL("../app/", import.meta.url));
const providers = readFileSync(`${appRoot}providers.tsx`, "utf8");
const speedProvider = readFileSync(`${appRoot}speed-wallet-provider.tsx`, "utf8");
const walletConfig = readFileSync(`${appRoot}wallet-config.ts`, "utf8");
const walletButton = readFileSync(`${appRoot}wallet-button.tsx`, "utf8");
const privyWalletButton = readFileSync(`${appRoot}privy-wallet-button.tsx`, "utf8");
const rmtIdentity = readFileSync(`${appRoot}rmt-identity.tsx`, "utf8");
const walletTransferDialog = readFileSync(`${appRoot}wallet-transfer-dialog.tsx`, "utf8");
const walletReceiveDialog = readFileSync(`${appRoot}wallet-receive-dialog.tsx`, "utf8");
const privyFundingActions = readFileSync(`${appRoot}privy-funding-actions.tsx`, "utf8");
const fundWalletButton = readFileSync(`${appRoot}fund-wallet-button.tsx`, "utf8");
const overlayPortal = readFileSync(`${appRoot}overlay-portal.tsx`, "utf8");
const combined = `${providers}\n${speedProvider}\n${walletButton}\n${privyWalletButton}\n${walletTransferDialog}\n${walletReceiveDialog}\n${fundWalletButton}\n${overlayPortal}`;

assert.equal(normalizePrivyAppId("a".repeat(25)), "a".repeat(25), "A valid Privy app ID must activate Speed Wallet.");
assert.equal(normalizePrivyAppId("too-short"), undefined, "An invalid Privy app ID must fail closed.");
assert.equal(normalizePrivyAppId(undefined), undefined, "A missing Privy app ID must preserve the legacy wallet path.");
assert.equal(isMobileWebUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile"), true);
assert.equal(isMobileWebUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), false);
assert.equal(walletBrowserEnvironment("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile", true), "mobile-wallet-browser");
assert.equal(walletBrowserEnvironment("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile", false), "mobile-browser");
assert.equal(
  metaMaskDappLink("https://www.rmtlaunch.fun/?asset=RMT"),
  "https://link.metamask.io/dapp/www.rmtlaunch.fun/?asset=RMT",
  "Mobile MetaMask must open the exact RMT route through MetaMask's current universal link."
);
assert.match(providers, /speedWalletEnabled/, "Speed Wallet must remain environment-gated.");
assert.match(walletConfig, /function createLegacyWalletConnectors/, "Legacy connectors must be initialized only when the legacy provider renders.");
assert.match(providers, /connectors:\s*createLegacyWalletConnectors\(\)/, "The legacy provider must own legacy connector initialization.");
assert.doesNotMatch(speedProvider, /createLegacyWalletConnectors/, "Privy must not initialize RMT's legacy WalletConnect connector a second time.");
assert.match(speedProvider, /@privy-io\/wagmi/, "Embedded wallets must use Privy's official Wagmi adapter.");
assert.match(speedProvider, /createOnLogin:\s*"users-without-wallets"/, "Privy must not create a second wallet for a trader who already has an external wallet.");
assert.match(speedProvider, /showWalletLoginFirst:\s*true/, "Privy must prioritize the wallet already available to a trader.");
assert.match(walletButton, /if \(speedWalletEnabled\) return <PrivyWalletButton/, "Privy must own the wallet entry point whenever validly configured.");
assert.match(privyWalletButton, /"Connect trading wallet"/, "VNext must lead with a trading-wallet connection rather than a profile login.");
assert.match(privyWalletButton, /pathname === "\/" \|\| pathname === "\/vnext"/, "The production root must retain VNext's external-wallet-only boundary.");
assert.match(privyWalletButton, /identity\.connectTradingWallet\(\)/, "VNext must use the external-wallet-only Privy flow.");
assert.doesNotMatch(privyWalletButton, /useConnectOrCreateWallet|connectOrCreateWallet\(/, "RMT must not open a connection-only flow before wallet authentication.");
assert.match(privyWalletButton, /mobileMetaMaskUrl/, "Mobile traders must have a direct MetaMask app handoff outside blocked embedded-browser connection modals.");
assert.match(privyWalletButton, /Connect this wallet/, "A mobile wallet browser must offer its injected wallet directly.");
assert.match(privyWalletButton, /Rabby \/ other/, "Mobile traders must have a clear Rabby and WalletConnect fallback.");
assert.match(rmtIdentity, /supportsOAuth \? \["email", "google", "passkey", "wallet"\] : \["wallet"\]/, "Wallet browsers must not offer OAuth flows that cannot leave their embedded browser.");
assert.doesNotMatch(privyFundingActions, /onClick=\{login\}/, "Funding entry points must use RMT's environment-aware Privy login.");
assert.ok(
  privyFundingActions.indexOf("if (!authenticated)") < privyFundingActions.indexOf("if (!funding.enabled)"),
  "A trader must be able to create or recover the wallet before provider funding availability is evaluated."
);
assert.match(speedProvider, /"metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"/, "Privy must put named mobile wallets before desktop-only detection and the full registry.");
assert.match(privyWalletButton, /useSetActiveWallet/, "An authenticated user must still be able to choose the exact active trading wallet.");
assert.match(privyWalletButton, /!walletFirstTerminal && <p className="privyProfileBoundary">/, "VNext must keep profile controls out of its wallet menu.");
assert.match(providers, /const profileCompatibilityEnabled = \[/, "Profile sync must be limited to explicit compatibility routes.");
assert.doesNotMatch(providers, /"\/vnext"/, "VNext must not initialize the profile sync runtime.");
assert.match(privyWalletButton, />Deposit</, "The exact active wallet must expose Privy funding.");
assert.match(privyWalletButton, />Receive</, "The exact active wallet must expose its receive address.");
assert.match(privyWalletButton, /privyActiveWalletSummary/, "The wallet control center must identify its exact active wallet and network.");
assert.match(privyWalletButton, /useDisconnect/, "Disconnect must clear RMT's Wagmi wallet state as well as the Privy session.");
assert.match(privyWalletButton, /disconnectWagmi\(\)/, "Disconnect must remove the active wallet from RMT even when the wallet provider cannot revoke its own permission.");
assert.match(privyWalletButton, /await logout\(\)/, "Authenticated Privy sessions must be ended during disconnect.");
assert.match(privyWalletButton, />Disconnect from RMT</, "The wallet menu must clearly describe the scope of disconnecting.");
assert.match(privyWalletButton, />Send</, "The exact active wallet must expose a user-reviewed transfer flow.");
assert.match(privyWalletButton, />Trade</, "Wallet management must return users to RMT's independently verified trade routes.");
assert.doesNotMatch(combined, /policyIds:\s*\[\s*\]/, "RMT must never attach an unrestricted signer.");
assert.doesNotMatch(combined, /privateKey|authorizationPrivateKey|appSecret/, "Client code must not contain signing secrets.");
assert.match(walletReceiveDialog, /Chain ID \{targetChain\.id\}/, "Receive must identify the exact destination network.");
assert.match(walletReceiveDialog, /Copy full address/, "Receive must show and copy the full active-wallet address.");
assert.match(walletButton, /<OverlayPortal>/, "Legacy wallet controls must escape the transformed header before rendering an overlay.");
assert.match(privyWalletButton, /<OverlayPortal>/, "Privy wallet controls must escape the transformed header before rendering an overlay.");
assert.match(fundWalletButton, /<OverlayPortal>/, "Funding controls must stay inside the visual viewport.");
assert.match(fundWalletButton, /Receive at active wallet/, "Funding must retain a direct onchain receive path when provider funding is unavailable.");
assert.match(fundWalletButton, /<WalletReceiveDialog/, "Funding recovery must reuse the exact active-wallet receive boundary.");
assert.match(fundWalletButton, /directReceive && address \? setReceiveOpen\(true\) : setOpen\(true\)/, "Gas recovery must be able to open the exact receive flow in one action.");
assert.match(walletTransferDialog, /<OverlayPortal>/, "Transfer controls must stay inside the visual viewport.");
assert.match(walletReceiveDialog, /<OverlayPortal>/, "Receive controls must stay inside the visual viewport.");
assert.match(overlayPortal, /createPortal\(children, document\.body\)/, "Wallet sheets must render above transformed navigation and community layers.");

console.log("VNext wallet entry remains external-first, exact-wallet bound, and signer-disabled by default.");
