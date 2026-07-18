import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Sushi Integration Lab · RMT",
  description: "See how Robinhood Meme Terminal is preparing safe, native Sushi routing on Robinhood Chain.",
  alternates: { canonical: "/sushi" }
};

const checks = [
  ["01", "Origin", "Only an active, origin-verified RMT V6 launch can request a route."],
  ["02", "Quote", "Sushi provides an indicative Robinhood Chain route through its official API."],
  ["03", "Decode", "RMT verifies the sender, tokens, amounts, recipient, minimum output and native value."],
  ["04", "Pin", "Router, executor, entrypoint and deployed bytecode must match the reviewed boundary."],
  ["05", "Sign", "Locked until an enforceable expiry model and executor provenance are confirmed."]
] as const;

export default function SushiIntegrationPage() {
  return (
    <main className="sushiLabPage">
      <section className="sushiLabHero">
        <div className="sushiLabHeroCopy">
          <p className="eyebrow">SUSHI ROUTING · ROBINHOOD CHAIN · SAFETY GATED</p>
          <h1>Runner discovery meets a route users can understand.</h1>
          <p>RMT is building a native path from market signal to Sushi-powered execution—without redirecting traders and without asking a wallet to trust opaque calldata.</p>
          <div className="sushiLabActions">
            <Link className="sushiLabPrimary" href="/runners">Open Runner Radar</Link>
            <a href="https://github.com/sushi-labs/sushi/issues/501" target="_blank" rel="noreferrer">Engineering request ↗</a>
          </div>
        </div>
        <div className="sushiLabPulse" aria-label="Sushi integration readiness">
          <div className="sushiLabPulseTop"><span><i aria-hidden="true" />INTEGRATION LAB</span><b>RHC 4663</b></div>
          <strong>4<span>/5</span></strong>
          <p>verification layers ready</p>
          <div className="sushiLabMeter"><i /><i /><i /><i /><i className="locked" /></div>
          <small>Execution remains locked by design.</small>
        </div>
      </section>

      <section className="sushiLabStatus" aria-label="Integration status">
        <div><small>QUOTE ADAPTER</small><strong>READY</strong><span>Fail-closed responses</span></div>
        <div><small>ROUTE BOUNDARY</small><strong>PINNED</strong><span>Router + executor code</span></div>
        <div><small>WALLET EXECUTION</small><strong className="held">HELD</strong><span>No unsafe forwarding</span></div>
        <div><small>PRODUCTION</small><strong>HEALTHY</strong><span>Current trading unchanged</span></div>
      </section>

      <section className="sushiLabWorkspace">
        <div className="sushiLabFlow">
          <header><div><p className="eyebrow">THE ROUTE</p><h2>Five checks before one signature</h2></div><span>Every mismatch stops the flow</span></header>
          <ol>{checks.map(([number, title, detail], index) => <li className={index === checks.length - 1 ? "pending" : "complete"} key={number}><span>{number}</span><div><strong>{title}</strong><p>{detail}</p></div><b>{index === checks.length - 1 ? "LOCKED" : "VERIFIED"}</b></li>)}</ol>
        </div>

        <aside className="sushiLabRail">
          <section className="sushiLabAsk">
            <p className="eyebrow">READY FOR SUSHI REVIEW</p>
            <h2>The final mile is specific.</h2>
            <p>RMT is asking Sushi to confirm the canonical executor, its source or deployment registry, and the supported onchain expiry pattern for Robinhood Chain.</p>
            <Link href="/rescue">Inspect the verified testnet rehearsal →</Link>
          </section>
          <section className="sushiLabBoundary">
            <p className="eyebrow">LIVE BOUNDARY</p>
            <dl>
              <div><dt>Network</dt><dd>Robinhood Chain</dd></div>
              <div><dt>Chain ID</dt><dd>4663</dd></div>
              <div><dt>Router</dt><dd title="0x8E6fD69A77e88ee20Ba4B4fBd59DfCDA3EC0E98A">0x8E6f…E98A</dd></div>
              <div><dt>Executor</dt><dd title="0x0e867974275Cd31C25015C2753C9d75F9f355379">0x0e86…5379</dd></div>
              <div><dt>Execution</dt><dd className="held">Disabled</dd></div>
            </dl>
          </section>
        </aside>
      </section>

      <section className="sushiLabPromise">
        <p className="eyebrow">WHY THIS MATTERS</p>
        <h2>Users should not have to choose between speed and knowing what they sign.</h2>
        <p>When the remaining boundary is confirmed, RMT can turn runner discovery into a transparent, Sushi-routed buy or sell inside the terminal. Until then, the safe outcome is no transaction.</p>
        <div><Link href="/">See the live terminal</Link><a href="https://docs.sushi.com/contracts/red-snwapper" target="_blank" rel="noreferrer">Read Sushi’s interface ↗</a></div>
      </section>

      <p className="sushiLabDisclosure">Robinhood Meme Terminal is independent software. This page describes integration work and does not claim sponsorship, endorsement, or an approved partnership with Sushi or Robinhood.</p>
      <SiteFooter />
    </main>
  );
}
