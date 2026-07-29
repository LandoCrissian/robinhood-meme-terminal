import { LegalShell } from "../legal-shell";

export default function TermsPage() {
  return (
    <LegalShell eyebrow="MAINNET BETA" title="Terms of Use" updated="July 29, 2026">
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
      <p>V6 applies the displayed fee percentages to actual trading fees. Before graduation, fees are paid in ETH. After graduation, the locked position may earn ETH and the launched token; token-denominated fees are trading fees, not extra supply, creator inventory, or liquidity principal. Post-graduation fees accrue until someone calls the permissionless collection function. Fee income, collection timing, and token value are not guaranteed.</p>
      <p>The original launch creator remains permanently recorded and cannot authorize, propose, choose, or directly change the creator-share recipient. The RMT governance signer may propose moving future creator-share payments only to the launch&apos;s immutable V6 governance treasury, or restoring them to the immutable original creator. Every change requires a nonzero public evidence hash and the current replay-protection nonce. After the 24-hour delay, any account may relay the exact approved call, but cannot alter it or receive funds. Treasury nonce invalidation also requires delayed governance approval. This is not an immediate freeze: fees collected before the redirect executes still go to the prior recipient, and paid or deferred fees cannot be clawed back. This authority cannot seize purchased tokens, alter token ownership, or remove locked liquidity, but governance compromise or misuse remains a material risk.</p>
      <p>The official V6 RMT relaunch creates a new token contract, address, and fixed one-billion-token supply. The legacy token address is an identity and provenance anchor only; old holder balances are not copied, swapped, or migrated. Name and ticker uniqueness applies to origin-verified RMT V6 launches. RMT cannot prevent unrelated ERC-20 deployments or direct use of older immutable contracts outside the V6 terminal.</p>
      <p>After graduation, the splitter divides only LP fees actually collected from the canonical RMT pool. Fees may arrive in ETH, the launched token, or both depending on swap direction; token-denominated fees are not a creator allocation or newly minted supply. Independent pools are outside this mechanism. Any separate PoolManager protocol fee is removed upstream before the remaining LP fees reach the RMT splitter.</p>
      <h2>6. RMT Live community</h2>
      <p>RMT Live is a public, moderated community surface. You may not post scams, impersonation, harassment, threats, unlawful or infringing material, spam, personal or confidential information, coordinated market manipulation, deceptive promotion, malicious links, or content intended to compromise a wallet or device. Never request or share recovery words or private keys. Do not present community commentary as guaranteed results or professional advice.</p>
      <p>RMT may rate-limit, hide, review, retain temporarily, or remove community content and may temporarily restrict an identity to protect users and infrastructure. Moderation and automated filters cannot identify every harmful message and do not endorse content that remains visible. Reports and feedback do not authorize a trade, change token rankings, establish a partnership, or require RMT to implement a request.</p>
      <h2>7. Beta functionality</h2>
      <p>The mainnet release is beta software and has not completed an independent security audit. Features may fail, be delayed, or change through the disclosed version-registry process. Existing token, market, fee-splitter, and liquidity contracts are not rewritten by a future factory version.</p>
      <h2>8. Third-party services</h2>
      <p>Wallets, RPC providers, block explorers, IPFS gateways, DEX infrastructure, DEX Screener, hosting providers, and linked websites are independent services with their own risks and terms. RMT is not responsible for their availability or conduct.</p>
      <h2>9. No warranties</h2>
      <p>RMT is provided “as is” and “as available,” to the maximum extent permitted by law. No guarantee is made that contracts, interfaces, pricing, indexing, metadata, or third-party infrastructure are error-free, secure, or continuously available.</p>
      <h2>10. Limitation of liability</h2>
      <p>To the maximum extent permitted by law, RMT contributors and operators are not liable for indirect, incidental, special, consequential, or punitive damages, lost profits, lost tokens, lost keys, failed transactions, exploits, market losses, or third-party failures arising from use of the software.</p>
      <h2>11. Changes and contact</h2>
      <p>These terms may be updated as the beta changes. Material revisions will update the date above. Use the Support page for current contact and incident-reporting instructions.</p>
    </LegalShell>
  );
}
