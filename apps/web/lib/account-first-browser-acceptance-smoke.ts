import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLoopbackAcceptanceHostname } from "./account-first-browser-acceptance";

const identity = readFileSync(new URL("../app/rmt-identity.tsx", import.meta.url), "utf8");
const providers = readFileSync(new URL("../app/providers.tsx", import.meta.url), "utf8");
const speedProvider = readFileSync(new URL("../app/speed-wallet-provider.tsx", import.meta.url), "utf8");
const connector = readFileSync(new URL("./vnext/browser-walletconnect-fixture.ts", import.meta.url), "utf8");
const walletButton = readFileSync(new URL("../app/wallet-button.tsx", import.meta.url), "utf8");
const privyWalletButton = readFileSync(new URL("../app/privy-wallet-button.tsx", import.meta.url), "utf8");
const tradeComposer = readFileSync(new URL("../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const walletAssets = readFileSync(new URL("../app/vnext/use-vnext-wallet-assets.ts", import.meta.url), "utf8");
const terminalCss = readFileSync(new URL("../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
const terminalPresentations = readFileSync(new URL("../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
const fundingButton = readFileSync(new URL("../app/fund-wallet-button.tsx", import.meta.url), "utf8");
const walletCss = readFileSync(new URL("../app/wallet.css", import.meta.url), "utf8");
const interfacePolishCss = readFileSync(new URL("../app/interface-polish.css", import.meta.url), "utf8");
const browserAcceptance = readFileSync(new URL("../../../.github/scripts/account-first-browser-acceptance.mjs", import.meta.url), "utf8");

assert.equal(isLoopbackAcceptanceHostname("localhost"), true);
assert.equal(isLoopbackAcceptanceHostname("127.0.0.1"), true);
assert.equal(isLoopbackAcceptanceHostname("www.rmtlaunch.fun"), false);
assert.equal(isLoopbackAcceptanceHostname("localhost.example"), false);

assert.match(identity, /accountFirstBrowserAcceptanceEnabled\(\)/,
  "The embedded fixture identity must require the compile flag plus runtime loopback guard.");
assert.match(identity, /connector\?\.id === "rmt-walletconnect-fixture"/,
  "The embedded fixture may become ready only through the exact deterministic connector.");
assert.match(identity, /chainId === 4_663/,
  "The embedded fixture may become ready only on Robinhood Chain.");
assert.match(identity, /const activeWalletKind = exactConnection \? "embedded" as const : externalReady \? "external" as const : null/,
  "Acceptance must exercise the real embedded-wallet UI state.");
assert.match(identity, /const activeWalletKey = exactConnection \? embeddedKey : externalReady \? externalKey : null/,
  "No signer key may be published before exact connector binding.");
assert.match(identity, /RETURNING_REUSED/,
  "The fixture must distinguish exact existing-wallet reuse from wallet creation.");
assert.match(identity, /setReturningUser\(true\);[\s\S]*setAuthenticated\(true\);[\s\S]*setProvisioning\("connecting"\)/,
  "A returning fixture user reconnects the existing account without entering creation state.");
assert.match(identity, /RETURNING_CONNECTING[\s\S]*wagmiConfig\.state\.status[\s\S]*status === "disconnected"[\s\S]*reconnectAsync\(\{ connectors: \[fixtureConnector\] \}\)/,
  "Returning acceptance waits for Wagmi hydration and uses its reconnect mutation instead of racing a second connect.");
assert.match(identity, /setTimeout\(\(\) => \{[\s\S]*transportExactConnectionRef\.current[\s\S]*setProvisioning\("failed"\)[\s\S]*\}, 5_000\)/,
  "Returning acceptance has a bounded visible failure instead of waiting indefinitely.");
assert.match(providers, /accountFirstBrowserAcceptanceBuild[\s\S]*AccountFirstAcceptanceIdentityBridge/,
  "The account profile must be isolated from the existing external-wallet profile.");
assert.match(connector, /isLoopbackAcceptanceHostname\(window\.location\.hostname\)/,
  "The deterministic connector must remain loopback-only.");
assert.match(walletButton, /speedWalletEnabled \|\| accountFirstBrowserAcceptanceBuild/,
  "The profile must render the same account-first wallet component as production.");
assert.match(identity, /waitForEmbeddedWalletActivation/,
  "Production embedded activation must wait for an independently observed connector postcondition.");
assert.match(identity, /resolveConfirmedEmbeddedWalletKey\([\s\S]*embeddedSnapshot, 4_663/,
  "Production embedded authority requires an exact current connector/account on Robinhood Chain.");
assert.match(identity, /walletBindings[\s\S]*privyWalletSignerAuthority[\s\S]*key: rawKey/,
  "Trade authority must retain the exact source wallet key plus its independently proven signer connector.");
assert.match(identity, /tradingWallets[\s\S]*\.\.\.embeddedWallets\.map[\s\S]*\.\.\.externalWalletBindings\.map/,
  "An existing embedded identity remains selectable while its exact connector arrives; authority is still withheld until binding succeeds.");
assert.match(identity, /resolveAutomaticEmbeddedWalletCandidate/,
  "Automatic embedded activation must preserve a durable explicit choice and never replace a reconnected external signer.");
assert.match(identity, /rmtActiveWalletPreferenceKey/,
  "Returning users keep one exact per-user wallet preference across browser sessions.");
assert.match(identity, /rawMatches\.length === 1[\s\S]*setPreferredWalletKey\(null\)/,
  "A removed or ambiguous durable wallet preference recovers instead of leaving onboarding stuck.");
assert.match(identity, /waitForExactWalletConnector/,
  "An existing wallet whose adapter connector is delayed must enter bounded in-place recovery rather than another creation attempt.");
assert.match(identity, /linkedEmbeddedRecordPending = linkedEmbeddedWalletCount > 0 && embeddedWallets\.length === 0/,
  "An already-linked embedded record must receive bounded recovery even while an external wallet is available.");
assert.match(identity, /currentIdentity\.current\.wallets\.some\(\(wallet\) => \([\s\S]*isEmbeddedWalletClientType\(wallet\.walletClientType\)/,
  "An external wallet record cannot suppress the missing-embedded-record observer.");
assert.doesNotMatch(identity, /useSetActiveWallet|setActiveWallet\(wallet\)/,
  "Embedded activation must not launch two concurrent connector mutations.");
assert.match(identity, /resolveExactEmbeddedWalletCandidate/,
  "Multiple embedded wallets are activated only through an explicit exact-key choice.");
assert.match(identity, /connectorType: connector\.type[\s\S]*walletClientType: "privy-v2"/,
  "The loopback account keeps embedded UX identity while retaining its actual deterministic connector key.");
assert.match(identity, /activeSignerAuthority:[\s\S]*adapter: "direct"[\s\S]*originConnectorType: connector\.type[\s\S]*walletKind: activeWalletKind/,
  "The loopback fixture must not impersonate production Privy/Wagmi authority.");
assert.match(privyWalletButton, /bindRmtActiveSigner\(\{[\s\S]*selectedWalletKey: identity\.activeWalletKey[\s\S]*connectorUid: connector\?\.uid[\s\S]*\}\)\.address/,
  "The global account menu must display and fund only the exact selected signer account on every route.");
assert.doesNotMatch(privyWalletButton, /!walletFirstTerminal \|\| identity\.activeWalletKind !== null/,
  "A non-terminal route cannot turn raw Wagmi transport state into account or deposit authority.");
assert.match(identity, /canPublishEmbeddedWalletAuthority/,
  "Production must withhold rehydrated embedded authority until exact-user preference and ownership are established.");
assert.match(identity, /embeddedWalletCandidateCount: embeddedWalletBindings\.length/,
  "Multiple embedded candidates require an explicit exact preference before signer authority can publish.");
assert.match(identity, /shouldAutomaticallyProvisionEmbeddedWallet/,
  "A disconnected linked external wallet must prevent automatic embedded-wallet creation.");
assert.match(speedProvider, /createOnLogin:\s*"users-without-wallets"/,
  "Privy's one configured createOnLogin path is the sole owner of new embedded-wallet creation.");
assert.equal(speedProvider.match(/createOnLogin:\s*"users-without-wallets"/g)?.length, 1,
  "The installed Privy provider has exactly one configured createOnLogin authority.");
assert.doesNotMatch(identity, /useCreateWallet|createWallet\s*\(/,
  "The identity layer may observe and recover Privy provisioning but must never start a competing wallet-creation path.");
assert.match(identity, /LINKED_EXTERNAL_COLD_RETURN[\s\S]*EXTERNAL_RECONNECT_REQUESTED[\s\S]*EXTERNAL_RECONNECTED/,
  "The loopback profile must cover a linked external account with no connected record and require explicit reconnect.");
assert.match(identity, /PREFERENCE_HYDRATING[\s\S]*TRANSPORT_REHYDRATED[\s\S]*PREFERENCE_HYDRATED/,
  "The loopback profile must observe rehydrated transport before delayed preference authority settles.");
assert.match(identity, /mode !== "external-preference-hydration" \|\| !preferenceLoaded[\s\S]*type: "PREFERENCE_HYDRATED"/,
  "Preference-hydrated evidence may be emitted only after React commits the hydrated state.");
assert.match(identity, /__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__/,
  "Render-sequence evidence must retain every published signer state so a transient substitution cannot escape detection.");
assert.doesNotMatch(privyWalletButton, /activeWalletKind === "embedded" && wallet\.address\.toLowerCase\(\) === address/,
  "A same-address wallet must never be marked active without the exact wallet key.");
assert.match(privyWalletButton, /const active = wallet\.key === identity\.activeWalletKey/,
  "Active-wallet presentation is bound to the exact normalized wallet key.");
assert.match(privyWalletButton, /failed \|\| identity\.embeddedWalletProvisioning === "connecting"[\s\S]*externalWallets\.map[\s\S]*Connect existing wallet/,
  "External wallet choices remain actionable while the embedded record observer is pending.");
assert.match(privyWalletButton, /const activeModal = connectionActive && connectionOpen \? "connection" : open \? "menu" : null/,
  "Wallet selection and connection recovery must share one explicit modal lifecycle.");
assert.match(privyWalletButton, /if \(connectionActive\) \{[\s\S]*setOpen\(false\);[\s\S]*setConnectionOpen\(true\)/,
  "Starting connection recovery must close the prior wallet popover before opening its recovery dialog.");
assert.match(privyWalletButton, /id="wallet-connection-dialog" role="dialog" aria-modal="true"[^>]*data-rmt-overlay-dialog="wallet-connection"/,
  "External-wallet recovery must remain a focus-managed overlay rather than expanding the mobile header.");
assert.match(privyWalletButton, /beginExternalConnection[\s\S]*setOpen\(false\)[\s\S]*setConnectionOpen\(true\)[\s\S]*identity\.connectTradingWallet\(\)/,
  "Every explicit external connection begins by transferring modal ownership.");
assert.match(privyWalletButton, /activeSignerAuthority\?\.adapter === "direct"[\s\S]*originConnectorType === "injected"/,
  "Only a direct injected signer exposes the independent EIP-6963 chooser; Privy-managed wallets use their exact connector client.");
assert.doesNotMatch(identity, /NEXT_PUBLIC_[A-Z0-9_]*(?:TOKEN|SECRET|KEY)/,
  "The fixture must not add a public credential.");
assert.match(browserAcceptance, /localStorage\.getItem\("rmt:account-first-returning"\) === walletAddress/,
  "Cold returning-user evidence must derive from storage carried into the new browser context.");
assert.doesNotMatch(browserAcceptance, /forcedReturningUser|returningUser:\s*true/,
  "The harness must not force a returning state independently of persisted browser evidence.");
assert.match(tradeComposer, /embeddedWalletRetryRequired[\s\S]*identity\.retryEmbeddedWalletProvisioning\(\)[\s\S]*Retry RMT wallet/,
  "An open trade ticket must own the bounded embedded-wallet retry instead of hiding it behind a mobile sheet backdrop.");
assert.match(tradeComposer, /authorizationEnabled[\s\S]*!stockTokenViewOnly[\s\S]*embeddedWalletProvisioning === "failed"/,
  "Wallet recovery presentation must not contradict preview-only or Stock Token policy states.");
assert.match(tradeComposer, /if \(embeddedWalletRetryRequired\) \{[\s\S]*preserveTradeDraft\(\)[\s\S]*if \(!draftPreserved\)[\s\S]*return;[\s\S]*identity\.retryEmbeddedWalletProvisioning\(\)/,
  "A controlled wallet-session reload must preserve the exact bounded draft before it starts.");
assert.match(tradeComposer, /if \(!identity\.authenticated[\s\S]*preserveTradeDraft\(\)[\s\S]*identity\.login\(\)/,
  "The normal sign-in path must synchronously preserve the bounded draft before redirect-capable login starts.");
assert.match(tradeComposer, /if \(!preserveTradeDraft\(\)\) \{[\s\S]*could not preserve this trade draft before sign-in[\s\S]*return;[\s\S]*pendingTradeAfterLogin[\s\S]*identity\.login\(\)/,
  "A redirect-capable sign-in must not start when bounded draft persistence fails.");
assert.match(tradeComposer, /if \(!address \|\| identity\.activeWalletKind === null\) \{[\s\S]*setWalletChoiceOpen\(true\)[\s\S]*return;/,
  "An authenticated user without exact signer authority must open wallet choice instead of replaying login.");
assert.match(tradeComposer, /Choose your trading wallet[\s\S]*identity\.tradingWallets\.map[\s\S]*Connect existing wallet/,
  "The trade ticket must expose exact embedded/external choices without a quote or wallet request.");
assert.match(tradeComposer, /!identity\.authenticated[\s\S]*\? "Sign in"[\s\S]*!address \|\| identity\.activeWalletKind === null[\s\S]*Choose trading wallet[\s\S]*Wallet options/,
  "Primary action copy must distinguish authentication from signer selection or reconnection.");
assert.match(tradeComposer, /fundingReason && requestedFundingAsset \? <FundWalletButton[\s\S]*variant="trade"[\s\S]*Deposit ETH for gas[\s\S]*Deposit \$\{inputSymbol\}/,
  "An authenticated underfunded account must receive one enabled primary Deposit action in the real trade ticket.");
assert.match(tradeComposer, /const requestedFundingAsset = !fundingReason \|\| !pair[\s\S]*fundingReason === "native-gas"[\s\S]*getAddress\(pair\.inputAsset\.id\.locator\.address\)[\s\S]*requestedAsset=\{requestedFundingAsset\}/,
  "The primary Deposit action must bind native gas or the exact selected ERC-20 contract rather than opening a generic asset route.");
assert.match(identity, /walletBalanceScenario\?: AccountAcceptanceBalanceScenario/,
  "Loopback balance variants must be explicit typed acceptance scenarios.");
assert.match(walletAssets, /NEXT_PUBLIC_RMT_ACCOUNT_ACCEPTANCE_PROFILE[\s\S]*walletBalanceScenario \?\? "positive"/,
  "Balance variants must remain confined to the account-first compile profile and default to the existing positive fixture.");
assert.match(walletAssets, /accountScenario === "zero-input" \? "0" : "100000000"[\s\S]*accountScenario === "erc20-no-gas" \? 0n/,
  "The fixture must model zero input and missing native gas independently.");
assert.match(walletAssets, /canonicalUsdgBalance\?\.status !== "success"[\s\S]*canonical USDG balance could not be established/,
  "READY wallet evidence must not infer a zero USDG balance when the exact canonical balance call failed.");
assert.doesNotMatch(walletAssets, /useAccount\(/,
  "The balance reader must consume the exact selected wallet address instead of independently trusting Wagmi transport state.");
assert.match(walletAssets, /selectedWalletAddress\?: Address[\s\S]*const address = selectedWalletAddress/,
  "The balance reader is scoped to the exact connector-qualified wallet selected by RMT.");
const spendBalance = readFileSync(new URL("../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
assert.match(spendBalance, /selectedVNextWalletReadAddress\(\{[\s\S]*selectedWalletKey: identity\.activeWalletKey[\s\S]*connectorUid: connector\?\.uid[\s\S]*requiredChainId: ROBINHOOD_MAINNET_CHAIN_ID/,
  "Portfolio, deposit destination, quote taker, and signer must share one exact connector-qualified wallet authority.");
assert.match(tradeComposer, /const canonicalInputs = \[ROBINHOOD_USDG, ROBINHOOD_ETH\][\s\S]*return uniqueAssets\(\[\.\.\.canonicalInputs, \.\.\.eligibleContracts\]\)/,
  "An empty account keeps both canonical funding choices visible instead of losing its Deposit path with the positive-holdings list.");
assert.match(tradeComposer, /walletReadStatus === "ready" && contractAddress === ROBINHOOD_USDG_ADDRESS\.toLowerCase\(\)\) return "0"/,
  "A successful canonical USDG probe may establish authoritative zero even though holdings intentionally omit zero balances.");
assert.match(browserAcceptance, /waitForPersistedTradeDraft[\s\S]*accountReturn=1[\s\S]*"Sign in"/,
  "The real ticket must prove preference-only side, amount, market, and asset recovery across a same-tab remount.");
assert.match(browserAcceptance, /fundingReturn=1[\s\S]*funding return issues a fresh quote request[\s\S]*fundingReturn = "SAME_TAB_REMOUNT_EXACT_DRAFT_FRESH_QUOTE_REQUEST_ZERO_WALLET_ACTION"/,
  "The funding-return label requires a real remount, exact draft recovery, a fresh quote request, and zero wallet action.");
assert.match(browserAcceptance, /balanceScenario: "zero-input"[\s\S]*label: "Deposit USDG"[\s\S]*balanceScenario: "erc20-no-gas"[\s\S]*label: "Deposit ETH for gas"/,
  "The browser harness must cover both independently modeled funding blockers.");
assert.match(browserAcceptance, /walletBalanceScenario: scenario\.balanceScenario[\s\S]*action\.isEnabled\(\)[\s\S]*financialWalletMethods\(methods\)/,
  "Public-component browser coverage must prove both underfunded primary actions without financial RPC.");
assert.match(browserAcceptance, /Selected deposit asset[\s\S]*scenario\.sheetAsset[\s\S]*Show address & QR[\s\S]*scenario\.receiveAsset/,
  "Each underfunded recovery path must carry the exact requested asset into Deposit and Receive.");
assert.match(browserAcceptance, /TRANSPORT_REHYDRATED[\s\S]*!events\.some\(\(event\) => event\.type === "PREFERENCE_HYDRATED"\)[\s\S]*assertPortfolioAuthoritySuppressed[\s\S]*Spendable trade balance/,
  "The pre-hydration render must prove that Portfolio publishes no address, balance, Receive, or Send authority.");
assert.match(fundingButton, /data-rmt-overlay-dialog="funding"/,
  "The portaled Deposit dialog must identify itself as a modal layer above the mobile trade sheet.");
assert.match(terminalPresentations, /event\.key === "Escape"[\s\S]*document\.querySelector\("\[data-rmt-overlay-dialog\]"\)[\s\S]*closeSheet\(\)/,
  "Escape closes a nested Deposit/Receive layer without also discarding the underlying mobile ticket.");
assert.match(walletCss, /\.fundWalletBackdrop\{[^}]*z-index:169[\s\S]*\.fundWalletDialog\{[^}]*z-index:170/,
  "Funding overlays must render above the z-index 100 mobile trade sheet.");
assert.match(interfacePolishCss, /\.fundWalletBackdrop \{[^}]*z-index: 169[\s\S]*\.walletTransferBackdrop \{[^}]*z-index: 179[\s\S]*\.fundWalletDialog,[\s\S]*z-index: 170[\s\S]*\.walletTransferDialog,[\s\S]*z-index: 180/,
  "The final global cascade must preserve wallet overlays above the mobile trade sheet.");
assert.match(walletCss, /\.fundWalletDialog\{top:calc\(env\(safe-area-inset-top\) \+ 12px\);bottom:calc\(env\(safe-area-inset-bottom\) \+ 12px\)/,
  "The mobile Deposit dialog reserves both notch and home-indicator safe areas.");
assert.match(tradeComposer, /receiptReturnFocus[\s\S]*requested\?\.isConnected \? requested : fallback[\s\S]*focus\(\{ preventScroll: true \}\)/,
  "Closing a confirmed-trade receipt restores focus into the surviving ticket instead of leaving focus on body.");
assert.match(terminalCss, /\.vnWalletRecoveryStatus[\s\S]*padding: 10px 24px 0[\s\S]*font-size: 12px/,
  "The blocker beside the mobile action must remain legible and dock-aligned.");
assert.match(terminalCss, /\.rmtMobileHeader \.wallet,[\s\S]*\.rmtMobileHeader \.network \{[\s\S]*min-height: 44px/,
  "The final specific mobile-header rule must preserve a 44px account and network target.");

console.log("Account-first loopback acceptance boundary smoke checks passed.");
