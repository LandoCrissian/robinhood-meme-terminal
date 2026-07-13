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
const SIGNERS = [
  OPERATOR,
  "0xC560A2798824Ae50d5D92470F8e15b3F09f45994",
  "0xa9ADBB8322Cd187d94b8D9425ADc4BDe67d5cCa4"
] as const;
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643E40951" as Address;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const STORAGE_KEY = "rmt:mainnet-stack:v4";
const DAY = 86_400n;
const HOOK_FLAGS = 0x2880n;
const HOOK_MASK = 0x3fffn;

const PURPOSES = [
  "PROTOCOL_TREASURY",
  "BUYBACK_RESERVE",
  "GRADUATION_ASSISTANCE",
  "REFERRAL_RESERVE",
  "ECOSYSTEM_GROWTH"
] as const;

type Artifact = { abi: Abi; bytecode: Hex };
type ArtifactName = "governance" | "purposeVault" | "hook" | "adapter" | "revenueRouter" | "rewardsController" | "factory" | "registry";
type AddressKey =
  | "factoryGovernance"
  | "rewardsGovernance"
  | "protocolGovernance"
  | "treasuryVault"
  | "buybackVault"
  | "graduationVault"
  | "referralVault"
  | "ecosystemVault"
  | "hook"
  | "adapter"
  | "revenueRouter"
  | "rewardsController"
  | "factory"
  | "registry";
type Deployment = {
  deployer?: Address;
  addresses: Partial<Record<AddressKey, Address>>;
  transactions: Record<string, Hex>;
  hookSalt?: Hex;
  verified?: boolean;
};

const artifacts = artifactsJson as Record<ArtifactName, Artifact>;
const EMPTY: Deployment = { addresses: {}, transactions: {} };

const addressSteps: Array<[AddressKey, string]> = [
  ["factoryGovernance", "Factory governance"],
  ["rewardsGovernance", "Rewards governance"],
  ["protocolGovernance", "Protocol governance"],
  ["treasuryVault", "Protocol treasury vault"],
  ["buybackVault", "Buyback reserve vault"],
  ["graduationVault", "Graduation assistance vault"],
  ["referralVault", "Referral reserve vault"],
  ["ecosystemVault", "Ecosystem growth vault"],
  ["hook", "Uniswap V4 graduation hook"],
  ["adapter", "Graduation adapter"],
  ["revenueRouter", "Revenue router"],
  ["rewardsController", "Rewards controller"],
  ["factory", "Launch factory"],
  ["registry", "Version registry"]
];

function short(value: Address) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function purpose(value: string) {
  return keccak256(toHex(value));
}

function describeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/4001|rejected|denied|cancelled/i.test(message)) {
    return "The wallet cancelled this step. Nothing else was deployed. Reconnect the same RMTMain wallet and choose Resume.";
  }
  return message || "The deployment stopped. The completed steps are saved and will not be repeated.";
}

export function MainnetStackDeployment() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { switchChainAsync } = useSwitchChain();
  const [deployment, setDeployment] = useState<Deployment>(EMPTY);
  const [status, setStatus] = useState("Waiting for RMTMain");
  const [error, setError] = useState<string>();
  const [balance, setBalance] = useState<bigint>();
  const [estimate, setEstimate] = useState<bigint>();
  const [busy, setBusy] = useState(false);
  const isOperator = address?.toLowerCase() === OPERATOR.toLowerCase();
  const completed = useMemo(
    () => addressSteps.filter(([key]) => deployment.addresses[key]).length,
    [deployment]
  );

  useEffect(() => {
    if (!address || !publicClient) return;
    void publicClient.getBalance({ address }).then(setBalance).catch(() => setBalance(undefined));
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Deployment;
      if (saved.deployer?.toLowerCase() === address.toLowerCase()) setDeployment(saved);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [address, publicClient]);

  function persist(next: Deployment) {
    const snapshot = {
      ...next,
      deployer: OPERATOR,
      addresses: { ...next.addresses },
      transactions: { ...next.transactions }
    };
    setDeployment(snapshot);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  async function hasCode(value?: Address) {
    if (!value || !publicClient) return false;
    const code = await publicClient.getBytecode({ address: value });
    return Boolean(code && code !== "0x");
  }

  async function prepareGas(data: Hex, to?: Address) {
    if (!publicClient || !address) throw new Error("Mainnet provider is unavailable.");
    const gas = await publicClient.estimateGas({ account: address, data, ...(to ? { to } : {}) });
    const buffered = gas * 115n / 100n;
    const gasPrice = await publicClient.getGasPrice();
    const cost = buffered * gasPrice;
    const currentBalance = await publicClient.getBalance({ address });
    setBalance(currentBalance);
    setEstimate(cost);
    if (currentBalance < cost) {
      throw new Error(
        `This next approval needs about ${formatEther(cost)} ETH for gas, but RMTMain has ${formatEther(currentBalance)} ETH.`
      );
    }
    return buffered;
  }

  async function deployContract(
    current: Deployment,
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
    const gas = await prepareGas(data);
    const hash = await walletClient.sendTransaction({
      account: address,
      chain: robinhoodChain,
      data,
      gas
    });
    setStatus(`Confirming: ${label}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${label} deployment failed.`);
    if (!(await hasCode(receipt.contractAddress))) throw new Error(`${label} bytecode could not be verified.`);
    current.addresses[key] = receipt.contractAddress;
    current.transactions[key] = hash;
    persist(current);
    setBalance(await publicClient.getBalance({ address }));
    return receipt.contractAddress;
  }

  async function sendCall(
    current: Deployment,
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
    const gas = await prepareGas(data, to);
    const hash = await walletClient.sendTransaction({
      account: address,
      chain: robinhoodChain,
      to,
      data,
      gas
    });
    setStatus(`Confirming: ${label}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} failed.`);
    current.transactions[key] = hash;
    persist(current);
    setBalance(await publicClient.getBalance({ address }));
  }

  async function deployHook(current: Deployment) {
    const saved = current.addresses.hook;
    if (await hasCode(saved)) return saved as Address;
    if (!publicClient || !walletClient || !address) throw new Error("Connect RMTMain first.");

    setStatus("Finding the canonical hook address…");
    const initCode = encodeDeployData({
      abi: artifacts.hook.abi,
      bytecode: artifacts.hook.bytecode,
      args: [POOL_MANAGER, OPERATOR]
    });
    let salt = current.hookSalt;
    let expected: Address | undefined;
    if (salt) expected = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecode: initCode });
    if (!salt || (BigInt(expected as Address) & HOOK_MASK) !== HOOK_FLAGS) {
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
    if (!salt || !expected) throw new Error("A valid V4 hook address could not be found.");

    if (!(await hasCode(expected))) {
      setStatus("Approve: Uniswap V4 graduation hook");
      const data = concat([salt, initCode]);
      const gas = await prepareGas(data, CREATE2_DEPLOYER);
      const hash = await walletClient.sendTransaction({
        account: address,
        chain: robinhoodChain,
        to: CREATE2_DEPLOYER,
        data,
        gas
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("V4 hook deployment failed.");
      current.transactions.hook = hash;
    }
    if (!(await hasCode(expected))) throw new Error("V4 hook bytecode could not be verified.");
    current.addresses.hook = expected;
    persist(current);
    return expected;
  }

  async function read(to: Address, artifact: Artifact, functionName: string, args: readonly unknown[] = []) {
    if (!publicClient) throw new Error("Mainnet provider is unavailable.");
    return publicClient.readContract({ address: to, abi: artifact.abi, functionName, args });
  }

  async function run() {
    if (!address || !walletClient || !publicClient || busy) return;
    setBusy(true);
    setError(undefined);
    setEstimate(undefined);
    const current: Deployment = {
      ...deployment,
      deployer: OPERATOR,
      addresses: { ...deployment.addresses },
      transactions: { ...deployment.transactions }
    };

    try {
      if (address.toLowerCase() !== OPERATOR.toLowerCase()) throw new Error("Connect the RMTMain operator wallet.");
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      if ((await publicClient.getChainId()) !== robinhoodChain.id) throw new Error("Connect to Robinhood Chain mainnet.");
      for (const canonical of [POOL_MANAGER, CREATE2_DEPLOYER]) {
        if (!(await hasCode(canonical))) throw new Error(`Required Robinhood contract is missing at ${canonical}.`);
      }

      const signerArgs = [SIGNERS] as const;
      const factoryGovernance = await deployContract(current, "factoryGovernance", artifacts.governance, [SIGNERS, 0n], "factory governance");
      const rewardsGovernance = await deployContract(current, "rewardsGovernance", artifacts.governance, [SIGNERS, 0n], "rewards governance");
      const protocolGovernance = await deployContract(current, "protocolGovernance", artifacts.governance, [SIGNERS, DAY], "protocol governance");

      const vaultKeys: AddressKey[] = ["treasuryVault", "buybackVault", "graduationVault", "referralVault", "ecosystemVault"];
      const vaults: Address[] = [];
      for (let i = 0; i < PURPOSES.length; i += 1) {
        vaults.push(await deployContract(current, vaultKeys[i], artifacts.purposeVault, [protocolGovernance, purpose(PURPOSES[i])], PURPOSES[i].toLowerCase().replaceAll("_", " ")));
      }

      const hook = await deployHook(current);
      const adapter = await deployContract(current, "adapter", artifacts.adapter, [POOL_MANAGER, hook, 10_000, 200], "graduation adapter");
      if (String(await read(hook, artifacts.hook, "adapter")).toLowerCase() !== adapter.toLowerCase()) {
        await sendCall(current, "bindHookAdapter", hook, artifacts.hook, "bindAdapter", [adapter], "bind hook to adapter");
      }

      const recipients = vaults as [Address, Address, Address, Address, Address];
      const revenueRouter = await deployContract(current, "revenueRouter", artifacts.revenueRouter, [recipients], "protocol revenue router");
      const rewardsController = await deployContract(current, "rewardsController", artifacts.rewardsController, [OPERATOR, rewardsGovernance, DAY], "rewards controller");
      const factory = await deployContract(
        current,
        "factory",
        artifacts.factory,
        [adapter, 100, parseEther("0.3"), parseEther("1073000000"), parseEther("1"), rewardsController, revenueRouter],
        "RMT launch factory"
      );

      if (String(await read(adapter, artifacts.adapter, "factory")).toLowerCase() !== factory.toLowerCase()) {
        await sendCall(current, "bindAdapterFactory", adapter, artifacts.adapter, "bindFactory", [factory], "bind adapter to factory");
      }
      if (String(await read(rewardsController, artifacts.rewardsController, "factory")).toLowerCase() !== factory.toLowerCase()) {
        await sendCall(current, "bindRewardsFactory", rewardsController, artifacts.rewardsController, "bindFactory", [factory], "bind rewards to factory");
      }

      const registry = await deployContract(
        current,
        "registry",
        artifacts.registry,
        [factoryGovernance, 2n * DAY, factory, purpose("RMT_FACTORY_V4")],
        "version registry"
      );

      setStatus("Verifying every permanent binding…");
      for (const [, value] of Object.entries(current.addresses)) {
        if (!(await hasCode(value))) throw new Error(`Missing deployed bytecode at ${value}.`);
      }
      const checks = await Promise.all([
        read(hook, artifacts.hook, "adapter"),
        read(adapter, artifacts.adapter, "factory"),
        read(adapter, artifacts.adapter, "poolManager"),
        read(adapter, artifacts.adapter, "hook"),
        read(factory, artifacts.factory, "graduationAdapter"),
        read(factory, artifacts.factory, "rewardsController"),
        read(factory, artifacts.factory, "platformTreasury"),
        read(factory, artifacts.factory, "marketFeeBps"),
        read(factory, artifacts.factory, "initialVirtualEthReserve"),
        read(factory, artifacts.factory, "initialVirtualTokenReserve"),
        read(factory, artifacts.factory, "graduationTarget"),
        read(rewardsController, artifacts.rewardsController, "factory"),
        read(rewardsController, artifacts.rewardsController, "governance"),
        read(rewardsController, artifacts.rewardsController, "releaseDelay"),
        read(registry, artifacts.registry, "governance"),
        read(registry, artifacts.registry, "activationDelay"),
        read(registry, artifacts.registry, "activeFactory"),
        read(registry, artifacts.registry, "activeVersion")
      ]);
      const expected = [
        adapter,
        factory,
        POOL_MANAGER,
        hook,
        adapter,
        rewardsController,
        revenueRouter,
        100n,
        parseEther("0.3"),
        parseEther("1073000000"),
        parseEther("1"),
        factory,
        rewardsGovernance,
        DAY,
        factoryGovernance,
        2n * DAY,
        factory,
        purpose("RMT_FACTORY_V4")
      ];
      for (let i = 0; i < checks.length; i += 1) {
        if (String(checks[i]).toLowerCase() !== String(expected[i]).toLowerCase()) {
          throw new Error(`Final binding check ${i + 1} failed. Do not publish this deployment.`);
        }
      }

      for (const governance of [factoryGovernance, rewardsGovernance, protocolGovernance]) {
        for (let i = 0; i < SIGNERS.length; i += 1) {
          const configured = await read(governance, artifacts.governance, "signers", [BigInt(i)]);
          if (String(configured).toLowerCase() !== SIGNERS[i].toLowerCase()) throw new Error("Governance signer verification failed.");
        }
      }
      for (let i = 0; i < vaults.length; i += 1) {
        const [governance, configuredPurpose] = await Promise.all([
          read(vaults[i], artifacts.purposeVault, "governance"),
          read(vaults[i], artifacts.purposeVault, "purpose")
        ]);
        if (
          String(governance).toLowerCase() !== protocolGovernance.toLowerCase() ||
          String(configuredPurpose).toLowerCase() !== purpose(PURPOSES[i]).toLowerCase()
        ) throw new Error("Purpose vault verification failed.");
      }

      current.verified = true;
      persist(current);
      setBalance(await publicClient.getBalance({ address }));
      setEstimate(undefined);
      setStatus("Mainnet stack verified — not yet published");
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Deployment paused safely");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${deployment.verified ? "complete" : error ? "failed" : "idle"}`}>
        <span className="status-dot" />
        <strong>{status}</strong>
      </div>

      <div className="deployment-rules">
        <p><strong>One-time operator task:</strong> creators never deploy this infrastructure or pay this gas.</p>
        <p><strong>Governance:</strong> any two of RMTMain, Robinhood Wallet, and Phantom must approve controlled actions.</p>
        <p><strong>Safety:</strong> a 24-hour delay protects protocol-purpose funds. The factory and rewards emergency paths require two signers.</p>
      </div>

      <div className="deployment-addresses">
        <p><span>Required operator</span><code>{short(OPERATOR)}</code></p>
        {address && <p><span>Connected wallet</span><code>{short(address)}</code></p>}
        {balance !== undefined && <p><span>Mainnet ETH balance</span><code>{formatEther(balance)}</code></p>}
        {estimate !== undefined && <p><span>Next approval, estimated maximum</span><code>{formatEther(estimate)} ETH</code></p>}
        <p><span>Verified contracts</span><code>{completed} / {addressSteps.length}</code></p>
      </div>

      {isConnected && !isOperator && (
        <p className="deployment-error">Wrong wallet connected. Switch to RMTMain: {OPERATOR}</p>
      )}
      {error && <p className="deployment-error">{error}</p>}

      {completed > 0 && (
        <div className="deployment-addresses">
          {addressSteps.map(([key, label]) => {
            const value = deployment.addresses[key];
            return value ? (
              <p key={key}>
                <span>{label}</span>
                <a href={`${robinhoodChain.blockExplorers.default.url}/address/${value}`} target="_blank" rel="noreferrer">
                  <code>{short(value)}</code>
                </a>
              </p>
            ) : null;
          })}
        </div>
      )}

      <button
        className="deploy-stack-button"
        disabled={!isConnected || !isOperator || !walletClient || !publicClient || busy || deployment.verified}
        onClick={run}
      >
        {deployment.verified
          ? "Mainnet stack verified"
          : busy
            ? status
            : completed > 0
              ? "Resume reviewed deployment"
              : "Begin reviewed mainnet deployment"}
      </button>
      <p className="deployment-safety">
        Each transaction is shown in your wallet before approval. Completed steps are saved in this browser.
        Never enter a private key or recovery phrase.
      </p>
    </section>
  );
}
