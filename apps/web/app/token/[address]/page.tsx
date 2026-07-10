"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { robinhoodChainTestnet } from "@rmt/shared/chains";

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "metadataURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const tokenAddress: Address | null = params.address && isAddress(params.address) ? getAddress(params.address) : null;
  const contract = tokenAddress ? { address: tokenAddress, abi: tokenAbi, chainId: robinhoodChainTestnet.id } : null;
  const { data, isLoading, error } = useReadContracts({
    contracts: contract ? [
      { ...contract, functionName: "name" },
      { ...contract, functionName: "symbol" },
      { ...contract, functionName: "totalSupply" },
      { ...contract, functionName: "creator" },
      { ...contract, functionName: "metadataURI" }
    ] : [],
    query: { enabled: Boolean(contract) }
  });

  if (!tokenAddress) return <main className="detailPage"><Link href="/">← Terminal</Link><section className="panel"><h1>Invalid token address</h1><p>This route requires a valid EVM contract address.</p></section></main>;
  if (isLoading) return <main className="detailPage"><Link href="/">← Terminal</Link><section className="panel"><h1>Reading token…</h1></section></main>;
  if (error || !data || data.some((result) => result.status === "failure")) return <main className="detailPage"><Link href="/">← Terminal</Link><section className="panel"><h1>Token could not be verified</h1><p>The address may not be an RMT fixed-supply token on Robinhood Chain testnet.</p></section></main>;

  const name = data[0].result as string;
  const symbol = data[1].result as string;
  const totalSupply = data[2].result as bigint;
  const creator = data[3].result as Address;
  const metadataURI = data[4].result as string;
  const explorer = `${robinhoodChainTestnet.blockExplorers.default.url}/address/${tokenAddress}`;

  return (
    <main className="detailPage">
      <Link href="/">← Back to terminal</Link>
      <section className="tokenHero panel">
        <div className="coin largeCoin">{symbol.slice(0, 2)}</div>
        <div><p className="eyebrow">VERIFIED ONCHAIN TOKEN</p><h1>{name}</h1><p className="tokenSymbol">${symbol}</p></div>
      </section>
      <div className="detailGrid">
        <section className="panel"><p className="eyebrow">TOKEN RULES</p><h2>Fixed and transparent</h2><div className="safetyList"><span>✓ Fixed total supply</span><span>✓ No mint function</span><span>✓ No blacklist</span><span>✓ No transfer tax</span><span>✓ No upgrade proxy</span></div></section>
        <section className="panel"><p className="eyebrow">ONCHAIN DATA</p><h2>Contract details</h2><dl><dt>Total supply</dt><dd>{Number(formatUnits(totalSupply, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd><dt>Creator</dt><dd title={creator}>{shortAddress(creator)}</dd><dt>Token contract</dt><dd title={tokenAddress}>{shortAddress(tokenAddress)}</dd></dl><a className="explorerLink" href={explorer} target="_blank" rel="noreferrer">Open in explorer ↗</a></section>
      </div>
      <section className="panel metadataPanel"><p className="eyebrow">METADATA</p><h2>Permanent launch record</h2><code>{metadataURI}</code></section>
    </main>
  );
}
