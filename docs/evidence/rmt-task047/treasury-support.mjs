import assert from "node:assert/strict";

const syntheticScope = "SYNTHETIC_4663_FORK";
const uint256Max = (1n << 256n) - 1n;
const safeFields = [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
];

export function reviewTreasurySupport(viem, { scope, bindings, request, approval, observed }) {
  if (scope !== syntheticScope) {
    return {
      status: "BLOCKED_UNVERIFIED_LIVE_BINDINGS", broadcastAuthorized: false, transaction: null,
    };
  }
  assert.equal(bindings.chainId, 4663);
  const roles = ["operations", "reserve", "lammbTreasury", "lammbSupportPayee", "rmtSupportPayee"];
  const addresses = roles.map((role) => {
    const address = viem.getAddress(bindings[role]);
    assert.ok(BigInt(address) > 0xffffn, `${role} must be a real fixture address`);
    return address;
  });
  assert.equal(new Set(addresses).size, addresses.length, "Treasury roles and support payees must be disjoint");
  const [operations, , lammbTreasury, lammbSupportPayee, rmtSupportPayee] = addresses;
  const routes = {
    RMT_SUPPORTS_LAMMB: { from: operations, recipient: lammbSupportPayee, approvedBy: "RMT_OPERATIONS" },
    LAMMB_SUPPORTS_RMT: { from: lammbTreasury, recipient: rmtSupportPayee, approvedBy: "LAMMB_TREASURY" },
  };
  assert.ok(Object.hasOwn(routes, request.direction), "Unknown support direction");
  const { from, recipient, approvedBy } = routes[request.direction];
  assert.equal(observed.chainId, bindings.chainId);
  assert.equal(viem.getAddress(observed.safe), from, "Observed Safe does not match source role");
  assert.match(request.reference, /^fixture-[a-z0-9-]{1,56}$/);
  assert.match(request.amount, /^[1-9]\d{0,77}$/);
  assert.match(request.nonce, /^(0|[1-9]\d{0,77})$/);
  const amount = BigInt(request.amount);
  const nonce = BigInt(request.nonce);
  assert.ok(amount <= uint256Max && nonce <= uint256Max);
  assert.equal(observed.nonce, nonce, "Safe nonce differs from the reviewed nonce");
  const asset = request.asset === "ETH" ? "ETH" : viem.getAddress(bindings.projectToken);
  if (asset !== "ETH") {
    assert.ok(BigInt(asset) > 0xffffn && !addresses.includes(asset), "Token must be a distinct pinned fixture asset");
  }
  const intent = {
    reference: request.reference, chainId: 4663, direction: request.direction, from, recipient, asset,
    amount: request.amount, nonce: request.nonce,
  };
  assert.deepEqual(request, intent, "Request differs from the permitted exact transfer");
  assert.deepEqual(approval, { scope: syntheticScope, approvedBy, intent }, "Separate scoped approval is required");
  assert.ok(observed.available >= amount, "Insufficient synthetic Safe balance");

  const payment = asset === "ETH"
    ? { to: recipient, value: amount, data: "0x" }
    : { to: asset, value: 0n, data: viem.encodeFunctionData({ abi: viem.erc20Abi, functionName: "transfer", args: [recipient, amount] }) };
  const message = {
    ...payment, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: viem.zeroAddress,
    refundReceiver: viem.zeroAddress, nonce,
  };
  return {
    status: "UNSIGNED_SYNTHETIC_ONLY", broadcastAuthorized: false, approval, transaction: message,
    safeTxHash: viem.hashTypedData({
      domain: { chainId: bindings.chainId, verifyingContract: from }, types: { SafeTx: safeFields },
      primaryType: "SafeTx", message,
    }),
  };
}
