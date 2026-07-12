"use client";

import { robinhoodChainTestnet } from "@rmt/shared/chains";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  concat,
  encodeDeployData,
  formatEther,
  getCreate2Address,
  keccak256,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import artifactsJson from "../../lib/generated/testnet-stack.json";
import { FACTORY_UPDATED_EVENT } from "../../lib/use-factory-address";

const APPROVED_TEST_WALLETS = new Set([
  "0x568a5398bdc155d0f567a7722d4a9c32908a1852",
  "0x7e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca",
  "0xc560a2798824ae50d5d92470f8e15b3f09f45994"
]);
const MINIMUM_BALANCE = parseEther("0.004");
const ALPHA_GRADUATION_TARGET = parseEther("1000000");
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;

type Artifact = { abi: Abi; bytecode: Hex };
type Deployment = { adapter?: Address; factory?: Address };
type Stage = "idle" | "checking" | "adapter" | "factory" | "binding" | "verifying" | "complete" | "failed";

const artifacts = artifactsJson as Record<"adapter" | "factory" | "factoryV2", Artifact>;
const labels: Record<Stage, string> = {
  idle: "Ready for wallet connection",
  checking: "Checking testnet wallet…",
  adapter: "Approve lightweight test adapter",
  factory: "Approve optimized launch factory",
  binding: "Approve permanent factory binding",
  verifying: "Verifying launch infrastructure…",
  complete: "Testnet launch stack verified",
  failed: "Deployment stopped"
};

function short(address: Address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function saveDeployment(storageKey: string, deployer: Address, deployment: Deployment) {
  localStorage.setItem(storageKey, JSON.stringify({ deployer, ...deployment }));
}

function readableDeploymentError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("4001") || /rejected|denied|cancelled/i.test(message)) {
    return "The wallet cancelled or could not approve this deployment. No test ETH was spent. Use desktop MetaMask for this one-time infrastructure deployment; Robinhood Wallet mobile currently blocks this advanced contract-creation transaction.";
  }
  return message || "Deployment was stopped by the wallet or network.";
}

export function TestnetStackDeployment() {
  const versionTwo = useSearchParams().get("version") === "2";
  const storageKey = versionTwo ? "rmt:testnet-lite-stack:v4" : "rmt:testnet-lite-stack:v3";
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { switchChainAsync } = useSwitchChain();
  const [stage, setStage] = useState<Stage>("idle");
  const [deployment, setDeployment] = useState<Deployment>({});
  const [balance, setBalance] = useState<bigint>();
  const [error, setError] = useState<string>();
  const busy = !["idle", "complete", "failed"].includes(stage);
  const approvedWallet = Boolean(address && APPROVED_TEST_WALLETS.has(address.toLowerCase()));
  const canStart = Boolean(isConnected && address && approvedWallet && walletClient && publicClient && !busy);
  const steps = useMemo(() => ["Wallet check", "Test adapter", "Launch factory", "Permanent binding", "Verification"], []);

  useEffect(() => {
    if (!address || !publicClient) return;
    void publicClient.getBalance({ address }).then(setBalance).catch(() => setBalance(undefined));
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Deployment & { deployer?: Address };
      if (parsed.deployer?.toLowerCase() === address.toLowerCase()) {
        setDeployment({ adapter: parsed.adapter, factory: parsed.factory });
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [address, publicClient, versionTwo]);

  async function deploy() {
    if (!address || !walletClient || !publicClient) return;
    setError(undefined);
    const current = { ...deployment };

    try {
      if (chainId !== robinhoodChainTestnet.id) await switchChainAsync({ chainId: robinhoodChainTestnet.id });
      setStage("checking");
      if ((await publicClient.getChainId()) !== robinhoodChainTestnet.id) throw new Error("Connect to Robinhood Chain Testnet.");
      const create2Code = await publicClient.getBytecode({ address: CREATE2_DEPLOYER });
      if (!create2Code || create2Code === "0x") throw new Error("The testnet CREATE2 deployer is unavailable.");
      const currentBalance = await publicClient.getBalance({ address });
      setBalance(currentBalance);
      if (currentBalance < MINIMUM_BALANCE) {
        throw new Error(`At least 0.004 test ETH is required. This wallet has ${formatEther(currentBalance)} test ETH.`);
      }

      let adapter = current.adapter;
      if (!adapter || !(await publicClient.getBytecode({ address: adapter }))) {
        setStage("adapter");
        const initCode = encodeDeployData({
          abi: artifacts.adapter.abi,
          bytecode: artifacts.adapter.bytecode,
          args: [address]
        });
        const salt = keccak256(concat([toHex(versionTwo ? "rmt-lite-adapter-v2" : "rmt-lite-adapter-v1"), address]));
        adapter = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecode: initCode });
        if (!(await publicClient.getBytecode({ address: adapter }))) {
          const data = concat([salt, initCode]);
          const estimate = await publicClient.estimateGas({ account: address, to: CREATE2_DEPLOYER, data });
          const hash = await walletClient.sendTransaction({
            account: address,
            chain: robinhoodChainTestnet,
            to: CREATE2_DEPLOYER,
            data,
            gas: estimate * 120n / 100n
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }
        if (!(await publicClient.getBytecode({ address: adapter }))) throw new Error("Test adapter bytecode was not found.");
        current.adapter = adapter;
        setDeployment({ ...current });
        saveDeployment(storageKey, address, current);
      }

      let factory = current.factory;
      if (!factory || !(await publicClient.getBytecode({ address: factory }))) {
        setStage("factory");
        const factoryArtifact = versionTwo ? artifacts.factoryV2 : artifacts.factory;
        const initCode = encodeDeployData({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode, args: versionTwo ? [adapter, 100, parseEther("0.01"), parseEther("1073000000"), ALPHA_GRADUATION_TARGET, address, address] : [adapter, 100, parseEther("0.01"), parseEther("1073000000"), ALPHA_GRADUATION_TARGET] });
        const salt = keccak256(concat([toHex(versionTwo ? "rmt-lite-factory-v2" : "rmt-lite-factory-v1"), adapter]));
        factory = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecode: initCode });
        if (!(await publicClient.getBytecode({ address: factory }))) {
          const data = concat([salt, initCode]);
          const estimate = await publicClient.estimateGas({ account: address, to: CREATE2_DEPLOYER, data });
          const hash = await walletClient.sendTransaction({
            account: address,
            chain: robinhoodChainTestnet,
            to: CREATE2_DEPLOYER,
            data,
            gas: estimate * 120n / 100n
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }
        if (!(await publicClient.getBytecode({ address: factory }))) throw new Error("Launch factory bytecode was not found.");
        current.factory = factory;
        setDeployment({ ...current });
        saveDeployment(storageKey, address, current);
      }

      const existingFactory = await publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" });
      if (String(existingFactory).toLowerCase() !== factory.toLowerCase()) {
        setStage("binding");
        const hash = await walletClient.writeContract({
          account: address,
          chain: robinhoodChainTestnet,
          address: adapter,
          abi: artifacts.adapter.abi,
          functionName: "bindFactory",
          args: [factory]
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setStage("verifying");
      const [boundFactory, configuredAdapter, target] = await Promise.all([
        publicClient.readContract({ address: adapter, abi: artifacts.adapter.abi, functionName: "factory" }),
        publicClient.readContract({ address: factory, abi: versionTwo ? artifacts.factoryV2.abi : artifacts.factory.abi, functionName: "graduationAdapter" }),
        publicClient.readContract({ address: factory, abi: versionTwo ? artifacts.factoryV2.abi : artifacts.factory.abi, functionName: "graduationTarget" })
      ]);
      if (
        String(boundFactory).toLowerCase() !== factory.toLowerCase() ||
        String(configuredAdapter).toLowerCase() !== adapter.toLowerCase() ||
        target !== ALPHA_GRADUATION_TARGET
      ) throw new Error("Final contract verification failed. Do not use this deployment.");

      saveDeployment(storageKey, address, { adapter, factory });
      localStorage.setItem("rmt:testnet-factory", factory);
      window.dispatchEvent(new Event(FACTORY_UPDATED_EVENT));
      setBalance(await publicClient.getBalance({ address }));
      setStage("complete");
    } catch (cause) {
      setError(readableDeploymentError(cause));
      setStage("failed");
    }
  }

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${stage}`}><span className="status-dot" /><strong>{labels[stage]}</strong></div>
      <ol className="deployment-steps">{steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
      <div className="deployment-rules">
        <p><strong>Low-cost test stack:</strong> launches, curve trading and reward claims are enabled.</p>
        <p><strong>DEX graduation is disabled in this alpha.</strong> No graduation assets can be withdrawn or silently redirected.</p>
        <p><strong>Test parameters:</strong> 1% curve fee · graduation cannot be reached in this alpha</p>
      </div>
      {address && <div className="deployment-addresses"><p><span>Connected wallet</span><code>{address}</code></p>{balance !== undefined && <p><span>Test ETH</span><code>{formatEther(balance)}</code></p>}</div>}
      {isConnected && address && !approvedWallet && <p className="deployment-error">This wallet is not approved for the test deployment.</p>}
      {Object.entries(deployment).length > 0 && <div className="deployment-addresses">{Object.entries(deployment).map(([name, value]) => value && <p key={name}><span>{name}</span><code>{short(value)}</code></p>)}</div>}
      {error && <p className="deployment-error">{error}</p>}
      {stage === "complete" ? (
        versionTwo ? <Link className="deploy-stack-button" href="/">Continue to simple launch V2 →</Link> : <Link className="deploy-stack-button" href="/deploy-testnet?version=2">Upgrade to automatic simple launches →</Link>
      ) : (
        <button className="deploy-stack-button" disabled={!canStart} onClick={deploy}>
          {!isConnected ? "Connect wallet above" : !approvedWallet ? "Switch to approved test wallet" : busy ? "Waiting for wallet approval…" : Object.keys(deployment).length ? "Resume low-cost deployment" : "Deploy low-cost test stack"}
        </button>
      )}
      <p className="deployment-safety">Your wallet shows every testnet transaction before approval. Never enter a private key or recovery phrase.</p>
    </section>
  );
}
