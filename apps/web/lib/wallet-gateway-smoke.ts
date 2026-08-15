import assert from "node:assert/strict";
import {
  RMT_EXTERNAL_WALLET_LIST,
  RMT_INJECTED_WALLET_LIST,
  externalEthereumWallets,
  isEmbeddedWalletClientType,
  isConnectorSelectionConfirmed,
  requiresExplicitWalletSelection,
  resolveActiveExternalWallet,
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

const metamask = wallet();
const rabby = wallet({ id: "io.rabby", name: "Rabby Wallet", walletClientType: "rabby" });
const embeddedV1 = wallet({ id: "privy", name: "RMT Wallet", walletClientType: "privy" });
const embeddedV2 = wallet({ id: "privy-v2", name: "RMT Wallet", walletClientType: "privy-v2" });
const solana = wallet({ id: "solana", name: "Solana Wallet", type: "solana", walletClientType: "phantom" });
const unknownChainType = { ...wallet(), type: undefined };

const exactWallets = externalEthereumWallets([metamask, rabby, embeddedV1, embeddedV2, solana, unknownChainType]);
assert.equal(exactWallets.length, 2, "Embedded and non-Ethereum wallets must not enter the trading gateway.");
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

console.log("Unified wallet gateway preserves exact external connector identity and fails closed on ambiguity.");
