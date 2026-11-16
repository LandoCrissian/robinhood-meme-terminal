import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { getContractAddress, isAddress, isAddressEqual, toHex, zeroAddress } = require("viem");
const sameNullableAddress = (left, right) => left === null || right === null ? left === right : isAddressEqual(left, right);
const hashPattern = /^0x[0-9a-f]{64}$/;
const quantity = (value) => {
  if (typeof value === "number") assert.ok(Number.isSafeInteger(value));
  const asString = String(value);
  assert.match(asString, /^(0|[1-9][0-9]{0,79})$/);
  return BigInt(asString);
};

// The fixture runtime separately verifies that the exact local origin is Anvil.
// This formatter has no provider, signer, or ability to send a transaction.
export function buildLoopbackType2Envelope(request) {
  const { endpoint, chainId, from, to = null, data, nonce, value, gas, maxFeePerGas, maxPriorityFeePerGas, ...unsupported } = request;
  assert.deepEqual(Object.keys(unsupported), [], "Unexpected transaction or account-abstraction fields");
  const url = new URL(endpoint);
  assert.ok(url.port && endpoint === "http://127.0.0.1:" + url.port + "/", "Direct rehearsal requires exact loopback RPC");
  assert.equal(chainId, 4663);
  assert.ok(isAddress(from) && !isAddressEqual(from, zeroAddress));
  if (to !== null) assert.ok(isAddress(to) && !isAddressEqual(to, zeroAddress));
  assert.match(data, /^0x(?:[0-9a-fA-F]{2})+$/);
  if (to === null) assert.ok((data.length - 2) / 2 <= 49_152, "CREATE initcode exceeds the EVM limit");
  const txNonce = quantity(nonce);
  const txValue = quantity(value);
  const gasLimit = quantity(gas);
  const feeCap = quantity(maxFeePerGas);
  const priority = quantity(maxPriorityFeePerGas);
  assert.ok(txNonce < (1n << 64n) - 1n);
  assert.ok(gasLimit > 0n && gasLimit < 1n << 64n);
  assert.ok(txValue < 1n << 256n && feeCap > 0n && feeCap < 1n << 256n && priority <= feeCap);
  return {
    type: "0x2", chainId: toHex(chainId), from, ...(to === null ? {} : { to }), data,
    nonce: toHex(txNonce), value: toHex(txValue), gas: toHex(gasLimit),
    maxFeePerGas: toHex(feeCap), maxPriorityFeePerGas: toHex(priority),
  };
}

// Input is a fork receipt plus its corroborated transaction envelope, never a wallet request.
export function verifyDirectType2Outcome(observed, expected) {
  const { sender, to, nonce, dataHash, valueWei, expectedAddress, expectedStatus = "success" } = expected;
  assert.equal(observed.chainId, 4663);
  assert.equal(observed.type, "eip1559");
  assert.deepEqual(observed.accessList, []);
  assert.ok(!Object.hasOwn(observed, "authorizationList"), "Direct type 2 cannot carry delegation authorizations");
  assert.ok(["success", "reverted"].includes(expectedStatus));
  assert.equal(observed.status, expectedStatus);
  assert.ok(isAddressEqual(observed.from, sender), "Incorrect direct sender");
  assert.ok(sameNullableAddress(observed.to, to), "Incorrect direct destination");
  assert.equal(quantity(observed.nonce), quantity(nonce), "Incorrect direct nonce");
  assert.equal(quantity(observed.valueWei), quantity(valueWei), "Incorrect transaction value");
  assert.equal(observed.calldataHash, dataHash, "Incorrect input hash");
  for (const hash of [observed.calldataHash, observed.transactionHash, observed.blockHash]) assert.match(hash, hashPattern);
  assert.ok(quantity(observed.blockNumber) > 0n);
  const gas = quantity(observed.gas);
  const gasUsed = quantity(observed.gasUsed);
  const effectiveGasPrice = quantity(observed.effectiveGasPrice);
  const maxFeePerGas = quantity(observed.maxFeePerGas);
  const maxPriorityFeePerGas = quantity(observed.maxPriorityFeePerGas);
  assert.ok(gasUsed > 0n && gasUsed <= gas);
  assert.ok(maxPriorityFeePerGas <= maxFeePerGas && effectiveGasPrice > 0n && effectiveGasPrice <= maxFeePerGas);
  if (to === null) {
    const address = getContractAddress({ from: sender, nonce: quantity(nonce) });
    assert.ok(isAddressEqual(expectedAddress, address), "Incorrect CREATE prediction");
    if (expectedStatus === "success" || observed.contractAddress !== null) {
      assert.ok(sameNullableAddress(observed.contractAddress, address), "Incorrect CREATE receipt address");
    }
    if (expectedStatus === "reverted") assert.equal(observed.codeAfter, "0x");
  } else {
    assert.equal(observed.contractAddress, null);
  }
  return {
    transactionHash: observed.transactionHash, blockHash: observed.blockHash, blockNumber: quantity(observed.blockNumber).toString(),
    status: observed.status, gasLimit: gas.toString(), gasUsed: gasUsed.toString(), effectiveGasPriceWei: effectiveGasPrice.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(), maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
  };
}
