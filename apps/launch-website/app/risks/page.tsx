import type { Metadata } from "next";
export const metadata: Metadata = { title: "Risk Disclosures | RMT Launch" };
export default function Page() {
  return <article className="lpReading lpPolicy"><header className="lpPageHeading"><h1>Risk Disclosures</h1></header>
    <section><h2>Check the creator and contract</h2><p>A wallet signature proves control of an address. Names, avatars, tickers and links are supplied by creators. Check addresses and external destinations before relying on a project’s identity.</p></section>
    <section><h2>Market and liquidity risk</h2><p>Tokens can lose their entire value. A launch record confirms registration at a particular block. It does not establish demand, a current price or liquidity. The launch design reserves 400 million tokens for liquidity and sets a 2 ETH graduation target. Graduation is conditional.</p></section>
    <section><h2>Fees and settlement</h2><p>The creation fee is 0.0004 ETH plus network gas. The curve trading fee is 1%, shared between the project, operations and reserve. Contract or wallet failures can cause irreversible losses. Current website creation, trading and claims are disabled.</p></section>
    <section><h2>Data delays</h2><p>Chain reorganizations and service outages can delay or change what appears here. Check an earlier transaction’s receipt before considering another submission. L2 observations alone do not establish settlement on Ethereum.</p></section>
  </article>;
}
