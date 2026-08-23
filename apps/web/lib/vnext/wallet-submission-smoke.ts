import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEE_V2_SMOKE_APPROVAL_DATA,
  FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  FEE_V2_SMOKE_APPROVAL_PLAN,
  FEE_V2_SMOKE_NOW_MS,
  FEE_V2_SMOKE_RECIPIENT
} from "./fee-v2-smoke-fixture";
import { assessVNextWalletGasReadiness, prepareVNextWalletTransaction } from "./wallet-submission";

const transaction = prepareVNextWalletTransaction({
  plan: FEE_V2_SMOKE_APPROVAL_PLAN,
  evidence: FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  connectedAddress: FEE_V2_SMOKE_RECIPIENT,
  connectedChainId: 4_663,
  nowMs: FEE_V2_SMOKE_NOW_MS + 1
});
assert.equal(transaction.account, FEE_V2_SMOKE_RECIPIENT);
assert.equal(transaction.chainId, 4_663);
assert.equal(transaction.to, FEE_V2_SMOKE_APPROVAL_EVIDENCE.inputAsset);
assert.equal(transaction.data, FEE_V2_SMOKE_APPROVAL_DATA);
assert.equal(transaction.value, 0n);
assert.equal(transaction.gas, 60_000n);
assert.throws(() => prepareVNextWalletTransaction({
  plan: FEE_V2_SMOKE_APPROVAL_PLAN, evidence: FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  connectedAddress: FEE_V2_SMOKE_RECIPIENT, connectedChainId: 1, nowMs: FEE_V2_SMOKE_NOW_MS + 1
}), /wrong chain/);
assert.throws(() => prepareVNextWalletTransaction({
  plan: FEE_V2_SMOKE_APPROVAL_PLAN, evidence: FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  connectedAddress: FEE_V2_SMOKE_APPROVAL_EVIDENCE.outputAsset, connectedChainId: 4_663, nowMs: FEE_V2_SMOKE_NOW_MS + 1
}), /verified recipient/);
assert.throws(() => prepareVNextWalletTransaction({
  plan: { ...FEE_V2_SMOKE_APPROVAL_PLAN, feeV2Authorization: undefined }, evidence: FEE_V2_SMOKE_APPROVAL_EVIDENCE,
  connectedAddress: FEE_V2_SMOKE_RECIPIENT, connectedChainId: 4_663, nowMs: FEE_V2_SMOKE_NOW_MS + 1
}), /without complete V2 fee authority/);

const readyGas = assessVNextWalletGasReadiness({ nativeBalanceWei: 1_000_000n, currentGasPriceWei: 2n, evidenceFeeCeilingWei: "5", gasLimitUnits: "100000" });
assert.equal(readyGas.ready, true);
assert.equal(readyGas.requiredWei, 600_000n);
const missingGas = assessVNextWalletGasReadiness({ nativeBalanceWei: 500_000n, currentGasPriceWei: 1n, evidenceFeeCeilingWei: "6", gasLimitUnits: "100000" });
assert.equal(missingGas.ready, false);
assert.equal(missingGas.shortfallWei, 100_000n);

const component = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("./wallet-submission.ts", import.meta.url), "utf8");
assert.match(component, /useSendTransaction/);
assert.match(component, /prepareVNextWalletTransaction/);
assert.match(helper, /parseVNextAuthorizationPlan/);
assert.match(helper, /connectedChainId !== ROBINHOOD_MAINNET_CHAIN_ID/);
assert.doesNotMatch(helper, /fetch\s*\(|sendTransaction|writeContract|signTypedData/);

console.log("RMT VNext V2-bound wallet-submission boundary smoke checks passed.");
