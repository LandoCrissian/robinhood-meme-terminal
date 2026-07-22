import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  toHex,
  type Address,
  type Hex
} from "viem";

export const CONSENT_ACTIVATION_CHAIN_ID = 46_630;
export const CONSENT_ACTIVATION_OPERATOR = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA" as Address;
export const CONSENT_ACTIVATION_RELEASE_ID = "rmt-consent-testnet-2026-07-18-b21a282";
export const CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const CONSENT_ACTIVATION_STORAGE_KEY =
  `rmt:consent-testnet-activation:v1:${CONSENT_ACTIVATION_CHAIN_ID}:${CONSENT_ACTIVATION_OPERATOR.toLowerCase()}`;
export const CONSENT_ACTIVATION_ACCEPTANCE_PHRASE =
  "I ACCEPT VALUELESS TESTNET ACTIVATION ON CHAIN 46630";

export const CONSENT_ACTIVATION_RELEASE = {
  id: CONSENT_ACTIVATION_RELEASE_ID,
  name: "RMT consent migration no-value rehearsal",
  sourceCommit: "b21a28276a4ff62253c36988167d613eb44fbb3c",
  contractSourceSha256: "0781f4f534d33b0ecdb773a8ccc4da3f283772432203f11c5af8394d53eb0f1e",
  deployedAtUtc: "2026-07-18T17:29:17Z",
  compilerVersion: "v0.8.26+commit.8a97fa7a",
  evmVersion: "cancun",
  optimizerRuns: 200,
  viaIR: true
} as const;

export const CONSENT_ACTIVATION_CONTRACTS = {
  venue: "0x10af03B200b2487815dfBE4922810a7b9640A884",
  governance: "0xA7892f1D730132834493C5DC361e289430D3d3c0",
  pairedToken: "0x2E80c3a5F732c0510765714DEEA48b7037212358",
  weth: "0xe89D3DAD1c3f70abA5233E7AeB9802913AC3B82e",
  factory: "0xA898d6dd64FD6c00bec75c4AAb4b6221684bE65b",
  pool: "0x780dAE2D43B2B6815feA8183FCdEc2Df052ecE95",
  positionManager: "0x7fC068016e499ca7C04BebF027a8086Cc2ceF786",
  consentStack: "0x662F4dC5fE4115BE317BeFc0D77f4C1d6adeE576",
  session: "0x4B2bD99Bef87C58a08F93766c35e591985289c85",
  migrator: "0x01Cdc5FA002F0dEee4B153D31763392EC81e8f05"
} as const satisfies Record<string, Address>;

export type ConsentActivationContractName = keyof typeof CONSENT_ACTIVATION_CONTRACTS;

export const CONSENT_ACTIVATION_RUNTIME_CODE_HASHES = {
  venue: "0x259fff664ce8fb811c0081d320a75a6b7f3b3f3d40e425a2e0d76950ee4bfe39",
  governance: "0x85bc5b5b878054e5c6aafa667f896e29a91e4748d762a569d27d706886252dc0",
  pairedToken: "0x3e5c4979831b2d68a060fccb8d7c519f69737af2bce18e5dfd734c4d25fac846",
  weth: "0x3e5c4979831b2d68a060fccb8d7c519f69737af2bce18e5dfd734c4d25fac846",
  factory: "0x32b39b7df76c7677518e480289c13cfcfc188eaa656d78e05e1380f0ca4d285f",
  pool: "0x7d7e7f5550b205cf3db4fb41eec22088d5ea02eb7f784487c57b97beff2964db",
  positionManager: "0x8c27106af2ebe71989d70d2e7d2714ca526586f59b02a95e19ced6b245ef37e6",
  consentStack: "0x17673272061c95a8eef6e27c769fd1c45a1ea1542113a112ef68fc737d0994b6",
  session: "0x6d5b42c3d471d72c148bbaf4a3709d65e31f79614c8e82451325e4f811f6162d",
  migrator: "0x287f1dbf61ef8b3b5ee309b47fcdf81e11dda25aab19ca51ee092f254a4a1239"
} as const satisfies Record<ConsentActivationContractName, Hex>;

export const CONSENT_ACTIVATION_CONFIGURATION = {
  configurationHash: "0x1e626fe6109321b4363aef67f3a66ff3af92abeda98441d6809df19b702b4a09" as Hex,
  termsDocumentHash: "0x236ed1f849548c61a923152a92dc91593f22a6e2ff3d176a4b0db38b3b2d2b57" as Hex,
  migrationTermsHash: "0xeb32892f8c20fbd279e13e05ea9a7a63667196a77198b43b5001a7a94647e93f" as Hex,
  governanceSigner: CONSENT_ACTIVATION_OPERATOR,
  guardian: CONSENT_ACTIVATION_OPERATOR,
  signerCount: 1n,
  threshold: 1n,
  configurationEpoch: 1n,
  executionDelaySeconds: 86_400n,
  executionWindowSeconds: 604_800n,
  deploymentStartBlock: 91_297_664n,
  consentStackDeploymentBlock: 91_297_687n,
  verificationSnapshotBlock: 91_298_061n
} as const;

export const CONSENT_TESTNET_TERMS_TEXT = [
  "# RMT consent migration rehearsal terms — testnet v1",
  "",
  "Version: `RMT-CONSENT-MIGRATION-TESTNET-V1`",
  "",
  "These terms apply only to the RMT consent-migration rehearsal deployed on Robinhood Chain testnet, chain ID `46630`. The rehearsal is experimental software for testing wallet authorization, token accounting, direct LP-position ownership, refunds, pausing, and deployment verification.",
  "",
  "By submitting a rehearsal transaction, the connected wallet confirms all of the following:",
  "",
  "1. It is using only valueless test tokens supplied for this rehearsal and will not send ETH, production tokens, bridged assets, or anything expected to have monetary value.",
  "2. It controls the tokens it approves and is not attempting to access, claim, recover, withdraw, or redirect assets owned by another person or contract.",
  "3. It reviewed the exact chain, router, accounting session, token pair, position manager, pool, fee tier, tick range, desired amounts, minimum amounts, minimum liquidity, deadline, and deployment-bound terms hash shown before confirmation.",
  "4. A successful transaction mints a new test position directly to the calling wallet. RMT does not custody the position or choose another beneficiary.",
  "5. Any unused amount from a successful transaction must return to the calling wallet in the same atomic transaction. A failed verification reverts the entire transaction.",
  "6. Tokens sent directly to the router, accounting session, venue, manager, or pool may be permanently inaccessible. Tokens must move only through the reviewed rehearsal flow.",
  "7. The rehearsal venue is an RMT-operated, Sushi V3 ABI-compatible test fixture. It is not an official Sushi deployment, Robinhood product, endorsement, partnership, production AMM, investment product, yield product, recovery service, bridge, or promise of future support.",
  "8. Test results do not establish production safety, profitability, legal compliance, token value, liquidity, price quality, or mainnet readiness. Smart-contract, wallet, network, RPC, indexing, and interface failures remain possible.",
  "9. RMT may keep the rehearsal paused, pause it again, replace the test deployment, or discontinue the interface. The deployed contracts are not upgradeable and cannot be changed in place.",
  "10. No person should rely on this rehearsal for financial, investment, tax, or legal decisions. A separate reviewed release, independent security assessment, and qualified legal review are required before any real-value use.",
  "",
  "The deployment-specific acceptance hash is derived from the immutable contract configuration and the Keccak-256 hash of the exact UTF-8 bytes of this file. Editing this file creates a different document and requires a new deployment/version; it does not change any already deployed acceptance hash."
].join("\n") + "\n";

export const CALCULATED_CONSENT_TESTNET_TERMS_HASH = keccak256(toHex(CONSENT_TESTNET_TERMS_TEXT));

export const CONSENT_GOVERNANCE_ABI = [
  { type: "function", name: "isSigner", stateMutability: "view", inputs: [{ name: "signer", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "signerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "executionDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "executionWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "configurationEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "transactionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getTransaction",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{
      name: "transaction",
      type: "tuple",
      components: [
        { name: "proposer", type: "address" },
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "executeAfter", type: "uint64" },
        { name: "executeBefore", type: "uint64" },
        { name: "configurationEpoch", type: "uint64" },
        { name: "confirmations", type: "uint256" },
        { name: "executed", type: "bool" },
        { name: "cancelled", type: "bool" }
      ]
    }]
  },
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }],
    outputs: [{ name: "id", type: "uint256" }]
  },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "result", type: "bytes" }] },
  {
    type: "event",
    name: "Proposed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "configurationEpoch", type: "uint64", indexed: true },
      { name: "proposer", type: "address", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "data", type: "bytes", indexed: false },
      { name: "executeAfter", type: "uint64", indexed: false },
      { name: "executeBefore", type: "uint64", indexed: false }
    ]
  },
  {
    type: "event",
    name: "Cancelled",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "configurationEpoch", type: "uint64", indexed: true },
      { name: "signer", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "Executed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "configurationEpoch", type: "uint64", indexed: true },
      { name: "executor", type: "address", indexed: true }
    ]
  }
] as const;

export const CONSENT_MIGRATOR_ACTIVATION_ABI = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "event",
    name: "PauseChanged",
    inputs: [
      { name: "paused", type: "bool", indexed: false },
      { name: "caller", type: "address", indexed: true }
    ]
  }
] as const;

export const CONSENT_UNPAUSE_CALLDATA = "0x3f4ba83a" as Hex;
export const CONSENT_PAUSE_CALLDATA = "0x8456cb59" as Hex;

export function consentProposalCalldata(): Hex {
  return encodeFunctionData({
    abi: CONSENT_GOVERNANCE_ABI,
    functionName: "propose",
    args: [CONSENT_ACTIVATION_CONTRACTS.migrator, 0n, CONSENT_UNPAUSE_CALLDATA]
  });
}

export function consentExecuteCalldata(proposalId: bigint): Hex {
  return encodeFunctionData({ abi: CONSENT_GOVERNANCE_ABI, functionName: "execute", args: [proposalId] });
}

export function consentCancelCalldata(proposalId: bigint): Hex {
  return encodeFunctionData({ abi: CONSENT_GOVERNANCE_ABI, functionName: "cancel", args: [proposalId] });
}

export function isExactTypedAcceptance(value: string): boolean {
  return value === CONSENT_ACTIVATION_ACCEPTANCE_PHRASE;
}

export type ConsentGovernanceTransaction = {
  proposer: Address;
  target: Address;
  value: bigint;
  data: Hex;
  executeAfter: bigint;
  executeBefore: bigint;
  configurationEpoch: bigint;
  confirmations: bigint;
  executed: boolean;
  cancelled: boolean;
};

export type ConsentProposedEvent = {
  id: bigint;
  configurationEpoch: bigint;
  proposer: Address;
  target: Address;
  value: bigint;
  data: Hex;
  executeAfter: bigint;
  executeBefore: bigint;
};

export type ConsentExactProposal = {
  proposalId: bigint;
  proposalBlockTimestamp: bigint;
  transactionCount: bigint;
  event: ConsentProposedEvent;
  transaction: ConsentGovernanceTransaction;
  expectedExecuted?: boolean;
  expectedCancelled?: boolean;
};

export type ConsentActivationPhase =
  | "not-proposed"
  | "invalid"
  | "waiting"
  | "executable"
  | "expired"
  | "cancelled"
  | "executed";

function sameAddress(left: string, right: string): boolean {
  return isAddress(left) && isAddress(right) && getAddress(left) === getAddress(right);
}

function sameHex(left: string, right: string): boolean {
  return isHex(left) && isHex(right) && left.toLowerCase() === right.toLowerCase();
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hasExactProposalCall(transaction: ConsentGovernanceTransaction): boolean {
  return sameAddress(transaction.proposer, CONSENT_ACTIVATION_OPERATOR)
    && sameAddress(transaction.target, CONSENT_ACTIVATION_CONTRACTS.migrator)
    && transaction.value === 0n
    && sameHex(transaction.data, CONSENT_UNPAUSE_CALLDATA)
    && transaction.configurationEpoch === CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch
    && transaction.confirmations === 1n
    && transaction.executeAfter > 0n
    && transaction.executeBefore
      === transaction.executeAfter + CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds;
}

export function getConsentActivationPhase(
  now: bigint,
  transaction?: ConsentGovernanceTransaction | null
): ConsentActivationPhase {
  if (!transaction) return "not-proposed";
  if (transaction.executed && transaction.cancelled) return "invalid";
  if (!hasExactProposalCall(transaction)) return "invalid";
  if (transaction.executed) return "executed";
  if (transaction.cancelled) return "cancelled";
  if (now < transaction.executeAfter) return "waiting";
  if (now <= transaction.executeBefore) return "executable";
  return "expired";
}

export type ConsentRecoveryAcceptanceSnapshot = {
  expectedProposalId: bigint;
  proposalId: bigint;
  latestTimestamp: bigint;
  transactionCount: bigint;
  paused: boolean;
  transaction: ConsentGovernanceTransaction;
};

export function assertConsentRecoveryAcceptanceSnapshot(
  snapshot: ConsentRecoveryAcceptanceSnapshot
): Extract<ConsentActivationPhase, "waiting" | "executable"> {
  invariant(snapshot.transactionCount === 1n, "Recovery acceptance requires exactly one governance proposal.");
  invariant(snapshot.proposalId === snapshot.expectedProposalId, "The exact onchain proposal changed during recovery review.");
  const phase = getConsentActivationPhase(snapshot.latestTimestamp, snapshot.transaction);
  invariant(
    phase === "waiting" || phase === "executable",
    `Recovery acceptance cannot be recorded after the proposal is ${phase}.`
  );
  invariant(snapshot.paused, "Recovery acceptance requires the migrator to remain paused.");
  return phase;
}

export function assertExactConsentProposal(proposal: ConsentExactProposal): void {
  const { event, transaction } = proposal;
  invariant(!(proposal.expectedExecuted && proposal.expectedCancelled), "proposal cannot be executed and cancelled");
  invariant(proposal.transactionCount === 1n, "unexpected governance transaction count");
  invariant(proposal.proposalId === proposal.transactionCount - 1n, "unexpected proposal id");
  invariant(event.id === proposal.proposalId, "Proposed event id mismatch");
  invariant(event.configurationEpoch === CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch, "Proposed event epoch mismatch");
  invariant(sameAddress(event.proposer, CONSENT_ACTIVATION_OPERATOR), "Proposed event proposer mismatch");
  invariant(sameAddress(event.target, CONSENT_ACTIVATION_CONTRACTS.migrator), "Proposed event target mismatch");
  invariant(event.value === 0n, "Proposed event value must be zero");
  invariant(sameHex(event.data, CONSENT_UNPAUSE_CALLDATA), "Proposed event calldata mismatch");
  invariant(
    event.executeAfter === proposal.proposalBlockTimestamp + CONSENT_ACTIVATION_CONFIGURATION.executionDelaySeconds,
    "Proposed event delay mismatch"
  );
  invariant(
    event.executeBefore === event.executeAfter + CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds,
    "Proposed event window mismatch"
  );
  invariant(hasExactProposalCall(transaction), "onchain governance transaction is not the exact activation call");
  invariant(sameAddress(transaction.proposer, event.proposer), "onchain proposal proposer differs from event");
  invariant(sameAddress(transaction.target, event.target), "onchain proposal target differs from event");
  invariant(transaction.value === event.value, "onchain proposal value differs from event");
  invariant(sameHex(transaction.data, event.data), "onchain proposal calldata differs from event");
  invariant(transaction.executeAfter === event.executeAfter, "onchain proposal start differs from event");
  invariant(transaction.executeBefore === event.executeBefore, "onchain proposal expiry differs from event");
  invariant(transaction.configurationEpoch === event.configurationEpoch, "onchain proposal epoch differs from event");
  invariant(
    transaction.executed === (proposal.expectedExecuted ?? false),
    proposal.expectedExecuted ? "activation proposal is not executed" : "activation proposal already executed"
  );
  invariant(
    transaction.cancelled === (proposal.expectedCancelled ?? false),
    proposal.expectedCancelled ? "activation proposal is not cancelled" : "activation proposal was cancelled"
  );
}

export type ConsentActivationReleaseSnapshot = {
  chainId: bigint;
  operator: Address;
  guardian: Address;
  governanceSigner: Address;
  sourceCommit: string;
  contractSourceSha256: string;
  contracts: Record<ConsentActivationContractName, Address>;
  runtimeCodeHashes: Record<ConsentActivationContractName, Hex>;
  configurationHash: Hex;
  termsDocumentHash: Hex;
  migrationTermsHash: Hex;
  operatorIsSigner: boolean;
  signerCount: bigint;
  threshold: bigint;
  executionDelaySeconds: bigint;
  executionWindowSeconds: bigint;
  configurationEpoch: bigint;
  transactionCount: bigint;
  paused: boolean;
};

export type ConsentReleaseValidationOptions = {
  expectedPaused?: boolean;
  expectedTransactionCount?: 0n | 1n;
};

export function assertExactConsentActivationRelease(
  snapshot: ConsentActivationReleaseSnapshot,
  options: ConsentReleaseValidationOptions = {}
): void {
  invariant(snapshot.chainId === BigInt(CONSENT_ACTIVATION_CHAIN_ID), "wrong activation chain");
  invariant(sameAddress(snapshot.operator, CONSENT_ACTIVATION_OPERATOR), "operator mismatch");
  invariant(sameAddress(snapshot.guardian, CONSENT_ACTIVATION_CONFIGURATION.guardian), "guardian mismatch");
  invariant(sameAddress(snapshot.governanceSigner, CONSENT_ACTIVATION_CONFIGURATION.governanceSigner), "governance signer mismatch");
  invariant(snapshot.sourceCommit === CONSENT_ACTIVATION_RELEASE.sourceCommit, "source commit mismatch");
  invariant(snapshot.contractSourceSha256 === CONSENT_ACTIVATION_RELEASE.contractSourceSha256, "contract source hash mismatch");
  for (const name of Object.keys(CONSENT_ACTIVATION_CONTRACTS) as ConsentActivationContractName[]) {
    invariant(sameAddress(snapshot.contracts[name], CONSENT_ACTIVATION_CONTRACTS[name]), `${name} address mismatch`);
    invariant(sameHex(snapshot.runtimeCodeHashes[name], CONSENT_ACTIVATION_RUNTIME_CODE_HASHES[name]), `${name} runtime hash mismatch`);
  }
  invariant(sameHex(snapshot.configurationHash, CONSENT_ACTIVATION_CONFIGURATION.configurationHash), "configuration hash mismatch");
  invariant(sameHex(snapshot.termsDocumentHash, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash), "terms document hash mismatch");
  invariant(sameHex(snapshot.migrationTermsHash, CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash), "migration terms hash mismatch");
  invariant(snapshot.operatorIsSigner, "operator is not an active governance signer");
  invariant(snapshot.signerCount === CONSENT_ACTIVATION_CONFIGURATION.signerCount, "governance signer count mismatch");
  invariant(snapshot.threshold === CONSENT_ACTIVATION_CONFIGURATION.threshold, "governance threshold mismatch");
  invariant(snapshot.executionDelaySeconds === CONSENT_ACTIVATION_CONFIGURATION.executionDelaySeconds, "governance delay mismatch");
  invariant(snapshot.executionWindowSeconds === CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds, "governance window mismatch");
  invariant(snapshot.configurationEpoch === CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch, "governance epoch mismatch");
  invariant(snapshot.transactionCount === 0n || snapshot.transactionCount === 1n, "unexpected governance transaction count");
  if (options.expectedTransactionCount !== undefined) {
    invariant(snapshot.transactionCount === options.expectedTransactionCount, "governance transaction count changed");
  }
  if (options.expectedPaused !== undefined) {
    invariant(snapshot.paused === options.expectedPaused, "migrator pause state mismatch");
  }
}

export type ConsentOperatorTransaction = {
  from: Address;
  to: Address | null;
  value: bigint;
  input: Hex;
};

export function assertExactConsentOperatorTransaction(
  transaction: ConsentOperatorTransaction,
  expectedTo: Address,
  expectedInput: Hex
): void {
  invariant(sameAddress(transaction.from, CONSENT_ACTIVATION_OPERATOR), "transaction sender mismatch");
  invariant(transaction.to !== null && sameAddress(transaction.to, expectedTo), "transaction recipient mismatch");
  invariant(transaction.value === 0n, "transaction value must be zero");
  invariant(sameHex(transaction.input, expectedInput), "transaction calldata mismatch");
}

export function assertExactConsentExecutionTransaction(
  transaction: ConsentOperatorTransaction,
  expectedInput: Hex
): void {
  invariant(isAddress(transaction.from) && transaction.from !== "0x0000000000000000000000000000000000000000", "execution sender is invalid");
  invariant(
    transaction.to !== null && sameAddress(transaction.to, CONSENT_ACTIVATION_CONTRACTS.governance),
    "execution recipient mismatch"
  );
  invariant(transaction.value === 0n, "execution transaction value must be zero");
  invariant(sameHex(transaction.input, expectedInput), "execution transaction calldata mismatch");
}

export type ConsentActivationReceiptEvidence = {
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: string;
  from: Address;
  to: Address;
  value: "0";
  input: Hex;
  verifiedAtUtc: string;
};

export type ConsentActivationEvidenceRecord = {
  schemaVersion: typeof CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION;
  releaseId: typeof CONSENT_ACTIVATION_RELEASE_ID;
  chainId: typeof CONSENT_ACTIVATION_CHAIN_ID;
  operator: Address;
  sourceCommit: typeof CONSENT_ACTIVATION_RELEASE.sourceCommit;
  contractSourceSha256: typeof CONSENT_ACTIVATION_RELEASE.contractSourceSha256;
  configurationHash: Hex;
  termsDocumentHash: Hex;
  migrationTermsHash: Hex;
  contracts: Record<ConsentActivationContractName, Address>;
  runtimeCodeHashes: Record<ConsentActivationContractName, Hex>;
  governance: {
    signer: Address;
    signerCount: "1";
    threshold: "1";
    configurationEpoch: "1";
    executionDelaySeconds: "86400";
    executionWindowSeconds: "604800";
  };
  acceptance: {
    phrase: typeof CONSENT_ACTIVATION_ACCEPTANCE_PHRASE;
    acceptedAtUtc: string;
  };
  proposal: {
    id: string;
    blockTimestamp: string;
    executeAfter: string;
    executeBefore: string;
    receipt: ConsentActivationReceiptEvidence;
    verifiedAtBlockNumber: string;
  };
  execution?: {
    receipt: ConsentActivationReceiptEvidence;
    verifiedAtBlockNumber: string;
  };
  cancellation?: {
    receipt: ConsentActivationReceiptEvidence;
    verifiedAtBlockNumber: string;
  };
  emergencyPause?: {
    receipt: ConsentActivationReceiptEvidence;
    verifiedAtBlockNumber: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && isHex(value) && value.length === 66;
}

function decimalString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

function validUtc(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseReceiptEvidence(
  value: unknown,
  expectedTo: Address,
  expectedInput: Hex,
  allowAnySender = false
): ConsentActivationReceiptEvidence {
  invariant(isRecord(value), "invalid activation receipt evidence");
  invariant(isHash(value.transactionHash), "invalid activation transaction hash");
  invariant(isHash(value.blockHash), "invalid activation block hash");
  invariant(decimalString(value.blockNumber), "invalid activation block number");
  invariant(
    typeof value.from === "string" && isAddress(value.from)
      && (allowAnySender
        ? value.from !== "0x0000000000000000000000000000000000000000"
        : sameAddress(value.from, CONSENT_ACTIVATION_OPERATOR)),
    "invalid activation sender"
  );
  invariant(typeof value.to === "string" && sameAddress(value.to, expectedTo), "invalid activation recipient");
  invariant(value.value === "0", "activation receipt value must be zero");
  invariant(typeof value.input === "string" && sameHex(value.input, expectedInput), "invalid activation calldata");
  invariant(validUtc(value.verifiedAtUtc), "invalid activation verification time");
  return value as ConsentActivationReceiptEvidence;
}

export function parseConsentActivationEvidence(value: unknown): ConsentActivationEvidenceRecord {
  invariant(isRecord(value), "invalid activation evidence");
  invariant(value.schemaVersion === CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION, "unsupported activation evidence schema");
  invariant(value.releaseId === CONSENT_ACTIVATION_RELEASE_ID, "activation evidence release mismatch");
  invariant(value.chainId === CONSENT_ACTIVATION_CHAIN_ID, "activation evidence chain mismatch");
  invariant(typeof value.operator === "string" && sameAddress(value.operator, CONSENT_ACTIVATION_OPERATOR), "activation evidence operator mismatch");
  invariant(value.sourceCommit === CONSENT_ACTIVATION_RELEASE.sourceCommit, "activation evidence source commit mismatch");
  invariant(value.contractSourceSha256 === CONSENT_ACTIVATION_RELEASE.contractSourceSha256, "activation evidence source hash mismatch");
  invariant(typeof value.configurationHash === "string" && sameHex(value.configurationHash, CONSENT_ACTIVATION_CONFIGURATION.configurationHash), "activation evidence configuration mismatch");
  invariant(typeof value.termsDocumentHash === "string" && sameHex(value.termsDocumentHash, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash), "activation evidence terms mismatch");
  invariant(typeof value.migrationTermsHash === "string" && sameHex(value.migrationTermsHash, CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash), "activation evidence migration terms mismatch");
  invariant(isRecord(value.contracts), "missing activation contract evidence");
  invariant(isRecord(value.runtimeCodeHashes), "missing activation runtime evidence");
  for (const name of Object.keys(CONSENT_ACTIVATION_CONTRACTS) as ConsentActivationContractName[]) {
    invariant(
      typeof value.contracts[name] === "string" && sameAddress(value.contracts[name], CONSENT_ACTIVATION_CONTRACTS[name]),
      `activation evidence ${name} address mismatch`
    );
    invariant(
      typeof value.runtimeCodeHashes[name] === "string"
        && sameHex(value.runtimeCodeHashes[name], CONSENT_ACTIVATION_RUNTIME_CODE_HASHES[name]),
      `activation evidence ${name} runtime mismatch`
    );
  }
  invariant(isRecord(value.governance), "missing activation governance evidence");
  invariant(typeof value.governance.signer === "string" && sameAddress(value.governance.signer, CONSENT_ACTIVATION_OPERATOR), "activation evidence signer mismatch");
  invariant(value.governance.signerCount === "1", "activation evidence signer count mismatch");
  invariant(value.governance.threshold === "1", "activation evidence threshold mismatch");
  invariant(value.governance.configurationEpoch === "1", "activation evidence epoch mismatch");
  invariant(value.governance.executionDelaySeconds === "86400", "activation evidence delay policy mismatch");
  invariant(value.governance.executionWindowSeconds === "604800", "activation evidence window policy mismatch");
  invariant(isRecord(value.acceptance), "missing activation acceptance");
  invariant(value.acceptance.phrase === CONSENT_ACTIVATION_ACCEPTANCE_PHRASE, "activation acceptance phrase mismatch");
  invariant(validUtc(value.acceptance.acceptedAtUtc), "invalid activation acceptance time");
  invariant(isRecord(value.proposal), "missing activation proposal evidence");
  invariant(decimalString(value.proposal.id), "invalid activation proposal id");
  invariant(decimalString(value.proposal.blockTimestamp), "invalid activation proposal timestamp");
  invariant(decimalString(value.proposal.executeAfter), "invalid activation start time");
  invariant(decimalString(value.proposal.executeBefore), "invalid activation expiry time");
  invariant(decimalString(value.proposal.verifiedAtBlockNumber), "invalid activation verification block");
  const proposalId = BigInt(value.proposal.id);
  const proposalReceipt = parseReceiptEvidence(
    value.proposal.receipt,
    CONSENT_ACTIVATION_CONTRACTS.governance,
    consentProposalCalldata()
  );
  const proposalReceiptBlock = BigInt(proposalReceipt.blockNumber);
  const proposalVerifiedBlock = BigInt(value.proposal.verifiedAtBlockNumber);
  const executeAfter = BigInt(value.proposal.executeAfter);
  const executeBefore = BigInt(value.proposal.executeBefore);
  invariant(proposalId === 0n, "unexpected activation proposal id");
  invariant(
    proposalReceiptBlock <= proposalVerifiedBlock,
    "activation proposal verification predates its mined receipt"
  );
  invariant(
    executeAfter === BigInt(value.proposal.blockTimestamp) + CONSENT_ACTIVATION_CONFIGURATION.executionDelaySeconds,
    "activation evidence delay mismatch"
  );
  invariant(
    executeBefore === executeAfter + CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds,
    "activation evidence window mismatch"
  );
  let execution: ConsentActivationEvidenceRecord["execution"];
  if (value.execution !== undefined) {
    invariant(isRecord(value.execution), "invalid activation execution evidence");
    invariant(decimalString(value.execution.verifiedAtBlockNumber), "invalid activation execution verification block");
    execution = {
      receipt: parseReceiptEvidence(
        value.execution.receipt,
        CONSENT_ACTIVATION_CONTRACTS.governance,
        consentExecuteCalldata(proposalId),
        true
      ),
      verifiedAtBlockNumber: value.execution.verifiedAtBlockNumber
    };
    invariant(
      BigInt(execution.receipt.blockNumber) >= proposalReceiptBlock,
      "activation execution receipt predates the proposal"
    );
    invariant(
      BigInt(execution.receipt.blockNumber) <= BigInt(execution.verifiedAtBlockNumber),
      "activation execution verification predates its mined receipt"
    );
  }
  let cancellation: ConsentActivationEvidenceRecord["cancellation"];
  if (value.cancellation !== undefined) {
    invariant(isRecord(value.cancellation), "invalid activation cancellation evidence");
    invariant(decimalString(value.cancellation.verifiedAtBlockNumber), "invalid activation cancellation verification block");
    cancellation = {
      receipt: parseReceiptEvidence(
        value.cancellation.receipt,
        CONSENT_ACTIVATION_CONTRACTS.governance,
        consentCancelCalldata(proposalId)
      ),
      verifiedAtBlockNumber: value.cancellation.verifiedAtBlockNumber
    };
    invariant(
      BigInt(cancellation.receipt.blockNumber) >= proposalReceiptBlock,
      "activation cancellation receipt predates the proposal"
    );
    invariant(
      BigInt(cancellation.receipt.blockNumber) <= BigInt(cancellation.verifiedAtBlockNumber),
      "activation cancellation verification predates its mined receipt"
    );
  }
  invariant(!(execution && cancellation), "activation evidence cannot be both executed and cancelled");
  invariant(!(cancellation && value.emergencyPause !== undefined), "cancelled activation cannot have emergency pause evidence");
  let emergencyPause: ConsentActivationEvidenceRecord["emergencyPause"];
  if (value.emergencyPause !== undefined) {
    invariant(execution !== undefined, "emergency pause evidence requires a verified execution");
    invariant(isRecord(value.emergencyPause), "invalid emergency pause evidence");
    invariant(decimalString(value.emergencyPause.verifiedAtBlockNumber), "invalid emergency pause verification block");
    emergencyPause = {
      receipt: parseReceiptEvidence(
        value.emergencyPause.receipt,
        CONSENT_ACTIVATION_CONTRACTS.migrator,
        CONSENT_PAUSE_CALLDATA
      ),
      verifiedAtBlockNumber: value.emergencyPause.verifiedAtBlockNumber
    };
    invariant(
      BigInt(emergencyPause.receipt.blockNumber) >= BigInt(execution.receipt.blockNumber),
      "emergency pause receipt predates activation execution"
    );
    invariant(
      BigInt(emergencyPause.receipt.blockNumber) <= BigInt(emergencyPause.verifiedAtBlockNumber),
      "emergency pause verification predates its mined receipt"
    );
  }
  return {
    ...(value as unknown as ConsentActivationEvidenceRecord),
    proposal: { ...(value.proposal as ConsentActivationEvidenceRecord["proposal"]), receipt: proposalReceipt },
    ...(execution ? { execution } : {}),
    ...(cancellation ? { cancellation } : {}),
    ...(emergencyPause ? { emergencyPause } : {})
  };
}
