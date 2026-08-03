"use client";

import { robinhoodChain } from "@rmt/shared/chains";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import {
  concat,
  encodeDeployData,
  getAddress,
  getCreate2Address,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex
} from "viem";
import artifactsJson from "../../../lib/generated/mainnet-stack.json";

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
const FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as Address;
const ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2" as Address;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address;
const SALT = keccak256(toHex("RMT_POSITION_GUARD_EXECUTOR_V1"));

type Artifact = { abi: Abi; bytecode: Hex };
type Stage = "checking" | "ready" | "deploying" | "verifying" | "verified" | "failed";

const artifact = (artifactsJson as Record<string, Artifact>).positionGuardExecutor;
const initCode = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [FACTORY, ROUTER, WETH]
});
const expectedExecutor = getCreate2Address({ from: CREATE2_DEPLOYER, salt: SALT, bytecode: initCode });

function short(value?: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "Not connected";
}

function readableError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/4001|rejected|denied|cancelled/i.test(message)) {
    return "The wallet cancelled the deployment. Nothing was changed onchain.";
  }
  return message || "The executor deployment stopped before verification.";
}

export function PositionGuardReleaseControl() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { switchChainAsync } = useSwitchChain();
  const [stage, setStage] = useState<Stage>("checking");
  const [message, setMessage] = useState("Checking the deterministic executor address…");
  const [transactionHash, setTransactionHash] = useState<Hex>();
  const [estimatedGas, setEstimatedGas] = useState<bigint>();

  const explorer = useMemo(
    () => `${robinhoodChain.blockExplorers.default.url}/address/${expectedExecutor}`,
    []
  );

  async function verify() {
    if (!publicClient) return false;
    setStage("checking");
    setMessage("Verifying the exact release address and immutable dependencies…");
    const [deployerCode, factoryCode, routerCode, wethCode, executorCode] = await Promise.all([
      publicClient.getBytecode({ address: CREATE2_DEPLOYER }),
      publicClient.getBytecode({ address: FACTORY }),
      publicClient.getBytecode({ address: ROUTER }),
      publicClient.getBytecode({ address: WETH }),
      publicClient.getBytecode({ address: expectedExecutor })
    ]);
    if (![deployerCode, factoryCode, routerCode, wethCode].every((code) => code && code !== "0x")) {
      throw new Error("A required Robinhood Chain or Uniswap dependency is unavailable.");
    }
    if (!executorCode || executorCode === "0x") {
      setStage("ready");
      setMessage("Reviewed bytecode is ready. Deployment requires one wallet confirmation and network gas only.");
      return false;
    }
    const [factory, router, weth] = await Promise.all([
      publicClient.readContract({ address: expectedExecutor, abi: artifact.abi, functionName: "factory" }),
      publicClient.readContract({ address: expectedExecutor, abi: artifact.abi, functionName: "router" }),
      publicClient.readContract({ address: expectedExecutor, abi: artifact.abi, functionName: "weth" })
    ]);
    if (
      getAddress(String(factory)) !== getAddress(FACTORY)
      || getAddress(String(router)) !== getAddress(ROUTER)
      || getAddress(String(weth)) !== getAddress(WETH)
    ) throw new Error("The deployed executor does not match the reviewed immutable configuration.");
    setStage("verified");
    setMessage("Ownerless executor verified on Robinhood Chain. It cannot charge fees, change routes or redirect output.");
    return true;
  }

  useEffect(() => {
    void verify().catch((cause) => {
      setStage("failed");
      setMessage(readableError(cause));
    });
  }, [publicClient]);

  async function deploy() {
    if (!address || !walletClient || !publicClient) return;
    setTransactionHash(undefined);
    try {
      if (await verify()) return;
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      setStage("deploying");
      setMessage("Waiting for the wallet to approve the exact ownerless executor deployment…");
      const data = concat([SALT, initCode]);
      const gas = await publicClient.estimateGas({ account: address, to: CREATE2_DEPLOYER, data });
      setEstimatedGas(gas);
      const hash = await walletClient.sendTransaction({
        account: address,
        chain: robinhoodChain,
        to: CREATE2_DEPLOYER,
        data,
        gas: gas * 120n / 100n
      });
      setTransactionHash(hash);
      setStage("verifying");
      setMessage("Deployment submitted. Waiting for Robinhood Chain confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      if (receipt.status !== "success") throw new Error("The deployment transaction reverted.");
      await verify();
    } catch (cause) {
      setStage("failed");
      setMessage(readableError(cause));
    }
  }

  const busy = stage === "checking" || stage === "deploying" || stage === "verifying";

  return (
    <section className="adminActivationSection" aria-labelledby="position-guard-release-title">
      <header className="adminReviewHeader">
        <div>
          <p className="eyebrow">TERMINAL EXECUTION RELEASE</p>
          <h2 id="position-guard-release-title">Live Position Guard</h2>
          <p>Deploy and prove the narrow ownerless executor required for real unattended stop-loss and trailing-profit exits.</p>
        </div>
        <span>{stage.toUpperCase()}</span>
      </header>
      <div className="adminActivationGrid">
        <article className={`adminActivationCard request-${stage === "verified" ? "ready" : stage === "failed" ? "declined" : "reviewing"}`}>
          <header>
            <div><span>EXACT RELEASE</span><h3>RMT Position Guard Executor V1</h3><p>One immutable Uniswap V3 exit path · WETH returns only to the protected wallet</p></div>
            <a href={explorer} target="_blank" rel="noreferrer">Blockscout ↗</a>
          </header>
          <dl className="positionGuardReleaseFacts">
            <div><dt>Expected address</dt><dd>{short(expectedExecutor)}</dd></div>
            <div><dt>Connected wallet</dt><dd>{short(address)}</dd></div>
            <div><dt>Network</dt><dd>Robinhood · 4663</dd></div>
            <div><dt>Cost</dt><dd>{estimatedGas ? `${estimatedGas.toLocaleString()} gas estimated` : "Network gas only"}</dd></div>
          </dl>
          <p className="adminReviewMessage" role="status">{message}</p>
          {transactionHash && <a className="positionGuardReleaseTransaction" href={`${robinhoodChain.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View deployment transaction ↗</a>}
          {stage !== "verified" && <button type="button" className="adminApproveButton" disabled={!isConnected || !walletClient || busy} onClick={() => void deploy()}>
            {!isConnected ? "Connect the RMT wallet" : busy ? "Verifying release…" : "Deploy reviewed executor"}
          </button>}
        </article>
        <article className="adminActivationCard request-ready">
          <header><div><span>HARD BOUNDARIES</span><h3>What this contract can do</h3><p>Only the exact user-authorized token amount can move.</p></div></header>
          <p>It can sell an approved token through the canonical Uniswap V3 router and return WETH to that same wallet. It has no owner, upgrade key, fee switch, treasury route, arbitrary recipient, generic call or withdrawal function.</p>
          <p>Deployment alone grants RMT no access. Every user separately chooses an allowance, protection settings and a policy-scoped Privy signer they can revoke.</p>
        </article>
      </div>
    </section>
  );
}
