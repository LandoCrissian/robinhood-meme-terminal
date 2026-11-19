import type { Client } from "pg";
import type { Address } from "viem";
import { assertIndexWriterLease } from "./index-store.js";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import { reclaimFixtureProfile, type ReclaimFixtureScope, type ReclaimFixtureModule, type ReclaimFixtureRange,
  type ReclaimFixtureBirth, type ReclaimFixtureEvent, type ReclaimFixtureSnapshot } from "./reclaim-fixture-types.js";

type Db = Pick<Client,"query">;
const stringify = (v: unknown) => JSON.stringify(v,(_, x) => typeof x === "bigint" ? x.toString() : x);
const same = (a:string,b:string) => a.toLowerCase()===b.toLowerCase();
function requireEvidence(value:unknown): asserts value { if(!value)throw Error("Fixture reclaim evidence unavailable or conflicting"); }
const predicate="chain_id=$1 AND core_factory=$2 AND core_deployment_block_hash=$3 AND reclaim_factory=$4";
const scopeArgs=(scope:ReclaimFixtureScope,m:ReclaimFixtureModule)=>[...scope,m.reclaimFactory.toLowerCase()];
export const reclaimFixtureTables = ["rmt_reclaim_v2_fixture_binding","rmt_reclaim_v2_fixture_campaigns","rmt_reclaim_v2_fixture_events","rmt_reclaim_v2_fixture_states"] as const;

/** Only invoked after the existing named loopback fixture DB marker/lease check.
 * No production schema or second indexing writer is introduced. */
export async function initializeReclaimFixtureStore(db:Db,scope:ReclaimFixtureScope,m:ReclaimFixtureModule){
  requireEvidence(scope[0]===31337 && m.chainId===31337 && same(scope[1],m.coreFactory));
  await assertIndexWriterLease(db,31337);
  await db.query(`CREATE TABLE IF NOT EXISTS rmt_reclaim_v2_fixture_binding (
    reclaim_factory text PRIMARY KEY, identity jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS rmt_reclaim_v2_fixture_campaigns (
      chain_id integer NOT NULL CHECK(chain_id=31337),core_factory text NOT NULL,core_deployment_block_hash text NOT NULL,
      reclaim_factory text NOT NULL REFERENCES rmt_reclaim_v2_fixture_binding(reclaim_factory),campaign text NOT NULL,creator text NOT NULL,intent_id text NOT NULL,
      block_number bigint NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign),
      UNIQUE(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,creator,intent_id),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
      REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS rmt_reclaim_v2_fixture_events (
      chain_id integer NOT NULL CHECK(chain_id=31337),core_factory text NOT NULL,core_deployment_block_hash text NOT NULL,
      reclaim_factory text NOT NULL,campaign text NOT NULL,block_number bigint NOT NULL,block_hash text NOT NULL,
      transaction_hash text NOT NULL,log_index integer NOT NULL CHECK(log_index>=0),payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,transaction_hash,log_index),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign)
      REFERENCES rmt_reclaim_v2_fixture_campaigns(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign) ON DELETE CASCADE,
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
      REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS rmt_reclaim_v2_fixture_states (
      chain_id integer NOT NULL CHECK(chain_id=31337),core_factory text NOT NULL,core_deployment_block_hash text NOT NULL,
      reclaim_factory text NOT NULL,campaign text NOT NULL,block_number bigint NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign,block_number),
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign)
      REFERENCES rmt_reclaim_v2_fixture_campaigns(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign) ON DELETE CASCADE,
      FOREIGN KEY(chain_id,core_factory,core_deployment_block_hash,block_number,block_hash)
      REFERENCES rmt_curve_fixture_checkpoints(chain_id,factory,deployment_block_hash,block_number,block_hash) ON DELETE CASCADE)`);
  const result=await db.query(`INSERT INTO rmt_reclaim_v2_fixture_binding(reclaim_factory,identity) VALUES($1,$2)
    ON CONFLICT(reclaim_factory) DO UPDATE SET identity=EXCLUDED.identity
    WHERE rmt_reclaim_v2_fixture_binding.identity=EXCLUDED.identity RETURNING reclaim_factory`,
    [m.reclaimFactory.toLowerCase(),stringify({...m,scope})]);requireEvidence(result.rowCount===1);
}

/** Caller is the existing core range transaction; checkpoints and all extensions
 * commit atomically or roll back together. Same identity/different content fails. */
export async function commitReclaimFixtureRange(db:Db,scope:ReclaimFixtureScope,m:ReclaimFixtureModule,range:ReclaimFixtureRange){
  await assertIndexWriterLease(db,31337);requireEvidence(range.births.length<=64 && range.events.length<=512 && range.states.length<=64);
  for(const b of range.births){
    const result=await db.query(`INSERT INTO rmt_reclaim_v2_fixture_campaigns
      (chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign,creator,intent_id,block_number,block_hash,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_reclaim_v2_fixture_campaigns.payload=EXCLUDED.payload RETURNING campaign`,
      [...scopeArgs(scope,m),b.campaign.toLowerCase(),b.creator.toLowerCase(),b.intentId.toLowerCase(),b.deployment.blockNumber,b.deployment.blockHash.toLowerCase(),stringify(b)]);
    requireEvidence(result.rowCount===1);
  }
  for(const e of range.events){
    const result=await db.query(`INSERT INTO rmt_reclaim_v2_fixture_events
      (chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign,block_number,block_hash,transaction_hash,log_index,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,transaction_hash,log_index)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_reclaim_v2_fixture_events.payload=EXCLUDED.payload RETURNING log_index`,
      [...scopeArgs(scope,m),e.campaign.toLowerCase(),e.blockNumber,e.blockHash.toLowerCase(),e.transactionHash.toLowerCase(),e.logIndex,stringify(e)]);
    requireEvidence(result.rowCount===1);
  }
  for(const s of range.states){
    const result=await db.query(`INSERT INTO rmt_reclaim_v2_fixture_states
      (chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign,block_number,block_hash,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(chain_id,core_factory,core_deployment_block_hash,reclaim_factory,campaign,block_number)
      DO UPDATE SET payload=EXCLUDED.payload WHERE rmt_reclaim_v2_fixture_states.payload=EXCLUDED.payload RETURNING campaign`,
      [...scopeArgs(scope,m),s.campaign.toLowerCase(),s.blockNumber,s.blockHash.toLowerCase(),stringify(s)]);
    requireEvidence(result.rowCount===1);
  }
}
export async function storedReclaimFixtureBirths(db:Db,scope:ReclaimFixtureScope,m:ReclaimFixtureModule){
  const result=await db.query<{payload:ReclaimFixtureBirth}>(`SELECT payload FROM rmt_reclaim_v2_fixture_campaigns WHERE ${predicate} ORDER BY campaign LIMIT 65`,scopeArgs(scope,m));
  requireEvidence(result.rows.length<=64);return result.rows.map(row=>row.payload);
}
export async function readReclaimFixture(db:Db,scope:ReclaimFixtureScope,m:ReclaimFixtureModule,checkpoint:BlockEvidence,
  query:{campaign?:Address;transaction?:`0x${string}`}={}){
  requireEvidence(!(query.campaign&&query.transaction));
  requireEvidence(BigInt(checkpoint.blockNumber)>=BigInt(m.deployment.blockNumber));
  const canonical=await db.query(`SELECT 1 FROM rmt_curve_fixture_checkpoints WHERE chain_id=$1 AND factory=$2 AND deployment_block_hash=$3 AND block_number=$4 AND block_hash=$5`,
    [...scope,checkpoint.blockNumber,checkpoint.blockHash.toLowerCase()]);requireEvidence(canonical.rowCount===1);
  const campaign=query.campaign?.toLowerCase();
  const births=await db.query<{payload:ReclaimFixtureBirth}>(`SELECT payload FROM rmt_reclaim_v2_fixture_campaigns WHERE ${predicate} AND block_number<=$5
    ${campaign?"AND campaign=$6":""} ORDER BY campaign LIMIT 33`,[...scopeArgs(scope,m),checkpoint.blockNumber,...(campaign?[campaign]:[])]);
  requireEvidence(births.rows.length<=32);
  const events=await db.query<{payload:ReclaimFixtureEvent}>(`SELECT payload FROM rmt_reclaim_v2_fixture_events WHERE ${predicate} AND block_number<=$5
    ${campaign?"AND campaign=$6":query.transaction?"AND transaction_hash=$6":""} ORDER BY block_number DESC,log_index DESC LIMIT 100`,
    [...scopeArgs(scope,m),checkpoint.blockNumber,...(campaign?[campaign]:query.transaction?[query.transaction.toLowerCase()]:[])]);
  const states=await db.query<{payload:ReclaimFixtureSnapshot}>(`SELECT payload FROM rmt_reclaim_v2_fixture_states WHERE ${predicate} AND block_number=$5 AND block_hash=$6
    ${campaign?"AND campaign=$7":""} ORDER BY campaign LIMIT 33`,[...scopeArgs(scope,m),checkpoint.blockNumber,checkpoint.blockHash.toLowerCase(),...(campaign?[campaign]:[])]);
  requireEvidence(states.rows.length<=32 && births.rows.every(row=>states.rows.some(s=>same(s.payload.campaign,row.payload.campaign))));
  return {schemaVersion:2,profile:reclaimFixtureProfile,status:"ready" as const,chainId:31337,reclaimFactory:m.reclaimFactory,rewardToken:m.rewardToken,
    checkpoint:{...checkpoint,confirmations:2,finality:"local-synthetic" as const,l1Finality:"not-applicable" as const},
    campaigns:births.rows.map(row=>row.payload),states:states.rows.map(row=>row.payload),events:events.rows.map(row=>row.payload)};
}
