"use client";

import { robinhoodChain } from "@rmt/shared/chains";
import { useEffect, useState } from "react";
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
const REVENUE_ROUTER = "0x066Fd10caF090F274d1861e4F838558f98cE1ee9" as Address;
const V5_FACTORY = "0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD" as Address;
const REGISTRY = "0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1" as Address;
const OFFICIAL_LEGACY_TOKEN = "0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C" as Address;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const STORAGE_KEY = "rmt:official-migration:v6";
const VERSION = keccak256(toHex("RMT_FACTORY_V6"));
const DAY = 86_400n;
const HOOK_FLAGS = 0x2880n;
const HOOK_MASK = 0x3fffn;

type Artifact = { abi: Abi; bytecode: Hex };
type ArtifactName = "hook" | "adapter" | "rewardsController" | "factoryV6" | "governance" | "registry";
type AddressKey = "hook" | "adapter" | "rewardsController" | "factory";
type MigrationDeployment = {
  addresses: Partial<Record<AddressKey, Address>>;
  transactions: Record<string, Hex>;
  hookSalt?: Hex;
  governanceProposalId?: string;
  governanceExecuteAfter?: string;
  verified?: boolean;
};

const artifacts = artifactsJson as Record<ArtifactName, Artifact>;
const EMPTY: MigrationDeployment = { addresses: {}, transactions: {} };

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
  return cause instanceof Error ? cause.message : "The migration step stopped safely.";
}

function timeLabel(timestamp?: bigint) {
  if (!timestamp) return "Not scheduled";
  return new Date(Number(timestamp) * 1_000).toLocaleString();
}

export function OfficialRmtMigration() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { switchChainAsync } = useSwitchChain();
  const [deployment, setDeployment] = useState<MigrationDeployment>(EMPTY);
  const [activeFactory, setActiveFactory] = useState<Address>();
  const [pendingFactory, setPendingFactory] = useState<Address>();
  const [pendingActivationTime, setPendingActivationTime] = useState<bigint>();
  const [status, setStatus] = useState("Ready to prepare the official RMT migration");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<bigint>();
  const [currentTime, setCurrentTime] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));
  const isOperator = address?.toLowerCase() === OPERATOR.toLowerCase();
  const factory = deployment.addresses.factory;
  const isActive = Boolean(factory && activeFactory?.toLowerCase() === factory.toLowerCase());
  const proposalExecuted = Boolean(factory && pendingFactory?.toLowerCase() === factory.toLowerCase());
  const governanceReadyAt = deployment.governanceExecuteAfter ? BigInt(deployment.governanceExecuteAfter) : undefined;

  function persist(next: MigrationDeployment) {
    const snapshot = {
      ...next,
      addresses: { ...next.addresses },
      transactions: { ...next.transactions }
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
    if (address) setBalance(await publicClient.getBalance({ address }));
  }

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setDeployment(JSON.parse(raw) as MigrationDeployment); }
      catch { localStorage.removeItem(STORAGE_KEY); }
    }
    void refreshOnchain().catch(() => undefined);
    const timer = window.setInterval(() => {
      setCurrentTime(BigInt(Math.floor(Date.now() / 1_000)));
      void refreshOnchain().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [publicClient, address]);

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
    current: MigrationDeployment,
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
    current: MigrationDeployment,
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

  async function deployHook(current: MigrationDeployment) {
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

  async function deployAndPropose() {
    if (!address || !walletClient || !publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    const current: MigrationDeployment = { ...deployment, addresses: { ...deployment.addresses }, transactions: { ...deployment.transactions } };
    try {
      if (!isOperator) throw new Error("Connect the RMTMain operator wallet.");
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      if (activeFactory?.toLowerCase() !== V5_FACTORY.toLowerCase()) throw new Error("V5 must remain active while V6 is prepared.");
      for (const required of [GOVERNANCE, REVENUE_ROUTER, V5_FACTORY, REGISTRY, OFFICIAL_LEGACY_TOKEN, POOL_MANAGER, CREATE2_DEPLOYER]) {
        if (!(await hasCode(required))) throw new Error(`Required contract is missing at ${required}.`);
      }
      const hook = await deployHook(current);
      const adapter = await deployContract(current, "adapter", artifacts.adapter, [POOL_MANAGER, hook, 10_000, 200], "V6 graduation adapter");
      const boundAdapter = await publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "adapter" }) as Address;
      if (boundAdapter.toLowerCase() !== adapter.toLowerCase()) {
        await sendCall(current, "bindHookAdapter", hook, artifacts.hook, "bindAdapter", [adapter], "bind V6 hook to adapter");
      }
      const controller = await deployContract(current, "rewardsController", artifacts.rewardsController, [OPERATOR, GOVERNANCE, DAY], "V6 rewards controller");
      const nextFactory = await deployContract(
        current,
        "factory",
        artifacts.factoryV6,
        [adapter, 100, parseEther("0.3"), parseEther("1017500000"), parseEther("2"), controller, REVENUE_ROUTER, V5_FACTORY, OFFICIAL_LEGACY_TOKEN, OPERATOR],
        "V6 official migration factory"
      );
      const boundFactory = await publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" }) as Address;
      if (boundFactory === "0x0000000000000000000000000000000000000000") {
        await sendCall(current, "bindAdapterFactory", adapter, artifacts.adapter, "bindFactory", [nextFactory], "bind V6 adapter to factory");
      }
      const rewardsFactory = await publicClient.readContract({ address: controller, abi: artifacts.rewardsController.abi, functionName: "factory" }) as Address;
      if (rewardsFactory === "0x0000000000000000000000000000000000000000") {
        await sendCall(current, "bindRewardsFactory", controller, artifacts.rewardsController, "bindFactory", [nextFactory], "bind V6 rewards to factory");
      }
      const checks = await Promise.all([
        publicClient.readContract({ address: nextFactory, abi: artifacts.factoryV6.abi, functionName: "officialLegacyToken" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.factoryV6.abi, functionName: "officialMigrationAuthority" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.factoryV6.abi, functionName: "legacyIdentityFactory" }),
        publicClient.readContract({ address: nextFactory, abi: artifacts.factoryV6.abi, functionName: "SETTLEMENT_VERSION" })
      ]);
      if (
        String(checks[0]).toLowerCase() !== OFFICIAL_LEGACY_TOKEN.toLowerCase()
        || String(checks[1]).toLowerCase() !== OPERATOR.toLowerCase()
        || String(checks[2]).toLowerCase() !== V5_FACTORY.toLowerCase()
        || checks[3] !== 3n
      ) throw new Error("V6 migration verification failed. Do not propose activation.");
      current.verified = true;
      if (!current.transactions.governanceProposal) {
        const proposalId = await publicClient.readContract({ address: GOVERNANCE, abi: artifacts.governance.abi, functionName: "transactionCount" }) as bigint;
        const registryCall = encodeFunctionData({ abi: artifacts.registry.abi, functionName: "proposeFactory", args: [nextFactory, VERSION] });
        const receipt = await sendCall(current, "governanceProposal", GOVERNANCE, artifacts.governance, "propose", [REGISTRY, 0n, registryCall], "submit delayed V6 activation proposal");
        const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        current.governanceProposalId = proposalId.toString();
        current.governanceExecuteAfter = (block.timestamp + DAY).toString();
        persist(current);
      }
      setStatus("V6 verified and proposed — governance delay is running");
      await refreshOnchain();
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Migration paused safely");
    } finally {
      setBusy(false);
    }
  }

  async function executeGovernance() {
    if (!deployment.governanceProposalId || !address || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await sendCall(deployment, "governanceExecution", GOVERNANCE, artifacts.governance, "execute", [BigInt(deployment.governanceProposalId)], "execute approved V6 proposal");
      setStatus("Governance executed — registry activation delay is running");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  async function activateV6() {
    if (!address || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await sendCall(deployment, "registryActivation", REGISTRY, artifacts.registry, "activateFactory", [], "activate V6 factory");
      setStatus("V6 is active — official RMT can now be relaunched once");
      await refreshOnchain();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${isActive ? "complete" : error ? "failed" : "idle"}`}>
        <span className="status-dot" /><strong>{status}</strong>
      </div>
      <div className="deployment-rules">
        <p><strong>Purpose:</strong> one controlled relaunch of Robinhood Meme Terminal / RMT by RMTMain.</p>
        <p><strong>Vamping stays blocked:</strong> every other V4 and V5 name or ticker remains permanently reserved.</p>
        <p><strong>Delay:</strong> 24-hour governance review, followed by the existing 48-hour registry review.</p>
        <p><strong>Old token:</strong> {OFFICIAL_LEGACY_TOKEN} remains unchanged and is used only as identity proof.</p>
      </div>
      <div className="deployment-addresses">
        <p><span>Connected wallet</span><code>{address ? short(address) : "Not connected"}</code></p>
        {balance !== undefined && <p><span>Mainnet ETH balance</span><code>{formatEther(balance)} ETH</code></p>}
        <p><span>Active factory</span><code>{activeFactory ? short(activeFactory) : "Reading…"}</code></p>
        {factory && <p><span>Proposed V6 factory</span><code>{short(factory)}</code></p>}
        <p><span>Governance executable</span><code>{timeLabel(governanceReadyAt)}</code></p>
        <p><span>Registry activation</span><code>{timeLabel(pendingActivationTime)}</code></p>
      </div>
      {isConnected && !isOperator && <p className="deployment-error">Wrong wallet connected. Use RMTMain: {OPERATOR}</p>}
      {error && <p className="deployment-error">{error}</p>}
      {!deployment.transactions.governanceProposal && (
        <button className="deploy-stack-button" disabled={!isOperator || busy} onClick={deployAndPropose}>
          {busy ? status : Object.keys(deployment.addresses).length ? "Resume V6 deployment" : "Begin reviewed V6 migration"}
        </button>
      )}
      {deployment.transactions.governanceProposal && !proposalExecuted && !isActive && (
        <button className="deploy-stack-button" disabled={!isOperator || busy || !governanceReadyAt || currentTime < governanceReadyAt} onClick={executeGovernance}>
          {governanceReadyAt && currentTime < governanceReadyAt ? `Governance locked until ${timeLabel(governanceReadyAt)}` : "Execute approved governance proposal"}
        </button>
      )}
      {proposalExecuted && !isActive && (
        <button className="deploy-stack-button" disabled={!isOperator || busy || !pendingActivationTime || currentTime < pendingActivationTime} onClick={activateV6}>
          {pendingActivationTime && currentTime < pendingActivationTime ? `Registry locked until ${timeLabel(pendingActivationTime)}` : "Activate V6 factory"}
        </button>
      )}
      {isActive && <a className="deploy-stack-button" href="/#launch">Continue to the official RMT relaunch →</a>}
      <p className="deployment-safety">Every transaction is shown in your wallet. Never enter a private key or recovery phrase.</p>
    </section>
  );
}
