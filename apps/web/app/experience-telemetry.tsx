"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  EXPERIENCE_PREFERENCES_EVENT,
  readExperiencePreferences,
  recordExperienceStage
} from "../lib/experience-funnel";

function publicTradingSurface(pathname: string) {
  return pathname === "/" || pathname.startsWith("/market/");
}

export function ExperienceTelemetry() {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const [preferenceRevision, setPreferenceRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setPreferenceRevision((value) => value + 1);
    window.addEventListener(EXPERIENCE_PREFERENCES_EVENT, refresh);
    return () => window.removeEventListener(EXPERIENCE_PREFERENCES_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!readExperiencePreferences().diagnosticsEnabled || !publicTradingSurface(pathname)) return;
    recordExperienceStage("visit_started");
    if (pathname === "/") recordExperienceStage("terminal_opened");
    if (pathname.startsWith("/market/")) {
      recordExperienceStage("market_opened");
    }
  }, [pathname, preferenceRevision]);

  useEffect(() => {
    if (isConnected) recordExperienceStage("wallet_connected");
  }, [isConnected, preferenceRevision]);

  return null;
}
