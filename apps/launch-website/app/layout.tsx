import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import logo from "../public/brand/rmt-master-logo.png";
import "./styles/styles.css";
import "./styles/mobile-polish.css";
import "./styles/desktop-polish.css";
import "./styles/launch-theme.css";
import "./styles/token-detail.css";
import "./launchpad.css";
import { LaunchShell } from "./_components/launch-shell";
import { configuredCurveFixture } from "../lib/server/curve-fixture";
import { AccountProvider } from "./_components/account-provider";
import "./profile-refinement.css";
import "./creator-polish.css";
import "./earnings.css";
import "./product.css";

export const metadata: Metadata = {
  title: "RMT Launch | Token Launchpad",
  description: "Explore tokens and creators on Robinhood Chain, build your public profile and prepare a token launch.",
  robots: { index: false, follow: false },
  icons: { icon: logo.src, apple: logo.src },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060906",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return <html lang="en"><body><AccountProvider><LaunchShell fixture={Boolean(configuredCurveFixture(await headers()))}>{children}</LaunchShell></AccountProvider></body></html>;
}
