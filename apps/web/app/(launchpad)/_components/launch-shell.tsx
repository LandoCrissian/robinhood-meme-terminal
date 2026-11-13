"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { TerminalIcon } from "../../vnext/terminal-icon";
import { useLaunchWallet } from "./launch-wallet";

const navigation = [["/", "Launches"], ["/create-token", "Create Token"], ["/my-launches", "My Launches"], ["/wallet", "Wallet"]] as const;

export function LaunchWalletShell({ children }: { children: ReactNode }) {
  const { config, wallet } = useLaunchWallet();
  const network = config?.status === "ready" ? config.deployment.name : "Preview";
  return <LaunchShell network={network} walletLabel={wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect wallet"}>
    {children}
  </LaunchShell>;
}

export function LaunchShell({ children, network, walletLabel }: { children: ReactNode; network: string; walletLabel: string }) {
  const path = usePathname();
  return <div className="rmtVnext rmtTerminal launchpad">
    <a className="vnSkipLink" href="#launch-content">Skip to launchpad</a>
    <header className="rmtDesktopHeader lpHeader">
      <Link className="rmtTerminalBrand" href="/" aria-label="RMT Launch home">
        <img src="/brand/rmt-master-logo.png" alt="" width={34} height={34} />
        <strong>RMT</strong>
      </Link>
      <nav aria-label="Launchpad navigation">
        {navigation.map(([href, label]) => {
          const active = path === href || href === "/" && path.startsWith("/launches/");
          return <Link key={href} href={href} className={active ? "isActive" : undefined} aria-current={active ? "page" : undefined}>{label}</Link>;
        })}
      </nav>
      <div className="lpHeaderRight">
        <span className="lpNetwork"><i aria-hidden="true" />{network}</span>
        <Link className="lpButton" href="/wallet">{walletLabel}</Link>
      </div>
    </header>
    <main id="launch-content" className="lpContent">{children}</main>
    <footer className="lpFooter">
      <Link href="/rmt">Legacy RMT</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/risks">Risks</Link>
      <Link href="/privacy">Privacy</Link>
    </footer>
  </div>;
}

export function CopyIdentity({ title, value }: { title: string; value: string }) {
  return <button type="button" className="lpIdentity" aria-label={`Copy ${title}`}
    onClick={(event) => {
      const element = event.currentTarget;
      void navigator.clipboard.writeText(value).then(() => {
        element.dataset.copied = "true";
        window.setTimeout(() => delete element.dataset.copied, 1400);
      }).catch(() => {});
    }}><code>{value}</code><TerminalIcon name="copy" /><span className="lpCopied">Copied</span></button>;
}
