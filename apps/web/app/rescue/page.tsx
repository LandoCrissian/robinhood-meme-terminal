import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Liquidity Rescue Lab · RMT",
  description: "Testnet-only research into consolidating voluntarily supplied liquidity into one Robinhood Chain WETH market.",
  alternates: { canonical: "/rescue" }
};

const flow = [
  ["01", "Opt in externally", "The owner exits the old LP position outside RMT and voluntarily supplies an approved settlement asset."],
  ["02", "Normalize", "A proposed, separately reviewed source adapter converts only supported assets into a verified route."],
  ["03", "Bridge direct", "Each approved source would move straight to Robinhood Chain—never through a daisy-chain of bridges."],
  ["04", "Verify the route", "The future adapter asserts authorization; the vault enforces its bound source, cap, refund beneficiary and replay key."],
  ["05", "Pair once", "A future concrete seeder would pair credited assets with canonical WETH on Robinhood Chain through fixed custody."]
] as const;

export default function LiquidityRescuePage() {
  return (
    <main className="rescueLabPage">
      <section className="rescueHero">
        <div>
          <p className="eyebrow">RMT RESEARCH LAB · TESTNET ONLY · NO REAL FUNDS</p>
          <h1>Dead liquidity.<br /><span>One living market.</span></h1>
          <p>Liquidity Rescue explores how voluntarily migrated capital could consolidate into one market paired with canonical WETH on Robinhood Chain.</p>
          <p className="rescueScope"><strong>What exists now:</strong> an isolated testnet-only accounting vault. Bridge adapters, the concrete Sushi seeder, price protection and contributor rights are not implemented. Do not deposit real-value assets.</p>
          <div className="rescueActions">
            <a className="rescuePrimary" href="#proposed-flow">Review the proposed flow ↓</a>
            <Link href="/sushi">Open Sushi lab</Link>
          </div>
        </div>
        <div className="rescueOrbit" aria-label="Liquidity Rescue architecture">
          <span className="rescueOrbitLabel">SOURCE CHAINS</span>
          <div className="rescueNodes"><i /><i /><i /><i /><i /></div>
          <div className="rescueCore"><small>DESTINATION</small><strong>RHC</strong><span>WETH HUB</span></div>
          <p>Many proposed sources.<br />One target pair.</p>
        </div>
      </section>

      <section className="rescueStrip" aria-label="Prototype status">
        <div><small>CONTRACT</small><strong>TESTNET ONLY</strong><span>Bytecode blocks mainnet</span></div>
        <div><small>ACCOUNTING</small><strong>SNAPSHOT</strong><span>Exact credited amounts</span></div>
        <div><small>REFUNDS</small><strong>CLAIM BASED</strong><span>Cancellation or expiry</span></div>
        <div><small>INTEGRATIONS</small><strong className="rescueHeld">UNBUILT</strong><span>Adapters + seeder required</span></div>
      </section>

      <section id="proposed-flow" className="rescueBody">
        <div className="rescueFlow">
          <header><p className="eyebrow">PROPOSED FLYWHEEL</p><h2>Consolidate directly without daisy-chaining bridges.</h2></header>
          <ol>{flow.map(([number, title, detail]) => <li key={number}><span>{number}</span><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ol>
        </div>
        <aside className="rescueBoundaries">
          <p className="eyebrow">NON-NEGOTIABLE</p>
          <h2>Permission before movement.</h2>
          <ul>
            <li>No abandoned-looking funds are claimed.</li>
            <li>No generic bridge or arbitrary-call adapter.</li>
            <li>No duplicate token deployed per platform.</li>
            <li>No real deposits before contributor rights exist.</li>
            <li>No mainnet release without independent review.</li>
          </ul>
          <div className="rescuePair"><span>PAIR TARGET</span><strong>RMT ASSET</strong><b>＋</b><strong>RHC WETH</strong></div>
        </aside>
      </section>

      <section className="rescueStatement">
        <p className="eyebrow">WHY ROBINHOOD CHAIN</p>
        <h2>Use L2 efficiency to gather liquidity—not divide it again.</h2>
        <p>The proposed model routes every approved source directly into the destination vault. The prototype can move only a paused snapshot of credited balances through fixed seeder and custodian addresses. Those external components remain trusted and unimplemented, and credits do not yet grant post-pairing ownership rights. Cancellation or expiry only enables contributors to claim their credited assets before finalization.</p>
        <div><Link href="/runners">Explore RMT markets</Link><Link href="/risks">Read RMT risks</Link></div>
      </section>

      <p className="rescueDisclosure">Liquidity Rescue is undeployed, unaudited, Robinhood Chain testnet-only research. It does not guarantee that an old position can be withdrawn, bridged, valued, recovered, or profitably redeployed. The generic vault cannot verify a Sushi position or custodian ownership, and contributor ownership after pairing has not been designed. RMT is independent software and does not claim endorsement by Sushi or Robinhood.</p>
      <SiteFooter />
    </main>
  );
}
