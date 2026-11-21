"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { accountApi, accountErrorMessage } from "../../lib/account-api";
import { profileEdit, profileShareIntent, type AccountProfile, type ProfileChallenge, type ProfileEdit } from "../../lib/profiles";
import { assertAccountChallenge, assertConnectedAccount, sameAccount, signAccountMessage } from "../../lib/profile-wallet";
import { testWalletErrorCode } from "../../lib/test-wallet";
import { useAccount } from "./account-provider";
import { ProfileAvatar, WalletAccount } from "./wallet-account";

const editable = (profile: AccountProfile): ProfileEdit => ({ username: profile.username, displayName: profile.displayName,
  bio: profile.bio, xHandle: profile.xHandle ?? null, links: profile.links.map((link) => ({ ...link })), preferences: { ...profile.preferences } });

export function ProfileEditor() {
  const { session, checking } = useAccount();
  return <>
    <header className="lpPageHeading"><div><h1>Edit profile</h1><p>Your creator identity, linked to the wallet you control.</p></div>
      <Link className="lpButton lpSecondary" href="/wallet" prefetch={false}>Wallet account</Link></header>
    {checking ? <div className="lpSkeleton" role="status">Loading your account…</div> : session.authenticated
      ? <AuthenticatedEditor key={session.account.walletAddress} profile={session.account.profile} csrfToken={session.csrfToken} /> : <WalletAccount compact />}
  </>;
}

function AuthenticatedEditor({ profile, csrfToken }: { profile: AccountProfile; csrfToken: string }) {
  const account = useAccount();
  const [draft, setDraft] = useState(() => editable(profile)), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [noticeArea, setNoticeArea] = useState<"profile" | "avatar" | "removal">("profile");
  const [removal, setRemoval] = useState<ProfileChallenge>(), [reauthenticated, setReauthenticated] = useState(false), [confirmed, setConfirmed] = useState(false);
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setRemoval(undefined); setReauthenticated(false); setConfirmed(false); }, [account.wallet]);

  async function run(action: () => Promise<void>, area: "profile" | "avatar" | "removal" = "profile") {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(""); setNoticeArea(area);
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(testWalletErrorCode(error) === 4001 ? "You declined the wallet message. No profile deletion occurred."
      : error instanceof Error && !("status" in error) ? error.message : accountErrorMessage(error)); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const body = profileEdit(draft);
      const result = await accountApi<{ profile: AccountProfile }>("/api/account/profile", { method: "PATCH", body, csrfToken });
      if (!mounted.current || !sameAccount(result.profile.walletAddress, profile.walletAddress)) return;
      account.updateProfile(result.profile); setDraft(editable(result.profile)); setMessage("Profile saved. Public details and private preferences are stored separately.");
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    await run(async () => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024 || file.size === 0) throw new Error("Choose a JPG, PNG or WebP image up to 2 MiB.");
      const body = new FormData(); body.set("file", file);
      const result = await accountApi<{ profile: AccountProfile }>("/api/account/avatar", { method: "POST", body, csrfToken, signal: AbortSignal.timeout(20_000) });
      if (!mounted.current) return;
      account.updateProfile(result.profile); setMessage("Avatar updated. The uploaded image was resized and re-encoded for your profile.");
      if (fileInput.current) fileInput.current.value = "";
    }, "avatar");
  }
  async function removeCurrentAvatar() {
    const expectedAvatarUrl = profile.avatarUrl;
    if (!expectedAvatarUrl) return;
    const current = generation.current;
    await run(async () => {
      const result = await accountApi<{ profile: AccountProfile }>("/api/account/avatar", {
        method: "DELETE", body: { expectedAvatarUrl }, csrfToken,
      });
      if (!mounted.current || current !== generation.current || !sameAccount(result.profile.walletAddress, profile.walletAddress)) return;
      account.updateProfile(result.profile);
      setMessage(result.profile.avatarUrl ? "The reviewed avatar was removed. A newer upload is now current; review it before removing it."
        : "Avatar removed. Your profile and private preferences are unchanged. Previously cached images may remain visible for up to 60 seconds.");
      if (fileInput.current) fileInput.current.value = "";
    }, "avatar");
  }
  function sameSigningWallet() {
    const wallet = account.wallet;
    if (!wallet || !sameAccount(wallet.address, profile.walletAddress)) throw new Error("Connect the same profile wallet before reviewing removal.");
    return wallet;
  }
  async function reviewRemoval() {
    await run(async () => {
      const wallet = sameSigningWallet(), current = generation.current;
      await assertConnectedAccount(wallet);
      const challenge = await accountApi<ProfileChallenge>("/api/account/nonce", { method: "POST", csrfToken,
        body: { address: wallet.address, chainId: 4663, purpose: "delete-profile" } });
      assertAccountChallenge(challenge, wallet, window.location);
      if (!mounted.current || current !== generation.current) throw new Error("Wallet changed. Review removal again.");
      setRemoval(challenge); setReauthenticated(false); setConfirmed(false);
    }, "removal");
  }
  async function signRemoval() {
    await run(async () => {
      const wallet = sameSigningWallet(), current = generation.current;
      if (!removal || removal.purpose !== "delete-profile") throw new Error("Review removal first.");
      const assertCurrent = () => {
        if (!mounted.current || current !== generation.current) throw new Error("Wallet or removal review changed.");
        assertAccountChallenge(removal, wallet, window.location);
      };
      const signature = await signAccountMessage(wallet, removal.message, assertCurrent);
      await accountApi("/api/account/verify", { method: "POST", body: { message: removal.message, signature }, csrfToken });
      assertCurrent(); setReauthenticated(true); setMessage("Wallet control confirmed. Review the removal checkbox before deleting profile data.");
    }, "removal");
  }
  async function removeProfile() {
    if (!confirmed || !reauthenticated) return;
    await run(async () => {
      await accountApi("/api/account/profile", { method: "DELETE", csrfToken });
      account.notify("Profile data removed. On-chain launch history remains public."); await account.refresh();
    }, "removal");
  }
  return <div className="lpProfileLayout">
    <div className="lpStack">
      <form className="lpPanel lpForm lpProfileForm" onSubmit={(event) => void save(event)} aria-label="Edit creator profile">
        <div><span className="lpEyebrow">Public profile</span><h2>How creators find you</h2></div>
        <p>Your wallet address, name, username, bio, avatar and links are public. Profile details do not change on-chain project ownership or beneficiary terms.</p>
        <label>Username<input aria-label="Username" aria-describedby="profile-username-hint" value={draft.username ?? ""} minLength={3} maxLength={24} placeholder="your_name" autoCapitalize="none" spellCheck={false}
          onChange={(event) => setDraft({ ...draft, username: event.target.value || null })} /><small id="profile-username-hint">3–24 characters. Start with a letter; use letters, numbers or underscores. Saving a username lists it on the People page.</small></label>
        <label>Display name<input value={draft.displayName} maxLength={48} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
        <label>X username (optional)<input value={draft.xHandle ?? ""} placeholder="@username" autoCapitalize="none" spellCheck={false} maxLength={16}
          onChange={(event) => setDraft({ ...draft, xHandle: event.target.value || null })} /></label>
        <label>Bio<textarea aria-label="Bio" aria-describedby="profile-bio-hint" value={draft.bio} maxLength={280} rows={4} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /><small id="profile-bio-hint">{draft.bio.length}/280 characters · plain text</small></label>
        <fieldset><legend>Project links</legend>{draft.links.map((link, index) => <div className="lpProfileLinkRow" key={index}>
          <label>Label<input value={link.label} maxLength={32} onChange={(event) => setDraft({ ...draft, links: draft.links.map((row, i) => i === index ? { ...row, label: event.target.value } : row) })} /></label>
          <label>HTTPS URL<input type="url" value={link.url} maxLength={512} placeholder="https://" onChange={(event) => setDraft({ ...draft, links: draft.links.map((row, i) => i === index ? { ...row, url: event.target.value } : row) })} /></label>
          <button type="button" className="lpTextButton" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, i) => i !== index) })} aria-label={`Remove link ${index + 1}`}>Remove</button>
        </div>)}{draft.links.length < 3 && <button type="button" className="lpTextButton" onClick={() => setDraft({ ...draft, links: [...draft.links, { label: "", url: "" }] })}>Add HTTPS link</button>}</fieldset>
        <fieldset><legend>Private preferences</legend>
          <label>Appearance<select aria-label="Appearance" value={draft.preferences.theme} onChange={(event) => setDraft({ ...draft, preferences: { ...draft.preferences, theme: event.target.value as ProfileEdit["preferences"]["theme"] } })}>
            <option value="dark">RMT dark</option><option value="system">Use device appearance</option><option value="light">Light</option></select></label>
          <label className="lpCheck"><input type="checkbox" checked={draft.preferences.reducedMotion} onChange={(event) => setDraft({ ...draft, preferences: { ...draft.preferences, reducedMotion: event.target.checked } })} />Reduce motion</label>
          <small>Preferences are private and apply after saving.</small>
        </fieldset>
        <button className="lpButton" type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
        {noticeArea === "profile" && message && <p role="status">{message}</p>}
      </form>
      <details className="lpPanel lpDanger"><summary>Profile data and removal</summary><div className="lpForm">
        <p>Remove your profile, uploaded avatar and private preferences. On-chain transactions and launch history remain public. A fresh wallet message and a separate confirmation are required.</p>
        {!account.wallet ? <><p>Connect the same profile wallet to review removal.</p>{!account.discovered && <button type="button" className="lpButton lpSecondary" onClick={account.discoverWallets}>Choose wallet</button>}<div className="lpWalletOptions">{account.wallets.map((wallet) => <button type="button" key={wallet.id} className="lpButton lpSecondary" disabled={pending} onClick={() => void account.connect(wallet)}>Connect {wallet.name}</button>)}</div></>
          : !removal ? <button type="button" className="lpButton lpSecondary" disabled={pending} onClick={() => void reviewRemoval()}>Review profile removal</button>
          : !reauthenticated ? <><details className="lpSiweReview"><summary>Exact removal message</summary><pre>{removal.message}</pre></details><button type="button" className="lpButton lpSecondary" disabled={pending} onClick={() => void signRemoval()}>Confirm wallet for removal</button></>
          : <><label className="lpCheck"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I want to remove my RMT Launch profile data.</label>
            <button type="button" className="lpButton lpDangerButton" disabled={pending || !confirmed} onClick={() => void removeProfile()}>Delete profile data</button></>}
        {noticeArea === "removal" && message && <p role="status">{message}</p>}
      </div></details>
    </div>
    <aside className="lpPanel lpForm">
      <div className="lpProfileIdentity"><ProfileAvatar name={profile.displayName || profile.username || "R"} url={profile.avatarUrl} size={64} />
        <div><h2>Your avatar</h2><p>Used on your public creator profile</p></div></div>
      <label className="lpForm">Upload image<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={(event) => void upload(event.target.files?.[0])} /></label>
      {profile.avatarUrl && <button type="button" className="lpButton lpSecondary" disabled={pending} onClick={() => void removeCurrentAvatar()}>Remove avatar</button>}
      <p>JPG, PNG or WebP · up to 2 MiB. Images are resized and re-encoded; external image URLs are not fetched.</p>
      {noticeArea === "avatar" && message && <p role="status">{message}</p>}
      <dl className="lpFacts"><dt>Wallet</dt><dd className="lpAddress">{profile.walletAddress}</dd><dt>Network</dt><dd>Robinhood Chain 4663</dd></dl>
      <Link className="lpBack" href={profile.username ? `/u/${profile.username}` : `/creator/${profile.walletAddress}`} prefetch={false}>Open public profile</Link>
      <a className="lpButton lpSecondary" href={profileShareIntent(profile, true)} target="_blank" rel="noopener noreferrer">Share my profile on X</a>
    </aside>
  </div>;
}
