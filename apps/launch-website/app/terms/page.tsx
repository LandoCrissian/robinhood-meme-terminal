import type { Metadata } from "next";

export const metadata: Metadata = { title: "Preview Terms | RMT Launch" };

export default function TermsPage() {
  return <>
    <header className="lpPageHeading"><div><h1>Preview Terms</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Read-only website preview</h2>
      <p>The sample launches and draft terms are for review. Wallet connections, token creation, trading and fee claims are unavailable on this website.</p>
      <p>RMT is independent software and is unaffiliated with Robinhood Markets, Inc. The preview provides product information and does not provide investment, legal or tax advice.</p>
    </section>
  </>;
}
