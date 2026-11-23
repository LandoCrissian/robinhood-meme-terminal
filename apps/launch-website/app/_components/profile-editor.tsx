"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AccountApiError, accountApi, accountErrorMessage } from "../../lib/account-api";
import { photoAccept, prepareUploadImage } from "../../lib/prepare-upload-image";
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
    <header className="lpPageHeading"><div><h1>Edit profile</h1><p>Manage your public photo, details and links.</p></div>
      <Link className="lpButton lpSecondary" href="/wallet" prefetch={false}>Wallet account</Link></header>
    {checking && !session.authenticated ? <div className="lpSkeleton" role="status">Loading your account…</div> : session.authenticated
      ? <AuthenticatedEditor key={session.account.walletAddress} profile={session.account.profile} csrfToken={session.csrfToken} /> : <WalletAccount compact />}
  </>;
}

function AuthenticatedEditor({ profile, csrfToken }: { profile: AccountProfile; csrfToken: string }) {
  const account = useAccount();
  const [draft, setDraft] = useState(() => editable(profile)), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [noticeArea, setNoticeArea] = useState<"profile" | "avatar" | "removal">("profile");
  const [removal, setRemoval] = useState<ProfileChallenge>(), [reauthenticated, setReauthenticated] = useState(false), [confirmed, setConfirmed] = useState(false);
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<File>(), [avatarPreview, setAvatarPreview] = useState("");
  useEffect(() => {
    if (!selectedAvatar) { setAvatarPreview(""); return; }
    const url = URL.createObjectURL(selectedAvatar); setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedAvatar]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setRemoval(undefined); setReauthenticated(false); setConfirmed(false); }, [account.wallet]);

  async function run(action: () => Promise<void>, area: "profile" | "avatar" | "removal" = "profile") {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(area === "profile" ? "Saving profile…" : ""); setNoticeArea(area);
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(testWalletErrorCode(error) === 4001 ? "You declined the wallet message. No profile deletion occurred."
      : error instanceof Error && !("status" in error) ? error.message : accountErrorMessage(error)); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const [invalid,setInvalid] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    const form=event.currentTarget;
    const focusField=(key:string) => {
      setInvalid(key);
      const field=form.elements.namedItem(key);
      if(field instanceof HTMLElement) field.focus();
    };
    event.preventDefault();
    await run(async () => {
      setInvalid("");
      let body: ProfileEdit;
      try { body=profileEdit(draft,profile.walletAddress); } catch(error) {
        const reason=error instanceof Error ? error.message : "";
        const link=reason.match(/Project link (\d+)/);
        if (/link label/i.test(reason)) focusField("label-"+draft.links.findIndex(row=>Array.from(row.label.normalize("NFC").trim()).length>32 || /[<>\p{Cc}\p{Cf}]/u.test(row.label)));
        else if(link) focusField("url-"+(Number(link[1])-1));
        else if (/username|reserved/i.test(reason)) focusField(/X username/.test(reason)?"xHandle":"username");
        else if (/display name|bio/i.test(reason)) focusField(/bio/i.test(reason)?"bio":"displayName");
        throw error;
      }
      const result = await accountApi<{ profile: AccountProfile }>("/api/account/profile", { method: "PATCH", body, csrfToken }).catch(error => {
        if (error instanceof AccountApiError) { if (error.code === "username_taken") focusField("username"); throw error; }
        throw new Error("Save could not be confirmed. Check your connection and try saving again.");
      });
      if (!mounted.current) return;
      if (!sameAccount(result.profile.walletAddress, profile.walletAddress)) throw new Error("The saved profile could not be confirmed for this wallet. Refresh to check your profile.");
      account.updateProfile(result.profile); setDraft(editable(result.profile)); setMessage("Profile saved. Public details and private preferences are stored separately.");
    });
  }
  async function upload(file?: File, retry = false) {
    if (!file || busy.current) return;
    const current = generation.current;
    const check = () => {
      if (!mounted.current || current !== generation.current) throw new Error("Your wallet connection changed. Check the account and retry.");
    };
    await run(async () => {
      if (!retry) { setSelectedAvatar(undefined); setMessage("Optimizing your photo…"); }
      const prepared = retry ? file : await prepareUploadImage(file, "avatar");
      check(); setSelectedAvatar(prepared); setMessage("Uploading your avatar…");
      const body = new FormData(); body.set("file", prepared);
      const result = await accountApi<{ profile: AccountProfile }>("/api/account/avatar", { method: "POST", body, csrfToken, signal: AbortSignal.timeout(30_000) })
        .catch(error => {
          if (error instanceof AccountApiError && [401,403,429].includes(error.status)) throw error;
          if (error instanceof AccountApiError && [400,413,422].includes(error.status)) throw new Error("The server could not validate this image. Choose another photo.");
          throw new Error("Avatar save could not be confirmed. Check your connection and retry the upload.");
        });
      check();
      if (!result.profile.avatarUrl || !sameAccount(result.profile.walletAddress, profile.walletAddress)) throw new Error("Could not confirm the saved avatar for this account. Refresh to check your profile.");
      account.updateProfile(result.profile); setSelectedAvatar(undefined); setMessage("Avatar updated. Your photo is saved to your public profile.");
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
  return <div className="lpEditorFlow">    <section className="lpPanel lpForm lpAvatarEditor" aria-label="Profile photo">
      <div className="lpProfileIdentity"><ProfileAvatar name={profile.displayName || profile.username || "R"} url={profile.avatarUrl} size={64} />
        <div><h2>Profile photo</h2><p>Shown on your profile, in People and on your share card</p></div></div>
      <label className="lpForm">Upload image<input ref={fileInput} type="file" accept={photoAccept} disabled={pending} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void upload(file);
      }} /></label>
      <small>Choosing a photo saves your avatar automatically. JPEG, PNG, WebP and supported HEIC photos up to 24 MiB.</small>
      {selectedAvatar && avatarPreview && <img className="lpArtworkPreview" src={avatarPreview} alt="Selected avatar preview" />}
      {pending && noticeArea === "avatar" && <progress aria-label="Saving avatar" />}
      <div role="status" aria-live="polite">{noticeArea === "avatar" && message}</div>
      {selectedAvatar && !pending && <button type="button" className="lpButton lpSecondary" onClick={() => void upload(selectedAvatar, true)}>Retry avatar upload</button>}
      {profile.avatarUrl && <button type="button" className="lpButton lpSecondary" disabled={pending} onClick={() => { setSelectedAvatar(undefined); void removeCurrentAvatar(); }}>Remove avatar</button>}
    </section>
    <div className="lpStack">
      <form className="lpPanel lpForm lpProfileForm" noValidate onInput={()=>setInvalid("")} onSubmit={(event) => void save(event)} aria-label="Edit profile">
        <h2>Public details</h2>
        <p>Save your changes to update your public profile.</p>
        <label>Display name<input name="displayName" aria-invalid={invalid==="displayName" || undefined} aria-errormessage={invalid==="displayName"?"profile-save-message":undefined} value={draft.displayName} maxLength={96} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
        <label>Username<input name="username" aria-invalid={invalid==="username" || undefined} aria-errormessage={invalid==="username"?"profile-save-message":undefined} aria-label="Username" aria-describedby="profile-username-hint" value={draft.username ?? ""} minLength={3} maxLength={24} placeholder="your_name" autoCapitalize="none" spellCheck={false}
          onChange={(event) => setDraft({ ...draft, username: event.target.value || null })} /><small id="profile-username-hint">3–24 characters. Start with a letter; use letters, numbers or underscores. Saving a username lists it on the People page.</small></label>
        <label>Bio<textarea name="bio" aria-invalid={invalid==="bio" || undefined} aria-errormessage={invalid==="bio"?"profile-save-message":undefined} aria-label="Bio" aria-describedby="profile-bio-hint" value={draft.bio} maxLength={560} rows={4} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /><small id="profile-bio-hint">{Array.from(draft.bio.normalize("NFC")).length}/280 characters · plain text</small></label>
        <label>X username (optional)<input name="xHandle" aria-invalid={invalid==="xHandle" || undefined} aria-errormessage={invalid==="xHandle"?"profile-save-message":undefined} value={draft.xHandle ?? ""} placeholder="@username" autoCapitalize="none" spellCheck={false} maxLength={16}
          onChange={(event) => setDraft({ ...draft, xHandle: event.target.value || null })} /></label>
        <fieldset><legend>Project links</legend>{draft.links.map((link, index) => <div className="lpProfileLinkRow" key={index}>
          <label>Label<input name={"label-"+index} aria-invalid={invalid==="label-"+index || undefined} aria-errormessage={invalid==="label-"+index?"profile-save-message":undefined} value={link.label} maxLength={64} onChange={(event) => setDraft({ ...draft, links: draft.links.map((row, i) => i === index ? { ...row, label: event.target.value } : row) })} /></label>
          <label>HTTPS URL<input name={"url-"+index} aria-invalid={invalid==="url-"+index || undefined} aria-errormessage={invalid==="url-"+index?"profile-save-message":undefined} type="url" value={link.url} maxLength={512} placeholder="https://" onChange={(event) => setDraft({ ...draft, links: draft.links.map((row, i) => i === index ? { ...row, url: event.target.value } : row) })} /></label>
          <button type="button" className="lpTextButton" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, i) => i !== index) })} aria-label={`Remove link ${index + 1}`}>Remove</button>
        </div>)}{draft.links.length < 3 && <button type="button" className="lpTextButton" onClick={() => setDraft({ ...draft, links: [...draft.links, { label: "", url: "" }] })}>Add HTTPS link</button>}</fieldset>
        <details className="lpDisclosure"><summary>Private preferences</summary><fieldset><legend className="lpVisuallyHidden">Private preferences</legend>
          <label>Appearance<select aria-label="Appearance" value={draft.preferences.theme} onChange={(event) => setDraft({ ...draft, preferences: { ...draft.preferences, theme: event.target.value as ProfileEdit["preferences"]["theme"] } })}>
            <option value="dark">RMT dark</option><option value="system">Use device appearance</option><option value="light">Light</option></select></label>
          <label className="lpCheck"><input type="checkbox" checked={draft.preferences.reducedMotion} onChange={(event) => setDraft({ ...draft, preferences: { ...draft.preferences, reducedMotion: event.target.checked } })} />Reduce motion</label>
          <small>Preferences are private and apply after saving.</small>
        </fieldset></details>
        <div id="profile-save-message" role="status" aria-live="polite" aria-atomic="true">{noticeArea === "profile" && message && <p className="lpInlineNotice">{message}</p>}</div>
        <button className="lpButton" type="submit" disabled={pending}>{pending && noticeArea === "profile" ? "Saving…" : "Save profile"}</button>
        <Link className="lpUtility" href={profile.username ? "/u/"+profile.username : "/creator/"+profile.walletAddress} prefetch={false}>Open public profile</Link>
        <a className="lpUtility" href={profileShareIntent(profile,true)} target="_blank" rel="noopener noreferrer">Share my profile ↗</a>
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

  </div>;
}
