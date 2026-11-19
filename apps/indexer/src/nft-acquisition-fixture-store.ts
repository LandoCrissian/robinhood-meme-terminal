import type { Client } from "pg";
import type { Address, Hash } from "viem";
import { assertIndexWriterLease } from "./index-store.js";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import { nftAcquisitionProfile, type NftAcquisitionModule, type NftAcquisitionRange, type NftAcquisitionScope } from "./nft-acquisition-fixture-types.js";

type Db = Pick<Client, "query">;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
function requireEvidence(ok: unknown): asserts ok { if (!ok) throw Error("Fixture NFT acquisition persistence unavailable or conflicting"); }
const args = (scope: NftAcquisitionScope, module: NftAcquisitionModule) => [...scope, module.factory.toLowerCase(), module.vault.toLowerCase()];
const predicate = "chain_id=$1 AND core_factory=$2 AND core_deployment_block_hash=$3 AND acquisition_factory=$4 AND vault=$5";
export const nftAcquisitionTables = ["rmt_nft_acquisition_fixture_binding", "rmt_nft_acquisition_fixture_events", "rmt_nft_acquisition_fixture_states"] as const;

/** Called only after the existing named fixture marker and exclusive writer
 * lease. Every observation shares the existing canonical checkpoint FKs. */
export async function initializeNftAcquisitionStore(db: Db, scope: NftAcquisitionScope, module: NftAcquisitionModule) {
  requireEvidence(scope[0] === 31337 && module.chainId === 31337 && same(scope[1], module.coreFactory));
  await assertIndexWriterLease(db, 31337);
  await db.query(`CREATE TABLE IF NOT EXISTS rmt_nft_acquisition_fixture_binding (
    acquisition_factory text NOT NULL, vault text NOT NULL, identity jsonb NOT NULL, PRIMARY KEY(acquisition_factory,vault));
    CREATE TABLE IF NOT EXISTS rmt_nft_acquisition_fixture_events (
      chain_id integer NOT NULL CHECK(chain_id=31337),core_factory text NOT NULL,core_deployment_block_hash text NOT NULL,
      acquisition_factory text NOT NULL,vault text NOT NULL,block_number bigint NOT NULL,block_hash text NOT NULL,
      transaction_hash text NOT NULL,log_index integer NOT NULL CHECK(log_index>=0),payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,acquisition_factory,vault,transaction_hash,log_index),
      FOREIGN KEY(acquisition_factory,vault) REFERENCES rmt_nft_acquisition_fixture_binding(acquisition_factory,vault),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
      REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS rmt_nft_acquisition_fixture_states (
      chain_id integer NOT NULL CHECK(chain_id=31337),core_factory text NOT NULL,core_deployment_block_hash text NOT NULL,
      acquisition_factory text NOT NULL,vault text NOT NULL,block_number bigint NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,acquisition_factory,vault,block_number),
      FOREIGN KEY(acquisition_factory,vault) REFERENCES rmt_nft_acquisition_fixture_binding(acquisition_factory,vault),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
      REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE)`);
  const result = await db.query(`INSERT INTO rmt_nft_acquisition_fixture_binding(acquisition_factory,vault,identity) VALUES($1,$2,$3)
    ON CONFLICT(acquisition_factory,vault) DO UPDATE SET identity=EXCLUDED.identity
    WHERE rmt_nft_acquisition_fixture_binding.identity=EXCLUDED.identity RETURNING vault`,
    [module.factory.toLowerCase(), module.vault.toLowerCase(), json({ scope, module })]);
  requireEvidence(result.rowCount === 1);
}

/** Invoked inside the existing core range transaction. Identical replay is
 * idempotent; a different payload at the same identity fails the whole range. */
export async function commitNftAcquisitionRange(db: Db, scope: NftAcquisitionScope, module: NftAcquisitionModule, range: NftAcquisitionRange) {
  await assertIndexWriterLease(db, 31337); requireEvidence(range.events.length <= 512 && range.states.length <= 1);
  for (const event of range.events) {
    requireEvidence(same(event.vault, module.vault) && same(event.projectToken, module.projectToken));
    const result = await db.query(`INSERT INTO rmt_nft_acquisition_fixture_events
      (chain_id,core_factory,core_deployment_block_hash,acquisition_factory,vault,block_number,block_hash,transaction_hash,log_index,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,acquisition_factory,vault,transaction_hash,log_index)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_nft_acquisition_fixture_events.payload=EXCLUDED.payload RETURNING log_index`,
      [...args(scope, module), event.blockNumber, event.blockHash.toLowerCase(), event.transactionHash.toLowerCase(), event.logIndex, json(event)]);
    requireEvidence(result.rowCount === 1);
  }
  for (const state of range.states) {
    requireEvidence(same(state.vault, module.vault) && same(state.projectToken, module.projectToken));
    const result = await db.query(`INSERT INTO rmt_nft_acquisition_fixture_states
      (chain_id,core_factory,core_deployment_block_hash,acquisition_factory,vault,block_number,block_hash,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,acquisition_factory,vault,block_number)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_nft_acquisition_fixture_states.payload=EXCLUDED.payload RETURNING vault`,
      [...args(scope, module), state.blockNumber, state.blockHash.toLowerCase(), json(state)]);
    requireEvidence(result.rowCount === 1);
  }
}

export async function readNftAcquisitionStore(db: Db, scope: NftAcquisitionScope, module: NftAcquisitionModule, checkpoint: BlockEvidence,
  query: { vault?: Address; transaction?: Hash }) {
  requireEvidence(!(query.vault && query.transaction) && (!query.vault || same(query.vault, module.vault)));
  const canonical = await db.query(`SELECT 1 FROM rmt_curve_fixture_checkpoints
    WHERE chain_id=$1 AND factory=$2 AND deployment_block_hash=$3 AND block_number=$4 AND block_hash=$5`,
    [...scope, checkpoint.blockNumber, checkpoint.blockHash.toLowerCase()]); requireEvidence(canonical.rowCount === 1);
  const events = await db.query(`SELECT payload FROM rmt_nft_acquisition_fixture_events WHERE ${predicate} AND block_number<=$6
    ${query.transaction ? "AND transaction_hash=$7" : ""} ORDER BY block_number DESC,log_index DESC LIMIT 100`,
    [...args(scope, module), checkpoint.blockNumber, ...(query.transaction ? [query.transaction.toLowerCase()] : [])]);
  const states = await db.query(`SELECT payload FROM rmt_nft_acquisition_fixture_states WHERE ${predicate} AND block_number=$6 AND block_hash=$7`,
    [...args(scope, module), checkpoint.blockNumber, checkpoint.blockHash.toLowerCase()]); requireEvidence(states.rowCount === 1);
  return { schemaVersion: 1, profile: nftAcquisitionProfile, status: "ready", chainId: 31337, vault: module.vault,
    projectToken: module.projectToken, productionExecution: false, checkpoint: { ...checkpoint, confirmations: 2, finality: "local-synthetic", l1Finality: "not-applicable" },
    states: states.rows.map(row => row.payload), events: events.rows.map(row => row.payload) };
}
