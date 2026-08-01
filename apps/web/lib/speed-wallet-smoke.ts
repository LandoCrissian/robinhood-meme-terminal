import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../app/", import.meta.url));
const providers = readFileSync(`${appRoot}providers.tsx`, "utf8");
const speedProvider = readFileSync(`${appRoot}speed-wallet-provider.tsx`, "utf8");
const speedEntry = readFileSync(`${appRoot}speed-wallet-entry.tsx`, "utf8");
const walletButton = readFileSync(`${appRoot}wallet-button.tsx`, "utf8");
const privyWalletButton = readFileSync(`${appRoot}privy-wallet-button.tsx`, "utf8");
const walletTransferDialog = readFileSync(`${appRoot}wallet-transfer-dialog.tsx`, "utf8");
const walletReceiveDialog = readFileSync(`${appRoot}wallet-receive-dialog.tsx`, "utf8");
const combined = `${providers}\n${speedProvider}\n${speedEntry}\n${walletButton}\n${privyWalletButton}\n${walletTransferDialog}\n${walletReceiveDialog}`;

assert.match(providers, /NEXT_PUBLIC_PRIVY_APP_ID/, "Speed Wallet must remain environment-gated.");
assert.match(speedProvider, /@privy-io\/wagmi/, "Embedded wallets must use Privy's official Wagmi adapter.");
assert.match(speedProvider, /createOnLogin:\s*"all-users"/, "A user who chooses Privy sign-in must receive an RMT wallet.");
assert.match(speedEntry, /useExportWallet/, "The user-owned wallet must expose recovery/export controls.");
assert.match(speedEntry, /useSetWalletRecovery/, "The user-owned wallet must expose cross-device recovery controls.");
assert.match(speedEntry, /useMfaEnrollment/, "The user-owned wallet must expose MFA enrollment controls.");
assert.match(speedEntry, /Session permissions remain off/, "Signer permissions must be visibly fail-closed.");
assert.match(walletButton, /if \(privyAppId\) return <PrivyWalletButton/, "Privy must own the wallet entry point whenever configured.");
assert.match(privyWalletButton, /useConnectOrCreateWallet/, "Privy must provide a connect-or-create path for first-time traders.");
assert.match(privyWalletButton, /useSetActiveWallet/, "Traders must be able to choose the exact wallet RMT uses.");
assert.match(privyWalletButton, /requestedWalletAddress/, "A newly connected external wallet must remain the requested active wallet after Privy finishes linking it.");
assert.match(privyWalletButton, /changing between MetaMask and an RMT Wallet cannot overwrite it/, "Wallet selection must explain the separate Firebase profile boundary.");
assert.match(privyWalletButton, />Deposit</, "The exact active wallet must expose Privy funding.");
assert.match(privyWalletButton, />Receive</, "The exact active wallet must expose its receive address.");
assert.match(privyWalletButton, /privyActiveWalletSummary/, "The wallet control center must identify its exact active wallet and network.");
assert.match(privyWalletButton, />Send</, "The exact active wallet must expose a user-reviewed transfer flow.");
assert.match(privyWalletButton, />Trade</, "Wallet management must return users to RMT's independently verified trade routes.");
assert.doesNotMatch(combined, /policyIds:\s*\[\s*\]/, "RMT must never attach an unrestricted signer.");
assert.doesNotMatch(combined, /privateKey|authorizationPrivateKey|appSecret/, "Client code must not contain signing secrets.");
assert.match(walletReceiveDialog, /Chain ID \{targetChain\.id\}/, "Receive must identify the exact destination network.");
assert.match(walletReceiveDialog, /Copy full address/, "Receive must show and copy the full active-wallet address.");

console.log("Speed Wallet remains optional, user-owned, exportable, and signer-disabled by default.");
