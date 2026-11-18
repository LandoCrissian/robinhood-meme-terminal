import { decodeEventLog, decodeFunctionData, parseAbi, parseEventLogs, toEventSelector, toHex, type Hash, type PublicClient } from "viem";
import { blockEvidence, type BlockEvidence, type CurveFixtureBinding } from "./curve-launch-evidence.js";
import { assertFixtureCanonicalCurveStart, fixtureGraduationAbi, indexFixtureCurveTransaction, lifecycleCurveAbi,
  receiptLogs, verifyFixtureV4Position, type FixtureGraduation, type FixtureGraduationBinding, type FixtureTx } from "./curve-fixture-lifecycle.js";
import { fixtureMigratedRegistration } from "./curve-fixture-migration.js";
import type { FixturePostCursor } from "./curve-fixture-post-graduation.js";

const accruedAbi = parseAbi(["function totalAccrued() view returns (uint256)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function requireSuccessor(ok: unknown): asserts ok { if (!ok) throw new Error("Fixture successor graduation evidence unavailable or inconsistent"); }

/** Index only the real graduation receipt and locked position, never a made-up
 * successor trading history. This runs in the existing leased fixture writer.
 * The same original revenue ledger continues to own all earlier fee credits. */
export async function indexFixtureSuccessorGraduation(rpc: PublicClient, binding: CurveFixtureBinding,
  graduation: FixtureGraduationBinding, cursors: FixturePostCursor[], transaction: FixtureTx, at: BlockEvidence, index: number) {
  if (!transaction.to || cursors.some(c => same(c.launch.initialCurve, transaction.to!))) return;
  try {
    const call = decodeFunctionData({ abi: lifecycleCurveAbi, data: transaction.input });
    if (call.functionName !== "graduate" && call.functionName !== "buyAndGraduate") return;
  } catch { return; }
  const receipt = await rpc.getTransactionReceipt({ hash: transaction.hash });
  const logs = receiptLogs(transaction, receipt, at, index, transaction.to);
  if (receipt.status === "reverted") { requireSuccessor(logs.length === 0); return; }
  const events = parseEventLogs({ abi: fixtureGraduationAbi, eventName: "CurveGraduated", strict: true,
    logs: logs.filter(log => same(log.address, graduation.graduationEngine)) });
  if (!events.length) return;
  const event = events[0]!;
  const cursor = cursors.find(c => same(c.launch.token, event.args.token));
  requireSuccessor(events.length === 1 && cursor && !cursor.graduation && same(event.args.curve, transaction.to));
  const route = await fixtureMigratedRegistration(rpc, binding, graduation, cursor.launch, at);
  requireSuccessor(route && same(route.activeCurve, transaction.to));
  const height = BigInt(at.blockNumber);
  requireSuccessor(height > BigInt(cursor.launch.creation.blockNumber));
  const previous = blockEvidence(await rpc.getBlock({ blockNumber: height - 1n }), height - 1n);
  const currentHeader = await rpc.getBlock({ blockNumber: height });
  requireSuccessor(currentHeader.hash && same(currentHeader.hash, at.blockHash) && same(currentHeader.parentHash, previous.blockHash));
  const previousRoute = await fixtureMigratedRegistration(rpc, binding, graduation, cursor.launch, previous);
  requireSuccessor(previousRoute && same(previousRoute.activeCurve, route.activeCurve)
    && previousRoute.version === route.version && same(previousRoute.revenueLedger, cursor.launch.revenueLedger));
  const base = { address: route.activeCurve, abi: lifecycleCurveAbi, blockNumber: height - 1n } as const;
  const [sold, backing, accrued] = await Promise.all([
    rpc.readContract({ ...base, functionName: "sold" }), rpc.readContract({ ...base, functionName: "backingReserve" }),
    rpc.readContract({ address: cursor.launch.revenueLedger, abi: accruedAbi, functionName: "totalAccrued", blockNumber: height - 1n }),
  ]);
  assertFixtureCanonicalCurveStart({ sold, backing });
  // This temporary cursor never becomes a registration, trade row or lifecycle
  // state. Its current address was proven through the registry and runtime
  // history above. Only the verified engine graduation receipt is persisted.
  const temporary: FixturePostCursor = { launch: { ...cursor.launch, initialCurve: route.activeCurve }, grossFees: accrued };
  const result = await indexFixtureCurveTransaction(rpc, graduation, temporary, transaction, at, index, { sold, backing });
  requireSuccessor(result.graduation);
  await verifyFixtureV4Position(rpc, graduation, cursor.launch.token, result.graduation, height);
  const canonical = blockEvidence(await rpc.getBlock({ blockNumber: height }), height);
  requireSuccessor(same(canonical.blockHash, at.blockHash));
  cursor.graduation = result.graduation;
  return { token: cursor.launch.token, evidence: result.graduation };
}

/** Independently reconcile all known-project engine graduations in this bounded
 * range. An unsupported execution envelope stays unavailable, not unindexed. */
export async function verifyFixtureGraduationCoverage(rpc: PublicClient, binding: FixtureGraduationBinding,
  cursors: FixturePostCursor[], blocks: BlockEvidence[], graduations: { token: string; evidence: FixtureGraduation }[]) {
  if (!cursors.length) return;
  const topic = toEventSelector(fixtureGraduationAbi.find(item => item.type === "event")!);
  const logs = await rpc.request({ method: "eth_getLogs", params: [{ address: binding.graduationEngine,
    fromBlock: toHex(BigInt(blocks[0]!.blockNumber)), toBlock: toHex(BigInt(blocks.at(-1)!.blockNumber)),
    topics: [topic, cursors.map(cursor => toHex(BigInt(cursor.launch.token), { size: 32 }))] }] });
  requireSuccessor(Array.isArray(logs) && logs.length <= 128);
  const expected = new Map(graduations.map(row => [`${row.evidence.transactionHash.toLowerCase()}:${row.evidence.logIndex}`, row]));
  requireSuccessor(expected.size === graduations.length);
  for (const log of logs) {
    requireSuccessor(log.removed === false && log.blockHash && log.blockNumber && log.logIndex !== null && log.transactionHash);
    const decoded = decodeEventLog({ abi: fixtureGraduationAbi, data: log.data, topics: log.topics });
    const key = `${log.transactionHash.toLowerCase()}:${Number(log.logIndex)}`;
    const row = expected.get(key);
    requireSuccessor(row && same(log.address, binding.graduationEngine) && same(row.token, decoded.args.token)
      && same(row.evidence.poolId, decoded.args.poolId) && row.evidence.positionTokenId === decoded.args.positionTokenId.toString()
      && row.evidence.blockNumber === BigInt(log.blockNumber).toString() && same(row.evidence.blockHash, log.blockHash as Hash));
    expected.delete(key);
  }
  requireSuccessor(expected.size === 0);
}
