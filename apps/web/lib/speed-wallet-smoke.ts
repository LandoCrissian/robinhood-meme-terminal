import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../app/", import.meta.url));
const providers = readFileSync(`${appRoot}providers.tsx`, "utf8");
const speedProvider = readFileSync(`${appRoot}speed-wallet-provider.tsx`, "utf8");
const speedEntry = readFileSync(`${appRoot}speed-wallet-entry.tsx`, "utf8");
const combined = `${providers}\n${speedProvider}\n${speedEntry}`;

assert.match(providers, /NEXT_PUBLIC_PRIVY_APP_ID/, "Speed Wallet must remain environment-gated.");
assert.match(speedProvider, /@privy-io\/wagmi/, "Embedded wallets must use Privy's official Wagmi adapter.");
assert.match(speedProvider, /createOnLogin:\s*"off"/, "Wallet creation must require an explicit user action.");
assert.match(speedEntry, /useExportWallet/, "The user-owned wallet must expose recovery/export controls.");
assert.match(speedEntry, /Session permissions remain off/, "Signer permissions must be visibly fail-closed.");
assert.doesNotMatch(combined, /policyIds:\s*\[\s*\]/, "RMT must never attach an unrestricted signer.");
assert.doesNotMatch(combined, /privateKey|authorizationPrivateKey|appSecret/, "Client code must not contain signing secrets.");

console.log("Speed Wallet remains optional, user-owned, exportable, and signer-disabled by default.");
