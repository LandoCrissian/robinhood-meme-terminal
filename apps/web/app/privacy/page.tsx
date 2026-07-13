import { LegalShell } from "../legal-shell";

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="DATA TRANSPARENCY" title="Privacy Notice" updated="July 13, 2026">
      <div className="legalNotice"><strong>Core principle:</strong> RMT never asks for or stores private keys or recovery phrases.</div>
      <h2>Information visible onchain</h2>
      <p>Wallet addresses, token launches, trades, balances, approvals, reward claims, contract interactions, and transaction hashes are public blockchain data. That information may be permanent and can be analyzed by anyone.</p>
      <h2>Information handled by the interface</h2>
      <p>When you connect a wallet, the interface reads its public address, network, balances, positions, and claimable rewards. This information is used to render the requested experience and is not treated as a secret.</p>
      <h2>Device-local information</h2>
      <p>Watchlists are stored in your browser’s local storage. They are not synchronized to an RMT account. Clearing browser data removes them. Wallet applications may separately retain connection permissions under their own privacy policies.</p>
      <h2>Uploads and permanent metadata</h2>
      <p>Token artwork, descriptions, and social links may be uploaded to IPFS through an external pinning provider. IPFS content may be public, copied, and difficult or impossible to remove. Do not upload personal, confidential, or unlawful information.</p>
      <h2>Infrastructure data</h2>
      <p>Hosting, RPC, wallet-connection, security, and content-delivery providers may process IP address, device, request, and diagnostic information to deliver and protect their services. RMT does not currently operate user accounts or sell personal information.</p>
      <h2>External market data and links</h2>
      <p>External market results are supplied by DEX Screener and link to third-party websites. Block explorers, wallets, DEXs, and social links have their own privacy practices. Review them before continuing.</p>
      <h2>Children and restricted users</h2>
      <p>RMT is not intended for anyone under 18. Do not use the service if local law prohibits access to blockchain trading or token-creation tools.</p>
      <h2>Questions</h2>
      <p>Use the Support page for the current privacy contact. Never send a private key, seed phrase, or recovery phrase in a support request.</p>
    </LegalShell>
  );
}
