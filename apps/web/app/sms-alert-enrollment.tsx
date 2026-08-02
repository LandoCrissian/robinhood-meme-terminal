"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SMS_ALERT_CONSENT_VERSION,
  SMS_ALERT_MAX_PER_DAY,
  type SmsAlertPreferenceStatus
} from "../lib/sms-alerts";
import { useRmtIdentity } from "./rmt-identity";

export function SmsAlertEnrollment() {
  const identity = useRmtIdentity();
  const [status, setStatus] = useState<SmsAlertPreferenceStatus | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!identity.authenticated || !identity.identityToken) return;
    const response = await fetch("/api/alerts/sms-preference", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${identity.identityToken}` }
    });
    const body = await response.json() as SmsAlertPreferenceStatus & { error?: string };
    if (!response.ok) throw new Error(body.error || "Phone-alert status is unavailable.");
    setStatus(body);
  }, [identity.authenticated, identity.identityToken]);

  useEffect(() => {
    setMessage("");
    if (!identity.authenticated || !identity.identityToken) {
      setStatus(null);
      return;
    }
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Phone-alert status is unavailable."));
  }, [identity.authenticated, identity.identityToken, identity.linked.phone, refresh]);

  const update = async (action: "enable" | "disable") => {
    if (!identity.identityToken) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/alerts/sms-preference", {
        body: JSON.stringify({
          action,
          consent: action === "enable" ? consent : undefined,
          consentVersion: SMS_ALERT_CONSENT_VERSION,
          maxDailyMessages: SMS_ALERT_MAX_PER_DAY
        }),
        headers: {
          Authorization: `Bearer ${identity.identityToken}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = await response.json() as SmsAlertPreferenceStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Phone-alert settings could not be updated.");
      setStatus(body);
      setConsent(false);
      setMessage(action === "enable" ? "Phone alerts enabled." : "Phone alerts disabled immediately.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Phone-alert settings could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  if (!identity.authenticated) return null;
  const last4 = status?.phoneLast4 || identity.phoneLast4;
  const phoneLinked = status?.phoneLinked ?? identity.linked.phone;
  const enabled = status?.enabled === true;
  const available = status?.available === true;
  const active = enabled && available;

  return (
    <section className="profileSmsAlerts" aria-labelledby="profile-sms-alerts-title">
      <div className="profileSmsHeading">
        <div>
          <p className="eyebrow">WALK-AWAY PROTECTION</p>
          <h2 id="profile-sms-alerts-title">Phone alerts</h2>
        </div>
        <span className={active ? "active" : "locked"}>{active ? "ACTIVE" : enabled ? "PAUSED" : "DELIVERY LOCKED"}</span>
      </div>
      <p>Receive only the watchlist triggers you create—such as price, liquidity, runner pace, or sell-pressure changes.</p>
      {!phoneLinked ? (
        <button type="button" onClick={identity.linkPhone}>Verify a phone with Privy</button>
      ) : (
        <div className="profileSmsPhone">
          <span>VERIFIED PHONE</span>
          <strong>••• ••• {last4 || "linked"}</strong>
        </div>
      )}
      {phoneLinked && !available && !enabled && (
        <div className="profileSmsLock">
          <strong>Your phone is ready; sending remains off.</strong>
          <span>RMT will not collect alert consent or send texts until background monitoring, carrier registration, STOP handling, and a strict spending cap are active together.</span>
        </div>
      )}
      {phoneLinked && available && !enabled && (
        <>
          <label className="profileSmsConsent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I agree to receive up to {SMS_ALERT_MAX_PER_DAY} automated RMT alert texts per day at my verified number. Message and data rates may apply. Consent is optional. Reply STOP to opt out.</span>
          </label>
          <button type="button" disabled={!consent || busy} onClick={() => void update("enable")}>Enable phone alerts</button>
        </>
      )}
      {enabled && (
        <>
          <div className={`profileSmsLock ${active ? "active" : ""}`}>
            <strong>{active
              ? `Up to ${status?.maxDailyMessages ?? SMS_ALERT_MAX_PER_DAY} alerts per day`
              : "RMT has paused text delivery"}</strong>
            <span>{active
              ? "Only rules you explicitly create are eligible. RMT does not place, change, or close a trade from a text alert."
              : "No texts will be sent while the provider or background monitor is unavailable. You can still disable consent below."}</span>
          </div>
          <button type="button" disabled={busy} onClick={() => void update("disable")}>Disable phone alerts</button>
        </>
      )}
      <small>Delivery is informational and is not guaranteed. Never reply with a seed phrase, private key, or verification code.</small>
      {message && <p className="profileSmsMessage" role="status">{message}</p>}
    </section>
  );
}
