"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  EXPERIENCE_ONBOARDING_VERSION,
  readExperiencePreferences,
  saveExperiencePreferences
} from "../lib/experience-funnel";
import { useTradingTermsAcceptance } from "../lib/use-trading-terms";

function isGuidedSurface(pathname: string) {
  return pathname === "/"
    || pathname === "/explore"
    || pathname.startsWith("/market/")
    || pathname.startsWith("/project/")
    || pathname.startsWith("/token/");
}

export function FirstVisitGuide() {
  const pathname = usePathname();
  const terms = useTradingTermsAcceptance();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const diagnostics = useRef(false);
  const guide = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const preferences = readExperiencePreferences();
    diagnostics.current = preferences.diagnosticsEnabled;
    setDiagnosticsEnabled(preferences.diagnosticsEnabled);
    setOpen(
      terms.ready
      && terms.accepted
      && isGuidedSurface(pathname)
      && preferences.onboardingVersion < EXPERIENCE_ONBOARDING_VERSION
    );
    setReady(true);
  }, [pathname, terms.accepted, terms.ready]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        saveExperiencePreferences({
          onboardingVersion: EXPERIENCE_ONBOARDING_VERSION,
          diagnosticsEnabled: diagnostics.current
        });
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(guide.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled])"
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleDialogKeys);
    window.requestAnimationFrame(() => primary.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      previouslyFocused?.focus();
    };
  }, [open]);

  const finish = () => {
    saveExperiencePreferences({
      onboardingVersion: EXPERIENCE_ONBOARDING_VERSION,
      diagnosticsEnabled: diagnostics.current
    });
    setOpen(false);
    if (pathname === "/") {
      window.requestAnimationFrame(() => document.querySelector("#market-explorer")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      }));
    }
  };

  if (!ready || !open) return null;

  return (
    <div className="firstVisitBackdrop" role="presentation">
      <section ref={guide} className="firstVisitGuide" role="dialog" aria-modal="true" aria-labelledby="first-visit-title">
        <header>
          <span className="firstVisitMark" aria-hidden="true">RMT</span>
          <div><p className="eyebrow">YOUR FIRST 60 SECONDS</p><h1 id="first-visit-title">Find the market. Verify the evidence. Keep control.</h1></div>
        </header>
        <ol className="firstVisitPath">
          <li><span>01</span><div><strong>Discover</strong><small>Scan live Robinhood Chain markets across verified sources.</small></div></li>
          <li><span>02</span><div><strong>Review</strong><small>Check origin, liquidity, holder signals, activity, and execution route.</small></div></li>
          <li><span>03</span><div><strong>Prepare</strong><small>Compare a fresh quote, then approve every action in your own wallet.</small></div></li>
        </ol>
        <label className="experienceConsent">
          <input
            type="checkbox"
            checked={diagnosticsEnabled}
            onChange={(event) => {
              diagnostics.current = event.target.checked;
              setDiagnosticsEnabled(event.target.checked);
            }}
          />
          <span><strong>Help improve RMT</strong><small>Share anonymous journey milestones from this browser. No wallet address, token, amount, search, email, profile, cookie, or cross-session ID.</small></span>
        </label>
        <div className="firstVisitActions">
          <button ref={primary} type="button" onClick={finish}>
            {pathname === "/" ? "Start with live markets" : pathname.startsWith("/market/") ? "Review this market" : "Continue into RMT"}
          </button>
          <Link href="/experience">Experience &amp; privacy</Link>
        </div>
        <small className="firstVisitFootnote">RMT is non-custodial. Evidence reduces uncertainty; it cannot guarantee a token is safe.</small>
      </section>
    </div>
  );
}
