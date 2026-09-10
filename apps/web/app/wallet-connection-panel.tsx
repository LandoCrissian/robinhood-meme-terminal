"use client";

import type { WalletConnectionSnapshot } from "../lib/wallet-connection-controller";

export function WalletConnectionPanel({ connection, wallets, retry, chooseAnother, cancel, select }: {
  connection: WalletConnectionSnapshot;
  wallets: readonly { key: string; name: string; address: string }[];
  retry: () => void;
  chooseAnother: () => void;
  cancel: () => void;
  select: (key: string) => void;
}) {
  return <section className="walletMenu" aria-label="Wallet connection">
    <p role="status" aria-live="polite">{connection.state === "CONNECTING"
      ? "Connect in your wallet, then choose the exact wallet below."
      : connection.state === "SLOW"
        ? "Your wallet is taking longer than expected. You can retry or choose another."
        : connection.error}</p>
    <button type="button" onClick={retry}>Retry</button>
    <button type="button" onClick={chooseAnother}>Choose another wallet</button>
    <button type="button" onClick={cancel}>Cancel</button>
    <div className="privyWalletList">
      {wallets.map(wallet => <button type="button" key={wallet.key} onClick={() => select(wallet.key)}>
        <span><strong>{wallet.name}</strong><small>{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</small></span>
        <em>USE</em>
      </button>)}
    </div>
  </section>;
}
