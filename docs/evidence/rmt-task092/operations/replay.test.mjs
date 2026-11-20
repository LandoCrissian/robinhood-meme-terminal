import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
test("current authorized Railway metadata records actual missing recovery prerequisites",()=>{
 const r=JSON.parse(readFileSync(new URL("provider-observation.json",import.meta.url)));
 assert.equal(r.scope,"EXISTING_PRODUCTION_PROVIDER_METADATA_READ_ONLY");
 assert.equal(r.databaseServiceId,"a1ef7853-e21a-401e-87c9-c99002228507");
 assert.equal(r.volume.volumeId,"bf6e7ddc-3be6-4ba7-ad53-8e7010e76c86");
 assert.equal(r.volume.serviceId,r.databaseServiceId);assert.equal(r.volume.state,"READY");
 assert.equal(r.status,"CURRENT_PROVIDER_BACKUPS_ABSENT");assert.deepEqual(r.backups,[]);assert.deepEqual(r.schedules,[]);
 assert.equal(r.pitr.enabled,false);assert.equal(r.pitr.bucketWired,false);assert.equal(r.noRegisteredSshKeys,true);
 for(const key of ["currentProductionBackupRestored","ownerControlledOffDeviceCopyAndKeyVerified","currentWriterLeaseDirectlyObserved"])assert.equal(r[key],false);
 assert.ok(Date.parse(r.finishedAt)>=Date.parse("2026-11-20T21:52:00Z"));
});
