import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { assertFixtureProjectTreasuryProof, resolveFixtureProjectTreasuryCall } from "./curve-fixture-project-treasury-call.js";
import type { FixtureTx } from "./curve-fixture-lifecycle.js";
import type { FixturePostCursor } from "./curve-fixture-post-graduation.js";

const actor = "0x1111111111111111111111111111111111111111", treasury = "0x2222222222222222222222222222222222222222";
const ledger = "0x3333333333333333333333333333333333333333", lpLedger = "0x4444444444444444444444444444444444444444";
const safe = "0x5555555555555555555555555555555555555555", engine = "0x6666666666666666666666666666666666666666";
const token = "0x7777777777777777777777777777777777777777", hash = ("0x" + "aa".repeat(32)) as Hex;
const block = { blockNumber: "10", blockHash: hash, timestamp: "2026-11-18T12:00:00.000Z" };
const cursor = { launch: { token, treasury, revenueLedger: ledger }, graduation: { owner: engine }, lpLedger } as unknown as FixturePostCursor;
const abi = parseAbi(["function claimCurve()", "function claimLp(uint8 asset)", "function collectLpFees(uint256 deadline)"]);
const innerAbi = parseAbi(["function claim()", "function claimAsset(bool native)", "function collectLpFees(address token,uint256 deadline)"]);
const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool)"]);
const tx = (input: Hex, to: Address = treasury): FixtureTx => ({ hash, from: actor, to, input, value: 0n, blockNumber: 10n, blockHash: hash });
// These unit inputs exercise bounded decoding, not Safe authorization. The
// real contract/owner signatures and canonical module admission run in the
// separate same-app synthetic acceptance; a stub is never exposed by HTTP.
const approveDecoderOnly = async () => true;
const wrap = (data: Hex, overrides: { operation?: number; refund?: Address; safeGas?: bigint } = {}) => encodeFunctionData({ abi: safeAbi, functionName: "execTransaction",
  args: [treasury, 0n, data, overrides.operation ?? 0, overrides.safeGas ?? 0n, 0n, 0n, zeroAddress, overrides.refund ?? zeroAddress, ("0x" + "11".repeat(130)) as Hex] });

test("project treasury decoding stays off without the explicit internal admission capability", async () => {
  const input = encodeFunctionData({ abi, functionName: "claimCurve" });
  assert.equal(await resolveFixtureProjectTreasuryCall([cursor], tx(input), block), undefined);
  assert.equal(await resolveFixtureProjectTreasuryCall([cursor], tx(input), block, async () => false), undefined);
  const resolved = await resolveFixtureProjectTreasuryCall([cursor], tx(input), block, approveDecoderOnly);
  assert.equal(resolved?.call.treasury, treasury); assert.equal(resolved?.call.controller, actor);
  assert.equal(resolved?.call.target, ledger); assert.equal(resolved?.call.operation, "curve-claim");
});

test("Safe controller remains distinct from the Treasury beneficiary and exact ledger calldata", async () => {
  for (const [mode, expected] of [[0, encodeFunctionData({ abi: innerAbi, functionName: "claim" })],
    [1, encodeFunctionData({ abi: innerAbi, functionName: "claimAsset", args: [true] })],
    [2, encodeFunctionData({ abi: innerAbi, functionName: "claimAsset", args: [false] })]] as const) {
    const input = encodeFunctionData({ abi, functionName: "claimLp", args: [mode] });
    const resolved = await resolveFixtureProjectTreasuryCall([cursor], tx(wrap(input), safe), block, approveDecoderOnly);
    assert.equal(resolved?.call.controller, safe); assert.equal(resolved?.call.treasury, treasury);
    assert.equal(resolved?.call.target, lpLedger); assert.equal(resolved?.call.calldata, expected);
  }
  const collection = await resolveFixtureProjectTreasuryCall([cursor], tx(encodeFunctionData({ abi, functionName: "collectLpFees", args: [42n] })), block, approveDecoderOnly);
  assert.equal(collection?.call.target, engine);
  assert.equal(collection?.call.calldata, encodeFunctionData({ abi: innerAbi, functionName: "collectLpFees", args: [token, 42n] }));
});

test("wrapper decoder refuses delegatecall, refunds, gas sponsorship, trailing calldata and unsupported assets", async () => {
  const input = encodeFunctionData({ abi, functionName: "claimCurve" }); let admissions = 0;
  const admit = async () => { admissions++; return true; };
  for (const bad of [wrap(input, { operation: 1 }), wrap(input, { refund: actor }), wrap(input, { safeGas: 1n }),
    (input + "00") as Hex, encodeFunctionData({ abi, functionName: "claimLp", args: [3] })]) {
    assert.equal(await resolveFixtureProjectTreasuryCall([cursor], tx(bad, safe), block, admit), undefined);
  }
  assert.equal(admissions, 0);
});

test("nested wrapper proof requires actual Safe-to-Treasury and Treasury-to-ledger successful edges and exact payment", async () => {
  const input = encodeFunctionData({ abi, functionName: "claimCurve" }), outer = tx(wrap(input), safe);
  const resolved = await resolveFixtureProjectTreasuryCall([cursor], outer, block, approveDecoderOnly); assert.ok(resolved);
  const trace = { type: "CALL", from: actor, to: safe, input: outer.input, value: "0x0", calls: [
    { type: "CALL", from: safe, to: treasury, input, value: "0x0", calls: [
      { type: "CALL", from: treasury, to: ledger, input: resolved.call.calldata, value: "0x0", calls: [
        { type: "CALL", from: ledger, to: treasury, input: "0x", value: "0x5" },
      ] },
    ] },
  ] };
  const payments: { from: Address; to: Address; amount: bigint }[] = [{ from: ledger, to: treasury, amount: 5n }];
  assert.doesNotThrow(() => assertFixtureProjectTreasuryProof(trace, outer, resolved.call, payments));
  const changedActor = structuredClone(trace); changedActor.calls[0]!.from = actor;
  assert.throws(() => assertFixtureProjectTreasuryProof(changedActor, outer, resolved.call, payments));
  const changedAmount = structuredClone(trace); changedAmount.calls[0]!.calls[0]!.calls[0]!.value = "0x4";
  assert.throws(() => assertFixtureProjectTreasuryProof(changedAmount, outer, resolved.call, payments));
  const reverted = structuredClone(trace) as typeof trace & { error?: string }; reverted.error = "revert";
  assert.throws(() => assertFixtureProjectTreasuryProof(reverted, outer, resolved.call, payments));
});
