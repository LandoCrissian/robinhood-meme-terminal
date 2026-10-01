import assert from "node:assert/strict";
import { getAddress, type Address } from "viem";
import { RMT_DISCOVERABLE_PROJECTS, projectById, projectsForContract, searchProjects, projectRelationships, defineRmtProjectIdentity } from "@rmt/shared/project-identity";
import { exactHolderOverlap, summarizeProjectOwnership, projectsRepresentedInWallet, parseProjectOwnershipFact, type ProjectAssetOwnership } from "@rmt/shared/project-ownership";
import { readProjectOwnership } from "./project-ownership-reader";
import { readRmtNftWalletOwnership } from "./nft-project-market";

async function main() {
const wallet = getAddress("0x1111111111111111111111111111111111111111"), other = getAddress("0x2222222222222222222222222222222222222222");
const hash = `0x${"a".repeat(64)}`; const time = new Date().toISOString();
const ccff = projectById("ccff00")!, canna = projectById("cannacats")!;
assert.equal(RMT_DISCOVERABLE_PROJECTS.length, 4);
assert.equal(ccff.assets.length, 1); assert.equal(ccff.assets[0]!.kind, "ERC721");
assert.equal(projectById("robin-rabbits"), null, "WATCHING is not graph admission");
for (const query of ["CannaCats", "CANNACAT", canna.assets[0]!.contract, canna.assets[1]!.contract]) assert.equal(searchProjects(query)[0]?.projectId, "cannacats");
assert.equal(searchProjects("Founding Feathers")[0]?.projectId, "peeps");
assert.equal(projectsForContract("0x14C51bB55592372eAC7141A1D0527D1dD7Fbd42F").length, 0, "No inferred SHCAT relationship");
assert.equal(searchProjects("0x1234").length, 0);
assert.equal(projectRelationships(canna).filter(edge => edge.type === "PROJECT_HAS_TOKEN").length, 1);
assert.equal(projectRelationships(canna).filter(edge => edge.type === "PROJECT_HAS_NFT_COLLECTION").length, 1);
assert.ok(RMT_DISCOVERABLE_PROJECTS.every(project => projectRelationships(project).every(edge => edge.evidence.length > 0)), "Every admitted asset/link edge retains explicit evidence");
const multi = defineRmtProjectIdentity({ ...canna, projectId: "controlled-multiple", assets: [...canna.assets, { ...canna.assets[1]!, contract: other }] });
assert.equal(multi.assets.length, 3);
const tokenOnly = defineRmtProjectIdentity({ ...canna, projectId: "controlled-token-only", assets: [canna.assets[0]!] });
assert.equal(tokenOnly.assets.length, 1);
for (const asset of canna.assets) {
  assert.ok(asset.evidence?.some(e => e.class === "OWNER_VERIFIED")); assert.ok(asset.evidence?.some(e => e.class === "ONCHAIN_VERIFIED"));
  assert.throws(() => defineRmtProjectIdentity({ ...canna, assets: [{ ...asset, chainId: 1 as 4663 }] }));
  assert.throws(() => defineRmtProjectIdentity({ ...canna, assets: [{ ...asset, evidence: asset.evidence!.filter(e => e.class !== "OWNER_VERIFIED") }] }));
}
const fact = (contract: Address, balance: string, authority: ProjectAssetOwnership["authority"] = "ONCHAIN_BALANCE"): ProjectAssetOwnership => ({ chainId: 4663, contract, wallet, state: "READY", balance, authority, blockNumber: "10", blockHash: hash, observedAt: time });
for (const count of ["0", "1", "3"]) {
  const summary = summarizeProjectOwnership(ccff, wallet, [fact(ccff.assets[0]!.contract, count, "RMT_NFT_INDEXER")]);
  assert.equal(summary.nftCount, count); assert.equal(summary.holdsNft, count !== "0"); assert.equal(summary.holdsToken, false);
}
assert.equal(summarizeProjectOwnership(ccff, wallet, []).holdsNft, null);
assert.equal(summarizeProjectOwnership(ccff, wallet, [{ ...fact(ccff.assets[0]!.contract, "1"), wallet: other }]).nftCount, null);
const facts = canna.assets.map(asset => fact(asset.contract, "1"));
assert.equal(parseProjectOwnershipFact({ ...facts[0], balance: "-1" }, canna.assets[0]!.contract, wallet), null);
assert.equal(parseProjectOwnershipFact({ ...facts[0], authority: "USER_PROFILE" }, canna.assets[0]!.contract, wallet), null);
assert.equal(summarizeProjectOwnership(canna, wallet, [facts[0]!, facts[0]!]).holdsToken, null, "Duplicate fact binding cannot invent ownership");
assert.equal(summarizeProjectOwnership(canna, wallet, facts).holdsBoth, true);
assert.equal(summarizeProjectOwnership(canna, wallet, [facts[0]!]).holdsBoth, null);
assert.equal(summarizeProjectOwnership(canna, wallet, [facts[0]!, { ...facts[1]!, blockNumber: "11" }]).holdsBoth, null, "Different block observations cannot fabricate simultaneous overlap");
assert.equal(projectsRepresentedInWallet([ccff,canna], wallet, facts).filter(p => p.holdsToken || p.holdsNft).length, 1);
const holders = { chainId: 4663 as const, contract: wallet, blockNumber: "10", blockHash: hash, completeness: "COMPLETE" as const, holders: [wallet, other], authority: "RMT_CANONICAL_OWNERSHIP" as const };
assert.equal(exactHolderOverlap(holders, { ...holders, holders: [wallet] }).both, 1);
assert.equal(exactHolderOverlap(holders, { ...holders, completeness: "PARTIAL" }).state, "UNAVAILABLE");
assert.equal(exactHolderOverlap(holders, { ...holders, blockNumber: "9" }).state, "UNAVAILABLE");

let calls = 0, failNft = false, chain = 4663;
const client = { getChainId: async () => chain, getBlock: async () => ({ number: 10n, hash }), readContract: async (input: { address: string; blockNumber: bigint; functionName: string }) => { calls++; assert.equal(input.functionName, "balanceOf"); assert.equal(input.blockNumber, 10n); if (failNft && input.address.toLowerCase() === canna.assets[1]!.contract.toLowerCase()) throw Error("RPC unavailable"); return 2n; } } as unknown as NonNullable<Parameters<typeof readProjectOwnership>[2]>["client"];
assert.equal((await readProjectOwnership("cannacats", wallet, { client }))!.holdsBoth, true); assert.equal(calls, 2);
failNft = true; const partial = await readProjectOwnership("cannacats", wallet, { client }); assert.equal(partial!.holdsToken, true); assert.equal(partial!.holdsNft, null);
chain = 1; calls = 0; assert.equal((await readProjectOwnership("cannacats", wallet, { client }))!.holdsToken, null); assert.equal(calls, 0, "Wrong-chain RPC is not ownership authority");
assert.equal(await readProjectOwnership("unknown", wallet, { client }), null);
const env = { NFT_INDEXER_URL: "http://127.0.0.1:4000", NFT_INDEXER_READ_TOKEN: "a".repeat(64) };
const indexed = fact(ccff.assets[0]!.contract, "3", "RMT_NFT_INDEXER");
let payload: unknown = indexed;
const fetcher = (async (url, options) => { assert.ok(String(url).includes(`/ccff00/ownership/${wallet}`)); assert.equal(options?.cache, "no-store"); assert.ok((options?.headers as {authorization:string}).authorization.startsWith("Bearer ")); return Response.json(payload); }) as typeof fetch;
assert.equal((await readRmtNftWalletOwnership("ccff00", wallet, { env, fetchImpl: fetcher }))?.balance, "3");
for (payload of [{...indexed, wallet:other},{...indexed, chainId:1},{...indexed, contract:other},{...indexed, balance:"NaN"},{...indexed, observedAt:"2020-01-01T00:00:00Z"}]) assert.equal(await readRmtNftWalletOwnership("ccff00", wallet, { env, fetchImpl: fetcher }), null);
payload = { ...indexed, state:"UNAVAILABLE", balance:null }; assert.equal((await readRmtNftWalletOwnership("ccff00", wallet, { env, fetchImpl: fetcher }))?.balance, null);
chain = 4663; calls = 0;
assert.equal((await readProjectOwnership("ccff00", wallet, { client, readIndexed: async () => indexed }))!.nftCount, "3"); assert.equal(calls, 0, "Admitted CCFF00 uses the existing durable ownership authority");
console.log("Project graph: exact candidate admission/search, multiple assets, provenance separation, confirmed zero vs unavailable, block-bound overlap, wrong-chain isolation, read-only balances and authenticated NFT read validation PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
