import type { Metadata } from "next";

export const metadata: Metadata = { title: "Website Terms | RMT Launch" };

export default function TermsPage() {
  return <>
    <header className="lpPageHeading"><div><h1>Website Terms</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Launchpad and account access</h2>
      <p>You can prepare and review a token draft locally. Token creation, trading and fee claims remain disabled in this preview. Enabling an account or signing in does not authorize a blockchain transaction.</p>
      <p>Where account services are enabled, wallet connection and a separate sign-in message let you manage a creator profile. Profile names, artwork and links are creator-provided; they do not establish token safety, endorsement or a change in project ownership.</p>
      <p>Do not use profiles to impersonate others, phish for wallet access, or publish illegal or abusive content. Official names are reserved. Profile fields and HTTPS links have technical validation; those checks do not prevent every form of abuse or verify a project&apos;s claims.</p>
      <p>RMT is independent software and is unaffiliated with Robinhood Markets, Inc. The website provides product information and does not provide investment, legal or tax advice.</p>
    </section>
  </>;
}
