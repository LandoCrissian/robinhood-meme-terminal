import type { Metadata } from "next";
import { launchTerms } from "../../lib/launch-terms";
export const metadata: Metadata = { title: "Risk Disclosures | RMT Launch" };
export default function Page() {
  return <article className="lpReading lpPolicy"><header className="lpPageHeading"><h1>Risk Disclosures</h1></header>
    <section><h2>Check the creator and contract</h2><p>A wallet signature proves control of an address. Names, avatars, tickers and links are supplied by creators. Check addresses and external destinations before relying on a project’s identity.</p></section>
    <section><h2>Market and liquidity risk</h2><p>Tokens can lose their entire value. Graduation requires 600 million tokens net sold and {launchTerms.graduationBackingEth} ETH of real backing after fees. Sells withdraw backing. A launch can stay on its curve indefinitely. Even after graduation, a trade can move the price substantially in a pool this small.</p></section>
    <section><h2>Fees and settlement</h2><p>The creation fee is 0.0004 ETH plus network gas. The curve trading fee is 1%, shared between the project, operations and reserve. Contract or wallet failures can cause irreversible losses. Current website creation, trading and claims are disabled.</p></section>
    <section><h2>Data delays</h2><p>Chain reorganizations and service outages can delay or change what appears here. Check an earlier transaction’s receipt before considering another submission. L2 observations alone do not establish settlement on Ethereum.</p></section>
  </article>;
}
