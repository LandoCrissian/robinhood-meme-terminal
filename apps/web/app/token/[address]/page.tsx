"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { RewardVaultPanel } from "../../reward-vault-panel";
import { MarketPanel } from "../../market-panel";
import { WalletButton } from "../../wallet-button";

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "metadataURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

const fallbackAddress = "0x0000000000000000000000000000000000000000" as const;

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const tokenAddress: Address | null = params.address && isAddress(params.address) ? getAddress(params.address) : null;
  const address = tokenAddress ?? fallbackAddress;
  const enabled = Boolean(tokenAddress);
  const common = { address, abi: tokenAbi, chainId: robinhoodChainTestnet.id, query: { enabled } } as const;
  const nameRead = useReadContract({ ...common, functionName: "name" });
  const symbolRead = useReadContract({ ...common, functionName: "symbol" });
  const supplyRead = useReadContract({ ...common, functionName: "totalSupply" });
  const creatorRead = useReadContract({ ...common, functionName: "creator" });
  const metadataRead = useReadContract({ ...common, functionName: "metadataURI" });

  if (!tokenAddress) return <main className="detailPage"><Link href="/">← Terminal</Link><section className="panel"><h1>Invalid token address</h1><p>This route requires a valid EVM contract address.</p></section></main>;

  const reads = [nameRead, symbolRead, supplyRead, creatorRead, metadataRead];
  if (reads.some((read) => read.isLoading)) return <main className="detailPage"><Link href="/">← Terminal</Link><section className="panel"><h1>Reading token…</h1></section></main>;
  if (reads.some((read) => read.error) || nameRead.data === undefined || symbolRead.data === undefined || supplyRead.data === undefined || creatorRead.data === undefined || metadataRead.data === undefined) return <main className="detailPage"><Link href="/">← Terminal</Link><section className="panel"><h1>Token could not be verified</h1><p>The address may not be an RMT fixed-supply token on Robinhood Chain testnet.</p></section></main>;

  const explorer = `${robinhoodChainTestnet.blockExplorers.default.url}/address/${tokenAddress}`;

  return (
    <main className="detailPage">
      <div className="detailNav"><Link href="/">← Back to terminal</Link><WalletButton /></div>
      <section className="tokenHero panel">
        <div className="coin largeCoin">{symbolRead.data.slice(0, 2)}</div>
        <div><p className="eyebrow">VERIFIED ONCHAIN TOKEN</p><h1>{nameRead.data}</h1><p className="tokenSymbol">${symbolRead.data}</p></div>
      </section>
      <div className="detailGrid">
        <section className="panel"><p className="eyebrow">TOKEN RULES</p><h2>Fixed and transparent</h2><div className="safetyList"><span>✓ Fixed total supply</span><span>✓ No mint function</span><span>✓ No blacklist</span><span>✓ No transfer tax</span><span>✓ No upgrade proxy</span></div></section>
        <section className="panel"><p className="eyebrow">ONCHAIN DATA</p><h2>Contract details</h2><dl><dt>Total supply</dt><dd>{Number(formatUnits(supplyRead.data, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd><dt>Creator</dt><dd title={creatorRead.data}>{shortAddress(creatorRead.data)}</dd><dt>Token contract</dt><dd title={tokenAddress}>{shortAddress(tokenAddress)}</dd></dl><a className="explorerLink" href={explorer} target="_blank" rel="noreferrer">Open in explorer ↗</a></section>
      </div>
      <MarketPanel tokenAddress={tokenAddress} symbol={symbolRead.data} />
      <RewardVaultPanel tokenAddress={tokenAddress} />
      <section className="panel metadataPanel"><p className="eyebrow">METADATA</p><h2>Permanent launch record</h2><code>{metadataRead.data}</code></section>
    </main>
  );
}
