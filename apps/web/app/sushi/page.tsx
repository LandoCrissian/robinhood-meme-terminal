import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Sushi Trading on Robinhood Chain · RMT",
  description: "Trade qualified Robinhood Chain Sushi markets inside RMT with verified pool matching, decoded calldata, exact approvals, simulation and plain-language risk review.",
  alternates: { canonical: "/sushi" },
  openGraph: {
    title: "Sushi trading is live inside RMT",
    description: "RMT now supports guarded, non-custodial Sushi execution for qualified external Robinhood Chain markets.",
    url: "/sushi",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: "Sushi trading is live inside RMT",
    description: "Guarded, non-custodial Sushi execution for qualified external Robinhood Chain markets.",
    images: ["/brand/rmt-master-logo.png"]
  }
};

const checks = [
  ["01", "Live RMT origin", "Native RMT V6 controls require an active launch recorded by the canonical factory.", "LIVE"],
  ["02", "Native RMT trade", "Curve buy and sell execution is live; graduation uses RMT's canonical V4 adapter path.", "LIVE"],
  ["03", "Sushi deployments", "Pinned Sushi source publishes Robinhood V3 and RedSnwapper addresses.", "SOURCE PINNED"],
  ["04", "Guarded Sushi execution", "RMT validates Sushi calldata, contract bytecode, minimum output and simulation before wallet submission.", "LIVE"],
  ["05", "V7 launch liquidity", "Sushi liquidity for future RMT-native launches remains a separate architecture and security-review track.", "RESEARCH"]
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
          <p className="eyebrow">ROBINHOOD CHAIN · GUARDED SUSHI EXECUTION · LIVE</p>
          <h1>Sushi trading is live inside RMT.</h1>
          <p>Users can now trade qualified external Sushi markets without leaving Terminal. RMT re-verifies the displayed pool, decodes and validates the route, requires simulation, uses exact sell approvals and keeps final authority in the user&apos;s wallet.</p>
          <div className="sushiLabActions">
            <Link className="sushiLabPrimary" href={`/project/${officialToken}?launch=0#trade`}>Inspect live RMT project</Link>
            <Link href="/status">Verify system health</Link>
            <a href="https://github.com/sushi-labs/sushi/issues/501" target="_blank" rel="noreferrer">Open engineering questions ↗</a>
          </div>
        </div>
        <div className="sushiLabPulse" aria-label="RMT product and Sushi research status">
          <div className="sushiLabPulseTop"><span><i aria-hidden="true" />MAINNET PRODUCT LIVE</span><b>RHC 4663</b></div>
          <strong>LIVE</strong>
          <p>RMT V6 product status</p>
          <small>External Sushi trading is live; V7 launch liquidity remains a separate research track.</small>
        </div>
      </section>

      <section className="sushiLabStatus" aria-label="Integration status">
        <div><small>RMT MAINNET</small><strong>LIVE</strong><span>Origin-verified V6</span></div>
        <div><small>NEW RMT LAUNCHES</small><strong className="held">PAUSED</strong><span>V7 preparation</span></div>
        <div><small>SUSHI ROUTES</small><strong>LIVE</strong><span>Validated + simulated</span></div>
        <div><small>V7 SUSHI LIQUIDITY</small><strong className="held">RESEARCH</strong><span>Not deployed</span></div>
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
          <ol>{checks.map(([number, title, detail, status], index) => <li className={index >= 4 ? "pending" : "complete"} key={number}><span>{number}</span><div><strong>{title}</strong><p>{detail}</p></div><b>{status}</b></li>)}</ol>
        </div>

        <aside className="sushiLabRail">
          <section className="sushiLabAsk">
            <p className="eyebrow">READY FOR SUSHI REVIEW</p>
            <h2>The ask is specific, but not small.</h2>
            <p>External execution is live with pinned runtime bytecode and disclosed limitations. The remaining ask is executor provenance, a supported onchain expiry guard, and a reviewed V7 liquidity architecture for future RMT-native launches.</p>
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
              <div><dt>External execution</dt><dd>Live · guarded</dd></div>
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
        <h2>One Terminal. More verified routes.</h2>
        <p>External Sushi markets can now execute inside RMT with visible evidence and wallet control. RMT-native V6 markets still use their own curve and canonical V4 graduation path; future V7 Sushi liquidity remains separate and undeployed.</p>
        <div><Link href={`/project/${officialToken}?launch=0#trade`}>Inspect live RMT</Link><Link href="/status">Verify production</Link><a href={`${sushiSource}/red-snwapper.ts`} target="_blank" rel="noreferrer">Inspect pinned Sushi source ↗</a></div>
      </section>

      <p className="sushiLabDisclosure">Robinhood Meme Terminal is independent, unaffiliated software and does not claim sponsorship, endorsement or an approved partnership with Sushi or Robinhood. External Sushi execution is live through Sushi&apos;s public Robinhood Chain contracts and API; RMT does not custody funds or guarantee token safety. RedSnwapper has no onchain deadline, the current executor is not source-verified on Robinhood Chain, and V7 Sushi liquidity is not deployed. Trading can result in loss.</p>
      <SiteFooter />
    </main>
  );
}
