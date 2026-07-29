import { LegalShell } from "../legal-shell";

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="DATA TRANSPARENCY" title="Privacy Notice" updated="July 28, 2026">
      <div className="legalNotice"><strong>Core principle:</strong> RMT never asks for or stores private keys or recovery phrases.</div>
      <h2>Information visible onchain</h2>
      <p>Wallet addresses, token launches, trades, balances, approvals, reward claims, contract interactions, and transaction hashes are public blockchain data. That information may be permanent and can be analyzed by anyone.</p>
      <h2>Information handled by the interface</h2>
      <p>When you connect a wallet, the interface reads its public address, network, balances, positions, and claimable rewards. This information is used to render the requested experience and is not treated as a secret.</p>
      <h2>Profiles and Google sign-in</h2>
      <p>RMT offers optional profile sign-in through Google and Firebase Authentication. Google and Firebase may process account, device, network, and diagnostic information under their own privacy terms. RMT uses the Firebase user identifier to keep each cloud profile separate. RMT does not write your Google email address or profile photo into its Firestore profile document.</p>
      <p>If you sign in, the display name, handle, desk note, terminal preferences, and watched token addresses you choose in RMT are synchronized to a Firebase workspace accessible only to that signed-in account under RMT’s database rules. Wallet connection and profile sign-in are separate; signing in does not grant transaction authority.</p>
      <p>If you create an RMT invite, its permanent code and verified activation count are stored in the same private workspace. A referred account stores one private claim after that user signs in and saves a protected profile. RMT does not count invite-link clicks, expose referral relationships publicly, or enable referral rewards in this release.</p>
      <h2>Device-local information</h2>
      <p>Profile preferences and watchlists are also stored in your browser so the terminal can work before or without sign-in. After a visitor explicitly accepts an invite, its valid code and acceptance time remain in that browser for up to 30 days so the user can choose whether to sign in and complete an activation. Watchlist alert rules remain only in that browser and are evaluated only while the watchlist page is open; they are not synchronized or delivered as background notifications. Signing out stops cloud access but leaves local copies on the device. Clearing this site’s browser data removes them. Wallet applications may separately retain connection permissions under their own privacy policies.</p>
      <h2>RMT Live and guest identities</h2>
      <p>RMT Live may create a persistent anonymous Firebase identity so a guest can participate without publishing a profile. Public messages show a pseudonymous guest label, not the Firebase identifier, email, wallet address, IP address, or device identifier. RMT privately retains the minimum identity mapping and moderation history needed to rate-limit abuse, enforce restrictions, and investigate reports. Public rooms are not private communications. Do not share recovery words, private keys, personal information, or confidential material.</p>
      <p>While the RMT Live panel is open, RMT may refresh a short-lived private presence record. The interface receives only an approximate aggregate count of recently active community identities. Presence records do not contain a public wallet, email, display name, or raw Firebase identifier, cannot be read by browser clients, expire from the active count automatically, and are not presented as site-wide analytics or an exact real-time roster.</p>
      <h2>Uploads and permanent metadata</h2>
      <p>Token artwork, creator-project logos, banners, galleries, update images, descriptions, and social links may be uploaded to IPFS through an external pinning provider. Creator media uploads require a verified profile assigned to that project. IPFS content may be public, copied, and difficult or impossible to remove. Do not upload personal, confidential, or unlawful information.</p>
      <h2>Infrastructure data</h2>
      <p>Hosting, database, authentication, RPC, wallet-connection, security, and content-delivery providers may process IP address, device, request, and diagnostic information to deliver and protect their services. RMT does not sell personal information.</p>
      <h2>External market data and links</h2>
      <p>External market results are supplied by DEX Screener and link to third-party websites. Block explorers, wallets, DEXs, and social links have their own privacy practices. Review them before continuing.</p>
      <h2>Access and deletion requests</h2>
      <p>You can edit terminal preferences at any time. To reduce impersonation and rapid identity switching, changes to display name, handle, and desk note receive a 10-minute correction window and then a 24-hour protection period. To request deletion of the associated cloud profile, use the private project contact on the Support page from the same email account used to sign in. Public blockchain and IPFS records cannot be deleted by RMT.</p>
      <h2>Children and restricted users</h2>
      <p>RMT is not intended for anyone under 18. Do not use the service if local law prohibits access to blockchain trading or token-creation tools.</p>
      <h2>Questions</h2>
      <p>Use the Support page for the current privacy contact. Never send a private key, seed phrase, or recovery phrase in a support request.</p>
    </LegalShell>
  );
}
