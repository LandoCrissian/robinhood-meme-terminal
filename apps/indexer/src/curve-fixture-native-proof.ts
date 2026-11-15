import { isAddress, type Address, type Hex } from "viem";

type Node = { type: string; from: string; to: string; value: bigint; input?: string; calls: Node[] };
type Payment = { from: Address; to: Address; amount: bigint };
type Origin = { from: Address; to: Address; value: bigint; input: Hex };
const types = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"]);
// Bounds the known v4 actions and a single external treasury claim.
const maxReviewedInput = 3_202;

function verifiedTrace(raw: unknown, origin: Origin) {
  let nodes = 0;
  function parse(input: unknown, depth: number): Node | undefined {
    if (++nodes > 4_096 || depth > 64 || !input || typeof input !== "object" || Array.isArray(input)) throw new Error("Fixture malformed native trace");
    const node = input as Record<string, unknown>;
    if (typeof node.type !== "string" || !types.has(node.type) || (node.calls !== undefined && !Array.isArray(node.calls))) {
      throw new Error("Fixture malformed native trace");
    }
    const children = ((node.calls ?? []) as unknown[]).map((child) => parse(child, depth + 1)).filter((child) => child !== undefined);
    // Reverted subtrees cannot prove that value settled.
    if (typeof node.error === "string" && node.error) return undefined;
    const value = node.value ?? (node.type === "STATICCALL" || node.type === "DELEGATECALL" ? "0x0" : undefined);
    if (node.error !== undefined || typeof node.from !== "string" || !isAddress(node.from, { strict: false })
        || typeof node.to !== "string" || !isAddress(node.to, { strict: false }) || typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value)) {
      throw new Error("Fixture malformed native trace");
    }
    return { type: node.type, from: node.from.toLowerCase(), to: node.to.toLowerCase(), value: BigInt(value),
      input: typeof node.input === "string" && node.input.length <= maxReviewedInput
        ? node.input.toLowerCase() : undefined, calls: children };
  }
  const trace = parse(raw, 0);
  if (!trace || trace.type !== "CALL" || trace.input !== origin.input.toLowerCase() || trace.value !== origin.value
      || trace.from !== origin.from.toLowerCase() || trace.to !== origin.to.toLowerCase()) throw new Error("Fixture native trace transaction mismatch");
  return trace;
}

function assertPayments(trace: Node, payments: Payment[]) {
  const sum = (node: Node, payment: Payment): bigint => {
    const amount = node.type === "CALL" && node.from === payment.from.toLowerCase() && node.to === payment.to.toLowerCase() ? node.value : 0n;
    return node.calls.reduce((total, child) => total + sum(child, payment), amount);
  };
  for (const payment of payments) {
    if (sum(trace, payment) !== payment.amount) throw new Error("Fixture native settlement is not independently proven");
  }
}

/** Require exact direct native transfers in a successful, transaction-bound call tree. */
export function assertFixtureNativeProof(raw: unknown, origin: Origin, payments: Payment[]) {
  assertPayments(verifiedTrace(raw, origin), payments);
}

/** Verify the only successful call from the committed treasury account to this fee ledger. */
export function fixtureTreasuryClaimInput(raw: unknown, origin: Origin, ledger: Address, nativeAmount: bigint): Hex {
  const trace = verifiedTrace(raw, origin);
  const wallet = origin.to.toLowerCase();
  const ledgerAddress = ledger.toLowerCase();
  const calls: Node[] = [];
  function inspect(node: Node) {
    if (node.type === "CALL" && node.from === wallet && node.to === ledgerAddress) calls.push(node);
    node.calls.forEach(inspect);
  }
  trace.calls.forEach(inspect);
  const call = calls[0];
  if (origin.value !== 0n || calls.length !== 1 || call?.value !== 0n || !call.input || !/^0x(?:[0-9a-f]{2})+$/.test(call.input)) {
    throw new Error("Fixture treasury claim call is not independently proven");
  }
  assertPayments(call, [{ from: ledger, to: origin.to, amount: nativeAmount }]);
  assertPayments(trace, [{ from: ledger, to: origin.to, amount: nativeAmount }]);
  return call.input as Hex;
}
