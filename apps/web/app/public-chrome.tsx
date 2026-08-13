"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isMainnetRelease } from "../lib/network";
import { WalletButton } from "./wallet-button";

const HIDDEN_PREFIXES = ["/activate-consent-testnet", "/admin", "/deploy-consent-testnet", "/deploy-mainnet", "/deploy-testnet", "/mainnet-smoke", "/vnext"];
const MORE_PREFIXES = ["/portfolio", "/protection", "/sources", "/sushi", "/support", "/experience", "/risks"];

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
  if (pathname === "/" || HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  return <VisiblePublicChrome pathname={pathname} />;
}

function VisiblePublicChrome({ pathname }: { pathname: string }) {
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
        menu.current.removeAttribute("open");
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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
            <PublicLink href="/explore">Explore</PublicLink>
            <PublicLink href="/protection">Protection</PublicLink>
            <PublicLink href="/watchlist">Watchlist</PublicLink>
            <span className="networkPulse" aria-label={`${isMainnetRelease ? "Robinhood Chain Mainnet" : "Robinhood Chain Testnet"} live`}><i aria-hidden="true" />RHC <b>{isMainnetRelease ? "MAINNET" : "TESTNET"}</b></span>
          </div>

          <div className="publicNavActions">
            <details ref={menu} className={`publicMore${moreActive ? " active" : ""}`}>
              <summary aria-label="Open more RMT pages"><span>More</span><b aria-hidden="true">···</b></summary>
              <div className="publicMenu">
                <div>
                  <span>Markets &amp; evidence</span>
                  <PublicLink href="/explore">Explore RMT markets<small>Verified RMT history and Robinhood Chain market evidence</small></PublicLink>
                  <PublicLink href="/portfolio">Portfolio<small>Your connected-wallet holdings</small></PublicLink>
                  <PublicLink href="/protection">Protection Center<small>Automatic orders, permission cleanup, and execution history</small></PublicLink>
                  <PublicLink href="/watchlist">Watchlist<small>Tokens saved on this device</small></PublicLink>
                  <PublicLink href="/sources">Sources<small>Origin, venue, and market-evidence boundaries</small></PublicLink>
                </div>
                <div>
                  <span>Protocol &amp; research</span>
                  <PublicLink href="/sushi">Sushi integration<small>Verified routing and execution boundary</small></PublicLink>
                </div>
                <div>
                  <span>Help &amp; safety</span>
                  <PublicLink href="/status">Status<small>Live network and protocol checks</small></PublicLink>
                  <PublicLink href="/support">Support<small>Transaction help and incident steps</small></PublicLink>
                  <PublicLink href="/experience">Experience &amp; privacy<small>Replay the guide or control anonymous diagnostics</small></PublicLink>
                  <PublicLink href="/risks">Risks<small>Read before signing</small></PublicLink>
                  <a href="https://github.com/LandoCrissian/rmt-transparency" target="_blank" rel="noreferrer">Public evidence<small>Contracts, deployments and independent checks</small></a>
                  <a href="https://github.com/sponsors/LandoCrissian" target="_blank" rel="noreferrer">Support RMT<small>Voluntary sponsorship through GitHub</small></a>
                </div>
              </div>
            </details>
            <WalletButton target={isMainnetRelease ? "mainnet" : "testnet"} />
          </div>
        </nav>
      </header>

      <nav className={`mobileDock${pathname.startsWith("/token/") || pathname.startsWith("/project/") ? " tokenRouteDock" : ""}`} aria-label="Mobile navigation">
        <PublicLink href="/"><span aria-hidden="true">◉</span>Terminal</PublicLink>
        <PublicLink href="/explore"><span aria-hidden="true">⌕</span>Explore</PublicLink>
        <PublicLink href="/watchlist"><span aria-hidden="true">☆</span>Watchlist</PublicLink>
        <PublicLink href="/protection"><span aria-hidden="true">◇</span>Protection</PublicLink>
        <PublicLink href="/sources"><span aria-hidden="true">◎</span>Sources</PublicLink>
      </nav>
    </>
  );
}
