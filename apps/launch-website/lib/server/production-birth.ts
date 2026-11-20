import { getContractAddress, keccak256, parseAbi, type Hex } from "viem";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import type { EarningsRpc } from "./earnings-contracts";

export const productionBootstrap = Object.freeze({
  address: "0xb65380aE9A452813c4e6b0fF391cfE34faE676A5",
  sender: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
  nonce: 482,
  initcodeHash: "0xda021596047c40c0c35467e319385e87d95bd6781dbf407ec5cc7b8c3778c50a",
  runtimeHash: "0xa42587c77a2e9002be762c26229a150eca01d9076463f1cd93f608080ad0b400",
} as const);
const getters = parseAbi(["function factory() view returns(address)", "function graduationEngine() view returns(address)", "function initializationGuard() view returns(address)"]);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
function must(value: unknown): asserts value { if (!value) throw Error("Canonical one-shot production birth proof unavailable"); }
const code = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:[0-9a-f]{2}){1,24576}$/i.test(value);

/** Only the typed, exact pruned-state error selects the alternative witness.
 * Empty/wrong code, outages, authentication and rate limits remain failures. */
export function isPrunedProductionBirthState(error: unknown) {
  let matched = false;
  for (let depth = 0; depth < 6 && error && typeof error === "object"; depth++) {
    const e = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown; cause?: unknown };
    const strings = [e.message, e.details].filter((value): value is string => typeof value === "string" && value.length <= 16_384);
    if (e.status !== undefined || strings.some(value => /(?:HTTP|Status:)[^\n]{0,16}\b(?:401|403|404|429|5\d\d)\b/i.test(value))) return false;
    if (e.code === -32000 && strings.some(value => /^historical state (?:0x)?[a-f0-9]{64} is not available$/i.test(value))) matched = true;
    error = e.cause;
  }
  return matched;
}

/** Exact successful direct-CREATE constructor proof. Its immutable code creates
 * guard/engine/factory atomically and asserts CREATE nonces 2/3. Static archived
 * code or explorer assertions alone never replace this canonical chain witness.
 * Each of the two production providers runs this verification independently. */
export async function proveProductionFactoryBirth(rpc: EarningsRpc, checkpoint: bigint): Promise<Hex> {
  const d = curveProductionDeployment, pins = curveProductionPins;
  must(checkpoint >= d.blockNumber);
  const [chain, transaction, receipt, block, anchor, bootstrapCode, factoryCode, engineCode, guardCode, bindings] = await Promise.all([
    rpc.getChainId(), rpc.getTransaction({ hash: d.transactionHash }), rpc.getTransactionReceipt({ hash: d.transactionHash }),
    rpc.getBlock({ blockNumber: d.blockNumber }), rpc.getBlock({ blockNumber: checkpoint }),
    rpc.getCode({ address: productionBootstrap.address, blockNumber: checkpoint }),
    rpc.getCode({ address: pins.factory[0], blockNumber: checkpoint }), rpc.getCode({ address: pins.engine[0], blockNumber: checkpoint }),
    rpc.getCode({ address: pins.guard[0], blockNumber: checkpoint }),
    Promise.all((["factory", "graduationEngine", "initializationGuard"] as const).map(functionName => rpc.readContract({
      address: productionBootstrap.address, abi: getters, functionName, blockNumber: checkpoint,
    }))),
  ]);
  must(chain === 4663 && transaction.chainId === 4663 && transaction.to === null && transaction.value === 0n
    && transaction.nonce === productionBootstrap.nonce && same(transaction.from, productionBootstrap.sender)
    && same(transaction.hash, d.transactionHash) && typeof transaction.input === "string" && transaction.input.length <= 131_074
    && /^0x(?:[0-9a-f]{2})+$/i.test(transaction.input) && same(keccak256(transaction.input), productionBootstrap.initcodeHash)
    && transaction.blockNumber === d.blockNumber && same(transaction.blockHash, d.blockHash)
    && Number.isSafeInteger(transaction.transactionIndex) && transaction.transactionIndex! >= 0
    && receipt.status === "success" && same(receipt.transactionHash, d.transactionHash)
    && receipt.blockNumber === d.blockNumber && same(receipt.blockHash, d.blockHash) && receipt.transactionIndex === transaction.transactionIndex
    && same(receipt.contractAddress, productionBootstrap.address) && block.number === d.blockNumber && same(block.hash, d.blockHash)
    && same(block.transactions[receipt.transactionIndex], d.transactionHash)
    && same(getContractAddress({ from: productionBootstrap.sender, nonce: BigInt(productionBootstrap.nonce) }), productionBootstrap.address)
    && same(getContractAddress({ from: productionBootstrap.address, nonce: 2n }), pins.engine[0])
    && same(getContractAddress({ from: productionBootstrap.address, nonce: 3n }), pins.factory[0])
    && code(bootstrapCode) && same(keccak256(bootstrapCode), productionBootstrap.runtimeHash)
    && code(factoryCode) && same(keccak256(factoryCode), pins.factory[1])
    && code(engineCode) && same(keccak256(engineCode), pins.engine[1]) && code(guardCode) && same(keccak256(guardCode), pins.guard[1])
    && bindings.every((binding, index) => same(binding, [pins.factory[0], pins.engine[0], pins.guard[0]][index]))
    && anchor.number === checkpoint && anchor.hash);
  const [again, anchorAgain] = await Promise.all([rpc.getBlock({ blockNumber: d.blockNumber }), rpc.getBlock({ blockNumber: checkpoint })]);
  must(same(again.hash, d.blockHash) && same(anchorAgain.hash, anchor.hash!));
  return factoryCode;
}

export async function readProductionFactoryBirthCode(rpc: EarningsRpc, checkpoint: bigint) {
  try { return await rpc.getCode({ address: curveProductionPins.factory[0], blockNumber: curveProductionDeployment.blockNumber }); }
  catch (error) {
    if (!isPrunedProductionBirthState(error)) throw error;
    return proveProductionFactoryBirth(rpc, checkpoint);
  }
}
