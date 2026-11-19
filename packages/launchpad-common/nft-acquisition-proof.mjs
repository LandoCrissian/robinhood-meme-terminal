// No network or wallet capability. This checks one transaction's actual call
// tree, not net block balances, so two independent fills may share a block.
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const bytes = value => typeof value === "string" && /^0x(?:[0-9a-f]{2}){0,65536}$/i.test(value);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function requireProof(value) { if (!value) throw Error("NFT acquisition exact transaction trace unavailable or conflicting"); }

export function assertNftAcquisitionTrace(raw, origin, expected) {
  requireProof(address(origin.from) && address(origin.to) && bytes(origin.input) && origin.value === 0n);
  requireProof(address(expected.vault) && address(expected.venue) && address(expected.collection)
    && bytes(expected.purchaseInput) && bytes(expected.fillInput) && bytes(expected.nftTransferInput)
    && typeof expected.totalCost === "bigint" && expected.totalCost > 0n
    && Array.isArray(expected.payments) && expected.payments.length <= 3);
  let count = 0;
  const flat = [];
  function visit(node, parent, depth) {
    requireProof(++count <= 4096 && depth <= 64 && node && typeof node === "object" && !Array.isArray(node)
      && ["CALL", "STATICCALL", "DELEGATECALL"].includes(node.type)
      && address(node.from) && address(node.to) && bytes(node.input ?? "0x")
      && node.error === undefined && (node.calls === undefined || Array.isArray(node.calls)));
    const value = node.value ?? (node.type === "STATICCALL" || node.type === "DELEGATECALL" ? "0x0" : undefined);
    requireProof(typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value));
    requireProof(!parent || same(node.from, parent.to) || node.type === "DELEGATECALL" && same(node.from, parent.to));
    const item = { ...node, input: node.input ?? "0x", amount: BigInt(value) };
    // A Safe proxy's one pinned delegate frame is not an arbitrary-call escape.
    if (item.type === "DELEGATECALL") requireProof(expected.safeSingleton && same(item.to, expected.safeSingleton)
      && same(item.from, origin.to) && item.amount === 0n);
    if (item.type === "STATICCALL") requireProof(item.amount === 0n);
    flat.push(item);
    for (const child of node.calls ?? []) {
      // Under DELEGATECALL the executing account remains the proxy.
      const caller = item.type === "DELEGATECALL" ? { to: item.from } : item;
      visit(child, caller, depth + 1);
    }
    return item;
  }
  const root = visit(raw, null, 0);
  requireProof(root.type === "CALL" && same(root.from, origin.from) && same(root.to, origin.to)
    && same(root.input, origin.input) && root.amount === origin.value);
  const purchases = flat.filter(n => n.type === "CALL" && same(n.to, expected.vault) && same(n.input, expected.purchaseInput));
  requireProof(purchases.length === 1 && purchases[0].amount === 0n);
  const fills = flat.filter(n => n.type === "CALL" && same(n.from, expected.vault) && same(n.to, expected.venue));
  requireProof(fills.length === 1 && same(fills[0].input, expected.fillInput)
    && fills[0].amount === (expected.native ? expected.totalCost : 0n));
  const transfers = flat.filter(n => n.type === "CALL" && same(n.from, expected.venue) && same(n.to, expected.collection));
  requireProof(transfers.length === 1 && transfers[0].amount === 0n && same(transfers[0].input, expected.nftTransferInput));
  const actual = new Map(), wanted = new Map();
  const add = (map, from, to, amount) => { const key = from.toLowerCase() + ":" + to.toLowerCase(); map.set(key, (map.get(key) ?? 0n) + amount); };
  for (const node of flat) if (node.type === "CALL" && node.amount > 0n) add(actual, node.from, node.to, node.amount);
  if (expected.native) {
    add(wanted, expected.vault, expected.venue, expected.totalCost);
    let total = 0n;
    for (const payment of expected.payments) {
      requireProof(address(payment.recipient) && typeof payment.amount === "bigint" && payment.amount >= 0n);
      total += payment.amount;
      if (payment.amount) add(wanted, expected.venue, payment.recipient, payment.amount);
    }
    requireProof(total === expected.totalCost);
  }
  requireProof(actual.size === wanted.size);
  for (const [key, amount] of wanted) requireProof(actual.get(key) === amount);
  return { evidence: "canonical-receipt-and-exact-local-call-trace", nativeTransfers: actual.size, frames: count };
}
