import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import logo from "../../web/public/brand/rmt-master-logo.png";
import "../../web/app/styles.css";
import "../../web/app/brand.css";
import "../../web/app/legal.css";
import "../../web/app/mobile-polish.css";
import "../../web/app/desktop-polish.css";
import "../../web/app/vnext/vnext-terminal.css";
import "../../web/app/token-detail.css";
import "./launchpad.css";
import { LaunchShell } from "./_components/launch-shell";

export const metadata: Metadata = {
  title: "RMT Launch | Token Launchpad",
  description: "Read-only preview of RMT token discovery, curve trading and Uniswap v4 graduation.",
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
  return <html lang="en"><body><LaunchShell>{children}</LaunchShell></body></html>;
}
