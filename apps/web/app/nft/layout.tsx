import type { ReactNode } from "react";
import { NftTerminalChrome } from "./_components/nft-terminal-chrome";
import styles from "./nft-terminal-shell.module.css";

export default function NftTerminalLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={styles.shell} data-nft-terminal-shell="v1">
    <a className={styles.skipLink} href="#nft-terminal-content">Skip to NFT Terminal content</a>
    <NftTerminalChrome />
    <div id="nft-terminal-content" className={styles.content}>{children}</div>
  </div>;
}
