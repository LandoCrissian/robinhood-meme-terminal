import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Sushi Integration Proposal · RMT",
  description: "Review RMT's live Robinhood Chain launchpad and its research proposal for a future safety-reviewed Sushi integration.",
  alternates: { canonical: "/sushi" },
  openGraph: {
    title: "RMT Sushi integration proposal",
    description: "RMT V6 is live on Robinhood Chain. No Sushi execution or liquidity is active in production; this page documents the proposed research path.",
    url: "/sushi",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: "RMT Sushi integration proposal",
    description: "RMT V6 is live on Robinhood Chain. Sushi execution and liquidity are not enabled in production.",
    images: ["/brand/rmt-master-logo.png"]
  }
};

const checks = [
  ["01", "Live RMT origin", "Native RMT V6 controls require an active launch recorded by the canonical factory.", "LIVE"],
  ["02", "Native RMT trade", "Curve buy and sell execution is live; graduation uses RMT's canonical V4 adapter path.", "LIVE"],
  ["03", "Sushi deployments", "Pinned Sushi source publishes Robinhood V3 and RedSnwapper addresses.", "SOURCE PINNED"],
  ["04", "Production architecture", "A separate V3 liquidity and execution design still needs to be defined and reviewed.", "RESEARCH"],
  ["05", "Review + deployment", "Contract and app work, security review, liquidity and a production release are not complete.", "NOT ENABLED"]
] as const;

const officialToken = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671";
const officialMarket = "0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee";
const rmtFactory = "0x8E75C57079a01ce2094bc4187B78710887547651";
const sushiFactory = "0xE51960F1B45f1C9Fb6D166e6A884f866fc70433B";
const sushiPositionManager = "0x51D0E5188Afe12D502e29d982D20c190e7816107";
const sushiRedSnwapper = "0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A";
const explorer = "https://robinhoodchain.blockscout.com/address/";
const sushiSource = "https://github.com/sushi-labs/sushi/blob/f3be96d13f5cca54589b0509c46bb8bdb2583f03/src/evm/config/features";

export default function SushiIntegrationPage() {
  return (
    <main className="sushiLabPage">
      <section className="sushiLabHero">
        <div className="sushiLabHeroCopy">
          <p className="eyebrow">LIVE RMT V6 · SUSHI INTEGRATION PROPOSAL · NO PRODUCTION SUSHI EXECUTION</p>
          <h1>A live Robinhood Chain launchpad, ready for Sushi&apos;s review.</h1>
          <p>RMT V6 is live for fixed-supply launches and wallet-confirmed curve trades. We are seeking Sushi&apos;s technical guidance on a separate production V3 liquidity path and a safe RedSnwapper execution boundary.</p>
          <div className="sushiLabActions">
            <Link className="sushiLabPrimary" href={`/token/${officialToken}?launch=0#trade`}>Inspect live RMT market</Link>
            <Link href="/status">Verify system health</Link>
            <a href="https://github.com/sushi-labs/sushi/issues/501" target="_blank" rel="noreferrer">Open engineering questions ↗</a>
          </div>
        </div>
        <div className="sushiLabPulse" aria-label="RMT product and Sushi research status">
          <div className="sushiLabPulseTop"><span><i aria-hidden="true" />MAINNET PRODUCT LIVE</span><b>RHC 4663</b></div>
          <strong>LIVE</strong>
          <p>RMT V6 product status</p>
          <small>Sushi integration is a proposal, not a production feature.</small>
        </div>
      </section>

      <section className="sushiLabStatus" aria-label="Integration status">
        <div><small>RMT MAINNET</small><strong>LIVE</strong><span>Origin-verified V6</span></div>
        <div><small>PUBLIC LAUNCHES</small><strong>OPEN</strong><span>Fair Start available</span></div>
        <div><small>SUSHI QUOTE PREVIEW</small><strong className="held">OFF</strong><span>Production-disabled</span></div>
        <div><small>SUSHI SWAPS / LIQUIDITY</small><strong className="held">NONE</strong><span>Not enabled</span></div>
      </section>

      <section className="sushiFairLaunch">
        <div className="sushiSectionHeading">
          <p className="eyebrow">ONCHAIN LAUNCH SIGNALS</p>
          <h2>Evidence users can inspect—never a fairness guarantee.</h2>
          <p>In July 18 posts, Sushi managing director Alex McCurry described support for fair-launched Robinhood Chain projects. Those posts are not published program rules and do not confirm RMT eligibility.</p>
        </div>
        <div className="sushiFairSignals">
          <div><span>01</span><strong>Fixed supply</strong><p>No post-launch mint, proxy upgrade, blacklist or transfer tax.</p></div>
          <div><span>02</span><strong>Native origin</strong><p>Every native RMT V6 trading control checks the active factory record.</p></div>
          <div><span>03</span><strong>Onchain heuristics</strong><p>RMT surfaces activity, liquidity, origin and automated risk signals where available.</p></div>
          <div><span>04</span><strong>Wallet authority</strong><p>Users retain their keys and confirm transactions; protocol contracts hold disclosed market assets.</p></div>
        </div>
        <p className="sushiFairCaveat">These controls cannot prove fair distribution or prevent every bundle, Sybil strategy or manipulation attempt. No Sushi reward, eligibility, selection or distribution is promised; users should not trade or launch to qualify for an unconfirmed reward.</p>
        <div className="sushiFairActions"><Link href="/explore">Explore live markets</Link><a href="https://x.com/alexmccurryo/status/2078524547435770102" target="_blank" rel="noreferrer">Read Alex McCurry&apos;s fair-launch post ↗</a><a href="https://x.com/alexmccurryo/status/2078520305836781981" target="_blank" rel="noreferrer">Read the July incentive announcement ↗</a></div>
      </section>

      <section className="sushiLabWorkspace">
        <div className="sushiLabFlow">
          <header><div><p className="eyebrow">RMT RESEARCH TRACK</p><h2>What is live, sourced and still missing</h2></div><span>RMT&apos;s status, not Sushi approval</span></header>
          <ol>{checks.map(([number, title, detail, status], index) => <li className={index >= 3 ? "pending" : "complete"} key={number}><span>{number}</span><div><strong>{title}</strong><p>{detail}</p></div><b>{status}</b></li>)}</ol>
        </div>

        <aside className="sushiLabRail">
          <section className="sushiLabAsk">
            <p className="eyebrow">READY FOR SUSHI REVIEW</p>
            <h2>The ask is specific, but not small.</h2>
            <p>Confirm executor and rotation provenance, the supported expiry guard, and a production V3 architecture for launchpad tokens. We also need written July eligibility and submission rules. Any Sushi integration would be a separate reviewed release.</p>
            <Link href="/rescue">Inspect the isolated, valueless testnet rehearsal →</Link>
            <small>ABI-compatible research fixture; not an official Sushi deployment.</small>
          </section>
          <section className="sushiLabBoundary">
            <p className="eyebrow">OFFICIAL SUSHI CONFIG</p>
            <dl>
              <div><dt>Network</dt><dd>Robinhood Chain</dd></div>
              <div><dt>Chain ID</dt><dd>4663</dd></div>
              <div><dt>V3 factory</dt><dd><a aria-label={`Inspect V3 factory ${sushiFactory} in pinned Sushi source`} href={`${sushiSource}/sushiswap-v3.ts`} target="_blank" rel="noreferrer">0xE519…433B ↗</a></dd></div>
              <div><dt>Position manager</dt><dd><a aria-label={`Inspect position manager ${sushiPositionManager} in pinned Sushi source`} href={`${sushiSource}/sushiswap-v3.ts`} target="_blank" rel="noreferrer">0x51D0…6107 ↗</a></dd></div>
              <div><dt>RedSnwapper</dt><dd><a aria-label={`Inspect RedSnwapper ${sushiRedSnwapper} in pinned Sushi source`} href={`${sushiSource}/red-snwapper.ts`} target="_blank" rel="noreferrer">0x8E6f…E98A ↗</a></dd></div>
              <div><dt>Execution</dt><dd className="held">Disabled</dd></div>
            </dl>
          </section>
        </aside>
      </section>

      <section className="sushiLiveProof">
        <div className="sushiSectionHeading"><p className="eyebrow">LIVE RMT MAINNET PROOF</p><h2>Inspect the product, not a pitch deck.</h2><p>Every address below is live on Robinhood Chain mainnet. They prove the RMT product—not a Sushi route, Sushi pool or Sushi approval.</p></div>
        <div className="sushiProofRows">
          <a href={`${explorer}${officialToken}`} target="_blank" rel="noreferrer"><small>OFFICIAL RMT V6 TOKEN</small><strong>{officialToken}</strong><span>Open explorer ↗</span></a>
          <a href={`${explorer}${officialMarket}`} target="_blank" rel="noreferrer"><small>LIVE RMT MARKET</small><strong>{officialMarket}</strong><span>Open explorer ↗</span></a>
          <a href={`${explorer}${rmtFactory}`} target="_blank" rel="noreferrer"><small>ACTIVE V6 FACTORY</small><strong>{rmtFactory}</strong><span>Open explorer ↗</span></a>
        </div>
      </section>

      <section className="sushiLabPromise">
        <p className="eyebrow">WHY THIS MATTERS</p>
        <h2>RMT is live. Sushi remains a proposal.</h2>
        <p>RMT markets use their own curve trading and canonical V4 graduation path today. A future Sushi path would require a defined architecture, contract and app changes, security review, liquidity and a separate deployment.</p>
        <div><Link href={`/token/${officialToken}?launch=0#trade`}>Inspect live RMT</Link><Link href="/status">Verify production</Link><a href={`${sushiSource}/red-snwapper.ts`} target="_blank" rel="noreferrer">Inspect pinned Sushi source ↗</a></div>
      </section>

      <p className="sushiLabDisclosure">Robinhood Meme Terminal is independent, unaffiliated software and does not claim sponsorship, endorsement or an approved partnership with Sushi or Robinhood. RMT V6 is an unaudited mainnet beta. No production Sushi routing or liquidity is enabled, and no incentive eligibility or token value is promised. Launching and trading can result in loss.</p>
      <SiteFooter />
    </main>
  );
}
