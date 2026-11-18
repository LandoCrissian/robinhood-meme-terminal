// Shared bounded settlement proof extracted from the existing canonical indexer.
// It has no network, wallet or credential capability. Original error text stays
// compatible with the independently exercised indexer regressions.
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const types = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"]);
const maxReviewedInput = 3202;

function verifiedTrace(raw, origin) {
  let nodes = 0;
  function parse(input, depth) {
    if (++nodes > 4096 || depth > 64 || !input || typeof input !== "object" || Array.isArray(input)) throw new Error("Fixture malformed native trace");
    const node = input;
    if (typeof node.type !== "string" || !types.has(node.type) || (node.calls !== undefined && !Array.isArray(node.calls))) throw new Error("Fixture malformed native trace");
    const children = (node.calls ?? []).map(child => parse(child, depth + 1)).filter(child => child !== undefined);
    if (typeof node.error === "string" && node.error) return undefined;
    const value = node.value ?? (["STATICCALL", "DELEGATECALL"].includes(node.type) ? "0x0" : undefined);
    if (node.error !== undefined || !address(node.from) || !address(node.to)
      || typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value)) throw new Error("Fixture malformed native trace");
    return { type: node.type, from: node.from.toLowerCase(), to: node.to.toLowerCase(), value: BigInt(value),
      input: typeof node.input === "string" && node.input.length <= maxReviewedInput ? node.input.toLowerCase() : undefined, calls: children };
  }
  const trace = parse(raw, 0);
  if (!trace || trace.type !== "CALL" || trace.input !== origin.input.toLowerCase() || trace.value !== origin.value
    || trace.from !== origin.from.toLowerCase() || trace.to !== origin.to.toLowerCase()) throw new Error("Fixture native trace transaction mismatch");
  return trace;
}

function assertPayments(trace, payments) {
  const sum = (node, payment) => {
    const amount = node.type === "CALL" && node.from === payment.from.toLowerCase() && node.to === payment.to.toLowerCase() ? node.value : 0n;
    return node.calls.reduce((total, child) => total + sum(child, payment), amount);
  };
  for (const payment of payments) if (sum(trace, payment) !== payment.amount) throw new Error("Fixture native settlement is not independently proven");
}

export function assertNativeTransferProof(raw, origin, payments) {
  assertPayments(verifiedTrace(raw, origin), payments);
}

// A contract-wallet outer transaction is not the beneficiary's inner CALL.
// Require one exact successful CALL with its own actor, target and zero value;
// parsing shares the existing bounded/revert-aware trace rules above.
export function assertInnerCallProof(raw, origin, inner) {
  const trace = verifiedTrace(raw, origin);
  const matching = [];
  function visit(node) {
    if (node.type === "CALL" && node.from === inner.from.toLowerCase() && node.to === inner.to.toLowerCase()) matching.push(node);
    node.calls.forEach(visit);
  }
  trace.calls.forEach(visit);
  if (matching.length !== 1 || matching[0].value !== inner.value || matching[0].input !== inner.input.toLowerCase()) {
    throw new Error("Contract-wallet inner claim is not independently proven");
  }
}

export function treasuryClaimInput(raw, origin, ledger, nativeAmount) {
  const trace = verifiedTrace(raw, origin);
  const wallet = origin.to.toLowerCase();
  const calls = [];
  function inspect(node) {
    if (node.type === "CALL" && node.from === wallet && node.to === ledger.toLowerCase()) calls.push(node);
    node.calls.forEach(inspect);
  }
  trace.calls.forEach(inspect);
  const call = calls[0];
  if (origin.value !== 0n || calls.length !== 1 || call?.value !== 0n || !call.input || !/^0x(?:[0-9a-f]{2})+$/.test(call.input)) {
    throw new Error("Fixture treasury claim call is not independently proven");
  }
  assertPayments(call, [{ from: ledger, to: origin.to, amount: nativeAmount }]);
  assertPayments(trace, [{ from: ledger, to: origin.to, amount: nativeAmount }]);
  return call.input;
}
