import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizePrivyAppId } from "./privy-config";
import { isMobileWebUserAgent, metaMaskDappLink } from "./mobile-wallet-link";

const appRoot = fileURLToPath(new URL("../app/", import.meta.url));
const providers = readFileSync(`${appRoot}providers.tsx`, "utf8");
const speedProvider = readFileSync(`${appRoot}speed-wallet-provider.tsx`, "utf8");
const speedEntry = readFileSync(`${appRoot}speed-wallet-entry.tsx`, "utf8");
const walletConfig = readFileSync(`${appRoot}wallet-config.ts`, "utf8");
const walletButton = readFileSync(`${appRoot}wallet-button.tsx`, "utf8");
const privyWalletButton = readFileSync(`${appRoot}privy-wallet-button.tsx`, "utf8");
const walletTransferDialog = readFileSync(`${appRoot}wallet-transfer-dialog.tsx`, "utf8");
const walletReceiveDialog = readFileSync(`${appRoot}wallet-receive-dialog.tsx`, "utf8");
const fundWalletButton = readFileSync(`${appRoot}fund-wallet-button.tsx`, "utf8");
const overlayPortal = readFileSync(`${appRoot}overlay-portal.tsx`, "utf8");
const combined = `${providers}\n${speedProvider}\n${speedEntry}\n${walletButton}\n${privyWalletButton}\n${walletTransferDialog}\n${walletReceiveDialog}\n${fundWalletButton}\n${overlayPortal}`;

assert.equal(normalizePrivyAppId("a".repeat(25)), "a".repeat(25), "A valid Privy app ID must activate Speed Wallet.");
assert.equal(normalizePrivyAppId("too-short"), undefined, "An invalid Privy app ID must fail closed.");
assert.equal(normalizePrivyAppId(undefined), undefined, "A missing Privy app ID must preserve the legacy wallet path.");
assert.equal(isMobileWebUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile"), true);
assert.equal(isMobileWebUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), false);
assert.equal(
  metaMaskDappLink("https://www.rmtlaunch.fun/vnext?asset=RMT"),
  "https://link.metamask.io/dapp/www.rmtlaunch.fun/vnext?asset=RMT",
  "Mobile MetaMask must open the exact RMT route through MetaMask's current universal link."
);
assert.match(providers, /speedWalletEnabled/, "Speed Wallet must remain environment-gated.");
assert.match(walletConfig, /function createLegacyWalletConnectors/, "Legacy connectors must be initialized only when the legacy provider renders.");
assert.match(providers, /connectors:\s*createLegacyWalletConnectors\(\)/, "The legacy provider must own legacy connector initialization.");
assert.doesNotMatch(speedProvider, /createLegacyWalletConnectors/, "Privy must not initialize RMT's legacy WalletConnect connector a second time.");
assert.match(speedProvider, /@privy-io\/wagmi/, "Embedded wallets must use Privy's official Wagmi adapter.");
assert.match(speedProvider, /createOnLogin:\s*"all-users"/, "A user who chooses Privy sign-in must receive an RMT wallet.");
assert.match(speedEntry, /useExportWallet/, "The user-owned wallet must expose recovery/export controls.");
assert.match(speedEntry, /useSetWalletRecovery/, "The user-owned wallet must expose cross-device recovery controls.");
assert.match(speedEntry, /useMfaEnrollment/, "The user-owned wallet must expose MFA enrollment controls.");
assert.match(speedEntry, /Session permissions remain off/, "Signer permissions must be visibly fail-closed.");
assert.match(walletButton, /if \(speedWalletEnabled\) return <PrivyWalletButton/, "Privy must own the wallet entry point whenever validly configured.");
assert.match(privyWalletButton, /useConnectOrCreateWallet/, "Privy must provide a connect-or-create path for first-time traders.");
assert.match(privyWalletButton, /mobileMetaMaskUrl/, "Mobile traders must have a direct MetaMask app handoff outside blocked embedded-browser connection modals.");
assert.match(speedProvider, /"metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"/, "Privy must put named mobile wallets before desktop-only detection and the full registry.");
assert.match(privyWalletButton, /useSetActiveWallet/, "Traders must be able to choose the exact wallet RMT uses.");
assert.match(privyWalletButton, /requestedWalletAddress/, "A newly connected external wallet must remain the requested active wallet after Privy finishes linking it.");
assert.match(privyWalletButton, /One RMT account carries your private profile and wallet choices/, "Wallet selection must explain RMT's unified Privy identity boundary.");
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

console.log("Speed Wallet remains optional, user-owned, exportable, and signer-disabled by default.");
