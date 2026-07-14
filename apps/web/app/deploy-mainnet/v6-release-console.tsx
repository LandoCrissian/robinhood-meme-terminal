"use client";

import { robinhoodChain } from "@rmt/shared/chains";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  concat,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getCreate2Address,
  keccak256,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import artifactsJson from "../../lib/generated/mainnet-stack.json";

const OPERATOR = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA" as Address;
const GOVERNANCE = "0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953" as Address;
const V5_FACTORY = "0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD" as Address;
const REGISTRY = "0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1" as Address;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const STORAGE_KEY = "rmt:v6-release:policy-driven";
const VERSION = keccak256(toHex("RMT_FACTORY_V6"));
const FAIR_POLICY_ID = keccak256(toHex("RMT_SIMPLE_FAIR_V1"));
const OPEN_POLICY_ID = keccak256(toHex("RMT_SIMPLE_OPEN_V1"));
const DAY = 86_400n;
const HOOK_FLAGS = 0x2880n;
const HOOK_MASK = 0x3fffn;

type Artifact = { abi: Abi; bytecode: Hex };
type ArtifactName =
  | "hook"
  | "adapter"
  | "governance"
  | "registry"
  | "launchGateV6"
  | "policyRegistryV6"
  | "rmtFactoryV6"
  | "marketV6";
type AddressKey = "hook" | "adapter" | "launchGate" | "policyRegistry" | "marketImplementation" | "factory";
type ProposalKey = "fairPolicy" | "openPolicy" | "factoryActivation" | "defaultPolicy" | "unpause";
type ReadyKey = "initialGovernance" | "policyRegistration" | "defaultGovernance" | "defaultPolicy" | "unpauseGovernance" | "unpause";
type ReleaseDeployment = {
  addresses: Partial<Record<AddressKey, Address>>;
  transactions: Record<string, Hex>;
  proposalIds: Partial<Record<ProposalKey, string>>;
  readyAt: Partial<Record<ReadyKey, string>>;
  hookSalt?: Hex;
  verified?: boolean;
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
const EMPTY: ReleaseDeployment = { addresses: {}, transactions: {}, proposalIds: {}, readyAt: {} };

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
  const [balance, setBalance] = useState<bigint>();
  const [status, setStatus] = useState("Ready to deploy the reviewed V6 foundation");
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
  );
  const policiesRegistered = Boolean(
    deployment.transactions.registerFairPolicy && deployment.transactions.registerOpenPolicy
  );
  const defaultProposed = Boolean(deployment.proposalIds.defaultPolicy);
  const defaultScheduled = Boolean(deployment.transactions.executeDefaultSchedule);
  const defaultSet = Boolean(deployment.transactions.executeDefaultPolicy);
  const unpauseProposed = Boolean(deployment.proposalIds.unpause);
  const unpauseScheduled = Boolean(deployment.transactions.executeUnpauseSchedule);
  const isOpen = Boolean(isActive && !launchesPaused);

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
    const [active, pending, activation] = await Promise.all([
      publicClient.readContract({ address: REGISTRY, abi: artifacts.registry.abi, functionName: "activeFactory" }),
      publicClient.readContract({ address: REGISTRY, abi: artifacts.registry.abi, functionName: "pendingFactory" }),
      publicClient.readContract({ address: REGISTRY, abi: artifacts.registry.abi, functionName: "pendingActivationTime" })
    ]);
    setActiveFactory(active as Address);
    setPendingFactory(pending as Address);
    setPendingActivationTime(activation as bigint);
    const gate = deployment.addresses.launchGate;
    if (gate && await hasCode(gate)) {
      const [paused, unpauseTime] = await Promise.all([
        publicClient.readContract({ address: gate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
        publicClient.readContract({ address: gate, abi: artifacts.launchGateV6.abi, functionName: "unpauseExecutableAt" })
      ]);
      setLaunchesPaused(paused as boolean);
      setOnchainUnpauseTime(unpauseTime as bigint);
    }
    if (address) setBalance(await publicClient.getBalance({ address }));
  }

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setDeployment(JSON.parse(raw) as ReleaseDeployment); }
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
  }, [publicClient, address, deployment.addresses.launchGate]);

  async function hasCode(value?: Address) {
    if (!value || !publicClient) return false;
    const code = await publicClient.getBytecode({ address: value });
    return Boolean(code && code !== "0x");
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
    setStatus(`Approve: ${label}`);
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const hash = await walletClient.sendTransaction({ account: address, chain: robinhoodChain, data, gas: await gasFor(data) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${label} deployment failed.`);
    current.addresses[key] = receipt.contractAddress;
    current.transactions[key] = hash;
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
    setStatus(`Approve: ${label}`);
    const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
    const hash = await walletClient.sendTransaction({ account: address, chain: robinhoodChain, to, data, gas: await gasFor(data, to) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} failed.`);
    current.transactions[key] = hash;
    persist(current);
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
    if (!salt || !expected || (BigInt(expected) & HOOK_MASK) !== HOOK_FLAGS) {
      for (let nonce = 0n; nonce < 1_000_000n; nonce += 1n) {
        const candidateSalt = toHex(nonce, { size: 32 });
        const candidate = getCreate2Address({ from: CREATE2_DEPLOYER, salt: candidateSalt, bytecode: initCode });
        if ((BigInt(candidate) & HOOK_MASK) === HOOK_FLAGS) {
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
      const data = concat([salt, initCode]);
      setStatus("Approve: V6 graduation hook");
      const hash = await walletClient.sendTransaction({ account: address, chain: robinhoodChain, to: CREATE2_DEPLOYER, data, gas: await gasFor(data, CREATE2_DEPLOYER, 8_000_000n) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("V6 hook deployment failed.");
      current.transactions.hook = hash;
    }
    current.addresses.hook = expected;
    persist(current);
    return expected;
  }

  function policies(marketImplementation: Address, adapter: Address) {
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
      protocolTreasury: OPERATOR,
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
    const proposalId = await publicClient.readContract({ address: GOVERNANCE, abi: artifacts.governance.abi, functionName: "transactionCount" }) as bigint;
    const receipt = await sendCall(current, transactionKey, GOVERNANCE, artifacts.governance, "propose", [target, 0n, data], label);
    current.proposalIds[proposalKey] = proposalId.toString();
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const readyAt = block.timestamp + DAY;
    if (!current.readyAt.initialGovernance || readyAt > BigInt(current.readyAt.initialGovernance)) {
      current.readyAt.initialGovernance = readyAt.toString();
    }
    persist(current);
    return receipt;
  }

  async function deployAndPropose() {
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
      if (activeFactory?.toLowerCase() !== V5_FACTORY.toLowerCase()) throw new Error("V5 must remain active while V6 is prepared.");
      for (const required of [GOVERNANCE, V5_FACTORY, REGISTRY, POOL_MANAGER, CREATE2_DEPLOYER]) {
        if (!(await hasCode(required))) throw new Error(`Required contract is missing at ${required}.`);
      }

      const hook = await deployHook(current);
      const adapter = await deployContract(current, "adapter", artifacts.adapter, [POOL_MANAGER, hook, 5_000, 200], "0.5% V6 graduation adapter");
      const boundAdapter = await publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "adapter" }) as Address;
      if (boundAdapter === ZERO_ADDRESS) {
        await sendCall(current, "bindHookAdapter", hook, artifacts.hook, "bindAdapter", [adapter], "bind V6 hook to adapter");
      } else if (boundAdapter.toLowerCase() !== adapter.toLowerCase()) throw new Error("Hook is bound to an unexpected adapter.");

      const launchGate = await deployContract(current, "launchGate", artifacts.launchGateV6, [GOVERNANCE, OPERATOR, DAY], "paused V6 launch gate");
      const policyRegistry = await deployContract(current, "policyRegistry", artifacts.policyRegistryV6, [GOVERNANCE, OPERATOR, DAY], "V6 policy registry");
      const marketImplementation = await deployContract(current, "marketImplementation", artifacts.marketV6, [], "V6 market implementation");
      const nextFactory = await deployContract(
        current,
        "factory",
        artifacts.rmtFactoryV6,
        [launchGate, policyRegistry, parseEther("0.3"), parseEther("1017500000"), V5_FACTORY, OPERATOR],
        "policy-driven V6 factory"
      );
      const boundFactory = await publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" }) as Address;
      if (boundFactory === ZERO_ADDRESS) {
        await sendCall(current, "bindAdapterFactory", adapter, artifacts.adapter, "bindFactory", [nextFactory], "bind V6 adapter to factory");
      } else if (boundFactory.toLowerCase() !== nextFactory.toLowerCase()) throw new Error("Adapter is bound to an unexpected factory.");

      const checks = await Promise.all([
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "governance" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "guardian" }),
        publicClient.readContract({ address: launchGate, abi: artifacts.launchGateV6.abi, functionName: "launchesPaused" }),
        publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "governance" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "protocolVersion" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "launchGate" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "policyRegistry" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.rmtFactoryV6.abi, functionName: "legacyIdentityFactory" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "poolFee" })
      ]);
      if (
        String(checks[0]).toLowerCase() !== GOVERNANCE.toLowerCase()
        || String(checks[1]).toLowerCase() !== OPERATOR.toLowerCase()
        || checks[2] !== true
        || String(checks[3]).toLowerCase() !== GOVERNANCE.toLowerCase()
        || checks[4] !== 6
        || String(checks[5]).toLowerCase() !== launchGate.toLowerCase()
        || String(checks[6]).toLowerCase() !== policyRegistry.toLowerCase()
        || String(checks[7]).toLowerCase() !== V5_FACTORY.toLowerCase()
        || checks[8] !== 5_000
      ) throw new Error("V6 foundation verification failed. No governance proposals were submitted.");
      current.verified = true;
      persist(current);

      const { fair, open } = policies(marketImplementation, adapter);
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
        REGISTRY,
        encodeFunctionData({ abi: artifacts.registry.abi, functionName: "proposeFactory", args: [nextFactory, VERSION] }),
        "propose delayed V6 registry activation"
      );
      setStatus("V6 verified and proposals submitted — first governance delay is running");
      await refreshOnchain();
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Release paused safely");
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
        const receipt = await sendCall(current, txKey, GOVERNANCE, artifacts.governance, "execute", [BigInt(id)], label);
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
      const { fair, open } = policies(marketImplementation, adapter);
      if (!current.transactions.registerFairPolicy) await sendCall(current, "registerFairPolicy", policyRegistry, artifacts.policyRegistryV6, "executePolicyRegistration", [fair], "register reviewed Fair Start policy");
      if (!current.transactions.registerOpenPolicy) await sendCall(current, "registerOpenPolicy", policyRegistry, artifacts.policyRegistryV6, "executePolicyRegistration", [open], "register reviewed open policy");
      if (!current.proposalIds.defaultPolicy) {
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
      const receipt = await sendCall(current, "executeDefaultSchedule", GOVERNANCE, artifacts.governance, "execute", [BigInt(deployment.proposalIds.defaultPolicy)], "schedule Fair Start as default");
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      current.readyAt.defaultPolicy = (block.timestamp + DAY).toString();
      persist(current);
      setStatus("Default policy scheduled — final policy delay is running");
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function finalizeV6() {
    const policyRegistry = deployment.addresses.policyRegistry;
    const nextFactory = deployment.addresses.factory;
    const launchGate = deployment.addresses.launchGate;
    if (!publicClient || !policyRegistry || !nextFactory || !launchGate || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      if (!current.transactions.executeDefaultPolicy) await sendCall(current, "executeDefaultPolicy", policyRegistry, artifacts.policyRegistryV6, "executeDefaultPolicy", [FAIR_POLICY_ID], "finalize Fair Start default");
      const defaultPolicy = await publicClient.readContract({ address: policyRegistry, abi: artifacts.policyRegistryV6.abi, functionName: "defaultPolicyId" }) as Hex;
      if (defaultPolicy !== FAIR_POLICY_ID) throw new Error("Default policy verification failed. V6 was not activated.");
      if (!current.transactions.activateFactory) {
        if (pendingFactory?.toLowerCase() !== nextFactory.toLowerCase()) throw new Error("The registry pending factory does not match this V6 deployment.");
        if (!pendingActivationTime || currentTime < pendingActivationTime) throw new Error("The registry activation delay is still running.");
        await sendCall(current, "activateFactory", REGISTRY, artifacts.registry, "activateFactory", [], "activate verified V6 factory");
      }
      if (!current.proposalIds.unpause) {
        const receipt = await proposeGovernance(
          current,
          "unpause",
          "proposeUnpause",
          launchGate,
          encodeFunctionData({ abi: artifacts.launchGateV6.abi, functionName: "scheduleUnpause", args: [] }),
          "propose public-launch reopening"
        );
        const block = await publicClient.getBlock({ blockNumber: receipt?.blockNumber });
        current.readyAt.unpauseGovernance = (block.timestamp + DAY).toString();
      }
      persist(current);
      setStatus("V6 is active but paused — reopening still requires two delayed steps");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function executeUnpauseSchedule() {
    if (!publicClient || !deployment.proposalIds.unpause || busy) return;
    setBusy(true);
    setError(undefined);
    const current = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions }, proposalIds: { ...deployment.proposalIds }, readyAt: { ...deployment.readyAt } };
    try {
      const receipt = await sendCall(current, "executeUnpauseSchedule", GOVERNANCE, artifacts.governance, "execute", [BigInt(deployment.proposalIds.unpause)], "schedule launch reopening");
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      current.readyAt.unpause = (block.timestamp + DAY).toString();
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
    try {
      await sendCall(deployment, "executeUnpause", launchGate, artifacts.launchGateV6, "executeUnpause", [], "reopen V6 public launches");
      setStatus("V6 public launches are open");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  const nextAction = useMemo(() => {
    if (!initialProposed) return "deploy";
    if (!initialExecuted) return "initial-governance";
    if (!policiesRegistered || !defaultProposed) return "register-policies";
    if (!defaultScheduled) return "default-governance";
    if (!defaultSet || !isActive || !unpauseProposed) return "finalize";
    if (!unpauseScheduled) return "unpause-governance";
    if (!isOpen) return "unpause";
    return "complete";
  }, [initialProposed, initialExecuted, policiesRegistered, defaultProposed, defaultScheduled, defaultSet, isActive, unpauseProposed, unpauseScheduled, isOpen]);

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
        <p><strong>Economics:</strong> 1% curve fee, split 70% creator / 30% protocol; 0.5% after graduation; 2 ETH graduation target.</p>
        <p><strong>Fair Start:</strong> optional 1-block delay, 10-block window, 1% per buy and 3% per wallet. The reviewed Fair Start policy becomes the default.</p>
        <p><strong>Governance:</strong> the existing expandable 1-of-1 contract is controlled by RMTMain today and can add a signer only through a delayed proposal.</p>
        <p><strong>Safety:</strong> activation and reopening are separate. The new factory remains paused through deployment, policy registration, and registry activation.</p>
        <p><strong>Vamping:</strong> V4/V5 names and tickers remain reserved, with a one-time official RMT identity migration for RMTMain.</p>
      </div>
      <div className="deployment-addresses">
        <p><span>Connected wallet</span><code>{address ? short(address) : "Not connected"}</code></p>
        {balance !== undefined && <p><span>Mainnet ETH balance</span><code>{formatEther(balance)} ETH</code></p>}
        <p><span>Active factory</span><code>{activeFactory ? short(activeFactory) : "Reading…"}</code></p>
        {factory && <p><span>This V6 factory</span><code>{short(factory)}</code></p>}
        <p><span>Pending factory</span><code>{pendingFactory && pendingFactory !== ZERO_ADDRESS ? short(pendingFactory) : "None"}</code></p>
        <p><span>Registry activation</span><code>{timeLabel(pendingActivationTime)}</code></p>
        <p><span>Launch gate</span><code>{isOpen ? "Open" : "Paused"}</code></p>
        <p><span>Gate reopening</span><code>{timeLabel(onchainUnpauseTime || deployment.readyAt.unpause)}</code></p>
      </div>
      {isConnected && !isOperator && <p className="deployment-error">Wrong wallet connected. Use RMTMain: {OPERATOR}</p>}
      {error && <p className="deployment-error">{error}</p>}

      {nextAction === "deploy" && <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={deployAndPropose}>{busy ? status : deployment.verified ? "Resume V6 proposals" : "Deploy paused V6 foundation"}</button>}
      {nextAction === "initial-governance" && <button className="deploy-stack-button" disabled={!isOperator || busy || !ready("initialGovernance")} onClick={executeInitialGovernance}>{ready("initialGovernance") ? "Execute three reviewed governance proposals" : `Locked until ${timeLabel(deployment.readyAt.initialGovernance)}`}</button>}
      {nextAction === "register-policies" && <button className="deploy-stack-button" disabled={!isOperator || busy || !ready("policyRegistration")} onClick={registerPoliciesAndProposeDefault}>{ready("policyRegistration") ? "Register both policies and propose the default" : `Policy registration locked until ${timeLabel(deployment.readyAt.policyRegistration)}`}</button>}
      {nextAction === "default-governance" && <button className="deploy-stack-button" disabled={!isOperator || busy || !ready("defaultGovernance")} onClick={executeDefaultSchedule}>{ready("defaultGovernance") ? "Execute default-policy governance" : `Governance locked until ${timeLabel(deployment.readyAt.defaultGovernance)}`}</button>}
      {nextAction === "finalize" && <button className="deploy-stack-button" disabled={!isOperator || busy || !ready("defaultPolicy") || !pendingActivationTime || currentTime < pendingActivationTime} onClick={finalizeV6}>{ready("defaultPolicy") && pendingActivationTime && currentTime >= pendingActivationTime ? "Finalize policies and activate paused V6" : `Final activation locked until ${timeLabel(deployment.readyAt.defaultPolicy && pendingActivationTime ? (BigInt(deployment.readyAt.defaultPolicy) > pendingActivationTime ? deployment.readyAt.defaultPolicy : pendingActivationTime) : deployment.readyAt.defaultPolicy)}`}</button>}
      {nextAction === "unpause-governance" && <button className="deploy-stack-button" disabled={!isOperator || busy || !ready("unpauseGovernance")} onClick={executeUnpauseSchedule}>{ready("unpauseGovernance") ? "Execute reopening governance" : `Reopening governance locked until ${timeLabel(deployment.readyAt.unpauseGovernance)}`}</button>}
      {nextAction === "unpause" && <button className="deploy-stack-button" disabled={!isOperator || busy || !(onchainUnpauseTime && currentTime >= onchainUnpauseTime)} onClick={reopenLaunches}>{onchainUnpauseTime && currentTime >= onchainUnpauseTime ? "Reopen V6 public launches" : `Final reopening locked until ${timeLabel(onchainUnpauseTime || deployment.readyAt.unpause)}`}</button>}
      {nextAction === "complete" && <a className="deploy-stack-button" href="/#launch">V6 is open — launch the official RMT token →</a>}
      <p className="deployment-safety">Every transaction is shown in your wallet. Never enter a private key or recovery phrase. Stop immediately if any address or amount differs.</p>
    </section>
  );
}
