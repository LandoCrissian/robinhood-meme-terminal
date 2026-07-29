"use client";

import { useEffect, useState } from "react";
import {
  createReferralCode,
  loadReferralSummary,
  referralUrl,
  referralXIntent,
  type ReferralSummary
} from "../lib/referrals";
import { useProfile } from "./profile-provider";

export function ReferralCard() {
  const { configured, user } = useProfile();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setSummary(null);
      return;
    }
    setLoading(true);
    void loadReferralSummary(user)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        if (!cancelled) setMessage("Referral status is temporarily unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function activateCode() {
    if (!user) return;
    setLoading(true);
    setMessage("");
    try {
      const code = await createReferralCode(user);
      setSummary({ code, verifiedActivations: 0 });
      setMessage("Your permanent RMT invite is ready.");
    } catch {
      setMessage("RMT could not create the invite yet. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyInvite() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(referralUrl(summary.code, window.location.origin));
      setMessage("Invite link copied.");
    } catch {
      setMessage("Copy is unavailable in this browser.");
    }
  }

  function shareOnX() {
    if (!summary) return;
    window.open(referralXIntent(summary.code, window.location.origin), "_blank", "noopener,noreferrer");
  }

  return (
    <section className="profileReferralCard">
      <p className="eyebrow">RMT INVITES</p>
      <h2>Build your network</h2>
      {!user ? (
        <>
          <p>Sign in to create one permanent invite code and track verified profile activations.</p>
          <span className="referralAvailability">{configured ? "PROFILE SIGN-IN REQUIRED" : "FIREBASE REQUIRED"}</span>
        </>
      ) : summary ? (
        <>
          <div className="referralCodeLine"><strong>{summary.code}</strong><span>PERMANENT</span></div>
          <div className="referralMetric"><small>VERIFIED ACTIVATIONS</small><strong>{summary.verifiedActivations}</strong></div>
          <div className="referralActions">
            <button type="button" onClick={() => void copyInvite()}>Copy invite</button>
            <button className="referralXButton" type="button" onClick={shareOnX}>Share on 𝕏 ↗</button>
          </div>
          <p className="referralFinePrint">Clicks do not count. RMT records one activation only after a referred user signs in and saves a protected profile.</p>
        </>
      ) : (
        <>
          <p>Create a permanent code for sharing RMT. Rewards are not enabled; this first release measures genuine community growth.</p>
          <button className="referralActivateButton" type="button" disabled={loading} onClick={() => void activateCode()}>
            {loading ? "Preparing…" : "Create my invite code"}
          </button>
        </>
      )}
      {message && <p className="referralMessage" role="status">{message}</p>}
    </section>
  );
}
