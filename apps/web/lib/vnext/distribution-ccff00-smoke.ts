import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import {
  CCFF00_ACCOUNT_IMPLEMENTATION,
  CCFF00_ADAPTER_ID,
  CCFF00_CANARY_TOKEN_IDS,
  CCFF00_COLLECTION,
  CCFF00_ERC6551_REGISTRY,
  CCFF00_ERC6551_SALT,
  CCFF00_RMT_TOKEN,
  CCFF00_TOKEN,
  CCFF00_TOKENS_PER_NFT_ATOMIC,
  buildCcff00RmtDropManifestV1,
  parseCcff00PublicSnapshotV1,
  readCcff00PublicSnapshotV1,
  validateCcff00Canaries,
  type Ccff00ReadClient
} from "./distribution-ccff00";
import { parseDistributionManifestV1 } from "./distribution-domain";
import { CCFF00_OFFICIAL_LINKS, CCFF00_PRESENTATION_EVIDENCE } from "./distribution-ccff00-presentation";

const blockNumber = 37_451_763n;
const blockHash = "0xbfbff107fb35cb352a2a8e58fa3abd198f2c800c032ebe57b747958a992113dc" as Hex;
const sender = getAddress("0x1111111111111111111111111111111111111111");
const engine = getAddress("0x2222222222222222222222222222222222222222");
const sink = getAddress("0x3333333333333333333333333333333333333333");
const owner = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const HASH_A = `0x${"a".repeat(64)}` as Hex;
const HASH_B = `0x${"b".repeat(64)}` as Hex;
const canaryTbas = new Map<string, Address>([
  ["470", getAddress("0xFd1fDC1d3aA3AeEA37b265C691C7D367cBb20a6e")],
  ["471", getAddress("0xF26b9c1ecA9489A1AdCe201fB82630889cfe6246")],
  ["472", getAddress("0x3b71916De0aE9a4e2303dD6fCe66A8f6555c83D5")]
]);
const fullTbas = new Map<string, Address>([
  ["1", getAddress("0x4444444444444444444444444444444444444444")],
  ["2", getAddress("0x5555555555555555555555555555555555555555")],
  ["3", getAddress("0x6666666666666666666666666666666666666666")]
]);
const bytecodes = new Map<string, Hex>([
  [CCFF00_COLLECTION.toLowerCase(), "0x6001"],
  [CCFF00_ERC6551_REGISTRY.toLowerCase(), "0x6002"],
  [CCFF00_ACCOUNT_IMPLEMENTATION.toLowerCase(), "0x6003"],
  [CCFF00_TOKEN.toLowerCase(), "0x6004"],
  [CCFF00_RMT_TOKEN.toLowerCase(), "0x6005"]
]);

function fakeClient(mode: "canaries" | "full", overrides: {
  registry?: Address;
  publicMinted?: bigint;
  reserveMinted?: bigint;
  totalSupply?: bigint;
  duplicateTba?: boolean;
} = {}): Ccff00ReadClient {
  const publicMinted = overrides.publicMinted ?? (mode === "canaries" ? 482n : 3n);
  const reserveMinted = overrides.reserveMinted ?? 250n;
  const totalSupply = overrides.totalSupply ?? publicMinted + reserveMinted;
  return {
    async getBlockNumber() { return blockNumber; },
    async getBlock() { return { number: blockNumber, hash: blockHash }; },
    async getBytecode({ address }) { return bytecodes.get(address.toLowerCase()); },
    async readContract({ address, functionName, args = [] }) {
      if (address === CCFF00_COLLECTION) {
        const values: Record<string, unknown> = {
          totalSupply,
          publicMinted,
          reserveMinted,
          PUBLIC_START_ID: 1n,
          PUBLIC_SUPPLY: 9_750n,
          FOUNDER_START_ID: 9_751n,
          PROJECT_START_ID: 9_771n,
          FOUNDER_RESERVE: 20n,
          PROJECT_RESERVE: 230n,
          TOTAL_RESERVE: 250n,
          erc6551Registry: overrides.registry ?? CCFF00_ERC6551_REGISTRY,
          erc6551Implementation: CCFF00_ACCOUNT_IMPLEMENTATION,
          erc6551Salt: CCFF00_ERC6551_SALT,
          accountChainId: 4_663n,
          ccff00Token: CCFF00_TOKEN,
          TOKENS_PER_NFT: CCFF00_TOKENS_PER_NFT_ATOMIC
        };
        if (functionName in values) return values[functionName];
        const tokenId = BigInt(String(args[0])).toString();
        if (functionName === "ownerOf") return owner;
        if (functionName === "getTokenBoundAccount") {
          if (overrides.duplicateTba) return getAddress("0x4444444444444444444444444444444444444444");
          const tba = (mode === "canaries" ? canaryTbas : fullTbas).get(tokenId);
          if (!tba) throw new Error(`Unexpected token ID ${tokenId}`);
          return tba;
        }
      }
      if (functionName === "balanceOf") {
        if (address === CCFF00_TOKEN) return CCFF00_TOKENS_PER_NFT_ATOMIC;
        if (address === CCFF00_RMT_TOKEN) return 0n;
      }
      throw new Error(`Unexpected read ${address}:${functionName}`);
    }
  };
}

async function run() {
const historical = JSON.parse(readFileSync(new URL("./fixtures/ccff00-public-audit-37451763.json", import.meta.url), "utf8"));
assert.equal(historical.status, "historical_partial_audit");
assert.equal(historical.manifestEligible, false);
assert.equal(historical.snapshotBlock, "37451763");
assert.equal(historical.snapshotBlockHash, blockHash);
assert.equal(historical.publicMinted, "482");
assert.equal(historical.reserveMinted, "250");
assert.equal(historical.totalSupply, "732");
assert.equal(historical.canaries.length, 3);
assert.deepEqual(historical.canaries.map((row: { tokenId: string }) => row.tokenId), ["470", "471", "472"]);
for (const row of historical.canaries) {
  assert.equal(getAddress(row.tokenBoundAccount), canaryTbas.get(row.tokenId));
  assert.equal(row.ccff00BalanceAtomic, CCFF00_TOKENS_PER_NFT_ATOMIC.toString());
  assert.equal(row.rmtBalanceAtomic, "0");
  assert.equal(row.activated, false);
}
assert.throws(() => parseCcff00PublicSnapshotV1(historical), /snapshot schema/);

const canarySnapshot = await readCcff00PublicSnapshotV1(fakeClient("canaries"), { coverage: "canaries" });
assert.equal(canarySnapshot.adapterId, CCFF00_ADAPTER_ID);
assert.equal(canarySnapshot.coverage, "canaries");
assert.equal(canarySnapshot.publicMinted, "482");
assert.equal(canarySnapshot.reserveMinted, "250");
assert.equal(canarySnapshot.totalSupply, "732");
assert.deepEqual(canarySnapshot.rows.map((row) => row.tokenId), CCFF00_CANARY_TOKEN_IDS.map(String));
assert.equal(parseCcff00PublicSnapshotV1(canarySnapshot).snapshotHash, canarySnapshot.snapshotHash);
const canaryStatus = validateCcff00Canaries(canarySnapshot);
assert.equal(canaryStatus.exactAddressesVerified, true);
assert.equal(canaryStatus.exactCcff00FundingVerified, true);
assert.equal(canaryStatus.oneRmtEachVerified, false);
assert.equal(canaryStatus.activatedCanaryCount, 0);
assert.equal(canaryStatus.ownerWithdrawalProofVerified, false);
assert.equal(canaryStatus.massDistributionEligible, false);
assert.equal(canaryStatus.blockers.length, 3);

const fullSnapshot = await readCcff00PublicSnapshotV1(fakeClient("full"), { coverage: "full_public" });
assert.deepEqual(fullSnapshot.rows.map((row) => row.tokenId), ["1", "2", "3"]);
assert.equal(new Set(fullSnapshot.rows.map((row) => row.tokenBoundAccount)).size, 3);
assert.throws(() => buildCcff00RmtDropManifestV1({
  snapshot: canarySnapshot,
  sender,
  rmtPerTokenBoundAccount: "500",
  infrastructure: {
    engine, engineRuntimeHash: HASH_A, retirementSink: sink, retirementSinkRuntimeHash: HASH_B,
    rmtToken: CCFF00_RMT_TOKEN, rmtTokenRuntimeHash: canarySnapshot.rmtRuntimeHash,
    utilityPolicyVersion: 1, erc20CostPerRecipientAtomic: "7", erc721CostPerRecipientAtomic: "11", erc1155CostPerRecipientAtomic: "13"
  },
  gasEvidence: {
    chainId: 4_663, actionKind: "erc20_equal", measuredAtBlock: blockNumber.toString(), blockGasLimit: "1000",
    safetyMarginBps: 8000, source: "foundry_simulation", samples: [{ recipientCount: 1, gasUsed: "200" }]
  }
}), /complete public snapshot/);

const planned = buildCcff00RmtDropManifestV1({
  snapshot: fullSnapshot,
  sender,
  rmtPerTokenBoundAccount: "500",
  infrastructure: {
    engine, engineRuntimeHash: HASH_A, retirementSink: sink, retirementSinkRuntimeHash: HASH_B,
    rmtToken: CCFF00_RMT_TOKEN, rmtTokenRuntimeHash: fullSnapshot.rmtRuntimeHash,
    utilityPolicyVersion: 1, erc20CostPerRecipientAtomic: "7", erc721CostPerRecipientAtomic: "11", erc1155CostPerRecipientAtomic: "13"
  },
  gasEvidence: {
    chainId: 4_663, actionKind: "erc20_equal", measuredAtBlock: blockNumber.toString(), blockGasLimit: "1000",
    safetyMarginBps: 8000, source: "foundry_simulation",
    samples: [{ recipientCount: 1, gasUsed: "200" }, { recipientCount: 2, gasUsed: "400" }, { recipientCount: 3, gasUsed: "700" }]
  }
});
assert.equal(planned.manifest.asset.address, CCFF00_RMT_TOKEN);
assert.equal(planned.manifest.asset.decimals, 18);
assert.equal(planned.manifest.entries.length, 3);
assert.equal(planned.manifest.expectedTotalDistributionAtomic, (1_500n * 10n ** 18n).toString());
assert.equal(planned.manifest.expectedTotalRmtRetirementAtomic, "21");
assert.equal(planned.manifest.sourceEvidence.snapshotBlock, blockNumber.toString());
assert.equal(planned.manifest.sourceEvidence.evidenceHash, fullSnapshot.snapshotHash);
assert.equal(planned.releaseBlockers.length, 5);
assert.equal(parseDistributionManifestV1(planned.manifest).manifestHash, planned.manifest.manifestHash);

await assert.rejects(() => readCcff00PublicSnapshotV1(fakeClient("full", { registry: sender }), { coverage: "full_public" }), /registry/);
await assert.rejects(() => readCcff00PublicSnapshotV1(fakeClient("full", { totalSupply: 999n }), { coverage: "full_public" }), /supply accounting/);
await assert.rejects(() => readCcff00PublicSnapshotV1(fakeClient("full", { duplicateTba: true }), { coverage: "full_public" }), /duplicate token-bound accounts/);
assert.throws(() => parseCcff00PublicSnapshotV1({ ...fullSnapshot, publicMinted: "4" }), /coverage|hash|accounting/);
assert.throws(() => parseCcff00PublicSnapshotV1({ ...fullSnapshot, snapshotHash: HASH_A }), /content hash/);
assert.throws(() => buildCcff00RmtDropManifestV1({
  snapshot: fullSnapshot,
  sender,
  rmtPerTokenBoundAccount: "500",
  infrastructure: {
    engine, engineRuntimeHash: HASH_A, retirementSink: sink, retirementSinkRuntimeHash: HASH_B,
    rmtToken: CCFF00_RMT_TOKEN, rmtTokenRuntimeHash: HASH_A,
    utilityPolicyVersion: 1, erc20CostPerRecipientAtomic: "7", erc721CostPerRecipientAtomic: "11", erc1155CostPerRecipientAtomic: "13"
  },
  gasEvidence: {
    chainId: 4_663, actionKind: "erc20_equal", measuredAtBlock: blockNumber.toString(), blockGasLimit: "1000",
    safetyMarginBps: 8000, source: "foundry_simulation", samples: [{ recipientCount: 1, gasUsed: "200" }]
  }
}), /runtime differs/);

const adapterSource = readFileSync(new URL("./distribution-ccff00.ts", import.meta.url), "utf8");
assert.doesNotMatch(adapterSource, /writeContract|sendTransaction|signMessage|signTypedData|walletClient/);
assert.match(adapterSource, /getTokenBoundAccount/);
assert.match(adapterSource, /publicMinted/);
assert.match(adapterSource, /coverage !== "full_public"/);

assert.equal(CCFF00_PRESENTATION_EVIDENCE.snapshotBlock, "41538389");
assert.equal(CCFF00_PRESENTATION_EVIDENCE.publicMinted + CCFF00_PRESENTATION_EVIDENCE.reserveMinted, CCFF00_PRESENTATION_EVIDENCE.totalSupply);
assert.equal(CCFF00_PRESENTATION_EVIDENCE.tokenBoundIdentitiesDiscovered, CCFF00_PRESENTATION_EVIDENCE.publicMinted);
assert.deepEqual(CCFF00_PRESENTATION_EVIDENCE.canaries, { verified: 3, total: 3, activated: 0, rmtDeposited: 0 });
assert.deepEqual(CCFF00_PRESENTATION_EVIDENCE.canaryRows.map((row) => row.tokenId), ["470", "471", "472"]);
for (const row of CCFF00_PRESENTATION_EVIDENCE.canaryRows) {
  assert.equal(row.owner, owner);
  assert.equal(row.tokenBoundAccount, canaryTbas.get(row.tokenId));
  assert.equal(row.ccff00Balance, "10,000");
  assert.equal(row.rmtBalance, "0");
  assert.equal(row.activated, false);
}
assert.equal(CCFF00_OFFICIAL_LINKS.myNeon, "https://hoodstreet.capital/my-neon");
assert.equal(CCFF00_OFFICIAL_LINKS.openSea, "https://opensea.io/collection/ccff00-161927574");

const plannerPresentationSource = readFileSync(new URL("../../app/vnext/vnext-distribution-planner.tsx", import.meta.url), "utf8");
assert.match(plannerPresentationSource, /Independent ecosystem support by RMT\. No affiliation or endorsement implied\./);
assert.match(plannerPresentationSource, /Wallet submission <strong>DISABLED<\/strong>/);
assert.match(plannerPresentationSource, /Server submission <strong>DISABLED<\/strong>/);
assert.match(plannerPresentationSource, /data-workspace=/);
assert.match(plannerPresentationSource, /Community[\s\S]*Planner/);
assert.match(plannerPresentationSource, /Overview[\s\S]*Program[\s\S]*Proof[\s\S]*Links/);
assert.match(plannerPresentationSource, /#470 · Activate → 1 RMT → owner-controlled return/);
assert.match(plannerPresentationSource, /No mass distribution/);
assert.doesNotMatch(plannerPresentationSource, /writeContract|sendTransaction|signMessage|signTypedData|walletClient/);

const terminalPresentationSource = readFileSync(new URL("../../app/vnext/terminal-presentations.tsx", import.meta.url), "utf8");
assert.match(terminalPresentationSource, /VNextDistributionPlanner presentation="desktop"/);
assert.match(terminalPresentationSource, /VNextDistributionPlanner presentation="mobile"/);

console.log("RMT CCFF00 read-only snapshot, canary, and generic distribution-planner checks passed.");
}

run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
