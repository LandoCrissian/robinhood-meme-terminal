import type { Metadata } from "next";
export const metadata: Metadata = { title: "Website Terms | RMT Launch" };
export default function Page() {
  return <article className="lpReading lpPolicy"><header className="lpPageHeading"><h1>Website Terms</h1></header>
    <section><h2>Using RMT Launch</h2><p>Browse launches and public creators, manage a wallet-linked profile and prepare a token draft. Website token creation, trading and fee claims are currently disabled. Wallet connection and profile sign-in do not authorize a transaction.</p></section>
    <section><h2>Publishing a profile or image</h2><p>Only upload content you have the right to share. Creators are responsible for their profile details, artwork and links. Impersonation, phishing and illegal or abusive content are prohibited. Official usernames are reserved.</p></section>
    <section><h2>Wallet approvals and fees</h2><p>Review the network, destination, amount and fees in your wallet before approving any future on-chain action. Saving a profile or reviewing a draft has no network fee. Saving token artwork uses a separate gas-free message.</p></section>
    <section><h2>Independent software</h2><p>RMT Launch is independent software and is unaffiliated with Robinhood Markets, Inc. Information on this site is not investment, legal or tax advice.</p></section>
  </article>;
}
