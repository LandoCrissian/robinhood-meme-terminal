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
import "./mobile-polish.css";
import "./desktop-polish.css";
import { Providers } from "./providers";
import { PublicChrome } from "./public-chrome";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060906"
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.rmtlaunch.fun"),
  title: "Robinhood Meme Terminal",
  description: "Launch, discover, and track meme tokens on Robinhood Chain.",
  alternates: { canonical: "/" },
  icons: { icon: "/brand/rmt-master-logo.png", apple: "/brand/rmt-master-logo.png" },
  verification: { google: "UrsJaSclzhxhpbsaoELArmJs8HRqAy3yzKMxKZAJsxo" },
  openGraph: {
    url: "https://www.rmtlaunch.fun",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: { card: "summary", images: ["/brand/rmt-master-logo.png"] }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers><PublicChrome />{children}</Providers></body>
    </html>
  );
}
