import type { Metadata } from "next";
import "./styles.css";
import "./feed.css";
import "./token-detail.css";
import "./reward-vault.css";
import "./wallet.css";
import "./brand.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Robinhood Meme Terminal",
  description: "Launch, discover, and track meme tokens on Robinhood Chain.",
  icons: { icon: "/brand/rmt-master-logo.png", apple: "/brand/rmt-master-logo.png" },
  openGraph: { images: ["/brand/rmt-master-logo.png"] },
  twitter: { card: "summary", images: ["/brand/rmt-master-logo.png"] }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
