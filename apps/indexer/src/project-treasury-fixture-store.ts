import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Client } from "pg";
import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, parseEventLogs, zeroAddress,
  type Address, type Hash, type Hex, type PublicClient } from "viem";
import { materializeProjectTreasuryRuntime, projectTreasuryFactorySignatures, projectTreasurySignatures }
  from "../../../packages/launchpad-common/project-treasury-runtime.mjs";
import { assertIndexWriterLease } from "./index-store.js";
import type { BlockEvidence, CurveFixtureBinding } from "./curve-launch-evidence.js";
import type { FixtureGraduationBinding } from "./curve-fixture-lifecycle.js";
import type { FixtureProjectTreasuryAdmission } from "./curve-fixture-project-treasury-call.js";

const profile = "rmt-project-treasury-v1";
const factoryAbi = parseAbi(projectTreasuryFactorySignatures), treasuryAbi = parseAbi(projectTreasurySignatures);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const addr = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && BigInt(v) > 0xffffn;
const hash = (v: unknown): v is Hash => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v) && BigInt(v) > 0n;
const stringify = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);
function requireEvidence(ok: unknown): asserts ok { if (!ok) throw Error("Fixture project treasury evidence unavailable or conflicting"); }

export type FixtureTreasuryProofLog = {
  address: Address; topics: readonly Hex[]; data: Hex; blockNumber: bigint | null; blockHash: Hash | null;
  transactionHash: Hash | null; transactionIndex: number | null; logIndex: number | null; removed: boolean;
};
type TreasuryProofReceipt = { status: "success" | "reverted"; transactionHash: Hash; blockNumber: bigint; blockHash: Hash;
  transactionIndex: number; logs: readonly FixtureTreasuryProofLog[] };
type TreasuryProofHeader = { number: bigint | null; hash: Hash | null; timestamp: bigint;
  transactions: readonly (Hash | { hash: Hash })[] };

/** A getLogs observation is not proof of inclusion. Bind the exact successful
 * receipt to its canonical header before admitting any individual event. */
export function assertFixtureTreasuryReceipt(receipt: TreasuryProofReceipt, header: TreasuryProofHeader,
  expected: BlockEvidence, transactionHash: Hash) {
  const height = BigInt(expected.blockNumber), member = header.transactions[receipt.transactionIndex];
  requireEvidence(header.number === height && header.hash && same(header.hash, expected.blockHash)
    && new Date(Number(header.timestamp) * 1000).toISOString() === expected.timestamp
    && receipt.status === "success" && same(receipt.transactionHash, transactionHash) && receipt.blockNumber === height
    && same(receipt.blockHash, expected.blockHash) && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0
    && member && same(typeof member === "string" ? member : member.hash, transactionHash)
    && receipt.logs.length <= 128 && new Set(receipt.logs.map(l => l.logIndex)).size === receipt.logs.length);
  for (const log of receipt.logs) requireEvidence(log.removed === false && log.blockNumber === height && log.blockHash && same(log.blockHash, expected.blockHash)
    && log.transactionHash && same(log.transactionHash, transactionHash) && log.transactionIndex === receipt.transactionIndex
    && Number.isSafeInteger(log.logIndex) && log.logIndex !== null && log.logIndex >= 0
    && /^0x(?:[0-9a-f]{2}){0,65536}$/i.test(log.data) && log.topics.length <= 4 && log.topics.every(t => /^0x[0-9a-f]{64}$/i.test(t)));
}

export function assertFixtureTreasuryReceiptLog(receipt: TreasuryProofReceipt, header: TreasuryProofHeader,
  expected: BlockEvidence, observed: FixtureTreasuryProofLog) {
  requireEvidence(observed.transactionHash && observed.blockNumber === BigInt(expected.blockNumber) && observed.blockHash
    && same(observed.blockHash, expected.blockHash) && observed.removed === false);
  assertFixtureTreasuryReceipt(receipt, header, expected, observed.transactionHash);
  const actual = receipt.logs.find(log => log.logIndex === observed.logIndex);
  requireEvidence(actual && same(actual.address, observed.address) && same(actual.data, observed.data)
    && actual.transactionIndex === observed.transactionIndex && actual.topics.length === observed.topics.length
    && actual.topics.every((topic, index) => same(topic, observed.topics[index]!)));
}
type Db = Pick<Client, "query">;
type Scope = [number, string, string];
export type FixtureTreasuryModule = {
  schemaVersion: 1; profile: typeof profile; chainId: 31337; treasuryFactory: Address; factoryRuntimeHash: Hash;
  coreFactory: Address; coreFactoryRuntimeHash: Hash; graduationEngine: Address; graduationRuntimeHash: Hash; tokenRuntimeHash: Hash;
  treasuryCreationCode: Hex; treasuryCreationCodeHash: Hash; treasuryRuntimeTemplate: Hex;
  treasuryImmutableReferences: Record<string, { start: number; length: number }[]>; treasuryImmutableNames: Record<string, string>;
  deployment: { transactionHash: Hash; blockNumber: string; blockHash: Hash }; compilerInputSha256: string;
};
export type FixtureTreasuryBirth = {
  treasury: Address; creator: Address; controller: Address; intentId: Hash; treasuryShareBps: number; runtimeHash: Hash;
  deployment: BlockEvidence & { transactionHash: Hash; logIndex: number };
};
export type FixtureTreasuryEvent = BlockEvidence & { event: string; treasury: Address; transactionHash: Hash; logIndex: number;
  args: Record<string, unknown>; asset?: Address; amountWei?: string; source?: string };
export const projectTreasuryFixtureTables = ["rmt_project_treasury_fixture_binding", "rmt_project_treasury_fixture_births", "rmt_project_treasury_fixture_events"] as const;
export function configuredFixtureTreasuryModule(env: NodeJS.ProcessEnv, binding: CurveFixtureBinding, graduation: FixtureGraduationBinding): FixtureTreasuryModule | null {
  if (!env.RMT_PROJECT_TREASURY_FIXTURE && !env.RMT_PROJECT_TREASURY_DEPLOYMENT) return null;
  if (env.RMT_PROJECT_TREASURY_FIXTURE !== "local-reviewed-project-treasury-v1" || env.NETLIFY || env.RAILWAY_ENVIRONMENT_ID || env.VERCEL) {
    throw Error("Fixture project treasury profile is disabled or hosted");
  }
  const file = env.RMT_PROJECT_TREASURY_DEPLOYMENT;
  requireEvidence(file && isAbsolute(file) && statSync(file).size <= 160_000);
  const m = JSON.parse(readFileSync(file!, "utf8")) as FixtureTreasuryModule;
  requireEvidence(m.schemaVersion === 1 && m.profile === profile && m.chainId === 31337
    && [m.treasuryFactory, m.coreFactory, m.graduationEngine].every(addr)
    && [m.factoryRuntimeHash, m.coreFactoryRuntimeHash, m.graduationRuntimeHash, m.tokenRuntimeHash, m.deployment.transactionHash, m.deployment.blockHash, m.treasuryCreationCodeHash].every(hash)
    && same(m.coreFactory, binding.factory) && same(m.coreFactoryRuntimeHash, binding.factoryRuntimeHash)
    && same(m.graduationEngine, graduation.graduationEngine) && same(m.graduationRuntimeHash, graduation.graduationHash)
    && /^[1-9][0-9]{0,15}$/.test(m.deployment.blockNumber) && BigInt(m.deployment.blockNumber) >= binding.deploymentBlock
    && /^[0-9a-f]{64}$/.test(m.compilerInputSha256) && /^0x(?:[0-9a-f]{2}){1,32768}$/i.test(m.treasuryCreationCode)
    && same(keccak256(m.treasuryCreationCode), m.treasuryCreationCodeHash));
  materializeProjectTreasuryRuntime(m.treasuryRuntimeTemplate, m.treasuryImmutableReferences, m.treasuryImmutableNames,
    { creator: m.coreFactory, deploymentFactory: m.treasuryFactory, intentId: m.deployment.transactionHash, treasuryShareBps: 0, deploymentChainId: 31337 });
  return m;
}
async function read<T>(rpc: PublicClient, target: Address, factory: boolean, name: string, args: readonly unknown[], height: bigint): Promise<T> {
  return rpc.readContract({ address: target, abi: factory ? factoryAbi : treasuryAbi, functionName: name, args, blockNumber: height } as never) as Promise<T>;
}
export async function verifyFixtureTreasuryModule(rpc: PublicClient, m: FixtureTreasuryModule) {
  const height = BigInt(m.deployment.blockNumber);
  const [chain, code, receipt, block, pins, codeHash] = await Promise.all([
    rpc.getChainId(), rpc.getCode({ address: m.treasuryFactory, blockNumber: height }), rpc.getTransactionReceipt({ hash: m.deployment.transactionHash }),
    rpc.getBlock({ blockNumber: height }), read<readonly [Address, Hash, Address, Hash, Hash]>(rpc, m.treasuryFactory, true, "pins", [], height),
    read<Hash>(rpc, m.treasuryFactory, true, "treasuryCreationCodeHash", [], height),
  ]);
  assertFixtureTreasuryReceipt(receipt, block,
    { blockNumber: m.deployment.blockNumber, blockHash: m.deployment.blockHash, timestamp: new Date(Number(block.timestamp) * 1000).toISOString() }, m.deployment.transactionHash);
  requireEvidence(chain === 31337 && code && same(keccak256(code), m.factoryRuntimeHash) && receipt.status === "success"
    && receipt.to === null && same(receipt.contractAddress!, m.treasuryFactory) && same(receipt.blockHash, m.deployment.blockHash)
    && same(block.hash!, receipt.blockHash) && same(block.transactions[receipt.transactionIndex] as Hex, m.deployment.transactionHash)
    && same(pins[0], m.coreFactory) && same(pins[1], m.coreFactoryRuntimeHash) && same(pins[2], m.graduationEngine)
    && same(pins[3], m.graduationRuntimeHash) && same(pins[4], m.tokenRuntimeHash) && same(codeHash, m.treasuryCreationCodeHash));
}
export async function verifyFixtureTreasuryBirth(rpc: PublicClient, m: FixtureTreasuryModule, treasury: Address, at: BlockEvidence): Promise<FixtureTreasuryBirth> {
  const end = BigInt(at.blockNumber), from = BigInt(m.deployment.blockNumber);
  requireEvidence(end >= from && end - from <= 4096n);
  const logs = await rpc.getLogs({ address: m.treasuryFactory, events: factoryAbi.filter(e => e.type === "event"), fromBlock: from, toBlock: end });
  requireEvidence(logs.length <= 128);
  const matches = parseEventLogs({ abi: factoryAbi, eventName: "TreasuryCreated", logs, strict: true })
    .filter(log => same((log.args as { treasury: Address }).treasury, treasury));
  requireEvidence(matches.length === 1);
  const log = matches[0]!; const p = log.args as { creator: Address; intentId: Hash; controller: Address; treasuryShareBps: number };
  requireEvidence(log.blockNumber !== null && log.blockHash && log.transactionHash && log.logIndex !== null && !log.removed);
  const [code, creator, intent, share, deployedBy, initialized, pins, initialController, predicted, stored, tx, receipt, block, anchor] = await Promise.all([
    rpc.getCode({ address: treasury, blockNumber: end }), read<Address>(rpc, treasury, false, "creator", [], end),
    read<Hash>(rpc, treasury, false, "intentId", [], end), read<number>(rpc, treasury, false, "treasuryShareBps", [], end),
    read<Address>(rpc, treasury, false, "deploymentFactory", [], end), read<boolean>(rpc, treasury, false, "controllerInitialized", [], end),
    read<readonly [Address, Hash, Address, Hash, Hash]>(rpc, treasury, false, "pins", [], end), read<Address>(rpc, treasury, false, "controller", [], log.blockNumber),
    read<Address>(rpc, m.treasuryFactory, true, "predict", [p.creator, p.intentId, p.controller, p.treasuryShareBps, m.treasuryCreationCode], end),
    read<Address>(rpc, m.treasuryFactory, true, "treasuryForIntent", [p.creator, p.intentId], end),
    rpc.getTransaction({ hash: log.transactionHash }), rpc.getTransactionReceipt({ hash: log.transactionHash }),
    rpc.getBlock({ blockNumber: log.blockNumber }), rpc.getBlock({ blockNumber: end }),
  ]);
  const materialized = materializeProjectTreasuryRuntime(m.treasuryRuntimeTemplate, m.treasuryImmutableReferences, m.treasuryImmutableNames,
    { creator: p.creator, deploymentFactory: m.treasuryFactory, intentId: p.intentId, treasuryShareBps: p.treasuryShareBps, deploymentChainId: 31337 });
  assertFixtureTreasuryReceiptLog(receipt, block, { blockNumber: log.blockNumber.toString(), blockHash: log.blockHash,
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString() }, log);
  const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.input }); const args = decoded.args as readonly unknown[];
  requireEvidence(code && same(code, materialized) && same(creator, p.creator) && same(intent, p.intentId) && share === p.treasuryShareBps
    && same(deployedBy, m.treasuryFactory) && initialized && same(initialController, p.controller) && same(predicted, treasury) && same(stored, treasury)
    && same(pins[0], m.coreFactory) && same(pins[1], m.coreFactoryRuntimeHash) && same(pins[2], m.graduationEngine)
    && same(pins[3], m.graduationRuntimeHash) && same(pins[4], m.tokenRuntimeHash) && same(anchor.hash!, at.blockHash)
    && same(tx.to!, m.treasuryFactory) && same(tx.from, creator) && tx.chainId === 31337 && tx.value === 0n
    && same(tx.hash, log.transactionHash) && same(receipt.from, tx.from) && same(receipt.to!, tx.to!) && tx.blockNumber === log.blockNumber
    && decoded.functionName === "create" && same(String(args[0]), p.intentId) && same(String(args[1]), p.controller)
    && Number(args[2]) === share && same(String(args[3]), m.treasuryCreationCode)
    && same(tx.input, encodeFunctionData({ abi: factoryAbi, functionName: "create", args }))
    && receipt.status === "success" && same(receipt.blockHash, log.blockHash) && same(block.hash!, log.blockHash)
    && tx.transactionIndex === receipt.transactionIndex && same(tx.blockHash!, receipt.blockHash)
    && same(block.transactions[receipt.transactionIndex] as Hex, tx.hash));
  return { treasury, creator, controller: p.controller, intentId: intent, treasuryShareBps: share, runtimeHash: keccak256(code),
    deployment: { blockNumber: log.blockNumber.toString(), blockHash: log.blockHash, timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      transactionHash: log.transactionHash, logIndex: log.logIndex } };
}
export function projectTreasuryAdmission(rpc: PublicClient, module: FixtureTreasuryModule): FixtureProjectTreasuryAdmission {
  const cache = new Map<string, Promise<FixtureTreasuryBirth>>();
  return async (call, tx, block, cursor) => {
    try {
      const key = `${call.treasury.toLowerCase()}:${block.blockHash}`;
      if (cache.size >= 128) cache.clear();
      if (!cache.has(key)) cache.set(key, verifyFixtureTreasuryBirth(rpc, module, call.treasury, block));
      const birth = await cache.get(key)!;
      const controller = await read<Address>(rpc, call.treasury, false, "controller", [], BigInt(block.blockNumber));
      return same(controller, call.controller) && same(birth.creator, cursor.launch.creator) && same(birth.intentId, cursor.launch.intentId)
        && birth.treasuryShareBps === cursor.launch.treasuryShareBps && same(tx.to!, call.treasury) && same(tx.from, controller)
        // A Safe controller is admitted by the pinned Safe decoder/trace checks;
        // its CALL target, not the external owner's address, is the controller.
        || same(controller, call.controller) && same(birth.creator, cursor.launch.creator) && same(birth.intentId, cursor.launch.intentId)
          && birth.treasuryShareBps === cursor.launch.treasuryShareBps && same(tx.to!, controller);
    } catch { return false; }
  };
}
const predicate = "chain_id=$1 AND core_factory=$2 AND core_deployment_block_hash=$3 AND treasury_factory=$4";
const scopeArgs = (scope: Scope, m: FixtureTreasuryModule) => [...scope, m.treasuryFactory.toLowerCase()];
export async function initializeProjectTreasuryFixtureStore(db: Db, scope: Scope, module: FixtureTreasuryModule) {
  requireEvidence(scope[0] === 31337 && same(scope[1], module.coreFactory)); await assertIndexWriterLease(db, 31337);
  await db.query(`CREATE TABLE IF NOT EXISTS rmt_project_treasury_fixture_binding (
    treasury_factory text PRIMARY KEY, identity jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS rmt_project_treasury_fixture_births (
      chain_id integer NOT NULL CHECK(chain_id=31337), core_factory text NOT NULL, core_deployment_block_hash text NOT NULL,
      treasury_factory text NOT NULL REFERENCES rmt_project_treasury_fixture_binding(treasury_factory),
      treasury text NOT NULL, creator text NOT NULL, intent_id text NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL, payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,treasury_factory,treasury),
      UNIQUE(chain_id,core_factory,core_deployment_block_hash,treasury_factory,creator,intent_id),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
        REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS rmt_project_treasury_fixture_events (
      chain_id integer NOT NULL CHECK(chain_id=31337), core_factory text NOT NULL, core_deployment_block_hash text NOT NULL,
      treasury_factory text NOT NULL, treasury text NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
      transaction_hash text NOT NULL, log_index integer NOT NULL CHECK(log_index>=0), payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,treasury_factory,transaction_hash,log_index),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,treasury_factory,treasury)
        REFERENCES rmt_project_treasury_fixture_births(chain_id,core_factory,core_deployment_block_hash,treasury_factory,treasury) ON DELETE CASCADE,
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
        REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE)`);
  const identity = stringify({ ...module, scope });
  const stored = await db.query(`INSERT INTO rmt_project_treasury_fixture_binding(treasury_factory,identity) VALUES($1,$2)
    ON CONFLICT(treasury_factory) DO UPDATE SET identity=EXCLUDED.identity WHERE rmt_project_treasury_fixture_binding.identity=EXCLUDED.identity RETURNING treasury_factory`,
  [module.treasuryFactory.toLowerCase(), identity]);
  requireEvidence(stored.rowCount === 1);
}
export async function readProjectTreasuryFixtureRange(db: Db, scope: Scope, m: FixtureTreasuryModule, rpc: PublicClient, blocks: BlockEvidence[]) {
  requireEvidence(blocks.length > 0 && blocks.length <= 32);
  const from = BigInt(blocks[0]!.blockNumber), to = BigInt(blocks.at(-1)!.blockNumber);
  const existing = await db.query<{ payload: FixtureTreasuryBirth }>(`SELECT payload FROM rmt_project_treasury_fixture_births WHERE ${predicate} LIMIT 129`, scopeArgs(scope, m));
  requireEvidence(existing.rows.length <= 128);
  const factoryLogs = await rpc.getLogs({ address: m.treasuryFactory, events: factoryAbi.filter(e => e.type === "event"), fromBlock: from, toBlock: to });
  requireEvidence(factoryLogs.length <= 128);
  const creations = parseEventLogs({ abi: factoryAbi, eventName: "TreasuryCreated", logs: factoryLogs, strict: true });
  requireEvidence(creations.length === factoryLogs.length);
  const births: FixtureTreasuryBirth[] = [];
  for (const creation of creations) births.push(await verifyFixtureTreasuryBirth(rpc, m, (creation.args as { treasury: Address }).treasury, blocks.at(-1)!));
  const unique = new Map<string, FixtureTreasuryBirth>();
  for (const birth of [...existing.rows.map(r => r.payload), ...births]) {
    const key = birth.treasury.toLowerCase(), prior = unique.get(key);
    requireEvidence(!prior || stringify(prior) === stringify(birth)); unique.set(key, birth);
  }
  const all = [...unique.values()]; requireEvidence(all.length <= 128);
  const logs = all.length ? await rpc.getLogs({ address: all.map(b => b.treasury), fromBlock: from, toBlock: to }) : [];
  requireEvidence(logs.length <= 512);
  const events: FixtureTreasuryEvent[] = [];
  const receipts = new Map<string, ReturnType<PublicClient["getTransactionReceipt"]>>();
  const headers = new Map<string, ReturnType<PublicClient["getBlock"]>>();
  for (const log of logs) {
    requireEvidence(log.blockNumber !== null && log.blockHash && log.transactionHash && log.logIndex !== null && !log.removed);
    const block = blocks.find(b => b.blockNumber === log.blockNumber!.toString() && same(b.blockHash, log.blockHash!)); requireEvidence(block);
    const decoded = parseEventLogs({ abi: treasuryAbi, logs: [log], strict: true }); requireEvidence(decoded.length === 1);
    const key = log.transactionHash.toLowerCase(), height = log.blockNumber.toString();
    if (!receipts.has(key)) receipts.set(key, rpc.getTransactionReceipt({ hash: log.transactionHash }));
    if (!headers.has(height)) headers.set(height, rpc.getBlock({ blockNumber: log.blockNumber }));
    const event = decoded[0]!, [receipt, header] = await Promise.all([receipts.get(key)!, headers.get(height)!]);
    assertFixtureTreasuryReceiptLog(receipt, header, block!, log);
    const args = JSON.parse(stringify(event.args)) as Record<string, unknown>;
    events.push({ ...block!, event: event.eventName!, treasury: log.address, transactionHash: log.transactionHash, logIndex: log.logIndex,
      args, ...(addr(args.asset) || args.asset === zeroAddress ? { asset: args.asset as Address } : {}),
      ...(typeof args.amount === "string" ? { amountWei: args.amount } : {}), ...(typeof args.source === "string" ? { source: args.source } : {}) });
  }
  return { births, events };
}
/** Called inside the core writer's existing BEGIN/COMMIT range transaction. */
export async function commitProjectTreasuryFixtureRange(db: Db, scope: Scope, m: FixtureTreasuryModule, range: { births: FixtureTreasuryBirth[]; events: FixtureTreasuryEvent[] }) {
  await assertIndexWriterLease(db, 31337); requireEvidence(range.births.length <= 128 && range.events.length <= 512);
  for (const b of range.births) {
    const result = await db.query(`INSERT INTO rmt_project_treasury_fixture_births
      (chain_id,core_factory,core_deployment_block_hash,treasury_factory,treasury,creator,intent_id,block_number,block_hash,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,treasury_factory,treasury)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_project_treasury_fixture_births.payload=EXCLUDED.payload RETURNING treasury`,
    [...scopeArgs(scope, m), b.treasury.toLowerCase(), b.creator.toLowerCase(), b.intentId.toLowerCase(), b.deployment.blockNumber, b.deployment.blockHash.toLowerCase(), stringify(b)]);
    requireEvidence(result.rowCount === 1);
  }
  for (const e of range.events) {
    const result = await db.query(`INSERT INTO rmt_project_treasury_fixture_events
      (chain_id,core_factory,core_deployment_block_hash,treasury_factory,treasury,block_number,block_hash,transaction_hash,log_index,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,treasury_factory,transaction_hash,log_index)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_project_treasury_fixture_events.payload=EXCLUDED.payload RETURNING log_index`,
    [...scopeArgs(scope, m), e.treasury.toLowerCase(), e.blockNumber, e.blockHash.toLowerCase(), e.transactionHash.toLowerCase(), e.logIndex, stringify(e)]);
    requireEvidence(result.rowCount === 1);
  }
}
export async function readProjectTreasuryFixture(db: Db, scope: Scope, m: FixtureTreasuryModule, checkpoint: BlockEvidence, treasury: Address) {
  const canonical = await db.query(`SELECT 1 FROM rmt_curve_fixture_checkpoints WHERE chain_id=$1 AND factory=$2 AND deployment_block_hash=$3 AND block_number=$4 AND block_hash=$5`,
    [...scope, checkpoint.blockNumber, checkpoint.blockHash.toLowerCase()]); requireEvidence(canonical.rowCount === 1);
  const births = await db.query<{ payload: FixtureTreasuryBirth }>(`SELECT payload FROM rmt_project_treasury_fixture_births WHERE ${predicate} AND treasury=$5 AND block_number<=$6 LIMIT 2`,
    [...scopeArgs(scope, m), treasury.toLowerCase(), checkpoint.blockNumber]);
  const events = await db.query<{ payload: FixtureTreasuryEvent }>(`SELECT payload FROM rmt_project_treasury_fixture_events WHERE ${predicate} AND treasury=$5 AND block_number<=$6
    ORDER BY block_number DESC,log_index DESC LIMIT 100`, [...scopeArgs(scope, m), treasury.toLowerCase(), checkpoint.blockNumber]);
  requireEvidence(births.rows.length <= 1);
  return { profile, schemaVersion: 1, chainId: 31337, treasuryFactory: m.treasuryFactory, checkpoint,
    treasuries: births.rows.map(r => r.payload), events: events.rows.map(r => r.payload) };
}
