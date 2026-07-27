"use client";

import { robinhoodChain } from "@rmt/shared/chains";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  concat,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getCreate2Address,
  keccak256,
  parseEventLogs,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import artifactsJson from "../../lib/generated/mainnet-stack.json";

const OPERATOR = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA" as Address;
const V5_FACTORY = "0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD" as Address;
const OFFICIAL_LEGACY_RMT_TOKEN = "0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C" as Address;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const STORAGE_KEY = "rmt:v6-release:same-session-bootstrap";
const VERSION = keccak256(toHex("RMT_FACTORY_V6"));
const V5_VERSION = keccak256(toHex("RMT_FACTORY_V5"));
const FAIR_POLICY_ID = keccak256(toHex("RMT_SIMPLE_FAIR_V1"));
const OPEN_POLICY_ID = keccak256(toHex("RMT_SIMPLE_OPEN_V1"));
const DAY = 86_400n;
const GOVERNANCE_EXECUTION_WINDOW = 7n * DAY;
const HOOK_FLAGS = 0x28a0n;
const HOOK_MASK = 0x3fffn;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const RECOVERY_SCHEMA = "rmt-v6-release-recovery-v6-bootstrap";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^\d+$/;

const officialMigrationAbi = [
  { type: "function", name: "officialLauncher", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "authorizedFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "officialLegacyToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "consumed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }
] as const;

const officialLegacyTokenAbi = [
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

type Artifact = { abi: Abi; bytecode: Hex };
type ArtifactName =
  | "hook"
  | "adapter"
  | "factory"
  | "governanceV6"
  | "bootstrapV6"
  | "bootstrapFoundationVerifierV6"
  | "bootstrapSmokeVerifierV6"
  | "registry"
  | "launchGateV6"
  | "policyRegistryV6"
  | "rmtFactoryV6"
  | "feeSplitterV6"
  | "marketV6";
type AddressKey = "governance" | "bootstrapController" | "registry" | "hook" | "adapter" | "launchGate" | "policyRegistry" | "marketImplementation" | "factory";
type ProposalKey = "fairPolicy" | "openPolicy" | "factoryActivation" | "defaultPolicy" | "unpause";
type ReadyKey = "initialGovernance" | "policyRegistration" | "defaultGovernance" | "defaultPolicy" | "unpauseGovernance" | "unpause";
type ReleaseDeployment = {
  addresses: Partial<Record<AddressKey, Address>>;
  transactions: Record<string, Hex>;
  proposalIds: Partial<Record<ProposalKey, string>>;
  readyAt: Partial<Record<ReadyKey, string>>;
  hookSalt?: Hex;
  verified?: boolean;
  sourceVerified?: boolean;
  sourceVerifiedAt?: string;
  /** Immutable evidence committed to the bootstrap controller at activation. */
  sourceEvidenceHash?: Hex;
  /** Most recent live Blockscout check; later checks must never replace activation evidence. */
  latestSourceEvidenceHash?: Hex;
  smokeEvidenceHash?: Hex;
  productionVerifiedAt?: string;
  factoryStartBlock?: string;
};
type SourceContractAddresses = {
  governance: Address;
  bootstrapController: Address;
  foundationVerifier: Address;
  smokeVerifier: Address;
  versionRegistry: Address;
  legacyFactory: Address;
  hook: Address;
  adapter: Address;
  launchGate: Address;
  policyRegistry: Address;
  marketImplementation: Address;
  tokenImplementation: Address;
  feeSplitterImplementation: Address;
  officialMigration: Address;
  factory: Address;
};
type RecoveryRecord = {
  schema: typeof RECOVERY_SCHEMA;
  chainId: number;
  operator: Address;
  version: Hex;
  exportedAt: string;
  deployment: ReleaseDeployment;
};
type LaunchPolicy = {
  policyId: Hex;
  policyVersion: number;
  enabled: boolean;
  publiclySelectable: boolean;
  curveFeeBps: number;
  creatorFeeShareBps: number;
  protocolFeeShareBps: number;
  postGraduationFeeBps: number;
  graduationTarget: bigint;
  fairStartMode: number;
  fairStartDelayBlocks: bigint;
  fairStartDurationBlocks: bigint;
  fairStartMaxTxBps: number;
  fairStartMaxWalletBps: number;
  marketImplementation: Address;
  protocolTreasury: Address;
  graduationAdapter: Address;
};

const artifacts = artifactsJson as unknown as Record<ArtifactName, Artifact>;
const factoryConstructor = artifacts.rmtFactoryV6?.abi?.find((item) => item.type === "constructor") as
  | { inputs?: readonly unknown[] }
  | undefined;
const governanceConstructor = artifacts.governanceV6?.abi?.find((item) => item.type === "constructor") as
  | { inputs?: readonly unknown[] }
  | undefined;
const bootstrapConstructor = artifacts.bootstrapV6?.abi?.find((item) => item.type === "constructor") as
  | { inputs?: readonly unknown[] }
  | undefined;
const launchGateConstructor = artifacts.launchGateV6?.abi?.find((item) => item.type === "constructor") as
  | { inputs?: readonly unknown[] }
  | undefined;
const registryConstructor = artifacts.registry?.abi?.find((item) => item.type === "constructor") as
  | { inputs?: readonly unknown[] }
  | undefined;
const foundationVerifierConstructor = artifacts.bootstrapFoundationVerifierV6?.abi?.find(
  (item) => item.type === "constructor"
) as { inputs?: readonly unknown[] } | undefined;
const smokeVerifierConstructor = artifacts.bootstrapSmokeVerifierV6?.abi?.find(
  (item) => item.type === "constructor"
) as { inputs?: readonly unknown[] } | undefined;

function hasAbiFunction(artifact: Artifact | undefined, name: string, inputTypes: readonly string[]) {
  return Boolean(artifact?.abi.some((item) => item.type === "function"
    && item.name === name
    && item.inputs.length === inputTypes.length
    && item.inputs.every((input, index) => input.type === inputTypes[index])));
}

function deployBytecodeFits(artifact: Artifact | undefined, constructorArgumentBytes = 0) {
  if (!artifact?.bytecode || artifact.bytecode === "0x") return false;
  return (artifact.bytecode.length - 2) / 2 + constructorArgumentBytes <= 49_152;
}

const DEPLOYMENT_ARTIFACTS_READY = Boolean(
  artifacts.governanceV6?.bytecode && artifacts.governanceV6.bytecode !== "0x"
    && artifacts.hook?.bytecode && artifacts.hook.bytecode !== "0x"
    && deployBytecodeFits(artifacts.bootstrapV6, 32)
    && deployBytecodeFits(artifacts.bootstrapFoundationVerifierV6, 32)
    && deployBytecodeFits(artifacts.bootstrapSmokeVerifierV6, 32)
    && artifacts.adapter?.bytecode && artifacts.adapter.bytecode !== "0x"
    && artifacts.launchGateV6?.bytecode && artifacts.launchGateV6.bytecode !== "0x"
    && artifacts.policyRegistryV6?.bytecode && artifacts.policyRegistryV6.bytecode !== "0x"
    && artifacts.marketV6?.bytecode && artifacts.marketV6.bytecode !== "0x"
    && artifacts.rmtFactoryV6?.bytecode && artifacts.rmtFactoryV6.bytecode !== "0x"
    && artifacts.feeSplitterV6?.abi?.length
    && artifacts.registry?.bytecode && artifacts.registry.bytecode !== "0x"
    && factoryConstructor?.inputs?.length === 8
    && governanceConstructor?.inputs?.length === 3
    && bootstrapConstructor?.inputs?.length === 1
    && foundationVerifierConstructor?.inputs?.length === 1
    && smokeVerifierConstructor?.inputs?.length === 1
    && launchGateConstructor?.inputs?.length === 4
    && registryConstructor?.inputs?.length === 5
    && artifacts.factory?.abi.some(
      (item) => item.type === "function" && "name" in item && item.name === "isNameUsed"
    )
    && artifacts.factory?.abi.some(
      (item) => item.type === "function" && "name" in item && item.name === "isSymbolUsed"
    )
    && artifacts.rmtFactoryV6.abi.some(
      (item) => item.type === "function" && "name" in item && item.name === "officialLegacyToken"
    )
    && hasAbiFunction(artifacts.bootstrapV6, "foundationVerifier", [])
    && hasAbiFunction(artifacts.bootstrapV6, "smokeVerifier", [])
    && hasAbiFunction(
      artifacts.bootstrapV6,
      "activateVerifiedFoundation",
      ["address", "address", "address", "address", "bytes32"]
    )
    && hasAbiFunction(artifacts.bootstrapV6, "openAfterOfficialSmoke", ["bytes32"])
    && hasAbiFunction(artifacts.bootstrapFoundationVerifierV6, "controller", [])
    && hasAbiFunction(artifacts.bootstrapSmokeVerifierV6, "controller", [])
    && hasAbiFunction(artifacts.registry, "bootstrapActivateFactory", ["address", "bytes32"])
    && hasAbiFunction(artifacts.registry, "pendingExpirationTime", [])
    && hasAbiFunction(artifacts.registry, "pendingConfigurationEpoch", [])
    && hasAbiFunction(artifacts.launchGateV6, "bootstrapUnpause", [])
    && hasAbiFunction(artifacts.launchGateV6, "unpauseExpiresAt", [])
    && hasAbiFunction(artifacts.launchGateV6, "unpauseConfigurationEpoch", [])
    && hasAbiFunction(artifacts.rmtFactoryV6, "launchOfficialWhilePaused", ["string"])
    && hasAbiFunction(artifacts.rmtFactoryV6, "getLaunch", ["uint256"])
    && hasAbiFunction(artifacts.rmtFactoryV6, "launchCount", [])
    && hasAbiFunction(artifacts.feeSplitterV6, "totalReceived", [])
    && hasAbiFunction(artifacts.feeSplitterV6, "totalPaid", [])
    && hasAbiFunction(artifacts.feeSplitterV6, "pending", ["address"])
    && artifacts.governanceV6.abi.some(
      (item) => item.type === "function" && "name" in item && item.name === "configurationEpoch"
    )
    && artifacts.governanceV6.abi.some(
      (item) => item.type === "function"
        && item.name === "acceptSignerRole"
        && item.inputs.length === 5
        && item.inputs[0]?.type === "uint64"
        && item.inputs[1]?.type === "uint8"
        && item.inputs[2]?.type === "address"
        && item.inputs[3]?.type === "uint256"
        && item.inputs[4]?.type === "uint64"
    )
    && artifacts.governanceV6.abi.some(
      (item) => item.type === "function"
        && item.name === "revokeSignerRoleAcceptance"
        && item.inputs.length === 1
        && item.inputs[0]?.type === "uint64"
    )
);
const EMPTY: ReleaseDeployment = { addresses: {}, transactions: {}, proposalIds: {}, readyAt: {} };
const ADDRESS_KEYS: readonly AddressKey[] = ["governance", "bootstrapController", "registry", "hook", "adapter", "launchGate", "policyRegistry", "marketImplementation", "factory"];
const PROPOSAL_KEYS: readonly ProposalKey[] = ["fairPolicy", "openPolicy", "factoryActivation", "defaultPolicy", "unpause"];
const READY_KEYS: readonly ReadyKey[] = ["initialGovernance", "policyRegistration", "defaultGovernance", "defaultPolicy", "unpauseGovernance", "unpause"];
const PROPOSAL_TRANSACTION_KEYS: Record<ProposalKey, string> = {
  fairPolicy: "proposeFairPolicy",
  openPolicy: "proposeOpenPolicy",
  factoryActivation: "proposeFactoryActivation",
  defaultPolicy: "proposeDefaultPolicy",
  unpause: "proposeUnpause"
};
const FOUNDATION_TRANSACTION_KEYS = [
  "governance",
  "bootstrapController",
  "registry",
  "hook",
  "adapter",
  "bindHookAdapter",
  "launchGate",
  "marketImplementation",
  "policyRegistry",
  "factory",
  "bindAdapterFactory"
] as const;

function proposalGovernance(current: ReleaseDeployment, _proposalKey: ProposalKey) {
  const governance = current.addresses.governance;
  if (!governance) throw new Error("The V6 governance address is missing from the release record.");
  return { address: governance, artifact: artifacts.governanceV6 };
}

function releaseRegistry(current: ReleaseDeployment) {
  const registry = current.addresses.registry;
  if (!registry) throw new Error("The fresh V6 version registry is missing from the release record.");
  return registry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRecoveryDeployment(value: unknown): ReleaseDeployment {
  if (!isRecord(value) || !isRecord(value.addresses) || !isRecord(value.transactions)
    || !isRecord(value.proposalIds) || !isRecord(value.readyAt)) {
    throw new Error("The recovery file is incomplete or malformed.");
  }

  const addresses: Partial<Record<AddressKey, Address>> = {};
  for (const key of ADDRESS_KEYS) {
    const candidate = value.addresses[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "string" || !ADDRESS_PATTERN.test(candidate)) {
      throw new Error(`The recovery file contains an invalid ${key} address.`);
    }
    addresses[key] = candidate as Address;
  }

  const transactions: Record<string, Hex> = {};
  for (const [key, candidate] of Object.entries(value.transactions)) {
    if (!/^[A-Za-z0-9]+$/.test(key) || typeof candidate !== "string" || !HASH_PATTERN.test(candidate)) {
      throw new Error("The recovery file contains an invalid transaction record.");
    }
    transactions[key] = candidate as Hex;
  }

  const proposalIds: Partial<Record<ProposalKey, string>> = {};
  for (const key of PROPOSAL_KEYS) {
    const candidate = value.proposalIds[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "string" || !DECIMAL_PATTERN.test(candidate)) {
      throw new Error(`The recovery file contains an invalid ${key} proposal ID.`);
    }
    proposalIds[key] = candidate;
  }

  const readyAt: Partial<Record<ReadyKey, string>> = {};
  for (const key of READY_KEYS) {
    const candidate = value.readyAt[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "string" || !DECIMAL_PATTERN.test(candidate) || BigInt(candidate) > 2n ** 64n - 1n) {
      throw new Error(`The recovery file contains an invalid ${key} timestamp.`);
    }
    readyAt[key] = candidate;
  }

  if (value.hookSalt !== undefined && (typeof value.hookSalt !== "string" || !HASH_PATTERN.test(value.hookSalt))) {
    throw new Error("The recovery file contains an invalid hook salt.");
  }
  if (value.verified !== undefined && typeof value.verified !== "boolean") {
    throw new Error("The recovery file contains an invalid verification marker.");
  }
  if (value.sourceVerified !== undefined && typeof value.sourceVerified !== "boolean") {
    throw new Error("The recovery file contains an invalid source-verification marker.");
  }
  if (value.sourceVerifiedAt !== undefined
    && (typeof value.sourceVerifiedAt !== "string" || !Number.isFinite(Date.parse(value.sourceVerifiedAt)))) {
    throw new Error("The recovery file contains an invalid source-verification time.");
  }
  if (value.sourceEvidenceHash !== undefined
    && (typeof value.sourceEvidenceHash !== "string" || !HASH_PATTERN.test(value.sourceEvidenceHash))) {
    throw new Error("The recovery file contains an invalid source-evidence hash.");
  }
  if (value.latestSourceEvidenceHash !== undefined
    && (typeof value.latestSourceEvidenceHash !== "string" || !HASH_PATTERN.test(value.latestSourceEvidenceHash))) {
    throw new Error("The recovery file contains an invalid latest source-evidence hash.");
  }
  if (value.smokeEvidenceHash !== undefined
    && (typeof value.smokeEvidenceHash !== "string" || !HASH_PATTERN.test(value.smokeEvidenceHash))) {
    throw new Error("The recovery file contains an invalid smoke-evidence hash.");
  }
  if (value.productionVerifiedAt !== undefined
    && (typeof value.productionVerifiedAt !== "string" || !Number.isFinite(Date.parse(value.productionVerifiedAt)))) {
    throw new Error("The recovery file contains an invalid production-verification time.");
  }
  if (value.factoryStartBlock !== undefined
    && (typeof value.factoryStartBlock !== "string" || !DECIMAL_PATTERN.test(value.factoryStartBlock))) {
    throw new Error("The recovery file contains an invalid factory start block.");
  }

  return {
    addresses,
    transactions,
    proposalIds,
    readyAt,
    ...(value.hookSalt ? { hookSalt: value.hookSalt as Hex } : {}),
    verified: value.verified === true,
    sourceVerified: value.sourceVerified === true,
    ...(typeof value.sourceVerifiedAt === "string" ? { sourceVerifiedAt: value.sourceVerifiedAt } : {}),
    ...(typeof value.sourceEvidenceHash === "string" ? { sourceEvidenceHash: value.sourceEvidenceHash as Hex } : {}),
    ...(typeof value.latestSourceEvidenceHash === "string"
      ? { latestSourceEvidenceHash: value.latestSourceEvidenceHash as Hex }
      : {}),
    ...(typeof value.smokeEvidenceHash === "string" ? { smokeEvidenceHash: value.smokeEvidenceHash as Hex } : {}),
    ...(typeof value.productionVerifiedAt === "string" ? { productionVerifiedAt: value.productionVerifiedAt } : {}),
    ...(typeof value.factoryStartBlock === "string" ? { factoryStartBlock: value.factoryStartBlock } : {})
  };
}

function short(value: Address) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function describeError(cause: unknown) {
  let current = cause;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === 4001) return "The wallet cancelled this step. Completed steps remain saved.";
    current = candidate.cause;
  }
  return cause instanceof Error ? cause.message : "The release step stopped safely.";
}

function timeLabel(value?: string | bigint) {
  if (!value) return "Not scheduled";
  return new Date(Number(value) * 1_000).toLocaleString();
}

export function V6ReleaseConsole() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { switchChainAsync } = useSwitchChain();
  const [deployment, setDeployment] = useState<ReleaseDeployment>(EMPTY);
  const [activeFactory, setActiveFactory] = useState<Address>();
  const [pendingFactory, setPendingFactory] = useState<Address>();
  const [pendingActivationTime, setPendingActivationTime] = useState<bigint>();
  const [launchesPaused, setLaunchesPaused] = useState(true);
  const [onchainUnpauseTime, setOnchainUnpauseTime] = useState<bigint>();
  const [officialMigrationConsumed, setOfficialMigrationConsumed] = useState<boolean>();
  const [officialToken, setOfficialToken] = useState<Address>();
  const [officialSmokeFees, setOfficialSmokeFees] = useState<bigint>();
  const [bootstrapState, setBootstrapState] = useState<number>();
  const [bootstrapExpiresAt, setBootstrapExpiresAt] = useState<bigint>();
  const [balance, setBalance] = useState<bigint>();
  const [status, setStatus] = useState(
    DEPLOYMENT_ARTIFACTS_READY
      ? "Ready to deploy the reviewed V6 foundation"
      : "Deployment blocked until CI regenerates the final V6 wallet artifact"
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));

  const isOperator = address?.toLowerCase() === OPERATOR.toLowerCase();
  const factory = deployment.addresses.factory;
  const isActive = Boolean(factory && activeFactory?.toLowerCase() === factory.toLowerCase());
  const initialProposed = Boolean(
    deployment.proposalIds.fairPolicy && deployment.proposalIds.openPolicy && deployment.proposalIds.factoryActivation
  );
  const initialExecuted = Boolean(
    deployment.transactions.executeFairPolicySchedule
      && deployment.transactions.executeOpenPolicySchedule
      && deployment.transactions.executeFactoryProposal
      && deployment.readyAt.policyRegistration
  );
  const policiesRegistered = Boolean(
    deployment.transactions.registerFairPolicy && deployment.transactions.registerOpenPolicy
  );
  const defaultProposed = Boolean(deployment.proposalIds.defaultPolicy);
  const defaultScheduled = Boolean(
    deployment.transactions.executeDefaultSchedule && deployment.readyAt.defaultPolicy
  );
  const defaultSet = Boolean(deployment.transactions.executeDefaultPolicy);
  const unpauseProposed = Boolean(deployment.proposalIds.unpause);
  const unpauseScheduled = Boolean(
    deployment.transactions.executeUnpauseSchedule && deployment.readyAt.unpause
  );
  const isOpen = Boolean(isActive && !launchesPaused);
  const hasRecoveryProgress = Object.keys(deployment.transactions).length > 0
    || Object.keys(deployment.addresses).length > 0;

  function persist(next: ReleaseDeployment) {
    const snapshot = {
      ...next,
      addresses: { ...next.addresses },
      transactions: { ...next.transactions },
      proposalIds: { ...next.proposalIds },
      readyAt: { ...next.readyAt }
    };
    setDeployment(snapshot);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  async function refreshOnchain() {
    if (!publicClient) return;
    if (address) setBalance(await publicClient.getBalance({ address }));
    const bootstrap = deployment.addresses.bootstrapController;
    if (bootstrap && await hasCode(bootstrap)) {
      const [state, expiresAt, latestBlock] = await Promise.all([
        publicClient.readContract({ address: bootstrap, abi: artifacts.bootstrapV6.abi, functionName: "state" }),
        publicClient.readContract({ address: bootstrap, abi: artifacts.bootstrapV6.abi, functionName: "expiresAt" }),
        publicClient.getBlock({ blockTag: "latest" })
      ]);
      setBootstrapState(Number(state));
      setBootstrapExpiresAt(expiresAt as bigint);
      setCurrentTime(latestBlock.timestamp);
    } else {
      setBootstrapState(undefined);
      setBootstrapExpiresAt(undefined);
    }
    const registry = deployment.addresses.registry;
    if (!registry || !(await hasCode(registry))) {
      setActiveFactory(undefined);
      setPendingFactory(undefined);
      setPendingActivationTime(undefined);
      setOfficialMigrationConsumed(undefined);
      setOfficialToken(undefined);
      setOfficialSmokeFees(undefined);
      return;
    }
    const [active, pending, activation] = await Promise.all([
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingActivationTime" })
    ]);
    setActiveFactory(active as Address);
    setPendingFactory(pending as Address);
    setPendingActivationTime(activation as bigint);
    const releaseFactory = deployment.addresses.factory;
    if (releaseFactory && await hasCode(releaseFactory)) {
      const migration = await publicClient.readContract({
        address: releaseFactory,
        abi: artifacts.rmtFactoryV6.abi,
        functionName: "officialIdentityMigration"
      }) as Address;
      if (!(await hasCode(migration))) throw new Error("The active V6 factory's official migration contract is missing.");
      const consumed = await publicClient.readContract({
        address: migration,
        abi: officialMigrationAbi,
        functionName: "consumed"
      }) as boolean;
      setOfficialMigrationConsumed(consumed);
      const launchCount = await publicClient.readContract({
        address: releaseFactory,
        abi: artifacts.rmtFactoryV6.abi,
        functionName: "launchCount"
      }) as bigint;
      if (launchCount >= 1n) {
        const launch = await publicClient.readContract({
          address: releaseFactory,
          abi: artifacts.rmtFactoryV6.abi,
          functionName: "getLaunch",
          args: [0n]
        }) as unknown as { token: Address; rewardVault: Address; officialMigration: boolean };
        if (launch.officialMigration) {
          setOfficialToken(launch.token);
          setOfficialSmokeFees(await publicClient.readContract({
            address: launch.rewardVault,
            abi: artifacts.feeSplitterV6.abi,
            functionName: "totalReceived"
          }) as bigint);
        } else {
          setOfficialToken(undefined);
          setOfficialSmokeFees(undefined);
        }
      } else {
        setOfficialToken(undefined);
        setOfficialSmokeFees(undefined);
      }
    } else {
      setOfficialMigrationConsumed(undefined);
      setOfficialToken(undefined);
      setOfficialSmokeFees(undefined);
    }
    const gate = deployment.addresses.launchGate;
    if (gate && await hasCode(gate)) {
      const [paused, unpauseTime] = await Promise.all([
        publicClient.readContract({ address: gate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
        publicClient.readContract({ address: gate, abi: artifacts.launchGateV6.abi, functionName: "unpauseExecutableAt" })
      ]);
      setLaunchesPaused(paused as boolean);
      setOnchainUnpauseTime(unpauseTime as bigint);
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setDeployment(parseRecoveryDeployment(JSON.parse(raw) as unknown)); }
      catch { localStorage.removeItem(STORAGE_KEY); }
    }
  }, []);

  useEffect(() => {
    void refreshOnchain().catch(() => undefined);
    const timer = window.setInterval(() => {
      setCurrentTime(BigInt(Math.floor(Date.now() / 1_000)));
      void refreshOnchain().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [publicClient, address, deployment.addresses.bootstrapController, deployment.addresses.registry, deployment.addresses.launchGate, deployment.addresses.factory]);

  async function hasCode(value?: Address) {
    if (!value || !publicClient) return false;
    const code = await publicClient.getBytecode({ address: value });
    return Boolean(code && code !== "0x");
  }

  async function validateBootstrapVerifiers(bootstrapController: Address) {
    if (!publicClient || !(await hasCode(bootstrapController))) {
      throw new Error("The V6 bootstrap controller is missing onchain.");
    }
    const [foundationVerifier, smokeVerifier] = await Promise.all([
      publicClient.readContract({
        address: bootstrapController,
        abi: artifacts.bootstrapV6.abi,
        functionName: "foundationVerifier"
      }),
      publicClient.readContract({
        address: bootstrapController,
        abi: artifacts.bootstrapV6.abi,
        functionName: "smokeVerifier"
      })
    ]) as [Address, Address];
    if (!ADDRESS_PATTERN.test(foundationVerifier) || !ADDRESS_PATTERN.test(smokeVerifier)
      || foundationVerifier.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      || smokeVerifier.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      || foundationVerifier.toLowerCase() === smokeVerifier.toLowerCase()
      || foundationVerifier.toLowerCase() === bootstrapController.toLowerCase()
      || smokeVerifier.toLowerCase() === bootstrapController.toLowerCase()
      || !(await hasCode(foundationVerifier)) || !(await hasCode(smokeVerifier))) {
      throw new Error("The V6 bootstrap verifier children are missing or invalid.");
    }
    const [foundationController, smokeController] = await Promise.all([
      publicClient.readContract({
        address: foundationVerifier,
        abi: artifacts.bootstrapFoundationVerifierV6.abi,
        functionName: "controller"
      }),
      publicClient.readContract({
        address: smokeVerifier,
        abi: artifacts.bootstrapSmokeVerifierV6.abi,
        functionName: "controller"
      })
    ]) as [Address, Address];
    if (foundationController.toLowerCase() !== bootstrapController.toLowerCase()
      || smokeController.toLowerCase() !== bootstrapController.toLowerCase()) {
      throw new Error("The V6 bootstrap verifier children are not bound to this controller.");
    }
    return { foundationVerifier, smokeVerifier };
  }

  async function validateV6Governance(
    governance: Address,
    expectedTransactionCount?: bigint,
    requirePristineConfiguration = true
  ) {
    if (!publicClient || !(await hasCode(governance))) {
      throw new Error("The V6 governance contract is missing onchain.");
    }
    const [operatorIsSigner, signerCount, threshold, delay, window, epoch, transactionCount] = await Promise.all([
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "isSigner", args: [OPERATOR] }),
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "signerCount" }),
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "threshold" }),
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "executionDelay" }),
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "executionWindow" }),
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "configurationEpoch" }),
      publicClient.readContract({ address: governance, abi: artifacts.governanceV6.abi, functionName: "transactionCount" })
    ]);
    const signerCountValue = signerCount as bigint;
    const thresholdValue = threshold as bigint;
    const epochValue = epoch as bigint;
    const permanentConfigurationInvalid = delay !== DAY || window !== GOVERNANCE_EXECUTION_WINDOW
      || signerCountValue < 1n || thresholdValue < 1n || thresholdValue > signerCountValue || epochValue < 1n;
    const pristineConfigurationInvalid = requirePristineConfiguration && (
      operatorIsSigner !== true || signerCountValue !== 1n || thresholdValue !== 1n || epochValue !== 1n
    );
    if (permanentConfigurationInvalid || pristineConfigurationInvalid
      || (expectedTransactionCount !== undefined && transactionCount !== expectedTransactionCount)) {
      throw new Error(requirePristineConfiguration
        ? "V6 governance does not match the reviewed pristine one-wallet, 24-hour delay, seven-day execution-window configuration."
        : "V6 governance no longer preserves its reviewed permanent delay, execution window, and valid signer threshold.");
    }
    return transactionCount as bigint;
  }

  async function readContractLogs(addressToRead: Address, fromBlock: bigint) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const latestBlock = await publicClient.getBlockNumber();
    const logs = [] as Awaited<ReturnType<typeof publicClient.getLogs>>;
    const chunkSize = 20_000n;
    for (let start = fromBlock; start <= latestBlock; start += chunkSize) {
      const end = start + chunkSize - 1n < latestBlock ? start + chunkSize - 1n : latestBlock;
      logs.push(...await publicClient.getLogs({ address: addressToRead, fromBlock: start, toBlock: end }));
    }
    return logs;
  }

  async function foundationStartBlock(current: ReleaseDeployment) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const hashes = FOUNDATION_TRANSACTION_KEYS
      .map((key) => current.transactions[key])
      .filter((hash): hash is Hex => Boolean(hash));
    if (hashes.length === 0) return undefined;
    const receipts = await Promise.all(hashes.map((hash) => publicClient.getTransactionReceipt({ hash })));
    if (receipts.some((receipt) => receipt.status !== "success")) {
      throw new Error("A saved V6 foundation transaction did not succeed.");
    }
    return receipts.reduce(
      (earliest, receipt) => receipt.blockNumber < earliest ? receipt.blockNumber : earliest,
      receipts[0].blockNumber
    );
  }

  async function validateSavedDeploymentReceipts(current: ReleaseDeployment) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const {
      governance,
      bootstrapController,
      registry,
      hook,
      adapter,
      launchGate,
      policyRegistry,
      marketImplementation,
      factory
    } = current.addresses;
    if (!governance || !bootstrapController || !registry || !hook || !adapter || !launchGate
      || !policyRegistry || !marketImplementation || !factory) {
      throw new Error("The exact V6 deployment addresses are required to validate creation inputs.");
    }
    const expectedDirectDeployment = (key: Exclude<AddressKey, "hook">) => {
      switch (key) {
        case "governance":
          return encodeDeployData({
            abi: artifacts.governanceV6.abi,
            bytecode: artifacts.governanceV6.bytecode,
            args: [OPERATOR, DAY, GOVERNANCE_EXECUTION_WINDOW]
          });
        case "bootstrapController":
          return encodeDeployData({
            abi: artifacts.bootstrapV6.abi,
            bytecode: artifacts.bootstrapV6.bytecode,
            args: [governance]
          });
        case "registry":
          return encodeDeployData({
            abi: artifacts.registry.abi,
            bytecode: artifacts.registry.bytecode,
            args: [governance, 2n * DAY, V5_FACTORY, V5_VERSION, bootstrapController]
          });
        case "adapter":
          return encodeDeployData({
            abi: artifacts.adapter.abi,
            bytecode: artifacts.adapter.bytecode,
            args: [POOL_MANAGER, hook, 5_000, 200]
          });
        case "launchGate":
          return encodeDeployData({
            abi: artifacts.launchGateV6.abi,
            bytecode: artifacts.launchGateV6.bytecode,
            args: [governance, OPERATOR, DAY, bootstrapController]
          });
        case "marketImplementation":
          return encodeDeployData({ abi: artifacts.marketV6.abi, bytecode: artifacts.marketV6.bytecode, args: [] });
        case "policyRegistry":
          return encodeDeployData({
            abi: artifacts.policyRegistryV6.abi,
            bytecode: artifacts.policyRegistryV6.bytecode,
            args: [governance, OPERATOR, DAY, governance, marketImplementation, adapter]
          });
        case "factory":
          return encodeDeployData({
            abi: artifacts.rmtFactoryV6.abi,
            bytecode: artifacts.rmtFactoryV6.bytecode,
            args: [
              launchGate,
              policyRegistry,
              registry,
              parseEther("0.3"),
              parseEther("1017500000"),
              V5_FACTORY,
              OFFICIAL_LEGACY_RMT_TOKEN,
              OPERATOR
            ]
          });
      }
    };
    await Promise.all(ADDRESS_KEYS.map(async (key) => {
      const addressToVerify = current.addresses[key];
      const transactionHash = current.transactions[key];
      if (!transactionHash) throw new Error(`The recovery record is missing its ${key} deployment transaction.`);
      if (!addressToVerify) {
        throw new Error(`The recovery record has a ${key} deployment receipt without its contract address.`);
      }
      const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
      if (key === "hook") {
        const salt = current.hookSalt;
        if (!salt) throw new Error("The recovery record's CREATE2 hook salt is missing.");
        const initCode = encodeDeployData({
          abi: artifacts.hook.abi,
          bytecode: artifacts.hook.bytecode,
          args: [POOL_MANAGER, OPERATOR]
        });
        const expectedHook = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecode: initCode });
        const transaction = await publicClient.getTransaction({ hash: transactionHash });
        if (receipt.status !== "success" || receipt.to?.toLowerCase() !== CREATE2_DEPLOYER.toLowerCase()
          || transaction.input.toLowerCase() !== concat([salt, initCode]).toLowerCase()
          || expectedHook.toLowerCase() !== addressToVerify.toLowerCase()
          || !(await hasCode(addressToVerify))) {
          throw new Error("The recovery record's hook transaction did not create the exact recorded CREATE2 hook.");
        }
        return;
      }
      if (
        receipt.status !== "success"
          || !receipt.contractAddress
          || receipt.contractAddress.toLowerCase() !== addressToVerify.toLowerCase()
      ) {
        throw new Error(`The recovery record's ${key} transaction did not create the recorded contract.`);
      }
      const transaction = await publicClient.getTransaction({ hash: transactionHash });
      const expectedInput = expectedDirectDeployment(key as Exclude<AddressKey, "hook">);
      if (transaction.to !== null || transaction.from.toLowerCase() !== OPERATOR.toLowerCase()
        || transaction.input.toLowerCase() !== expectedInput.toLowerCase()) {
        throw new Error(`The recovery record's ${key} creation input differs from the exact reviewed artifact and constructor arguments.`);
      }
    }));
  }

  async function validateAdapterContract(adapter: Address, hook: Address) {
    if (!publicClient || !(await hasCode(adapter))) throw new Error("The hook's recorded adapter has no bytecode.");
    const [adapterPoolManager, adapterHook, adapterDeployer, adapterFee, adapterTickSpacing, boundFactory] = await Promise.all([
      publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "poolManager" }),
      publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "hook" }),
      publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "deployer" }),
      publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "poolFee" }),
      publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "tickSpacing" }),
      publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" })
    ]);
    if (
      String(adapterPoolManager).toLowerCase() !== POOL_MANAGER.toLowerCase()
        || String(adapterHook).toLowerCase() !== hook.toLowerCase()
        || String(adapterDeployer).toLowerCase() !== OPERATOR.toLowerCase()
        || Number(adapterFee) !== 5_000 || Number(adapterTickSpacing) !== 200
    ) throw new Error("The hook is bound to an adapter outside the reviewed V6 configuration.");
    return boundFactory as Address;
  }

  async function validateAndRecoverFactory(
    factory: Address,
    expectedAdapter?: Address,
    expectedGovernance?: Address,
    expectedRegistry?: Address,
    requirePristineGovernance = true
  ) {
    if (!publicClient || !(await hasCode(factory))) throw new Error("The adapter's recorded factory has no bytecode.");
    const [
      protocolVersion,
      launchGate,
      policyRegistry,
      factoryRegistry,
      legacyFactory,
      officialLegacyToken,
      creatorPayoutAuthority,
      officialMigrationPolicyId,
      virtualEthReserve,
      virtualTokenReserve,
      tokenImplementation,
      feeSplitterImplementation,
      officialMigration
    ] = await Promise.all([
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "protocolVersion" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "launchGate" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "policyRegistry" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "factoryRegistry" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "legacyIdentityFactory" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialLegacyToken" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "creatorPayoutAuthority" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "OFFICIAL_MIGRATION_POLICY_ID" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "initialVirtualEthReserve" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "initialVirtualTokenReserve" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "tokenImplementation" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "feeSplitterImplementation" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialIdentityMigration" })
    ]);
    const recoveredGate = launchGate as Address;
    const recoveredPolicyRegistry = policyRegistry as Address;
    const migrationAddress = officialMigration as Address;
    if (!(await hasCode(recoveredGate)) || !(await hasCode(recoveredPolicyRegistry))
      || !(await hasCode(tokenImplementation as Address)) || !(await hasCode(feeSplitterImplementation as Address))
      || !(await hasCode(migrationAddress))) {
      throw new Error("The bound factory references a missing V6 contract.");
    }
    const [
      gateGovernance,
      gateGuardian,
      gateDelay,
      policyGovernance,
      policyGuardian,
      policyDelay,
      canonicalTreasury,
      canonicalMarketImplementation,
      canonicalGraduationAdapter,
      canonicalCurveFee,
      canonicalCreatorShare,
      canonicalProtocolShare,
      canonicalPostGraduationFee,
      canonicalGraduationTarget,
      officialLauncher,
      authorizedFactory,
      migrationOfficialLegacyToken
    ] = await Promise.all([
      publicClient.readContract({ address: recoveredGate, abi: artifacts.launchGateV6.abi, functionName: "governance" }),
      publicClient.readContract({ address: recoveredGate, abi: artifacts.launchGateV6.abi, functionName: "guardian" }),
      publicClient.readContract({ address: recoveredGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseDelay" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "governance" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "guardian" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "governanceDelay" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalProtocolTreasury" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalMarketImplementation" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalGraduationAdapter" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_CURVE_FEE_BPS" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_CREATOR_FEE_SHARE_BPS" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_PROTOCOL_FEE_SHARE_BPS" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_POST_GRADUATION_FEE_BPS" }),
      publicClient.readContract({ address: recoveredPolicyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_GRADUATION_TARGET" }),
      publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "officialLauncher" }),
      publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "authorizedFactory" }),
      publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "officialLegacyToken" })
    ]);
    if (
      Number(protocolVersion) !== 6
        || (expectedRegistry !== undefined
          && String(factoryRegistry).toLowerCase() !== expectedRegistry.toLowerCase())
        || String(legacyFactory).toLowerCase() !== V5_FACTORY.toLowerCase()
        || String(officialLegacyToken).toLowerCase() !== OFFICIAL_LEGACY_RMT_TOKEN.toLowerCase()
        || String(officialMigrationPolicyId).toLowerCase() !== FAIR_POLICY_ID.toLowerCase()
        || virtualEthReserve !== parseEther("0.3") || virtualTokenReserve !== parseEther("1017500000")
        || (requirePristineGovernance && String(gateGuardian).toLowerCase() !== OPERATOR.toLowerCase())
        || gateDelay !== DAY
        || (requirePristineGovernance && String(policyGuardian).toLowerCase() !== OPERATOR.toLowerCase())
        || policyDelay !== DAY
        || !(await hasCode(canonicalMarketImplementation as Address))
        || !(await hasCode(canonicalGraduationAdapter as Address))
        || (expectedAdapter !== undefined
          && String(canonicalGraduationAdapter).toLowerCase() !== expectedAdapter.toLowerCase())
        || Number(canonicalCurveFee) !== 100 || Number(canonicalCreatorShare) !== 7_000
        || Number(canonicalProtocolShare) !== 3_000 || Number(canonicalPostGraduationFee) !== 50
        || canonicalGraduationTarget !== parseEther("2")
        || String(officialLauncher).toLowerCase() !== OPERATOR.toLowerCase()
        || String(authorizedFactory).toLowerCase() !== factory.toLowerCase()
        || String(migrationOfficialLegacyToken).toLowerCase() !== OFFICIAL_LEGACY_RMT_TOKEN.toLowerCase()
    ) throw new Error("The adapter is bound to a factory outside the reviewed V6 configuration.");
    const recoveredGovernance = gateGovernance as Address;
    if (
      String(policyGovernance).toLowerCase() !== recoveredGovernance.toLowerCase()
        || String(creatorPayoutAuthority).toLowerCase() !== recoveredGovernance.toLowerCase()
        || String(canonicalTreasury).toLowerCase() !== recoveredGovernance.toLowerCase()
        || (expectedGovernance !== undefined
          && recoveredGovernance.toLowerCase() !== expectedGovernance.toLowerCase())
    ) throw new Error("The factory, gate, policy registry, and creator payout authority do not share V6 governance.");
    await validateV6Governance(recoveredGovernance, undefined, requirePristineGovernance);
    return {
      governance: recoveredGovernance,
      versionRegistry: factoryRegistry as Address,
      launchGate: recoveredGate,
      policyRegistry: recoveredPolicyRegistry,
      marketImplementation: canonicalMarketImplementation as Address,
      graduationAdapter: canonicalGraduationAdapter as Address
    };
  }

  async function adoptBoundStack(current: ReleaseDeployment, hook: Address) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const boundAdapter = await publicClient.readContract({
      address: hook,
      abi: artifacts.hook.abi,
      functionName: "adapter"
    }) as Address;
    if (boundAdapter.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return undefined;

    setStatus("Recovering the adapter already bound to this hook…");
    const boundFactory = await validateAdapterContract(boundAdapter, hook);
    current.addresses.adapter = boundAdapter;
    if (boundFactory.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      setStatus("Recovering the factory already bound to this adapter…");
      const recovered = await validateAndRecoverFactory(
        boundFactory, boundAdapter, current.addresses.governance, releaseRegistry(current)
      );
      if (current.addresses.marketImplementation
        && current.addresses.marketImplementation.toLowerCase() !== recovered.marketImplementation.toLowerCase()) {
        throw new Error("Saved recovery state conflicts with the bound registry's canonical market.");
      }
      current.addresses.factory = boundFactory;
      current.addresses.governance = recovered.governance;
      current.addresses.launchGate = recovered.launchGate;
      current.addresses.policyRegistry = recovered.policyRegistry;
      current.addresses.marketImplementation = recovered.marketImplementation;
    }
    persist(current);
    return {
      adapter: boundAdapter,
      factory: boundFactory.toLowerCase() === ZERO_ADDRESS.toLowerCase() ? undefined : boundFactory
    };
  }

  async function recoverCanonicalMarketImplementation(
    current: ReleaseDeployment,
    policyRegistry: Address,
    adapter: Address
  ) {
    if (!publicClient) return current.addresses.marketImplementation;
    const [marketImplementation, graduationAdapter] = await Promise.all([
      publicClient.readContract({
        address: policyRegistry,
        abi: artifacts.policyRegistryV6.abi,
        functionName: "canonicalMarketImplementation"
      }),
      publicClient.readContract({
        address: policyRegistry,
        abi: artifacts.policyRegistryV6.abi,
        functionName: "canonicalGraduationAdapter"
      })
    ]) as [Address, Address];
    if (graduationAdapter.toLowerCase() !== adapter.toLowerCase()
      || !(await hasCode(marketImplementation))) {
      throw new Error("The policy registry is not locked to the recovered V6 market and adapter.");
    }
    if (current.addresses.marketImplementation
      && current.addresses.marketImplementation.toLowerCase() !== marketImplementation.toLowerCase()) {
      throw new Error("The recovery record conflicts with the policy registry's canonical market implementation.");
    }
    current.addresses.marketImplementation = marketImplementation;
    persist(current);
    return marketImplementation;
  }

  function reviewedGovernanceProposalCount(current: ReleaseDeployment) {
    return BigInt(Object.values(current.proposalIds).filter((id) => id !== undefined).length);
  }

  async function verifyLiveDependencies(
    current?: ReleaseDeployment,
    reviewedProgressFactory?: Address
  ) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const [
      officialNameReserved,
      officialSymbolReserved,
      officialLegacyCreator,
      officialLegacyName,
      officialLegacySymbol
    ] = await Promise.all([
      publicClient.readContract({ address: V5_FACTORY, abi: artifacts.factory.abi, functionName: "isNameUsed", args: ["Robinhood Meme Terminal"] }),
      publicClient.readContract({ address: V5_FACTORY, abi: artifacts.factory.abi, functionName: "isSymbolUsed", args: ["RMT"] }),
      publicClient.readContract({ address: OFFICIAL_LEGACY_RMT_TOKEN, abi: officialLegacyTokenAbi, functionName: "creator" }),
      publicClient.readContract({ address: OFFICIAL_LEGACY_RMT_TOKEN, abi: officialLegacyTokenAbi, functionName: "name" }),
      publicClient.readContract({ address: OFFICIAL_LEGACY_RMT_TOKEN, abi: officialLegacyTokenAbi, functionName: "symbol" })
    ]);

    if (officialNameReserved !== true || officialSymbolReserved !== true) {
      throw new Error("The live V5 factory does not report the official RMT name and ticker as protected.");
    }
    if (
      String(officialLegacyCreator).toLowerCase() !== OPERATOR.toLowerCase()
        || officialLegacyName !== "Robinhood Meme Terminal" || officialLegacySymbol !== "RMT"
    ) {
      throw new Error("The protected V6 migration does not resolve to the exact reviewed legacy RMT token and creator.");
    }

    if (!current) return;
    const governance = current.addresses.governance;
    const registry = current.addresses.registry;
    if (!governance || !registry || !(await hasCode(registry))) {
      throw new Error("The fresh V6 governance and version registry are required.");
    }
    // Transaction IDs are reconciled from saved receipts later in recovery. Do not require the
    // local record to be complete before it has had a chance to recover a just-confirmed proposal.
    await validateV6Governance(governance);
    const [
      registryGovernance,
      activationDelay,
      registeredFactory,
      registeredVersion,
      registeredPendingFactory,
      registeredPendingVersion,
      registeredPendingTime
    ] = await Promise.all([
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "governance" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activationDelay" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingActivationTime" })
    ]);
    if (String(registryGovernance).toLowerCase() !== governance.toLowerCase() || activationDelay !== 2n * DAY) {
      throw new Error("The fresh version registry is not governed by the reviewed V6 governance with a 48-hour activation delay.");
    }
    const activeAddress = String(registeredFactory).toLowerCase();
    const activeVersion = String(registeredVersion).toLowerCase();
    const pendingAddress = String(registeredPendingFactory).toLowerCase();
    const pendingVersion = String(registeredPendingVersion).toLowerCase();
    const pendingActivation = registeredPendingTime as bigint;
    const noPendingFactory = pendingAddress === ZERO_ADDRESS.toLowerCase()
      && pendingVersion === ZERO_BYTES32.toLowerCase() && pendingActivation === 0n;
    if (reviewedProgressFactory) {
      const reviewedFactory = reviewedProgressFactory.toLowerCase();
      const activeIsV5 = activeAddress === V5_FACTORY.toLowerCase() && activeVersion === V5_VERSION.toLowerCase();
      const activeIsReviewedV6 = activeAddress === reviewedFactory && activeVersion === VERSION.toLowerCase();
      const pendingIsReviewedV6 = pendingAddress === reviewedFactory
        && pendingVersion === VERSION.toLowerCase() && pendingActivation > 0n;
      if (!((activeIsV5 && (noPendingFactory || pendingIsReviewedV6))
        || (activeIsReviewedV6 && noPendingFactory))) {
        throw new Error("The fresh registry contains a factory state outside the exact recovered V6 release progression.");
      }
    } else if (
      activeAddress !== V5_FACTORY.toLowerCase() || activeVersion !== V5_VERSION.toLowerCase() || !noPendingFactory
    ) {
      throw new Error("The fresh registry is not at its reviewed V5 starting point.");
    }
  }

  async function gasFor(data: Hex, to?: Address, fallback?: bigint) {
    if (!publicClient || !address) throw new Error("Mainnet provider is unavailable.");
    try {
      const estimate = await publicClient.estimateGas({ account: address, data, ...(to ? { to } : {}) });
      return estimate * 115n / 100n;
    } catch (cause) {
      if (!fallback) throw cause;
      return fallback;
    }
  }

  async function deployContract(
    current: ReleaseDeployment,
    key: AddressKey,
    artifact: Artifact,
    args: readonly unknown[],
    label: string
  ) {
    const saved = current.addresses[key];
    if (await hasCode(saved)) return saved as Address;
    if (!publicClient || !walletClient || !address) throw new Error("Connect RMTMain first.");
    const savedHash = current.transactions[key];
    if (savedHash) {
      setStatus(`Recovering: ${label}`);
      const savedReceipt = await publicClient.waitForTransactionReceipt({ hash: savedHash });
      if (savedReceipt.status !== "success" || !savedReceipt.contractAddress) {
        throw new Error(`${label} saved deployment failed.`);
      }
      current.addresses[key] = savedReceipt.contractAddress;
      persist(current);
      return savedReceipt.contractAddress;
    }
    setStatus(`Approve: ${label}`);
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const hash = await walletClient.sendTransaction({ account: address, chain: robinhoodChain, data, gas: await gasFor(data) });
    current.transactions[key] = hash;
    persist(current);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${label} deployment failed.`);
    current.addresses[key] = receipt.contractAddress;
    persist(current);
    return receipt.contractAddress;
  }

  async function sendCall(
    current: ReleaseDeployment,
    key: string,
    to: Address,
    artifact: Artifact,
    functionName: string,
    args: readonly unknown[],
    label: string
  ) {
    if (!publicClient || !walletClient || !address) throw new Error("Connect RMTMain first.");
    const savedHash = current.transactions[key];
    if (savedHash) {
      setStatus(`Recovering: ${label}`);
      const savedReceipt = await publicClient.waitForTransactionReceipt({ hash: savedHash });
      if (savedReceipt.status !== "success") throw new Error(`${label} saved transaction failed.`);
      return savedReceipt;
    }
    setStatus(`Approve: ${label}`);
    const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
    const hash = await walletClient.sendTransaction({ account: address, chain: robinhoodChain, to, data, gas: await gasFor(data, to) });
    current.transactions[key] = hash;
    persist(current);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} failed.`);
    return receipt;
  }

  async function deployHook(current: ReleaseDeployment) {
    const saved = current.addresses.hook;
    if (await hasCode(saved)) return saved as Address;
    if (!publicClient || !walletClient || !address) throw new Error("Connect RMTMain first.");
    setStatus("Finding the V6 graduation hook address…");
    const initCode = encodeDeployData({ abi: artifacts.hook.abi, bytecode: artifacts.hook.bytecode, args: [POOL_MANAGER, OPERATOR] });
    let salt = current.hookSalt;
    let expected = salt ? getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecode: initCode }) : undefined;
    if (expected && await hasCode(expected) && !current.transactions.hook) {
      // A hook not proven by this fresh recovery record may belong to an abandoned stack.
      // Never adopt it implicitly because it could already be bound to the legacy topology.
      salt = undefined;
      expected = undefined;
      delete current.hookSalt;
    }
    if (!salt || !expected || (BigInt(expected) & HOOK_MASK) !== HOOK_FLAGS) {
      for (let nonce = 0n; nonce < 1_000_000n; nonce += 1n) {
        const candidateSalt = toHex(nonce, { size: 32 });
        const candidate = getCreate2Address({ from: CREATE2_DEPLOYER, salt: candidateSalt, bytecode: initCode });
        if ((BigInt(candidate) & HOOK_MASK) === HOOK_FLAGS) {
          if (await hasCode(candidate)) continue;
          salt = candidateSalt;
          expected = candidate;
          current.hookSalt = salt;
          persist(current);
          break;
        }
        if (nonce > 0n && nonce % 2_000n === 0n) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (!salt || !expected) throw new Error("A valid V6 hook address could not be found.");
    if (!(await hasCode(expected))) {
      let hash = current.transactions.hook;
      if (!hash) {
        const data = concat([salt, initCode]);
        setStatus("Approve: V6 graduation hook");
        hash = await walletClient.sendTransaction({ account: address, chain: robinhoodChain, to: CREATE2_DEPLOYER, data, gas: await gasFor(data, CREATE2_DEPLOYER, 8_000_000n) });
        current.transactions.hook = hash;
        persist(current);
      } else {
        setStatus("Recovering: V6 graduation hook");
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !(await hasCode(expected))) throw new Error("V6 hook deployment failed.");
    }
    current.addresses.hook = expected;
    persist(current);
    return expected;
  }

  function policies(marketImplementation: Address, adapter: Address, governance: Address) {
    const shared = {
      policyVersion: 1,
      enabled: true,
      publiclySelectable: true,
      curveFeeBps: 100,
      creatorFeeShareBps: 7_000,
      protocolFeeShareBps: 3_000,
      postGraduationFeeBps: 50,
      graduationTarget: parseEther("2"),
      marketImplementation,
      protocolTreasury: governance,
      graduationAdapter: adapter
    };
    const fair: LaunchPolicy = {
      ...shared,
      policyId: FAIR_POLICY_ID,
      fairStartMode: 1,
      fairStartDelayBlocks: 1n,
      fairStartDurationBlocks: 10n,
      fairStartMaxTxBps: 100,
      fairStartMaxWalletBps: 300
    };
    const open: LaunchPolicy = {
      ...shared,
      policyId: OPEN_POLICY_ID,
      fairStartMode: 0,
      fairStartDelayBlocks: 0n,
      fairStartDurationBlocks: 0n,
      fairStartMaxTxBps: 0,
      fairStartMaxWalletBps: 0
    };
    return { fair, open };
  }

  function policyMatches(actual: LaunchPolicy, expected: LaunchPolicy, includeAvailability = true) {
    return actual.policyId.toLowerCase() === expected.policyId.toLowerCase()
      && Number(actual.policyVersion) === expected.policyVersion
      && (!includeAvailability || (
        actual.enabled === expected.enabled && actual.publiclySelectable === expected.publiclySelectable
      ))
      && Number(actual.curveFeeBps) === expected.curveFeeBps
      && Number(actual.creatorFeeShareBps) === expected.creatorFeeShareBps
      && Number(actual.protocolFeeShareBps) === expected.protocolFeeShareBps
      && Number(actual.postGraduationFeeBps) === expected.postGraduationFeeBps
      && actual.graduationTarget === expected.graduationTarget
      && Number(actual.fairStartMode) === expected.fairStartMode
      && actual.fairStartDelayBlocks === expected.fairStartDelayBlocks
      && actual.fairStartDurationBlocks === expected.fairStartDurationBlocks
      && Number(actual.fairStartMaxTxBps) === expected.fairStartMaxTxBps
      && Number(actual.fairStartMaxWalletBps) === expected.fairStartMaxWalletBps
      && actual.marketImplementation.toLowerCase() === expected.marketImplementation.toLowerCase()
      && actual.protocolTreasury.toLowerCase() === expected.protocolTreasury.toLowerCase()
      && actual.graduationAdapter.toLowerCase() === expected.graduationAdapter.toLowerCase();
  }

  async function sourceContractAddresses(current: ReleaseDeployment): Promise<SourceContractAddresses> {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const { governance, bootstrapController, registry, hook, adapter, launchGate, policyRegistry, marketImplementation, factory } = current.addresses;
    if (!governance || !bootstrapController || !registry || !hook || !adapter || !launchGate || !policyRegistry || !marketImplementation || !factory) {
      throw new Error("All nine deployed V6 foundation addresses are required before source verification.");
    }

    const [tokenImplementation, feeSplitterImplementation, officialMigration, bootstrapVerifiers] = await Promise.all([
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "tokenImplementation" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "feeSplitterImplementation" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialIdentityMigration" }),
      validateBootstrapVerifiers(bootstrapController)
    ]) as [Address, Address, Address, Awaited<ReturnType<typeof validateBootstrapVerifiers>>];

    const contracts: SourceContractAddresses = {
      governance,
      bootstrapController,
      foundationVerifier: bootstrapVerifiers.foundationVerifier,
      smokeVerifier: bootstrapVerifiers.smokeVerifier,
      versionRegistry: registry,
      legacyFactory: V5_FACTORY,
      hook,
      adapter,
      launchGate,
      policyRegistry,
      marketImplementation,
      tokenImplementation,
      feeSplitterImplementation,
      officialMigration,
      factory
    };
    const contractEntries = Object.entries(contracts) as Array<[string, Address]>;
    if (new Set(contractEntries.map(([, contractAddress]) => contractAddress.toLowerCase())).size
      !== contractEntries.length) {
      throw new Error("The V6 source-verification address set contains a duplicate contract.");
    }
    const codeChecks = await Promise.all(contractEntries.map(async ([label, contractAddress]) => ({
      label,
      valid: ADDRESS_PATTERN.test(contractAddress)
        && contractAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        && await hasCode(contractAddress)
    })));
    const invalid = codeChecks.find((check) => !check.valid);
    if (invalid) {
      throw new Error(`The ${invalid.label} source-verification address has no deployed bytecode.`);
    }
    return contracts;
  }

  async function verifySourcesLive(current: ReleaseDeployment) {
    current.sourceVerified = false;
    delete current.sourceVerifiedAt;
    delete current.latestSourceEvidenceHash;
    persist(current);
    setStatus("Checking all fifteen V6 contracts and critical RMT dependencies on Blockscout…");

    const contracts = await sourceContractAddresses(current);
    const response = await fetch("/api/deploy-mainnet/v6-source-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ contracts }),
      cache: "no-store"
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(payload)) {
      throw new Error("Blockscout source verification is unavailable. No activation transaction was submitted.");
    }
    const expectedSourceEntries = Object.entries(contracts);
    if (payload.verified !== true || !Array.isArray(payload.contracts)
      || payload.contracts.length !== expectedSourceEntries.length
      || payload.contracts.some((entry, index) => {
        if (!isRecord(entry) || entry.verified !== true) return true;
        const expected = expectedSourceEntries[index];
        return entry.key !== expected[0] || typeof entry.address !== "string"
          || entry.address.toLowerCase() !== expected[1].toLowerCase();
      })) {
      const failures = Array.isArray(payload.contracts)
        ? payload.contracts.flatMap((entry) => {
          if (!isRecord(entry) || entry.verified === true) return [];
          const name = typeof entry.expectedName === "string" ? entry.expectedName : "V6 contract";
          const reasons = Array.isArray(entry.failures)
            ? entry.failures.filter((reason): reason is string => typeof reason === "string").join(", ")
            : "verification incomplete";
          return [`${name}: ${reasons}`];
        })
        : [];
      throw new Error(`Exact Blockscout verification is incomplete${failures.length ? ` — ${failures.join("; ")}` : ""}. No activation transaction was submitted.`);
    }

    if (typeof payload.checkedAt !== "string" || !Number.isFinite(Date.parse(payload.checkedAt))) {
      throw new Error("Blockscout returned an invalid verification time. No activation transaction was submitted.");
    }
    const evidenceHash = keccak256(toHex(JSON.stringify({
      chainId: robinhoodChain.id,
      version: VERSION,
      checkedAt: payload.checkedAt,
      contracts
    })));
    current.sourceVerified = true;
    current.sourceVerifiedAt = payload.checkedAt;
    current.latestSourceEvidenceHash = evidenceHash;
    // The first successful check becomes the immutable activation anchor. Subsequent
    // cutover/open checks are recorded separately and cannot rewrite onchain history.
    current.sourceEvidenceHash ??= evidenceHash;
    persist(current);
    return contracts;
  }

  type BootstrapPhase = "unbound" | "official-pending" | "complete";

  function bootstrapPhaseFromState(value: number): BootstrapPhase {
    if (value === 0) return "unbound";
    if (value === 1) return "official-pending";
    if (value === 2) return "complete";
    throw new Error("The expedited V6 bootstrap is aborted.");
  }

  async function validateBootstrapRelease(current: ReleaseDeployment, expectedPhase?: BootstrapPhase) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const {
      governance,
      bootstrapController,
      registry,
      hook,
      adapter,
      launchGate,
      policyRegistry,
      marketImplementation,
      factory
    } = current.addresses;
    if (!governance || !bootstrapController || !registry || !hook || !adapter || !launchGate
      || !policyRegistry || !marketImplementation || !factory) {
      throw new Error("The complete V6 bootstrap foundation is required.");
    }
    await validateBootstrapVerifiers(bootstrapController);
    const previewPhase = bootstrapPhaseFromState(Number(await publicClient.readContract({
      address: bootstrapController,
      abi: artifacts.bootstrapV6.abi,
      functionName: "state"
    })));
    const requirePristineGovernance = previewPhase !== "complete";
    await validateSavedDeploymentReceipts(current);
    const factoryDeploymentHash = current.transactions.factory;
    if (!factoryDeploymentHash) throw new Error("The V6 factory deployment receipt is missing.");
    const factoryDeploymentReceipt = await publicClient.getTransactionReceipt({ hash: factoryDeploymentHash });
    if (factoryDeploymentReceipt.status !== "success"
      || factoryDeploymentReceipt.contractAddress?.toLowerCase() !== factory.toLowerCase()) {
      throw new Error("The V6 factory deployment receipt does not match the recorded factory.");
    }
    current.factoryStartBlock = factoryDeploymentReceipt.blockNumber.toString();
    await validateV6Governance(
      governance,
      requirePristineGovernance ? 0n : undefined,
      requirePristineGovernance
    );
    if (requirePristineGovernance) await verifyLiveDependencies(current, factory);
    else await verifyLiveDependencies();
    const recovered = await validateAndRecoverFactory(
      factory,
      adapter,
      governance,
      registry,
      requirePristineGovernance
    );
    if (recovered.launchGate.toLowerCase() !== launchGate.toLowerCase()
      || recovered.policyRegistry.toLowerCase() !== policyRegistry.toLowerCase()
      || recovered.marketImplementation.toLowerCase() !== marketImplementation.toLowerCase()
      || recovered.graduationAdapter.toLowerCase() !== adapter.toLowerCase()) {
      throw new Error("The V6 factory topology differs from the recorded foundation.");
    }
    const [hookPoolManager, hookDeployer, hookAdapter] = await Promise.all([
      publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "poolManager" }),
      publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "deployer" }),
      publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "adapter" })
    ]);
    const boundFactory = await validateAdapterContract(adapter, hook);
    if (String(hookPoolManager).toLowerCase() !== POOL_MANAGER.toLowerCase()
      || String(hookDeployer).toLowerCase() !== OPERATOR.toLowerCase()
      || String(hookAdapter).toLowerCase() !== adapter.toLowerCase()
      || boundFactory.toLowerCase() !== factory.toLowerCase()
      || (BigInt(hook) & HOOK_MASK) !== HOOK_FLAGS) {
      throw new Error("The V6 hook and adapter bindings do not match the reviewed foundation.");
    }

    const migration = await publicClient.readContract({
      address: factory,
      abi: artifacts.rmtFactoryV6.abi,
      functionName: "officialIdentityMigration"
    }) as Address;
    const [
      controllerGovernance,
      controllerOperator,
      controllerWindow,
      controllerExpiresAt,
      controllerState,
      storedRegistry,
      storedGate,
      storedPolicies,
      storedFactory,
      controllerSourceEvidence,
      controllerSmokeEvidence,
      registryGovernance,
      registryActivationDelay,
      registryController,
      registryInitialFactory,
      registryInitialVersion,
      registryBootstrapConsumed,
      activeRegistryFactory,
      activeRegistryVersion,
      pendingRegistryFactory,
      pendingRegistryVersion,
      pendingRegistryTime,
      pendingRegistryExpiration,
      pendingRegistryEpoch,
      gateGovernance,
      gateGuardian,
      gateController,
      gateUnpauseDelay,
      gateBootstrapConsumed,
      gatePaused,
      gateUnpauseTime,
      gateUnpauseExpiration,
      gateUnpauseEpoch,
      defaultPolicy,
      fairPolicy,
      openPolicy,
      migrationConsumed,
      launchCount,
      latestBlock
    ] = await Promise.all([
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "governance" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "OPERATOR" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "BOOTSTRAP_WINDOW" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "expiresAt" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "state" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "versionRegistry" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "launchGate" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "policyRegistry" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "factory" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "sourceEvidenceHash" }),
      publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "smokeEvidenceHash" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "governance" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activationDelay" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "bootstrapController" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "initialFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "initialVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "bootstrapConsumed" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingActivationTime" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingExpirationTime" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingConfigurationEpoch" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "governance" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "guardian" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "bootstrapController" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseDelay" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "bootstrapConsumed" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseExecutableAt" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseExpiresAt" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseConfigurationEpoch" }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "getPolicy", args: [FAIR_POLICY_ID] }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "getPolicy", args: [OPEN_POLICY_ID] }),
      publicClient.readContract({ address: migration, abi: officialMigrationAbi, functionName: "consumed" }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "launchCount" }),
      publicClient.getBlock({ blockTag: "latest" })
    ]);
    const phase = bootstrapPhaseFromState(Number(controllerState));
    if (phase !== previewPhase) throw new Error("The V6 bootstrap changed state while it was being validated.");
    if (expectedPhase && phase !== expectedPhase) {
      throw new Error(`The V6 bootstrap is ${phase}, not ${expectedPhase}.`);
    }
    const activated = phase !== "unbound";
    const complete = phase === "complete";
    const launchCountValue = launchCount as bigint;
    const { fair, open } = policies(marketImplementation, adapter, governance);
    const immutableFoundationInvalid = (
      String(controllerGovernance).toLowerCase() !== governance.toLowerCase()
        || String(controllerOperator).toLowerCase() !== OPERATOR.toLowerCase()
        || controllerWindow !== 12n * 60n * 60n
        || (!complete && latestBlock.timestamp > (controllerExpiresAt as bigint))
        || String(registryGovernance).toLowerCase() !== governance.toLowerCase()
        || registryActivationDelay !== 2n * DAY
        || String(registryController).toLowerCase() !== bootstrapController.toLowerCase()
        || String(registryInitialFactory).toLowerCase() !== V5_FACTORY.toLowerCase()
        || String(registryInitialVersion).toLowerCase() !== V5_VERSION.toLowerCase()
        || String(gateGovernance).toLowerCase() !== governance.toLowerCase()
        || String(gateController).toLowerCase() !== bootstrapController.toLowerCase()
        || gateUnpauseDelay !== DAY
        || !policyMatches(fairPolicy as LaunchPolicy, fair, !complete)
        || !policyMatches(openPolicy as LaunchPolicy, open, !complete)
    );
    const strictBootstrapProgressInvalid = !complete && (
      String(gateGuardian).toLowerCase() !== OPERATOR.toLowerCase()
        || registryBootstrapConsumed !== activated
        || String(activeRegistryFactory).toLowerCase() !== (activated ? factory : V5_FACTORY).toLowerCase()
        || String(activeRegistryVersion).toLowerCase() !== (activated ? VERSION : V5_VERSION).toLowerCase()
        || String(pendingRegistryFactory).toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        || String(pendingRegistryVersion).toLowerCase() !== ZERO_BYTES32.toLowerCase()
        || pendingRegistryTime !== 0n || pendingRegistryExpiration !== 0n || pendingRegistryEpoch !== 0n
        || gateBootstrapConsumed !== false || gatePaused !== true || gateUnpauseTime !== 0n
        || gateUnpauseExpiration !== 0n || gateUnpauseEpoch !== 0n
        || String(defaultPolicy).toLowerCase() !== FAIR_POLICY_ID.toLowerCase()
    );
    const completedBootstrapInvalid = complete && (
      registryBootstrapConsumed !== true || gateBootstrapConsumed !== true
        || String(gateGuardian).toLowerCase() === ZERO_ADDRESS.toLowerCase()
    );
    if (immutableFoundationInvalid || strictBootstrapProgressInvalid || completedBootstrapInvalid) {
      throw new Error("The V6 bootstrap foundation no longer matches the reviewed release state.");
    }

    if (!activated) {
      if (String(storedRegistry).toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        || String(storedGate).toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        || String(storedPolicies).toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        || String(storedFactory).toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        || String(controllerSourceEvidence).toLowerCase() !== ZERO_BYTES32.toLowerCase()
        || migrationConsumed !== false || launchCount !== 0n) {
        throw new Error("The unused V6 bootstrap controller contains unexpected release state.");
      }
    } else {
      if (String(storedRegistry).toLowerCase() !== registry.toLowerCase()
        || String(storedGate).toLowerCase() !== launchGate.toLowerCase()
        || String(storedPolicies).toLowerCase() !== policyRegistry.toLowerCase()
        || String(storedFactory).toLowerCase() !== factory.toLowerCase()
        || String(controllerSourceEvidence).toLowerCase() === ZERO_BYTES32.toLowerCase()
        || (!complete && (migrationConsumed === true ? launchCountValue !== 1n : launchCountValue !== 0n))
        || (complete && (migrationConsumed !== true || launchCountValue < 1n
          || String(controllerSmokeEvidence).toLowerCase() === ZERO_BYTES32.toLowerCase()))
      ) throw new Error("The activated V6 bootstrap record does not match the official migration state.");
      if (current.sourceEvidenceHash
        && String(controllerSourceEvidence).toLowerCase() !== current.sourceEvidenceHash.toLowerCase()) {
        throw new Error("The recovery record's source evidence differs from the immutable onchain evidence.");
      }
      current.sourceEvidenceHash = controllerSourceEvidence as Hex;
    }

    if (complete) {
      const officialLaunch = await publicClient.readContract({
        address: factory,
        abi: artifacts.rmtFactoryV6.abi,
        functionName: "getLaunch",
        args: [0n]
      }) as unknown as {
        token: Address;
        market: Address;
        rewardVault: Address;
        creator: Address;
        policyId: Hex;
        policyVersion: number;
        officialMigration: boolean;
      };
      if (!officialLaunch.officialMigration || officialLaunch.creator.toLowerCase() !== OPERATOR.toLowerCase()
        || officialLaunch.policyId.toLowerCase() !== FAIR_POLICY_ID.toLowerCase()
        || Number(officialLaunch.policyVersion) !== 1 || !(await hasCode(officialLaunch.token))
        || !(await hasCode(officialLaunch.market)) || !(await hasCode(officialLaunch.rewardVault))) {
        throw new Error("The permanent V6 launch-zero record is not the exact official RMT migration.");
      }
      if (current.smokeEvidenceHash
        && String(controllerSmokeEvidence).toLowerCase() !== current.smokeEvidenceHash.toLowerCase()) {
        throw new Error("The recovery record's smoke evidence differs from the immutable onchain evidence.");
      }
      current.smokeEvidenceHash = controllerSmokeEvidence as Hex;
    }

    current.verified = true;
    return { phase, migrationConsumed: migrationConsumed as boolean, launchCount: launchCountValue };
  }

  async function verifyLiveProductionHealth(current: ReleaseDeployment) {
    if (!publicClient || typeof window === "undefined") {
      throw new Error("The live production health check is unavailable.");
    }
    const { registry, factory } = current.addresses;
    const factoryTransaction = current.transactions.factory;
    if (!registry || !factory || !factoryTransaction) {
      throw new Error("The fresh registry, V6 factory, and confirmed factory deployment receipt are required.");
    }

    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    let productionOrigin: string;
    try {
      if (!configuredAppUrl) throw new Error("missing");
      const configured = new URL(configuredAppUrl);
      if (configured.protocol !== "https:") throw new Error("not https");
      productionOrigin = configured.origin;
    } catch {
      throw new Error("NEXT_PUBLIC_APP_URL must be the exact public HTTPS production origin before reopening.");
    }
    const operatorOrigin = new URL(window.location.origin);
    const isLoopbackOperator = operatorOrigin.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(operatorOrigin.hostname);
    if (!isLoopbackOperator) {
      throw new Error("Final reopening is allowed only from the explicitly enabled loopback operator console.");
    }

    const factoryReceipt = await publicClient.getTransactionReceipt({ hash: factoryTransaction });
    if (
      factoryReceipt.status !== "success"
        || !factoryReceipt.contractAddress
        || factoryReceipt.contractAddress.toLowerCase() !== factory.toLowerCase()
    ) {
      throw new Error("The saved V6 factory deployment transaction did not create the recorded V6 factory.");
    }
    const response = await fetch(`${productionOrigin}/api/health`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(payload) || payload.ok !== true || !isRecord(payload.releaseEvidence)) {
      throw new Error("Live production /api/health is not healthy. Public launches remain paused.");
    }
    const evidence = payload.releaseEvidence;
    const checkedAt = typeof payload.checkedAt === "string" ? Date.parse(payload.checkedAt) : Number.NaN;
    const healthAge = Date.now() - checkedAt;
    const latestBlock = typeof payload.latestBlock === "string" && DECIMAL_PATTERN.test(payload.latestBlock)
      ? BigInt(payload.latestBlock)
      : -1n;
    const healthChecksOperational = Array.isArray(payload.checks)
      && payload.checks.length > 0
      && payload.checks.every((item) => isRecord(item) && item.state === "operational");
    if (
      payload.chainId !== robinhoodChain.id
        || payload.network !== "Robinhood Chain Mainnet"
        || !Number.isFinite(checkedAt) || healthAge < -30_000 || healthAge > 120_000
        || !healthChecksOperational
        || evidence.mode !== "v6-cutover"
        || evidence.registryConfiguredExplicitly !== true
        || evidence.registryConfigurationValid !== true
        || evidence.factoryStartBlockConfiguredExplicitly !== true
        || evidence.factoryStartBlockConfigurationValid !== true
        || typeof evidence.registryAddress !== "string"
        || evidence.registryAddress.toLowerCase() !== registry.toLowerCase()
        || typeof evidence.factoryAddress !== "string"
        || evidence.factoryAddress.toLowerCase() !== factory.toLowerCase()
        || typeof evidence.factoryVersion !== "string"
        || evidence.factoryVersion.toLowerCase() !== VERSION.toLowerCase()
        || evidence.factoryStartBlock !== factoryReceipt.blockNumber.toString()
        || latestBlock < factoryReceipt.blockNumber
    ) {
      throw new Error("Production health does not prove the exact fresh registry, active V6 factory/version, and V6 factory deployment block. Public launches remain paused.");
    }
  }

  async function validateFinalReopeningBoundary(current: ReleaseDeployment) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    await validateImportedRecovery(current);
    await verifySourcesLive(current);

    const { governance, registry, launchGate, policyRegistry, marketImplementation, adapter, factory } = current.addresses;
    if (!governance || !registry || !launchGate || !policyRegistry || !marketImplementation || !adapter || !factory) {
      throw new Error("The complete V6 foundation is required before reopening.");
    }
    const officialMigration = await publicClient.readContract({
      address: factory,
      abi: artifacts.rmtFactoryV6.abi,
      functionName: "officialIdentityMigration"
    }) as Address;
    const [
      registryFactory,
      registryVersion,
      registryPendingFactory,
      registryPendingVersion,
      registryPendingTime,
      gatePaused,
      unpauseTime,
      defaultPolicy,
      canonicalMarket,
      canonicalAdapter,
      fairPolicy,
      openPolicy,
      factoryOfficialLegacyToken,
      officialLauncher,
      authorizedFactory,
      migrationOfficialLegacyToken,
      migrationConsumed,
      latestBlock
    ] = await Promise.all([
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingFactory" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingVersion" }),
      publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "pendingActivationTime" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
      publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseExecutableAt" }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalMarketImplementation" }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalGraduationAdapter" }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "getPolicy", args: [FAIR_POLICY_ID] }),
      publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "getPolicy", args: [OPEN_POLICY_ID] }),
      publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialLegacyToken" }),
      publicClient.readContract({ address: officialMigration, abi: officialMigrationAbi, functionName: "officialLauncher" }),
      publicClient.readContract({ address: officialMigration, abi: officialMigrationAbi, functionName: "authorizedFactory" }),
      publicClient.readContract({ address: officialMigration, abi: officialMigrationAbi, functionName: "officialLegacyToken" }),
      publicClient.readContract({ address: officialMigration, abi: officialMigrationAbi, functionName: "consumed" }),
      publicClient.getBlock({ blockTag: "latest" })
    ]);
    const expected = policies(marketImplementation, adapter, governance);
    if (
      String(registryFactory).toLowerCase() !== factory.toLowerCase()
        || String(registryVersion).toLowerCase() !== VERSION.toLowerCase()
        || String(registryPendingFactory).toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        || String(registryPendingVersion).toLowerCase() !== ZERO_BYTES32.toLowerCase()
        || registryPendingTime !== 0n
        || gatePaused !== true || unpauseTime === 0n || latestBlock.timestamp < (unpauseTime as bigint)
        || String(defaultPolicy).toLowerCase() !== FAIR_POLICY_ID.toLowerCase()
        || String(canonicalMarket).toLowerCase() !== marketImplementation.toLowerCase()
        || String(canonicalAdapter).toLowerCase() !== adapter.toLowerCase()
        || !policyMatches(fairPolicy as LaunchPolicy, expected.fair)
        || !policyMatches(openPolicy as LaunchPolicy, expected.open)
        || String(factoryOfficialLegacyToken).toLowerCase() !== OFFICIAL_LEGACY_RMT_TOKEN.toLowerCase()
        || String(officialLauncher).toLowerCase() !== OPERATOR.toLowerCase()
        || String(authorizedFactory).toLowerCase() !== factory.toLowerCase()
        || String(migrationOfficialLegacyToken).toLowerCase() !== OFFICIAL_LEGACY_RMT_TOKEN.toLowerCase()
        || migrationConsumed !== true
    ) throw new Error("Final V6 reopening checks failed. Public launches remain paused.");
    await verifyLiveProductionHealth(current);
  }

  async function recoverProposalFromSavedTransaction(
    current: ReleaseDeployment,
    proposalKey: ProposalKey,
    transactionKey: string,
    target: Address,
    data: Hex
  ) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const governance = proposalGovernance(current, proposalKey);
    let savedHash = current.transactions[transactionKey];
    if (!savedHash) {
      const startBlock = await foundationStartBlock(current);
      if (startBlock === undefined) return undefined;
      const proposedLogs = parseEventLogs({
        abi: governance.artifact.abi,
        eventName: "Proposed",
        logs: await readContractLogs(governance.address, startBlock),
        strict: true
      }) as unknown as Array<{
        args: { id: bigint; target: Address; value: bigint; data: Hex; executeAfter?: bigint };
        transactionHash: Hex;
      }>;
      const matchingTransactions = proposedLogs.filter((log) =>
        log.args.target.toLowerCase() === target.toLowerCase()
          && log.args.value === 0n
          && log.args.data.toLowerCase() === data.toLowerCase()
      );
      if (matchingTransactions.length > 1) {
        throw new Error(`More than one onchain proposal matches the reviewed ${proposalKey} action.`);
      }
      if (matchingTransactions.length === 0) return undefined;
      savedHash = matchingTransactions[0].transactionHash;
      current.transactions[transactionKey] = savedHash;
      persist(current);
    }
    const receipt = await publicClient.getTransactionReceipt({ hash: savedHash });
    if (receipt.status !== "success") throw new Error("A saved governance proposal transaction did not succeed.");
    const proposedLogs = parseEventLogs({
      abi: governance.artifact.abi,
      eventName: "Proposed",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === governance.address.toLowerCase()),
      strict: true
    }) as unknown as Array<{
      args: { id: bigint; target: Address; value: bigint; data: Hex; executeAfter?: bigint }
    }>;
    const proposed = proposedLogs.find((log) =>
      log.args.target.toLowerCase() === target.toLowerCase()
        && log.args.value === 0n
        && log.args.data.toLowerCase() === data.toLowerCase()
    );
    if (!proposed) {
      throw new Error("A saved governance transaction does not contain the expected reviewed proposal. No duplicate was sent.");
    }
    const recoveredId = proposed.args.id.toString();
    if (current.proposalIds[proposalKey] && current.proposalIds[proposalKey] !== recoveredId) {
      throw new Error(`The saved ${proposalKey} proposal ID does not match its confirmed receipt.`);
    }
    current.proposalIds[proposalKey] = recoveredId;
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    if (proposalKey === "fairPolicy" || proposalKey === "openPolicy" || proposalKey === "factoryActivation") {
      const readyAt = proposed.args.executeAfter ?? block.timestamp + DAY;
      if (!current.readyAt.initialGovernance || readyAt > BigInt(current.readyAt.initialGovernance)) {
        current.readyAt.initialGovernance = readyAt.toString();
      }
    }
    return { receipt, blockTimestamp: block.timestamp };
  }

  async function recoverGovernanceExecution(
    current: ReleaseDeployment,
    proposalKey: ProposalKey,
    executionTransactionKey: string
  ) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const proposalId = current.proposalIds[proposalKey];
    const governance = proposalGovernance(current, proposalKey);
    const savedExecutionHash = current.transactions[executionTransactionKey];
    if (!proposalId) {
      if (savedExecutionHash) {
        throw new Error(`The recovery record contains ${executionTransactionKey} without its reviewed proposal.`);
      }
      return undefined;
    }

    const proposalHash = current.transactions[PROPOSAL_TRANSACTION_KEYS[proposalKey]];
    if (!proposalHash) throw new Error(`The ${proposalKey} proposal receipt is missing.`);
    const proposalReceipt = await publicClient.getTransactionReceipt({ hash: proposalHash });
    const expectedId = BigInt(proposalId);
    let executionHash = savedExecutionHash;

    if (!executionHash) {
      const governanceLogs = await readContractLogs(governance.address, proposalReceipt.blockNumber);
      const executedLogs = parseEventLogs({
        abi: governance.artifact.abi,
        eventName: "Executed",
        logs: governanceLogs,
        strict: true
      }) as unknown as Array<{ args: { id: bigint }; transactionHash: Hex }>;
      const matches = executedLogs.filter((log) => log.args.id === expectedId);
      if (matches.length > 1) throw new Error(`Governance proposal ${proposalId} has duplicate execution events.`);
      if (matches.length === 0) return undefined;
      executionHash = matches[0].transactionHash;
      current.transactions[executionTransactionKey] = executionHash;
    }

    const receipt = await publicClient.getTransactionReceipt({ hash: executionHash });
    if (receipt.status !== "success") throw new Error(`The ${executionTransactionKey} receipt did not succeed.`);
    const executedLogs = parseEventLogs({
      abi: governance.artifact.abi,
      eventName: "Executed",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === governance.address.toLowerCase()),
      strict: true
    }) as unknown as Array<{ args: { id: bigint } }>;
    if (executedLogs.filter((log) => log.args.id === expectedId).length !== 1) {
      throw new Error(`The ${executionTransactionKey} receipt does not execute reviewed proposal ${proposalId}.`);
    }
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { receipt, blockTimestamp: block.timestamp };
  }

  async function recoverReviewedEventTransaction(
    current: ReleaseDeployment,
    transactionKey: string,
    contractAddress: Address,
    abi: Abi,
    eventName: string,
    fromBlock: bigint,
    matchesExpected: (args: Record<string, unknown>) => boolean
  ) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const decodeMatches = (logs: readonly unknown[]) => {
      const parsed = parseEventLogs({ abi, logs: logs as never, strict: true }) as unknown as Array<{
        eventName: string;
        args: Record<string, unknown>;
        transactionHash: Hex;
      }>;
      return parsed.filter((log) => log.eventName === eventName && matchesExpected(log.args));
    };

    let transactionHash = current.transactions[transactionKey];
    if (!transactionHash) {
      const logs = await readContractLogs(contractAddress, fromBlock);
      const matches = decodeMatches(logs);
      if (matches.length > 1) throw new Error(`The reviewed ${eventName} transition occurred more than once.`);
      if (matches.length === 0) return undefined;
      transactionHash = matches[0].transactionHash;
      current.transactions[transactionKey] = transactionHash;
    }

    const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") throw new Error(`The ${transactionKey} receipt did not succeed.`);
    const matchingReceiptLogs = decodeMatches(
      receipt.logs.filter((log) => log.address.toLowerCase() === contractAddress.toLowerCase())
    );
    if (matchingReceiptLogs.length !== 1) {
      throw new Error(`The ${transactionKey} receipt does not prove the exact reviewed ${eventName} transition.`);
    }
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { receipt, blockTimestamp: block.timestamp };
  }

  async function proposeGovernance(
    current: ReleaseDeployment,
    proposalKey: ProposalKey,
    transactionKey: string,
    target: Address,
    data: Hex,
    label: string
  ) {
    if (current.proposalIds[proposalKey]) return;
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const governance = proposalGovernance(current, proposalKey);
    let recovered = await recoverProposalFromSavedTransaction(
      current, proposalKey, transactionKey, target, data
    );
    if (!recovered) {
      await sendCall(
        current, transactionKey, governance.address, governance.artifact, "propose", [target, 0n, data], label
      );
      recovered = await recoverProposalFromSavedTransaction(
        current, proposalKey, transactionKey, target, data
      );
    }
    if (!recovered) throw new Error("The confirmed governance proposal could not be recovered.");
    else if (current.transactions[transactionKey]) setStatus(`Confirmed: ${label}`);
    persist(current);
    await validateGovernanceProposalSet(current);
    return recovered.receipt;
  }

  async function validateGovernanceProposalSet(current: ReleaseDeployment) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const governance = current.addresses.governance;
    if (!governance) throw new Error("The V6 governance address is missing from the release record.");

    const v6ProposalKeys = PROPOSAL_KEYS;
    const v6ProposalIds = v6ProposalKeys
      .map((key) => current.proposalIds[key])
      .filter((id): id is string => id !== undefined)
      .map((id) => BigInt(id));
    const v6TransactionCount = await validateV6Governance(governance, BigInt(v6ProposalIds.length));
    const v6UniqueIds = new Set(v6ProposalIds.map((id) => id.toString()));
    if (v6UniqueIds.size !== v6ProposalIds.length) {
      throw new Error("V6 governance contains a duplicate reviewed proposal ID.");
    }
    for (let id = 0n; id < v6TransactionCount; id += 1n) {
      if (!v6UniqueIds.has(id.toString())) {
        throw new Error(`V6 governance proposal ${id} is not part of the reviewed release record.`);
      }
    }

    const latest = await publicClient.getBlock({ blockTag: "latest" });
    for (const proposalKey of v6ProposalKeys) {
      const proposalId = current.proposalIds[proposalKey];
      if (proposalId === undefined) continue;
      const transaction = await publicClient.readContract({
        address: governance,
        abi: artifacts.governanceV6.abi,
        functionName: "getTransaction",
        args: [BigInt(proposalId)]
      }) as unknown as {
        executeBefore: bigint;
        configurationEpoch: bigint;
        confirmations: bigint;
        executed: boolean;
        cancelled: boolean;
      };
      if (
        transaction.configurationEpoch !== 1n || transaction.confirmations < 1n || transaction.cancelled
          || (!transaction.executed && latest.timestamp > transaction.executeBefore)
      ) {
        throw new Error(`The reviewed ${proposalKey} V6 governance proposal is stale, cancelled, expired, or invalid.`);
      }
    }
  }

  async function validateImportedRecovery(current: ReleaseDeployment) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    const governance = current.addresses.governance;
    if (!governance) throw new Error("The recovery record's V6 governance address is missing.");
    if (!current.addresses.registry) throw new Error("The recovery record's fresh V6 registry address is missing.");
    await validateSavedDeploymentReceipts(current);
    await verifyLiveDependencies(current, current.addresses.factory);
    const hook = current.addresses.hook;
    if (!hook || !(await hasCode(hook))) throw new Error("The recovery record's V6 hook is missing onchain.");
    const [hookPoolManager, hookDeployer, hookAdapter] = await Promise.all([
      publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "poolManager" }),
      publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "deployer" }),
      publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "adapter" })
    ]);
    if (
      String(hookPoolManager).toLowerCase() !== POOL_MANAGER.toLowerCase()
        || String(hookDeployer).toLowerCase() !== OPERATOR.toLowerCase()
        || (BigInt(hook) & HOOK_MASK) !== HOOK_FLAGS
    ) throw new Error("The recovery record's hook does not match the reviewed V6 configuration.");

    let adapter = current.addresses.adapter;
    const onchainAdapter = hookAdapter as Address;
    if (onchainAdapter.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      if (adapter && adapter.toLowerCase() !== onchainAdapter.toLowerCase()) {
        throw new Error("The recovery record conflicts with the adapter permanently bound to the hook.");
      }
      adapter = onchainAdapter;
      current.addresses.adapter = adapter;
    }

    let boundFactory = ZERO_ADDRESS;
    if (adapter) boundFactory = await validateAdapterContract(adapter, hook);
    let factory = current.addresses.factory;
    if (boundFactory.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      if (factory && factory.toLowerCase() !== boundFactory.toLowerCase()) {
        throw new Error("The recovery record conflicts with the factory permanently bound to the adapter.");
      }
      factory = boundFactory;
      current.addresses.factory = factory;
    }
    if (factory) {
      const recovered = await validateAndRecoverFactory(
        factory, adapter, current.addresses.governance, releaseRegistry(current)
      );
      if (current.addresses.launchGate
        && current.addresses.launchGate.toLowerCase() !== recovered.launchGate.toLowerCase()) {
        throw new Error("The recovery record contains the wrong launch gate for its bound factory.");
      }
      if (current.addresses.policyRegistry
        && current.addresses.policyRegistry.toLowerCase() !== recovered.policyRegistry.toLowerCase()) {
        throw new Error("The recovery record contains the wrong policy registry for its bound factory.");
      }
      if (current.addresses.marketImplementation
        && current.addresses.marketImplementation.toLowerCase() !== recovered.marketImplementation.toLowerCase()) {
        throw new Error("The recovery record contains the wrong canonical market for its bound factory.");
      }
      current.addresses.launchGate = recovered.launchGate;
      current.addresses.governance = recovered.governance;
      current.addresses.policyRegistry = recovered.policyRegistry;
      current.addresses.marketImplementation = recovered.marketImplementation;
    }
    if (current.addresses.marketImplementation && !(await hasCode(current.addresses.marketImplementation))) {
      throw new Error("The recovery record's market implementation is missing onchain.");
    }

    const policyRegistry = current.addresses.policyRegistry;
    let marketImplementation = current.addresses.marketImplementation;
    const launchGate = current.addresses.launchGate;
    if (adapter && policyRegistry) {
      marketImplementation = await recoverCanonicalMarketImplementation(current, policyRegistry, adapter);
    }
    if (adapter && policyRegistry && marketImplementation) {
      const { fair, open } = policies(marketImplementation, adapter, governance);
      await recoverProposalFromSavedTransaction(
        current,
        "fairPolicy",
        "proposeFairPolicy",
        policyRegistry,
        encodeFunctionData({ abi: artifacts.policyRegistryV6.abi, functionName: "schedulePolicyRegistration", args: [fair] })
      );
      await recoverProposalFromSavedTransaction(
        current,
        "openPolicy",
        "proposeOpenPolicy",
        policyRegistry,
        encodeFunctionData({ abi: artifacts.policyRegistryV6.abi, functionName: "schedulePolicyRegistration", args: [open] })
      );
    } else if (current.transactions.proposeFairPolicy || current.transactions.proposeOpenPolicy) {
      throw new Error("The recovery record is missing contracts needed to verify its policy proposals.");
    }
    if (factory) {
      const registry = releaseRegistry(current);
      await recoverProposalFromSavedTransaction(
        current,
        "factoryActivation",
        "proposeFactoryActivation",
        registry,
        encodeFunctionData({ abi: artifacts.registry.abi, functionName: "proposeFactory", args: [factory, VERSION] })
      );
    } else if (current.transactions.proposeFactoryActivation) {
      throw new Error("The recovery record is missing the factory needed to verify its activation proposal.");
    }
    if (policyRegistry) {
      const recoveredDefault = await recoverProposalFromSavedTransaction(
        current,
        "defaultPolicy",
        "proposeDefaultPolicy",
        policyRegistry,
        encodeFunctionData({ abi: artifacts.policyRegistryV6.abi, functionName: "scheduleDefaultPolicy", args: [FAIR_POLICY_ID] })
      );
      if (recoveredDefault) current.readyAt.defaultGovernance = (recoveredDefault.blockTimestamp + DAY).toString();
    } else if (current.transactions.proposeDefaultPolicy) {
      throw new Error("The recovery record is missing the policy registry needed to verify its default proposal.");
    }
    if (launchGate) {
      const recoveredUnpause = await recoverProposalFromSavedTransaction(
        current,
        "unpause",
        "proposeUnpause",
        launchGate,
        encodeFunctionData({ abi: artifacts.launchGateV6.abi, functionName: "scheduleUnpause", args: [] })
      );
      if (recoveredUnpause) current.readyAt.unpauseGovernance = (recoveredUnpause.blockTimestamp + DAY).toString();
    } else if (current.transactions.proposeUnpause) {
      throw new Error("The recovery record is missing the launch gate needed to verify its reopening proposal.");
    }

    for (const key of PROPOSAL_KEYS) {
      if (current.proposalIds[key] && !current.transactions[PROPOSAL_TRANSACTION_KEYS[key]]) {
        throw new Error(`The recovery record cannot prove its ${key} proposal ID with an exact Proposed event receipt.`);
      }
    }

    const fairExecution = await recoverGovernanceExecution(
      current, "fairPolicy", "executeFairPolicySchedule"
    );
    const openExecution = await recoverGovernanceExecution(
      current, "openPolicy", "executeOpenPolicySchedule"
    );
    const factoryExecution = await recoverGovernanceExecution(
      current, "factoryActivation", "executeFactoryProposal"
    );
    if (fairExecution && openExecution && factoryExecution) {
      const latestPolicySchedule = fairExecution.blockTimestamp > openExecution.blockTimestamp
        ? fairExecution.blockTimestamp : openExecution.blockTimestamp;
      current.readyAt.policyRegistration = (latestPolicySchedule + DAY).toString();
    }
    const defaultExecution = await recoverGovernanceExecution(
      current, "defaultPolicy", "executeDefaultSchedule"
    );
    if (defaultExecution) current.readyAt.defaultPolicy = (defaultExecution.blockTimestamp + DAY).toString();
    const unpauseExecution = await recoverGovernanceExecution(
      current, "unpause", "executeUnpauseSchedule"
    );
    if (unpauseExecution) current.readyAt.unpause = (unpauseExecution.blockTimestamp + DAY).toString();

    const proposalBlock = async (key: ProposalKey) => {
      const hash = current.transactions[PROPOSAL_TRANSACTION_KEYS[key]];
      if (!hash) throw new Error(`The ${key} proposal receipt is required to recover its onchain transition.`);
      return (await publicClient.getTransactionReceipt({ hash })).blockNumber;
    };

    if (adapter && policyRegistry && marketImplementation) {
      const expected = policies(marketImplementation, adapter, governance);
      const [fairHash, openHash, currentDefaultPolicy] = await Promise.all([
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "policyHash", args: [FAIR_POLICY_ID] }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "policyHash", args: [OPEN_POLICY_ID] }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" })
      ]);
      const recoverPolicyRegistration = async (
        policyId: Hex,
        expectedPolicy: LaunchPolicy,
        hash: unknown,
        proposalKey: ProposalKey,
        transactionKey: string
      ) => {
        if (String(hash).toLowerCase() === ZERO_BYTES32.toLowerCase()) {
          if (current.transactions[transactionKey]) {
            throw new Error(`The recovery record claims ${transactionKey}, but the policy is not registered.`);
          }
          return;
        }
        const actual = await publicClient.readContract({
          address: policyRegistry,
          abi: artifacts.policyRegistryV6.abi,
          functionName: "getPolicy",
          args: [policyId]
        }) as LaunchPolicy;
        if (!policyMatches(actual, expectedPolicy)) {
          throw new Error("A registered V6 policy does not match the reviewed immutable policy.");
        }
        const recovered = await recoverReviewedEventTransaction(
          current,
          transactionKey,
          policyRegistry,
          artifacts.policyRegistryV6.abi,
          "PolicyRegistered",
          await proposalBlock(proposalKey),
          (args) => String(args.policyId).toLowerCase() === policyId.toLowerCase()
            && Number(args.policyVersion) === expectedPolicy.policyVersion
        );
        if (!recovered) throw new Error(`The registered policy lacks its exact ${transactionKey} event receipt.`);
      };
      await recoverPolicyRegistration(
        FAIR_POLICY_ID, expected.fair, fairHash, "fairPolicy", "registerFairPolicy"
      );
      await recoverPolicyRegistration(
        OPEN_POLICY_ID, expected.open, openHash, "openPolicy", "registerOpenPolicy"
      );

      const defaultPolicyValue = String(currentDefaultPolicy).toLowerCase();
      if (defaultPolicyValue === FAIR_POLICY_ID.toLowerCase()) {
        const recovered = await recoverReviewedEventTransaction(
          current,
          "executeDefaultPolicy",
          policyRegistry,
          artifacts.policyRegistryV6.abi,
          "DefaultPolicyChanged",
          await proposalBlock("defaultPolicy"),
          (args) => String(args.newPolicyId).toLowerCase() === FAIR_POLICY_ID.toLowerCase()
        );
        if (!recovered) throw new Error("The Fair default lacks its exact DefaultPolicyChanged receipt.");
      } else if (defaultPolicyValue === ZERO_BYTES32.toLowerCase()) {
        if (current.transactions.executeDefaultPolicy) {
          throw new Error("The recovery record claims the Fair default was finalized, but it is not set onchain.");
        }
      } else {
        throw new Error("The policy registry has an unexpected default policy.");
      }
    }

    if (factory) {
      const registry = releaseRegistry(current);
      const [registryFactory, registryVersion] = await Promise.all([
        publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeFactory" }),
        publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeVersion" })
      ]);
      const activeAddress = String(registryFactory).toLowerCase();
      const activeVersion = String(registryVersion).toLowerCase();
      if (activeAddress === factory.toLowerCase() && activeVersion === VERSION.toLowerCase()) {
        const recovered = await recoverReviewedEventTransaction(
          current,
          "activateFactory",
          registry,
          artifacts.registry.abi,
          "FactoryActivated",
          await proposalBlock("factoryActivation"),
          (args) => String(args.factory).toLowerCase() === factory.toLowerCase()
            && String(args.version).toLowerCase() === VERSION.toLowerCase()
        );
        if (!recovered) throw new Error("The active V6 factory lacks its exact activation receipt.");
      } else if (activeAddress === V5_FACTORY.toLowerCase() && activeVersion === V5_VERSION.toLowerCase()) {
        if (current.transactions.activateFactory) {
          throw new Error("The recovery record claims V6 activation, but V5 remains active onchain.");
        }
      } else {
        throw new Error("The version registry is active on an unexpected factory or version.");
      }
    }

    if (launchGate) {
      const gatePaused = await publicClient.readContract({
        address: launchGate,
        abi: artifacts.launchGateV6.abi,
        functionName: "launchesPaused"
      });
      if (gatePaused === false) {
        const recovered = await recoverReviewedEventTransaction(
          current,
          "executeUnpause",
          launchGate,
          artifacts.launchGateV6.abi,
          "LaunchesUnpaused",
          await proposalBlock("unpause"),
          () => true
        );
        if (!recovered) throw new Error("The open launch gate lacks its exact reviewed unpause receipt.");
      } else if (current.transactions.executeUnpause) {
        throw new Error("The recovery record claims public reopening, but the V6 launch gate is paused onchain.");
      }
    }

    // Every release proposal, including registry activation, is inspected through the one V6 governance getter
    // and must be current-epoch, uncancelled, and unexpired while pending. Every ID from zero through
    // transactionCount - 1 must be present in this exact recovery record.
    await validateGovernanceProposalSet(current);

    const receipts = await Promise.all(Object.values(current.transactions).map((hash) =>
      publicClient.getTransactionReceipt({ hash })
    ));
    if (receipts.some((receipt) => receipt.status !== "success")) {
      throw new Error("The recovery record contains a failed transaction.");
    }
    current.verified = true;
    // A recovery file proves transaction history, not current explorer verification.
    // Every governance boundary rechecks Blockscout live before it can continue.
    current.sourceVerified = false;
    delete current.sourceVerifiedAt;
    delete current.latestSourceEvidenceHash;
    return current;
  }

  function exportRecovery() {
    const record: RecoveryRecord = {
      schema: RECOVERY_SCHEMA,
      chainId: robinhoodChain.id,
      operator: OPERATOR,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      deployment
    };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rmt-v6-recovery-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1_000);
    setStatus("Recovery record exported — store it securely with the release evidence");
  }

  async function importRecovery(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setError(undefined);
    setStatus("Validating the recovery record against mainnet…");
    try {
      if (file.size > 1_000_000) throw new Error("The recovery file is unexpectedly large.");
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isRecord(parsed) || parsed.schema !== RECOVERY_SCHEMA || parsed.chainId !== robinhoodChain.id
        || typeof parsed.operator !== "string" || parsed.operator.toLowerCase() !== OPERATOR.toLowerCase()
        || typeof parsed.version !== "string" || parsed.version.toLowerCase() !== VERSION.toLowerCase()) {
        throw new Error("This is not a recovery record for the reviewed RMT V6 mainnet release.");
      }
      const recovered = parseRecoveryDeployment(parsed.deployment);
      await validateBootstrapRelease(recovered);
      recovered.sourceVerified = false;
      delete recovered.sourceVerifiedAt;
      persist(recovered);
      setStatus("Recovery record restored from onchain receipts — Blockscout sources must be checked live again");
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Recovery import rejected safely");
    } finally {
      setBusy(false);
    }
  }

  async function recoverCurrentRelease() {
    if (!publicClient || busy || !deployment.addresses.hook) return;
    setBusy(true);
    setError(undefined);
    setStatus("Recovering confirmed V6 progress from mainnet…");
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      await validateBootstrapRelease(current);
      current.sourceVerified = false;
      delete current.sourceVerifiedAt;
      persist(current);
      await refreshOnchain();
      setStatus("Confirmed V6 progress recovered — recheck all fifteen source records before continuing");
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Mainnet recovery stopped safely");
    } finally {
      setBusy(false);
    }
  }

  async function deployFoundation() {
    if (!address || !walletClient || !publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      if (!DEPLOYMENT_ARTIFACTS_READY) {
        throw new Error("The checked-in wallet artifact does not match the final V6 governance, fresh registry, and eight-argument factory. Regenerate it from a green final compile before signing anything.");
      }
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      for (const required of [
        V5_FACTORY,
        OFFICIAL_LEGACY_RMT_TOKEN,
        POOL_MANAGER,
        CREATE2_DEPLOYER
      ]) {
        if (!(await hasCode(required))) throw new Error(`Required contract is missing at ${required}.`);
      }
      setStatus("Verifying the legacy V5 identity anchor before creating the independent V6 foundation…");
      await verifyLiveDependencies();

      const governance = await deployContract(
        current,
        "governance",
        artifacts.governanceV6,
        [OPERATOR, DAY, GOVERNANCE_EXECUTION_WINDOW],
        "RMT V6 governance (24-hour delay, seven-day execution window)"
      );
      await validateV6Governance(governance, 0n);
      const bootstrapController = await deployContract(
        current,
        "bootstrapController",
        artifacts.bootstrapV6,
        [governance],
        "expiring one-time V6 bootstrap controller"
      );
      const [bootstrapStatusAfterDeploy, bootstrapAvailableAfterDeploy] = await Promise.all([
        publicClient.readContract({
          address: bootstrapController,
          abi: artifacts.bootstrapV6.abi,
          functionName: "state"
        }),
        publicClient.readContract({
          address: bootstrapController,
          abi: artifacts.bootstrapV6.abi,
          functionName: "bootstrapAvailable"
        })
      ]);
      if (Number(bootstrapStatusAfterDeploy) !== 0 || bootstrapAvailableAfterDeploy !== true) {
        throw new Error("This saved bootstrap controller is no longer unused and live. Stop before spending gas on the remaining foundation.");
      }
      await validateBootstrapVerifiers(bootstrapController);
      const registry = await deployContract(
        current,
        "registry",
        artifacts.registry,
        [governance, 2n * DAY, V5_FACTORY, V5_VERSION, bootstrapController],
        "fresh V6-governed version registry initialized to V5"
      );
      await verifyLiveDependencies(current);

      const hook = await deployHook(current);
      const recoveredBinding = await adoptBoundStack(current, hook);
      const adapter = recoveredBinding?.adapter
        ?? await deployContract(current, "adapter", artifacts.adapter, [POOL_MANAGER, hook, 5_000, 200], "0.5% V6 graduation adapter");
      const boundAdapter = await publicClient.readContract({
        address: hook,
        abi: artifacts.hook.abi,
        functionName: "adapter"
      }) as Address;
      if (boundAdapter.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
        await validateAdapterContract(adapter, hook);
        await sendCall(current, "bindHookAdapter", hook, artifacts.hook, "bindAdapter", [adapter], "bind V6 hook to adapter");
      } else if (boundAdapter.toLowerCase() !== adapter.toLowerCase()) throw new Error("Hook is bound to an unexpected adapter.");

      let nextFactory = recoveredBinding?.factory;
      let launchGate = current.addresses.launchGate;
      let policyRegistry = current.addresses.policyRegistry;
      let marketImplementation = current.addresses.marketImplementation;
      if (nextFactory) {
        const recovered = await validateAndRecoverFactory(
          nextFactory, adapter, current.addresses.governance, releaseRegistry(current)
        );
        if (marketImplementation
          && marketImplementation.toLowerCase() !== recovered.marketImplementation.toLowerCase()) {
          throw new Error("Saved recovery state conflicts with the bound registry's canonical market.");
        }
        launchGate = recovered.launchGate;
        policyRegistry = recovered.policyRegistry;
        marketImplementation = recovered.marketImplementation;
        current.addresses.factory = nextFactory;
        current.addresses.governance = recovered.governance;
        current.addresses.launchGate = launchGate;
        current.addresses.policyRegistry = policyRegistry;
        current.addresses.marketImplementation = recovered.marketImplementation;
        persist(current);
      } else {
        launchGate = await deployContract(
          current,
          "launchGate",
          artifacts.launchGateV6,
          [governance, OPERATOR, DAY, bootstrapController],
          "paused V6 launch gate"
        );
        marketImplementation = await deployContract(
          current, "marketImplementation", artifacts.marketV6, [], "V6 market implementation"
        );
        policyRegistry = await deployContract(
          current,
          "policyRegistry",
          artifacts.policyRegistryV6,
          [governance, OPERATOR, DAY, governance, marketImplementation, adapter],
          "component-locked V6 policy registry"
        );
      }
      if (!launchGate || !policyRegistry || !marketImplementation) {
        throw new Error("The V6 gate, policy registry, or canonical market implementation could not be recovered.");
      }
      marketImplementation = await recoverCanonicalMarketImplementation(current, policyRegistry, adapter);
      if (!marketImplementation) throw new Error("The V6 policy registry has no canonical market implementation.");
      if (!nextFactory) {
        nextFactory = await deployContract(
          current,
          "factory",
          artifacts.rmtFactoryV6,
          [
            launchGate,
            policyRegistry,
            registry,
            parseEther("0.3"),
            parseEther("1017500000"),
            V5_FACTORY,
            OFFICIAL_LEGACY_RMT_TOKEN,
            OPERATOR
          ],
          "policy-driven V6 factory"
        );
      }
      const boundFactory = await publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" }) as Address;
      if (boundFactory.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
        await sendCall(current, "bindAdapterFactory", adapter, artifacts.adapter, "bindFactory", [nextFactory], "bind V6 adapter to factory");
      } else if (boundFactory.toLowerCase() !== nextFactory.toLowerCase()) throw new Error("Adapter is bound to an unexpected factory.");
      const factoryDeploymentHash = current.transactions.factory;
      if (!factoryDeploymentHash) throw new Error("The V6 factory deployment receipt is missing.");
      const factoryDeploymentReceipt = await publicClient.getTransactionReceipt({ hash: factoryDeploymentHash });
      if (factoryDeploymentReceipt.status !== "success"
        || factoryDeploymentReceipt.contractAddress?.toLowerCase() !== nextFactory.toLowerCase()) {
        throw new Error("The V6 factory deployment receipt does not match the recorded factory.");
      }
      current.factoryStartBlock = factoryDeploymentReceipt.blockNumber.toString();
      persist(current);

      const [
        gateGovernance,
        gateGuardian,
        gatePaused,
        gateDelay,
        policyGovernance,
        policyGuardian,
        policyDelay,
        defaultPolicy,
        canonicalTreasury,
        canonicalMarket,
        canonicalAdapter,
        canonicalCurveFee,
        canonicalCreatorShare,
        canonicalProtocolShare,
        canonicalPostGraduationFee,
        canonicalGraduationTarget,
        protocolVersion,
        factoryGate,
        factoryPolicyRegistry,
        factoryVersionRegistry,
        factoryLegacy,
        factoryOfficialLegacyToken,
        creatorPayoutAuthority,
        officialMigrationPolicyId,
        virtualEthReserve,
        virtualTokenReserve,
        tokenImplementation,
        feeSplitterImplementation,
        officialMigration,
        adapterPoolManager,
        adapterHook,
        adapterDeployer,
        adapterFactory,
        adapterFee,
        adapterTickSpacing,
        hookPoolManager,
        hookDeployer
      ] = await Promise.all([
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "governance" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "guardian" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseDelay" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "governance" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "guardian" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "governanceDelay" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalProtocolTreasury" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalMarketImplementation" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "canonicalGraduationAdapter" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_CURVE_FEE_BPS" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_CREATOR_FEE_SHARE_BPS" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_PROTOCOL_FEE_SHARE_BPS" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_POST_GRADUATION_FEE_BPS" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "CANONICAL_GRADUATION_TARGET" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "protocolVersion" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "launchGate" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "policyRegistry" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "factoryRegistry" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "legacyIdentityFactory" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialLegacyToken" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "creatorPayoutAuthority" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "OFFICIAL_MIGRATION_POLICY_ID" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "initialVirtualEthReserve" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "initialVirtualTokenReserve" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "tokenImplementation" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "feeSplitterImplementation" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialIdentityMigration" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "poolManager" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "hook" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "deployer" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "poolFee" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "tickSpacing" }),
        publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "poolManager" }),
        publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "deployer" })
      ]);
      const migrationAddress = officialMigration as Address;
      const [officialLauncher, authorizedFactory, migrationOfficialLegacyToken, migrationConsumed] = await Promise.all([
        publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "officialLauncher" }),
        publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "authorizedFactory" }),
        publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "officialLegacyToken" }),
        publicClient.readContract({ address: migrationAddress, abi: officialMigrationAbi, functionName: "consumed" })
      ]);
      if (
        String(gateGovernance).toLowerCase() !== governance.toLowerCase()
        || String(gateGuardian).toLowerCase() !== OPERATOR.toLowerCase()
        || gatePaused !== true || gateDelay !== DAY
        || String(policyGovernance).toLowerCase() !== governance.toLowerCase()
        || String(policyGuardian).toLowerCase() !== OPERATOR.toLowerCase()
        || policyDelay !== DAY || String(defaultPolicy).toLowerCase() !== FAIR_POLICY_ID.toLowerCase()
        || String(canonicalTreasury).toLowerCase() !== governance.toLowerCase()
        || String(canonicalMarket).toLowerCase() !== marketImplementation.toLowerCase()
        || String(canonicalAdapter).toLowerCase() !== adapter.toLowerCase()
        || Number(canonicalCurveFee) !== 100 || Number(canonicalCreatorShare) !== 7_000
        || Number(canonicalProtocolShare) !== 3_000 || Number(canonicalPostGraduationFee) !== 50
        || canonicalGraduationTarget !== parseEther("2")
        || protocolVersion !== 6
        || String(factoryGate).toLowerCase() !== launchGate.toLowerCase()
        || String(factoryPolicyRegistry).toLowerCase() !== policyRegistry.toLowerCase()
        || String(factoryVersionRegistry).toLowerCase() !== registry.toLowerCase()
        || String(factoryLegacy).toLowerCase() !== V5_FACTORY.toLowerCase()
        || String(factoryOfficialLegacyToken).toLowerCase() !== OFFICIAL_LEGACY_RMT_TOKEN.toLowerCase()
        || String(creatorPayoutAuthority).toLowerCase() !== governance.toLowerCase()
        || String(officialMigrationPolicyId).toLowerCase() !== FAIR_POLICY_ID.toLowerCase()
        || virtualEthReserve !== parseEther("0.3") || virtualTokenReserve !== parseEther("1017500000")
        || !(await hasCode(tokenImplementation as Address)) || !(await hasCode(feeSplitterImplementation as Address))
        || String(adapterPoolManager).toLowerCase() !== POOL_MANAGER.toLowerCase()
        || String(adapterHook).toLowerCase() !== hook.toLowerCase()
        || String(adapterDeployer).toLowerCase() !== OPERATOR.toLowerCase()
        || String(adapterFactory).toLowerCase() !== nextFactory.toLowerCase()
        || adapterFee !== 5_000 || adapterTickSpacing !== 200
        || String(hookPoolManager).toLowerCase() !== POOL_MANAGER.toLowerCase()
        || String(hookDeployer).toLowerCase() !== OPERATOR.toLowerCase()
        || (BigInt(hook) & HOOK_MASK) !== HOOK_FLAGS
        || String(officialLauncher).toLowerCase() !== OPERATOR.toLowerCase()
        || String(authorizedFactory).toLowerCase() !== nextFactory.toLowerCase()
        || String(migrationOfficialLegacyToken).toLowerCase() !== OFFICIAL_LEGACY_RMT_TOKEN.toLowerCase()
        || migrationConsumed !== false
      ) throw new Error("V6 foundation verification failed. No activation transaction was submitted.");
      const [bootstrapGovernance, bootstrapOperator, bootstrapWindow, bootstrapStatus, bootstrapAvailable,
        registryBootstrap, registryBootstrapConsumed, gateBootstrap, gateBootstrapConsumed] = await Promise.all([
        publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "governance" }),
        publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "OPERATOR" }),
        publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "BOOTSTRAP_WINDOW" }),
        publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "state" }),
        publicClient.readContract({ address: bootstrapController, abi: artifacts.bootstrapV6.abi, functionName: "bootstrapAvailable" }),
        publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "bootstrapController" }),
        publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "bootstrapConsumed" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "bootstrapController" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "bootstrapConsumed" })
      ]);
      if (
        String(bootstrapGovernance).toLowerCase() !== governance.toLowerCase()
          || String(bootstrapOperator).toLowerCase() !== OPERATOR.toLowerCase()
          || bootstrapWindow !== 12n * 60n * 60n || Number(bootstrapStatus) !== 0 || bootstrapAvailable !== true
          || String(registryBootstrap).toLowerCase() !== bootstrapController.toLowerCase()
          || registryBootstrapConsumed !== false
          || String(gateBootstrap).toLowerCase() !== bootstrapController.toLowerCase()
          || gateBootstrapConsumed !== false
      ) throw new Error("The expiring V6 bootstrap controller is not in its exact unused foundation state.");
      await verifyLiveDependencies(current, nextFactory);
      current.verified = true;
      current.sourceVerified = false;
      delete current.sourceVerifiedAt;
      delete current.sourceEvidenceHash;
      delete current.latestSourceEvidenceHash;
      persist(current);
      setStatus("V6 foundation deployed, bound, and paused — verify all fifteen sources before activation");
      await refreshOnchain();
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Release paused safely");
    } finally {
      setBusy(false);
    }
  }

  async function verifySourcePhase() {
    if (!publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      setStatus("Revalidating the paused V6 foundation against mainnet…");
      await validateBootstrapRelease(current, "unbound");
      await verifySourcesLive(current);
      setStatus("All fifteen source records passed — the same-session activation is ready");
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Source-verification gate stopped safely");
    } finally {
      setBusy(false);
    }
  }

  async function activateBootstrapFoundation() {
    if (!publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      setStatus("Rechecking the pristine paused foundation and all source records before one-time activation…");
      await validateBootstrapRelease(current, "unbound");
      await verifySourcesLive(current);
      if (!current.latestSourceEvidenceHash) {
        throw new Error("The latest exact source-verification evidence is missing.");
      }
      current.sourceEvidenceHash = current.latestSourceEvidenceHash;
      const { bootstrapController, registry, launchGate, policyRegistry, factory } = current.addresses;
      if (!bootstrapController || !registry || !launchGate || !policyRegistry || !factory
        || !current.sourceEvidenceHash) {
        throw new Error("The source-verified V6 bootstrap record is incomplete.");
      }
      await sendCall(
        current,
        "bootstrapActivate",
        bootstrapController,
        artifacts.bootstrapV6,
        "activateVerifiedFoundation",
        [registry, launchGate, policyRegistry, factory, current.sourceEvidenceHash],
        "activate the exact source-verified V6 foundation"
      );
      await validateBootstrapRelease(current, "official-pending");
      delete current.productionVerifiedAt;
      persist(current);
      setStatus("V6 is active and still paused — update production routing, verify health, then launch official RMT");
      await refreshOnchain();
    } catch (cause) {
      setError(describeError(cause));
      setStatus("One-time V6 activation stopped safely");
    } finally {
      setBusy(false);
    }
  }

  async function verifyProductionCutover() {
    if (!publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      setStatus("Checking the live production site against the active paused V6 foundation…");
      await validateBootstrapRelease(current, "official-pending");
      await verifySourcesLive(current);
      await verifyLiveProductionHealth(current);
      current.productionVerifiedAt = new Date().toISOString();
      persist(current);
      setStatus("Production is routed to the exact paused V6 factory — launch official RMT next");
    } catch (cause) {
      delete current.productionVerifiedAt;
      persist(current);
      setError(describeError(cause));
      setStatus("Production cutover is not ready; public creation remains paused");
    } finally {
      setBusy(false);
    }
  }

  async function openAfterOfficialSmoke() {
    if (!publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      setStatus("Verifying the official RMT contract, fee-producing buy, sources, and live production health…");
      const bootstrap = await validateBootstrapRelease(current, "official-pending");
      if (!bootstrap.migrationConsumed || bootstrap.launchCount !== 1n) {
        throw new Error("The exact one-time official RMT V6 launch has not completed.");
      }
      await verifySourcesLive(current);
      await verifyLiveProductionHealth(current);
      const { bootstrapController, factory, governance } = current.addresses;
      if (!bootstrapController || !factory || !governance) throw new Error("The V6 bootstrap record is incomplete.");
      const launch = await publicClient.readContract({
        address: factory,
        abi: artifacts.rmtFactoryV6.abi,
        functionName: "getLaunch",
        args: [0n]
      }) as unknown as {
        token: Address;
        market: Address;
        rewardVault: Address;
        creator: Address;
        policyId: Hex;
        policyVersion: number;
        officialMigration: boolean;
      };
      const [totalReceived, totalPaid, operatorPending, governancePending, block] = await Promise.all([
        publicClient.readContract({ address: launch.rewardVault, abi: artifacts.feeSplitterV6.abi, functionName: "totalReceived" }),
        publicClient.readContract({ address: launch.rewardVault, abi: artifacts.feeSplitterV6.abi, functionName: "totalPaid" }),
        publicClient.readContract({ address: launch.rewardVault, abi: artifacts.feeSplitterV6.abi, functionName: "pending", args: [OPERATOR] }),
        publicClient.readContract({ address: launch.rewardVault, abi: artifacts.feeSplitterV6.abi, functionName: "pending", args: [governance] }),
        publicClient.getBlock({ blockTag: "latest" })
      ]);
      if (!launch.officialMigration || launch.creator.toLowerCase() !== OPERATOR.toLowerCase()
        || launch.policyId.toLowerCase() !== FAIR_POLICY_ID.toLowerCase() || Number(launch.policyVersion) !== 1
        || totalReceived === 0n || totalPaid !== totalReceived || operatorPending !== 0n || governancePending !== 0n) {
        throw new Error("Complete one small official RMT buy after Fair Start opens; its 70/30 fee split must settle before public creation can open.");
      }
      current.smokeEvidenceHash = keccak256(toHex(JSON.stringify({
        chainId: robinhoodChain.id,
        factory,
        token: launch.token,
        market: launch.market,
        splitter: launch.rewardVault,
        totalReceived: (totalReceived as bigint).toString(),
        blockNumber: block.number.toString()
      })));
      await sendCall(
        current,
        "bootstrapOpen",
        bootstrapController,
        artifacts.bootstrapV6,
        "openAfterOfficialSmoke",
        [current.smokeEvidenceHash],
        "permanently consume bootstrap and open V6 public creation"
      );
      await validateBootstrapRelease(current, "complete");
      persist(current);
      setStatus("V6 public token creation is open; every future reopening and upgrade uses permanent delays");
      await refreshOnchain();
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Final V6 opening stopped safely; public creation remains paused");
    } finally {
      setBusy(false);
    }
  }

  async function proposeInitialGovernance() {
    if (!address || !walletClient || !publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: ReleaseDeployment = {
      ...deployment,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions },
      proposalIds: { ...deployment.proposalIds },
      readyAt: { ...deployment.readyAt }
    };
    try {
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      setStatus("Revalidating bindings, paused state, and exact sources before any proposal…");
      await validateImportedRecovery(current);
      await verifyLiveDependencies(current, current.addresses.factory);

      const launchGate = current.addresses.launchGate;
      const policyRegistry = current.addresses.policyRegistry;
      const marketImplementation = current.addresses.marketImplementation;
      const adapter = current.addresses.adapter;
      const nextFactory = current.addresses.factory;
      if (!launchGate || !policyRegistry || !marketImplementation || !adapter || !nextFactory) {
        throw new Error("The complete V6 foundation is required before governance proposals.");
      }
      const officialMigration = await publicClient.readContract({
        address: nextFactory,
        abi: artifacts.rmtFactoryV6.abi,
        functionName: "officialIdentityMigration"
      }) as Address;
      const [gatePaused, unpauseTime, defaultPolicy, migrationConsumed] = await Promise.all([
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "unpauseExecutableAt" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" }),
        publicClient.readContract({ address: officialMigration, abi: officialMigrationAbi, functionName: "consumed" })
      ]);
      if (gatePaused !== true || unpauseTime !== 0n
        || String(defaultPolicy).toLowerCase() !== ZERO_BYTES32.toLowerCase() || migrationConsumed !== false) {
        throw new Error("The V6 foundation is no longer in the reviewed paused pre-proposal state.");
      }

      // This is intentionally a live explorer request at the proposal boundary. A saved
      // recovery flag is never sufficient to authorize an irreversible governance proposal.
      await verifySourcesLive(current);
      const governance = current.addresses.governance;
      if (!governance) throw new Error("The V6 governance address is missing from the release record.");
      const { fair, open } = policies(marketImplementation, adapter, governance);
      await proposeGovernance(
        current,
        "fairPolicy",
        "proposeFairPolicy",
        policyRegistry,
        encodeFunctionData({ abi: artifacts.policyRegistryV6.abi, functionName: "schedulePolicyRegistration", args: [fair] }),
        "propose Fair Start policy registration"
      );
      await proposeGovernance(
        current,
        "openPolicy",
        "proposeOpenPolicy",
        policyRegistry,
        encodeFunctionData({ abi: artifacts.policyRegistryV6.abi, functionName: "schedulePolicyRegistration", args: [open] }),
        "propose open policy registration"
      );
      await proposeGovernance(
        current,
        "factoryActivation",
        "proposeFactoryActivation",
        releaseRegistry(current),
        encodeFunctionData({ abi: artifacts.registry.abi, functionName: "proposeFactory", args: [nextFactory, VERSION] }),
        "propose delayed V6 registry activation"
      );
      setStatus("Three source-verified proposals submitted — first governance delay is running");
      await refreshOnchain();
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Governance proposal phase stopped safely");
    } finally {
      setBusy(false);
    }
  }

  async function executeInitialGovernance() {
    if (!publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Revalidating exact proposal receipts and V6 sources before execution…");
      await validateImportedRecovery(current);
      await verifySourcesLive(current);
      const steps: Array<[string, ProposalKey, string]> = [
        ["executeFairPolicySchedule", "fairPolicy", "execute Fair Start scheduling proposal"],
        ["executeOpenPolicySchedule", "openPolicy", "execute open-policy scheduling proposal"],
        ["executeFactoryProposal", "factoryActivation", "execute V6 registry proposal"]
      ];
      let latestTimestamp = 0n;
      for (const [txKey, proposalKey, label] of steps) {
        if (current.transactions[txKey]) continue;
        const id = current.proposalIds[proposalKey];
        if (!id) throw new Error("A required governance proposal is missing.");
        const governance = proposalGovernance(current, proposalKey);
        const receipt = await sendCall(
          current, txKey, governance.address, governance.artifact, "execute", [BigInt(id)], label
        );
        const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        if (block.timestamp > latestTimestamp) latestTimestamp = block.timestamp;
      }
      if (latestTimestamp !== 0n) current.readyAt.policyRegistration = (latestTimestamp + DAY).toString();
      persist(current);
      setStatus("Policies scheduled and V6 proposed — policy and registry delays are running");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function registerPoliciesAndProposeDefault() {
    const policyRegistry = deployment.addresses.policyRegistry;
    const marketImplementation = deployment.addresses.marketImplementation;
    const adapter = deployment.addresses.adapter;
    if (!publicClient || !policyRegistry || !marketImplementation || !adapter || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Revalidating the V6 release record and exact sources before policy registration…");
      await validateImportedRecovery(current);
      await verifySourcesLive(current);
      const governance = current.addresses.governance;
      if (!governance) throw new Error("The V6 governance address is missing from the release record.");
      const { fair, open } = policies(marketImplementation, adapter, governance);
      if (!current.transactions.registerFairPolicy) await sendCall(current, "registerFairPolicy", policyRegistry, artifacts.policyRegistryV6, "executePolicyRegistration", [fair], "register reviewed Fair Start policy");
      if (!current.transactions.registerOpenPolicy) await sendCall(current, "registerOpenPolicy", policyRegistry, artifacts.policyRegistryV6, "executePolicyRegistration", [open], "register reviewed open policy");
      if (!current.proposalIds.defaultPolicy) {
        await verifySourcesLive(current);
        const receipt = await proposeGovernance(
          current,
          "defaultPolicy",
          "proposeDefaultPolicy",
          policyRegistry,
          encodeFunctionData({ abi: artifacts.policyRegistryV6.abi, functionName: "scheduleDefaultPolicy", args: [FAIR_POLICY_ID] }),
          "propose Fair Start as the default policy"
        );
        const block = await publicClient.getBlock({ blockNumber: receipt?.blockNumber });
        current.readyAt.defaultGovernance = (block.timestamp + DAY).toString();
      }
      persist(current);
      setStatus("Both policies are immutable; default-policy governance delay is running");
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function executeDefaultSchedule() {
    if (!publicClient || !deployment.proposalIds.defaultPolicy || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Revalidating the exact default-policy proposal and V6 sources before execution…");
      await validateImportedRecovery(current);
      await verifySourcesLive(current);
      const proposalId = current.proposalIds.defaultPolicy;
      if (!proposalId) throw new Error("The exact default-policy proposal could not be recovered.");
      if (!current.transactions.executeDefaultSchedule) {
        const governance = proposalGovernance(current, "defaultPolicy");
        const receipt = await sendCall(current, "executeDefaultSchedule", governance.address, governance.artifact, "execute", [BigInt(proposalId)], "schedule Fair Start as default");
        const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        current.readyAt.defaultPolicy = (block.timestamp + DAY).toString();
      }
      persist(current);
      setStatus("Default policy scheduled — final policy delay is running");
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function finalizeV6() {
    const policyRegistry = deployment.addresses.policyRegistry;
    const nextFactory = deployment.addresses.factory;
    if (!publicClient || !policyRegistry || !nextFactory || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Revalidating the complete V6 release record and exact sources before activation…");
      await validateImportedRecovery(current);
      await verifySourcesLive(current);
      if (!current.transactions.executeDefaultPolicy) await sendCall(current, "executeDefaultPolicy", policyRegistry, artifacts.policyRegistryV6, "executeDefaultPolicy", [FAIR_POLICY_ID], "finalize Fair Start default");
      const defaultPolicy = await publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" }) as Hex;
      if (defaultPolicy !== FAIR_POLICY_ID) throw new Error("Default policy verification failed. V6 was not activated.");
      if (!current.transactions.activateFactory) {
        if (pendingFactory?.toLowerCase() !== nextFactory.toLowerCase()) throw new Error("The registry pending factory does not match this V6 deployment.");
        if (!pendingActivationTime || currentTime < pendingActivationTime) throw new Error("The registry activation delay is still running.");
        await sendCall(current, "activateFactory", releaseRegistry(current), artifacts.registry, "activateFactory", [], "activate verified V6 factory");
      }
      persist(current);
      setStatus("V6 is active and paused — launch and verify official RMT before proposing public reopening");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function proposeUnpause() {
    const launchGate = deployment.addresses.launchGate;
    if (!publicClient || !launchGate || busy || officialMigrationConsumed !== true) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Revalidating the active paused V6 foundation and exact sources before reopening governance…");
      await validateImportedRecovery(current);
      await verifySourcesLive(current);
      const factory = current.addresses.factory;
      if (!factory) throw new Error("The V6 factory is missing from the release record.");
      const registry = releaseRegistry(current);
      const [liveFactory, liveVersion, gatePaused, migrationAddress] = await Promise.all([
        publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeFactory" }),
        publicClient.readContract({ address: registry, abi: artifacts.registry.abi, functionName: "activeVersion" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
        publicClient.readContract({ address: factory, abi: artifacts.rmtFactoryV6.abi, functionName: "officialIdentityMigration" })
      ]);
      const migrationConsumed = await publicClient.readContract({
        address: migrationAddress as Address,
        abi: officialMigrationAbi,
        functionName: "consumed"
      });
      if (String(liveFactory).toLowerCase() !== factory.toLowerCase()
        || String(liveVersion).toLowerCase() !== VERSION.toLowerCase()
        || gatePaused !== true || migrationConsumed !== true) {
        throw new Error("V6 is not in the reviewed active, paused, post-official-launch state.");
      }
      if (!current.proposalIds.unpause) {
        const receipt = await proposeGovernance(
          current,
          "unpause",
          "proposeUnpause",
          launchGate,
          encodeFunctionData({ abi: artifacts.launchGateV6.abi, functionName: "scheduleUnpause", args: [] }),
          "propose public-launch reopening after the official RMT launch"
        );
        const block = await publicClient.getBlock({ blockNumber: receipt?.blockNumber });
        current.readyAt.unpauseGovernance = (block.timestamp + DAY).toString();
      }
      persist(current);
      setStatus("Official RMT is launched — reopening governance delay is running");
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function executeUnpauseSchedule() {
    if (!publicClient || !deployment.proposalIds.unpause || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Revalidating the exact reopening proposal and V6 sources before execution…");
      await validateImportedRecovery(current);
      await verifySourcesLive(current);
      const proposalId = current.proposalIds.unpause;
      if (!proposalId) throw new Error("The exact reopening proposal could not be recovered.");
      if (!current.transactions.executeUnpauseSchedule) {
        const governance = proposalGovernance(current, "unpause");
        const receipt = await sendCall(current, "executeUnpauseSchedule", governance.address, governance.artifact, "execute", [BigInt(proposalId)], "schedule launch reopening");
        const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        current.readyAt.unpause = (block.timestamp + DAY).toString();
      }
      persist(current);
      setStatus("Reopening scheduled — final safety delay is running");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function reopenLaunches() {
    const launchGate = deployment.addresses.launchGate;
    if (!launchGate || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      setStatus("Running final bindings, source, and live production health checks…");
      await validateFinalReopeningBoundary(current);
      await sendCall(current, "executeUnpause", launchGate, artifacts.launchGateV6, "executeUnpause", [], "reopen V6 public launches");
      setStatus("V6 public launches are open");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  const nextAction = useMemo(() => {
    if (!DEPLOYMENT_ARTIFACTS_READY) return "artifact";
    if (!deployment.verified) return "deploy";
    if (bootstrapState === undefined) return "reading";
    const bootstrapExpired = (bootstrapState === 0 || bootstrapState === 1)
      && bootstrapExpiresAt !== undefined && currentTime > bootstrapExpiresAt;
    if (bootstrapState === 3 || bootstrapExpired) return "aborted";
    if (bootstrapState === 0) return deployment.sourceVerified ? "bootstrap-activate" : "verify-sources";
    if (bootstrapState === 1) {
      if (!deployment.productionVerifiedAt) return "cutover";
      if (officialMigrationConsumed !== true) return "official";
      if (!officialSmokeFees || officialSmokeFees === 0n) return "smoke";
      return "bootstrap-open";
    }
    if (bootstrapState === 2) return "complete";
    return "reading";
  }, [deployment.verified, deployment.sourceVerified, deployment.productionVerifiedAt, bootstrapState,
    bootstrapExpiresAt, currentTime, officialMigrationConsumed, officialSmokeFees, isOpen]);

  const ready = (key: ReadyKey) => {
    const value = deployment.readyAt[key];
    return Boolean(value && currentTime >= BigInt(value));
  };

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${isOpen ? "complete" : error ? "failed" : "idle"}`}>
        <span className="status-dot" /><strong>{status}</strong>
      </div>
      <div className="deployment-rules">
        <p><strong>Economics:</strong> 1% curve fee and 0.5% post-graduation pool fee, both split 70% creator / 30% RMT; 2 ETH net graduation target. After graduation, the split applies only to genuine collected swap fees and may pay ETH or the launched token depending on trade direction—never initial supply or liquidity principal.</p>
        <p><strong>Official RMT fee recipients:</strong> RMTMain is the ordinary creator recipient and receives 70%. The separate V6 governance contract is the protocol treasury and receives 30%. The official launch is not a same-wallet 100% payout.</p>
        <p><strong>Creator payout:</strong> creators cannot propose, authorize, choose, or directly change the payout recipient. The RMT signer may propose only an evidence-linked redirect to the immutable V6 governance treasury or restoration to the original creator. After the 24-hour delay, any account may relay the exact approved governance call but cannot alter its destination or receive funds.</p>
        <p><strong>Fair Start:</strong> optional 1-block delay, 10-block window, 1% per buy and 3% per wallet. The reviewed Fair Start policy becomes the default.</p>
        <p><strong>Governance and treasury:</strong> one fresh V6 governance contract is both the protocol treasury and protocol authority. It starts with RMTMain as its sole signer, a 24-hour delay, a seven-day execution window, signer cancellation, proposal expiry, and atomic signer/threshold rotation. A future signer must prove control and give expiring consent to the exact add-or-replace action, affected signer, threshold, and current configuration epoch, and can revoke unconsumed consent before execution. Adding the first extra wallet creates 2-of-2 governance—not a backup wallet—so both signers must approve future proposals. The fresh version registry is governed by this same contract and starts on the legacy V5 factory/version; V6 has no authority or registry dependency on the legacy V5 stack.</p>
        <p><strong>Safety:</strong> activation and reopening remain separate. A narrow 12-hour genesis controller can activate only the exact pristine V6 topology and can open only after the official RMT launch records a real fee-producing buy with a fully settled 70/30 split. V6 remains paused through deployment, source verification, activation, production cutover, the official launch, and that smoke check. The controller then becomes permanently unusable; every later registry change and every later reopening uses the permanent delays.</p>
        <p><strong>Release evidence:</strong> the final action repeats exact source, onchain topology, receipt, and live production <code>/api/health</code> checks. V6 is still an explicitly disclosed unaudited mainnet beta; green automation and source verification do not replace an independent human audit.</p>
        <p><strong>Identity protection:</strong> the exact legacy RMT token at {OFFICIAL_LEGACY_RMT_TOKEN} is permanently bound to the one-time RMTMain migration. Inside the active, origin-verified V6 launch pipeline, prior V4/V5 names and tickers remain reserved and new identities are normalized against case and separator variations. Unrelated external contracts cannot be globally prevented from copying text, so the terminal labels origin instead of implying chain-wide exclusivity.</p>
        <p><strong>New token—not a holder migration:</strong> the official V6 action creates a new token contract with a new address and new fixed supply of 1,000,000,000 tokens. It does not copy, swap, credit, or migrate any old V5 holder balance. The old contract above is used only as the exact identity/provenance anchor. Do not sign unless this is understood and publicly disclosed.</p>
      </div>
      <div className="deployment-addresses">
        <p><span>Connected wallet</span><code>{address ? short(address) : "Not connected"}</code></p>
        {balance !== undefined && <p><span>Mainnet ETH balance</span><code>{formatEther(balance)} ETH</code></p>}
        <p><span>Active factory</span><code>{activeFactory ? short(activeFactory) : "Reading…"}</code></p>
        {factory && <p><span>This V6 factory</span><code>{short(factory)}</code></p>}
        {deployment.addresses.governance && <p><span>V6 governance + treasury</span><code>{short(deployment.addresses.governance)}</code></p>}
        {deployment.addresses.bootstrapController && <p><span>Expiring genesis controller</span><code>{short(deployment.addresses.bootstrapController)}</code></p>}
        {deployment.addresses.registry && <p><span>Fresh V6 registry</span><code>{short(deployment.addresses.registry)}</code></p>}
        {deployment.factoryStartBlock && <p><span>V6 factory start block</span><code>{deployment.factoryStartBlock}</code></p>}
        <p><span>Pending factory</span><code>{pendingFactory && pendingFactory !== ZERO_ADDRESS ? short(pendingFactory) : "None"}</code></p>
        <p><span>Registry activation</span><code>{timeLabel(pendingActivationTime)}</code></p>
        <p><span>Launch gate</span><code>{isOpen ? "Open" : "Paused"}</code></p>
        <p><span>One-time bootstrap</span><code>{bootstrapState === 0 ? "Unused" : bootstrapState === 1 ? "Official RMT + smoke pending" : bootstrapState === 2 ? "Permanently complete" : bootstrapState === 3 ? "Aborted" : "Reading…"}</code></p>
        <p><span>Bootstrap expiry</span><code>{timeLabel(bootstrapExpiresAt)}</code></p>
      <p><span>V6 + critical dependency sources</span><code>{deployment.sourceVerified ? `Verified ${deployment.sourceVerifiedAt ? new Date(deployment.sourceVerifiedAt).toLocaleString() : "live"}` : deployment.verified ? "Required before activation" : "Waiting for deployment"}</code></p>
        <p><span>Official RMT V6 migration</span><code>{officialMigrationConsumed === true ? "Launched" : isActive ? "Required before reopening" : "Available after activation"}</code></p>
        {officialToken && <p><span>Official RMT V6 token</span><code>{short(officialToken)}</code></p>}
        {officialSmokeFees !== undefined && <p><span>Confirmed official curve fees</span><code>{formatEther(officialSmokeFees)} ETH</code></p>}
        <p><span>Gate reopening</span><code>{timeLabel(onchainUnpauseTime || deployment.readyAt.unpause)}</code></p>
      </div>
      {isConnected && !isOperator && <p className="deployment-error">Wrong wallet connected. Use RMTMain: {OPERATOR}</p>}
      {error && <p className="deployment-error">{error}</p>}

      {nextAction === "artifact" && <p className="deployment-error">Deployment is intentionally disabled until CI regenerates the exact V6 bootstrap, gate, registry, policy, and factory wallet bytecode from one green compile.</p>}
      {nextAction === "deploy" && <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={deployFoundation}>{busy ? status : "Deploy paused V6 foundation + expiring bootstrap"}</button>}
      {nextAction === "verify-sources" && <p className="deployment-safety">First run and archive <code>packages/contracts/scripts/verify-mainnet-v6.sh</code> using the private V6 release runbook. It submits exact source-verification requests to Blockscout but never signs a blockchain transaction. Then use the live check below. The 12-hour bootstrap window begins when its controller is deployed.</p>}
      {nextAction === "verify-sources" && <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={verifySourcePhase}>{busy ? status : "Check all fifteen sources on Blockscout"}</button>}
      {nextAction === "bootstrap-activate" && <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={activateBootstrapFoundation}>{busy ? status : "Activate verified V6 while launches stay paused"}</button>}
      {nextAction === "cutover" && <div className="deployment-safety"><p>Update production and redeploy it with these public values before launching RMT:</p><p><code>NEXT_PUBLIC_VERSION_REGISTRY_ADDRESS={deployment.addresses.registry}</code><br /><code>NEXT_PUBLIC_FACTORY_START_BLOCK={deployment.factoryStartBlock ?? "read confirmed factory receipt"}</code></p></div>}
      {nextAction === "cutover" && <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={verifyProductionCutover}>{busy ? status : "Verify live V6 production cutover"}</button>}
      {nextAction === "official" && <a className="deploy-stack-button" href="/launch?official=v6">Open the prefilled official RMT launch →</a>}
      {nextAction === "smoke" && officialToken && <p className="deployment-safety">RMT launched at <code>{officialToken}</code>. Wait one block for Fair Start, make one small buy on its token page, and return here. The controller requires a real fully settled curve fee; sending ETH directly cannot satisfy it.</p>}
      {nextAction === "smoke" && officialToken && <a className="deploy-stack-button" href={`/project/${officialToken}?launch=0`}>Open official RMT and make the smoke buy →</a>}
      {nextAction === "bootstrap-open" && <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={openAfterOfficialSmoke}>{busy ? status : "Recheck everything and open public token creation"}</button>}
      {nextAction === "reading" && <p className="deployment-safety">Reading the exact V6 bootstrap state from mainnet…</p>}
      {nextAction === "aborted" && <p className="deployment-error">The expedited bootstrap is permanently aborted or expired. Public launches remain paused; only the normal delayed governance path can continue this deployment.</p>}
      {nextAction === "complete" && <a className="deploy-stack-button" href="/launch">V6 public creation is open →</a>}
      <div className="deployment-recovery">
        <div>
          <strong>Release recovery</strong>
          <span>Export after every phase. The file contains addresses and confirmed transaction records, never wallet secrets.</span>
        </div>
        <div className="deployment-recovery-actions">
          <button type="button" disabled={busy || !deployment.addresses.hook} onClick={recoverCurrentRelease}>Recover mainnet progress</button>
          <button type="button" disabled={busy || !hasRecoveryProgress} onClick={exportRecovery}>Export record</button>
          <label className={busy ? "disabled" : undefined}>
            Import record
            <input type="file" accept="application/json,.json" disabled={busy} onChange={importRecovery} />
          </label>
        </div>
      </div>
      <p className="deployment-safety">Every transaction is shown in your wallet. Never enter a private key or recovery phrase. Stop immediately if any address or amount differs.</p>
    </section>
  );
}
