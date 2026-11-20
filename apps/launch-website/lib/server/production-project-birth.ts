import { decodeFunctionData, encodeAbiParameters, getContractAddress, getCreate2Address, keccak256, parseAbi, parseEventLogs,
  zeroAddress, type Address, type Hex } from "viem";
import templates from "./production-project-templates.json";
import { testCreationSignature } from "../test-creation";
import { launchTokenSupplyWei } from "../launch-terms";
import { curveProductionDeployment as deployment, curveProductionPins as pins } from "./curve-production";
import { isPrunedProductionBirthState, proveProductionFactoryBirth } from "./production-birth";
import type { EarningsReadContext, EarningsRegistration, EarningsRpc } from "./earnings-contracts";

const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
function must(value: unknown): asserts value { if (!value) throw Error("Canonical production project birth proof unavailable"); }
const creationAbi = parseAbi([testCreationSignature,
  "event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)",
  "event CreationFeePaid(address indexed token,address indexed creator,address indexed recipient,uint256 fee,uint256 refund)"]);
const code = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:[0-9a-f]{2}){1,24576}$/i.test(value);
export type ProductionProjectPolicy = { curve: Address; creator: Address; treasury: Address; treasuryShareBps: number;
  operatingRecipient: Address; futureReserveRecipient: Address };
export type ProductionProjectBirthRead = { pruned: boolean; code: Hex | undefined };

/** Does not substitute current/static code. Only an exact typed archive miss
 * selects the later canonical constructor+runtime proof. Wrong/empty replies
 * and every other error keep their original failure semantics. */
export async function readProductionProjectBirthCode(rpc: EarningsRpc, address: Address, birthBlock: bigint): Promise<ProductionProjectBirthRead> {
  try { return { pruned: false, code: await rpc.getCode({ address, blockNumber: birthBlock }) }; }
  catch (error) { if (!isPrunedProductionBirthState(error)) throw error; return { pruned: true, code: undefined }; }
}

export function materializeProductionProjectRuntimes(policy: ProductionProjectPolicy) {
  must(templates.schemaVersion === 1 && templates.chainId === 4663 && templates.compilerInputSha256 === deployment.compilerInputSha256);
  must(Number.isInteger(policy.treasuryShareBps) && policy.treasuryShareBps >= 0 && policy.treasuryShareBps <= 9000);
  const ledger = templates.templates.RMTLaunchCurveRevenueLedgerV1;
  const runtime = Buffer.from(ledger.runtime.slice(2), "hex"), occupied = new Set<number>();
  for (const [name, ranges] of Object.entries(ledger.immutableOffsets)) {
    const value = name === "treasuryShareBps" ? BigInt(policy.treasuryShareBps) : BigInt(policy[name as keyof Omit<ProductionProjectPolicy, "treasuryShareBps">]);
    must(value >= 0n && value < (1n << 256n));
    const word = Buffer.from(value.toString(16).padStart(64, "0"), "hex");
    for (const range of ranges) {
      must(range.length === 32 && range.start >= 0 && range.start + range.length <= runtime.length);
      for (let i = range.start; i < range.start + range.length; i++) { must(!occupied.has(i) && runtime[i] === 0); occupied.add(i); }
      word.copy(runtime, range.start);
    }
  }
  return { token: templates.templates.RMTLaunchCurveTokenV2.runtime as Hex, ledger: `0x${runtime.toString("hex")}` as Hex };
}
export function verifyProductionProjectRuntimes(tokenCode: unknown, ledgerCode: unknown, policy: ProductionProjectPolicy) {
  const expected = materializeProductionProjectRuntimes(policy);
  must(code(tokenCode) && code(ledgerCode) && same(tokenCode, expected.token) && same(ledgerCode, expected.ledger));
}

/** Production V2 direct factory creation only. Exact source/runtime and
 * constructor witnesses prove old immutable token/ledger birth without an
 * archive-code read. This never admits a successor or arbitrary template. */
export async function proveProductionProjectBirth(context: EarningsReadContext, registration: EarningsRegistration,
  tokenCode: Hex, ledgerCode: Hex, policy: ProductionProjectPolicy) {
  must(context.chainId === 4663 && same(context.factory, pins.factory[0]) && same(context.registry, pins.registry[0])
    && context.deploymentBlock === deployment.blockNumber && same(context.deploymentBlockHash, deployment.blockHash));
  const checkpoint = BigInt(context.checkpoint.blockNumber), born = BigInt(registration.creation.blockNumber);
  must(born >= deployment.blockNumber && checkpoint >= born + 20n);
  const [transaction, receipt, block] = await Promise.all([
    context.rpc.getTransaction({ hash: registration.creation.transactionHash }),
    context.rpc.getTransactionReceipt({ hash: registration.creation.transactionHash }),
    context.rpc.getBlock({ blockNumber: born }), proveProductionFactoryBirth(context.rpc, checkpoint),
  ]);
  must(transaction.chainId === 4663 && same(transaction.to, pins.factory[0]) && same(transaction.from, registration.creator)
    && same(transaction.hash, registration.creation.transactionHash) && transaction.blockNumber === born
    && same(transaction.blockHash, registration.creation.blockHash) && Number.isSafeInteger(transaction.nonce) && transaction.nonce >= 0
    && transaction.value >= deployment.creationFeeWei && typeof transaction.input === "string" && transaction.input.length <= 16_386
    && Number.isSafeInteger(transaction.transactionIndex) && transaction.transactionIndex! >= 0
    && receipt.status === "success" && same(receipt.transactionHash, transaction.hash) && receipt.blockNumber === born
    && same(receipt.blockHash, registration.creation.blockHash) && receipt.transactionIndex === transaction.transactionIndex
    && same(receipt.from, transaction.from) && same(receipt.to, pins.factory[0])
    && block.number === born && same(block.hash, registration.creation.blockHash)
    && same(block.transactions[receipt.transactionIndex], transaction.hash) && receipt.logs.length <= 128);
  must(new Set(receipt.logs.map(log => log.logIndex)).size === receipt.logs.length && receipt.logs.every(log => !log.removed
    && log.logIndex !== null && log.logIndex >= 0 && log.blockNumber === born && same(log.blockHash, receipt.blockHash)
    && same(log.transactionHash, transaction.hash) && log.transactionIndex === receipt.transactionIndex && log.data.length <= 8194));
  const events = parseEventLogs({ abi: creationAbi, eventName: "CurveCreated", strict: true,
    logs: receipt.logs.filter(log => same(log.address, pins.factory[0]) && log.logIndex === registration.creation.logIndex) });
  const fees = parseEventLogs({ abi: creationAbi, eventName: "CreationFeePaid", strict: true,
    logs: receipt.logs.filter(log => same(log.address, pins.factory[0])) });
  must(events.length === 1 && fees.length === 1);
  const event = events[0].args, fee = fees[0].args, decoded = decodeFunctionData({ abi: creationAbi, data: transaction.input });
  must(decoded.functionName === "create");
  const [name, symbol, projectURI, treasury, share, intentId, deadline] = decoded.args;
  must(same(event.token, registration.token) && same(event.curve, registration.initialCurve) && same(event.creator, registration.creator)
    && same(event.revenueLedger, registration.revenueLedger) && event.supply === launchTokenSupplyWei
    && same(event.treasury, registration.treasury ?? zeroAddress) && event.treasuryShareBps === registration.treasuryShareBps
    && event.name === name && event.symbol === symbol && event.projectURI === projectURI && same(event.treasury, treasury)
    && event.treasuryShareBps === share && same(event.intentId, intentId) && deadline >= block.timestamp
    && same(fee.token, event.token) && same(fee.creator, event.creator) && same(fee.recipient, deployment.operating)
    && fee.fee === deployment.creationFeeWei && fee.refund === transaction.value - deployment.creationFeeWei);
  const salt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [event.creator, intentId]));
  const bytecode = `${templates.templates.RMTLaunchCurveTokenV2.creationBytecode}${encodeAbiParameters([{ type: "string" }, { type: "string" }], [name, symbol]).slice(2)}` as Hex;
  must(same(getCreate2Address({ from: pins.factory[0], salt, bytecode }), registration.token)
    && same(getContractAddress({ from: event.curve, nonce: 1n }), registration.revenueLedger)
    && same(policy.curve, event.curve) && same(policy.creator, event.creator) && same(policy.treasury, event.treasury)
    && policy.treasuryShareBps === event.treasuryShareBps && same(policy.operatingRecipient, deployment.operating)
    && same(policy.futureReserveRecipient, deployment.reserve));
  verifyProductionProjectRuntimes(tokenCode, ledgerCode, policy);
  const [again, anchor] = await Promise.all([context.rpc.getBlock({ blockNumber: born }), context.rpc.getBlock({ blockNumber: checkpoint })]);
  must(same(again.hash, registration.creation.blockHash) && same(anchor.hash, context.checkpoint.blockHash));
}
