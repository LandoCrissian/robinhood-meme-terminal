"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const menuId = useId(), path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="lpAccountMenu" ref={container}>
    <button type="button" className="lpAccountNav" ref={trigger} aria-controls={menuId} aria-expanded={open}
      aria-label={session.authenticated || wallet ? "Open wallet and profile" : "Connect wallet and profile"}
      onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => firstLink.current?.focus()); }
      }}>
      {profile ? <ProfileAvatar name={profile.displayName || profile.username || "R"} url={profile.avatarUrl} size={28} />
        : <span className="lpAccountIcon" aria-hidden="true">◈</span>}
      <span className="lpAccountLabel">{checking ? "Wallet" : profile?.username ? "@" + profile.username : session.authenticated ? shortWallet(session.account.walletAddress)
        : wallet ? shortWallet(wallet.address) : "Connect wallet"}</span><span className="lpAccountChevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div id={menuId} className="lpAccountDropdown">
      <p>{session.authenticated ? "Signed in" : wallet ? "Connected · not signed in" : "Your wallet & profile"}</p>
      <nav aria-label="Wallet and profile">
        <Link ref={firstLink} href="/wallet" aria-label="Wallet" prefetch={false} onClick={() => setOpen(false)}>Wallet<span>Connection & sign-in</span></Link>
        <Link href="/my-launches/earnings" aria-label="Earnings" prefetch={false} onClick={() => setOpen(false)}>Earnings<span>Creator & treasury fee credits</span></Link>
        <Link href="/account/profile" aria-label="Profile" prefetch={false} onClick={() => setOpen(false)}>Profile<span>{profile ? "Edit your profile" : "Sign in to manage your profile"}</span></Link>
        {profile?.username && <Link href={`/u/${profile.username}`} aria-label="Public profile" prefetch={false} onClick={() => setOpen(false)}>Public profile<span>@{profile.username}</span></Link>}
      </nav>
    </div>}
  </div>;
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
    <div><h2>{wallet ? "Connected, not signed in" : "Connect your wallet"}</h2></div>
    <p>{compact ? "Sign in to manage your creator profile and view your launches." : "Use MetaMask, Rabby or a compatible browser wallet. A separate sign-in message confirms control of your address, with no gas payment."}</p>
    {!compact && <details><summary>Supported sign-in wallets</summary><p>Account sign-in supports a standard 65-byte message signature from an externally owned wallet, including a delegated EOA when the wallet returns its original account signature. Safe and ERC-1271/4337 profile sign-in are currently unsupported; Safe treasury claims have their own separate compatibility checks.</p></details>}
    {session.availability !== "available" && <p className="lpInlineNotice" role="status">{session.availability === "disabled"
      ? "Wallet sign-in is currently turned off." : "The account service is unavailable. Try Check session to reconnect."}</p>}
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
      : <div className="lpInlineNotice" role="status"><p>On iPhone, open www.rmtlaunch.fun/account/profile in the browser inside MetaMask or Rabby. On a computer, unlock your wallet extension.</p><button type="button" className="lpButton lpSecondary" onClick={account.discoverWallets}>Find wallets again</button></div>}
    <button type="button" className="lpTextButton" disabled={busy || checking} onClick={() => void account.refresh()}>Check session</button>
    {account.logoutUnconfirmed && <button type="button" className="lpButton lpSecondary" disabled={busy} onClick={() => void account.signOut()}>Retry server sign-out</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
