import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../vnext/vnext-terminal.css";
import "../token-detail.css";
import "./launchpad.css";

export const metadata: Metadata = {
  title: "RMT Launch | Token Launchpad",
  description: "Browse RMT token launches and review fixed supply, seeded liquidity and position custody before signing.",
  robots: { index: false, follow: false },
};

export default function LaunchpadLayout({ children }: { children: ReactNode }) {
  return children;
}
