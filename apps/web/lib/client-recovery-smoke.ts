import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const providers = readFileSync(new URL("../app/providers.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalError = readFileSync(new URL("../app/global-error.tsx", import.meta.url), "utf8");
const boundary = readFileSync(new URL("../app/recovery-boundary.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("./profile.ts", import.meta.url), "utf8");
const referrals = readFileSync(new URL("./referrals.ts", import.meta.url), "utf8");

assert.match(providers, /RecoveryBoundary name="wallet-provider" fallback=\{legacyApplication\}/);
assert.match(providers, /SpeedWalletProvider queryClient=\{queryClient\}/);
assert.match(home, /RecoveryBoundary name="market-feed" fallback=\{<MarketFeedRecovery \/>\}/);
assert.match(globalError, /Your funds and wallet remain untouched\./);
assert.match(globalError, /Never send a recovery phrase or private key\./);
assert.match(boundary, /getDerivedStateFromError/);
assert.doesNotMatch(boundary, /error\.message|error\.stack/);
assert.match(profile, /restricted or full browser store/i);
assert.match(referrals, /function removePendingReferral\(\)/);

console.log("client recovery smoke passed");
