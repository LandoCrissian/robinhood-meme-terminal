import { cache } from "react";
import { profileAddress, profileEdit, type PublicCreatorProfile } from "../profiles";

// Immutable review deployments may carry a dated snapshot of already-public profiles.
// Production and local authentication always use their own existing provider.
export function reviewOrigin(headers: Headers): string | null {
  const host = headers.get("host") || "";
  return /^[a-f0-9]{24}--eclectic-valkyrie-16cb92\.netlify\.app$/.test(host) ? "https://" + host : null;
}

export const reviewAvatarPath = /^\/_next\/static\/public-review\/[0-9a-f]{64}\.webp$/;
export const readPublicReview = cache(async (origin: string) => {
  const response = await fetch(origin + "/_next/static/public-review/people.json", { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Public review is unavailable");
  const text = await response.text();
  if (text.length > 100_000) throw new Error("Invalid directory size");
  const snapshot = JSON.parse(text);
  if (!Array.isArray(snapshot.profiles) || snapshot.profiles.length > 26 || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error("Invalid directory");
  const profiles = snapshot.profiles.map((row: PublicCreatorProfile): PublicCreatorProfile => {
    const walletAddress = profileAddress(row.walletAddress);
    const fields = profileEdit({ username:row.username, displayName:row.displayName, bio:row.bio, xHandle:row.xHandle,
      links:row.links, preferences:{theme:"system",reducedMotion:false} }, walletAddress);
    if (!fields.username || row.chainId !== 4663 || (row.avatarUrl !== null && !reviewAvatarPath.test(row.avatarUrl))) throw new Error("Invalid public profile");
    return { walletAddress, chainId:4663, username:fields.username, displayName:fields.displayName, bio:fields.bio, links:fields.links,
      xHandle:fields.xHandle, avatarUrl:row.avatarUrl, createdAt:row.createdAt, updatedAt:row.updatedAt };
  });
  return { profiles: profiles as PublicCreatorProfile[], capturedAt: new Date(snapshot.capturedAt).toISOString().slice(0,10) };
});
