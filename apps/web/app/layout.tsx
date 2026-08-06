import type { Metadata, Viewport } from "next";
import "./styles.css";
import "./feed.css";
import "./token-detail.css";
import "./reward-vault.css";
import "./wallet.css";
import "./brand.css";
import "./legal.css";
import "./terminal-v7.css";
import "./profile.css";
import "./sushi-lab.css";
import "./rescue-lab.css";
import "./mobile-polish.css";
import "./desktop-polish.css";
import "./external-workspace.css";
import "./trading-terms.css";
import "./watchlist-alerts.css";
import "./professional-terminal.css";
import "./community.css";
import "./experience.css";
import "./interface-polish.css";
import "./terminal-v8.css";
import "./workspace-v8.css";
import { Providers } from "./providers";
import { PublicChrome } from "./public-chrome";
import { TradingTermsGate } from "./trading-terms-gate";
import { FirstVisitGuide } from "./first-visit-guide";
import {
  RMT_SITE_ALTERNATE_NAME,
  RMT_SITE_DESCRIPTION,
  RMT_SITE_NAME,
  RMT_SITE_URL,
  rmtWebsiteStructuredData
} from "../lib/site-identity";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060906"
};

export const metadata: Metadata = {
  metadataBase: new URL(RMT_SITE_URL),
  applicationName: RMT_SITE_NAME,
  title: `${RMT_SITE_NAME} | ${RMT_SITE_ALTERNATE_NAME}`,
  description: RMT_SITE_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/rmt-master-logo.png", apple: "/brand/rmt-master-logo.png" },
  verification: { google: "UrsJaSclzhxhpbsaoELArmJs8HRqAy3yzKMxKZAJsxo" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: RMT_SITE_NAME,
    title: `${RMT_SITE_NAME} | ${RMT_SITE_ALTERNATE_NAME}`,
    description: RMT_SITE_DESCRIPTION,
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: `${RMT_SITE_NAME} | ${RMT_SITE_ALTERNATE_NAME}`,
    description: RMT_SITE_DESCRIPTION,
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(rmtWebsiteStructuredData).replace(/</g, "\\u003c")
          }}
        />
      </head>
      <body><Providers><PublicChrome /><TradingTermsGate /><FirstVisitGuide />{children}</Providers></body>
    </html>
  );
}
