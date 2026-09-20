import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, zeroAddress, type Hex } from "viem";
import { addressRole, inspectActions, focusedBasicAction, CANDIDATE_SEMANTIC_HASH, MAX_ACTIONS } from "./private-zero-x-actions";
import { ProofJsonl, validateProofJsonl, RECORD_LIMIT, OUTPUT_LIMIT, installProofDeadline } from "./private-zero-x-jsonl";
import { ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH } from "../lib/server/vnext-zero-x-execution-decoder";
import { RMT_ZERO_X_FEE_TREASURY, ZERO_X_NATIVE_TOKEN } from "../lib/vnext/zero-x-settlement";
const user = "0x1234567890123456789012345678901234567890";
const sell = "0x0000000000000000000000000000000000020000";
const buy = "0x0000000000000000000000000000000000030000";
const settler = "0x0000000000000000000000000000000000040000";
const other = "0x0000000000000000000000000000000000050000";
const roles = { user, sell, buy, settler };
const abi = parseAbi([
  "function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 tag)",
  "function BASIC(address sellToken,uint256 numerator,address pool,uint256 offset,bytes data)",
  "function transfer(address recipient,uint256 amount)",
  "function TRANSFER_FROM(address recipient,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes sig)",
  "function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expectedAmount,uint256 maxNumerator)",
  "function CHECK_SLIPPAGE(bool exact)", "function NATIVE_CHECK(uint256 deadline,uint256 value)"
  ,"function UNISWAPV2(address recipient,address sellToken,uint256 numerator,address pool,uint24 swapInfo,uint256 minimum)"
  ,"function UNISWAPV3(address recipient,uint256 numerator,bytes path,uint256 minimum)"
  ,"function PANCAKE_INFINITY(address recipient,address sellToken,uint256 numerator,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 minimum)"
]);
const transfer = (to: Hex, amount = 0n) => encodeFunctionData({ abi, functionName: "transfer", args: [to, amount] });
const basic = (token: Hex, n: bigint, target: Hex, offset: bigint, data: Hex) => encodeFunctionData({ abi, functionName: "BASIC", args: [token, n, target, offset, data] });
function decode(actions: Hex[], runtime: string | null = ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH, currentRoles = roles) {
  return inspectActions({ target: settler, value: "0", allowanceTarget: null, data: encodeFunctionData({ abi, functionName: "execute", args: [
    { recipient: currentRoles.user as Hex, buyToken: buy, minAmountOut: 999n }, actions, `0x${"00".repeat(32)}`] }) }, currentRoles, runtime);
}
async function run() {
  assert.equal(addressRole(user, roles), "USER_RECIPIENT");
  assert.equal(addressRole(RMT_ZERO_X_FEE_TREASURY, { ...roles, user: RMT_ZERO_X_FEE_TREASURY }), "USER_RECIPIENT_AND_RMT_TREASURY");
  assert.equal(addressRole(sell, roles), "SELL_TOKEN");
  assert.equal(addressRole(other, roles), addressRole(other.toUpperCase(), roles));
  assert.match(addressRole(other, roles), /^ROLE_HASH_[a-f0-9]{64}$/);
  const native = basic(ZERO_X_NATIVE_TOKEN, 25n, RMT_ZERO_X_FEE_TREASURY, 0n, "0x");
  const proportional = basic(sell, 25n, sell, 36n, transfer(RMT_ZERO_X_FEE_TREASURY, 123n));
  const absolute = basic(zeroAddress, 0n, sell, 0n, transfer(RMT_ZERO_X_FEE_TREASURY, 2500n));
  const focus = (value: Hex) => decode([native, proportional, absolute, value], CANDIDATE_SEMANTIC_HASH).records.map(focusedBasicAction);
  const unknownBasic = focus(basic(sell, 999999n, other, 36n, `0xdeadbeef${"00".repeat(64)}`));
  assert.deepEqual(unknownBasic.map(r => r.index), [0, 1, 2, 3]);
  assert.deepEqual(Object.keys(unknownBasic[0]).sort(), ["index", "actionKind", "selector", "semanticsComplete"].sort());
  assert.equal(unknownBasic[3].callSelector, "0xdeadbeef");
  assert.equal(unknownBasic[3].targetRole, addressRole(other, roles));
  assert.equal(unknownBasic[3].patchOffset, "36");
  assert.equal(unknownBasic[3].patchInBounds, true);
  assert.equal(unknownBasic[3].numerator, "999999");
  assert.equal(unknownBasic[3].denominator, "1000000");
  assert.equal(unknownBasic[3].valueBehavior, "ZERO_CALL_VALUE");
  assert.equal(unknownBasic[3].approvalBehavior, "SETTLER_TOKEN_APPROVAL_TO_TARGET");
  assert.equal(unknownBasic[3].targetRuntimeFixed, false);
  assert.equal(unknownBasic[3].semanticsComplete, false);
  assert.equal(unknownBasic[3].outputTokenRole, "UNKNOWN_TARGET_SEMANTICS");
  assert.equal(focus(basic(sell, 1n, other, 0n, "0xdeadbeef"))[3].selectorPreservedByPatch, false);
  assert.equal(focus(basic(sell, 1n, other, 36n, "0xdeadbeef"))[3].patchInBounds, false);
  const nativeFocus = focus(native)[3];
  assert.equal(nativeFocus.valueBehavior, "PROPORTIONAL_NATIVE_VALUE");
  assert.equal(nativeFocus.approvalBehavior, "NO_BASIC_APPROVAL");
  assert.equal(nativeFocus.patchInBounds, true);
  const transferFocus = focus(basic(sell, 1000000n, sell, 36n, transfer(user)))[3];
  assert.equal(transferFocus.outputDestination, "USER_RECIPIENT");
  assert.equal(transferFocus.callSelector, "0xa9059cbb");
  assert.equal(JSON.stringify(transferFocus).includes(user), false);
  assert.equal(JSON.stringify(unknownBasic).includes(other), false);
  assert.equal(JSON.stringify(unknownBasic).includes("00".repeat(64)), false);
  assert.equal(focusedBasicAction({ ...unknownBasic[3], rawCalldata: "SECRET", providerBody: "SECRET" }).rawCalldata, undefined);
  const moved = focusedBasicAction({ ...unknownBasic[3], index: 4 });
  assert.equal(moved.callSelector, undefined, "a changed route is not silently retargeted");
  const rows = decode([native, proportional, absolute]).records;
  assert.deepEqual(rows.map(r => r.index), [0, 1, 2]);
  assert.equal(rows[0].amountMode, "PROPORTIONAL_TO_CURRENT_BALANCE");
  assert.equal(rows[0].denominator, "10000"); assert.equal(rows[0].rounding, "FLOOR");
  assert.equal(rows[0].amountLiteral, null, "do not fabricate an atomic proportional fee");
  assert.equal(rows[1].amountLiteral, "123"); assert.equal(rows[1].literalOverwritten, true);
  assert.equal(rows[2].amountMode, "ABSOLUTE"); assert.equal(rows[2].amountLiteral, "2500");
  assert.equal(rows[2].literalOverwritten, false);
  assert.equal(rows[2].feeAttribution, "RMT_FEE_CANDIDATE_NOT_PROVEN");
  assert.equal(decode([basic(zeroAddress, 0n, other, 0n, transfer(RMT_ZERO_X_FEE_TREASURY, 2500n))]).records[0].semanticsComplete, false,
    "an arbitrary target with a transfer-shaped selector does not establish token semantics");
  assert.equal(decode([native], CANDIDATE_SEMANTIC_HASH).records[0].denominator, "1000000");
  assert.equal(decode([native], null).records[0].denominator, null);
  assert.equal(decode([native], null).records[0].semanticsComplete, false);
  const v2 = decode([encodeFunctionData({ abi, functionName: "UNISWAPV2", args: [settler, sell, 1000000n, other, (30 << 8) | 3, 1n] })]).records[0];
  assert.equal(v2.actionKind, "UNISWAPV2"); assert.equal(v2.poolFeeBps, 30);
  assert.equal(v2.feeOnTransfer, true); assert.equal(v2.hookPresent, false);
  assert.match(String(v2.targetRole), /^ROLE_HASH_/);
  const v3 = decode([encodeFunctionData({ abi, functionName: "UNISWAPV3", args: [settler, 1000000n,
    `${sell}00${"00".repeat(3 + 20)}${buy.slice(2)}`, 1n] })]).records[0];
  assert.equal(v3.tokenRole, "SELL_TOKEN"); assert.equal(v3.outputTokenRole, "BUY_TOKEN");
  assert.equal(v3.hopCount, 1);
  const fill = (hook: string) => `${"00".repeat(3 + 20)}01${buy.slice(2)}${hook.slice(2)}00${"00".repeat(3 + 32 + 3)}`;
  const infinity = (fills: Hex) => decode([encodeFunctionData({ abi, functionName: "PANCAKE_INFINITY", args: [settler, sell, 1000000n, false, 0n, 0n, fills, 1n] })]).records[0];
  assert.equal(infinity(`0x${fill(zeroAddress)}`).hookPresent, false);
  const hooked = infinity(`0x${fill(other)}${fill(zeroAddress)}`);
  assert.equal(hooked.hookPresent, true); assert.equal(hooked.fillCount, 2);
  assert.equal(hooked.poolManagerRole, "PANCAKE_CL");
  assert.equal(infinity("0x00").packedInspection, "INCOMPLETE");
  assert.equal(infinity("0x00").hookPresent, "UNKNOWN");
  const unknownTransfer = decode([basic(zeroAddress, 0n, sell, 0n, transfer(other, 1500n))]).records[0];
  assert.equal(unknownTransfer.feeAttribution, "UNATTRIBUTED_TRANSFER_NOT_PROVIDER_PROVEN");
  assert.equal(decode([basic(sell, 25n, sell, 4n, transfer(user))]).records[0].recipientRole, "UNKNOWN_PATCH_OR_TARGET_SEMANTICS");
  const sensitive = "DO_NOT_OUTPUT_COOKIE_SESSION_API_KEY_https://secret.invalid";
  const unknown = (`0xdeadbeef${Buffer.from(sensitive).toString("hex")}${user.slice(2)}`) as Hex;
  const malformed = "0x1234";
  const opaque = decode([unknown, malformed]).records;
  assert.ok(opaque.every(r => r.semanticsComplete === false));
  const collision = decode([absolute], ZERO_X_SLIPPAGE_SETTLER_RUNTIME_HASH, { ...roles, user: RMT_ZERO_X_FEE_TREASURY });
  assert.equal(JSON.stringify(collision).toLowerCase().includes(RMT_ZERO_X_FEE_TREASURY.toLowerCase()), false);
  const numericWallet = decode([basic(zeroAddress, 0n, sell, 0n, transfer(user, BigInt(user)))]);
  const serialized = JSON.stringify([opaque, numericWallet]);
  for (const secret of [sensitive, Buffer.from(sensitive).toString("hex"), user.toLowerCase(), BigInt(user).toString(), unknown]) assert.equal(serialized.toLowerCase().includes(secret.toLowerCase()), false);
  const acquisition = encodeFunctionData({ abi, functionName: "TRANSFER_FROM", args: [settler,
    { permitted: { token: sell, amount: 2n ** 256n - 1n }, nonce: 0n, deadline: 2n ** 64n - 1n }, "0x"] });
  assert.equal(decode([acquisition]).records[0].balanceBasis, "USER_CURRENT_NOT_INDEPENDENTLY_KNOWN");
  assert.equal(decode([native, acquisition]).records[1].validDispatchPosition, false);
  const cap = encodeFunctionData({ abi, functionName: "POSITIVE_SLIPPAGE", args: [other, sell, 100n, 25n] });
  assert.equal(decode([cap]).records[0].formula, "IF_BALANCE_GT_EXPECTED_MIN_EXCESS_AND_PROPORTIONAL_CAP");
  assert.equal(decode([encodeFunctionData({ abi, functionName: "CHECK_SLIPPAGE", args: [true] })]).records[0].semanticFamily, "EARLY_MINIMUM_TRANSFER_CLEARS_FINAL_CHECK");
  const tooMany = decode(Array(MAX_ACTIONS + 1).fill(native));
  assert.equal(tooMany.omitted, 1);

  function output() { const lines: string[] = []; return { lines, writer: new ProofJsonl(line => lines.push(line)) }; }
  const { lines, writer } = output();
  writer.emit("PROOF_START"); writer.emit("SOURCE_FINGERPRINT", { path: "fixture", sha256: "a".repeat(64) });
  writer.beginCase("USDG_TO_CANNACAT"); writer.emit("QUOTE"); rows.forEach(r => writer.emit("ACTION", r));
  writer.emit("FINAL_MINIMUM"); writer.endCase("RUNTIME_REJECTED", 3, true); writer.finish("COMPLETE");
  assert.ok(validateProofJsonl(lines.join("")));
  assert.equal(validateProofJsonl(lines.slice(0, -1).join("")), false, "missing proof end");
  assert.equal(validateProofJsonl(lines.filter(l => !l.includes('"type":"CASE_END"')).join("")), false, "missing case end");
  assert.equal(validateProofJsonl(lines.filter((_, i) => i !== 4).join("")), false, "missing middle record");
  assert.equal(validateProofJsonl(lines.join("").replace("RMT_FEE_CANDIDATE_NOT_PROVEN", "[REDACTED]")), false, "platform redaction invalidates hash");
  assert.equal(validateProofJsonl(lines.join("").slice(0, -80)), false, "partial final record");
  const bounded = output(); bounded.writer.emit("PROOF_START"); bounded.writer.emit("SOURCE_FINGERPRINT", { path: "fixture", sha256: "a".repeat(64) });
  bounded.writer.beginCase("USDG_TO_CANNACAT");
  bounded.writer.emit("QUOTE");
  assert.equal(bounded.writer.emit("ACTION", { index: 0, diagnostic: "é".repeat(RECORD_LIMIT) }), false);
  for (let i = 0; i < 1000; i++) bounded.writer.emit("ACTION", { ...rows[0], index: i });
  bounded.writer.endCase("OUTPUT_LIMIT", 1000); bounded.writer.finish("COMPLETE");
  assert.ok(Buffer.byteLength(bounded.lines.join("")) <= OUTPUT_LIMIT);
  assert.ok(bounded.lines.every(line => Buffer.byteLength(line) <= RECORD_LIMIT));
  assert.ok(validateProofJsonl(bounded.lines.join("")));
  assert.equal(JSON.parse(bounded.lines.at(-1)!).truncated, true);
  assert.throws(() => output().writer.emit("ACTION", { sequence: 900 }), /RESERVED_PROOF_FIELD/);
  const timeout = output(); timeout.writer.emit("PROOF_START"); timeout.writer.emit("SOURCE_FINGERPRINT", { path: "fixture", sha256: "a".repeat(64) });
  timeout.writer.beginCase("USDG_TO_CANNACAT");
  await new Promise<void>(resolve => installProofDeadline(timeout.writer, resolve, 5));
  assert.ok(validateProofJsonl(timeout.lines.join("")));
  assert.equal(JSON.parse(timeout.lines.at(-1)!).status, "TIMEOUT");
  console.log("Private fee action evidence: synthetic semantics, privacy, JSONL loss/bounds and timeout tests passed; no live proof.");
}
void run();
