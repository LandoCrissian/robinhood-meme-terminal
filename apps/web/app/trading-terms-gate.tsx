"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTradingTermsAcceptance } from "../lib/use-trading-terms";

function isTradingSurface(pathname: string) {
  return pathname === "/"
    || pathname === "/explore"
    || pathname.startsWith("/market/")
    || pathname.startsWith("/project/")
    || pathname.startsWith("/token/");
}

export function TradingTermsGate() {
  const pathname = usePathname();
  const terms = useTradingTermsAcceptance();
  if (!terms.ready || terms.accepted || !isTradingSurface(pathname)) return null;

  return (
    <div className="tradingTermsBackdrop" role="presentation">
      <section className="tradingTermsGate" role="dialog" aria-modal="true" aria-labelledby="trading-terms-heading">
        <div className="tradingTermsMark" aria-hidden="true">RMT</div>
        <p className="eyebrow">BEFORE YOU ENTER</p>
        <h1 id="trading-terms-heading">Trade with your eyes open</h1>
        <p>RMT is non-custodial software. Tokens can lose all value, liquidity can disappear, and no automated check can prevent every rug or malicious contract.</p>
        <ul>
          <li>Your wallet controls and confirms every transaction.</li>
          <li>RMT evidence is not an endorsement, guarantee, or financial advice.</li>
          <li>Always verify the token, amount, minimum received, and network in your wallet.</li>
        </ul>
        <div className="tradingTermsLinks">
          <Link href="/terms" target="_blank">Trading terms ↗</Link>
          <Link href="/risks" target="_blank">Risk disclosures ↗</Link>
          <Link href="/privacy" target="_blank">Privacy ↗</Link>
        </div>
        <button type="button" onClick={terms.accept}>I understand — enter RMT</button>
        <small>You will only see this again when RMT’s trading terms materially change or this browser’s site data is cleared.</small>
      </section>
    </div>
  );
}
