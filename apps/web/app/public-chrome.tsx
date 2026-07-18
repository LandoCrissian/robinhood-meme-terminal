"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isMainnetRelease } from "../lib/network";
import { WalletButton } from "./wallet-button";

const HIDDEN_PREFIXES = ["/admin", "/deploy-mainnet", "/deploy-testnet", "/mainnet-smoke"];
const MORE_PREFIXES = ["/runners", "/portfolio", "/watchlist", "/sources", "/sushi", "/rescue", "/support", "/risks"];

function currentPage(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function PublicLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = currentPage(pathname, href);
  return <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{children}</Link>;
}

export function PublicChrome() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const moreActive = MORE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  useEffect(() => {
    menu.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) {
        menu.current.removeAttribute("open");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current?.removeAttribute("open");
        menu.current?.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  return (
    <>
      <header className="publicHeader">
        <nav className="publicNav" aria-label="Main navigation">
          <Link className="brandLockup" href="/" aria-label="Robinhood Meme Terminal home">
            <img className="brandLogo" src="/brand/rmt-master-logo.png" alt="" />
            <strong>RMT</strong>
          </Link>

          <div className="publicNavLinks">
            <PublicLink href="/">Terminal</PublicLink>
            <PublicLink href="/runners">Runners</PublicLink>
            <PublicLink href="/launch">Launch</PublicLink>
            <PublicLink href="/status">Status</PublicLink>
            <PublicLink href="/profile">Profile</PublicLink>
            <span className="networkPulse" aria-label={`${isMainnetRelease ? "Robinhood Chain Mainnet" : "Robinhood Chain Testnet"} live`}><i aria-hidden="true" />RHC <b>{isMainnetRelease ? "MAINNET" : "TESTNET"}</b></span>
          </div>

          <div className="publicNavActions">
            <details ref={menu} className={`publicMore${moreActive ? " active" : ""}`}>
              <summary aria-label="Open more RMT pages"><span>More</span><b aria-hidden="true">···</b></summary>
              <div className="publicMenu">
                <div>
                  <span>Discover</span>
                  <PublicLink href="/runners">Runner Radar<small>External Robinhood Chain markets</small></PublicLink>
                  <PublicLink href="/portfolio">Portfolio<small>Your connected-wallet holdings</small></PublicLink>
                  <PublicLink href="/watchlist">Watchlist<small>Tokens saved on this device</small></PublicLink>
                  <PublicLink href="/sources">Sources<small>Launchpad coverage and origin labels</small></PublicLink>
                  <PublicLink href="/sushi">Sushi integration<small>Routing boundary and launch readiness</small></PublicLink>
                  <PublicLink href="/rescue">Liquidity Rescue<small>Testnet-only multichain research</small></PublicLink>
                </div>
                <div>
                  <span>Help &amp; safety</span>
                  <PublicLink href="/support">Support<small>Transaction help and incident steps</small></PublicLink>
                  <PublicLink href="/risks">Risks<small>Read before signing</small></PublicLink>
                </div>
              </div>
            </details>
            <WalletButton target={isMainnetRelease ? "mainnet" : "testnet"} />
          </div>
        </nav>
      </header>

      <nav className={`mobileDock${pathname.startsWith("/token/") ? " tokenRouteDock" : ""}`} aria-label="Mobile navigation">
        <PublicLink href="/"><span aria-hidden="true">◉</span>Terminal</PublicLink>
        <PublicLink href="/launch"><span aria-hidden="true">＋</span>Launch</PublicLink>
        <PublicLink href="/status"><span aria-hidden="true">●</span>Status</PublicLink>
        <PublicLink href="/profile"><span aria-hidden="true">◎</span>Profile</PublicLink>
      </nav>
    </>
  );
}
