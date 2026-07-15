import { LegalShell } from "../legal-shell";

export default function RisksPage() {
  return (
    <LegalShell eyebrow="READ BEFORE SIGNING" title="Risk Disclosures" updated="July 14, 2026">
      <div className="legalNotice danger"><strong>Mainnet beta:</strong> RMT contracts have extensive automated tests but have not yet received an independent security audit. A successful smoke test is not proof that the system is risk-free.</div>
      <h2>Loss of funds</h2>
      <p>You can lose all ETH or tokens used through RMT. Meme tokens can become illiquid, fall rapidly, fail to graduate, or trade at prices materially different from estimates.</p>
      <h2>Smart-contract risk</h2>
      <p>Contracts can contain unknown defects, economic weaknesses, rounding issues, integration failures, or exploitable assumptions. Immutability can make some failures difficult or impossible to reverse.</p>
      <h2>Graduation and liquidity risk</h2>
      <p>The deployed V5 path has historical automated and mainnet-fork evidence. The final V6 candidate must pass its own complete fork rehearsal and release gates before activation. No live public token has completed the full production V6 migration. Network congestion, DEX behavior, hook or adapter failure, price movement, or liquidity conditions may affect migration and post-graduation trading.</p>
      <p>V6 clamps the final curve buy to the exact net graduation target. If an excess-payment refund cannot be delivered, it remains a payer-owned onchain claim. Forced ETH, unsolicited tokens, and pool-seeding dust are intentionally excluded from liquidity and fee distribution and may remain permanently locked.</p>
      <h2>Market and execution risk</h2>
      <p>Quotes can change before confirmation. Slippage, price impact, frontrunning, sandwiching, failed transactions, gas spikes, and wallet delays may produce a different outcome than expected.</p>
      <h2>Creator and token risk</h2>
      <p>Standardized token contracts reduce certain technical risks but do not prove a creator is honest, competent, or legally authorized. Social links, artwork, names, external claims, and community activity may be false or manipulated.</p>
      <h2>Creator-fee governance risk</h2>
      <p>Creators cannot initiate, accept, or execute a V6 fee-recipient change. Only delayed RMT governance can redirect future creator-share payments to the immutable RMT treasury or restore the original creator, using public evidence and a replay-protection nonce. The RMT treasury can invalidate a stale unexecuted nonce but cannot select another recipient. Intervention is discretionary and is not promised. A compromised or misused governance signer could still interrupt future creator-fee payments within those limits. Paid and deferred rewards cannot be clawed back. V6 governance starts with one RMTMain signer, a 24-hour delay, and a seven-day execution window. A future signer must prove control and give expiring consent to the exact add-or-replace action, affected signer, threshold, and current configuration epoch, and may revoke unconsumed consent before execution. Adding the first extra wallet creates 2-of-2 governance, not a backup key: both signers are then required for future proposals, and losing either can freeze governance. Signer/threshold changes are atomic, multi-signer 1-of-N is prohibited, and every configuration change invalidates older pending proposals. Approved calls may be relayed by anyone after the delay without changing their contents; cancellation is guaranteed before maturity, but after maturity cancellation and execution can race for transaction ordering. Governance compromise or signer loss remains a material risk.</p>
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
