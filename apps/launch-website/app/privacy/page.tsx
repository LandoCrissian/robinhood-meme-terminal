import type { Metadata } from "next";

export const metadata: Metadata = { title: "Website Privacy | RMT Launch" };

export default function PrivacyPage() {
  return <>
    <header className="lpPageHeading"><div><h1>Website Privacy</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Information handled by this website</h2>
      <p>The launch search filters verified records in your browser. This website does not request wallet addresses, signatures, private keys or recovery phrases.</p>
      <p>The hosting provider may process standard network and request data to deliver and secure the website.</p>
    </section>
  </>;
}
