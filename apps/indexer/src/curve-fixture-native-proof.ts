import { isAddress, type Address, type Hex } from "viem";

type Node = { type: string; from: string; to: string; value: bigint; input?: string; calls: Node[] };
type Payment = { from: Address; to: Address; amount: bigint };
const types = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"]);

/** Uses #594's bounded callTracer approach with exact direct transfers for this EOA fixture path. */
export function assertFixtureNativeProof(raw: unknown, origin: { from: Address; to: Address; value: bigint; input: Hex }, payments: Payment[]) {
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
      input: depth === 0 && typeof node.input === "string" && node.input.length <= 1024 ? node.input.toLowerCase() : undefined, calls: children };
  }
  const trace = parse(raw, 0);
  if (!trace || trace.type !== "CALL" || trace.input !== origin.input.toLowerCase() || trace.value !== origin.value
      || trace.from !== origin.from.toLowerCase() || trace.to !== origin.to.toLowerCase()) throw new Error("Fixture native trace transaction mismatch");
  const sum = (node: Node, payment: Payment): bigint => {
    const amount = node.type === "CALL" && node.from === payment.from.toLowerCase() && node.to === payment.to.toLowerCase() ? node.value : 0n;
    return node.calls.reduce((total, child) => total + sum(child, payment), amount);
  };
  for (const payment of payments) {
    if (sum(trace, payment) !== payment.amount) throw new Error("Fixture native settlement is not independently proven");
  }
}
