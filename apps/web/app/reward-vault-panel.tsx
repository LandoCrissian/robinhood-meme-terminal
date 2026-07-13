"use client";

import { formatEther, type Address, type Hash } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { useFactoryAddress } from "../lib/use-factory-address";
import { useLaunchRecord } from "../lib/use-launch-record";

const rewardVaultAbi = [
  { type: "function", name: "recipients", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "rewardBps", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "claimable", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalReceived", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] }
] as const;

const labels = ["Creator", "Community", "Trader rewards", "Graduation liquidity", "Platform"] as const;
const fallbackAddress = "0x0000000000000000000000000000000000000000" as const;

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function RewardVaultPanel({ tokenAddress }: { tokenAddress: Address }) {
  const factoryAddress = useFactoryAddress();
  const launchRecord = useLaunchRecord(tokenAddress);
  const vaultAddress = launchRecord.data?.rewardVault ?? null;
  const lookupError = launchRecord.error ? (launchRecord.error instanceof Error ? launchRecord.error.message : "Unable to locate reward vault.") : launchRecord.isSuccess && !launchRecord.data ? "No factory launch record was found for this token." : null;
  const { address: account } = useAccount();
  const { writeContract, data: claimHash, isPending: isClaimPending, error: claimError } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: claimConfirmed } = useWaitForTransactionReceipt({ hash: claimHash, chainId: robinhoodChainTestnet.id });


  const address = vaultAddress ?? fallbackAddress;
  const enabled = Boolean(vaultAddress);
  const common = { address, abi: rewardVaultAbi, chainId: robinhoodChainTestnet.id, query: { enabled, refetchInterval: 10_000 } } as const;
  const totalReceivedRead = useReadContract({ ...common, functionName: "totalReceived" });
  const totalClaimedRead = useReadContract({ ...common, functionName: "totalClaimed" });
  const recipientReads = [0n, 1n, 2n, 3n, 4n].map((index) => useReadContract({ ...common, functionName: "recipients", args: [index] }));
  const splitReads = [0n, 1n, 2n, 3n, 4n].map((index) => useReadContract({ ...common, functionName: "rewardBps", args: [index] }));
  const claimableRead = useReadContract({ address, abi: rewardVaultAbi, chainId: robinhoodChainTestnet.id, functionName: "claimable", args: [account ?? fallbackAddress], query: { enabled: enabled && Boolean(account), refetchInterval: 10_000 } });

  const loading = [totalReceivedRead, totalClaimedRead, ...recipientReads, ...splitReads].some((read) => read.isLoading);
  const totalReceived = totalReceivedRead.data ?? 0n;
  const totalClaimed = totalClaimedRead.data ?? 0n;
  const claimable = claimableRead.data ?? 0n;

  function claim() {
    if (!vaultAddress || claimable === 0n) return;
    writeContract({ address: vaultAddress, abi: rewardVaultAbi, functionName: "claim", chainId: robinhoodChainTestnet.id });
  }

  if (!factoryAddress) return <section className="panel rewardDashboard"><p className="eyebrow">REWARD VAULT</p><h2>Awaiting factory deployment</h2><p>The reward dashboard activates after the verified testnet factory address is configured.</p></section>;
  if (lookupError) return <section className="panel rewardDashboard"><p className="eyebrow">REWARD VAULT</p><h2>Vault unavailable</h2><p>{lookupError}</p></section>;
  if (!vaultAddress || loading) return <section className="panel rewardDashboard"><p className="eyebrow">REWARD VAULT</p><h2>Reading reward accounting…</h2></section>;

  const explorer = `${robinhoodChainTestnet.blockExplorers.default.url}/address/${vaultAddress}`;
  const txExplorer = (hash: Hash) => `${robinhoodChainTestnet.blockExplorers.default.url}/tx/${hash}`;

  return (
    <section className="panel rewardDashboard">
      <div className="sectionTitle"><div><p className="eyebrow">REWARD VAULT</p><h2>Transparent fee distribution</h2></div><span className="badge liveBadge">ONCHAIN</span></div>
      <div className="rewardTotals"><div><small>Total received</small><strong>{Number(formatEther(totalReceived)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH</strong></div><div><small>Total claimed</small><strong>{Number(formatEther(totalClaimed)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH</strong></div></div>
      <div className="allocationList">{labels.map((label, index) => { const recipient = recipientReads[index].data; const split = splitReads[index].data ?? 0; if (Number(split) === 0) return null; return <div key={label}><div><strong>{label}</strong><span>{Number(split) / 100}%</span></div><small title={recipient}>{recipient ? shortAddress(recipient) : "Unavailable"}</small></div>; })}</div>
      <div className="callout"><strong>Graduation reserves stay in the market</strong><span>They are not a discretionary reward-vault balance and cannot be claimed here.</span></div>
      <div className="claimBox"><div><small>Your claimable rewards</small><strong>{account ? `${Number(formatEther(claimable)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH` : "Connect wallet"}</strong></div><button disabled={!account || claimable === 0n || isClaimPending || isClaimConfirming} onClick={claim}>{isClaimPending ? "Confirm in wallet…" : isClaimConfirming ? "Confirming…" : "Claim rewards"}</button></div>
      {claimError && <div className="errors"><span>{claimError.message}</span></div>}
      {claimHash && <div className="callout"><strong>{claimConfirmed ? "Claim confirmed" : "Claim submitted"}</strong><a href={txExplorer(claimHash)} target="_blank" rel="noreferrer">View transaction ↗</a></div>}
      <a className="explorerLink" href={explorer} target="_blank" rel="noreferrer">Open reward vault in explorer ↗</a>
    </section>
  );
}
