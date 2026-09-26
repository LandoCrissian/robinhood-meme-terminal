import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizePrivyAppId } from "./privy-config";
import { isMobileWebUserAgent, metaMaskDappLink, rabbyDappLink, walletBrowserEnvironment } from "./mobile-wallet-link";

const appRoot = fileURLToPath(new URL("../app/", import.meta.url));
const providers = readFileSync(`${appRoot}providers.tsx`, "utf8");
const speedProvider = readFileSync(`${appRoot}speed-wallet-provider.tsx`, "utf8");
const walletConfig = readFileSync(`${appRoot}wallet-config.ts`, "utf8");
const walletButton = readFileSync(`${appRoot}wallet-button.tsx`, "utf8");
const privyWalletButton = readFileSync(`${appRoot}privy-wallet-button.tsx`, "utf8");
const rmtIdentity = readFileSync(`${appRoot}rmt-identity.tsx`, "utf8");
const walletConnectionController = readFileSync(fileURLToPath(new URL("./wallet-connection-controller.ts", import.meta.url)), "utf8");
const walletGateway = readFileSync(fileURLToPath(new URL("./wallet-gateway.ts", import.meta.url)), "utf8");
const walletTransferDialog = readFileSync(`${appRoot}wallet-transfer-dialog.tsx`, "utf8");
const walletReceiveDialog = readFileSync(`${appRoot}wallet-receive-dialog.tsx`, "utf8");
const dialogFocus = readFileSync(`${appRoot}dialog-focus.ts`, "utf8");
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
assert.equal(walletBrowserEnvironment("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true), "desktop");
assert.equal(
  metaMaskDappLink("https://www.rmtlaunch.fun/?asset=RMT"),
  "https://link.metamask.io/dapp/www.rmtlaunch.fun/?asset=RMT",
  "Mobile MetaMask must open the exact RMT route through MetaMask's current universal link."
);
const rabbyUrl = new URL(rabbyDappLink("https://www.rmtlaunch.fun/?market=0x1234&side=buy#quote"));
assert.equal(rabbyUrl.origin, "https://go.rabby.io", "Mobile Rabby must use its official production universal-link host.");
assert.equal(rabbyUrl.pathname, "/mobile/", "Mobile Rabby must use its official production link path.");
assert.equal(rabbyUrl.searchParams.get("_cmd"), "open-dapp", "Mobile Rabby must receive the open-dapp command.");
assert.equal(
  decodeURIComponent(rabbyUrl.searchParams.get("dapp") ?? ""),
  "https://www.rmtlaunch.fun/?market=0x1234&side=buy#quote",
  "Mobile Rabby must open the exact RMT route, including query and hash state."
);
assert.throws(() => rabbyDappLink("javascript:alert(1)"), /HTTP\(S\)/, "Rabby handoff must reject non-web destinations.");
assert.match(providers, /speedWalletEnabled/, "Speed Wallet must remain environment-gated.");
assert.match(walletConfig, /function createLegacyWalletConnectors/, "Legacy connectors must be initialized only when the legacy provider renders.");
assert.match(providers, /connectors:\s*createLegacyWalletConnectors\(\)/, "The legacy provider must own legacy connector initialization.");
assert.doesNotMatch(speedProvider, /createLegacyWalletConnectors/, "Privy must not initialize RMT's legacy WalletConnect connector a second time.");
assert.match(speedProvider, /@privy-io\/wagmi/, "Embedded wallets must use Privy's official Wagmi adapter.");
assert.match(speedProvider, /createOnLogin:\s*"users-without-wallets"/, "Privy must not create a second wallet for a trader who already has an external wallet.");
assert.doesNotMatch(rmtIdentity, /useCreateWallet|createWallet\s*\(/,
  "Privy's createOnLogin configuration must be the only embedded-wallet creation owner.");
assert.doesNotMatch(rmtIdentity, /walletProvider\s*!==\s*connectorProvider/,
  "Privy may return equivalent provider wrappers; signer authority must use exact connector UID/account/chain postconditions instead of object identity.");
assert.match(rmtIdentity, /await switchChainAsync\(\{ connector: selected, chainId: 4_663 \}\);[\s\S]*correctedConnection[\s\S]*await switchAccountAsync\(\{ connector: selected \}\)/,
  "A returning embedded signer must correct and verify the exact connector chain before making it current.");
assert.match(rmtIdentity, /wallet: activeExternalBinding\?\.wallet/,
  "Same-address external selection confirms the exact raw Privy preference key rather than a rewritten transport key.");
assert.match(speedProvider, /showWalletLoginFirst:\s*false/, "Privy sign-in must create or restore the embedded consumer wallet before offering optional connectors.");
assert.match(speedProvider, /self-custodial RMT wallet/, "Privy copy must describe the embedded self-custodial default.");
assert.match(walletButton, /if \(speedWalletEnabled \|\| accountFirstBrowserAcceptanceBuild\) return <PrivyWalletButton/,
  "Privy must own the wallet entry point whenever validly configured; the separate loopback-only profile exercises that same component.");
assert.equal(
  [...privyWalletButton.matchAll(/>\s*Sign in\s*</g)].length,
  1,
  "VNext must expose one prominent account-first sign-in action."
);
assert.match(privyWalletButton, /pathname === "\/" \|\| pathname === "\/vnext"/, "The production root must retain the exact-wallet terminal boundary.");
assert.match(privyWalletButton, /aria-label="Manage wallets"/, "Connected traders must have one account-management surface.");
assert.match(privyWalletButton, />Connect existing wallet</, "External wallets must remain available inside account management.");
assert.match(privyWalletButton, /identity\.connectTradingWallet\(\)/, "The account-management action must retain the exact external-wallet selection boundary.");
assert.doesNotMatch(privyWalletButton, /useConnectOrCreateWallet|connectOrCreateWallet\(/, "RMT must not open a connection-only flow before wallet authentication.");
assert.doesNotMatch(privyWalletButton, /mobileMetaMaskUrl|mobileRabbyUrl|mobile-wallet-entry-dialog/, "Wallet-specific launchers must not compete with the single Sign in entry.");
assert.match(privyWalletButton, /Email, passkey, or this wallet are available here/, "Wallet browsers must retain supported sign-in choices.");
assert.match(privyWalletButton, /Open RMT in Safari or Chrome to use Google sign-in/, "Unsupported wallet-browser OAuth must have a clear normal-browser fallback.");
assert.match(rmtIdentity, /supportsOAuth \? \["email", "google", "passkey", "wallet"\] : \["email", "passkey", "wallet"\]/, "Wallet browsers must preserve email and passkey without claiming Google OAuth support.");
assert.match(privyWalletButton, /Preparing your RMT wallet/, "Authenticated users must see in-place embedded-wallet provisioning progress.");
assert.match(privyWalletButton, /Creating or restoring your self-custodial wallet/, "Provisioning copy must describe the idempotent embedded-wallet path.");
assert.match(privyWalletButton, /Retry RMT wallet/, "A failed embedded-wallet provision must be retryable in place.");
assert.match(privyWalletButton, /Reload wallet connection/, "An already-linked embedded wallet must refresh its SDK session instead of attempting duplicate creation.");
assert.match(privyWalletButton, /Sign out and sign in again/, "A missing linked-wallet signing record must expose a supported reauthentication recovery.");
assert.match(rmtIdentity, /recoveryAction === "reload-session"[\s\S]*?window\.location\.reload\(\)/,
  "Reload recovery must bypass createWallet for an already-linked embedded account.");
assert.doesNotMatch(privyFundingActions, /onClick=\{login\}/, "Funding entry points must use RMT's environment-aware Privy login.");
assert.ok(
  privyFundingActions.indexOf("if (!authenticated)") < privyFundingActions.indexOf("if (!funding.enabled)"),
  "A trader must be able to create or recover the wallet before provider funding availability is evaluated."
);
assert.match(speedProvider, /rmtExternalWalletOptions\(\)/, "Privy appearance must use the canonical external-wallet registry.");
assert.match(rmtIdentity, /useConnectWallet/, "All terminal external connections must use Privy's current connection hook.");
assert.match(
  rmtIdentity,
  /environment === "mobile-wallet-browser"[\s\S]*?rmtInjectedWalletOptions\(\)[\s\S]*?: rmtExternalWalletOptions\(\)/,
  "Wallet in-app browsers must show only their detected injected wallet without narrowing desktop or standard-mobile choices."
);
assert.match(rmtIdentity, /needsLogin: \(\) => !currentIdentity\.current\.authenticated \|\| !wallet\.linked/, "The selected external wallet must authenticate or link when needed.");
assert.match(walletConnectionController, /scope\.step\(\(\) => wallet\.loginOrLink\(\)\)/, "Wallet SIWE must run through the bounded selection scope.");
assert.match(rmtIdentity, /embeddedSignerWallet \? confirmedEmbeddedBinding!\.key/,
  "The embedded wallet must publish the exact source wallet key whose signer authority was independently confirmed.");
assert.match(rmtIdentity, /walletBindings[\s\S]*?privyWagmiConnectorId\(wallet\)[\s\S]*?config\.connectors\.filter[\s\S]*?privyWalletSignerAuthority/,
  "RMT must preserve source-wallet provenance while proving one exact Privy/Wagmi signer connector.");
assert.match(rmtIdentity, /resolveConfirmedEmbeddedWalletKey\([\s\S]*?embeddedSnapshot[\s\S]*?4_663/,
  "Embedded authority must bind the unique current connector, account, and Robinhood Chain before publishing a signer.");
assert.match(rmtIdentity, /resolveAutomaticEmbeddedWalletCandidate/,
  "Automatic embedded-wallet activation must preserve exact durable choice and never replace a reconnected external signer.");
assert.match(rmtIdentity, /correctedConnection\?\.chainId !== 4_663/,
  "A returning embedded wallet must verify its exact Wagmi connector reached Robinhood Chain before authority is published.");
assert.match(rmtIdentity, /rmtActiveWalletPreferenceKey/,
  "Returning external-wallet users must retain an exact Privy-user-scoped wallet choice across browser sessions.");
assert.match(rmtIdentity, /await switchAccountAsync\(\{ connector: selected \}\)/, "Switching must await the exact connector mutation.");
assert.match(rmtIdentity, /await connectAsync\(\{ connector: selected, chainId: 4_663 \}\)/, "Connecting must await the exact connector mutation.");
assert.doesNotMatch(rmtIdentity, /useSetActiveWallet|setActiveWallet\(wallet\)/,
  "Embedded activation must issue one exact awaited Wagmi mutation, not a concurrent fire-and-forget mutation.");
assert.match(rmtIdentity, /connectorProvider !== provider/, "The connector must match the independently selected provider instance.");
assert.match(rmtIdentity, /useConnectWallet\(\)/, "Uncorrelated global connection callbacks must not activate a wallet.");
assert.match(rmtIdentity, /walletGatewayKey/, "Trading identity must be connector-qualified rather than address-only.");
assert.match(privyWalletButton, /identity\.selectTradingWallet\(walletKey\)/, "The wallet menu must activate an exact gateway identity.");
assert.match(privyWalletButton, /RMT will use only the wallet you choose/, "Same-address connector ambiguity must require an explicit choice.");
assert.match(privyWalletButton, /Reconnect trading wallet[\s\S]*Connect existing wallet/,
  "An authenticated returning external-wallet user must receive an explicit reconnect path rather than another sign-in prompt.");
assert.doesNotMatch(privyWalletButton, /selectTradingWallet\(walletGatewayKey\(externalWallets\[0\]\)\)/, "RMT must not trigger wallet linking or selection automatically on page load.");
assert.match(walletGateway, /"detected_ethereum_wallets"/, "The canonical registry must admit EIP-6963 wallets.");
assert.doesNotMatch(walletGateway.match(/RMT_EXTERNAL_WALLET_LIST = \[[\s\S]*?\] as const/)?.[0] ?? "", /rabby_wallet/, "The deprecated Rabby identifier must not enter the canonical registry.");
assert.match(privyWalletButton, /!walletFirstTerminal && <p className="privyProfileBoundary">/, "VNext must keep profile controls out of its wallet menu.");
assert.match(providers, /const profileCompatibilityEnabled = \[/, "Profile sync must be limited to explicit compatibility routes.");
assert.doesNotMatch(providers, /"\/vnext"/, "VNext must not initialize the profile sync runtime.");
assert.match(privyWalletButton, />Deposit</, "The exact active wallet must expose Privy funding.");
assert.match(privyWalletButton, />Receive</, "The exact active wallet must expose its receive address.");
assert.match(privyWalletButton, /privyActiveWalletSummary/, "The wallet control center must identify its exact active wallet and network.");
assert.match(privyWalletButton, /useDisconnect/, "Disconnect must clear RMT's Wagmi wallet state as well as the Privy session.");
assert.match(privyWalletButton, /disconnectWagmi\(\)/, "Disconnect must remove the active wallet from RMT even when the wallet provider cannot revoke its own permission.");
assert.match(privyWalletButton, /await identity\.logout\(\)/, "Authenticated Privy sessions must be ended through the identity boundary during disconnect.");
assert.match(privyWalletButton, />Disconnect from RMT</, "The wallet menu must clearly describe the scope of disconnecting.");
assert.match(privyWalletButton, />Send</, "The exact active wallet must expose a user-reviewed transfer flow.");
assert.match(privyWalletButton, />Trade</, "Wallet management must return users to RMT's independently verified trade routes.");
assert.doesNotMatch(combined, /policyIds:\s*\[\s*\]/, "RMT must never attach an unrestricted signer.");
assert.doesNotMatch(combined, /privateKey|authorizationPrivateKey|appSecret/, "Client code must not contain signing secrets.");
assert.match(walletReceiveDialog, /Chain ID \{targetChain\.id\}/, "Receive must identify the exact destination network.");
assert.match(walletReceiveDialog, /Copy full address/, "Receive must show and copy the full active-wallet address.");
assert.match(walletReceiveDialog, /QRCodeSVG/, "Receive must render a local QR code for the exact destination address.");
assert.match(walletReceiveDialog, /Assets sent on Ethereum mainnet are not spendable on Robinhood Chain/, "Receive must not imply that same-address funds are cross-chain spendable.");
assert.match(walletButton, /<OverlayPortal>/, "Legacy wallet controls must escape the transformed header before rendering an overlay.");
assert.match(privyWalletButton, /<OverlayPortal>/, "Privy wallet controls must escape the transformed header before rendering an overlay.");
assert.match(privyWalletButton, /dialogFocusableElements\(menuDialog\.current\)/,
  "Account dialogs must trap keyboard focus across every interactive control.");
assert.doesNotMatch(privyWalletButton, /role="listitem"/,
  "Clickable wallet choices must retain their native button semantics.");
assert.match(privyWalletButton, /const focusTarget = returnFocus\.current\?\.isConnected[\s\S]*focusTarget\?\.focus/,
  "Account dialogs must restore focus when they close.");
assert.match(fundWalletButton, /<OverlayPortal>/, "Funding controls must stay inside the visual viewport.");
assert.match(fundWalletButton, /dialogFocusableElements\(dialog\.current\)/,
  "The Deposit focus trap must include expandable provider methods and standard form controls.");
assert.match(dialogFocus, /details:not\(\[open\]\)/,
  "Closed funding details must not leak hidden controls into a modal focus trap.");
assert.match(dialogFocus, /getClientRects\(\)\.length > 0/,
  "Dialog traps must ignore controls that are not actually rendered.");
assert.match(fundWalletButton, /restoreTriggerFocus\.current = false/,
  "Deposit-to-Receive handoff must not return focus behind the newly opened modal.");
assert.match(fundWalletButton, /Show address &amp; QR/, "Deposit must lead with a direct onchain receive path.");
assert.match(fundWalletButton, /Exact destination/, "Deposit must bind the destination before offering provider methods.");
assert.match(fundWalletButton, /identity\.activeWalletKey[\s\S]*?wallet\.key === identity\.activeWalletKey/,
  "Account-first Deposit must resolve the exact selected signer key before showing an address.");
assert.match(fundWalletButton, /connectedAddress\?\.toLowerCase\(\) === selectedWallet\.address\.toLowerCase\(\)/,
  "Deposit destination must equal the connector-qualified active account.");
assert.match(fundWalletButton, /targetChain\.name[\s\S]*?targetChain\.id/,
  "Deposit labels must derive from the same target passed to the receive dialog.");
assert.match(fundWalletButton, /target === "mainnet" && speedWalletEnabled/,
  "Privy provider checkout must never be mounted for a testnet destination.");
assert.match(fundWalletButton, /Other funding methods/, "Optional provider methods must remain secondary to direct receive.");
assert.match(fundWalletButton, /<WalletReceiveDialog/, "Funding recovery must reuse the exact active-wallet receive boundary.");
assert.match(fundWalletButton, /directReceive && address \? setReceiveOpen\(true\) : setOpen\(true\)/, "Gas recovery must be able to open the exact receive flow in one action.");
assert.match(walletTransferDialog, /<OverlayPortal>/, "Transfer controls must stay inside the visual viewport.");
assert.match(walletReceiveDialog, /<OverlayPortal>/, "Receive controls must stay inside the visual viewport.");
assert.match(overlayPortal, /createPortal\(children, document\.body\)/, "Wallet sheets must render above transformed navigation and community layers.");

console.log("VNext wallet entry is embedded-first, retains optional external wallets, and binds the exact selected signer.");
