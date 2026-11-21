import type { Metadata } from "next";
import type { PublicCreatorProfile } from "./profiles";
import { profilePublicPath } from "./profiles";

export const socialOrigin = "https://www.rmtlaunch.fun";
export type ShareCard = { kind: "creator" | "token" | "site"; name: string; identity: string; path: string; artwork: string | null };

export function creatorCard(profile: PublicCreatorProfile): ShareCard {
  const identity = profile.username ? "@" + profile.username : shortAddress(profile.walletAddress);
  return { kind: "creator", name: profile.displayName || identity, identity, path: profilePublicPath(profile), artwork: profile.avatarUrl };
}

export function tokenCard(token: { token: string; name: string; symbol: string; projectURI: string }): ShareCard {
  return { kind: "token", name: token.name, identity: "$" + token.symbol, path: "/launches/" + token.token.toLowerCase(), artwork: token.projectURI || null };
}

export function shortAddress(address: string) { return address.slice(0, 6) + "…" + address.slice(-4); }

export function socialMetadata(path: string, title: string, description: string, imagePath = "/share/default.png", alt = "RMT Launch on Robinhood Chain", profile = false): Metadata {
  const url = socialOrigin + path, image = socialOrigin + imagePath;
  return { title, description, alternates: { canonical: url },
    openGraph: { type: profile ? "profile" : "website", siteName: "RMT Launch", url, title, description,
      images: [{ url: image, type: "image/png", width: 1200, height: 630, alt }] },
    twitter: { card: "summary_large_image", title, description, images: [{ url: image, alt }] } };
}
