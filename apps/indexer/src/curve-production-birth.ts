import assert from "node:assert/strict";
import { getContractAddress, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { CurveProductionConfig } from "./curve-production-config.js";

export const indexerBirthPins = {
  factory: ["0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3", "0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091"],
  registry: ["0xf1113714Dda31f31532995D2525e034271425398", "0xd1b4756bcdabb6a8ee04c827b5a6a76079bedc996df39b76dffa24269a61f644"],
  engine: ["0x10e540536F10ed36E5fC6638638f1d862e552D32", "0x24f5b57ef0091e5830747efee6b8372abebe61226dbaadeb04860a4461ede849"],
  guard: ["0x998F3C0CE20cFF92655D495a159B1Ca37c162000", "0xdb92a74276834e63bf191ffe23ae5925f8cd4aaac9b1aa6cf872ae8f55c38a3e"],
  bootstrap: ["0xb65380aE9A452813c4e6b0fF391cfE34faE676A5", "0xa42587c77a2e9002be762c26229a150eca01d9076463f1cd93f608080ad0b400"],
} as const satisfies Record<string, readonly [Address, Hex]>;
export const indexerBirthDeployment = {
  blockNumber: 116835102n, blockHash: "0x4a72961fb6649c1690fe4cf361ae6a6fbbdab39117a85604e2a11ba4646c7639",
  transactionHash: "0x9c9b3fe869b9fa8ee41684630a7e9807c07362a768b9a5c3b2b362db1498f73a",
  initcodeHash: "0xda021596047c40c0c35467e319385e87d95bd6781dbf407ec5cc7b8c3778c50a", nonce: 482,
  sender: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA", operating: "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b", reserve: "0x8D44078642ce938Fd799b23087BcdD6114A302e5",
  registry: { transactionHash: "0xcc977ec3b176718fd90481c4fff0938416e32502ef9a55faebe88d11b24374b0", nonce: 479,
    blockNumber: 116817979n, blockHash: "0x0329b6056601cc541cbe35e2102854cfe90994a68cb8a082e1482d8c83e81ace", initcodeHash: "0xb8521e681298045055d5cd3d05f526248b9cfca71ef808733faa32a228940c1d" },
} as const;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const getters = parseAbi(["function factory() view returns(address)", "function graduationEngine() view returns(address)", "function initializationGuard() view returns(address)"]);
const factoryGetters = parseAbi(["function engineVersion() view returns(uint32)", "function projectRegistry() view returns(address)", "function creationFeeWei() view returns(uint256)",
  "function operatingRecipient() view returns(address)", "function futureReserveRecipient() view returns(address)", "function tokenSupply() view returns(uint256)"]);
export function isPrunedIndexerBirthState(error: unknown) {
  let matched = false;
  for (let depth = 0; depth < 6 && error && typeof error === "object"; depth++) {
    const e = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown; cause?: unknown };
    const strings = [e.message, e.details].filter((value): value is string => typeof value === "string" && value.length <= 16384);
    if (e.status !== undefined || strings.some(value => /(?:HTTP|Status:)[^\n]{0,16}\b(?:401|403|404|429|5\d\d)\b/i.test(value))) return false;
    if (e.code === -32000 && strings.some(value => /^historical state (?:0x)?[a-f0-9]{64} is not available$/i.test(value))) matched = true;
    error = e.cause;
  }
  return matched;
}
export function matchesIndexerBirth(config: CurveProductionConfig) {
  const b = config.binding, p = indexerBirthPins, d = indexerBirthDeployment;
  return b.chainId === 4663 && b.engineVersion === 1 && same(b.factory, p.factory[0]) && same(b.factoryRuntimeHash, p.factory[1])
    && same(b.projectRegistry, p.registry[0]) && same(b.projectRegistryRuntimeHash, p.registry[1]) && b.deploymentBlock === d.blockNumber
    && same(b.deploymentBlockHash, d.blockHash) && same(config.deploymentTransactionHash, d.transactionHash)
    && same(b.creationFeeRecipient, d.operating) && same(config.reserveRecipient, d.reserve) && b.creationFeeWei === 400000000000000n;
}
async function directCreate(rpc: PublicClient, expected: { transactionHash: Hex; blockNumber: bigint; blockHash: Hex; nonce: number; initcodeHash: Hex }, address: Address) {
  const [tx, receipt, block] = await Promise.all([rpc.getTransaction({ hash: expected.transactionHash }), rpc.getTransactionReceipt({ hash: expected.transactionHash }),
    rpc.getBlock({ blockNumber: expected.blockNumber, includeTransactions: false })]);
  assert.ok(tx.chainId === 4663 && tx.to === null && tx.value === 0n && tx.nonce === expected.nonce && same(tx.from, indexerBirthDeployment.sender)
    && same(tx.hash, expected.transactionHash) && /^0x(?:[0-9a-f]{2}){1,65536}$/i.test(tx.input) && same(keccak256(tx.input), expected.initcodeHash)
    && tx.blockNumber === expected.blockNumber && same(tx.blockHash, expected.blockHash) && Number.isSafeInteger(tx.transactionIndex) && tx.transactionIndex! >= 0
    && receipt.status === "success" && same(receipt.transactionHash, expected.transactionHash) && receipt.blockNumber === expected.blockNumber
    && same(receipt.blockHash, expected.blockHash) && receipt.transactionIndex === tx.transactionIndex && same(receipt.contractAddress, address)
    && block.number === expected.blockNumber && same(block.hash, expected.blockHash) && same(block.transactions[receipt.transactionIndex], expected.transactionHash)
    && same(getContractAddress({ from: indexerBirthDeployment.sender, nonce: BigInt(expected.nonce) }), address), "Canonical direct-CREATE birth identity mismatch");
  return block;
}
/** No archive bytes stand in for a missing observation. Exact canonical
 * successful original CREATEs plus immutable current code prove these births. */
export async function proveIndexerProductionBirth(config: CurveProductionConfig, rpc: PublicClient, checkpoint: bigint) {
  assert.ok(matchesIndexerBirth(config), "Indexer alternative birth proof requires the exact original production binding");
  const p = indexerBirthPins, d = indexerBirthDeployment;
  assert.ok(checkpoint >= d.blockNumber);
  const [chainId, , , anchor, codes, bindings, values] = await Promise.all([
    rpc.getChainId(), directCreate(rpc, d, p.bootstrap[0]), directCreate(rpc, d.registry, p.registry[0]),
    rpc.getBlock({ blockNumber: checkpoint, includeTransactions: false }),
    Promise.all(Object.values(p).map(([address]) => rpc.getCode({ address, blockNumber: checkpoint }))),
    Promise.all((["factory", "graduationEngine", "initializationGuard"] as const).map(functionName => rpc.readContract({ address: p.bootstrap[0], abi: getters, functionName, blockNumber: checkpoint }))),
    Promise.all(factoryGetters.map(item => rpc.readContract({ address: p.factory[0], abi: factoryGetters, functionName: item.name, blockNumber: checkpoint }))),
  ]);
  assert.equal(chainId, 4663);
  Object.values(p).forEach(([, digest], index) => assert.ok(codes[index] && same(keccak256(codes[index]!), digest), "Canonical birth current runtime mismatch"));
  assert.deepEqual(bindings.map(value => value.toLowerCase()), [p.factory[0], p.engine[0], p.guard[0]].map(value => value.toLowerCase()));
  assert.deepEqual(values.map(String).map(value => value.toLowerCase()), ["1", p.registry[0], "400000000000000", d.operating, d.reserve, (10n ** 27n).toString()].map(value => value.toLowerCase()));
  assert.ok(same(getContractAddress({ from: p.bootstrap[0], nonce: 2n }), p.engine[0]) && same(getContractAddress({ from: p.bootstrap[0], nonce: 3n }), p.factory[0])
    && anchor.number === checkpoint && anchor.hash);
  const [again, registryAgain, anchorAgain] = await Promise.all([rpc.getBlock({ blockNumber: d.blockNumber }), rpc.getBlock({ blockNumber: d.registry.blockNumber }), rpc.getBlock({ blockNumber: checkpoint })]);
  assert.ok(same(again.hash, d.blockHash) && same(registryAgain.hash, d.registry.blockHash) && same(anchorAgain.hash, anchor.hash));
  return { factory: codes[0]!, registry: codes[1]!, immutableValues: Object.fromEntries(factoryGetters.map((item, index) => [item.name, values[index]])) };
}

/** Preserve every normal return/error. Only typed pruned queries at this one
 * original birth select a proven equivalent; no arbitrary old block changes. */
export function productionCurveBirthRpc(config: CurveProductionConfig, rpc: PublicClient, checkpoint: bigint): PublicClient {
  let proof: ReturnType<typeof proveIndexerProductionBirth> | undefined;
  const proven = () => proof ??= proveIndexerProductionBirth(config, rpc, checkpoint);
  return new Proxy(rpc, { get(target, property) {
    if (property === "getCode") return async (args: Parameters<PublicClient["getCode"]>[0]) => {
      try { return await target.getCode(args); } catch (error) {
        if (!isPrunedIndexerBirthState(error)) throw error;
        const d = config.binding.deploymentBlock, at = args.blockNumber;
        if (same(args.address, config.binding.factory) && (at === d || at === d - 1n)) return at === d ? (await proven()).factory : (await proven(), "0x");
        if (same(args.address, config.binding.projectRegistry) && at === d) return (await proven()).registry;
        throw error;
      }
    };
    if (property === "readContract") return async (args: Parameters<PublicClient["readContract"]>[0]) => {
      try { return await target.readContract(args); } catch (error) {
        if (!isPrunedIndexerBirthState(error) || args.blockNumber !== config.binding.deploymentBlock || !same(args.address, config.binding.factory)
          || !factoryGetters.some(item => item.name === args.functionName) || args.args?.length) throw error;
        return (await proven()).immutableValues[args.functionName];
      }
    };
    return Reflect.get(target, property);
  } });
}
