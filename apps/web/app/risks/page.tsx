import { LegalShell } from "../legal-shell";

export default function RisksPage() {
  return (
    <LegalShell eyebrow="READ BEFORE SIGNING" title="Risk Disclosures" updated="July 16, 2026">
      <div className="legalNotice danger"><strong>Mainnet beta:</strong> RMT contracts have extensive automated tests but have not yet received an independent security audit. A successful smoke test is not proof that the system is risk-free.</div>
      <h2>Loss of funds</h2>
      <p>You can lose all ETH or tokens used through RMT. Meme tokens can become illiquid, fall rapidly, fail to graduate, or trade at prices materially different from estimates.</p>
      <h2>Smart-contract risk</h2>
      <p>Contracts can contain unknown defects, economic weaknesses, rounding issues, integration failures, or exploitable assumptions. Immutability can make some failures difficult or impossible to reverse.</p>
      <h2>Graduation and liquidity risk</h2>
      <p>RMT V6 is deployed and its existing official market remains live, but new token creation is closed because RMT&apos;s current product is the terminal, not a launchpad. Successful deployment and smoke checks do not guarantee that every market path will operate without interruption. Network congestion, DEX behavior, hook or adapter failure, price movement, and liquidity conditions may affect trading.</p>
      <p>V6 clamps the final curve buy to the exact net graduation target. If an excess-payment refund cannot be delivered, it remains a payer-owned onchain claim. Forced ETH, unsolicited tokens, and pool-seeding dust are intentionally excluded from liquidity and fee distribution and may remain permanently locked.</p>
      <h2>Market and execution risk</h2>
      <p>Quotes can change before confirmation. Slippage, price impact, frontrunning, sandwiching, failed transactions, gas spikes, and wallet delays may produce a different outcome than expected.</p>
      <h2>Creator and token risk</h2>
      <p>Standardized token contracts reduce certain technical risks but do not prove a creator is honest, competent, or legally authorized. Social links, artwork, names, external claims, and community activity may be false or manipulated.</p>
      <h2>Creator-fee governance risk</h2>
      <p>Creators cannot authorize, propose, choose, or directly change a V6 fee recipient. The RMT governance signer can propose redirecting future creator-share payments only to the immutable V6 governance treasury, or restoring the original creator, using public evidence and a replay-protection nonce. Any account may relay the exact approved call after the 24-hour delay, but cannot alter it or receive funds. Treasury nonce invalidation also requires delayed governance approval. A redirect is not an immediate freeze: fees collected before execution still go to the prior recipient, and paid or deferred rewards cannot be clawed back. Intervention is discretionary and is not promised. V6 governance starts with one RMTMain signer, a 24-hour delay, and a seven-day execution window. A future signer must prove control and give expiring consent to the exact add-or-replace action, affected signer, threshold, and current configuration epoch, and may revoke unconsumed consent before execution. Adding the first extra wallet creates 2-of-2 governance, not a backup key: both signers are then required for future proposals, and losing either can freeze governance. Signer/threshold changes are atomic, multi-signer 1-of-N is prohibited, and every configuration change invalidates older pending proposals. Cancellation is guaranteed before maturity, but after maturity cancellation and execution can race for transaction ordering. Governance compromise or signer loss remains a material risk.</p>
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
