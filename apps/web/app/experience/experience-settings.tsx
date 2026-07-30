"use client";

import { useEffect, useState } from "react";
import {
  EXPERIENCE_ONBOARDING_VERSION,
  readExperiencePreferences,
  saveExperiencePreferences
} from "../../lib/experience-funnel";

export function ExperienceSettings() {
  const [ready, setReady] = useState(false);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [tourComplete, setTourComplete] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const preferences = readExperiencePreferences();
    setDiagnosticsEnabled(preferences.diagnosticsEnabled);
    setTourComplete(preferences.onboardingVersion >= EXPERIENCE_ONBOARDING_VERSION);
    setReady(true);
  }, []);

  const updateDiagnostics = (enabled: boolean) => {
    const next = saveExperiencePreferences({ diagnosticsEnabled: enabled });
    setDiagnosticsEnabled(next.diagnosticsEnabled);
    setNotice(enabled
      ? "Anonymous journey milestones are enabled for future actions in this browser session."
      : "Anonymous journey milestones are off. RMT stopped sending them from this browser.");
  };

  const replay = () => {
    saveExperiencePreferences({
      onboardingVersion: 0,
      diagnosticsEnabled
    });
    setTourComplete(false);
    window.location.assign("/");
  };

  return (
    <section className="experienceSettingsPanel" aria-labelledby="experience-settings-title">
      <header>
        <div><p className="eyebrow">DEVICE CONTROLS</p><h2 id="experience-settings-title">Your RMT experience</h2></div>
        <span>{ready ? "LOCAL TO THIS BROWSER" : "LOADING"}</span>
      </header>
      <div className="experienceSettingRow">
        <div>
          <strong>Anonymous journey milestones</strong>
          <p>When enabled, RMT counts broad steps such as opening Terminal, reviewing a market, starting wallet connection, preparing a trade, and reaching a protected quote.</p>
          <small>Never included: wallet or IP address in the stored record, token, amount, search, profile, email, transaction, exact page, advertising ID, cookie, or cross-session identifier.</small>
        </div>
        <button
          className={diagnosticsEnabled ? "enabled" : ""}
          type="button"
          role="switch"
          aria-checked={diagnosticsEnabled}
          disabled={!ready}
          onClick={() => updateDiagnostics(!diagnosticsEnabled)}
        >
          <span aria-hidden="true" />
          {diagnosticsEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="experienceSettingRow">
        <div>
          <strong>First-visit guide</strong>
          <p>Replay the short Discover → Review → Prepare orientation. This does not reset trading terms, wallet permissions, profile data, or watchlists.</p>
        </div>
        <button className="replay" type="button" disabled={!ready} onClick={replay}>
          {tourComplete ? "Replay guide" : "Open guide"}
        </button>
      </div>
      {notice && <p className="experienceSettingNotice" role="status">{notice}</p>}
    </section>
  );
}
