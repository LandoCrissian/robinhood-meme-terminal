"use client";

import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  getAddress,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt
} from "viem";
import {
  CALCULATED_CONSENT_TESTNET_TERMS_HASH,
  CONSENT_ACTIVATION_ACCEPTANCE_PHRASE,
  CONSENT_ACTIVATION_CHAIN_ID,
  CONSENT_ACTIVATION_CONFIGURATION,
  CONSENT_ACTIVATION_CONTRACTS,
  CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
  CONSENT_ACTIVATION_OPERATOR,
  CONSENT_ACTIVATION_RELEASE,
  CONSENT_ACTIVATION_RELEASE_ID,
  CONSENT_ACTIVATION_RUNTIME_CODE_HASHES,
  CONSENT_ACTIVATION_STORAGE_KEY,
  CONSENT_GOVERNANCE_ABI,
  CONSENT_MIGRATOR_ACTIVATION_ABI,
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
  type ConsentActivationContractName,
  type ConsentActivationEvidenceRecord,
  type ConsentActivationPhase,
  type ConsentActivationReceiptEvidence,
  type ConsentActivationReleaseSnapshot,
  type ConsentGovernanceTransaction,
  type ConsentProposedEvent
} from "../../lib/consent-testnet-activation";

const STACK_READ_ABI = [
  ...(["operator", "venue", "governance", "pairedToken", "weth", "factory", "pool", "positionManager", "session", "migrator"] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "address" as const }]
  })),
  ...(["pairedTokenCodeHash", "wethCodeHash", "venueCodeHash", "governanceCodeHash", "factoryCodeHash", "poolCodeHash", "positionManagerCodeHash", "sessionCodeHash", "migratorCodeHash", "configurationHash", "migrationTermsHash", "TERMS_DOCUMENT_HASH"] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "bytes32" as const }]
  }))
] as const;

const MIGRATOR_READ_ABI = [
  ...CONSENT_MIGRATOR_ACTIVATION_ABI,
  ...(["governance", "guardian", "weth", "pairedToken", "positionManager", "sushiFactory", "sushiPool", "liquiditySession"] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "address" as const }]
  })),
  { type: "function", name: "destinationChainId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "configurationHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "termsDocumentHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "migrationTermsHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }
] as const;

const TOKEN_STATE_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] }
] as const;

const SESSION_STATE_ABI = [
  { type: "function", name: "activeMigrationId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "activeOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const POSITION_MANAGER_STATE_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;
const PAIRED_TOKEN_FIXED_SUPPLY = 1_000_000_000n * 10n ** 18n;
const WETH_FIXED_SUPPLY = 1_000_000n * 10n ** 18n;
const PRISTINE_BALANCE_ADDRESSES = [
  CONSENT_ACTIVATION_CONTRACTS.pool,
  CONSENT_ACTIVATION_CONTRACTS.session,
  CONSENT_ACTIVATION_CONTRACTS.migrator,
  CONSENT_ACTIVATION_CONTRACTS.positionManager
] as const;

type InspectionState = "idle" | "checking" | "verified" | "blocked";

type ExactProposal = {
  id: bigint;
  blockTimestamp: bigint;
  event: ConsentProposedEvent;
  transaction: ConsentGovernanceTransaction;
  proposalTransactionHash: Hex;
  proposalReceipt: ConsentActivationReceiptEvidence;
};

type ReleaseInspection = {
  snapshot: ConsentActivationReleaseSnapshot;
  latestBlock: bigint;
  latestTimestamp: bigint;
  runtimeMatches: number;
};

type ProposedLog = {
  eventName: "Proposed";
  args: ConsentProposedEvent;
  transactionHash: Hex;
  blockNumber: bigint;
};

const EVIDENCE_RELEASE_BINDING = {
  contracts: { ...CONSENT_ACTIVATION_CONTRACTS },
  runtimeCodeHashes: { ...CONSENT_ACTIVATION_RUNTIME_CODE_HASHES },
  governance: {
    signer: CONSENT_ACTIVATION_OPERATOR,
    signerCount: "1",
    threshold: "1",
    configurationEpoch: "1",
    executionDelaySeconds: "86400",
    executionWindowSeconds: "604800"
  }
} as const;

function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function explorerAddress(address: Address) {
  return `https://explorer.testnet.chain.robinhood.com/address/${address}`;
}

function explorerTransaction(hash: Hex) {
  return `https://explorer.testnet.chain.robinhood.com/tx/${hash}`;
}

function readableTime(timestamp?: bigint) {
  if (timestamp === undefined) return "Not scheduled";
  return new Date(Number(timestamp) * 1_000).toLocaleString();
}

function describeError(cause: unknown) {
  let current = cause;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === 4001) return "The wallet cancelled this step. No replacement transaction was submitted.";
    current = candidate.cause;
  }
  return cause instanceof Error ? cause.message : "The activation check stopped safely.";
}

function phaseLabel(phase: ConsentActivationPhase) {
  switch (phase) {
    case "not-proposed": return "Not proposed";
    case "waiting": return "24-hour delay";
    case "executable": return "Execution window open";
    case "executed": return "Executed and verified";
    case "expired": return "Proposal expired";
    case "cancelled": return "Proposal cancelled";
    default: return "Blocked";
  }
}

function loadSavedEvidence() {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(CONSENT_ACTIVATION_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return parseConsentActivationEvidence(JSON.parse(raw) as unknown);
  } catch {
    window.localStorage.removeItem(CONSENT_ACTIVATION_STORAGE_KEY);
    return undefined;
  }
}

function saveEvidence(evidence: ConsentActivationEvidenceRecord) {
  window.localStorage.setItem(CONSENT_ACTIVATION_STORAGE_KEY, JSON.stringify(evidence));
}

export function ConsentTestnetActivation() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const [inspectionState, setInspectionState] = useState<InspectionState>("idle");
  const [inspection, setInspection] = useState<ReleaseInspection>();
  const [proposal, setProposal] = useState<ExactProposal>();
  const [phase, setPhase] = useState<ConsentActivationPhase>("not-proposed");
  const [evidence, setEvidence] = useState<ConsentActivationEvidenceRecord>();
  const [livePaused, setLivePaused] = useState<boolean>();
  const [cancelledTransactionHash, setCancelledTransactionHash] = useState<Hex>();
  const [acceptance, setAcceptance] = useState("");
  const [status, setStatus] = useState("Ready to reproduce the pinned release checks");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);
  const refreshInFlight = useRef(false);

  const operatorConnected = Boolean(address && sameAddress(address, CONSENT_ACTIVATION_OPERATOR));
  const correctChain = chainId === CONSENT_ACTIVATION_CHAIN_ID;
  const walletReady = Boolean(isConnected && operatorConnected && correctChain && walletClient);
  const exactAcceptance = isExactTypedAcceptance(acceptance);
  const runtimeEntries = useMemo(
    () => Object.entries(CONSENT_ACTIVATION_CONTRACTS) as [ConsentActivationContractName, Address][],
    []
  );

  const readStack = useCallback(async (
    functionName: (typeof STACK_READ_ABI)[number]["name"],
    blockNumber: bigint
  ) => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    return publicClient.readContract({
      address: CONSENT_ACTIVATION_CONTRACTS.consentStack,
      abi: STACK_READ_ABI,
      functionName,
      blockNumber
    });
  }, [publicClient]);

  const readMigrator = useCallback(async (
    functionName: Exclude<(typeof MIGRATOR_READ_ABI)[number]["name"], "pause" | "unpause" | "PauseChanged">,
    blockNumber: bigint
  ) => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    return publicClient.readContract({
      address: CONSENT_ACTIVATION_CONTRACTS.migrator,
      abi: MIGRATOR_READ_ABI,
      functionName,
      blockNumber
    });
  }, [publicClient]);

  const inspectExactRelease = useCallback(async (expected?: { paused?: boolean; transactionCount?: 0n | 1n }) => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    const chain = await publicClient.getChainId();
    if (chain !== CONSENT_ACTIVATION_CHAIN_ID) throw new Error("RPC chain mismatch; expected Robinhood Chain Testnet 46630.");
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const blockNumber = latestBlock.number;

    const codePairs = await Promise.all(runtimeEntries.map(async ([name, contractAddress]) => {
      const code = await publicClient.getBytecode({ address: contractAddress, blockNumber });
      if (!code || code === "0x") throw new Error(`${name} runtime code is missing.`);
      const hash = keccak256(code);
      if (!sameHex(hash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES[name])) {
        throw new Error(`${name} runtime hash differs from the pinned release.`);
      }
      return [name, hash] as const;
    }));
    const runtimeCodeHashes = Object.fromEntries(codePairs) as ConsentActivationReleaseSnapshot["runtimeCodeHashes"];

    const [
      stackOperator, stackVenue, stackGovernance, stackPairedToken, stackWeth, stackFactory, stackPool,
      stackPositionManager, stackSession, stackMigrator, stackPairedHash, stackWethHash, stackVenueHash,
      stackGovernanceHash, stackFactoryHash, stackPoolHash, stackManagerHash, stackSessionHash,
      stackMigratorHash, stackConfigurationHash, stackMigrationTermsHash, stackTermsDocumentHash,
      guardian, migratorGovernance, migratorWeth, migratorPairedToken, migratorManager, migratorFactory,
      migratorPool, migratorSession, destinationChainId, migratorConfigurationHash,
      migratorTermsDocumentHash, migratorMigrationTermsHash, paused,
      operatorIsSigner, signerCount, threshold, executionDelay, executionWindow, configurationEpoch,
      transactionCount
    ] = await Promise.all([
      readStack("operator", blockNumber), readStack("venue", blockNumber), readStack("governance", blockNumber), readStack("pairedToken", blockNumber),
      readStack("weth", blockNumber), readStack("factory", blockNumber), readStack("pool", blockNumber), readStack("positionManager", blockNumber),
      readStack("session", blockNumber), readStack("migrator", blockNumber), readStack("pairedTokenCodeHash", blockNumber),
      readStack("wethCodeHash", blockNumber), readStack("venueCodeHash", blockNumber), readStack("governanceCodeHash", blockNumber),
      readStack("factoryCodeHash", blockNumber), readStack("poolCodeHash", blockNumber), readStack("positionManagerCodeHash", blockNumber),
      readStack("sessionCodeHash", blockNumber), readStack("migratorCodeHash", blockNumber), readStack("configurationHash", blockNumber),
      readStack("migrationTermsHash", blockNumber), readStack("TERMS_DOCUMENT_HASH", blockNumber), readMigrator("guardian", blockNumber),
      readMigrator("governance", blockNumber), readMigrator("weth", blockNumber), readMigrator("pairedToken", blockNumber),
      readMigrator("positionManager", blockNumber), readMigrator("sushiFactory", blockNumber), readMigrator("sushiPool", blockNumber),
      readMigrator("liquiditySession", blockNumber), readMigrator("destinationChainId", blockNumber), readMigrator("configurationHash", blockNumber),
      readMigrator("termsDocumentHash", blockNumber), readMigrator("migrationTermsHash", blockNumber), readMigrator("paused", blockNumber),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "isSigner", args: [CONSENT_ACTIVATION_OPERATOR], blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "signerCount", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "threshold", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "executionDelay", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "executionWindow", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "configurationEpoch", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "transactionCount", blockNumber })
    ]);

    const exactAddressPairs: [unknown, Address, string][] = [
      [stackOperator, CONSENT_ACTIVATION_OPERATOR, "stack operator"],
      [stackVenue, CONSENT_ACTIVATION_CONTRACTS.venue, "stack venue"],
      [stackGovernance, CONSENT_ACTIVATION_CONTRACTS.governance, "stack governance"],
      [stackPairedToken, CONSENT_ACTIVATION_CONTRACTS.pairedToken, "stack paired token"],
      [stackWeth, CONSENT_ACTIVATION_CONTRACTS.weth, "stack WETH fixture"],
      [stackFactory, CONSENT_ACTIVATION_CONTRACTS.factory, "stack factory"],
      [stackPool, CONSENT_ACTIVATION_CONTRACTS.pool, "stack pool"],
      [stackPositionManager, CONSENT_ACTIVATION_CONTRACTS.positionManager, "stack position manager"],
      [stackSession, CONSENT_ACTIVATION_CONTRACTS.session, "stack session"],
      [stackMigrator, CONSENT_ACTIVATION_CONTRACTS.migrator, "stack migrator"],
      [guardian, CONSENT_ACTIVATION_OPERATOR, "migrator guardian"],
      [migratorGovernance, CONSENT_ACTIVATION_CONTRACTS.governance, "migrator governance"],
      [migratorWeth, CONSENT_ACTIVATION_CONTRACTS.weth, "migrator WETH fixture"],
      [migratorPairedToken, CONSENT_ACTIVATION_CONTRACTS.pairedToken, "migrator paired token"],
      [migratorManager, CONSENT_ACTIVATION_CONTRACTS.positionManager, "migrator position manager"],
      [migratorFactory, CONSENT_ACTIVATION_CONTRACTS.factory, "migrator factory"],
      [migratorPool, CONSENT_ACTIVATION_CONTRACTS.pool, "migrator pool"],
      [migratorSession, CONSENT_ACTIVATION_CONTRACTS.session, "migrator session"]
    ];
    for (const [actual, exact, label] of exactAddressPairs) {
      if (typeof actual !== "string" || !sameAddress(actual, exact)) throw new Error(`${label} mismatch.`);
    }

    const exactStackHashes: [unknown, Hex, string][] = [
      [stackPairedHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.pairedToken, "paired token binding"],
      [stackWethHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.weth, "WETH binding"],
      [stackVenueHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.venue, "venue binding"],
      [stackGovernanceHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.governance, "governance binding"],
      [stackFactoryHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.factory, "factory binding"],
      [stackPoolHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.pool, "pool binding"],
      [stackManagerHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.positionManager, "manager binding"],
      [stackSessionHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.session, "session binding"],
      [stackMigratorHash, CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.migrator, "migrator binding"],
      [stackConfigurationHash, CONSENT_ACTIVATION_CONFIGURATION.configurationHash, "stack configuration"],
      [stackTermsDocumentHash, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash, "stack terms"],
      [stackMigrationTermsHash, CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash, "stack migration terms"],
      [migratorConfigurationHash, CONSENT_ACTIVATION_CONFIGURATION.configurationHash, "migrator configuration"],
      [migratorTermsDocumentHash, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash, "migrator terms"],
      [migratorMigrationTermsHash, CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash, "migrator migration terms"]
    ];
    for (const [actual, exact, label] of exactStackHashes) {
      if (typeof actual !== "string" || !sameHex(actual, exact)) throw new Error(`${label} hash mismatch.`);
    }
    if (!sameHex(CALCULATED_CONSENT_TESTNET_TERMS_HASH, CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash)) {
      throw new Error("The bundled immutable terms bytes do not match the deployed terms hash.");
    }

    const [
      positionSupply, activeMigrationId, activeOwner, pairedSupply, wethSupply,
      operatorPairedBalance, operatorWethBalance, sessionPairedAllowance, sessionWethAllowance,
      ...zeroBalances
    ] = await Promise.all([
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.positionManager, abi: POSITION_MANAGER_STATE_ABI, functionName: "totalSupply", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.session, abi: SESSION_STATE_ABI, functionName: "activeMigrationId", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.session, abi: SESSION_STATE_ABI, functionName: "activeOwner", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.pairedToken, abi: TOKEN_STATE_ABI, functionName: "totalSupply", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.weth, abi: TOKEN_STATE_ABI, functionName: "totalSupply", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.pairedToken, abi: TOKEN_STATE_ABI, functionName: "balanceOf", args: [CONSENT_ACTIVATION_OPERATOR], blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.weth, abi: TOKEN_STATE_ABI, functionName: "balanceOf", args: [CONSENT_ACTIVATION_OPERATOR], blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.pairedToken, abi: TOKEN_STATE_ABI, functionName: "allowance", args: [CONSENT_ACTIVATION_CONTRACTS.session, CONSENT_ACTIVATION_CONTRACTS.positionManager], blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.weth, abi: TOKEN_STATE_ABI, functionName: "allowance", args: [CONSENT_ACTIVATION_CONTRACTS.session, CONSENT_ACTIVATION_CONTRACTS.positionManager], blockNumber }),
      ...PRISTINE_BALANCE_ADDRESSES.flatMap((holder) => [
        publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.pairedToken, abi: TOKEN_STATE_ABI, functionName: "balanceOf", args: [holder], blockNumber }),
        publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.weth, abi: TOKEN_STATE_ABI, functionName: "balanceOf", args: [holder], blockNumber })
      ])
    ]);
    if (
      positionSupply !== 0n || activeMigrationId !== ZERO_BYTES32
      || typeof activeOwner !== "string" || !sameAddress(activeOwner, ZERO_ADDRESS)
      || pairedSupply !== PAIRED_TOKEN_FIXED_SUPPLY || wethSupply !== WETH_FIXED_SUPPLY
      || operatorPairedBalance !== PAIRED_TOKEN_FIXED_SUPPLY || operatorWethBalance !== WETH_FIXED_SUPPLY
      || sessionPairedAllowance !== 0n || sessionWethAllowance !== 0n
      || zeroBalances.some((balance) => balance !== 0n)
    ) throw new Error("The rehearsal is not pristine: a position, active session, token balance, fixed supply, operator inventory, or session allowance changed.");

    const contracts = { ...CONSENT_ACTIVATION_CONTRACTS } as ConsentActivationReleaseSnapshot["contracts"];
    const snapshot: ConsentActivationReleaseSnapshot = {
      chainId: BigInt(chain),
      operator: getAddress(String(stackOperator)),
      guardian: getAddress(String(guardian)),
      governanceSigner: CONSENT_ACTIVATION_OPERATOR,
      sourceCommit: CONSENT_ACTIVATION_RELEASE.sourceCommit,
      contractSourceSha256: CONSENT_ACTIVATION_RELEASE.contractSourceSha256,
      contracts,
      runtimeCodeHashes,
      configurationHash: String(migratorConfigurationHash) as Hex,
      termsDocumentHash: String(migratorTermsDocumentHash) as Hex,
      migrationTermsHash: String(migratorMigrationTermsHash) as Hex,
      operatorIsSigner: operatorIsSigner as boolean,
      signerCount: signerCount as bigint,
      threshold: threshold as bigint,
      executionDelaySeconds: executionDelay as bigint,
      executionWindowSeconds: executionWindow as bigint,
      configurationEpoch: configurationEpoch as bigint,
      transactionCount: transactionCount as bigint,
      paused: paused as boolean
    };
    if (destinationChainId !== BigInt(CONSENT_ACTIVATION_CHAIN_ID)) throw new Error("Migrator destination chain mismatch.");
    assertExactConsentActivationRelease(snapshot, {
      ...(expected?.paused !== undefined ? { expectedPaused: expected.paused } : {}),
      ...(expected?.transactionCount !== undefined ? { expectedTransactionCount: expected.transactionCount } : {})
    });
    return {
      snapshot,
      latestBlock: blockNumber,
      latestTimestamp: latestBlock.timestamp,
      runtimeMatches: codePairs.length
    } satisfies ReleaseInspection;
  }, [publicClient, readMigrator, readStack, runtimeEntries]);

  const readGovernanceTransaction = useCallback(async (
    id: bigint,
    blockNumber?: bigint
  ): Promise<ConsentGovernanceTransaction> => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    const transaction = await publicClient.readContract({
      address: CONSENT_ACTIVATION_CONTRACTS.governance,
      abi: CONSENT_GOVERNANCE_ABI,
      functionName: "getTransaction",
      args: [id],
      blockNumber
    });
    return transaction as ConsentGovernanceTransaction;
  }, [publicClient]);

  const readRecoveryAcceptanceHead = useCallback(async (id: bigint) => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    if ((await publicClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) {
      throw new Error("RPC chain mismatch during the final recovery check.");
    }
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const blockNumber = latestBlock.number;
    const [transactionCount, transaction, paused] = await Promise.all([
      publicClient.readContract({
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "transactionCount",
        blockNumber
      }),
      readGovernanceTransaction(id, blockNumber),
      readMigrator("paused", blockNumber)
    ]);
    return {
      latestBlock: blockNumber,
      latestTimestamp: latestBlock.timestamp,
      transactionCount: transactionCount as bigint,
      transaction,
      paused: paused as boolean
    };
  }, [publicClient, readGovernanceTransaction, readMigrator]);

  const readLogs = useCallback(async (contract: Address, exactToBlock?: bigint) => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    const latest = exactToBlock ?? await publicClient.getBlockNumber();
    const logs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
    const chunk = 20_000n;
    for (let fromBlock = CONSENT_ACTIVATION_CONFIGURATION.deploymentStartBlock; fromBlock <= latest; fromBlock += chunk) {
      const end = fromBlock + chunk - 1n;
      logs.push(...await publicClient.getLogs({
        address: contract,
        fromBlock,
        toBlock: end < latest ? end : latest
      }));
    }
    return logs;
  }, [publicClient]);

  const receiptEvidence = useCallback(async (
    receipt: TransactionReceipt,
    expectedTo: Address,
    expectedInput: Hex,
    allowAnyExecutionSender = false
  ): Promise<ConsentActivationReceiptEvidence> => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    if (receipt.status !== "success") throw new Error("The mined transaction reverted.");
    const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
    const envelope = {
      from: transaction.from,
      to: transaction.to,
      value: transaction.value,
      input: transaction.input
    };
    if (allowAnyExecutionSender) assertExactConsentExecutionTransaction(envelope, expectedInput);
    else assertExactConsentOperatorTransaction(envelope, expectedTo, expectedInput);
    return {
      transactionHash: receipt.transactionHash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber.toString(),
      from: getAddress(transaction.from),
      to: getAddress(expectedTo),
      value: "0",
      input: expectedInput,
      verifiedAtUtc: new Date().toISOString()
    };
  }, [publicClient]);

  const recoverExactProposal = useCallback(async (release: ReleaseInspection): Promise<ExactProposal | undefined> => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    if (release.snapshot.transactionCount === 0n) return undefined;
    if (release.snapshot.transactionCount !== 1n) throw new Error("Governance contains an unexpected additional transaction.");
    const logs = await readLogs(CONSENT_ACTIVATION_CONTRACTS.governance, release.latestBlock);
    const proposedLogs = parseEventLogs({
      abi: CONSENT_GOVERNANCE_ABI,
      eventName: "Proposed",
      logs,
      strict: true
    }) as unknown as ProposedLog[];
    if (proposedLogs.length !== 1) throw new Error("Could not recover one unique governance proposal.");
    const proposed = proposedLogs[0];
    const [governanceTransaction, proposalBlock, receipt] = await Promise.all([
      readGovernanceTransaction(proposed.args.id, release.latestBlock),
      publicClient.getBlock({ blockNumber: proposed.blockNumber }),
      publicClient.getTransactionReceipt({ hash: proposed.transactionHash })
    ]);
    const verifiedReceipt = await receiptEvidence(
      receipt,
      CONSENT_ACTIVATION_CONTRACTS.governance,
      consentProposalCalldata()
    );
    assertExactConsentProposal({
      proposalId: proposed.args.id,
      proposalBlockTimestamp: proposalBlock.timestamp,
      transactionCount: release.snapshot.transactionCount,
      event: proposed.args,
      transaction: governanceTransaction,
      expectedExecuted: governanceTransaction.executed,
      expectedCancelled: governanceTransaction.cancelled
    });
    return {
      id: proposed.args.id,
      blockTimestamp: proposalBlock.timestamp,
      event: proposed.args,
      transaction: governanceTransaction,
      proposalTransactionHash: proposed.transactionHash,
      proposalReceipt: verifiedReceipt
    };
  }, [publicClient, readGovernanceTransaction, readLogs, receiptEvidence]);

  const recoverMinimalGovernanceProposal = useCallback(async () => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    if ((await publicClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) {
      throw new Error("RPC chain mismatch; expected Robinhood Chain Testnet 46630.");
    }
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const blockNumber = latestBlock.number;
    const [code, operatorIsSigner, signerCount, threshold, executionDelay, executionWindow, epoch, transactionCount] = await Promise.all([
      publicClient.getBytecode({ address: CONSENT_ACTIVATION_CONTRACTS.governance, blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "isSigner", args: [CONSENT_ACTIVATION_OPERATOR], blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "signerCount", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "threshold", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "executionDelay", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "executionWindow", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "configurationEpoch", blockNumber }),
      publicClient.readContract({ address: CONSENT_ACTIVATION_CONTRACTS.governance, abi: CONSENT_GOVERNANCE_ABI, functionName: "transactionCount", blockNumber })
    ]);
    if (
      !code || code === "0x" || !sameHex(keccak256(code), CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.governance)
      || operatorIsSigner !== true || signerCount !== CONSENT_ACTIVATION_CONFIGURATION.signerCount
      || threshold !== CONSENT_ACTIVATION_CONFIGURATION.threshold
      || executionDelay !== CONSENT_ACTIVATION_CONFIGURATION.executionDelaySeconds
      || executionWindow !== CONSENT_ACTIVATION_CONFIGURATION.executionWindowSeconds
      || epoch !== CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch || transactionCount !== 1n
    ) throw new Error("Pinned governance no longer matches the exact signer, runtime, timing and transaction state required for cancellation.");
    const logs = await readLogs(CONSENT_ACTIVATION_CONTRACTS.governance, blockNumber);
    const proposedLogs = parseEventLogs({
      abi: CONSENT_GOVERNANCE_ABI,
      eventName: "Proposed",
      logs,
      strict: true
    }) as unknown as ProposedLog[];
    if (proposedLogs.length !== 1) throw new Error("Could not recover one unique activation proposal for cancellation.");
    const event = proposedLogs[0];
    const [transaction, proposalBlock, receipt] = await Promise.all([
      readGovernanceTransaction(event.args.id, blockNumber),
      publicClient.getBlock({ blockNumber: event.blockNumber }),
      publicClient.getTransactionReceipt({ hash: event.transactionHash })
    ]);
    assertExactConsentProposal({
      proposalId: event.args.id,
      proposalBlockTimestamp: proposalBlock.timestamp,
      transactionCount: 1n,
      event: event.args,
      transaction,
      expectedExecuted: transaction.executed,
      expectedCancelled: transaction.cancelled
    });
    const proposalReceipt = await receiptEvidence(
      receipt,
      CONSENT_ACTIVATION_CONTRACTS.governance,
      consentProposalCalldata()
    );
    return {
      proposal: {
        id: event.args.id,
        blockTimestamp: proposalBlock.timestamp,
        event: event.args,
        transaction,
        proposalTransactionHash: event.transactionHash,
        proposalReceipt
      } satisfies ExactProposal,
      latestBlock: blockNumber,
      latestTimestamp: latestBlock.timestamp
    };
  }, [publicClient, readGovernanceTransaction, readLogs, receiptEvidence]);

  const inspectMinimalEmergencyPause = useCallback(async (expectedPaused: boolean) => {
    if (!publicClient) throw new Error("Robinhood testnet provider is unavailable.");
    if ((await publicClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) {
      throw new Error("RPC chain mismatch; expected Robinhood Chain Testnet 46630.");
    }
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const blockNumber = latestBlock.number;
    const [code, guardian, governance, destinationChainId, paused] = await Promise.all([
      publicClient.getBytecode({ address: CONSENT_ACTIVATION_CONTRACTS.migrator, blockNumber }),
      readMigrator("guardian", blockNumber),
      readMigrator("governance", blockNumber),
      readMigrator("destinationChainId", blockNumber),
      readMigrator("paused", blockNumber)
    ]);
    if (
      !code || code === "0x" || !sameHex(keccak256(code), CONSENT_ACTIVATION_RUNTIME_CODE_HASHES.migrator)
      || typeof guardian !== "string" || !sameAddress(guardian, CONSENT_ACTIVATION_OPERATOR)
      || typeof governance !== "string" || !sameAddress(governance, CONSENT_ACTIVATION_CONTRACTS.governance)
      || destinationChainId !== BigInt(CONSENT_ACTIVATION_CHAIN_ID) || paused !== expectedPaused
    ) throw new Error("Pinned migrator runtime, guardian, governance, chain or pause state failed the emergency snapshot check.");
    return { blockNumber, timestamp: latestBlock.timestamp };
  }, [publicClient, readMigrator]);

  const recoverExecutionEvidence = useCallback(async (exactProposal: ExactProposal, exactToBlock: bigint) => {
    if (!publicClient || !exactProposal.transaction.executed) return undefined;
    const logs = await readLogs(CONSENT_ACTIVATION_CONTRACTS.governance, exactToBlock);
    const executed = parseEventLogs({
      abi: CONSENT_GOVERNANCE_ABI,
      eventName: "Executed",
      logs,
      strict: true
    }) as unknown as { args: { id: bigint; configurationEpoch: bigint; executor: Address }; transactionHash: Hex }[];
    const matches = executed.filter((entry) => entry.args.id === exactProposal.id);
    if (matches.length !== 1) throw new Error("Could not recover one unique execution event.");
    const match = matches[0];
    if (
      match.args.configurationEpoch !== CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch
    ) throw new Error("The mined execution event does not match the fixed operator release.");
    const receipt = await publicClient.getTransactionReceipt({ hash: match.transactionHash });
    const exactExecutionReceipt = await receiptEvidence(
      receipt,
      CONSENT_ACTIVATION_CONTRACTS.governance,
      consentExecuteCalldata(exactProposal.id),
      true
    );
    if (!sameAddress(match.args.executor, exactExecutionReceipt.from)) {
      throw new Error("The Executed event caller differs from the mined execution sender.");
    }
    const pauseEvents = parseEventLogs({
      abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
      eventName: "PauseChanged",
      logs: receipt.logs,
      strict: true
    }) as unknown as { address: Address; args: { paused: boolean; caller: Address } }[];
    if (
      pauseEvents.length !== 1 || pauseEvents[0].args.paused !== false
      || !sameAddress(pauseEvents[0].address, CONSENT_ACTIVATION_CONTRACTS.migrator)
      || !sameAddress(pauseEvents[0].args.caller, CONSENT_ACTIVATION_CONTRACTS.governance)
    ) throw new Error("The execution receipt is missing the exact governance unpause event.");
    return {
      receipt: exactExecutionReceipt,
      verifiedAtBlockNumber: (await publicClient.getBlockNumber()).toString()
    } satisfies NonNullable<ConsentActivationEvidenceRecord["execution"]>;
  }, [publicClient, readLogs, receiptEvidence]);

  const recoverCancellationEvidence = useCallback(async (exactProposal: ExactProposal, exactToBlock: bigint) => {
    if (!publicClient || !exactProposal.transaction.cancelled) return undefined;
    const logs = await readLogs(CONSENT_ACTIVATION_CONTRACTS.governance, exactToBlock);
    const cancelled = parseEventLogs({
      abi: CONSENT_GOVERNANCE_ABI,
      eventName: "Cancelled",
      logs,
      strict: true
    }) as unknown as { args: { id: bigint; configurationEpoch: bigint; signer: Address }; transactionHash: Hex }[];
    const matches = cancelled.filter((entry) => entry.args.id === exactProposal.id);
    if (matches.length !== 1) throw new Error("Could not recover one unique cancellation event.");
    const match = matches[0];
    if (
      match.args.configurationEpoch !== CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch
      || !sameAddress(match.args.signer, CONSENT_ACTIVATION_OPERATOR)
    ) throw new Error("The cancellation event does not match the fixed signer release.");
    const receipt = await publicClient.getTransactionReceipt({ hash: match.transactionHash });
    return {
      receipt: await receiptEvidence(
        receipt,
        CONSENT_ACTIVATION_CONTRACTS.governance,
        consentCancelCalldata(exactProposal.id)
      ),
      verifiedAtBlockNumber: exactToBlock.toString()
    } satisfies NonNullable<ConsentActivationEvidenceRecord["cancellation"]>;
  }, [publicClient, readLogs, receiptEvidence]);

  const recoverEmergencyPauseEvidence = useCallback(async (
    exactProposal: ExactProposal,
    exactToBlock: bigint,
    saved?: ConsentActivationEvidenceRecord
  ) => {
    if (!publicClient || !saved?.emergencyPause || !exactProposal.transaction.executed) return undefined;
    const receipt = await publicClient.getTransactionReceipt({ hash: saved.emergencyPause.receipt.transactionHash });
    if (receipt.blockNumber > exactToBlock) throw new Error("Saved emergency pause receipt is newer than the release snapshot.");
    const exactReceipt = await receiptEvidence(
      receipt,
      CONSENT_ACTIVATION_CONTRACTS.migrator,
      CONSENT_PAUSE_CALLDATA
    );
    const events = parseEventLogs({
      abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
      eventName: "PauseChanged",
      logs: receipt.logs,
      strict: true
    }) as unknown as { address: Address; args: { paused: boolean; caller: Address } }[];
    if (
      events.length !== 1 || events[0].args.paused !== true
      || !sameAddress(events[0].address, CONSENT_ACTIVATION_CONTRACTS.migrator)
      || !sameAddress(events[0].args.caller, CONSENT_ACTIVATION_OPERATOR)
    ) throw new Error("Saved emergency pause evidence does not reproduce its exact guardian event.");
    return {
      receipt: exactReceipt,
      verifiedAtBlockNumber: exactToBlock.toString()
    } satisfies NonNullable<ConsentActivationEvidenceRecord["emergencyPause"]>;
  }, [publicClient, receiptEvidence]);

  const buildRecoveredEvidence = useCallback(async (
    release: ReleaseInspection,
    exactProposal: ExactProposal,
    saved?: ConsentActivationEvidenceRecord
  ) => {
    const [execution, cancellation, emergencyPause] = await Promise.all([
      recoverExecutionEvidence(exactProposal, release.latestBlock),
      recoverCancellationEvidence(exactProposal, release.latestBlock),
      recoverEmergencyPauseEvidence(exactProposal, release.latestBlock, saved)
    ]);
    if (!saved) return undefined;
    if (
      saved.proposal.id !== exactProposal.id.toString()
      || saved.proposal.blockTimestamp !== exactProposal.blockTimestamp.toString()
      || saved.proposal.executeAfter !== exactProposal.transaction.executeAfter.toString()
      || saved.proposal.executeBefore !== exactProposal.transaction.executeBefore.toString()
      || !sameHex(saved.proposal.receipt.transactionHash, exactProposal.proposalReceipt.transactionHash)
      || !sameHex(saved.proposal.receipt.blockHash, exactProposal.proposalReceipt.blockHash)
      || saved.proposal.receipt.blockNumber !== exactProposal.proposalReceipt.blockNumber
    ) return undefined;
    const next: ConsentActivationEvidenceRecord = {
      schemaVersion: CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
      releaseId: CONSENT_ACTIVATION_RELEASE_ID,
      chainId: CONSENT_ACTIVATION_CHAIN_ID,
      operator: CONSENT_ACTIVATION_OPERATOR,
      sourceCommit: CONSENT_ACTIVATION_RELEASE.sourceCommit,
      contractSourceSha256: CONSENT_ACTIVATION_RELEASE.contractSourceSha256,
      configurationHash: CONSENT_ACTIVATION_CONFIGURATION.configurationHash,
      termsDocumentHash: CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash,
      migrationTermsHash: CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash,
      ...EVIDENCE_RELEASE_BINDING,
      acceptance: saved.acceptance,
      proposal: {
        id: exactProposal.id.toString(),
        blockTimestamp: exactProposal.blockTimestamp.toString(),
        executeAfter: exactProposal.transaction.executeAfter.toString(),
        executeBefore: exactProposal.transaction.executeBefore.toString(),
        receipt: exactProposal.proposalReceipt,
        verifiedAtBlockNumber: release.latestBlock.toString()
      },
      ...(execution ? { execution } : {}),
      ...(cancellation ? { cancellation } : {}),
      ...(emergencyPause ? { emergencyPause } : {})
    };
    return parseConsentActivationEvidence(next);
  }, [recoverCancellationEvidence, recoverEmergencyPauseEvidence, recoverExecutionEvidence]);

  const refresh = useCallback(async (quiet = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const generation = ++runId.current;
    if (!quiet) {
      setInspectionState("checking");
      setStatus("Reproducing all release, code, topology, signer and terms checks…");
      setError(undefined);
    }
    try {
      const nextInspection = await inspectExactRelease();
      const nextProposal = await recoverExactProposal(nextInspection);
      if (generation !== runId.current) return;
      const nextPhase = getConsentActivationPhase(nextInspection.latestTimestamp, nextProposal?.transaction);
      let nextEvidence: ConsentActivationEvidenceRecord | undefined;
      const verifiedCancellation = nextProposal?.transaction.cancelled
        ? await recoverCancellationEvidence(nextProposal, nextInspection.latestBlock)
        : undefined;
      if (nextProposal) {
        nextEvidence = await buildRecoveredEvidence(nextInspection, nextProposal, loadSavedEvidence());
        if (nextEvidence) saveEvidence(nextEvidence);
      } else if (loadSavedEvidence()) {
        throw new Error("Saved proposal evidence exists, but governance has no proposal.");
      }
      if (generation !== runId.current) return;
      setInspection(nextInspection);
      setLivePaused(nextInspection.snapshot.paused);
      setProposal(nextProposal);
      setPhase(nextPhase);
      setEvidence(nextEvidence);
      setCancelledTransactionHash(nextEvidence?.cancellation?.receipt.transactionHash ?? verifiedCancellation?.receipt.transactionHash);
      setInspectionState("verified");
      setStatus(nextProposal
        ? `Exact proposal recovered · ${phaseLabel(nextPhase)}${nextEvidence ? "" : " · acceptance evidence missing"}`
        : "Pinned release verified · paused · no governance proposal");
      setError(undefined);
    } catch (cause) {
      if (generation !== runId.current) return;
      setInspectionState("blocked");
      setEvidence(undefined);
      if (!quiet) setStatus("Activation blocked safely");
      setError(describeError(cause));
      if (publicClient) {
        try {
          const [pausedValue, minimal] = await Promise.all([
            publicClient.readContract({
              address: CONSENT_ACTIVATION_CONTRACTS.migrator,
              abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
              functionName: "paused"
            }),
            recoverMinimalGovernanceProposal().catch(() => undefined)
          ]);
          if (generation !== runId.current) return;
          setLivePaused(pausedValue);
          if (minimal) {
            setProposal(minimal.proposal);
            setPhase(getConsentActivationPhase(minimal.latestTimestamp, minimal.proposal.transaction));
            if (minimal.proposal.transaction.cancelled) {
              const recoveredCancellation = await recoverCancellationEvidence(minimal.proposal, minimal.latestBlock);
              setCancelledTransactionHash(recoveredCancellation?.receipt.transactionHash);
            } else {
              setCancelledTransactionHash(undefined);
            }
          } else {
            setProposal(undefined);
            setPhase("invalid");
            setCancelledTransactionHash(undefined);
          }
        } catch {
          if (generation === runId.current) setLivePaused(undefined);
        }
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, [buildRecoveredEvidence, inspectExactRelease, publicClient, recoverCancellationEvidence, recoverExactProposal, recoverMinimalGovernanceProposal]);

  useEffect(() => {
    setEvidence(loadSavedEvidence());
    void refresh();
    return () => { runId.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!publicClient || busy) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [busy, publicClient, refresh]);

  async function proposeActivation() {
    if (!publicClient || !walletClient || !address || !walletReady || !exactAcceptance || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const release = await inspectExactRelease({ paused: true, transactionCount: 0n });
      if ((await walletClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) throw new Error("Wallet chain changed before proposal.");
      if (!sameAddress(address, CONSENT_ACTIVATION_OPERATOR)) throw new Error("Wallet account changed before proposal.");
      const acceptedAtUtc = new Date().toISOString();
      setStatus("Simulating the exact zero-value proposal…");
      await publicClient.simulateContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "propose",
        args: [CONSENT_ACTIVATION_CONTRACTS.migrator, 0n, CONSENT_UNPAUSE_CALLDATA]
      });
      setStatus("Simulation passed · approve the exact proposal in your wallet");
      const hash = await walletClient.writeContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        chain: robinhoodChainTestnet,
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "propose",
        args: [CONSENT_ACTIVATION_CONTRACTS.migrator, 0n, CONSENT_UNPAUSE_CALLDATA]
      });
      setStatus("Proposal mined · waiting for two confirmations and exact receipt checks…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      await receiptEvidence(receipt, CONSENT_ACTIVATION_CONTRACTS.governance, consentProposalCalldata());
      const postRelease = await inspectExactRelease({ paused: true, transactionCount: 1n });
      const exactProposal = await recoverExactProposal(postRelease);
      if (!exactProposal || !sameHex(exactProposal.proposalTransactionHash, receipt.transactionHash)) {
        throw new Error("The recovered exact proposal does not match the newly mined transaction.");
      }
      const nextEvidence = await buildRecoveredEvidence(postRelease, exactProposal, {
        schemaVersion: CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
        releaseId: CONSENT_ACTIVATION_RELEASE_ID,
        chainId: CONSENT_ACTIVATION_CHAIN_ID,
        operator: CONSENT_ACTIVATION_OPERATOR,
        sourceCommit: CONSENT_ACTIVATION_RELEASE.sourceCommit,
        contractSourceSha256: CONSENT_ACTIVATION_RELEASE.contractSourceSha256,
        configurationHash: CONSENT_ACTIVATION_CONFIGURATION.configurationHash,
        termsDocumentHash: CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash,
        migrationTermsHash: CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash,
        ...EVIDENCE_RELEASE_BINDING,
        acceptance: { phrase: CONSENT_ACTIVATION_ACCEPTANCE_PHRASE, acceptedAtUtc },
        proposal: {
          id: exactProposal.id.toString(),
          blockTimestamp: exactProposal.blockTimestamp.toString(),
          executeAfter: exactProposal.transaction.executeAfter.toString(),
          executeBefore: exactProposal.transaction.executeBefore.toString(),
          receipt: exactProposal.proposalReceipt,
          verifiedAtBlockNumber: postRelease.latestBlock.toString()
        }
      });
      if (!nextEvidence) throw new Error("Activation acceptance evidence was not created.");
      saveEvidence(nextEvidence);
      setEvidence(nextEvidence);
      setInspection(release);
      setStatus("Exact zero-value proposal verified and saved");
      setAcceptance("");
      await refresh(true);
    } catch (cause) {
      setStatus("Proposal stopped safely");
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function recordReviewedRecoveryAcceptance() {
    if (!proposal || evidence || !exactAcceptance || !walletReady || !walletClient || !address || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const release = await inspectExactRelease();
      const exactProposal = await recoverExactProposal(release);
      if (!exactProposal || exactProposal.id !== proposal.id) {
        throw new Error("The exact onchain proposal changed during recovery review.");
      }
      assertConsentRecoveryAcceptanceSnapshot({
        expectedProposalId: proposal.id,
        proposalId: exactProposal.id,
        latestTimestamp: release.latestTimestamp,
        transactionCount: release.snapshot.transactionCount,
        paused: release.snapshot.paused,
        transaction: exactProposal.transaction
      });
      if ((await walletClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) throw new Error("Wallet chain changed during recovery review.");
      if (!sameAddress(address, CONSENT_ACTIVATION_OPERATOR)) throw new Error("Wallet account changed during recovery review.");
      const acceptedAtUtc = new Date().toISOString();

      setStatus("Completing a final same-head proposal and pause-state check before saving acceptance…");
      const finalRelease = await inspectExactRelease({ paused: true, transactionCount: 1n });
      const finalProposal = await recoverExactProposal(finalRelease);
      if (
        !finalProposal || finalProposal.id !== exactProposal.id
        || !sameHex(finalProposal.proposalTransactionHash, exactProposal.proposalTransactionHash)
        || !sameHex(finalProposal.proposalReceipt.blockHash, exactProposal.proposalReceipt.blockHash)
        || finalProposal.proposalReceipt.blockNumber !== exactProposal.proposalReceipt.blockNumber
      ) throw new Error("The exact onchain proposal changed during the final recovery check.");
      const finalHead = await readRecoveryAcceptanceHead(finalProposal.id);
      const guardedProposal = { ...finalProposal, transaction: finalHead.transaction };
      assertExactConsentProposal({
        proposalId: guardedProposal.id,
        proposalBlockTimestamp: guardedProposal.blockTimestamp,
        transactionCount: finalHead.transactionCount,
        event: guardedProposal.event,
        transaction: guardedProposal.transaction
      });
      const finalPhase = assertConsentRecoveryAcceptanceSnapshot({
        expectedProposalId: proposal.id,
        proposalId: guardedProposal.id,
        latestTimestamp: finalHead.latestTimestamp,
        transactionCount: finalHead.transactionCount,
        paused: finalHead.paused,
        transaction: guardedProposal.transaction
      });
      const recovered = parseConsentActivationEvidence({
        schemaVersion: CONSENT_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
        releaseId: CONSENT_ACTIVATION_RELEASE_ID,
        chainId: CONSENT_ACTIVATION_CHAIN_ID,
        operator: CONSENT_ACTIVATION_OPERATOR,
        sourceCommit: CONSENT_ACTIVATION_RELEASE.sourceCommit,
        contractSourceSha256: CONSENT_ACTIVATION_RELEASE.contractSourceSha256,
        configurationHash: CONSENT_ACTIVATION_CONFIGURATION.configurationHash,
        termsDocumentHash: CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash,
        migrationTermsHash: CONSENT_ACTIVATION_CONFIGURATION.migrationTermsHash,
        ...EVIDENCE_RELEASE_BINDING,
        acceptance: { phrase: CONSENT_ACTIVATION_ACCEPTANCE_PHRASE, acceptedAtUtc },
        proposal: {
          id: guardedProposal.id.toString(),
          blockTimestamp: guardedProposal.blockTimestamp.toString(),
          executeAfter: guardedProposal.transaction.executeAfter.toString(),
          executeBefore: guardedProposal.transaction.executeBefore.toString(),
          receipt: guardedProposal.proposalReceipt,
          verifiedAtBlockNumber: finalHead.latestBlock.toString()
        }
      });
      saveEvidence(recovered);
      setEvidence(recovered);
      setInspection(finalRelease);
      setLivePaused(finalHead.paused);
      setProposal(guardedProposal);
      setPhase(finalPhase);
      setAcceptance("");
      setStatus(`Reviewed recovery acceptance recorded at ${acceptedAtUtc}`);
    } catch (cause) {
      setStatus("Recovery acceptance stopped safely");
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function cancelActivation() {
    if (!publicClient || !walletClient || !address || !walletReady || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const minimal = await recoverMinimalGovernanceProposal();
      const exactProposal = minimal.proposal;
      const exactPhase = getConsentActivationPhase(minimal.latestTimestamp, exactProposal.transaction);
      if (exactPhase !== "waiting" && exactPhase !== "executable") {
        throw new Error(`The exact proposal cannot be cancelled in its current state: ${phaseLabel(exactPhase)}.`);
      }
      if ((await walletClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) throw new Error("Wallet chain changed before cancellation.");
      if (!sameAddress(address, CONSENT_ACTIVATION_OPERATOR)) throw new Error("Wallet account changed before cancellation.");
      setStatus("Minimal governance recheck passed · simulating exact cancellation…");
      await publicClient.simulateContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "cancel",
        args: [exactProposal.id]
      });
      setStatus("Simulation passed · approve proposal cancellation in your wallet");
      const hash = await walletClient.writeContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        chain: robinhoodChainTestnet,
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "cancel",
        args: [exactProposal.id]
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      const exactReceipt = await receiptEvidence(
        receipt,
        CONSENT_ACTIVATION_CONTRACTS.governance,
        consentCancelCalldata(exactProposal.id)
      );
      const events = parseEventLogs({
        abi: CONSENT_GOVERNANCE_ABI,
        eventName: "Cancelled",
        logs: receipt.logs,
        strict: true
      }) as unknown as { address: Address; args: { id: bigint; configurationEpoch: bigint; signer: Address } }[];
      if (
        events.length !== 1 || events[0].args.id !== exactProposal.id
        || !sameAddress(events[0].address, CONSENT_ACTIVATION_CONTRACTS.governance)
        || events[0].args.configurationEpoch !== CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch
        || !sameAddress(events[0].args.signer, CONSENT_ACTIVATION_OPERATOR)
      ) throw new Error("The mined cancellation event does not match the exact signer proposal.");
      const verifiedBlock = await publicClient.getBlockNumber();
      const cancelledTransaction = await readGovernanceTransaction(exactProposal.id, verifiedBlock);
      assertExactConsentProposal({
        proposalId: exactProposal.id,
        proposalBlockTimestamp: exactProposal.blockTimestamp,
        transactionCount: 1n,
        event: exactProposal.event,
        transaction: cancelledTransaction,
        expectedExecuted: false,
        expectedCancelled: true
      });
      setCancelledTransactionHash(receipt.transactionHash);
      const currentEvidence = evidence ?? loadSavedEvidence();
      if (currentEvidence) {
        const nextEvidence = parseConsentActivationEvidence({
          ...currentEvidence,
          cancellation: {
            receipt: exactReceipt,
            verifiedAtBlockNumber: verifiedBlock.toString()
          }
        });
        saveEvidence(nextEvidence);
        setEvidence(nextEvidence);
      }
      setStatus("Cancellation verified · the activation proposal cannot execute");
      void refresh(true);
    } catch (cause) {
      setStatus("Cancellation stopped safely");
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function executeActivation() {
    if (!publicClient || !walletClient || !address || !walletReady || !proposal || !evidence || phase !== "executable" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const release = await inspectExactRelease({ paused: true, transactionCount: 1n });
      const exactProposal = await recoverExactProposal(release);
      if (!exactProposal || exactProposal.id !== proposal.id) throw new Error("The exact activation proposal could not be reproduced.");
      assertExactConsentProposal({
        proposalId: exactProposal.id,
        proposalBlockTimestamp: exactProposal.blockTimestamp,
        transactionCount: release.snapshot.transactionCount,
        event: exactProposal.event,
        transaction: exactProposal.transaction,
        expectedExecuted: false
      });
      if (getConsentActivationPhase(release.latestTimestamp, exactProposal.transaction) !== "executable") {
        throw new Error("The exact proposal is not inside its onchain execution window.");
      }
      const verifiedEvidence = await buildRecoveredEvidence(release, exactProposal, evidence);
      if (!verifiedEvidence) throw new Error("Typed acceptance evidence is missing or is not bound to this exact proposal.");
      if ((await walletClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) throw new Error("Wallet chain changed before execution.");
      if (!sameAddress(address, CONSENT_ACTIVATION_OPERATOR)) throw new Error("Wallet account changed before execution.");
      setStatus("Reverification passed · simulating exact proposal execution…");
      await publicClient.simulateContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "execute",
        args: [exactProposal.id]
      });
      setStatus("Simulation passed · approve execution in your wallet");
      const hash = await walletClient.writeContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        chain: robinhoodChainTestnet,
        address: CONSENT_ACTIVATION_CONTRACTS.governance,
        abi: CONSENT_GOVERNANCE_ABI,
        functionName: "execute",
        args: [exactProposal.id]
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      const exactReceipt = await receiptEvidence(
        receipt,
        CONSENT_ACTIVATION_CONTRACTS.governance,
        consentExecuteCalldata(exactProposal.id)
      );
      const executedEvents = parseEventLogs({
        abi: CONSENT_GOVERNANCE_ABI,
        eventName: "Executed",
        logs: receipt.logs,
        strict: true
      }) as unknown as { address: Address; args: { id: bigint; configurationEpoch: bigint; executor: Address } }[];
      const pauseEvents = parseEventLogs({
        abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
        eventName: "PauseChanged",
        logs: receipt.logs,
        strict: true
      }) as unknown as { address: Address; args: { paused: boolean; caller: Address } }[];
      if (
        executedEvents.length !== 1 || executedEvents[0].args.id !== exactProposal.id
        || !sameAddress(executedEvents[0].address, CONSENT_ACTIVATION_CONTRACTS.governance)
        || executedEvents[0].args.configurationEpoch !== CONSENT_ACTIVATION_CONFIGURATION.configurationEpoch
        || !sameAddress(executedEvents[0].args.executor, CONSENT_ACTIVATION_OPERATOR)
        || pauseEvents.length !== 1 || pauseEvents[0].args.paused !== false
        || !sameAddress(pauseEvents[0].address, CONSENT_ACTIVATION_CONTRACTS.migrator)
        || !sameAddress(pauseEvents[0].args.caller, CONSENT_ACTIVATION_CONTRACTS.governance)
      ) throw new Error("The mined execution events do not match the exact reviewed activation.");
      const postRelease = await inspectExactRelease({ paused: false, transactionCount: 1n });
      const executedTransaction = await readGovernanceTransaction(exactProposal.id, postRelease.latestBlock);
      assertExactConsentProposal({
        proposalId: exactProposal.id,
        proposalBlockTimestamp: exactProposal.blockTimestamp,
        transactionCount: 1n,
        event: exactProposal.event,
        transaction: executedTransaction,
        expectedExecuted: true
      });
      const nextEvidence = parseConsentActivationEvidence({
        ...verifiedEvidence,
        execution: {
          receipt: exactReceipt,
          verifiedAtBlockNumber: postRelease.latestBlock.toString()
        }
      });
      saveEvidence(nextEvidence);
      setEvidence(nextEvidence);
      setLivePaused(false);
      setStatus("Activation execution verified · migrator is unpaused");
      await refresh(true);
    } catch (cause) {
      setStatus("Execution stopped safely");
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function emergencyPause() {
    if (!publicClient || !walletClient || !address || !walletReady || livePaused !== false || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await inspectMinimalEmergencyPause(false);
      if ((await walletClient.getChainId()) !== CONSENT_ACTIVATION_CHAIN_ID) throw new Error("Wallet chain changed before emergency pause.");
      if (!sameAddress(address, CONSENT_ACTIVATION_OPERATOR)) throw new Error("Wallet account changed before emergency pause.");
      setStatus("Simulating the guardian's exact zero-value pause…");
      await publicClient.simulateContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        address: CONSENT_ACTIVATION_CONTRACTS.migrator,
        abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
        functionName: "pause"
      });
      setStatus("Simulation passed · approve emergency pause in your wallet");
      const hash = await walletClient.writeContract({
        account: CONSENT_ACTIVATION_OPERATOR,
        chain: robinhoodChainTestnet,
        address: CONSENT_ACTIVATION_CONTRACTS.migrator,
        abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
        functionName: "pause"
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      const exactReceipt = await receiptEvidence(
        receipt,
        CONSENT_ACTIVATION_CONTRACTS.migrator,
        CONSENT_PAUSE_CALLDATA
      );
      const events = parseEventLogs({
        abi: CONSENT_MIGRATOR_ACTIVATION_ABI,
        eventName: "PauseChanged",
        logs: receipt.logs,
        strict: true
      }) as unknown as { address: Address; args: { paused: boolean; caller: Address } }[];
      if (
        events.length !== 1 || events[0].args.paused !== true
        || !sameAddress(events[0].address, CONSENT_ACTIVATION_CONTRACTS.migrator)
        || !sameAddress(events[0].args.caller, CONSENT_ACTIVATION_OPERATOR)
      ) throw new Error("The emergency receipt is missing the exact guardian pause event.");
      const postPause = await inspectMinimalEmergencyPause(true);
      const currentEvidence = evidence ?? loadSavedEvidence();
      if (currentEvidence) {
        const nextEvidence = parseConsentActivationEvidence({
          ...currentEvidence,
          emergencyPause: {
            receipt: exactReceipt,
            verifiedAtBlockNumber: postPause.blockNumber.toString()
          }
        });
        saveEvidence(nextEvidence);
        setEvidence(nextEvidence);
      }
      setLivePaused(true);
      setStatus("Emergency pause verified · migrator is paused");
      await refresh(true);
    } catch (cause) {
      setStatus("Emergency pause stopped safely");
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function downloadEvidence() {
    if (!evidence) return;
    const blob = new Blob([`${JSON.stringify(evidence, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${CONSENT_ACTIVATION_RELEASE_ID}-activation-evidence.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const canPropose = Boolean(
    walletReady && inspectionState === "verified" && inspection?.snapshot.paused
    && inspection.snapshot.transactionCount === 0n && !proposal && exactAcceptance && !busy
  );
  const canExecute = Boolean(
    walletReady && inspectionState === "verified" && inspection?.snapshot.paused
    && proposal && phase === "executable" && evidence && !busy
  );
  const canCancel = Boolean(
    walletReady && proposal && (phase === "waiting" || phase === "executable") && !busy
  );
  const canRecordRecovery = Boolean(
    walletReady && proposal && !evidence && exactAcceptance
    && (phase === "waiting" || phase === "executable") && !busy
  );
  const canEmergencyPause = Boolean(
    walletReady && livePaused === false && !busy
  );

  return (
    <div className="activation-console">
      <section className="activation-banner">
        <div>
          <strong>VALUELESS TESTNET REHEARSAL ONLY</strong>
          <p>No migration form, token approval, transfer, arbitrary target, arbitrary calldata, private key, or public enablement exists here.</p>
        </div>
        <span className="activation-badge">LOOPBACK · FAIL CLOSED</span>
      </section>

      <section className="activation-card">
        <div className="activation-card-head">
          <h2>1. Wallet and pinned release</h2>
          <span className={`activation-state ${inspectionState === "verified" ? "good" : inspectionState === "blocked" ? "bad" : "warn"}`}>
            {inspectionState}
          </span>
        </div>
        <div className="activation-grid">
          <div><span>Network</span><strong>Robinhood Chain Testnet · 46630</strong></div>
          <div><span>Connected operator</span><strong>{address ? short(address) : "Not connected"}</strong></div>
          <div><span>Release source</span><code>{CONSENT_ACTIVATION_RELEASE.sourceCommit}</code></div>
          <div><span>Contract source SHA-256</span><code>{CONSENT_ACTIVATION_RELEASE.contractSourceSha256}</code></div>
          <div><span>Configuration</span><code>{CONSENT_ACTIVATION_CONFIGURATION.configurationHash}</code></div>
          <div><span>Terms</span><code>{CONSENT_ACTIVATION_CONFIGURATION.termsDocumentHash}</code></div>
          <div><span>Governance</span><a href={explorerAddress(CONSENT_ACTIVATION_CONTRACTS.governance)} target="_blank" rel="noreferrer">{short(CONSENT_ACTIVATION_CONTRACTS.governance)} ↗</a></div>
          <div><span>Migrator</span><a href={explorerAddress(CONSENT_ACTIVATION_CONTRACTS.migrator)} target="_blank" rel="noreferrer">{short(CONSENT_ACTIVATION_CONTRACTS.migrator)} ↗</a></div>
        </div>
        <div className="activation-checks">
          <div className={`activation-check ${operatorConnected ? "good" : "bad"}`}>Fixed operator {CONSENT_ACTIVATION_OPERATOR}</div>
          <div className={`activation-check ${correctChain ? "good" : "bad"}`}>Wallet on exact chain 46630</div>
          <div className={`activation-check ${inspectionState === "verified" ? "good" : inspectionState === "blocked" ? "bad" : ""}`}>
            {inspection ? `${inspection.runtimeMatches}/10 runtime hashes and all topology bindings reproduced at block ${inspection.latestBlock}` : "Live release verification pending"}
          </div>
          <div className={`activation-check ${inspectionState === "verified" ? "good" : ""}`}>One signer · threshold 1 · epoch 1 · 24-hour delay · seven-day window</div>
          <div className={`activation-check ${inspectionState === "verified" ? "good" : ""}`}>Pristine state · no positions, active session, stray balances, or session allowances · operator retains both fixed supplies</div>
        </div>
        <div className="activation-actions">
          <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Action in progress…" : "Reverify exact release"}</button>
        </div>
      </section>

      <section className="activation-card">
        <div className="activation-card-head">
          <h2>2. Immutable testnet terms</h2>
          <span className="activation-state good">HASH MATCHED</span>
        </div>
        <p>The displayed UTF-8 bytes hash exactly to the terms hash pinned in the deployed stack and migrator.</p>
        <pre className="activation-terms">{CONSENT_TESTNET_TERMS_TEXT}</pre>
        <div className="activation-accept">
          <label htmlFor="activation-acceptance">Type exactly: <code>{CONSENT_ACTIVATION_ACCEPTANCE_PHRASE}</code></label>
          <input
            id="activation-acceptance"
            value={acceptance}
            disabled={Boolean(evidence) || busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setAcceptance(event.target.value)}
          />
        </div>
      </section>

      <section className="activation-card">
        <div className="activation-card-head">
          <h2>3. Fixed governance proposal</h2>
          <span className={`activation-state ${proposal ? "good" : "warn"}`}>{proposal ? "VERIFIED" : "NOT PROPOSED"}</span>
        </div>
        <p>The proposal fields are compiled into this release. There are no editable transaction fields.</p>
        <div className="activation-payload">
          <div><span>target</span><code>{CONSENT_ACTIVATION_CONTRACTS.migrator}</code></div>
          <div><span>value</span><code>0</code></div>
          <div><span>data</span><code>{CONSENT_UNPAUSE_CALLDATA} · unpause()</code></div>
          <div><span>proposal</span><code>{consentProposalCalldata()}</code></div>
        </div>
        {proposal && <div className="activation-grid">
          <div><span>Proposal ID</span><strong>{proposal.id.toString()}</strong></div>
          <div><span>Proposal receipt</span><a href={explorerTransaction(proposal.proposalTransactionHash)} target="_blank" rel="noreferrer">{short(proposal.proposalTransactionHash)} ↗</a></div>
          <div><span>Executable after</span><strong>{readableTime(proposal.transaction.executeAfter)}</strong></div>
          <div><span>Expires after</span><strong>{readableTime(proposal.transaction.executeBefore)}</strong></div>
        </div>}
        <div className="activation-actions">
          <button className="primary" type="button" disabled={!canPropose} onClick={() => void proposeActivation()}>
            {busy ? "Verifying…" : "Simulate and propose exact activation"}
          </button>
          {proposal && !evidence && <button type="button" disabled={!canRecordRecovery} onClick={() => void recordReviewedRecoveryAcceptance()}>
            Record reviewed recovery acceptance
          </button>}
        </div>
      </section>

      <section className="activation-card">
        <div className="activation-card-head">
          <h2>4. Timelocked execution</h2>
          <span className={`activation-state ${phase === "executed" ? "good" : phase === "executable" ? "warn" : ["invalid", "expired", "cancelled"].includes(phase) ? "bad" : ""}`}>
            {phaseLabel(phase)}
          </span>
        </div>
        <p>Execution stays disabled until the latest block timestamp reaches the exact 24-hour boundary, and blocks again after the seven-day execution window.</p>
        <div className="activation-actions">
          <button className="primary" type="button" disabled={!canExecute} onClick={() => void executeActivation()}>
            Reverify, simulate and execute proposal
          </button>
          <button className="danger" type="button" disabled={!canCancel} onClick={() => void cancelActivation()}>
            Simulate and cancel proposal
          </button>
          <button type="button" disabled={!evidence} onClick={downloadEvidence}>Download activation evidence</button>
        </div>
        {cancelledTransactionHash && <p className="activation-notice">
          Verified cancellation: <a href={explorerTransaction(cancelledTransactionHash)} target="_blank" rel="noreferrer">{short(cancelledTransactionHash)} ↗</a>
        </p>}
      </section>

      <section className="activation-card">
        <div className="activation-card-head">
          <h2>5. Guardian emergency stop</h2>
          <span className={`activation-state ${livePaused === true ? "good" : livePaused === false ? "warn" : "bad"}`}>
            {livePaused === true ? "PAUSED" : livePaused === false ? "UNPAUSED" : "UNKNOWN"}
          </span>
        </div>
        <p>The fixed guardian can submit only the exact zero-value <code>pause()</code> call from this console. It cannot migrate or move tokens.</p>
        <div className="activation-payload">
          <div><span>target</span><code>{CONSENT_ACTIVATION_CONTRACTS.migrator}</code></div>
          <div><span>value</span><code>0</code></div>
          <div><span>data</span><code>{CONSENT_PAUSE_CALLDATA} · pause()</code></div>
        </div>
        <div className="activation-actions">
          <button className="danger" type="button" disabled={!canEmergencyPause} onClick={() => void emergencyPause()}>
            Simulate and emergency pause
          </button>
        </div>
      </section>

      <div aria-live="polite" className="activation-notice">{status}</div>
      {error && <div role="alert" className="activation-error">{error}</div>}
      <p className="activation-safety">
        Localhost operator console only · two confirmations required · every mined sender, recipient, value, input and required event reverified · no private keys handled
      </p>
    </div>
  );
}
