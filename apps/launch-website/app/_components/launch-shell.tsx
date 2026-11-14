"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import logo from "../../../web/public/brand/rmt-master-logo.png";

const navigation = [["/", "Launches"], ["/create-token", "Create Token"], ["/my-launches", "My Launches"], ["/wallet", "Wallet"]] as const;

export function LaunchShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <div className="rmtVnext rmtTerminal launchpad">
    <a className="vnSkipLink" href="#launch-content">Skip to launchpad</a>
    <header className="rmtDesktopHeader lpHeader">
      <Link className="rmtTerminalBrand" href="/" aria-label="RMT Launch home">
        <img src={logo.src} alt="" width={34} height={34} />
        <strong>RMT</strong>
      </Link>
      <nav aria-label="Launchpad navigation">
        {navigation.map(([href, label]) => {
          const active = path === href || href === "/" && path.startsWith("/launches/");
          return <Link key={href} href={href} className={active ? "isActive" : undefined} aria-current={active ? "page" : undefined}>{label}</Link>;
        })}
      </nav>
      <div className="lpHeaderRight">
        <span className="lpNetwork"><i aria-hidden="true" />Read-only preview</span>
        <Link className="lpButton" href="/wallet">Wallet</Link>
      </div>
    </header>
    <main id="launch-content" className="lpContent">{children}</main>
    <footer className="lpFooter">
      <Link href="/rmt" prefetch={false}>Legacy RMT</Link>
      <Link href="/terms" prefetch={false}>Terms</Link>
      <Link href="/risks" prefetch={false}>Risks</Link>
      <Link href="/privacy" prefetch={false}>Privacy</Link>
    </footer>
  </div>;
}
