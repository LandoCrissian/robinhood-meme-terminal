"use client";

import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  concat,
  encodeDeployData,
  getCreate2Address,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import artifactsJson from "../../lib/generated/testnet-stack.json";

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const HOOK_FLAGS = 0x2880n;
const ALL_HOOK_MASK = 0x3fffn;

type Artifact = { abi: Abi; bytecode: Hex };
type Deployment = { manager?: Address; hook?: Address; adapter?: Address; factory?: Address };
type Stage = "idle" | "checking" | "manager" | "mining" | "hook" | "adapter" | "binding-hook" | "factory" | "binding-factory" | "verifying" | "complete" | "failed";

const artifacts = artifactsJson as Record<"poolManager" | "hook" | "adapter" | "factory", Artifact>;

const labels: Record<Stage, string> = {
  idle: "Ready for wallet connection",
  checking: "Checking testnet prerequisites…",
  manager: "Approve test PoolManager deployment",
  mining: "Preparing the secure hook address…",
  hook: "Approve graduation hook deployment",
  adapter: "Approve graduation adapter deployment",
  "binding-hook": "Approve permanent hook binding",
  factory: "Approve launch factory deployment",
  "binding-factory": "Approve permanent factory binding",
  verifying: "Verifying every deployed contract…",
  complete: "Testnet stack verified",
  failed: "Deployment stopped"
};

async function mineHookAddress(manager: Address, deployer: Address) {
  const initCode = encodeDeployData({
    abi: artifacts.hook.abi,
    bytecode: artifacts.hook.bytecode,
    args: [manager, deployer]
  });

  for (let index = 0n; index < 500_000n; index += 1n) {
    const salt = toHex(index, { size: 32 });
    const address = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecode: initCode });
    if ((BigInt(address) & ALL_HOOK_MASK) === HOOK_FLAGS) return { address, initCode, salt };
    if (index !== 0n && index % 4_096n === 0n) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Could not prepare a valid hook address. No transaction was sent.");
}

function short(address: Address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function saveDeployment(deployer: Address, deployment: Deployment) {
  localStorage.setItem("rmt:testnet-stack:v2", JSON.stringify({ deployer, ...deployment }));
}

export function TestnetStackDeployment() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { switchChainAsync } = useSwitchChain();
  const [stage, setStage] = useState<Stage>("idle");
  const [deployment, setDeployment] = useState<Deployment>({});
  const [error, setError] = useState<string>();
  const busy = !["idle", "complete", "failed"].includes(stage);
  const canStart = Boolean(isConnected && address && walletClient && publicClient && !busy);
  const steps = useMemo(() => ["Network checks", "Pool manager", "Graduation hook", "Adapter", "Launch factory", "Final verification"], []);

  useEffect(() => {
    if (!address) return;
    const saved = localStorage.getItem("rmt:testnet-stack:v2");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Deployment & { deployer?: Address };
      if (parsed.deployer?.toLowerCase() === address.toLowerCase()) {
        setDeployment({ manager: parsed.manager, hook: parsed.hook, adapter: parsed.adapter, factory: parsed.factory });
      }
    } catch {
      localStorage.removeItem("rmt:testnet-stack:v2");
    }
  }, [address]);

  async function deploy() {
    if (!address || !walletClient || !publicClient) return;
    setError(undefined);
    const current: Deployment = { ...deployment };

    try {
      if (chainId !== robinhoodChainTestnet.id) await switchChainAsync({ chainId: robinhoodChainTestnet.id });
      setStage("checking");
      const [reportedChainId, create2Code] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getBytecode({ address: CREATE2_DEPLOYER })
      ]);
      if (reportedChainId !== robinhoodChainTestnet.id) throw new Error("The wallet is not connected to Robinhood testnet.");
      if (!create2Code || create2Code === "0x") throw new Error("The required CREATE2 deployer is unavailable. Nothing was deployed.");

      let manager = current.manager;
      if (!manager || !(await publicClient.getBytecode({ address: manager }))) {
        setStage("manager");
        const managerHash = await walletClient.deployContract({
          account: address,
          chain: robinhoodChainTestnet,
          abi: artifacts.poolManager.abi,
          bytecode: artifacts.poolManager.bytecode,
          args: [address]
        });
        const managerReceipt = await publicClient.waitForTransactionReceipt({ hash: managerHash });
        if (!managerReceipt.contractAddress) throw new Error("PoolManager deployment did not return an address.");
        manager = managerReceipt.contractAddress;
        current.manager = manager;
        setDeployment({ ...current });
        saveDeployment(address, current);
      }

      setStage("mining");
      const mined = await mineHookAddress(manager, address);
      let hook = current.hook;
      if (!hook || !(await publicClient.getBytecode({ address: hook }))) {
        setStage("hook");
        const hookHash = await walletClient.sendTransaction({
          account: address,
          chain: robinhoodChainTestnet,
          to: CREATE2_DEPLOYER,
          data: concat([mined.salt, mined.initCode])
        });
        await publicClient.waitForTransactionReceipt({ hash: hookHash });
        if (!(await publicClient.getBytecode({ address: mined.address }))) throw new Error("Graduation hook bytecode was not found after deployment.");
        hook = mined.address;
        current.hook = hook;
        setDeployment({ ...current });
        saveDeployment(address, current);
      }

      let adapter = current.adapter;
      if (!adapter || !(await publicClient.getBytecode({ address: adapter }))) {
        setStage("adapter");
        const adapterHash = await walletClient.deployContract({
          account: address,
          chain: robinhoodChainTestnet,
          abi: artifacts.adapter.abi,
          bytecode: artifacts.adapter.bytecode,
          args: [manager, hook, 10_000, 200]
        });
        const adapterReceipt = await publicClient.waitForTransactionReceipt({ hash: adapterHash });
        if (!adapterReceipt.contractAddress) throw new Error("Adapter deployment did not return an address.");
        adapter = adapterReceipt.contractAddress;
        current.adapter = adapter;
        setDeployment({ ...current });
        saveDeployment(address, current);
      }

      const existingAdapter = await publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "adapter" });
      if (String(existingAdapter).toLowerCase() !== adapter.toLowerCase()) {
        setStage("binding-hook");
        const bindHookHash = await walletClient.writeContract({
          account: address,
          chain: robinhoodChainTestnet,
          address: hook,
          abi: artifacts.hook.abi,
          functionName: "bindAdapter",
          args: [adapter]
        });
        await publicClient.waitForTransactionReceipt({ hash: bindHookHash });
      }

      let factory = current.factory;
      if (!factory || !(await publicClient.getBytecode({ address: factory }))) {
        setStage("factory");
        const factoryHash = await walletClient.deployContract({
          account: address,
          chain: robinhoodChainTestnet,
          abi: artifacts.factory.abi,
          bytecode: artifacts.factory.bytecode,
          args: [adapter, 100, parseEther("0.01"), parseEther("1073000000"), parseEther("0.001")]
        });
        const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
        if (!factoryReceipt.contractAddress) throw new Error("Factory deployment did not return an address.");
        factory = factoryReceipt.contractAddress;
        current.factory = factory;
        setDeployment({ ...current });
        saveDeployment(address, current);
      }

      const existingFactory = await publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" });
      if (String(existingFactory).toLowerCase() !== factory.toLowerCase()) {
        setStage("binding-factory");
        const bindFactoryHash = await walletClient.writeContract({
          account: address,
          chain: robinhoodChainTestnet,
          address: adapter,
          abi: artifacts.adapter.abi,
          functionName: "bindFactory",
          args: [factory]
        });
        await publicClient.waitForTransactionReceipt({ hash: bindFactoryHash });
      }

      setStage("verifying");
      const [boundAdapter, boundFactory, configuredAdapter, graduationTarget] = await Promise.all([
        publicClient.readContract({ address: hook, abi: artifacts.hook.abi, functionName: "adapter" }),
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" }),
        publicClient.readContract({ address: factory, abi: artifacts.factory.abi, functionName: "graduationAdapter" }),
        publicClient.readContract({ address: factory, abi: artifacts.factory.abi, functionName: "graduationTarget" })
      ]);
      if (
        String(boundAdapter).toLowerCase() !== adapter.toLowerCase() ||
        String(boundFactory).toLowerCase() !== factory.toLowerCase() ||
        String(configuredAdapter).toLowerCase() !== adapter.toLowerCase() ||
        graduationTarget !== parseEther("0.001")
      ) throw new Error("The final contract bindings did not match. Do not use this deployment.");

      saveDeployment(address, { manager, hook, adapter, factory });
      setStage("complete");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deployment was stopped by the wallet or network.");
      setStage("failed");
    }
  }

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${stage}`}>
        <span className="status-dot" />
        <strong>{labels[stage]}</strong>
      </div>
      <ol className="deployment-steps">
        {steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
      </ol>
      <div className="deployment-rules">
        <p><strong>Not a token-launch fee.</strong> This page deploys shared platform infrastructure once.</p>
        <p><strong>Optimized test stack:</strong> low-cost clone launches · no duplicate names or tickers</p>
        <p><strong>Test parameters:</strong> 1% curve fee · 0.001 test ETH graduation target</p>
        <p>This deploys a disposable upstream V4 PoolManager for testing. It is not an official Uniswap deployment.</p>
      </div>
      {Object.entries(deployment).length > 0 && (
        <div className="deployment-addresses">
          {Object.entries(deployment).map(([name, value]) => value && <p key={name}><span>{name}</span><code>{short(value)}</code></p>)}
        </div>
      )}
      {error && <p className="deployment-error">{error}</p>}
      <button className="deploy-stack-button" disabled={!canStart} onClick={deploy}>
        {!isConnected ? "Connect wallet above" : busy ? "Waiting for wallet approval…" : stage === "complete" ? "Deployment verified" : Object.keys(deployment).length ? "Resume deployment" : "Deploy test stack"}
      </button>
      <p className="deployment-safety">Robinhood Wallet will show each transaction before you approve it. Never enter a private key or recovery phrase.</p>
    </section>
  );
}
