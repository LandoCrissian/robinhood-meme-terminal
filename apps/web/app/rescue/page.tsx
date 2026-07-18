import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../site-footer";

export const metadata: Metadata = {
  title: "Consent-Based Migration Lab · RMT",
  description: "Testnet-only research into atomic, self-custodial liquidity migration on Robinhood Chain.",
  alternates: { canonical: "/rescue" }
};

const flow = [
  ["01", "Move only what you own", "Exit or convert the old LP position yourself. This router never calls or withdraws from a source pool; any market discovery is read-only."],
  ["02", "Bridge to yourself", "Use a canonical route to deliver supported assets to your own Robinhood Chain wallet."],
  ["03", "Review exact bounds", "Confirm the code-bound pool, fee tier, tick range, desired amounts, minimum use, minimum liquidity, deadline and deployment-specific terms hash."],
  ["04", "Mint through one manager", "A bound accounting session snapshots exact balances onchain, then calls one code-bound V3-compatible rehearsal manager. There is no generic executor or third-party seeder."],
  ["05", "Keep direct custody", "A brand-new test LP NFT and every unused test token from a successful rehearsal must end with the same wallet in that transaction."]
] as const;

export default function LiquidityRescuePage() {
  return (
    <main className="rescueLabPage">
      <section className="rescueHero">
        <div>
          <p className="eyebrow">RMT RESEARCH LAB · TESTNET ONLY · NO REAL FUNDS</p>
          <h1>Liquidity you own.<br /><span>One destination market.</span></h1>
          <p>RMT is designing a consent-based path for owners to use their own tokens to mint a directly held position in one code-bound WETH market on Robinhood Chain.</p>
          <p className="rescueScope"><strong>What exists now:</strong> a source-verified, paused, no-value rehearsal on Robinhood Chain Testnet with adversarial tests. It uses an RMT-operated Sushi V3 ABI-compatible test fixture—not an official Sushi deployment—and no public deposit, bridge or migration execution UI is enabled.</p>
          <div className="rescueActions">
            <a className="rescuePrimary" href="#proposed-flow">Review the safety model ↓</a>
            <Link href="/sushi">Open Sushi lab</Link>
          </div>
        </div>
        <div className="rescueOrbit" role="img" aria-label="Proposed flow from owner wallets to directly held positions in one Robinhood Chain market">
          <span className="rescueOrbitLabel">OWNER WALLETS</span>
          <div className="rescueNodes" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="rescueCore"><small>DESTINATION</small><strong>RHC</strong><span>ONE WETH MARKET</span></div>
          <p>Many owners.<br />Directly held positions.</p>
        </div>
      </section>

      <section className="rescueStrip" aria-label="Prototype status">
        <div><small>CONTRACT</small><strong>TESTNET ONLY</strong><span>Starts paused; bytecode blocks mainnet</span></div>
        <div><small>CUSTODY</small><strong>OWNER DIRECT</strong><span>No pooled customer funds</span></div>
        <div><small>EXECUTION</small><strong>ATOMIC</strong><span>Failure reverts all movement</span></div>
        <div><small>DEPLOYMENT</small><strong className="rescueHeld">VERIFIED · PAUSED</strong><span>No-value fixture; public execution disabled</span></div>
      </section>

      <section id="proposed-flow" className="rescueBody">
        <div className="rescueFlow">
          <header><p className="eyebrow">CONSENT-BASED FLOW</p><h2>One owner-authorized transaction. No pooled custody.</h2></header>
          <ol>{flow.map(([number, title, detail]) => <li key={number}><span>{number}</span><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ol>
        </div>
        <aside className="rescueBoundaries">
          <p className="eyebrow">NON-NEGOTIABLE</p>
          <h2>Permission before movement.</h2>
          <ul>
            <li>No contract exploitation or abandoned-fund claims.</li>
            <li>No source-pool, arbitrary-call or generic bridge access.</li>
            <li>No beneficiary override or shared customer vault.</li>
            <li>No generic executor, retained manager approval or RMT LP custody.</li>
            <li>No mainnet release without Sushi verification, audits and legal review.</li>
          </ul>
          <div className="rescuePair"><span>PAIR TARGET</span><strong>CONFIGURED ASSET</strong><b>＋</b><strong>RHC WETH</strong></div>
        </aside>
      </section>

      <section className="rescueStatement">
        <p className="eyebrow">WHY THIS MODEL</p>
        <h2>Concentrate market liquidity while every owner keeps their own position.</h2>
        <p>The deployed testnet router remains paused and public execution is disabled. Its code-bound session records exact wallet and session balances onchain, calls one bound rehearsal manager, requires a fresh test position NFT owned by that caller, verifies pool and position state, returns computed unused amounts, requires exact final balances, and clears session-to-manager approvals. Any verified mismatch reverts the entire transaction. Users must never transfer tokens directly to either contract. The testnet-only terms and deployment-specific hashes are published in the verified deployment record; no acceptance or migration UI is enabled.</p>
        <div><Link href="/terms">Read general RMT terms</Link><Link href="/risks">Read RMT risks</Link></div>
      </section>

      <p className="rescueDisclosure">This module is a verified, paused and valueless Robinhood Chain testnet rehearsal; it is unaudited and unavailable for public execution. Runtime hashes do not by themselves establish production safety. Self-custody does not resolve money-transmission, sanctions, securities, commodities, tax, privacy or consumer-protection obligations; qualified counsel must review any completed real-value product before release. RMT does not promise recovery, profit, automatic value generation, safety, or endorsement by Sushi or Robinhood.</p>
      <SiteFooter />
    </main>
  );
}
