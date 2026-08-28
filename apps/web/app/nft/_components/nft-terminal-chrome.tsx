import Image from "next/image";
import Link from "next/link";
import { VNextRouteWalletConnection } from "../../vnext/vnext-wallet-connection";
import styles from "../nft-terminal-shell.module.css";

const primaryLinks = [
  { href: "/", label: "Markets", active: false },
  { href: "/nft", label: "NFTs", active: true },
  { href: "/?panel=portfolio", label: "Portfolio", active: false },
  { href: "/?panel=distribution", label: "Distribution", active: false },
] as const;

export function NftTerminalChrome() {
  return <>
    <header className={styles.header} data-nft-terminal-header>
      <Link className={styles.brand} href="/" aria-label="RMT Markets">
        <Image src="/brand/rmt-master-logo.png" alt="" width={34} height={34} priority />
        <strong>RMT</strong>
      </Link>

      <nav className={styles.desktopNav} aria-label="RMT Terminal navigation">
        {primaryLinks.map((link) => <Link key={link.label} href={link.href} aria-current={link.active ? "page" : undefined}>{link.label}</Link>)}
        <Link href="/?view=rwa">RWA</Link>
      </nav>

      <span className={styles.chain} aria-label="Robinhood Chain 4663"><i aria-hidden="true" /> <b>Robinhood</b> · 4663</span>
      <div className={styles.wallet}><VNextRouteWalletConnection compact returnTo="/nft" /></div>
    </header>

    <nav className={styles.mobileNav} aria-label="RMT Terminal navigation">
      {primaryLinks.map((link) => <Link key={link.label} href={link.href} aria-current={link.active ? "page" : undefined}>{link.label}</Link>)}
    </nav>
  </>;
}
