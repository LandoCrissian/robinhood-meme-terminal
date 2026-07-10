import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Robinhood Meme Terminal",
  description: "Launch, discover, and track meme tokens on Robinhood Chain."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
