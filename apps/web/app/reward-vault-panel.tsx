"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { getFactoryAddress, memeLaunchFactoryAbi } from "../lib/contracts";

const rewardVaultAbi = [
  { type: "function", name: "recipients", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "rewardBps", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "claimable", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalReceived", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] }
] as const;

const labels = ["Creator", "Community", "Trader rewards", "Graduation liquidity", "Platform"] as const;

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function RewardVaultPanel({ tokenAddress }: { tokenAddress: Address }) {
  const factoryAddress = getFactoryAddress();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { address: account } = useAccount();
  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const { writeContract, data: claimHash, isPending: isClaimPending, error: claimError } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: claimConfirmed } = useWaitForTransactionReceipt({ hash: claimHash, chainId: robinhoodChainTestnet.id });

  useEffect(() => {
    let cancelled = false;
    async function findVault() {
      if (!factoryAddress || !publicClient) return;
      try {
        const latestBlock = await publicClient.getBlockNumber();
        const configuredStart = process.env.NEXT_PUBLIC_FACTORY_START_BLOCK;
        const fromBlock = configuredStart && /^\d+$/.test(configuredStart) ? BigInt(configuredStart) : latestBlock > 20_000n ? latestBlock - 20_000n : 0n;
        const logs = await publicClient.getContractEvents({
          address: factoryAddress,
          abi: memeLaunchFactoryAbi,
          eventName: "TokenLaunched",
          args: { token: tokenAddress },
          fromBlock,
          toBlock: "latest",
          strict: true
        });
        if (!cancelled) {
          const match = logs[0];
          setVaultAddress(match?.args.rewardVault ?? null);
          setLookupError(match ? null : "No factory launch record was found for this token.");
        }
      } catch (error) {
        if (!cancelled) setLookupError(error instanceof Error ? error.message : "Unable to locate reward vault.");
      }
    }
    void findVault();
    return () => { cancelled = true; };
  }, [factoryAddress, publicClient, tokenAddress]);

  const contracts = useMemo(() => {
    if (!vaultAddress) return [];
    const base = { address: vaultAddress, abi: rewardVaultAbi, chainId: robinhoodChainTestnet.id } as const;
    return [
      { ...base, functionName: "totalReceived" },
      { ...base, functionName: "totalClaimed" },
      ...labels.flatMap((_, index) => [
        { ...base, functionName: "recipients", args: [BigInt(index)] },
        { ...base, functionName: "rewardBps", args: [BigInt(index)] }
      ]),
      ...(account ? [{ ...base, functionName: "claimable", args: [account] }] : [])
    ] as const;
  }, [account, vaultAddress]);

  const reads = useReadContracts({ contracts, query: { enabled: contracts.length > 0, refetchInterval: 10_000 } });
  const data = reads.data;
  const totalReceived = data?.[0]?.status === "success" ? data[0].result as bigint : 0n;
  const totalClaimed = data?.[1]?.status === "success" ? data[1].result as bigint : 0n;
  const allocations = labels.map((label, index) => {
    const recipientResult = data?.[2 + index * 2];
    const bpsResult = data?.[3 + index * 2];
    return {
      label,
      recipient: recipientResult?.status === "success" ? recipientResult.result as Address : null,
      bps: bpsResult?.status === "success" ? Number(bpsResult.result) : 0
    };
  });
  const claimableResult = account ? data?.[12] : undefined;
  const claimable = claimableResult?.status === "success" ? claimableResult.result as bigint : 0n;

  function claim() {
    if (!vaultAddress || claimable === 0n) return;
    writeContract({ address: vaultAddress, abi: rewardVaultAbi, functionName: "claim", chainId: robinhoodChainTestnet.id });
  }

  if (!factoryAddress) return <section className="panel rewardDashboard"><p className="eyebrow">REWARD VAULT</p><h2>Awaiting factory deployment</h2><p>The reward dashboard activates after the verified testnet factory address is configured.</p></section>;
  if (lookupError) return <section className="panel rewardDashboard"><p className="eyebrow">REWARD VAULT</p><h2>Vault unavailable</h2><p>{lookupError}</p></section>;
  if (!vaultAddress || reads.isLoading) return <section className="panel rewardDashboard"><p className="eyebrow">REWARD VAULT</p><h2>Reading reward accounting…</h2></section>;

  const explorer = `${robinhoodChainTestnet.blockExplorers.default.url}/address/${vaultAddress}`;
  const txExplorer = (hash: Hash) => `${robinhoodChainTestnet.blockExplorers.default.url}/tx/${hash}`;

  return (
    <section className="panel rewardDashboard">
      <div className="sectionTitle"><div><p className="eyebrow">REWARD VAULT</p><h2>Transparent fee distribution</h2></div><span className="badge liveBadge">ONCHAIN</span></div>
      <div className="rewardTotals"><div><small>Total received</small><strong>{Number(formatEther(totalReceived)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH</strong></div><div><small>Total claimed</small><strong>{Number(formatEther(totalClaimed)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH</strong></div></div>
      <div className="allocationList">{allocations.map((allocation) => <div key={allocation.label}><div><strong>{allocation.label}</strong><span>{allocation.bps / 100}%</span></div><small title={allocation.recipient ?? undefined}>{allocation.recipient ? shortAddress(allocation.recipient) : "Unavailable"}</small></div>)}</div>
      <div className="claimBox"><div><small>Your claimable rewards</small><strong>{account ? `${Number(formatEther(claimable)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH` : "Connect wallet"}</strong></div><button disabled={!account || claimable === 0n || isClaimPending || isClaimConfirming} onClick={claim}>{isClaimPending ? "Confirm in wallet…" : isClaimConfirming ? "Confirming…" : "Claim rewards"}</button></div>
      {claimError && <div className="errors"><span>{claimError.message}</span></div>}
      {claimHash && <div className="callout"><strong>{claimConfirmed ? "Claim confirmed" : "Claim submitted"}</strong><a href={txExplorer(claimHash)} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      <a className="explorerLink" href={explorer} target="_blank" rel="noreferrer">Open reward vault in explorer ↗</a>
    </section>
  );
}
