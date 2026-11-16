import type { Metadata } from "next";

export const metadata: Metadata = { title: "Website Terms | RMT Launch" };

export default function TermsPage() {
  return <>
    <header className="lpPageHeading"><div><h1>Website Terms</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Read-only website</h2>
      <p>Launch terms remain proposed. You can prepare and review a draft locally. Wallet connections, token creation, trading and fee claims are unavailable on this website.</p>
      <p>RMT is independent software and is unaffiliated with Robinhood Markets, Inc. The website provides product information and does not provide investment, legal or tax advice.</p>
    </section>
  </>;
}
