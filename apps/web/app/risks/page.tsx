import { LegalShell } from "../legal-shell";

export default function RisksPage() {
  return (
    <LegalShell eyebrow="READ BEFORE SIGNING" title="Risk Disclosures" updated="July 13, 2026">
      <div className="legalNotice danger"><strong>Mainnet beta:</strong> RMT contracts have extensive automated tests but have not yet received an independent security audit. A successful smoke test is not proof that the system is risk-free.</div>
      <h2>Loss of funds</h2>
      <p>You can lose all ETH or tokens used through RMT. Meme tokens can become illiquid, fall rapidly, fail to graduate, or trade at prices materially different from estimates.</p>
      <h2>Smart-contract risk</h2>
      <p>Contracts can contain unknown defects, economic weaknesses, rounding issues, integration failures, or exploitable assumptions. Immutability can make some failures difficult or impossible to reverse.</p>
      <h2>Graduation and liquidity risk</h2>
      <p>Graduation has passed automated and mainnet-fork validation, but no live public token has completed the full production migration yet. Network congestion, DEX behavior, hook or adapter failure, price movement, or liquidity conditions may affect migration and post-graduation trading.</p>
      <h2>Market and execution risk</h2>
      <p>Quotes can change before confirmation. Slippage, price impact, frontrunning, sandwiching, failed transactions, gas spikes, and wallet delays may produce a different outcome than expected.</p>
      <h2>Creator and token risk</h2>
      <p>Standardized token contracts reduce certain technical risks but do not prove a creator is honest, competent, or legally authorized. Social links, artwork, names, external claims, and community activity may be false or manipulated.</p>
      <h2>External-market risk</h2>
      <p>Tokens shown from external DEX data were not launched, scored, or verified by RMT. Liquidity and volume filters do not establish safety, legitimacy, or future availability.</p>
      <h2>Wallet and phishing risk</h2>
      <p>Only approve transactions you understand. Verify the network, contract, amount, gas, and minimum received. RMT will never request your private key or recovery phrase. Malicious browser extensions, copied websites, compromised devices, and fake support accounts can steal assets.</p>
      <h2>Regulatory and tax risk</h2>
      <p>Laws and tax treatment vary and can change. You are responsible for determining whether creating, buying, selling, receiving rewards, or providing liquidity is lawful and reportable in your jurisdiction.</p>
      <h2>Operational risk</h2>
      <p>RPC providers, hosting, wallets, IPFS, block explorers, price sources, indexers, and DEX infrastructure can be unavailable, delayed, inconsistent, or compromised. Interface downtime does not stop contracts that remain available onchain.</p>
    </LegalShell>
  );
}
