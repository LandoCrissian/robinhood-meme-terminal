import { LegalShell } from "../legal-shell";

export default function TermsPage() {
  return (
    <LegalShell eyebrow="MAINNET BETA" title="Terms of Use" updated="July 13, 2026">
      <div className="legalNotice"><strong>Important:</strong> Robinhood Meme Terminal is experimental, non-custodial software. It is not Robinhood Markets, Inc., is not endorsed by Robinhood, and does not provide investment, legal, or tax advice.</div>
      <h2>1. Acceptance and eligibility</h2>
      <p>By accessing or using RMT, you agree to these terms. You must be at least 18 years old, legally capable of entering this agreement, and permitted to use blockchain software in your jurisdiction. Do not use RMT where doing so would violate applicable law, sanctions, or restrictions.</p>
      <h2>2. Non-custodial software</h2>
      <p>RMT does not hold your funds, private keys, or recovery phrases. Your wallet creates and signs transactions. Blockchain transactions are generally irreversible. You are solely responsible for your wallet, network selection, transaction details, gas, slippage, approvals, and destination addresses.</p>
      <h2>3. Tokens and trading</h2>
      <p>Meme tokens are highly speculative and may lose all value. Creating or trading a token does not create ownership in RMT or any legal entity. RMT does not endorse tokens merely because they appear in a feed, search result, external-market section, or token page.</p>
      <h2>4. Creator responsibilities</h2>
      <p>Creators must have rights to submitted names, artwork, descriptions, and links. You may not create deceptive, infringing, unlawful, impersonating, or malicious content. Onchain launches and IPFS content may be permanent and publicly visible.</p>
      <h2>5. Fees and rewards</h2>
      <p>Applicable launch costs, curve fees, reward splits, and gas estimates are presented before signing where available. Network gas can change. Creator or community rewards depend on actual activity and are not guaranteed income, yield, or return.</p>
      <h2>6. Beta functionality</h2>
      <p>The mainnet release is beta software and has not completed an independent security audit. Features may fail, be delayed, or change through the disclosed version-registry process. Existing token, market, vault, and liquidity contracts are not rewritten by a future factory version.</p>
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
