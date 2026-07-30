"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { isEmbeddedAuthBrowser } from "../../lib/auth-environment";
import { RMT_ADMIN_EMAIL } from "../../lib/creator-application";
import {
  PROFILE_EVENT,
  profileIdentityChanged,
  profileIdentityEditState,
  type RmtProfile,
  type TerminalDensity,
  type TraderMode
} from "../../lib/profile";
import { readWatchlist, WATCHLIST_EVENT } from "../../lib/watchlist";
import { CreatorApplicationPanel } from "../creator-application-panel";
import { FollowedProjectsHub } from "../followed-projects-hub";
import { ReferralCard } from "../referral-card";
import { SiteFooter } from "../site-footer";
import { useProfile } from "../profile-provider";

const MODES: Array<{ id: TraderMode; label: string; copy: string }> = [
  { id: "scout", label: "Scout", copy: "Discovery first. Surface risk and origin before speed." },
  { id: "momentum", label: "Momentum", copy: "Prioritize movement, flow, liquidity, and fast execution." },
  { id: "builder", label: "Builder", copy: "Keep launches, creator health, and graduation progress close." }
];

const DENSITIES: Array<{ id: TerminalDensity; label: string; copy: string }> = [
  { id: "focused", label: "Focused", copy: "Larger type, stronger hierarchy, and more breathing room." },
  { id: "compact", label: "Compact", copy: "More market rows on screen for experienced operators." }
];

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}

function editTimeLabel(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const {
    configured,
    loading,
    profile,
    identityUpdatedAt,
    retrySync,
    user,
    syncState,
    saveProfile,
    signInWithGoogle,
    signOutProfile
  } = useProfile();
  const [draft, setDraft] = useState<RmtProfile>(profile);
  const [watchCount, setWatchCount] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [embeddedAuthBrowser, setEmbeddedAuthBrowser] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const isAdmin = Boolean(user?.emailVerified && user.email?.toLowerCase() === RMT_ADMIN_EMAIL);

  useEffect(() => {
    setDraft(profile);
    setReviewing(false);
  }, [profile]);
  useEffect(() => {
    setEmbeddedAuthBrowser(isEmbeddedAuthBrowser(window.navigator.userAgent));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const refresh = () => setWatchCount(readWatchlist().length);
    refresh();
    window.addEventListener(WATCHLIST_EVENT, refresh);
    window.addEventListener(PROFILE_EVENT, refresh);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, refresh);
      window.removeEventListener(PROFILE_EVENT, refresh);
    };
  }, []);

  const syncLabel = useMemo(() => {
    if (loading) return "Loading profile";
    if (syncState === "syncing") return "Syncing changes";
    if (syncState === "synced") return "Synced across devices";
    if (syncState === "error") return "Saved here · sync needs attention";
    return configured ? "Saved on this device" : "Local profile ready";
  }, [configured, loading, syncState]);
  const identityState = profileIdentityEditState(identityUpdatedAt, now);
  const identityChanged = profileIdentityChanged(profile, draft);
  const preferencesChanged = profile.traderMode !== draft.traderMode || profile.density !== draft.density;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (identityChanged && !reviewing) {
      setReviewing(true);
      setMessage("");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await saveProfile(draft);
      setMessage(identityChanged
        ? `Identity saved. Corrections remain open for 10 minutes, then editing pauses for 24 hours.${user ? " Synced across devices." : ""}`
        : user ? "Terminal preferences saved and synced." : "Terminal preferences saved on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const beginGoogleSignIn = async () => {
    setBusy(true);
    setMessage("");
    try {
      await signInWithGoogle();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-in did not finish. Your local profile is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  const copySecureProfileLink = async () => {
    setMessage("");
    try {
      await window.navigator.clipboard.writeText(`${window.location.origin}/profile`);
      setMessage("Secure RMT profile link copied. Open it in Safari, Chrome, Firefox, or Edge to sign in.");
    } catch {
      setMessage(`Open ${window.location.origin}/profile in Safari, Chrome, Firefox, or Edge to sign in.`);
    }
  };

  const endProfileSession = async () => {
    setBusy(true);
    setMessage("");
    try {
      await signOutProfile();
      setMessage("Signed out. This device keeps its local profile copy.");
    } catch {
      setMessage("RMT could not sign out of the cloud profile. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const retryCloudSync = async () => {
    setBusy(true);
    setMessage("");
    try {
      await retrySync();
      setMessage("Profile and watchlist synced.");
    } catch {
      setMessage("Cloud sync is still unavailable. Your local profile is safe on this device.");
    } finally {
      setBusy(false);
    }
  };

  const initials = draft.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "R";

  return (
    <main className="profilePage">
      <header className="profileHero">
        <div className="profileIdentity">
          <span className="profileAvatar" aria-hidden="true">
            {initials}
          </span>
          <div>
            <p className="eyebrow">YOUR RMT DESK</p>
            <h1>{draft.displayName}</h1>
            <p>{draft.handle ? `@${draft.handle}` : "Personalize the terminal around how you find and manage runners."}</p>
          </div>
        </div>
        <div className={`profileSyncState ${syncState}`}><i aria-hidden="true" />{syncLabel}</div>
      </header>

      <section className="profilePulse" aria-label="Profile overview">
        <div><small>PROFILE</small><strong>{user ? "CLOUD" : "LOCAL"}</strong><span>{user ? "Identity hidden" : "Private by default"}</span></div>
        <div><small>WALLET</small><strong>{isConnected ? "LIVE" : "OFFLINE"}</strong><span>{shortAddress(address)}</span></div>
        <div><small>WATCHLIST</small><strong>{watchCount}</strong><span>{user ? "Synced assets" : "Saved assets"}</span></div>
        <div><small>WORKSPACE</small><strong>{draft.density.toUpperCase()}</strong><span>{draft.traderMode} mode</span></div>
      </section>

      <div className="profileWorkspace">
        <form className="profileEditor" onSubmit={submit}>
          <div className="profileSectionHeading">
            <div><p className="eyebrow">IDENTITY</p><h2>Make the desk yours</h2></div>
            <span>{identityState.phase === "locked" ? "Protected across devices" : "Never tied to transaction signing"}</span>
          </div>

          <div className={`profileIdentityPolicy ${identityState.phase}`}>
            <div>
              <strong>
                {identityState.phase === "setup" && "Set up your public-facing identity"}
                {identityState.phase === "grace" && "Correction window is open"}
                {identityState.phase === "locked" && "Identity details are protected"}
                {identityState.phase === "unlocked" && "Identity editing is available"}
              </strong>
              <span>
                {identityState.phase === "setup" && "You will review these details before saving. After a 10-minute correction window, identity changes pause for 24 hours."}
                {identityState.phase === "grace" && `Check everything carefully. The protection period begins at ${editTimeLabel(identityState.nextEditAt)}.`}
                {identityState.phase === "locked" && `Editing reopens ${editTimeLabel(identityState.nextEditAt)}. Your operating mode and density remain editable now.`}
                {identityState.phase === "unlocked" && "Your previous protection period has ended. New identity changes will start another review cycle."}
              </span>
            </div>
            <b>{identityState.phase === "locked" ? "LOCKED" : identityState.phase === "grace" ? "10 MIN WINDOW" : "REVIEW FIRST"}</b>
          </div>

          <div className="profileFieldGrid">
            <label>Display name<input disabled={!identityState.canEdit} maxLength={40} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
            <label>Handle<span className="profileHandleField"><b>@</b><input disabled={!identityState.canEdit} maxLength={24} value={draft.handle} onChange={(event) => setDraft({ ...draft, handle: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} /></span></label>
          </div>
          <label>Desk note<textarea disabled={!identityState.canEdit} maxLength={180} placeholder="What are you watching for?" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>

          <fieldset className="profileChoiceGroup">
            <legend>Default operating mode</legend>
            <div>{MODES.map((mode) => <label className={draft.traderMode === mode.id ? "selected" : ""} key={mode.id}><input type="radio" name="mode" value={mode.id} checked={draft.traderMode === mode.id} onChange={() => setDraft({ ...draft, traderMode: mode.id })} /><strong>{mode.label}</strong><span>{mode.copy}</span></label>)}</div>
          </fieldset>

          <fieldset className="profileChoiceGroup densityChoices">
            <legend>Information density</legend>
            <div>{DENSITIES.map((density) => <label className={draft.density === density.id ? "selected" : ""} key={density.id}><input type="radio" name="density" value={density.id} checked={draft.density === density.id} onChange={() => setDraft({ ...draft, density: density.id })} /><strong>{density.label}</strong><span>{density.copy}</span></label>)}</div>
          </fieldset>

          {reviewing && identityChanged && (
            <section className="profileReview" aria-label="Review identity before saving">
              <p className="eyebrow">FINAL REVIEW</p>
              <h3>Confirm what other RMT users may see</h3>
              <dl>
                <div><dt>Display name</dt><dd>{draft.displayName}</dd></div>
                <div><dt>Handle</dt><dd>{draft.handle ? `@${draft.handle}` : "No handle"}</dd></div>
                <div><dt>Desk note</dt><dd>{draft.bio || "No desk note"}</dd></div>
              </dl>
              <p>You can correct identity details for 10 minutes after saving. After that, they remain unchanged for 24 hours. Wallet permissions are never included.</p>
              <button type="button" onClick={() => setReviewing(false)}>Go back and edit</button>
            </section>
          )}

          <div className="profileSaveRow">
            <button className="profileSave" type="submit" disabled={busy || loading || (!identityChanged && !preferencesChanged)}>
              {busy ? "Saving…" : loading ? "Loading…" : reviewing && identityChanged
                ? "Confirm and protect profile"
                : identityChanged ? "Review changes" : preferencesChanged ? "Save preferences" : "Profile up to date"}
            </button>
            {message && <p role="status">{message}</p>}
          </div>
        </form>

        <aside className="profileRail">
          {isAdmin && <section className="profileAdminCard">
            <p className="eyebrow">PRIVATE RMT OPERATIONS</p>
            <h2>RMT Admin</h2>
            <p>Moderate live messages, review applications, and manage creator requests.</p>
            <Link href="/admin">Open Admin Dashboard →</Link>
          </section>}
          <section className="profileCloudCard">
            <p className="eyebrow">CROSS-DEVICE PROFILE</p>
            <h2>{user ? "Your desk follows you" : "Take your desk anywhere"}</h2>
            <p>{user ? "Profile preferences and watched RMT tokens sync through your private Firebase workspace. RMT does not display your Google email or photo." : "Sign in to carry your profile and watchlist between desktop and mobile. Wallet connection stays separate."}</p>
            {user ? (
              <div className="profileCloudActions">
                {syncState === "error" && <button className="profileRetryButton" type="button" disabled={busy} onClick={() => void retryCloudSync()}>Retry sync</button>}
                <button type="button" disabled={busy} onClick={() => void endProfileSession()}>Sign out of profile</button>
              </div>
            ) : configured && embeddedAuthBrowser ? (
              <div className="profileAuthBrowserNotice">
                <strong>Open RMT in your browser to sign in</strong>
                <span>Google protects accounts by blocking sign-in inside some in-app browsers. Open this profile page in Safari, Chrome, Firefox, or Edge; your local desk stays on this device until you sign in.</span>
                <div>
                  <a href="/profile" target="_blank" rel="noreferrer">Open secure sign-in ↗</a>
                  <button type="button" disabled={busy} onClick={() => void copySecureProfileLink()}>Copy profile link</button>
                </div>
              </div>
            ) : configured ? (
              <button className="googleProfileButton" type="button" disabled={busy || loading} onClick={() => void beginGoogleSignIn()}>
                {loading ? "Preparing secure sign-in…" : "Continue with Google"}
              </button>
            ) : (
              <div className="profileSetupNotice"><strong>Firebase connection prepared</strong><span>Add the project configuration to enable Google profile sync.</span></div>
            )}
          </section>
          <ReferralCard />

          <nav className="profileQuickLinks" aria-label="Your RMT workspace">
            <p className="eyebrow">YOUR WORKSPACE</p>
            <Link href="/watchlist"><span>Watchlist</span><b>{watchCount} saved →</b></Link>
            <Link href="/portfolio"><span>Portfolio</span><b>Onchain holdings →</b></Link>
            <Link href="/explore"><span>Explore markets</span><b>Find movement →</b></Link>
          </nav>

          <section className="profilePrivacy">
            <strong>Profile ≠ wallet custody</strong>
            <p>RMT profile sign-in never exposes a seed phrase and never grants transaction permission. Every trade still requires your wallet confirmation.</p>
          </section>
        </aside>
      </div>
      <FollowedProjectsHub />
      <CreatorApplicationPanel />
      <SiteFooter />
    </main>
  );
}
