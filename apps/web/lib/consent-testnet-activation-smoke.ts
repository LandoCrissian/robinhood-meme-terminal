import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toHex, type Hex } from "viem";
import {
  CALCULATED_CONSENT_TESTNET_TERMS_HASH,
  CONSENT_ACTIVATION_ACCEPTANCE_PHRASE,
  CONSENT_ACTIVATION_CHAIN_ID,
  CONSENT_ACTIVATION_CONFIGURATION,
  CONSENT_ACTIVATION_CONTRACTS,
  CONSENT_ACTIVATION_OPERATOR,
  CONSENT_ACTIVATION_RELEASE,
  CONSENT_ACTIVATION_RELEASE_ID,
  CONSENT_ACTIVATION_RUNTIME_CODE_HASHES,
  CONSENT_ACTIVATION_STORAGE_KEY,
  CONSENT_PAUSE_CALLDATA,
  CONSENT_TESTNET_TERMS_TEXT,
  CONSENT_UNPAUSE_CALLDATA,
  assertConsentRecoveryAcceptanceSnapshot,
  assertExactConsentActivationRelease,
  assertExactConsentExecutionTransaction,
  assertExactConsentOperatorTransaction,
  assertExactConsentProposal,
  consentCancelCalldata,
  consentExecuteCalldata,
  consentProposalCalldata,
  getConsentActivationPhase,
  isExactTypedAcceptance,
  parseConsentActivationEvidence,
  type ConsentActivationEvidenceRecord,
  type ConsentActivationReleaseSnapshot,
  type ConsentExactProposal,
  type ConsentGovernanceTransaction
} from "./consent-testnet-activation";

type DurableRecord = {
  release: {
    name: string;
    sourceRepository: string;
    sourceCommit: string;
    contractSourceSha256: string;
    deployedAtUtc: string;
    compiler: {
      version: string;
      evmVersion: string;
      optimizerRuns: number;
      viaIR: boolean;
    };
  };
  network: { chainId: number };
  operator: string;
  create2: {
    venue: { blockNumber: number; deployedAddress: string };
    consentStack: { blockNumber: number; deployedAddress: string };
  };
  contracts: Record<string, { address: string; runtimeCodeHash: string }>;
  configuration: {
    governanceSigner: string;
    guardian: string;
    governanceDelaySeconds: number;
    governanceWindowSeconds: number;
    configurationHash: string;
    termsDocumentHash: string;
    migrationTermsHash: string;
  };
  verification: { snapshotBlockNumber: number };
};

const durableRecord = JSON.parse(readFileSync(
  new URL("../../../packages/contracts/deployments/robinhood-testnet-consent-rehearsal-2026-07-18.json", import.meta.url),
  "utf8"
)) as DurableRecord;
const durableTerms = readFileSync(
  new URL("../../../docs/CONSENT_MIGRATION_TESTNET_TERMS_V1.md", import.meta.url),
  "utf8"
);
const activationPageSource = readFileSync(
  new URL("../app/activate-consent-testnet/page.tsx", import.meta.url),
  "utf8"
);
const activationConsoleSource = readFileSync(
  new URL("../app/activate-consent-testnet/consent-testnet-activation.tsx", import.meta.url),
  "utf8"
);

assert.match(activationPageSource, /process\.env\.NODE_ENV === "production"/);
assert.match(activationPageSource, /process\.env\.VERCEL === "1"/);
assert.match(activationPageSource, /process\.env\.RMT_OPERATOR_CONSOLES_ENABLED !== "true"/);
assert.match(activationPageSource, /process\.env\.RMT_CONSENT_TESTNET_ACTIVATION_ENABLED !== "true"/);
assert.match(activationPageSource, /isLoopbackHost/);
assert.match(activationPageSource, /127\.0\.0\.1/);
assert.match(activationPageSource, /\[::1\]/);
assert.match(activationPageSource, /notFound\(\)/);
assert.doesNotMatch(activationConsoleSource, /functionName:\s*"migrate"/);
assert.doesNotMatch(activationConsoleSource, /functionName:\s*"transfer(?:From)?"/);
assert.match(activationConsoleSource, /assertConsentRecoveryAcceptanceSnapshot/);
const recoveryAcceptanceSource = activationConsoleSource.slice(
  activationConsoleSource.indexOf("async function recordReviewedRecoveryAcceptance"),
  activationConsoleSource.indexOf("async function cancelActivation")
);
assert.equal(
  recoveryAcceptanceSource.match(/inspectExactRelease\(/g)?.length,
  2,
  "recovery acceptance must reread the release immediately before persistence"
);
assert.match(recoveryAcceptanceSource, /inspectExactRelease\(\{ paused: true, transactionCount: 1n \}\)/);
const finalRecoveryGuardIndex = recoveryAcceptanceSource.lastIndexOf("assertConsentRecoveryAcceptanceSnapshot");
const recoveryPersistenceIndex = recoveryAcceptanceSource.indexOf("saveEvidence(recovered)");
assert.ok(
  finalRecoveryGuardIndex >= 0 && recoveryPersistenceIndex > finalRecoveryGuardIndex,
  "the final same-head guard must run before recovery evidence is persisted"
);
assert.doesNotMatch(JSON.stringify(CONSENT_ACTIVATION_RELEASE), /LandoCrissian|sourceRepository/);

assert.equal(CONSENT_TESTNET_TERMS_TEXT, durableTerms, "the embedded terms must preserve every UTF-8 byte");
assert.equal(keccak256(toHex(durableTerms)), CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash);
assert.equal(CALCULATED_CONSENT_TESTNET_TERMS_HASH, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash);
assert.equal(durableRecord.release.name, CONSENT_ACTIVATION_RELEASE.name);
assert.equal(durableRecord.release.sourceCommit, CONSENT_ACTIVATION_RELEASE.sourceCommit);
assert.equal(durableRecord.release.contractSourceSha256, CONSENT_ACTIVATION_RELEASE.contractSourceSha256);
assert.equal(durableRecord.release.deployedAtUtc, CONSENT_ACTIVATION_RELEASE.deployedAtUtc);
assert.equal(durableRecord.release.compiler.version, CONSENT_ACTIVATION_RELEASE.compilerVersion);
assert.equal(durableRecord.release.compiler.evmVersion, CONSENT_ACTIVATION_RELEASE.evmVersion);
assert.equal(durableRecord.release.compiler.optimizerRuns, CONSENT_ACTIVATION_RELEASE.optimizerRuns);
assert.equal(durableRecord.release.compiler.viaIR, CONSENT_ACTIVATION_RELEASE.viaIR);
assert.equal(durableRecord.network.chainId, CONSENT_ACTIVATION_CHAIN_ID);
assert.equal(durableRecord.operator, CONSENT_ACTIVATION_OPERATOR);
assert.equal(durableRecord.create2.venue.blockNumber, Number(CONSENT_ACTIVATION_CONFIGURATION.deploymentStartBlock));
assert.equal(durableRecord.create2.consentStack.blockNumber, Number(CONSENT_ACTIVATION_CONFIGURATION.consentStackDeploymentBlock));
assert.equal(durableRecord.verification.snapshotBlockNumber, Number(CONSENT_ACTIVATION_CONFIGURATION.verificationSnapshotBlock));
assert.equal(durableRecord.configuration.governanceSigner, CONSENT_ACTIVATION_CONFIGURATION.governanceSigner);
assert.equal(durableRecord.configuration.guardian, CONSENT_ACTIVATION_CONFIGURATION.guardian);
assert.equal(durableRecord.configuration.governanceDelaySeconds, Number(CONSENT_ACTIVATION_CONFIGURATION.executionDelaySeconds));
assert.equal(durableRecord.configuration.governanceWindowSeconds, Number(CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds));
assert.equal(durableRecord.configuration.configurationHash, CONSENT_ACTIVATION_CONFIGURATION.configurationHash);
assert.equal(durableRecord.configuration.termsDocumentHash, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash);
assert.equal(durableRecord.configuration.migrationTermsHash, CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash);

for (const [name, address] of Object.entries(CONSENT_ACTIVATION_CONTRACTS)) {
  assert.equal(durableRecord.contracts[name]?.address, address, `${name} address drifted from the durable record`);
  assert.equal(
    durableRecord.contracts[name]?.runtimeCodeHash,
    CONSENT_ACTIVATION_RUNTIME_CODE_HASHES[name as keyof typeof CONSENT_ACTIVATION_RUNTIME_CODE_HASHES],
    `${name} runtime hash drifted from the durable record`
  );
}
assert.equal(durableRecord.create2.venue.deployedAddress, CONSENT_ACTIVATION_CONTRACTS.venue);
assert.equal(durableRecord.create2.consentStack.deployedAddress, CONSENT_ACTIVATION_CONTRACTS.consentStack);

assert.equal(isExactTypedAcceptance(CONSENT_ACTIVATION_ACCEPTANCE_PHRASE), true);
assert.equal(isExactTypedAcceptance(CONSENT_ACTIVATION_ACCEPTANCE_PHRASE.toLowerCase()), false);
assert.equal(isExactTypedAcceptance(`${CONSENT_ACTIVATION_ACCEPTANCE_PHRASE} `), false);
assert.match(CONSENT_ACTIVATION_STORAGE_KEY, /:46630:0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca$/);
assert.equal(CONSENT_UNPAUSE_CALLDATA, "0x3f4ba83a");
assert.equal(CONSENT_PAUSE_CALLDATA, "0x8456cb59");

const releaseSnapshot = (): ConsentActivationReleaseSnapshot => ({
  chainId: BigInt(CONSENT_ACTIVATION_CHAIN_ID),
  operator: CONSENT_ACTIVATION_OPERATOR,
  guardian: CONSENT_ACTIVATION_OPERATOR,
  governanceSigner: CONSENT_ACTIVATION_OPERATOR,
  sourceCommit: CONSENT_ACTIVATION_RELEASE.sourceCommit,
  contractSourceSha256: CONSENT_ACTIVATION_RELEASE.contractSourceSha256,
  contracts: { ...CONSENT_ACTIVATION_CONTRACTS },
  runtimeCodeHashes: { ...CONSENT_ACTIVATION_RUNTIME_CODE_HASHES },
  configurationHash: CONSENT_ACTIVATION_CONFIGURATION.configurationHash,
  termsDocumentHash: CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash,
  migrationTermsHash: CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash,
  operatorIsSigner: true,
  signerCount: 1n,
  threshold: 1n,
  executionDelaySeconds: 86_400n,
  executionWindowSeconds: 604_800n,
  configurationEpoch: 1n,
  transactionCount: 0n,
  paused: true
});

assert.doesNotThrow(() => assertExactConsentActivationRelease(
  releaseSnapshot(),
  { expectedPaused: true, expectedTransactionCount: 0n }
));
assert.throws(() => assertExactConsentActivationRelease({ ...releaseSnapshot(), chainId: 1n }), /wrong activation chain/);
assert.throws(() => assertExactConsentActivationRelease({
  ...releaseSnapshot(),
  contracts: { ...releaseSnapshot().contracts, migrator: CONSENT_ACTIVATION_CONTRACTS.venue }
}), /migrator address mismatch/);
assert.throws(() => assertExactConsentActivationRelease({
  ...releaseSnapshot(),
  runtimeCodeHashes: { ...releaseSnapshot().runtimeCodeHashes, governance: (`0x${"0".repeat(64)}`) as Hex }
}), /governance runtime hash mismatch/);
assert.throws(() => assertExactConsentActivationRelease({ ...releaseSnapshot(), operatorIsSigner: false }), /not an active governance signer/);
assert.throws(() => assertExactConsentActivationRelease({ ...releaseSnapshot(), configurationEpoch: 0n }), /governance epoch mismatch/);
assert.throws(() => assertExactConsentActivationRelease({ ...releaseSnapshot(), transactionCount: 2n }), /unexpected governance transaction count/);
assert.throws(() => assertExactConsentActivationRelease({ ...releaseSnapshot(), paused: false }, { expectedPaused: true }), /pause state mismatch/);

const proposalBlockTimestamp = 2_000_000_000n;
const executeAfter = proposalBlockTimestamp + CONSENT_ACTIVATION_CONFIGURATION.executionDelaySeconds;
const executeBefore = executeAfter + CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds;
const governanceTransaction = (): ConsentGovernanceTransaction => ({
  proposer: CONSENT_ACTIVATION_OPERATOR,
  target: CONSENT_ACTIVATION_CONTRACTS.migrator,
  value: 0n,
  data: CONSENT_UNPAUSE_CALLDATA,
  executeAfter,
  executeBefore,
  configurationEpoch: 1n,
  confirmations: 1n,
  executed: false,
  cancelled: false
});
const exactProposal = (): ConsentExactProposal => ({
  proposalId: 0n,
  proposalBlockTimestamp,
  transactionCount: 1n,
  event: {
    id: 0n,
    configurationEpoch: 1n,
    proposer: CONSENT_ACTIVATION_OPERATOR,
    target: CONSENT_ACTIVATION_CONTRACTS.migrator,
    value: 0n,
    data: CONSENT_UNPAUSE_CALLDATA,
    executeAfter,
    executeBefore
  },
  transaction: governanceTransaction()
});

assert.doesNotThrow(() => assertExactConsentProposal(exactProposal()));
assert.equal(getConsentActivationPhase(0n), "not-proposed");
assert.equal(getConsentActivationPhase(executeAfter - 1n, governanceTransaction()), "waiting");
assert.equal(getConsentActivationPhase(executeAfter, governanceTransaction()), "executable");
assert.equal(getConsentActivationPhase(executeBefore, governanceTransaction()), "executable");
assert.equal(getConsentActivationPhase(executeBefore + 1n, governanceTransaction()), "expired");
assert.equal(getConsentActivationPhase(executeAfter, { ...governanceTransaction(), executed: true }), "executed");
assert.equal(getConsentActivationPhase(executeAfter, { ...governanceTransaction(), cancelled: true }), "cancelled");
assert.equal(getConsentActivationPhase(executeAfter, { ...governanceTransaction(), executed: true, cancelled: true }), "invalid");

const recoverySnapshot = (
  transaction: ConsentGovernanceTransaction = governanceTransaction(),
  latestTimestamp = executeAfter
) => ({
  expectedProposalId: 0n,
  proposalId: 0n,
  latestTimestamp,
  transactionCount: 1n,
  paused: true,
  transaction
});
assert.equal(assertConsentRecoveryAcceptanceSnapshot(recoverySnapshot()), "executable");
assert.equal(
  assertConsentRecoveryAcceptanceSnapshot(recoverySnapshot(governanceTransaction(), executeAfter - 1n)),
  "waiting"
);
assert.throws(() => assertConsentRecoveryAcceptanceSnapshot({
  ...recoverySnapshot(),
  transaction: { ...governanceTransaction(), executed: true }
}), /proposal is executed/);
assert.throws(() => assertConsentRecoveryAcceptanceSnapshot({
  ...recoverySnapshot(),
  transaction: { ...governanceTransaction(), cancelled: true }
}), /proposal is cancelled/);
assert.throws(
  () => assertConsentRecoveryAcceptanceSnapshot(recoverySnapshot(governanceTransaction(), executeBefore + 1n)),
  /proposal is expired/
);
assert.throws(() => assertConsentRecoveryAcceptanceSnapshot({
  ...recoverySnapshot(),
  paused: false
}), /migrator to remain paused/);
assert.throws(() => assertConsentRecoveryAcceptanceSnapshot({
  ...recoverySnapshot(),
  transactionCount: 2n
}), /exactly one governance proposal/);
assert.throws(() => assertConsentRecoveryAcceptanceSnapshot({
  ...recoverySnapshot(),
  proposalId: 1n
}), /proposal changed/);

assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  event: { ...exactProposal().event, target: CONSENT_ACTIVATION_CONTRACTS.venue }
}), /event target mismatch/);
assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  event: { ...exactProposal().event, value: 1n }
}), /value must be zero/);
assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  event: { ...exactProposal().event, data: CONSENT_PAUSE_CALLDATA }
}), /event calldata mismatch/);
assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  transaction: { ...governanceTransaction(), configurationEpoch: 2n }
}), /not the exact activation call/);
assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  transaction: { ...governanceTransaction(), confirmations: 0n }
}), /not the exact activation call/);
assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  transaction: { ...governanceTransaction(), executed: true }
}), /already executed/);
assert.throws(() => assertExactConsentProposal({
  ...exactProposal(),
  transaction: { ...governanceTransaction(), cancelled: true }
}), /was cancelled/);
assert.doesNotThrow(() => assertExactConsentProposal({
  ...exactProposal(),
  transaction: { ...governanceTransaction(), cancelled: true },
  expectedCancelled: true
}));
assert.throws(() => assertExactConsentProposal({ ...exactProposal(), transactionCount: 2n }), /transaction count/);

assert.doesNotThrow(() => assertExactConsentOperatorTransaction(
  {
    from: CONSENT_ACTIVATION_OPERATOR,
    to: CONSENT_ACTIVATION_CONTRACTS.governance,
    value: 0n,
    input: consentProposalCalldata()
  },
  CONSENT_ACTIVATION_CONTRACTS.governance,
  consentProposalCalldata()
));
assert.throws(() => assertExactConsentOperatorTransaction(
  {
    from: CONSENT_ACTIVATION_OPERATOR,
    to: CONSENT_ACTIVATION_CONTRACTS.governance,
    value: 1n,
    input: consentProposalCalldata()
  },
  CONSENT_ACTIVATION_CONTRACTS.governance,
  consentProposalCalldata()
), /value must be zero/);
const permissionlessExecutor = "0x1111111111111111111111111111111111111111" as const;
assert.doesNotThrow(() => assertExactConsentExecutionTransaction(
  {
    from: permissionlessExecutor,
    to: CONSENT_ACTIVATION_CONTRACTS.governance,
    value: 0n,
    input: consentExecuteCalldata(0n)
  },
  consentExecuteCalldata(0n)
));
assert.throws(() => assertExactConsentExecutionTransaction(
  {
    from: permissionlessExecutor,
    to: CONSENT_ACTIVATION_CONTRACTS.migrator,
    value: 0n,
    input: consentExecuteCalldata(0n)
  },
  consentExecuteCalldata(0n)
), /recipient mismatch/);

const hash = (character: string) => (`0x${character.repeat(64)}`) as Hex;
const receipt = (
  transactionHash: Hex,
  blockHash: Hex,
  to: typeof CONSENT_ACTIVATION_CONTRACTS.governance | typeof CONSENT_ACTIVATION_CONTRACTS.migrator,
  input: Hex,
  from = CONSENT_ACTIVATION_OPERATOR
) => ({
  transactionHash,
  blockHash,
  blockNumber: "91299999",
  from,
  to,
  value: "0" as const,
  input,
  verifiedAtUtc: "2026-07-21T12:00:00Z"
});
const evidence: ConsentActivationEvidenceRecord = {
  schemaVersion: 1,
  releaseId: CONSENT_ACTIVATION_RELEASE_ID,
  chainId: CONSENT_ACTIVATION_CHAIN_ID,
  operator: CONSENT_ACTIVATION_OPERATOR,
  sourceCommit: CONSENT_ACTIVATION_RELEASE.sourceCommit,
  contractSourceSha256: CONSENT_ACTIVATION_RELEASE.contractSourceSha256,
  configurationHash: CONSENT_ACTIVATION_CONFIGURATION.configurationHash,
  termsDocumentHash: CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash,
  migrationTermsHash: CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash,
  contracts: { ...CONSENT_ACTIVATION_CONTRACTS },
  runtimeCodeHashes: { ...CONSENT_ACTIVATION_RUNTIME_CODE_HASHES },
  governance: {
    signer: CONSENT_ACTIVATION_OPERATOR,
    signerCount: "1",
    threshold: "1",
    configurationEpoch: "1",
    executionDelaySeconds: "86400",
    executionWindowSeconds: "604800"
  },
  acceptance: {
    phrase: CONSENT_ACTIVATION_ACCEPTANCE_PHRASE,
    acceptedAtUtc: "2026-07-21T11:59:00Z"
  },
  proposal: {
    id: "0",
    blockTimestamp: proposalBlockTimestamp.toString(),
    executeAfter: executeAfter.toString(),
    executeBefore: executeBefore.toString(),
    receipt: receipt(hash("1"), hash("2"), CONSENT_ACTIVATION_CONTRACTS.governance, consentProposalCalldata()),
    verifiedAtBlockNumber: "91300001"
  },
  execution: {
    receipt: receipt(hash("3"), hash("4"), CONSENT_ACTIVATION_CONTRACTS.governance, consentExecuteCalldata(0n), permissionlessExecutor),
    verifiedAtBlockNumber: "91310001"
  },
  emergencyPause: {
    receipt: receipt(hash("5"), hash("6"), CONSENT_ACTIVATION_CONTRACTS.migrator, CONSENT_PAUSE_CALLDATA),
    verifiedAtBlockNumber: "91310002"
  }
};

assert.deepEqual(parseConsentActivationEvidence(evidence), evidence);
const { execution: _execution, emergencyPause: _emergencyPause, ...pendingEvidence } = evidence;
const cancellationEvidence: ConsentActivationEvidenceRecord = {
  ...pendingEvidence,
  cancellation: {
    receipt: receipt(hash("7"), hash("8"), CONSENT_ACTIVATION_CONTRACTS.governance, consentCancelCalldata(0n)),
    verifiedAtBlockNumber: "91310001"
  }
};
assert.deepEqual(parseConsentActivationEvidence(cancellationEvidence), cancellationEvidence);
assert.throws(() => parseConsentActivationEvidence({
  ...evidence,
  cancellation: cancellationEvidence.cancellation
}), /both executed and cancelled/);
assert.throws(() => parseConsentActivationEvidence({
  ...evidence,
  proposal: { ...evidence.proposal, id: "1" }
}), /unexpected activation proposal id/);
assert.throws(() => parseConsentActivationEvidence({
  ...evidence,
  acceptance: { ...evidence.acceptance, phrase: "I accept" }
}), /acceptance phrase mismatch/);
assert.throws(() => parseConsentActivationEvidence({
  ...evidence,
  proposal: { ...evidence.proposal, verifiedAtBlockNumber: "91299998" }
}), /proposal verification predates/);
assert.throws(() => parseConsentActivationEvidence({
  ...evidence,
  execution: { ...evidence.execution!, verifiedAtBlockNumber: "91299998" }
}), /execution verification predates/);
assert.throws(() => parseConsentActivationEvidence({
  ...evidence,
  emergencyPause: { ...evidence.emergencyPause!, verifiedAtBlockNumber: "91299998" }
}), /emergency pause verification predates/);

console.info("Consent testnet activation helper validation passed");
