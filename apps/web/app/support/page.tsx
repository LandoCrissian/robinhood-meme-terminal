import Link from "next/link";
import { LegalShell } from "../legal-shell";

export default function SupportPage() {
  const supportEmail = process.env.NEXT_PUBLIC_RMT_SUPPORT_EMAIL?.trim() || "launchrmt@gmail.com";

  return (
    <LegalShell eyebrow="HELP & INCIDENTS" title="Support" updated="July 18, 2026">
      <div className="legalNotice"><strong>Never share:</strong> RMT support will never ask for a private key, seed phrase, recovery phrase, remote device access, or an “unlock” payment.</div>
      <h2>Transaction help</h2>
      <p>Before reporting a problem, record the public wallet address, transaction hash, token or market address, device and wallet used, approximate time, and the step that failed. Do not include secrets.</p>
      <h2>Current contact</h2>
      <p>Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. Include “RMT support” and the transaction hash in the subject. This is a project inbox; do not send wallet secrets or identity documents.</p>
      <h2>Security reports</h2>
      <p>Send sensitive reports privately to the project inbox above with “RMT security” in the subject. Do not publish exploit details, private data, or active attack instructions in a public issue.</p>
      <h2>Suspected incident</h2>
      <p>Stop submitting transactions, disconnect the site from your wallet, preserve transaction hashes and screenshots, and check the <Link href="/status">system-status page</Link>. Revoking an approval does not recover funds already transferred.</p>
      <h2>What support cannot do</h2>
      <p>RMT cannot reverse blockchain transactions, recover seed phrases, access a wallet, guarantee token value, force liquidity, or restore funds lost to a creator, compromised device, malicious approval, or third-party service.</p>
    </LegalShell>
  );
}
