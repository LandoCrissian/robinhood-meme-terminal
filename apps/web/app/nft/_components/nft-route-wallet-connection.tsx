"use client";

import { usePathname } from "next/navigation";
import { VNextRouteWalletConnection } from "../../vnext/vnext-wallet-connection";
import styles from "../nft-terminal-shell.module.css";

export function NftRouteWalletConnection() {
  const pathname = usePathname();
  const returnTo = pathname.startsWith("/nft") ? pathname : "/nft";
  return <div className={styles.wallet} data-nft-wallet-return-to={returnTo}>
    <VNextRouteWalletConnection compact returnTo={returnTo} />
  </div>;
}
