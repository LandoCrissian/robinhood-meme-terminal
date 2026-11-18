import { encodeFunctionData, keccak256, parseAbi, parseEventLogs, toHex, type Address, type Hash, type Hex,
  type PublicClient } from "viem";
import type { BlockEvidence, CurveFixtureBinding } from "./curve-launch-evidence.js";
import { nativeProof, receiptLogs, type FixtureTx, type LogProof } from "./curve-fixture-lifecycle.js";
import { fixtureExternalClaim, type FixturePostCursor, type FixturePostEvent } from "./curve-fixture-post-graduation.js";
import { fixtureTreasuryClaimInput } from "./curve-fixture-native-proof.js";

const curveAbi = parseAbi(["function claim() returns(uint256)", "function claimable(address) view returns(uint256)",
  "event CurveFeeClaimed(address indexed recipient,uint256 amount)"]);
const factoryAbi = parseAbi(["function claimCreationFees() returns(uint256)", "function creationFeesAccrued() view returns(uint256)",
  "event CreationFeesClaimed(address indexed recipient,uint256 amount)"]);
const claimInput = encodeFunctionData({ abi: curveAbi, functionName: "claim" });
const payoutInput = encodeFunctionData({ abi: factoryAbi, functionName: "claimCreationFees" });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type FixtureFeeActivity = LogProof & {
  kind: "curve-claim" | "lp-claim" | "lp-collect" | "creation-payout";
  token: Address | null; ledger: Address; account: Address; recipient: Address; nativeWei: string; tokenWei: string;
};
function requireActivity(ok: unknown): asserts ok { if (!ok) throw new Error("Fixture fee activity settlement proof failed"); }

/** Exact successful direct factory/ledger calls, or a traced single Safe curve
 * claim. Missing traces/receipts never become a completed indexed operation. */
export async function indexFixtureFeeActivity(rpc: PublicClient, binding: CurveFixtureBinding, cursors: FixturePostCursor[],
  tx: FixtureTx, block: BlockEvidence, index: number): Promise<FixtureFeeActivity | undefined> {
  if (!tx.to || tx.value !== 0n) return;
  const isFactory = same(tx.to, binding.factory) && same(tx.input, payoutInput);
  let cursor = cursors.find(item => same(item.launch.revenueLedger, tx.to!) && same(tx.input, claimInput));
  let inner: Hex | undefined;
  if (!isFactory && !cursor) {
    const external = fixtureExternalClaim(tx.input);
    if (!external || !same(external.calldata, claimInput)) return;
    cursor = cursors.find(item => same(item.launch.revenueLedger, external.ledger));
    if (!cursor) return;
    inner = external.calldata;
  }
  const receipt = await rpc.getTransactionReceipt({ hash: tx.hash });
  const logs = receiptLogs(tx, receipt, block, index, tx.to);
  if (receipt.status === "reverted") { requireActivity(logs.length === 0); return; }
  if (isFactory) {
    const events = parseEventLogs({ abi: factoryAbi, eventName: "CreationFeesClaimed", strict: true,
      logs: logs.filter(log => same(log.address, binding.factory)) });
    const event = events[0];
    requireActivity(events.length === 1 && event && same(event.args.recipient, binding.creationFeeRecipient) && event.args.amount > 0n);
    const base = { address: binding.factory, abi: factoryAbi, functionName: "creationFeesAccrued" } as const;
    const [before, after] = await Promise.all([rpc.readContract({ ...base, blockNumber: receipt.blockNumber - 1n }),
      rpc.readContract({ ...base, blockNumber: receipt.blockNumber })]);
    requireActivity(before === event.args.amount && after === 0n);
    await nativeProof(rpc, tx, binding.factory, [{ from: binding.factory, to: binding.creationFeeRecipient, amount: event.args.amount }]);
    return { ...block, transactionHash: tx.hash, logIndex: event.logIndex, kind: "creation-payout", token: null,
      ledger: binding.factory, account: tx.from, recipient: binding.creationFeeRecipient, nativeWei: event.args.amount.toString(), tokenWei: "0" };
  }
  requireActivity(cursor);
  const ledger = cursor.launch.revenueLedger, recipient = inner ? tx.to : tx.from;
  const events = parseEventLogs({ abi: curveAbi, eventName: "CurveFeeClaimed", strict: true, logs: logs.filter(log => same(log.address, ledger)) });
  // Safe may return a successful outer receipt for a reverted internal call.
  if (inner && events.length === 0) return;
  const event = events[0];
  requireActivity(events.length === 1 && event && same(event.args.recipient, recipient) && event.args.amount > 0n);
  const base = { address: ledger, abi: curveAbi, functionName: "claimable", args: [recipient] } as const;
  const [before, after] = await Promise.all([rpc.readContract({ ...base, blockNumber: receipt.blockNumber - 1n }),
    rpc.readContract({ ...base, blockNumber: receipt.blockNumber })]);
  requireActivity(before === event.args.amount && after === 0n);
  if (inner) {
    const raw = await rpc.request({ method: "debug_traceTransaction", params: [tx.hash, { tracer: "callTracer" }] } as never, { retryCount: 0 });
    const actualInput = fixtureTreasuryClaimInput(raw, { ...tx, to: recipient }, ledger, event.args.amount);
    requireActivity(same(actualInput, inner));
  } else await nativeProof(rpc, tx, ledger, [{ from: ledger, to: recipient, amount: event.args.amount }]);
  return { ...block, transactionHash: tx.hash, logIndex: event.logIndex, kind: "curve-claim", token: cursor.launch.token,
    ledger, account: inner ? tx.to : tx.from, recipient, nativeWei: event.args.amount.toString(), tokenWei: "0" };
}

export function fixtureLpFeeActivity(post: { token: string; evidence: FixturePostEvent }, cursors: FixturePostCursor[]): FixtureFeeActivity | undefined {
  const event = post.evidence;
  if (event.kind !== "lp-claim" && event.kind !== "lp-collect") return;
  const cursor = cursors.find(item => same(item.launch.token, post.token));
  requireActivity(cursor?.lpLedger);
  return { ...event, kind: event.kind, token: cursor.launch.token, ledger: cursor.lpLedger,
    recipient: event.kind === "lp-collect" ? cursor.lpLedger : event.account };
}

export const fixtureFeeActivityTopics = {
  curve: keccak256(toHex("CurveFeeClaimed(address,uint256)")),
  factory: keccak256(toHex("CreationFeesClaimed(address,uint256)")),
} as const satisfies Record<string, Hash>;
export const fixtureFeeActivityEventAbi = parseAbi([
  "event CurveFeeClaimed(address indexed recipient,uint256 amount)",
  "event CreationFeesClaimed(address indexed recipient,uint256 amount)",
]);
