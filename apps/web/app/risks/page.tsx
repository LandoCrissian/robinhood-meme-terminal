import { LegalShell } from "../legal-shell";

export default function RisksPage() {
  return (
    <LegalShell eyebrow="READ BEFORE SIGNING" title="Risk Disclosures" updated="July 16, 2026">
      <div className="legalNotice danger"><strong>Mainnet beta:</strong> RMT contracts have extensive automated tests but have not yet received an independent security audit. A successful smoke test is not proof that the system is risk-free.</div>
      <h2>Loss of funds</h2>
      <p>You can lose all ETH or tokens used through RMT. Tokens can become illiquid, fall rapidly, or trade at prices materially different from estimates.</p>
      <h2>Smart-contract risk</h2>
      <p>Contracts can contain unknown defects, economic weaknesses, rounding issues, integration failures, or exploitable assumptions. Immutability can make some failures difficult or impossible to reverse.</p>
      <h2>Market visibility and liquidity risk</h2>
      <p>A market appearing in the Terminal means RMT has canonical or provider-observed evidence for it. Visibility is not endorsement. Low liquidity, zero recent volume, missing metadata, partial index coverage, or provider disagreement can materially increase risk without erasing the market from discovery.</p>
      <h2>Market and execution risk</h2>
      <p>Quotes can change before confirmation. Slippage, price impact, frontrunning, sandwiching, failed transactions, gas spikes, and wallet delays may produce a different outcome than expected.</p>
      <h2>Creator and token risk</h2>
      <p>Standardized token contracts reduce certain technical risks but do not prove a creator is honest, competent, or legally authorized. Social links, artwork, names, external claims, and community activity may be false or manipulated.</p>
      <h2>External-market risk</h2>
      <p>Provider-observed tokens are not endorsed by RMT. Provider labels, liquidity, volume, social links, and other metadata can be delayed, incomplete, manipulated, or wrong and do not establish safety, ownership, legitimacy, or future availability.</p>
      <h2>Wallet and phishing risk</h2>
      <p>Only approve transactions you understand. Verify the network, contract, amount, gas, and minimum received. RMT will never request your private key or recovery phrase. Malicious browser extensions, copied websites, compromised devices, and fake support accounts can steal assets.</p>
      <h2>Regulatory and tax risk</h2>
      <p>Laws and tax treatment vary and can change. You are responsible for determining whether buying, selling, receiving assets, or providing liquidity is lawful and reportable in your jurisdiction.</p>
      <h2>Operational risk</h2>
      <p>RPC providers, hosting, wallets, IPFS, block explorers, price sources, indexers, and DEX infrastructure can be unavailable, delayed, inconsistent, or compromised. Interface downtime does not stop contracts that remain available onchain.</p>
    </LegalShell>
  );
}
