import { erc20Abi, keccak256, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { curveFixedSupplyWei, curveGraduationSoldWei, type BlockEvidence, type CurveFixtureBinding,
  type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import type { FixtureGraduationBinding } from "./curve-fixture-lifecycle.js";

const factoryAbi = parseAbi(["function curveForToken(address) view returns(address)", "function originCurveForToken(address) view returns(address)"]);
const registryAbi = parseAbi([
  "function project(address) view returns(address factory,address curve,uint32 version,address engine,uint64 migrations)",
  "function originCurve(address) view returns(address)",
  "function migration(address,uint64) view returns(uint32 fromVersion,uint32 toVersion,address previousEngine,address nextEngine,bytes32 runtimeHash,uint64 effectiveBlock,uint48 effectiveAt)",
]);
const curveAbi = parseAbi([
  "function token() view returns(address)", "function factory() view returns(address)", "function projectRegistry() view returns(address)",
  "function creator() view returns(address)", "function treasury() view returns(address)", "function treasuryShareBps() view returns(uint16)",
  "function operatingRecipient() view returns(address)", "function futureReserveRecipient() view returns(address)",
  "function revenueLedger() view returns(address)", "function active() view returns(bool)", "function executionVersion() view returns(uint32)",
  "function executionEngine() view returns(address)", "function migrationCommitment() view returns(bytes32)",
  "function migrationSource() view returns(address)", "function migratedTo() view returns(address)",
  "function totalSupply() view returns(uint256)", "function graduationSold() view returns(uint256)",
  "function VIRTUAL_ETH() view returns(uint256)", "function GRADUATION_BACKING() view returns(uint256)",
  "function TRADE_FEE_BPS() view returns(uint256)", "function graduationEngine() view returns(address)",
]);
const ledgerAbi = parseAbi(["function curve() view returns(address)", "function activeCurve() view returns(address)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function requireRoute(ok: unknown): asserts ok { if (!ok) throw new Error("Fixture migrated registration route or immutable policy proof failed"); }

/** This only keeps original registration/earnings discovery available after a
 * verified V2/V3 migration. It does NOT certify successor trading/event coverage.
 * The strict V1 lifecycle validator is left unchanged and is not reused for an
 * unsupported successor. Every read is pinned to the same canonical block. */
export async function fixtureMigratedRegistration(rpc: PublicClient, binding: CurveFixtureBinding,
  graduation: FixtureGraduationBinding, launch: CurveLaunchRegistration, observed: BlockEvidence) {
  const blockNumber = BigInt(observed.blockNumber);
  const [current, project] = await Promise.all([
    rpc.readContract({ address: binding.factory, abi: factoryAbi, functionName: "curveForToken", args: [launch.token], blockNumber }),
    rpc.readContract({ address: binding.projectRegistry, abi: registryAbi, functionName: "project", args: [launch.token], blockNumber }),
  ]);
  if (same(current, launch.initialCurve) && project[2] === 1 && project[4] === 0n) return null;
  requireRoute((project[2] === 2 || project[2] === 3) && project[4] === BigInt(project[2] - 1)
    && same(project[0], binding.factory) && same(project[1], current) && same(project[3], current));
  const [factoryCode, registryCode, factoryOrigin, registryOrigin, originalCommitment, originalReserve, ledgerOrigin, ledgerActive] = await Promise.all([
    rpc.getCode({ address: binding.factory, blockNumber }), rpc.getCode({ address: binding.projectRegistry, blockNumber }),
    rpc.readContract({ address: binding.factory, abi: factoryAbi, functionName: "originCurveForToken", args: [launch.token], blockNumber }),
    rpc.readContract({ address: binding.projectRegistry, abi: registryAbi, functionName: "originCurve", args: [launch.token], blockNumber }),
    rpc.readContract({ address: launch.initialCurve, abi: curveAbi, functionName: "migrationCommitment", blockNumber }),
    rpc.readContract({ address: launch.initialCurve, abi: curveAbi, functionName: "futureReserveRecipient", blockNumber }),
    rpc.readContract({ address: launch.revenueLedger, abi: ledgerAbi, functionName: "curve", blockNumber }),
    rpc.readContract({ address: launch.revenueLedger, abi: ledgerAbi, functionName: "activeCurve", blockNumber }),
  ]);
  requireRoute(factoryCode && same(keccak256(factoryCode), binding.factoryRuntimeHash)
    && registryCode && same(keccak256(registryCode), binding.projectRegistryRuntimeHash)
    && same(factoryOrigin, launch.initialCurve) && same(registryOrigin, launch.initialCurve)
    && same(ledgerOrigin, launch.initialCurve) && same(ledgerActive, current));
  let previous: Address = launch.initialCurve;
  for (let index = 0n; index < project[4]; index++) {
    const entry = await rpc.readContract({ address: binding.projectRegistry, abi: registryAbi,
      functionName: "migration", args: [launch.token, index], blockNumber });
    requireRoute(entry[0] === Number(index + 1n) && entry[1] === Number(index + 2n)
      && same(entry[2], previous) && entry[5] <= blockNumber && entry[5] >= BigInt(launch.creation.blockNumber));
    const next = entry[3];
    const [code, source, destination, version, engine] = await Promise.all([
      rpc.getCode({ address: next, blockNumber }),
      rpc.readContract({ address: next, abi: curveAbi, functionName: "migrationSource", blockNumber }),
      rpc.readContract({ address: previous, abi: curveAbi, functionName: "migratedTo", blockNumber }),
      rpc.readContract({ address: next, abi: curveAbi, functionName: "executionVersion", blockNumber }),
      rpc.readContract({ address: next, abi: curveAbi, functionName: "executionEngine", blockNumber }),
    ]);
    requireRoute(code && code !== "0x" && same(keccak256(code), entry[4]) && same(source, previous)
      && same(destination, next) && version === entry[1] && same(engine, next));
    previous = next;
  }
  requireRoute(same(previous, current));
  const base = { address: current, abi: curveAbi, blockNumber } as const;
  const [asset, factory, registry, creator, treasury, share, operations, reserve, ledger, active, commitment,
    supply, soldThreshold, virtualEth, backingThreshold, feeBps, engine, tokenSupply] = await Promise.all([
    rpc.readContract({ ...base, functionName: "token" }), rpc.readContract({ ...base, functionName: "factory" }),
    rpc.readContract({ ...base, functionName: "projectRegistry" }), rpc.readContract({ ...base, functionName: "creator" }),
    rpc.readContract({ ...base, functionName: "treasury" }), rpc.readContract({ ...base, functionName: "treasuryShareBps" }),
    rpc.readContract({ ...base, functionName: "operatingRecipient" }), rpc.readContract({ ...base, functionName: "futureReserveRecipient" }),
    rpc.readContract({ ...base, functionName: "revenueLedger" }), rpc.readContract({ ...base, functionName: "active" }),
    rpc.readContract({ ...base, functionName: "migrationCommitment" }), rpc.readContract({ ...base, functionName: "totalSupply" }),
    rpc.readContract({ ...base, functionName: "graduationSold" }), rpc.readContract({ ...base, functionName: "VIRTUAL_ETH" }),
    rpc.readContract({ ...base, functionName: "GRADUATION_BACKING" }), rpc.readContract({ ...base, functionName: "TRADE_FEE_BPS" }),
    rpc.readContract({ ...base, functionName: "graduationEngine" }),
    rpc.readContract({ address: launch.token, abi: erc20Abi, functionName: "totalSupply", blockNumber }),
  ]);
  requireRoute(same(asset, launch.token) && same(factory, binding.factory) && same(registry, binding.projectRegistry)
    && same(creator, launch.creator) && same(treasury, launch.treasury ?? zeroAddress) && share === launch.treasuryShareBps
    && same(operations, binding.creationFeeRecipient) && same(reserve, originalReserve) && same(ledger, launch.revenueLedger)
    && active && same(commitment, originalCommitment) && supply === curveFixedSupplyWei && tokenSupply === supply
    && soldThreshold === curveGraduationSoldWei && virtualEth === 4n * 10n ** 18n && backingThreshold === 2n * 10n ** 18n
    && feeBps === 100n && same(engine, graduation.graduationEngine));
  return { activeCurve: current, version: project[2], migrations: project[4].toString(), revenueLedger: launch.revenueLedger,
    lifecycle: "unsupported-successor" as const };
}
