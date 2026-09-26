import assert from "node:assert/strict";
import {
  RMT_EXTERNAL_WALLET_LIST,
  RMT_INJECTED_WALLET_LIST,
  embeddedWalletWagmiIdentity,
  externalEthereumWallets,
  isEmbeddedWalletClientType,
  linkedExternalEthereumWallets,
  preferredWalletRemainsLinked,
  isConnectorSelectionConfirmed,
  privyWagmiConnectorId,
  privyWalletSignerAuthority,
  rmtActiveWalletPreferenceKey,
  requiresExplicitWalletSelection,
  resolveActiveExternalWallet,
  selectedRmtWalletReadAddress,
  shouldAutomaticallyProvisionEmbeddedWallet,
  tradingEthereumWallets,
  walletGatewayKey
} from "./wallet-gateway";

const address = "0x1111111111111111111111111111111111111111";
const otherAddress = "0x2222222222222222222222222222222222222222";

function wallet(overrides: Partial<{
  address: string;
  connectorType: string;
  id: string;
  name: string;
  type: "ethereum" | "solana";
  linked: boolean;
  walletClientType: string;
}> = {}) {
  return {
    address: overrides.address ?? address,
    connectedAt: 1,
    connectorType: overrides.connectorType ?? "injected",
    linked: overrides.linked ?? true,
    meta: {
      id: overrides.id ?? "io.metamask",
      name: overrides.name ?? "MetaMask"
    },
    type: overrides.type ?? "ethereum",
    walletClientType: overrides.walletClientType ?? "metamask"
  };
}

assert.deepEqual(
  RMT_EXTERNAL_WALLET_LIST,
  ["metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"],
  "RMT must use Privy's named wallets, EIP-6963 detection, then WalletConnect."
);
assert.ok(RMT_EXTERNAL_WALLET_LIST.includes("detected_ethereum_wallets"));
assert.ok(!RMT_EXTERNAL_WALLET_LIST.includes("rabby_wallet" as never), "The deprecated Rabby identifier must not be admitted.");
assert.deepEqual(
  RMT_INJECTED_WALLET_LIST,
  ["detected_ethereum_wallets"],
  "A wallet in-app browser must offer only its injected EIP-6963 wallet."
);
assert.equal(isEmbeddedWalletClientType("privy"), true);
assert.equal(isEmbeddedWalletClientType("privy-v2"), true);
assert.equal(isEmbeddedWalletClientType("metamask"), false);
assert.notEqual(rmtActiveWalletPreferenceKey("privy-user-a"), rmtActiveWalletPreferenceKey("privy-user-b"),
  "A durable signer preference is scoped to the authenticated Privy user.");
assert.throws(() => rmtActiveWalletPreferenceKey("  "), /authenticated user/);

const linkedMetaMask = {
  address,
  chainType: "ethereum",
  connectorType: "wallet_connect",
  type: "wallet",
  walletClientType: "metamask"
};
assert.equal(linkedExternalEthereumWallets([linkedMetaMask]).length, 1,
  "Privy's durable linked-account record identifies a disconnected external EVM wallet.");
assert.equal(preferredWalletRemainsLinked([linkedMetaMask], JSON.stringify([
  "wallet_connect", "metamask", "io.metamask", address
])), true, "A disconnected linked external wallet retains its exact remembered preference without becoming signer authority.");
assert.equal(preferredWalletRemainsLinked([linkedMetaMask], JSON.stringify([
  "wallet_connect", "rabby", "io.rabby", address
])), false, "A same-address wallet from another client cannot inherit the preference.");
assert.equal(shouldAutomaticallyProvisionEmbeddedWallet({
  authenticated: true,
  connectedEthereumWalletCount: 0,
  linkedEthereumWalletCount: 1,
  walletsReady: true
}), false, "Cold return with a linked but disconnected external wallet must not create an embedded wallet.");
assert.equal(shouldAutomaticallyProvisionEmbeddedWallet({
  authenticated: true,
  connectedEthereumWalletCount: 0,
  linkedEthereumWalletCount: 0,
  walletsReady: true
}), true, "An email/social user without any linked EVM wallet receives the embedded default exactly once.");

const metamask = wallet();
const rabby = wallet({ id: "io.rabby", name: "Rabby Wallet", walletClientType: "rabby" });
const embeddedV1 = wallet({ id: "privy", name: "RMT Wallet", walletClientType: "privy" });
const embeddedV2 = wallet({ id: "privy-v2", name: "RMT Wallet", walletClientType: "privy-v2" });
const solana = wallet({ id: "solana", name: "Solana Wallet", type: "solana", walletClientType: "phantom" });
const unknownChainType = { ...wallet(), type: undefined };

assert.equal(
  privyWagmiConnectorId(embeddedV1),
  `privy.${address}`,
  "The embedded signer must use the exact connector ID emitted by the installed Privy Wagmi adapter."
);
const walletConnect = wallet({ connectorType: "wallet_connect", id: "io.metamask", walletClientType: "metamask" });
const walletConnectAuthority = privyWalletSignerAuthority(walletConnect, {
  id: "io.metamask", type: "injected", uid: "privy-wagmi-walletconnect"
});
assert.deepEqual(walletConnectAuthority, {
  adapter: "privy-wagmi-4",
  connectorId: "io.metamask",
  connectorType: "injected",
  connectorUid: "privy-wagmi-walletconnect",
  originConnectorType: "wallet_connect",
  walletClientType: "metamask",
  walletKey: walletGatewayKey(walletConnect),
  walletKind: "external"
}, "Installed Privy WalletConnect authority preserves its source transport and exact injected Wagmi signer separately.");
const walletConnectSigner = embeddedWalletWagmiIdentity(walletConnect, {
  id: "io.metamask", type: "injected"
});
assert.ok(walletConnectSigner);
assert.equal(isConnectorSelectionConfirmed({
  appliedWalletKey: walletGatewayKey(walletConnect),
  authenticated: true,
  matchingWalletCount: 2,
  wallet: walletConnect
}), true, "An explicit same-address WalletConnect choice confirms against its raw Privy key.");
assert.equal(isConnectorSelectionConfirmed({
  appliedWalletKey: walletGatewayKey(walletConnect),
  authenticated: true,
  matchingWalletCount: 2,
  wallet: walletConnectSigner
}), false, "A transport-rewritten signer key cannot replace the raw Privy selection key.");
assert.equal(
  privyWagmiConnectorId(embeddedV2),
  "privy-v2",
  "Non-v1 Privy wallet clients must preserve their reported connector identity."
);
const embeddedSigner = embeddedWalletWagmiIdentity(embeddedV1, {
  id: `privy.${embeddedV1.address}`,
  type: "injected"
});
assert.ok(embeddedSigner, "An exact installed Privy/Wagmi connector maps to one embedded signer identity.");
assert.equal(
  walletGatewayKey(embeddedSigner!),
  JSON.stringify(["injected", "privy", `privy.${embeddedV1.address}`.toLowerCase(), embeddedV1.address.toLowerCase()]),
  "Account display, Deposit, quote taker, and signer authority share the Wagmi connector-qualified key."
);
assert.equal(
  embeddedWalletWagmiIdentity(embeddedV1, { id: "wrong", type: "injected" }),
  undefined,
  "A different connector cannot claim the embedded wallet address."
);

const exactWallets = externalEthereumWallets([metamask, rabby, embeddedV1, embeddedV2, solana, unknownChainType]);
assert.equal(exactWallets.length, 2, "Embedded and non-Ethereum wallets must not enter the trading gateway.");
assert.equal(tradingEthereumWallets([metamask, rabby, embeddedV1, embeddedV2, solana, unknownChainType]).length, 4,
  "Embedded and external EVM wallets must both be eligible for exact signer selection.");
assert.notEqual(
  walletGatewayKey(metamask),
  walletGatewayKey(rabby),
  "MetaMask and Rabby must remain distinct even when they expose the same imported address."
);
assert.equal(resolveActiveExternalWallet([metamask], address), metamask, "A unique exact-address connector may be restored.");
assert.equal(
  resolveActiveExternalWallet([metamask, rabby], address),
  undefined,
  "RMT must fail closed instead of guessing between same-address connectors."
);
assert.equal(
  resolveActiveExternalWallet([metamask, rabby], address, walletGatewayKey(rabby)),
  rabby,
  "An exact remembered connector identity must select Rabby without selecting MetaMask."
);
assert.equal(isConnectorSelectionConfirmed({
  authenticated: true,
  matchingWalletCount: 2,
  wallet: rabby
}), false, "A remembered ambiguous connector must not be trusted before Wagmi applies it.");
assert.equal(isConnectorSelectionConfirmed({
  appliedWalletKey: walletGatewayKey(rabby),
  authenticated: true,
  matchingWalletCount: 2,
  wallet: rabby
}), true, "The exact connector becomes active only after the Wagmi binding completes.");
assert.equal(isConnectorSelectionConfirmed({
  appliedWalletKey: walletGatewayKey(metamask),
  authenticated: true,
  matchingWalletCount: 2,
  wallet: rabby
}), false, "Applying MetaMask must never confirm the same-address Rabby connector.");
assert.equal(isConnectorSelectionConfirmed({
  authenticated: true,
  matchingWalletCount: 1,
  wallet: wallet({ linked: false })
}), false, "An unlinked connector cannot satisfy RMT's authenticated trading boundary.");
assert.equal(requiresExplicitWalletSelection({
  activeEmbeddedWallet: false,
  activeExternalWalletConfirmed: false,
  externalWalletCount: 2,
  hasActiveAddress: true,
  matchingExternalWalletCount: 2
}), true, "Same-address ambiguity must require an explicit owner choice.");
assert.equal(requiresExplicitWalletSelection({
  activeEmbeddedWallet: true,
  activeExternalWalletConfirmed: false,
  externalWalletCount: 2,
  hasActiveAddress: true,
  matchingExternalWalletCount: 2
}), false, "Linked external wallets must not displace the active embedded consumer wallet.");
assert.equal(
  resolveActiveExternalWallet([metamask, rabby], address, walletGatewayKey(wallet({ address: otherAddress }))),
  undefined,
  "A preference for another address must not break the same-address ambiguity boundary."
);
assert.equal(
  externalEthereumWallets([metamask, { ...metamask }]).length,
  1,
  "Duplicate SDK records for the same exact connector must be collapsed."
);
assert.notEqual(
  walletGatewayKey(metamask),
  walletGatewayKey(wallet({ id: "io.metamask.flask" })),
  "EIP-6963 identity mutation must change the exact wallet key."
);

const exactMetaMaskAuthority = {
  adapter: "direct" as const,
  connectorId: "io.metamask",
  connectorType: "injected",
  connectorUid: "metamask-connector",
  originConnectorType: "injected",
  walletClientType: "metamask",
  walletKey: walletGatewayKey(metamask),
  walletKind: "external" as const
};
const balanceReadInput = {
  selectedWalletKey: walletGatewayKey(metamask),
  selectedWalletKind: "external" as const,
  selectedSignerAuthority: exactMetaMaskAuthority,
  connectedAddress: address,
  connectedChainId: 4_663,
  connectorId: "io.metamask",
  connectorType: "injected",
  connectorUid: "metamask-connector",
  requiredChainId: 4_663
};
assert.equal(selectedRmtWalletReadAddress(balanceReadInput), address,
  "Visible balances use the same exact connector-qualified wallet authority as quote and submission.");
assert.equal(selectedRmtWalletReadAddress({ ...balanceReadInput, selectedWalletKey: null }), undefined,
  "Preference hydration cannot expose a connected transport account as the selected portfolio.");
assert.equal(selectedRmtWalletReadAddress({ ...balanceReadInput, connectorUid: "same-address-rabby" }), undefined,
  "A same-address connector replacement cannot inherit balance-display authority.");
assert.equal(selectedRmtWalletReadAddress({ ...balanceReadInput, connectedChainId: 1 }), undefined,
  "Balances from another chain cannot be presented as the active Robinhood account.");

console.log("Unified wallet gateway defaults to embedded signing, preserves exact external connector identity, and fails closed on ambiguity.");
