import type { Metadata } from "next";
import "./styles.css";
import "./feed.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Robinhood Meme Terminal",
  description: "Launch, discover, and track meme tokens on Robinhood Chain."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
