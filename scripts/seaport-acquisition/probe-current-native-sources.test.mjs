import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { extractPublicOpenSeaListingSummaries, compareSourceTemplate, nativeSourcePins, nativePublicTargets } from "./probe-current-native-sources.mjs";

const now = Date.parse("2026-11-20T00:00:00.000Z");
function html(patch = {}) {
  const item = { chain: { identifier: "robinhood" }, contractAddress: nativeSourcePins.collection,
    tokenId: "478", standard: "ERC721", bestListing: { id: "ui-order-id", maker: { address: "0x1111111111111111111111111111111111111111" },
      pricePerItem: { token: { unit: 0.00068786, contractAddress: "0x0000000000000000000000000000000000000000", chain: { identifier: "robinhood" } } },
      startTime: "2026-11-19T23:00:00.000Z", endTime: "2026-11-21T00:00:00.000Z", quantityRemaining: "1" }, ...patch };
  return '<script>(window[Symbol.for("urql_transport")] ??= []).push(' + JSON.stringify({ rehydrate: { x: { data: { item } } } }) + ');</script>';
}

test("public native listing claim is data only, never a signed/executable order", () => {
  const [claim] = extractPublicOpenSeaListingSummaries(html(), { nowMs: now });
  assert.equal(claim.tokenId, "478"); assert.equal(claim.displayPriceEth, "0.00068786");
  assert.equal(claim.reportedCurrentAtObservation, true); assert.equal(claim.executionApproved, false);
  assert.equal(claim.fullOrderParametersAvailable, false); assert.equal(claim.signatureAvailable, false);
  assert.equal(claim.sourceClassification, "PUBLIC_UI_LISTING_CLAIM_NOT_SIGNED_ORDER");
});
test("expired metadata remains an explicitly noncurrent claim", () => {
  const [claim] = extractPublicOpenSeaListingSummaries(html(), { nowMs: now + 2 * 86400000 });
  assert.equal(claim.reportedCurrentAtObservation, false); assert.equal(claim.executionApproved, false);
});
test("unsupported chain, collection, standard and malformed token identity never qualify", () => {
  for (const patch of [{ chain:{identifier:"ethereum"} },{contractAddress:"0x2222222222222222222222222222222222222222"},{standard:"ERC20"},{tokenId:"-1"}])
    assert.deepEqual(extractPublicOpenSeaListingSummaries(html(patch),{nowMs:now}),[]);
});
test("arbitrary scripts are not executed or parsed as authoritative transport", () => {
  globalThis.__task085UntrustedExecuted = false;
  assert.deepEqual(extractPublicOpenSeaListingSummaries('<script>globalThis.__task085UntrustedExecuted=true</script>', {nowMs:now}),[]);
  assert.equal(globalThis.__task085UntrustedExecuted,false); delete globalThis.__task085UntrustedExecuted;
  assert.throws(()=>extractPublicOpenSeaListingSummaries("x".repeat(2*1024*1024+1)),/BODY_BOUND/);
  assert.throws(()=>extractPublicOpenSeaListingSummaries("<script></script>".repeat(513)),/SCRIPT_BOUND/);
});
test("source correspondence preserves immutable uncertainty and rejects executable drift", () => {
  const template = "0x"+"11".repeat(64), changed = "0x"+"22".repeat(32)+"11".repeat(32);
  const source={runtimeBytecode:{onchainBytecode:template,immutableReferences:{one:[{start:0,length:32}]}}};
  const report=compareSourceTemplate(source,changed);
  assert.equal(report.fullRuntimeEqualsHostedSource,false);assert.equal(report.executableOutsideImmutablesEqual,true);
  assert.equal(report.independentlyRecompiled,false);assert.deepEqual(report.immutableValues.one,["0x"+"22".repeat(32)]);
  assert.equal(compareSourceTemplate(source,"0x"+"22".repeat(64)).executableOutsideImmutablesEqual,false);
  assert.throws(()=>compareSourceTemplate({...source,runtimeBytecode:{...source.runtimeBytecode,immutableReferences:{bad:[{start:63,length:32}]}}},changed),/IMMUTABLE_BOUND/);
});

const archiveRoot = new URL("../../docs/evidence/rmt-task085/marketplace/",import.meta.url);
const archiveBytes = name => readFileSync(new URL(name,archiveRoot));
const archiveJson = name => JSON.parse(archiveBytes(name));
const sha = value => createHash("sha256").update(value).digest("hex");
const captured = () => {
  const compressed=archiveBytes("raw-public-source-responses.json.gz");
  const raw=gunzipSync(compressed,{maxOutputLength:8*1024*1024});
  return {compressed,raw,rows:JSON.parse(raw),manifest:archiveJson("probe-manifest.json"),report:archiveJson("current-native-source-observation.json")};
};

test("original bounded archive bytes, public responses and read-only scope remain exact", () => {
  const {compressed,raw,rows,manifest}=captured();
  assert.equal(compressed.length,646333);
  assert.equal(sha(compressed),"de9eaf61bd8f3daf9cc1bda3d8a56bd781915358b4a16eb08861978690caeb75");
  assert.equal(raw.length,4143722);assert.equal(manifest.rawBytes,raw.length);
  assert.equal(sha(raw),"5686974d54ef291f868b24743726b7b8fdbe0afabc502160540c2d9c7068b8ed");
  assert.equal(manifest.rawSha256,sha(raw));assert.equal(rows.length,61);assert.equal(manifest.rawResponses,61);
  assert.equal(rows.filter(row=>row.method==="GET").length,9);
  assert.equal(rows.filter(row=>row.method==="POST").length,52);
  const rpcUrls=new Set(["https://rpc.mainnet.chain.robinhood.com","https://robinhood.api.pocket.network"]);
  const publicUrls=new Set(Object.values(nativePublicTargets));
  const methods=new Set(["eth_chainId","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_call"]);
  for(const row of rows){
    assert.ok(publicUrls.has(row.url)||rpcUrls.has(row.url));
    assert.ok(["GET","POST"].includes(row.method));
    assert.equal(row.headers,undefined);assert.equal(row.authorization,undefined);assert.equal(row.cookies,undefined);
    if(row.rawUtf8!==undefined){
      assert.equal(row.credentials,"omit");assert.equal(row.redirect,"error");assert.equal(row.apiCredentialUsed,false);
      assert.equal(Buffer.byteLength(row.rawUtf8),row.bytes);assert.equal(sha(row.rawUtf8),row.sha256);
      assert.ok(row.bytes<= (row.method==="POST"?256*1024:2*1024*1024));
    }
    if(row.method==="POST"){
      assert.ok(rpcUrls.has(row.url));assert.ok(methods.has(row.request?.method));
      assert.ok(Array.isArray(row.request.params));assert.ok(JSON.stringify(row.request.params).length<=8192);
      if(row.request.method==="eth_getLogs"){
        const [filter]=row.request.params;
        assert.equal(filter.address,nativeSourcePins.seaport);
        assert.equal(BigInt(filter.toBlock)-BigInt(filter.fromBlock)+1n,10000n);
      }
    }else assert.ok(publicUrls.has(row.url));
  }
});

test("retained report and exact producer preserve canonical evidence and NO_GO", () => {
  const {report,manifest}=captured();
  const reportBytes=archiveBytes("current-native-source-observation.json");
  assert.equal(sha(reportBytes),"88345688946b754794fec3cd5f7828b92ee4bfcd90e4b3043a58b84911d060c4");
  assert.equal(manifest.reportSha256,sha(reportBytes));
  // The producer and report were captured as LF bytes. Linux checkout must
  // reproduce those exact bytes; changing a recorded expected hash is invalid.
  assert.equal(sha(readFileSync(new URL("./probe-current-native-sources.mjs",import.meta.url))),manifest.scriptSha256);
  assert.equal(manifest.scriptSha256,"b22bcf4bbd09c5e72c4745cd2b1da27dedfad9dd0573175175669d9890d6ed8e");
  assert.equal(report.anchor,"118625674");assert.equal(report.corroborated,true);
  assert.deepEqual(report.providers.official,report.providers.pocket);
  for(const point of Object.values(report.providers)){
    assert.equal(BigInt(point.block.number),118625674n);
    assert.equal(point.block.hash,"0x0325a0a27de7e9c9d465086b6c422d30d5d19791a52222c0f063813cf813fda7");
    assert.equal(point.canonicalRechecked,true);assert.equal(point.recentOrderValidated.count,0);
    assert.equal(point.code.seaport.runtimeHash,nativeSourcePins.seaportRuntimeHash);
    assert.equal(point.code.implementation.sourceCorrespondence.fullRuntimeEqualsHostedSource,true);
    assert.equal(point.code.implementation.sourceCorrespondence.independentlyRecompiled,false);
    assert.equal(point.code.validator.ethereumReferenceCorrespondence.fullRuntimeEqualsHostedSource,false);
  }
  assert.equal(report.verdict,"NO_CURRENT_EXECUTABLE_SIGNED_NATIVE_ORDER_ADMITTED");
  assert.equal(report.status,"BLOCKED_NO_BROADCAST");assert.equal(report.broadcast,false);assert.equal(report.ownerSignatures,false);
  assert.equal(report.executionApproved,false);assert.equal(report.currentExecutableListingVerified,false);
  assert.equal(report.collectionPurchaseAdmitted,false);assert.match(report.collectionVerdict,/^NO_GO_/);
  assert.equal(report.publicSources.listingApi.httpStatus,401);assert.equal(report.publicSources.collectionUi.httpStatus,200);
  assert.equal(report.publicUiListingClaims.length,50);
  for(const claim of report.publicUiListingClaims){assert.equal(claim.signatureAvailable,false);assert.equal(claim.fullOrderParametersAvailable,false);assert.equal(claim.executionApproved,false);}
});

test("source excerpts bind original public responses and retain upstream MIT notices", () => {
  const {rows}=captured(),sourceRows=rows.filter(row=>row.httpStatus===200&&row.url.includes("sourcify"));
  assert.equal(sourceRows.length,2);
  assert.deepEqual(sourceRows.map(row=>Object.keys(JSON.parse(row.rawUtf8).sources).length),[21,36]);
  const sourcesByUrl=new Map(sourceRows.map(row=>[row.url,{row,data:JSON.parse(row.rawUtf8)}]));
  const missingSpdx=[];
  for(const {data}of sourcesByUrl.values())for(const [path,source]of Object.entries(data.sources)){
    if(!/SPDX-License-Identifier:/.test(source.content))missingSpdx.push(path);
    else assert.match(source.content,/SPDX-License-Identifier: MIT/);
  }
  assert.deepEqual(missingSpdx.sort(),[
    "lib/tm-core-lib/src/utils/introspection/ERC165.sol","lib/tm-core-lib/src/utils/introspection/IERC165.sol",
    "lib/tm-core-lib/src/utils/misc/StorageTstorish.sol","lib/tm-core-lib/src/utils/structs/EnumerableSet.sol",
    "lib/tm-core-lib/src/utils/token/IEOARegistry.sol","lib/tm-core-lib/src/utils/token/ITransferValidator.sol",
  ]);
  const excerpts=archiveJson("source-policy-excerpts.json");
  assert.equal(excerpts.scope,"HOSTED_SOURCE_EXCERPTS_NOT_INDEPENDENT_COMPILATION_OR_COLLECTION_ADMISSION");
  assert.equal(excerpts.sources.length,6);
  for(const record of excerpts.sources){
    const original=sourcesByUrl.get(record.sourceUrl);assert.ok(original);
    assert.equal(record.responseSha256,original.row.sha256);
    const source=original.data.sources[record.path]?.content;assert.equal(typeof source,"string");
    assert.equal(sha(source),record.sourceSha256);
    const lines=source.split("\n");
    for(const excerpt of record.excerpts)assert.equal(excerpt.text,lines.slice(Math.max(0,excerpt.line-4),excerpt.line+29).join("\n"));
  }
  const notices=archiveBytes("UPSTREAM_NOTICES.md").toString("utf8");
  for(const copyright of ["Copyright (c) 2022 Ozone Networks, Inc.","Copyright (c) 2023 Limit Break Inc","Copyright (c) 2022 Chiru Labs"])
    assert.ok(notices.includes(copyright));
  for(const name of ["OpenSea-SeaDrop","Limit-Break-Creator-Token-Standards","OpenZeppelin","ERC721A"])assert.ok(notices.includes("## "+name));
  assert.equal((notices.match(/Permission is hereby granted, free of charge/g)??[]).length,4);
});

test("recorded raw scans bind unescaped bodies and unchanged scanner configuration", () => {
  const {rows,manifest}=captured();
  const bodies=Buffer.from(rows.map(row=>row.rawUtf8??"").join("\n"));
  assert.equal(bodies.length,3894605);assert.equal(manifest.scanner.httpBodiesBytes,bodies.length);
  assert.equal(sha(bodies),"9eb96a7d6ce57b6b09450ddb12446aabbd98ce12ec996f9859fc27722999e384");
  assert.equal(manifest.scanner.httpBodiesSha256,sha(bodies));
  assert.equal(manifest.scannerStatus,"RAW_ENVELOPE_AND_UNESCAPED_HTTP_BODIES_SCANNED_NO_FINDINGS");
  assert.equal(manifest.scanner.name,"Gitleaks");assert.equal(manifest.scanner.version,"8.30.1");
  assert.equal(manifest.scanner.configurationSha256,"682c4983b955469645ca36b3145f10bd9baa6e3011ac4f8d82cc4de6b49be8cc");
  // Original scan used the unchanged Windows CRLF checkout. Reconstitute only
  // those line endings from the Linux LF checkout; preserve the recorded hash.
  const configLf=readFileSync(new URL("../../.gitleaks.toml",import.meta.url),"utf8").replaceAll("\r\n","\n");
  assert.equal(sha(configLf.replaceAll("\n","\r\n")),manifest.scanner.configurationSha256);
  assert.equal(manifest.scanner.suppressionsAdded,false);
  for(const key of ["envelopeExitCode","envelopeFindings","httpBodiesExitCode","httpBodiesFindings"])assert.equal(manifest.scanner[key],0);
  assert.deepEqual(archiveJson("raw-gitleaks-report.json"),[]);assert.deepEqual(archiveJson("raw-http-body-gitleaks-report.json"),[]);
});
