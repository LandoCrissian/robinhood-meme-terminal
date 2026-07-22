import { robinhoodChainTestnet } from "@rmt/shared/chains";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  zeroAddress,
  zeroHash
} from "viem";
import {
  consentRehearsalContractNames,
  consentRehearsalRelease,
  type ConsentRehearsalActivationProposal,
  type ConsentRehearsalActivationState,
  type ConsentRehearsalContractName,
  type ConsentRehearsalProposalStatus,
  type ConsentRehearsalStatus
} from "../consent-rehearsal";

const migratorAbi = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "destinationChainId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "governance", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "guardian", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "configurationHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "termsDocumentHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "migrationTermsHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] }
] as const;

const governanceAbi = [
  { type: "function", name: "transactionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "configurationEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "signerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "executionDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "executionWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "isSigner",
    stateMutability: "view",
    inputs: [{ name: "signer", type: "address" }],
    outputs: [{ type: "bool" }]
  },
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
  }
] as const;

const enumerableAbi = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }
] as const;

const tokenAbi = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  }
] as const;

const sessionAbi = [
  { type: "function", name: "activeMigrationId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "activeOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

// This release authorizes at most one governance action: proposal 0 containing
// the exact zero-value migrator unpause call. Any additional governance history
// requires a separately reviewed release and must remove the public green state.
const MAX_REVIEWED_GOVERNANCE_PROPOSALS = 1n;
const EXPECTED_GOVERNANCE_EPOCH = 1n;
const EXPECTED_GOVERNANCE_SIGNER_COUNT = 1n;
const EXPECTED_GOVERNANCE_THRESHOLD = 1n;
const EXPECTED_GOVERNANCE_EXECUTION_WINDOW = BigInt(
  consentRehearsalRelease.configuration.governanceWindowSeconds
);
const MAX_BLOCK_AGE_SECONDS = 300;
const PROCESS_CACHE_MS = 10_000;
const READ_DEADLINE_MS = 12_000;
const UNPAUSE_CALLDATA = encodeFunctionData({ abi: migratorAbi, functionName: "unpause" });

const addresses = Object.fromEntries(consentRehearsalContractNames.map((name) => [
  name,
  getAddress(consentRehearsalRelease.contracts[name].address)
])) as Record<ConsentRehearsalContractName, Address>;
const expectedOperator = getAddress(consentRehearsalRelease.operator);

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(
    process.env.RMT_CONSENT_TESTNET_RPC_URL
      ?? process.env.RMT_TESTNET_RPC_URL
      ?? robinhoodChainTestnet.rpcUrls.default.http[0],
    { retryCount: 1, timeout: 8_000 }
  )
});

export type ConsentGovernanceTransaction = {
  id: bigint;
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

type ActivationDerivation = {
  state: Exclude<ConsentRehearsalActivationState, "mismatch" | "unavailable"> | "invalid-active-state";
  proposal: ConsentRehearsalActivationProposal | null;
  matchingCount: number;
};

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function isoFromUnix(timestamp: bigint) {
  return new Date(Number(timestamp) * 1_000).toISOString();
}

function proposalStatus(
  proposal: ConsentGovernanceTransaction,
  currentEpoch: bigint,
  threshold: bigint,
  blockTimestamp: bigint
): ConsentRehearsalProposalStatus {
  if (proposal.executed) return "executed";
  if (proposal.cancelled) return "cancelled";
  if (proposal.configurationEpoch !== currentEpoch) return "stale-epoch";
  if (blockTimestamp > proposal.executeBefore) return "expired";
  if (proposal.confirmations < threshold) return "awaiting-confirmations";
  return blockTimestamp < proposal.executeAfter ? "scheduled" : "ready";
}

function publicProposal(
  proposal: ConsentGovernanceTransaction,
  status: ConsentRehearsalProposalStatus
): ConsentRehearsalActivationProposal {
  return {
    id: proposal.id.toString(),
    status,
    executeAfter: isoFromUnix(proposal.executeAfter),
    executeBefore: isoFromUnix(proposal.executeBefore),
    confirmations: proposal.confirmations.toString(),
    transaction: {
      target: proposal.target,
      value: "0",
      data: proposal.data
    }
  };
}

export function deriveConsentRehearsalActivation(input: {
  paused: boolean;
  transactions: ConsentGovernanceTransaction[];
  currentEpoch: bigint;
  threshold: bigint;
  blockTimestamp: bigint;
}): ActivationDerivation {
  const matching = input.transactions.filter((proposal) =>
    proposal.proposer.toLowerCase() === expectedOperator.toLowerCase()
      && proposal.target.toLowerCase() === addresses.migrator.toLowerCase()
      && proposal.value === 0n
      && sameHex(proposal.data, UNPAUSE_CALLDATA)
      && proposal.configurationEpoch === EXPECTED_GOVERNANCE_EPOCH
      && proposal.configurationEpoch === input.currentEpoch
      && proposal.confirmations === EXPECTED_GOVERNANCE_THRESHOLD
      && proposal.confirmations === input.threshold
      && proposal.executeAfter > 0n
      && proposal.executeBefore === proposal.executeAfter + EXPECTED_GOVERNANCE_EXECUTION_WINDOW
      && !(proposal.executed && proposal.cancelled)
  );
  const detailed = matching.map((proposal) => ({
    proposal,
    status: proposalStatus(proposal, input.currentEpoch, input.threshold, input.blockTimestamp)
  }));
  const latestActionable = detailed.findLast(({ status }) =>
    status === "scheduled" || status === "awaiting-confirmations" || status === "ready"
  );
  const latest = latestActionable ?? detailed.at(-1);
  const rendered = latest ? publicProposal(latest.proposal, latest.status) : null;
  const hasExecuted = detailed.some(({ status }) => status === "executed");

  if (!input.paused) {
    return { state: hasExecuted ? "active" : "invalid-active-state", proposal: rendered, matchingCount: matching.length };
  }
  if (latestActionable?.status === "ready") {
    return { state: "ready-to-execute", proposal: rendered, matchingCount: matching.length };
  }
  if (latestActionable) {
    return { state: "proposal-pending", proposal: rendered, matchingCount: matching.length };
  }
  if (latest?.status === "expired") {
    return { state: "proposal-expired", proposal: rendered, matchingCount: matching.length };
  }
  if (hasExecuted) {
    return { state: "paused-after-activation", proposal: rendered, matchingCount: matching.length };
  }
  return { state: "paused", proposal: rendered, matchingCount: matching.length };
}

function mismatch(mismatches: string[], matches: boolean, label: string) {
  if (!matches) mismatches.push(label);
}

export function evaluateConsentRehearsalGovernance(input: {
  paused: boolean;
  transactionCount: bigint;
  transactions: ConsentGovernanceTransaction[];
  configurationEpoch: bigint;
  signerCount: bigint;
  threshold: bigint;
  operatorIsSigner: boolean;
  blockTimestamp: bigint;
}) {
  const mismatches: string[] = [];
  mismatch(mismatches, input.configurationEpoch === EXPECTED_GOVERNANCE_EPOCH, "Governance configuration epoch");
  mismatch(mismatches, input.signerCount === EXPECTED_GOVERNANCE_SIGNER_COUNT, "Governance signer count");
  mismatch(mismatches, input.threshold === EXPECTED_GOVERNANCE_THRESHOLD, "Governance threshold");
  mismatch(mismatches, input.operatorIsSigner, "Governance signer");
  mismatch(
    mismatches,
    input.transactionCount <= MAX_REVIEWED_GOVERNANCE_PROPOSALS,
    "Governance proposal count"
  );
  mismatch(
    mismatches,
    BigInt(input.transactions.length) === input.transactionCount,
    "Governance proposal inspection"
  );

  const activation = deriveConsentRehearsalActivation({
    paused: input.paused,
    transactions: input.transactions,
    currentEpoch: input.configurationEpoch,
    threshold: input.threshold,
    blockTimestamp: input.blockTimestamp
  });
  mismatch(
    mismatches,
    BigInt(activation.matchingCount) === input.transactionCount,
    "Unrecognized governance proposal"
  );
  mismatch(mismatches, activation.state !== "invalid-active-state", "Unpause governance evidence");
  return { activation, mismatches };
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Consent rehearsal status read timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readAtHead() {
  const checkedAtMs = Date.now();
  const [observedChainId, latestBlock] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (observedChainId !== consentRehearsalRelease.network.chainId) {
    return { observedChainId, latestBlock, block: null, checkedAtMs };
  }
  const block = await client.getBlock({ blockNumber: latestBlock });
  const blockAgeSeconds = Math.max(0, Math.floor(checkedAtMs / 1_000 - Number(block.timestamp)));
  if (blockAgeSeconds > MAX_BLOCK_AGE_SECONDS) throw new Error("Consent rehearsal RPC head is stale.");
  return { observedChainId, latestBlock, block, checkedAtMs };
}

async function readFreshConsentRehearsalStatusUnsafe(): Promise<ConsentRehearsalStatus> {
  const head = await readAtHead();
  const checkedAt = new Date(head.checkedAtMs).toISOString();
  const mismatches: string[] = [];
  mismatch(mismatches, head.observedChainId === consentRehearsalRelease.network.chainId, "Network chain ID");
  if (!head.block) {
    return {
      ok: false,
      integrity: "mismatch",
      activationState: "mismatch",
      checkedAt,
      error: "The live network does not match the published rehearsal release.",
      release: consentRehearsalRelease,
      network: {
        expectedChainId: consentRehearsalRelease.network.chainId,
        observedChainId: head.observedChainId,
        latestBlock: head.latestBlock.toString(),
        blockTimestamp: null,
        blockAgeSeconds: null
      },
      live: {
        paused: null,
        governanceTransactionCount: null,
        governanceConfigurationEpoch: null,
        positionsMinted: null,
        matchingActivationProposalCount: null,
        sessionIdle: null,
        sessionTokenBalances: null,
        migratorTokenBalances: null
      },
      activationProposal: null,
      mismatches
    };
  }

  const blockNumber = head.latestBlock;
  const blockTimestamp = head.block.timestamp;
  const [
    contractBytecodes,
    paused,
    destinationChainId,
    observedGovernance,
    observedGuardian,
    configurationHash,
    termsDocumentHash,
    migrationTermsHash,
    transactionCount,
    configurationEpoch,
    threshold,
    signerCount,
    executionDelay,
    executionWindow,
    operatorIsSigner,
    positionsMinted,
    activeMigrationId,
    activeOwner,
    pairedTokenSupply,
    wethSupply,
    sessionPairedBalance,
    sessionWethBalance,
    migratorPairedBalance,
    migratorWethBalance
  ] = await Promise.all([
    Promise.all(consentRehearsalContractNames.map(async (name) => ({
      name,
      bytecode: await client.getBytecode({ address: addresses[name], blockNumber })
    }))),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "paused", blockNumber }),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "destinationChainId", blockNumber }),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "governance", blockNumber }),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "guardian", blockNumber }),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "configurationHash", blockNumber }),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "termsDocumentHash", blockNumber }),
    client.readContract({ address: addresses.migrator, abi: migratorAbi, functionName: "migrationTermsHash", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "transactionCount", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "configurationEpoch", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "threshold", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "signerCount", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "executionDelay", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "executionWindow", blockNumber }),
    client.readContract({ address: addresses.governance, abi: governanceAbi, functionName: "isSigner", args: [expectedOperator], blockNumber }),
    client.readContract({ address: addresses.positionManager, abi: enumerableAbi, functionName: "totalSupply", blockNumber }),
    client.readContract({ address: addresses.session, abi: sessionAbi, functionName: "activeMigrationId", blockNumber }),
    client.readContract({ address: addresses.session, abi: sessionAbi, functionName: "activeOwner", blockNumber }),
    client.readContract({ address: addresses.pairedToken, abi: tokenAbi, functionName: "totalSupply", blockNumber }),
    client.readContract({ address: addresses.weth, abi: tokenAbi, functionName: "totalSupply", blockNumber }),
    client.readContract({ address: addresses.pairedToken, abi: tokenAbi, functionName: "balanceOf", args: [addresses.session], blockNumber }),
    client.readContract({ address: addresses.weth, abi: tokenAbi, functionName: "balanceOf", args: [addresses.session], blockNumber }),
    client.readContract({ address: addresses.pairedToken, abi: tokenAbi, functionName: "balanceOf", args: [addresses.migrator], blockNumber }),
    client.readContract({ address: addresses.weth, abi: tokenAbi, functionName: "balanceOf", args: [addresses.migrator], blockNumber })
  ]);

  for (const { name, bytecode } of contractBytecodes) {
    const expectedCodeHash = consentRehearsalRelease.contracts[name].runtimeCodeHash;
    mismatch(
      mismatches,
      Boolean(bytecode && sameHex(keccak256(bytecode), expectedCodeHash)),
      `${name} runtime code`
    );
  }
  mismatch(mismatches, destinationChainId === BigInt(consentRehearsalRelease.configuration.destinationChainId), "Destination chain ID");
  mismatch(mismatches, getAddress(observedGovernance) === addresses.governance, "Migrator governance binding");
  mismatch(mismatches, getAddress(observedGuardian) === expectedOperator, "Migrator guardian binding");
  mismatch(mismatches, sameHex(configurationHash, consentRehearsalRelease.configuration.configurationHash), "Configuration hash");
  mismatch(mismatches, sameHex(termsDocumentHash, consentRehearsalRelease.configuration.termsDocumentHash), "Terms document hash");
  mismatch(mismatches, sameHex(migrationTermsHash, consentRehearsalRelease.configuration.migrationTermsHash), "Migration terms hash");
  mismatch(mismatches, executionDelay === BigInt(consentRehearsalRelease.configuration.governanceDelaySeconds), "Governance delay");
  mismatch(mismatches, executionWindow === BigInt(consentRehearsalRelease.configuration.governanceWindowSeconds), "Governance execution window");
  mismatch(mismatches, pairedTokenSupply === BigInt(consentRehearsalRelease.configuration.pairedTokenFixedSupply), "Paired-token fixed supply");
  mismatch(mismatches, wethSupply === BigInt(consentRehearsalRelease.configuration.wethFixedSupply), "WETH rehearsal fixed supply");
  const sessionIdle = activeMigrationId === zeroHash && getAddress(activeOwner) === zeroAddress;
  mismatch(mismatches, sessionIdle, "Session activity state");
  mismatch(mismatches, sessionPairedBalance === 0n && sessionWethBalance === 0n, "Session custody balances");
  mismatch(mismatches, migratorPairedBalance === 0n && migratorWethBalance === 0n, "Migrator custody balances");

  let transactions: ConsentGovernanceTransaction[] = [];
  if (transactionCount <= MAX_REVIEWED_GOVERNANCE_PROPOSALS) {
    transactions = await Promise.all(Array.from({ length: Number(transactionCount) }, async (_, id) => {
      const transaction = await client.readContract({
        address: addresses.governance,
        abi: governanceAbi,
        functionName: "getTransaction",
        args: [BigInt(id)],
        blockNumber
      });
      return { id: BigInt(id), ...transaction };
    }));
  }

  const governance = evaluateConsentRehearsalGovernance({
    paused,
    transactionCount,
    transactions,
    configurationEpoch,
    signerCount,
    threshold,
    operatorIsSigner,
    blockTimestamp
  });
  mismatches.push(...governance.mismatches);
  const { activation } = governance;
  const ok = mismatches.length === 0;
  const blockAgeSeconds = Math.max(0, Math.floor(head.checkedAtMs / 1_000 - Number(blockTimestamp)));

  return {
    ok,
    integrity: ok ? "verified" : "mismatch",
    activationState: ok && activation.state !== "invalid-active-state" ? activation.state : "mismatch",
    checkedAt,
    error: ok ? null : "Live state does not match the published rehearsal release.",
    release: consentRehearsalRelease,
    network: {
      expectedChainId: consentRehearsalRelease.network.chainId,
      observedChainId: head.observedChainId,
      latestBlock: blockNumber.toString(),
      blockTimestamp: isoFromUnix(blockTimestamp),
      blockAgeSeconds
    },
    live: {
      paused,
      governanceTransactionCount: transactionCount.toString(),
      governanceConfigurationEpoch: configurationEpoch.toString(),
      positionsMinted: positionsMinted.toString(),
      matchingActivationProposalCount: activation.matchingCount,
      sessionIdle,
      sessionTokenBalances: {
        pairedToken: sessionPairedBalance.toString(),
        weth: sessionWethBalance.toString()
      },
      migratorTokenBalances: {
        pairedToken: migratorPairedBalance.toString(),
        weth: migratorWethBalance.toString()
      }
    },
    activationProposal: activation.proposal,
    mismatches
  };
}

export async function readFreshConsentRehearsalStatus() {
  return withDeadline(readFreshConsentRehearsalStatusUnsafe(), READ_DEADLINE_MS);
}

type ProcessCache = { expiresAt: number; status: ConsentRehearsalStatus };
let processCache: ProcessCache | undefined;
let refreshInFlight: Promise<ConsentRehearsalStatus> | undefined;

export async function readConsentRehearsalStatus() {
  const now = Date.now();
  if (processCache && processCache.expiresAt > now) return processCache.status;
  if (refreshInFlight) return refreshInFlight;

  const refresh = readFreshConsentRehearsalStatus();
  refreshInFlight = refresh;
  try {
    const status = await refresh;
    if (status.ok) processCache = { expiresAt: Date.now() + PROCESS_CACHE_MS, status };
    return status;
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = undefined;
  }
}

export function unavailableConsentRehearsalStatus(): ConsentRehearsalStatus {
  return {
    ok: false,
    integrity: "unavailable",
    activationState: "unavailable",
    checkedAt: new Date().toISOString(),
    error: "Live rehearsal verification is temporarily unavailable. No execution state is being inferred.",
    release: consentRehearsalRelease,
    network: {
      expectedChainId: consentRehearsalRelease.network.chainId,
      observedChainId: null,
      latestBlock: null,
      blockTimestamp: null,
      blockAgeSeconds: null
    },
    live: {
      paused: null,
      governanceTransactionCount: null,
      governanceConfigurationEpoch: null,
      positionsMinted: null,
      matchingActivationProposalCount: null,
      sessionIdle: null,
      sessionTokenBalances: null,
      migratorTokenBalances: null
    },
    activationProposal: null,
    mismatches: []
  };
}

export const consentRehearsalUnpauseCalldata = UNPAUSE_CALLDATA;
