"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { capturePendingReferral, clearPendingReferral } from "../../../lib/referrals";
import styles from "./invite.module.css";

export function InviteAcceptance({ code }: { code: string }) {
  const router = useRouter();

  function accept(destination: "/" | "/profile") {
    capturePendingReferral(code);
    router.push(destination);
  }

  function decline() {
    clearPendingReferral();
    router.push("/");
  }

  return (
    <main className={styles.page}>
      <section className={styles.invite}>
        <div className={styles.mark} aria-hidden="true">
          <img src="/brand/rmt-master-logo.png" alt="" />
        </div>
        <p className="eyebrow">PRIVATE RMT INVITATION</p>
        <h1>Build your Robinhood Chain desk.</h1>
        <p className={styles.lead}>Discover markets, inspect risk evidence, save projects, and prepare non-custodial trades from one profile that follows you across devices.</p>

        <div className={styles.codeLine}>
          <span>INVITE CODE</span>
          <strong>{code}</strong>
          <small>Verified only when your protected profile activates it</small>
        </div>

        <div className={styles.assurances} aria-label="Invitation protections">
          <div><b>01</b><span><strong>No wallet authority</strong>Accepting cannot sign transactions or access keys.</span></div>
          <div><b>02</b><span><strong>Private attribution</strong>Your referral relationship is not displayed publicly.</span></div>
          <div><b>03</b><span><strong>No reward promise</strong>This release measures verified community growth only.</span></div>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => accept("/profile")}>Accept &amp; set up my profile</button>
          <button className={styles.secondary} type="button" onClick={() => accept("/")}>Accept &amp; explore first</button>
        </div>
        <button className={styles.decline} type="button" onClick={decline}>Continue without this invite</button>
        <p className={styles.finePrint}>If accepted, this code remains in this browser for up to 30 days. One activation is recorded only after verified sign-in and a protected profile save.</p>
        <nav className={styles.links} aria-label="Invitation information">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/risks">Risks</Link>
        </nav>
      </section>

      <aside className={styles.context}>
        <p className="eyebrow">WHY RMT</p>
        <h2>Signal before speed.</h2>
        <p>RMT brings market discovery, project origin, wallet relationships, liquidity context, watchlists, and transparent execution preparation into a mobile-first terminal.</p>
        <dl>
          <div><dt>MARKETS</dt><dd>Cross-venue discovery</dd></div>
          <div><dt>RISK</dt><dd>Explainable evidence</dd></div>
          <div><dt>TRADING</dt><dd>Self-custody only</dd></div>
          <div><dt>PROFILE</dt><dd>Private by default</dd></div>
        </dl>
      </aside>
    </main>
  );
}
