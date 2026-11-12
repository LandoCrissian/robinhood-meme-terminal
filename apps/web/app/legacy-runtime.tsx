"use client";

import type { ReactNode } from "react";
import "./feed.css";
import "./reward-vault.css";
import "./profile.css";
import "./trading-terms.css";
import "./watchlist-alerts.css";
import "./community.css";
import "./experience.css";
import "./interface-polish.css";
import { Providers } from "./providers";

export default function LegacyRuntime({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
