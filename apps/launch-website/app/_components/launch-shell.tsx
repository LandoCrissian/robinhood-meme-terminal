"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import logo from "../../public/brand/rmt-master-logo.png";
import { AccountNav } from "./wallet-account";
import { useAccount } from "./account-provider";

const navigation = [["/", "Launches"], ["/leaderboard", "People"], ["/create-token", "Create"], ["/my-launches", "My Launches"]] as const;

export function LaunchShell({ children, fixture = false }: { children: ReactNode; fixture?: boolean }) {
  const path = usePathname();
  const { session } = useAccount();
  const preferences = session.authenticated ? session.account.profile.preferences : undefined;
  return <div className="rmtVnext rmtTerminal launchpad" data-theme={preferences?.theme ?? "dark"} data-reduced-motion={preferences?.reducedMotion ? "true" : undefined}>
    <a className="vnSkipLink" href="#launch-content">Skip to launchpad</a>
    <header className="rmtDesktopHeader lpHeader">
      <Link className="rmtTerminalBrand" href="/" prefetch={false} aria-label="RMT Launch home">
        <img src={logo.src} alt="" width={34} height={34} />
        <strong>RMT <span className="lpBrandWord">Launch</span></strong>
      </Link>
      <nav aria-label="Launchpad navigation">
        {navigation.map(([href, label]) => {
          const active = path === href || href === "/" && path.startsWith("/launches/") || href === "/leaderboard" && /^\/(u|creator)\//.test(path) || href === "/my-launches" && path.startsWith("/my-launches/");
          return <Link key={href} href={href} prefetch={false} className={[active ? "isActive" : "", href === "/create-token" ? "lpCreateLink" : ""].filter(Boolean).join(" ") || undefined} aria-current={active ? "page" : undefined}>{label}</Link>;
        })}
      </nav>
      <div className="lpHeaderRight">
        <span className="lpNetwork"><i aria-hidden="true" />{fixture ? "Anvil test only" : "Read-only"}</span>
        <AccountNav />
      </div>
    </header>
    <main id="launch-content" className="lpContent">{children}</main>
    <footer className="lpFooter">
      <Link href="/leaderboard" prefetch={false}>People</Link>
      <Link href="/terms" prefetch={false}>Terms</Link>
      <Link href="/risks" prefetch={false}>Risks</Link>
      <Link href="/privacy" prefetch={false}>Privacy</Link>
    </footer>
  </div>;
}
