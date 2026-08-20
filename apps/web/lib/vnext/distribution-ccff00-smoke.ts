import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex
} from "viem";
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
import {
  CCFF00_CANARY_RMT_AMOUNT_ATOMIC,
  buildCcff00OwnerWithdrawalProofV1,
  expectedCcff00TokenBoundRuntimeHashV1,
  verifyCcff00OwnerWithdrawalProofV1,
  type Ccff00OwnerWithdrawalConfigurationV1,
  type Ccff00OwnerWithdrawalProofCoreV1,
  type Ccff00ProofReceiptLogV1,
  type Ccff00ProofTransactionV1
} from "./distribution-ccff00-owner-withdrawal-proof";

const blockNumber = 37_451_763n;
const blockHash = "0xbfbff107fb35cb352a2a8e58fa3abd198f2c800c032ebe57b747958a992113dc" as Hex;
const sender = getAddress("0x1111111111111111111111111111111111111111");
const engine = getAddress("0x2222222222222222222222222222222222222222");
const sink = getAddress("0x3333333333333333333333333333333333333333");
const owner = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const HASH_A = `0x${"a".repeat(64)}` as Hex;
const HASH_B = `0x${"b".repeat(64)}` as Hex;
const HASH_C = `0x${"c".repeat(64)}` as Hex;
const HASH_D = `0x${"d".repeat(64)}` as Hex;
const HASH_E = `0x${"e".repeat(64)}` as Hex;
const HASH_F = `0x${"f".repeat(64)}` as Hex;
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

const registryProofAbi = [{
  type: "function",
  name: "createAccount",
  stateMutability: "nonpayable",
  inputs: [
    { name: "implementation", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" }
  ],
  outputs: [{ name: "account", type: "address" }]
}, {
  type: "event",
  name: "ERC6551AccountCreated",
  anonymous: false,
  inputs: [
    { name: "account", type: "address", indexed: false },
    { name: "implementation", type: "address", indexed: true },
    { name: "salt", type: "bytes32", indexed: false },
    { name: "chainId", type: "uint256", indexed: false },
    { name: "tokenContract", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true }
  ]
}] as const;

const erc20ProofAbi = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "success", type: "bool" }]
}, {
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;

const accountProofAbi = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" }
  ],
  outputs: [{ name: "result", type: "bytes" }]
}] as const;

function proofTransaction(input: Omit<Ccff00ProofTransactionV1, "chainId" | "status" | "valueAtomic">): Ccff00ProofTransactionV1 {
  return { ...input, chainId: 4_663, status: "success", valueAtomic: "0" };
}

function registryCreatedLog(tba: Address, logIndex: number): Ccff00ProofReceiptLogV1 {
  return {
    address: CCFF00_ERC6551_REGISTRY,
    topics: encodeEventTopics({
      abi: registryProofAbi,
      eventName: "ERC6551AccountCreated",
      args: {
        implementation: CCFF00_ACCOUNT_IMPLEMENTATION,
        tokenContract: CCFF00_COLLECTION,
        tokenId: 470n
      }
    }).flatMap((topic) => typeof topic === "string" ? [topic] : []),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }],
      [tba, CCFF00_ERC6551_SALT, 4_663n]
    ),
    logIndex
  };
}

function rmtTransferLog(from: Address, to: Address, amount: bigint, logIndex: number): Ccff00ProofReceiptLogV1 {
  return {
    address: CCFF00_RMT_TOKEN,
    topics: encodeEventTopics({ abi: erc20ProofAbi, eventName: "Transfer", args: { from, to } })
      .flatMap((topic) => typeof topic === "string" ? [topic] : []),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    logIndex
  };
}

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
assert.deepEqual(canaryStatus.ownerControlProofs, [
  { tokenId: "470", verified: false },
  { tokenId: "471", verified: false },
  { tokenId: "472", verified: false }
]);
assert.equal(canaryStatus.massDistributionEligible, false);
assert.equal(canaryStatus.blockers.length, 3);

const proofTba = canaryTbas.get("470")!;
const proofConfiguration: Ccff00OwnerWithdrawalConfigurationV1 = {
  collection: CCFF00_COLLECTION,
  registry: CCFF00_ERC6551_REGISTRY,
  accountImplementation: CCFF00_ACCOUNT_IMPLEMENTATION,
  salt: CCFF00_ERC6551_SALT,
  accountChainId: 4_663,
  ccff00Token: CCFF00_TOKEN,
  rmtToken: CCFF00_RMT_TOKEN,
  admittedCanaryTokenIds: CCFF00_CANARY_TOKEN_IDS
};
const activationInput = encodeFunctionData({
  abi: registryProofAbi,
  functionName: "createAccount",
  args: [CCFF00_ACCOUNT_IMPLEMENTATION, CCFF00_ERC6551_SALT, 4_663n, CCFF00_COLLECTION, 470n]
});
const fundingInput = encodeFunctionData({
  abi: erc20ProofAbi,
  functionName: "transfer",
  args: [proofTba, CCFF00_CANARY_RMT_AMOUNT_ATOMIC]
});
const returnInput = encodeFunctionData({
  abi: erc20ProofAbi,
  functionName: "transfer",
  args: [sink, CCFF00_CANARY_RMT_AMOUNT_ATOMIC]
});
const withdrawalInput = encodeFunctionData({
  abi: accountProofAbi,
  functionName: "execute",
  args: [CCFF00_RMT_TOKEN, 0n, returnInput, 0]
});
const proofCore: Ccff00OwnerWithdrawalProofCoreV1 = {
  schemaVersion: 1,
  chainId: 4_663,
  tokenId: "470",
  collection: CCFF00_COLLECTION,
  tokenBoundAccount: proofTba,
  sourceSnapshot: {
    blockNumber: canarySnapshot.snapshotBlock,
    blockHash: canarySnapshot.snapshotBlockHash,
    snapshotHash: canarySnapshot.snapshotHash,
    currentOwner: owner,
    collectionReturnedTokenBoundAccount: proofTba
  },
  infrastructure: {
    registry: CCFF00_ERC6551_REGISTRY,
    registryRuntimeHash: canarySnapshot.erc6551RegistryRuntimeHash,
    accountImplementation: CCFF00_ACCOUNT_IMPLEMENTATION,
    implementationRuntimeHash: canarySnapshot.accountImplementationRuntimeHash,
    salt: CCFF00_ERC6551_SALT,
    accountChainId: 4_663,
    deployedTbaRuntimeHash: expectedCcff00TokenBoundRuntimeHashV1(proofConfiguration, 470n)
  },
  assets: {
    ccff00Token: CCFF00_TOKEN,
    ccff00RuntimeHash: canarySnapshot.ccff00RuntimeHash,
    rmtToken: CCFF00_RMT_TOKEN,
    rmtRuntimeHash: canarySnapshot.rmtRuntimeHash
  },
  activation: {
    transaction: proofTransaction({
      transactionHash: HASH_C,
      blockNumber: (blockNumber + 1n).toString(),
      blockHash: HASH_D,
      transactionIndex: 1,
      from: engine,
      to: CCFF00_ERC6551_REGISTRY,
      input: activationInput,
      logs: [registryCreatedLog(proofTba, 3)]
    }),
    accountCreatedLogIndex: 3,
    resultingTokenBoundAccount: proofTba,
    ownerAfterActivation: owner,
    tokenBinding: { chainId: 4_663, collection: CCFF00_COLLECTION, tokenId: "470" }
  },
  funding: {
    transaction: proofTransaction({
      transactionHash: HASH_D,
      blockNumber: (blockNumber + 2n).toString(),
      blockHash: HASH_E,
      transactionIndex: 2,
      from: sender,
      to: CCFF00_RMT_TOKEN,
      input: fundingInput,
      logs: [rmtTransferLog(sender, proofTba, CCFF00_CANARY_RMT_AMOUNT_ATOMIC, 7)]
    }),
    sender,
    amountAtomic: CCFF00_CANARY_RMT_AMOUNT_ATOMIC.toString(),
    transferLogIndex: 7,
    tbaRmtBalanceBeforeAtomic: "0",
    tbaRmtBalanceAfterAtomic: CCFF00_CANARY_RMT_AMOUNT_ATOMIC.toString()
  },
  withdrawal: {
    transaction: proofTransaction({
      transactionHash: HASH_E,
      blockNumber: (blockNumber + 3n).toString(),
      blockHash: HASH_F,
      transactionIndex: 3,
      from: owner,
      to: proofTba,
      input: withdrawalInput,
      logs: [rmtTransferLog(proofTba, sink, CCFF00_CANARY_RMT_AMOUNT_ATOMIC, 11)]
    }),
    caller: owner,
    returnRecipient: sink,
    amountAtomic: CCFF00_CANARY_RMT_AMOUNT_ATOMIC.toString(),
    transferLogIndex: 11,
    tbaRmtBalanceBeforeAtomic: CCFF00_CANARY_RMT_AMOUNT_ATOMIC.toString(),
    tbaRmtBalanceAfterAtomic: "0",
    recipientRmtBalanceBeforeAtomic: "100",
    recipientRmtBalanceAfterAtomic: (100n + CCFF00_CANARY_RMT_AMOUNT_ATOMIC).toString()
  },
  unchangedAssets: {
    ccff00BalanceBeforeAtomic: CCFF00_TOKENS_PER_NFT_ATOMIC.toString(),
    ccff00BalanceAfterAtomic: CCFF00_TOKENS_PER_NFT_ATOMIC.toString()
  }
};
const ownerWithdrawalProof = buildCcff00OwnerWithdrawalProofV1(proofCore);
const verifiedOwnerWithdrawal = verifyCcff00OwnerWithdrawalProofV1({
  proof: ownerWithdrawalProof,
  snapshot: canarySnapshot,
  configuration: proofConfiguration,
  approvedReturnAddress: sink
});
assert.equal(verifiedOwnerWithdrawal.verified, true);
assert.equal(verifiedOwnerWithdrawal.tokenId, "470");
assert.equal(verifiedOwnerWithdrawal.tokenBoundAccount, proofTba);
assert.equal(verifiedOwnerWithdrawal.currentOwner, owner);
assert.equal(verifiedOwnerWithdrawal.returnRecipient, sink);

const canaryStatusWithProof = validateCcff00Canaries(canarySnapshot, {
  ownerWithdrawalProof,
  approvedReturnAddress: sink
});
assert.equal(canaryStatusWithProof.ownerWithdrawalProofVerified, true);
assert.deepEqual(canaryStatusWithProof.ownerControlProofs, [
  { tokenId: "470", verified: true },
  { tokenId: "471", verified: false },
  { tokenId: "472", verified: false }
]);
assert.equal(canaryStatusWithProof.oneRmtEachVerified, false);
assert.equal(canaryStatusWithProof.activatedCanaryCount, 0);
assert.equal(canaryStatusWithProof.massDistributionEligible, false);
assert.equal(canaryStatusWithProof.blockers.length, 2);

function rebuiltProof(mutate: (candidate: Record<string, any>) => void) {
  const candidate = structuredClone(ownerWithdrawalProof) as Record<string, any>;
  delete candidate.proofHash;
  mutate(candidate);
  return buildCcff00OwnerWithdrawalProofV1(candidate as Ccff00OwnerWithdrawalProofCoreV1);
}

function rejectProofMutation(mutate: (candidate: Record<string, any>) => void, pattern: RegExp) {
  assert.throws(() => verifyCcff00OwnerWithdrawalProofV1({
    proof: rebuiltProof(mutate),
    snapshot: canarySnapshot,
    configuration: proofConfiguration,
    approvedReturnAddress: sink
  }), pattern);
}

rejectProofMutation((value) => { value.chainId = 1; }, /schema|chain/);
rejectProofMutation((value) => { value.tokenId = "999"; }, /admitted canary|source snapshot/);
rejectProofMutation((value) => { value.sourceSnapshot.currentOwner = sender; }, /current owner/);
rejectProofMutation((value) => { value.tokenBoundAccount = sender; }, /canonical TBA/);
rejectProofMutation((value) => { value.infrastructure.registry = sender; }, /registry/);
rejectProofMutation((value) => { value.infrastructure.registryRuntimeHash = HASH_A; }, /registry runtime/);
rejectProofMutation((value) => { value.infrastructure.accountImplementation = sender; }, /implementation/);
rejectProofMutation((value) => { value.infrastructure.implementationRuntimeHash = HASH_A; }, /implementation runtime/);
rejectProofMutation((value) => { value.infrastructure.deployedTbaRuntimeHash = HASH_A; }, /deployed TBA runtime/);
rejectProofMutation((value) => { value.assets.rmtToken = sender; }, /RMT token/);
rejectProofMutation((value) => { value.activation.transaction.logs = []; }, /account-creation event/);
rejectProofMutation((value) => { value.activation.ownerAfterActivation = sender; }, /owner after activation/);
rejectProofMutation((value) => { value.activation.tokenBinding.tokenId = "471"; }, /token binding/);
rejectProofMutation((value) => { value.funding.amountAtomic = (2n * CCFF00_CANARY_RMT_AMOUNT_ATOMIC).toString(); }, /exactly 1 RMT/);
rejectProofMutation((value) => { value.funding.sender = engine; }, /funding transaction sender/);
rejectProofMutation((value) => {
  value.funding.transaction.input = encodeFunctionData({
    abi: erc20ProofAbi,
    functionName: "transfer",
    args: [sink, CCFF00_CANARY_RMT_AMOUNT_ATOMIC]
  });
}, /funding calldata recipient/);
rejectProofMutation((value) => { value.funding.transaction.logs = []; }, /exactly one RMT Transfer/);
rejectProofMutation((value) => { value.funding.transferLogIndex = 99; }, /log index/);
rejectProofMutation((value) => { value.withdrawal.caller = sender; }, /withdrawal caller/);
rejectProofMutation((value) => { value.withdrawal.returnRecipient = sender; }, /return recipient/);
rejectProofMutation((value) => {
  const wrongInner = encodeFunctionData({
    abi: erc20ProofAbi,
    functionName: "transfer",
    args: [sender, CCFF00_CANARY_RMT_AMOUNT_ATOMIC]
  });
  value.withdrawal.transaction.input = encodeFunctionData({
    abi: accountProofAbi,
    functionName: "execute",
    args: [CCFF00_RMT_TOKEN, 0n, wrongInner, 0]
  });
}, /withdrawal calldata recipient/);
rejectProofMutation((value) => { value.withdrawal.amountAtomic = (2n * CCFF00_CANARY_RMT_AMOUNT_ATOMIC).toString(); }, /exactly 1 RMT/);
rejectProofMutation((value) => { value.funding.tbaRmtBalanceAfterAtomic = "1"; }, /funding TBA balance delta/);
rejectProofMutation((value) => { value.withdrawal.recipientRmtBalanceAfterAtomic = "101"; }, /return-recipient balance delta/);
rejectProofMutation((value) => { value.unchangedAssets.ccff00BalanceAfterAtomic = "1"; }, /CCFF00 balance changed/);
rejectProofMutation((value) => { value.withdrawal.transaction.status = "reverted"; }, /schema/);
rejectProofMutation((value) => { value.funding.transaction.transactionHash = value.activation.transaction.transactionHash; }, /duplicated or replayed/);

const mutatedBlock = structuredClone(ownerWithdrawalProof);
mutatedBlock.activation.transaction.blockHash = HASH_A;
assert.throws(() => verifyCcff00OwnerWithdrawalProofV1({
  proof: mutatedBlock,
  snapshot: canarySnapshot,
  configuration: proofConfiguration,
  approvedReturnAddress: sink
}), /proof hash/);
const mutatedProofHash = { ...ownerWithdrawalProof, proofHash: HASH_A };
assert.throws(() => verifyCcff00OwnerWithdrawalProofV1({
  proof: mutatedProofHash,
  snapshot: canarySnapshot,
  configuration: proofConfiguration,
  approvedReturnAddress: sink
}), /proof hash/);
assert.throws(() => verifyCcff00OwnerWithdrawalProofV1({
  proof: ownerWithdrawalProof,
  snapshot: canarySnapshot,
  configuration: proofConfiguration,
  approvedReturnAddress: sink,
  consumedProofHashes: [ownerWithdrawalProof.proofHash]
}), /already been consumed/);
assert.throws(() => verifyCcff00OwnerWithdrawalProofV1({
  proof: ownerWithdrawalProof,
  snapshot: canarySnapshot,
  configuration: proofConfiguration,
  approvedReturnAddress: sink,
  consumedTransactionHashes: [ownerWithdrawalProof.funding.transaction.transactionHash]
}), /already been consumed/);

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
const ownerWithdrawalProofSource = readFileSync(
  new URL("./distribution-ccff00-owner-withdrawal-proof.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(ownerWithdrawalProofSource, /writeContract|sendTransaction|signMessage|signTypedData|walletClient/);
assert.match(ownerWithdrawalProofSource, /decodeFunctionData/);
assert.match(ownerWithdrawalProofSource, /decodeEventLog/);
assert.match(ownerWithdrawalProofSource, /canonicalDistributionJson/);

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
