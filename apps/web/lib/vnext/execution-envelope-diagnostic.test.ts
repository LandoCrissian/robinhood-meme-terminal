import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { getAddress, type Hex } from "viem";
import { decodeZeroXExecutableMinimum, verifyZeroXEncodedFee, ZERO_X_PPM_SETTLER_RUNTIME_HASH } from "../server/vnext-zero-x-execution-decoder";
import { ExecutionEnvelopeFailure, executionFailureResponse, structureTradeFailure } from "./trade-failure";
import { captureResponseDiagnostic, consumeResponseDiagnostic, appendResponseDiagnostic, serializeResponseDiagnostic } from "./quote-response-diagnostic";
import { feeMutations, mutateZeroXActions } from "./zero-x-provider-native-fee-smoke";
import { safeEnvelopeDiagnostic } from "./execution-envelope-diagnostic";
const fixture = createRequire(import.meta.url)("../../../../.github/scripts/zerox-execution-fixture.cjs");
// Synthetic reviewed V3 grammar with the exact selected contracts. NOT the
// owner's production envelope, which was not retained by the deployed server.
const inputAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const outputAsset = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const target = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
const body = { sellToken: inputAsset, buyToken: outputAsset, sellAmount: "1000000", minBuyAmount: "990000", actionBasisForTest: 1000000n, transaction: {to: target} };
const input = { inputAsset, outputAsset, recipient, target, inputAmountAtomic: body.sellAmount, valueAtomic: "0", data: fixture.encodeQuote(body, recipient) as Hex,
  runtimeHash: ZERO_X_PPM_SETTLER_RUNTIME_HASH, expectedOutputAtomic: "1000000", providerFeeAsset: null, providerFeeAtomic: null };
test("recipient rejection retains exact decoder invariant without calldata", () => {
  assert.throws(() => decodeZeroXExecutableMinimum({...input, recipient: inputAsset}), (error: unknown) => {
    assert.ok(error instanceof ExecutionEnvelopeFailure);
    assert.equal(error.envelope.envelopeReason, "RECIPIENT_MISMATCH");
    assert.equal(error.envelope.envelopeFunction, "decodeZeroXExecutableMinimum");
    assert.equal(JSON.stringify(error).includes(input.data), false);
    return true;
  });
});
test("supported synthetic exact-pair grammar remains accepted; unknown action remains rejected", () => {
  assert.equal(verifyZeroXEncodedFee(input).rateBps, 25);
  const data = mutateZeroXActions(input.data, actions => { actions[2] = "0xdeadbeef"; });
  assert.throws(() => verifyZeroXEncodedFee({...input,data}), (error: unknown) => {
    assert.ok(error instanceof ExecutionEnvelopeFailure);
    assert.equal(error.envelope.envelopeReason, "UNSUPPORTED_ACTION");
    assert.equal(error.envelope.actionIndex, 2);
    assert.equal(error.envelope.actionKind, "0xdeadbeef");
    return true;
  });
});
test("HTTP, server event and copied diagnostic retain only bounded envelope fields", async () => {
  const id="aa149dd2-acc6-4a4b-8a23-2b05ae1fcaf8";
  const error = new ExecutionEnvelopeFailure({envelopeReason:"UNSUPPORTED_ACTION",envelopeFunction:"verifyZeroXEncodedFee",actionIndex:2,actionKind:"0xdeadbeef"});
  const logs: string[]=[];const original=console.info;console.info=(value)=>logs.push(String(value));
  try {
    const response=executionFailureResponse(error,"verification",id)!;
    const payload=await (await structureTradeFailure(response,"verification")).json();
    const record=captureResponseDiagnostic({...payload, calldata:input.data, token:"SECRET",message:"SECRET"},0,id,"sfo1::iad1::s8q5d-1789863213907-cc4e5c8ef388",1);
    const entry=appendResponseDiagnostic([],consumeResponseDiagnostic(record,1,false),"private","private",1)[0];
    const serialized=serializeResponseDiagnostic(entry);
    assert.equal(JSON.parse(serialized).envelopeReason,"UNSUPPORTED_ACTION");
    assert.equal(JSON.parse(serialized).actionIndex,2);
    assert.equal(serialized.includes(input.data),false);assert.equal(serialized.includes("SECRET"),false);
    assert.equal(JSON.parse(logs[0]).quoteRequestId,id);
    assert.equal(JSON.stringify(logs).includes(input.data),false);
  } finally {console.info=original;}
});

test("fee and ordering rejections preserve their first invariant and action position", () => {
  const cases = [
    ["wrong treasury", "FEE_RECIPIENT_MISMATCH", 1],
    ["wrong token/native-WETH confusion", "FEE_TOKEN_MISMATCH", 1],
    ["zero rate", "FEE_RATE_MISMATCH", 1],
    ["duplicate fee", "UNSUPPORTED_ROUTE", 2],
    ["unsafe ordering", "INPUT_ACTION_MISMATCH", 0],
    ["extra treasury transfer", "UNSUPPORTED_ROUTE", 3],
    ["noncanonical fee bytes", "NONCANONICAL_ACTION", 1],
    ["early slippage", "EARLY_SLIPPAGE", 2],
  ] as const;
  for (const [label, reason, index] of cases) {
    const mutate = feeMutations.find(([name]) => name === label)![1];
    assert.throws(() => verifyZeroXEncodedFee({ ...input, data: mutateZeroXActions(input.data, mutate) }), (error: unknown) => {
      assert.ok(error instanceof ExecutionEnvelopeFailure, label);
      assert.equal(error.envelope.envelopeReason, reason, label);
      assert.equal(error.envelope.actionIndex, index, label);
      return true;
    });
  }
  assert.throws(() => verifyZeroXEncodedFee({ ...input, recipient: inputAsset }), (error: unknown) => {
    assert.ok(error instanceof ExecutionEnvelopeFailure);
    assert.equal(error.envelope.envelopeFunction, "decodeZeroXExecutableMinimum", "fee verifier must not overwrite the original failure");
    assert.equal(error.envelope.envelopeReason, "RECIPIENT_MISMATCH");
    return true;
  });
});

test("diagnostic fields reject arbitrary strings, addresses, calldata and invalid indexes", () => {
  for (const unsafe of [input.data, recipient, "https://secret.invalid/?token=PRIVATE", "PRIVATE", "x".repeat(10000)]) {
    assert.deepEqual(safeEnvelopeDiagnostic({ envelopeReason: unsafe, envelopeFunction: unsafe, actionKind: unsafe, actionIndex: unsafe }),
      { envelopeReason: null, envelopeFunction: null, actionKind: null, actionIndex: null });
  }
  for (const index of [-1, 256, 1.5, NaN, Infinity]) assert.equal(safeEnvelopeDiagnostic({actionIndex: index}).actionIndex, null);
  assert.equal(safeEnvelopeDiagnostic({actionIndex: 255}).actionIndex, 255);
  assert.equal(safeEnvelopeDiagnostic({actionKind: "0xdeadbeef"}).actionKind, "0xdeadbeef");
});

test("malformed ABI preserves selector only and missing correlation is not invented", async () => {
  const data = mutateZeroXActions(input.data, actions => { actions[1] = actions[1].slice(0, 10) as Hex; });
  let failure: ExecutionEnvelopeFailure | undefined;
  try { verifyZeroXEncodedFee({...input, data}); } catch (error) {
    assert.ok(error instanceof ExecutionEnvelopeFailure);
    failure = error;
  }
  assert.ok(failure);
  assert.equal(failure.envelope.envelopeReason, "MALFORMED_ACTION");
  assert.equal(failure.envelope.actionIndex, 1);
  assert.equal(failure.envelope.actionKind, "BASIC");
  const logs: string[] = [];
  const original = console.info;
  console.info = value => logs.push(String(value));
  try {
    const response = executionFailureResponse(failure, "verification", "PRIVATE")!;
    assert.equal((await response.json()).quoteRequestId, undefined);
    assert.equal(JSON.parse(logs[0]).quoteRequestId, undefined);
    assert.ok(logs[0].length < 1024);
    assert.equal(logs[0].includes("PRIVATE"), false);
    assert.equal(logs[0].includes(data), false);
  } finally { console.info = original; }
});
