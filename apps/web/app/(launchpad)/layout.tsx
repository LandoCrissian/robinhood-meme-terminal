import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { isLaunchShowcase } from "../../lib/server/launchpad-site-mode";
import { AppRuntime } from "../app-runtime";
import "../vnext/vnext-terminal.css";
import "../token-detail.css";
import "./launchpad.css";

export const metadata: Metadata = {
  title: "RMT Launch | Token Launchpad",
  description: "Browse RMT token launches and review fixed supply, curve trading and Uniswap v4 graduation before signing.",
  robots: { index: false, follow: false },
};

export default async function LaunchpadLayout({ children }: { children: ReactNode }) {
  await connection();
  return <AppRuntime showcase={isLaunchShowcase()}>{children}</AppRuntime>;
}
