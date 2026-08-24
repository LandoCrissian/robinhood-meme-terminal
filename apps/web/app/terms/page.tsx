import { LegalShell } from "../legal-shell";

export default function TermsPage() {
  return (
    <LegalShell eyebrow="MAINNET BETA" title="Terms of Use" updated="August 11, 2026">
      <div className="legalNotice"><strong>Important:</strong> Robinhood Meme Terminal is experimental, non-custodial software. It is not Robinhood Markets, Inc., is not endorsed by Robinhood, and does not provide investment, legal, or tax advice.</div>
      <h2>1. Acceptance and eligibility</h2>
      <p>By accessing or using RMT, you agree to these terms. You must be at least 18 years old, legally capable of entering this agreement, and permitted to use blockchain software in your jurisdiction. Do not use RMT where doing so would violate applicable law, sanctions, or restrictions.</p>
      <h2>2. Non-custodial software</h2>
      <p>RMT does not hold your funds, private keys, or recovery phrases. Your wallet creates and signs transactions. Blockchain transactions are generally irreversible. You are solely responsible for your wallet, network selection, transaction details, gas, slippage, approvals, and destination addresses.</p>
      <h2>3. Tokens and trading</h2>
      <p>Tokens are highly speculative and may lose all value. Trading a token does not create ownership in RMT or any legal entity. RMT does not endorse tokens merely because they appear in a directory, search result, provider observation, or selected-asset workspace.</p>
      <h2>4. Market information</h2>
      <p>Canonical evidence, provider observations, prices, liquidity, volume, metadata, social links, risk flags, and rankings may be partial, delayed, inconsistent, or wrong. Missing information is not proof of safety or danger. RMT informs; the trader decides.</p>
      <h2>5. Fees and execution</h2>
      <p>Any RMT execution fee must be disclosed before signing and represented in the wallet-visible protected economics. Network gas and independent provider or liquidity-pool fees are separate. Quotes, simulations, approvals, failed swaps, and ordinary transfers do not settle an RMT trade fee unless an expressly authorized policy states otherwise.</p>
      <p>Market visibility does not guarantee wallet execution. RMT may keep a provider quote-only unless it can construct and independently verify a technically correct transaction, including chain, assets, amount, recipient, protected output, target, calldata, and any applicable fee settlement.</p>
      <h2>6. Beta functionality</h2>
      <p>The mainnet release is beta software and has not completed an independent security audit. Features may fail, be delayed, or change through the disclosed version-registry process. Existing token, market, fee-splitter, and liquidity contracts are not rewritten by a future factory version.</p>
      <p>Watchlist and phone alerts are optional informational tools. Delivery can be delayed, duplicated, suppressed by a daily limit, or missed because of network, device, market-data, hosting, carrier, or provider conditions. An alert does not monitor every transaction, guarantee an exit, execute a trade, or replace reviewing current market and wallet state.</p>
      <h2>7. Third-party services</h2>
      <p>Wallets, RPC providers, block explorers, IPFS gateways, DEX infrastructure, DEX Screener, hosting providers, and linked websites are independent services with their own risks and terms. RMT is not responsible for their availability or conduct.</p>
      <h2>8. No warranties</h2>
      <p>RMT is provided “as is” and “as available,” to the maximum extent permitted by law. No guarantee is made that contracts, interfaces, pricing, indexing, metadata, or third-party infrastructure are error-free, secure, or continuously available.</p>
      <h2>9. Limitation of liability</h2>
      <p>To the maximum extent permitted by law, RMT contributors and operators are not liable for indirect, incidental, special, consequential, or punitive damages, lost profits, lost tokens, lost keys, failed transactions, exploits, market losses, or third-party failures arising from use of the software.</p>
      <h2>10. Changes and contact</h2>
      <p>These terms may be updated as the beta changes. Material revisions will update the date above. Use the Support page for current contact and incident-reporting instructions.</p>
    </LegalShell>
  );
}
