import type { Metadata } from "next";

export const metadata: Metadata = { title: "Risk Disclosures | RMT Launch" };

export default function RisksPage() {
  return <>
    <header className="lpPageHeading"><div><h1>Risk Disclosures</h1></div></header>
    <section className="lpPanel lpForm">
      <h2>Review evidence</h2>
      <p>Sample projects have no live tokens, pools or market history. Graduation parameters and fees remain provisional. The contract release candidate is pending independent security review.</p>
      <h2>Blockchain risks</h2>
      <p>Tokens can lose all value. Pricing, contract, liquidity, wallet and infrastructure failures may be irreversible. Check the network and exact address before relying on an asset’s identity.</p>
    </section>
  </>;
}
