import assert from "node:assert/strict";
import { keccak256, zeroAddress } from "viem";
import { verifyVNextNativeOutputSettlement } from "./output-settlement";
import { normalizeNativeTrace } from "./normalized-native-trace";

const owner = "0x1111111111111111111111111111111111111111";
const holder = "0x0000000000001fF3684f28c67538d4D072C22734";
const settler = "0x39b38686A19836Ac10162c490E4558e120CbBE5f";
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
const input = "0x12345678" as const;
const record = {
  chainId: 4663, provider: "zero-x-swap", kind: "swap", state: "confirmed", wallet: owner,
  recipient: owner, txHash: hash, planId: "native-settlement-plan", payloadHash: keccak256(input),
  inputAsset: "0x2222222222222222222222222222222222222222", outputAsset: zeroAddress,
  inputAmountAtomic: "1000000", providerNativeFee: { protectedOutputAtomic: "100",
    transactionTarget: holder, calldataHash: keccak256(input),
  },
} as unknown as Parameters<typeof verifyVNextNativeOutputSettlement>[0];
const receipt = { status: "success", transactionHash: hash, blockHash, from: owner, to: holder, logs: [] } as const;
const transaction = { hash, chainId: 4663, from: owner, to: holder, input, value: 0n, blockHash };
const trace = { type: "CALL", from: owner, to: holder, input, value: "0x0", calls: [
  { type: "CALL", from: settler, to: owner, value: "0x96", input: "0x" },
] };
const verify = (candidate: unknown) => verifyVNextNativeOutputSettlement(record, receipt, transaction, candidate);
assert.equal(verify(trace)?.amountAtomic, "150", "exact transaction trace proves native output");
assert.equal(verify(normalizeNativeTrace(trace))?.amountAtomic, "150", "server-normalized calldata hash retains exact binding");
assert.equal(verify({ ...normalizeNativeTrace(trace), inputHash: hash }), null);
assert.equal(verify({ ...trace, calls: [{ ...trace.calls[0], to: holder }] }), null, "unrelated recipient grants no output");
assert.equal(verify({ ...trace, calls: [{ ...trace.calls[0], value: "0x63" }] }), null, "positive but below minimum remains unsettled");
assert.equal(verify({ ...trace, calls: [{ ...trace.calls[0], value: "0x64" }] })?.amountAtomic, "100", "exact minimum is sufficient");
assert.equal(verify({ ...trace, calls: [...trace.calls, { ...trace.calls[0], from: owner, to: holder, value: "0x64", error: "reverted" }] })?.amountAtomic, "150");
assert.equal(verify({ ...trace, error: "execution reverted" }), null);
assert.equal(verify({ ...trace, input: "0x99999999" }), null);
assert.equal(verify({ ...trace, calls: [] }), null);
assert.equal(verify({ ...trace, calls: [{ ...trace.calls[0], error: "execution reverted" }] }), null);
assert.equal(verify({ ...trace, calls: [{ ...trace.calls[0], type: "DELEGATECALL" }] }), null);
assert.equal(verify({ ...trace, calls: [...trace.calls, { type: "CALL", from: owner, to: settler, value: "0x64" }] }), null, "net output below protected minimum is not settlement");
assert.equal(verify({ ...trace, calls: [{ ...trace.calls[0], value: "garbage" }] }), null);
console.log("Exact native trace settlement and adversarial evidence PASS; wallet requests 0.");
