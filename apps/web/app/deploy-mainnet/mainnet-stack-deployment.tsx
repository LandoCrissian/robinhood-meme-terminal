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
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const LEGACY_FACTORY = "0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4" as Address;
const STORAGE_KEY = "rmt:mainnet-stack:v5";
const DAY = 86_400n;
const HOOK_FLAGS = 0x2880n;
const HOOK_MASK = 0x3fffn;
const INITIAL_VIRTUAL_ETH_RESERVE = parseEther("0.3");
const INITIAL_VIRTUAL_TOKEN_RESERVE = parseEther("1017500000");
const GRADUATION_TARGET = parseEther("2");

const PURPOSES = [
  "PROTOCOL_TREASURY",
  "BUYBACK_RESERVE",
  "GRADUATION_ASSISTANCE",
  "REFERRAL_RESERVE",
  "ECOSYSTEM_GROWTH"
] as const;

type Artifact = { abi: Abi; bytecode: Hex };
type ArtifactName = "governance" | "purposeVault" | "hook" | "adapter" | "revenueRouter" | "rewardsController" | "factory" | "market" | "registry";
type AddressKey =
  | "governance"
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
  ["governance", "Expandable governance"],
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

function errorCode(cause: unknown) {
  let current = cause;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === 4001) return 4001;
    current = candidate.cause;
  }
  return undefined;
}

function describeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (errorCode(cause) === 4001) {
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

  async function prepareGas(data: Hex, to?: Address, reviewedFallbackGas?: bigint) {
    if (!publicClient || !address) throw new Error("Mainnet provider is unavailable.");
    let buffered: bigint;
    try {
      const gas = await publicClient.estimateGas({ account: address, data, ...(to ? { to } : {}) });
      buffered = gas * 115n / 100n;
    } catch (cause) {
      if (!reviewedFallbackGas) throw cause;
      buffered = reviewedFallbackGas;
      setStatus("RPC estimate unavailable — using reviewed hook gas limit");
    }
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
    if (!salt || !expected) throw new Error("A valid V5 hook address could not be found.");

    if (!(await hasCode(expected))) {
      setStatus("Approve: Uniswap V4 graduation hook");
      const data = concat([salt, initCode]);
      // Robinhood's public RPC can reject this canonical CREATE2 estimate before MetaMask opens.
      // The exact call is exercised in the mainnet-fork release gate; the limit caps execution,
      // while the wallet only pays gas actually consumed.
      const gas = await prepareGas(data, CREATE2_DEPLOYER, 8_000_000n);
      const hash = await walletClient.sendTransaction({
        account: address,
        chain: robinhoodChain,
        to: CREATE2_DEPLOYER,
        data,
        gas
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("V5 hook deployment failed.");
      current.transactions.hook = hash;
    }
    if (!(await hasCode(expected))) throw new Error("V5 hook bytecode could not be verified.");
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

      if (!(await hasCode(LEGACY_FACTORY))) throw new Error(`The protected legacy identity factory is missing at ${LEGACY_FACTORY}.`);

      const governance = await deployContract(
        current,
        "governance",
        artifacts.governance,
        [OPERATOR, DAY],
        "single-wallet expandable governance"
      );

      const vaultKeys: AddressKey[] = ["treasuryVault", "buybackVault", "graduationVault", "referralVault", "ecosystemVault"];
      const vaults: Address[] = [];
      for (let i = 0; i < PURPOSES.length; i += 1) {
        vaults.push(await deployContract(current, vaultKeys[i], artifacts.purposeVault, [governance, purpose(PURPOSES[i])], PURPOSES[i].toLowerCase().replaceAll("_", " ")));
      }

      const hook = await deployHook(current);
      const adapter = await deployContract(current, "adapter", artifacts.adapter, [POOL_MANAGER, hook, 10_000, 200], "graduation adapter");
      if (String(await read(hook, artifacts.hook, "adapter")).toLowerCase() !== adapter.toLowerCase()) {
        await sendCall(current, "bindHookAdapter", hook, artifacts.hook, "bindAdapter", [adapter], "bind hook to adapter");
      }

      const recipients = vaults as [Address, Address, Address, Address, Address];
      const revenueRouter = await deployContract(current, "revenueRouter", artifacts.revenueRouter, [recipients], "protocol revenue router");
      const rewardsController = await deployContract(current, "rewardsController", artifacts.rewardsController, [OPERATOR, governance, DAY], "rewards controller");
      const factory = await deployContract(
        current,
        "factory",
        artifacts.factory,
        [adapter, 100, INITIAL_VIRTUAL_ETH_RESERVE, INITIAL_VIRTUAL_TOKEN_RESERVE, GRADUATION_TARGET, rewardsController, revenueRouter, LEGACY_FACTORY],
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
        [governance, 2n * DAY, factory, purpose("RMT_FACTORY_V5")],
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
        read(factory, artifacts.factory, "legacyIdentityFactory"),
        read(factory, artifacts.factory, "SETTLEMENT_VERSION"),
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
        INITIAL_VIRTUAL_ETH_RESERVE,
        INITIAL_VIRTUAL_TOKEN_RESERVE,
        GRADUATION_TARGET,
        LEGACY_FACTORY,
        2n,
        factory,
        governance,
        DAY,
        governance,
        2n * DAY,
        factory,
        purpose("RMT_FACTORY_V5")
      ];
      for (let i = 0; i < checks.length; i += 1) {
        if (String(checks[i]).toLowerCase() !== String(expected[i]).toLowerCase()) {
          throw new Error(`Final binding check ${i + 1} failed. Do not publish this deployment.`);
        }
      }

      const governanceChecks = await Promise.all([
        read(governance, artifacts.governance, "isSigner", [OPERATOR]),
        read(governance, artifacts.governance, "signerCount"),
        read(governance, artifacts.governance, "threshold"),
        read(governance, artifacts.governance, "executionDelay")
      ]);
      if (governanceChecks[0] !== true || governanceChecks[1] !== 1n || governanceChecks[2] !== 1n || governanceChecks[3] !== DAY) {
        throw new Error("Expandable governance verification failed.");
      }

      const marketImplementation = await read(factory, artifacts.factory, "marketImplementation") as Address;
      const fairStartChecks = await Promise.all([
        read(marketImplementation, artifacts.market, "FAIR_START_DELAY_BLOCKS"),
        read(marketImplementation, artifacts.market, "FAIR_START_DURATION_BLOCKS"),
        read(marketImplementation, artifacts.market, "FAIR_START_MAX_TX_BPS"),
        read(marketImplementation, artifacts.market, "FAIR_START_MAX_WALLET_BPS")
      ]);
      const fairStartExpected = [1n, 10n, 100n, 300n];
      for (let i = 0; i < fairStartChecks.length; i += 1) {
        if (String(fairStartChecks[i]) !== String(fairStartExpected[i])) {
          throw new Error(
            `Fair Start verification ${i + 1} failed: expected ${fairStartExpected[i]}, received ${String(fairStartChecks[i])}.`
          );
        }
      }
      for (let i = 0; i < vaults.length; i += 1) {
        const [governance, configuredPurpose] = await Promise.all([
          read(vaults[i], artifacts.purposeVault, "governance"),
          read(vaults[i], artifacts.purposeVault, "purpose")
        ]);
        if (
          String(governance).toLowerCase() !== current.addresses.governance?.toLowerCase() ||
          String(configuredPurpose).toLowerCase() !== purpose(PURPOSES[i]).toLowerCase()
        ) throw new Error("Purpose vault verification failed.");
        const recipient = await read(revenueRouter, artifacts.revenueRouter, "recipients", [BigInt(i)]);
        if (String(recipient).toLowerCase() !== vaults[i].toLowerCase()) {
          throw new Error("Revenue destination verification failed.");
        }
      }

      current.verified = true;
      persist(current);
      setBalance(await publicClient.getBalance({ address }));
      setEstimate(undefined);
      setStatus("V5 deployment verified — ready for site cutover");
    } catch (cause) {
      setError(describeError(cause));
      setStatus("Deployment paused safely");
    } finally {
      setBusy(false);
    }
  }

  async function copyManifest() {
    await navigator.clipboard.writeText(JSON.stringify({
      chainId: robinhoodChain.id,
      version: "RMT_FACTORY_V5",
      operator: OPERATOR,
      ...deployment
    }, null, 2));
    setStatus("Verified deployment manifest copied");
  }

  return (
    <section className="deployment-card">
      <div className={`deployment-status ${deployment.verified ? "complete" : error ? "failed" : "idle"}`}>
        <span className="status-dot" />
        <strong>{status}</strong>
      </div>

      <div className="deployment-rules">
        <p><strong>One-time operator task:</strong> creators never deploy this infrastructure or pay this gas.</p>
        <p><strong>Governance:</strong> RMTMain starts as the only signer. A second signer can be added later through a visible, delayed governance proposal.</p>
        <p><strong>Safety:</strong> a 24-hour delay protects protocol-purpose funds. New launches inherit duplicate-name protection and the lighter Fair Start.</p>
        <p><strong>Graduation:</strong> 2 ETH net reserve targets about a 17.3 ETH implied valuation, with the curve and V4 pool prices aligned. The USD value moves with ETH.</p>
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
          ? "V5 deployment verified"
          : busy
            ? status
            : completed > 0
              ? "Resume reviewed deployment"
              : "Begin corrected V5 deployment"}
      </button>
      {deployment.verified && (
        <button className="deploy-stack-button" onClick={copyManifest}>
          Copy verified deployment manifest
        </button>
      )}
      <p className="deployment-safety">
        Each transaction is shown in your wallet before approval. Completed steps are saved in this browser.
        Never enter a private key or recovery phrase.
      </p>
      {deployment.verified && (
        <p className="deployment-safety">
          Deployment is complete, but launches remain paused until the verified registry address is published in the site configuration.
        </p>
      )}
    </section>
  );
}
