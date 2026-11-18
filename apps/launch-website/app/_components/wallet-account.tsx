"use client";

import Link from "next/link";
import { useAccount } from "./account-provider";

export const shortWallet = (address: string) => address.slice(0, 6) + "…" + address.slice(-4);

export function ProfileAvatar({ name, url, size = 38 }: { name: string; url?: string | null; size?: number }) {
  const safe = typeof url === "string" && /^\/api\/account\/avatar\/0x[0-9a-f]{40}(?:\?v=[a-z0-9.-]+)?$/i.test(url);
  return <span className="lpProfileAvatar" style={{ width: size, height: size }} aria-hidden="true">
    {safe ? <img src={url} alt="" width={size} height={size} /> : (name.trim()[0] ?? "R").toUpperCase()}
  </span>;
}

export function AccountNav() {
  const { session, wallet, checking } = useAccount();
  const profile = session.authenticated ? session.account.profile : undefined;
  return <Link className="lpAccountNav" href="/wallet" prefetch={false} aria-label={session.authenticated ? "Open your wallet account" : "Open wallet connection"}>
    {profile ? <ProfileAvatar name={profile.displayName || profile.username || "R"} url={profile.avatarUrl} size={28} />
      : <span className="lpAccountIcon" aria-hidden="true">◈</span>}
    <span>{checking ? "Wallet" : profile?.username ? "@" + profile.username : session.authenticated ? shortWallet(session.account.walletAddress)
      : wallet ? shortWallet(wallet.address) : "Connect wallet"}</span>
  </Link>;
}

export function WalletAccount({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const { session, wallet, wallets, checking, busy, challenge, message } = account;
  if (checking) return <section className="lpPanel lpForm" aria-label="Wallet account"><p role="status">Checking account session…</p></section>;
  if (session.authenticated) {
    const profile = session.account.profile;
    return <section className="lpPanel lpForm" aria-label="Wallet account">
      <div className="lpProfileIdentity"><ProfileAvatar name={profile.displayName || profile.username || "R"} url={profile.avatarUrl} />
        <div><h2>{profile.displayName || "Your account"}</h2><p>{profile.username ? "@" + profile.username : "Choose a public username in your profile"}</p></div>
        <span className="lpPill">Signed in</span></div>
      <p className="lpAddress">{session.account.walletAddress}</p>
      <p>Robinhood Chain 4663 · wallet-authenticated account. Connecting and signing in do not enable token creation or trading.</p>
      <div className="lpDraftActions"><Link className="lpButton" href="/account/profile" prefetch={false}>Edit profile</Link>
        {profile.username && <Link className="lpButton lpSecondary" href={`/u/${profile.username}`} prefetch={false}>View public profile</Link>}
        <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void account.signOut()}>Sign out & disconnect</button></div>
      {account.logoutUnconfirmed && <button type="button" className="lpButton lpSecondary" onClick={() => void account.signOut()}>Retry server sign-out</button>}
      {message && <p role="status">{message}</p>}
    </section>;
  }
  return <section className="lpPanel lpForm" aria-label="Wallet account">
    <div><span className="lpEyebrow">Your wallet, your identity</span><h2>{wallet ? "Connected, not signed in" : "Connect your wallet"}</h2></div>
    <p>{compact ? "Sign in to manage your creator profile and view your launches." : "Use MetaMask, Rabby or a compatible browser wallet. A separate sign-in message confirms control of your address, with no gas payment."}</p>
    {!compact && <details><summary>Supported sign-in wallets</summary><p>Account sign-in supports a standard 65-byte message signature from an externally owned wallet, including a delegated EOA when the wallet returns its original account signature. Safe and ERC-1271/4337 profile sign-in are currently unsupported; Safe treasury claims have their own separate compatibility checks.</p></details>}
    {session.availability !== "available" && <p className="lpInlineNotice" role="status">{session.availability === "disabled"
      ? "Wallet sign-in is not configured in this preview. Profile changes are unavailable." : "The account service is unavailable. Try Check session to reconnect."}</p>}
    {wallet ? <>
      <dl className="lpFacts"><dt>Connected address</dt><dd className="lpAddress">{wallet.address}</dd>
        <dt>Network</dt><dd>{wallet.chainId === 4663 ? "Robinhood Chain 4663" : `Chain ${wallet.chainId} · switch network`}</dd></dl>
      {wallet.chainId !== 4663 ? <button type="button" className="lpButton" disabled={busy} onClick={() => void account.switchNetwork()}>Switch to Robinhood Chain</button>
        : challenge ? <section className="lpSiweReview lpForm" aria-label="Sign-in message review">
          <h3>Review wallet sign-in</h3><p>This message signs in to RMT Launch. It requests no transaction, token approval or gas payment.</p>
          <dl className="lpFacts"><dt>Wallet</dt><dd className="lpAddress">{wallet.address}</dd>
            <dt>Expires</dt><dd>{new Date(challenge.expiresAt).toLocaleTimeString()}</dd></dl>
          <details><summary>View exact message</summary><pre>{challenge.message}</pre></details>
          <button type="button" className="lpButton" disabled={busy} onClick={() => void account.signIn()}>{busy ? "Waiting for wallet…" : "Sign in with wallet"}</button>
          <button type="button" className="lpTextButton" disabled={busy} onClick={() => void account.reviewSignIn()}>Review a new message</button>
        </section> : <button type="button" className="lpButton" disabled={busy || account.logoutUnconfirmed || session.availability !== "available"}
          onClick={() => void account.reviewSignIn()}>Review gas-free sign-in</button>}
      <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void account.signOut()}>Disconnect wallet</button>
    </> : !account.discovered ? <button type="button" className="lpButton" disabled={busy} onClick={account.discoverWallets}>Choose wallet</button>
      : wallets.length ? <div className="lpWalletOptions">{wallets.map((option) => <button type="button" className="lpButton lpSecondary" key={option.id}
      disabled={busy} onClick={() => void account.connect(option)}>Connect {option.name}</button>)}</div>
      : <p className="lpInlineNotice">Open this site in MetaMask or Rabby&apos;s wallet browser, or use a compatible browser extension. No recovery phrase or private key is needed.</p>}
    <button type="button" className="lpTextButton" disabled={busy || checking} onClick={() => void account.refresh()}>Check session</button>
    {account.logoutUnconfirmed && <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void account.signOut()}>Retry server sign-out</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
