import { decodeFunctionData, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import type { FixtureTx } from "./curve-fixture-lifecycle.js";
import type { FixturePostCursor } from "./curve-fixture-post-graduation.js";
import { assertFixtureInnerCallProof, assertFixtureNativeProof } from "./curve-fixture-native-proof.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const abi = parseAbi(["function claimCurve()", "function claimLp(uint8 asset)", "function collectLpFees(uint256 deadline)"]);
const innerAbi = parseAbi(["function claim()", "function claimAsset(bool native)", "function collectLpFees(address token,uint256 deadline)"]);
const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool)"]);
export type FixtureProjectTreasuryCall = {
  treasury: Address; controller: Address; operation: "curve-claim" | "lp-claim" | "lp-collect";
  target: Address; calldata: Hex; wrapperInput: Hex;
};
/** Internal callback from the explicit fixture module binding. It must verify
 * canonical birth, exact materialized runtime/immutable pins and controller at
 * this receipt block. No public request can supply it or an admission boolean. */
export type FixtureProjectTreasuryAdmission = (call: FixtureProjectTreasuryCall, tx: FixtureTx,
  block: BlockEvidence, cursor: FixturePostCursor) => Promise<boolean>;

export async function resolveFixtureProjectTreasuryCall(cursors: FixturePostCursor[], tx: FixtureTx, block: BlockEvidence,
  admit?: FixtureProjectTreasuryAdmission): Promise<{ call: FixtureProjectTreasuryCall; cursor: FixturePostCursor } | undefined> {
  if (!admit || !tx.to || tx.value !== 0n || tx.input.length > 3202) return;
  let treasury = tx.to, controller = tx.from, wrapperInput = tx.input;
  try {
    const safe = decodeFunctionData({ abi: safeAbi, data: tx.input });
    const [to, value, data, operation, safeGas, baseGas, gasPrice, gasToken, refund, signatures] = safe.args;
    if (value !== 0n || operation !== 0 || safeGas !== 0n || baseGas !== 0n || gasPrice !== 0n
        || !same(gasToken, zeroAddress) || !same(refund, zeroAddress) || !/^0x[0-9a-f]{260}$/i.test(signatures)
        || !same(tx.input, encodeFunctionData({ abi: safeAbi, ...safe }))) return;
    treasury = to; controller = tx.to; wrapperInput = data;
  } catch { /* Direct controller -> Treasury call; the exact decoder follows. */ }
  let decoded: ReturnType<typeof decodeFunctionData<typeof abi>>;
  try { decoded = decodeFunctionData({ abi, data: wrapperInput }); }
  catch { return; }
  if (!same(wrapperInput, encodeFunctionData({ abi, ...decoded }))) return;
  const cursor = cursors.find(item => item.launch.treasury && same(item.launch.treasury, treasury));
  if (!cursor) return;
  let call: FixtureProjectTreasuryCall;
  if (decoded.functionName === "claimCurve") call = { treasury, controller, operation: "curve-claim",
    target: cursor.launch.revenueLedger, calldata: encodeFunctionData({ abi: innerAbi, functionName: "claim" }), wrapperInput };
  else if (decoded.functionName === "claimLp") {
    const mode = decoded.args[0];
    if (!cursor.graduation || !cursor.lpLedger || mode > 2) return;
    call = { treasury, controller, operation: "lp-claim", target: cursor.lpLedger, wrapperInput,
      calldata: mode === 0 ? encodeFunctionData({ abi: innerAbi, functionName: "claim" })
        : encodeFunctionData({ abi: innerAbi, functionName: "claimAsset", args: [mode === 1] }) };
  } else {
    if (!cursor.graduation || !cursor.lpLedger) return;
    call = { treasury, controller, operation: "lp-collect", target: cursor.graduation.owner, wrapperInput,
      calldata: encodeFunctionData({ abi: innerAbi, functionName: "collectLpFees", args: [cursor.launch.token, decoded.args[0]] }) };
  }
  if (!await admit(call, tx, block, cursor)) return;
  return { call, cursor };
}

/** Both nested edges are checked against the real outer trace. The beneficiary
 * remains the Treasury even when a Safe is its authorized controller. */
export function assertFixtureProjectTreasuryProof(raw: unknown, tx: FixtureTx, call: FixtureProjectTreasuryCall,
  payments: { from: Address; to: Address; amount: bigint }[]) {
  if (!tx.to || tx.value !== 0n) throw Error("Project treasury outer call unavailable");
  const outer = { from: tx.from, to: tx.to, input: tx.input, value: 0n };
  if (!same(tx.to, call.treasury)) assertFixtureInnerCallProof(raw, outer,
    { from: call.controller, to: call.treasury, input: call.wrapperInput, value: 0n });
  assertFixtureInnerCallProof(raw, outer, { from: call.treasury, to: call.target, input: call.calldata, value: 0n });
  assertFixtureNativeProof(raw, outer, payments);
}
