import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
requireWeb('tsx/cjs');
const { zeroXIntegratorFeeAmount } = requireWeb('./lib/vnext/zero-x-settlement.ts');
const root = new URL('../../evidence/trading-hardening/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const old = read('zero-x-50-token-matrix.json');
const current = read('sell-response-closure/matrix.json');
const preHalfUp = read('sell-response-closure/pre-half-up-matrix.json');
const previousMismatches = preHalfUp.rows.filter(row => row.invalidResponseReason === 'WRONG_INTEGRATOR_FEE_AMOUNT');
assert.equal(previousMismatches.length, 14);
assert.equal(current.previousFeeMismatchCases.length, 14);
assert.deepEqual(current.previousFeeMismatchCases.map(row => [row.sampleIndex, row.assetContract, row.direction, row.testAmount]),
  previousMismatches.map(row => [row.sampleIndex, row.assetContract, row.direction, row.testAmount]));
assert.equal(current.atomicFeePolicy, 'OWNER_AUTHORIZED_NEAREST_INTEGER_HALF_UP');
assert.equal(current.seed, 5272840); assert.equal(current.complete, true); assert.equal(current.rows.length, 100);
assert.deepEqual(current.rows.map(row => [row.sampleIndex, row.assetContract, row.direction]), old.rows.map(row => [row.sampleIndex, row.assetContract, row.direction]));
assert.equal(current.peepCases.length, 4); assert.equal(current.originalInvalidCases.length, 19);
for (const row of [...current.rows, ...current.peepCases]) {
  assert.equal(row.expectedIntegratorFee, zeroXIntegratorFeeAmount(row.testAmount));
  assert.ok(['FIRM_VERIFIED', 'NO_ROUTE', 'PROVIDER_UNAVAILABLE'].includes(row.caseOutcome)
    || row.caseOutcome === `POLICY_REJECTED_${row.invalidResponseReason}`);
  assert.equal(row.chainId, 4663); assert.equal(row.provider, 'zero-x-swap'); assert.equal(row.rmtFeeBps, 25);
  assert.equal(row.feeAsset, row.inputAsset); assert.equal(row.providerSlippagePpm, 9900); assert.equal(row.maximumUserSlippagePpm, 10000);
  assert.ok(current.admissions.some(entry => entry.assetContract.toLowerCase() === row.assetContract.toLowerCase() && entry.status === 'ADMITTED'));
  assert.ok(['FIRM_RETURNED', 'no_route', 'temporarily_unavailable', 'invalid_response'].includes(row.zeroXQuoteStatus));
  if (row.zeroXQuoteStatus === 'invalid_response') {
    assert.ok(['WRONG_INTEGRATOR_FEE_AMOUNT', 'MISSING_INTEGRATOR_FEE'].includes(row.invalidResponseReason));
    assert.equal(row.policyViolation, 'YES');
    if (row.invalidResponseReason === 'WRONG_INTEGRATOR_FEE_AMOUNT') assert.notEqual(row.responseEconomics.integratorFee.amount, row.expectedIntegratorFee);
    else assert.equal(row.responseEconomics.integratorFee, null);
  }
  if (row.zeroXQuoteStatus === 'FIRM_RETURNED') {
    assert.equal(row.targetRuntimeHash, '0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799');
    assert.equal(row.settlerRuntimeHash, '0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966');
    assert.equal(row.transactionTarget.toLowerCase(), '0x0000000000001ff3684f28c67538d4d072c22734');
    assert.ok(BigInt(row.protectedOutput) * 1000000n >= BigInt(row.expectedOutput) * 990000n);
    assert.ok(['PASS', 'UNSUPPORTED_TOKEN_STORAGE_LAYOUT'].includes(row.fundedSimulation?.status));
    if (row.fundedSimulation.status === 'PASS') {
      assert.equal(row.fundedSimulation.calldataHash, row.calldataHash);
      assert.equal(row.fundedSimulation.transactionValue, row.transactionValue);
      assert.equal(row.fundedSimulation.transactionTarget, row.transactionTarget);
      assert.equal(row.fundedSimulation.walletAuthority, false); assert.equal(row.fundedSimulation.exactEnvelopePreserved, true);
    }
  }
}
for (let i = 0; i < 100; i += 2) {
  const buy = current.rows[i], sell = current.rows[i + 1];
  if (buy.indicativeExpectedOutput && BigInt(buy.indicativeExpectedOutput) >= 400n) assert.equal(sell.testAmount, buy.indicativeExpectedOutput);
}
const fees = read('sell-response-closure/fee-rounding.json');
assert.equal(fees.rows.length, 44); assert.equal(fees.feeAdmissionChanged, true);
for (const row of fees.rows) {
  const numerator = BigInt(row.sellAmount) * 25n;
  assert.equal(row.exactNumerator, numerator.toString()); assert.equal(row.integerFloor, (numerator / 10000n).toString());
  assert.equal(row.integerCeil, ((numerator + 9999n) / 10000n).toString());
  if (row.zeroXReturnedAmount !== null) assert.equal(row.zeroXReturnedAmount, zeroXIntegratorFeeAmount(row.sellAmount));
}
assert.equal(current.walletRequests, 0); assert.equal(current.signatures, 0); assert.equal(current.transactions, 0);
console.log('Corrected frozen matrix and bounded nearest-half-up observations verified; live trace credential/proof remains a separate release gate.');
