import { getAddress, type Address } from "viem";

export const profileChainId = 4663 as const;
export const profileSignInStatement = "Sign in to RMT Launch";
export const profileDeleteStatement = "Confirm removal of your RMT Launch profile";
export type ProfileLink = { label: string; url: string };
export type ProfilePreferences = { theme: "system" | "dark" | "light"; reducedMotion: boolean };
export type PublicCreatorProfile = {
  walletAddress: Address; chainId: typeof profileChainId; username: string | null;
  displayName: string; bio: string; xHandle?: string | null; links: ProfileLink[]; avatarUrl: string | null;
  createdAt: string; updatedAt: string;
};
export type AccountProfile = PublicCreatorProfile & { preferences: ProfilePreferences };
export type AccountSession =
  | { authenticated: false; availability: "disabled" | "available" | "unavailable" }
  | { authenticated: true; availability: "available"; account: { walletAddress: Address; chainId: typeof profileChainId; profile: AccountProfile }; csrfToken: string };
export type ProfileEdit = Pick<AccountProfile, "username" | "displayName" | "bio" | "xHandle" | "links" | "preferences">;
export type ProfileChallenge = { message: string; nonce: string; expiresAt: string; purpose: "login" | "delete-profile" };

const reserved = new Set(["admin", "administrator", "api", "account", "create", "create_token", "creator", "help", "launches", "login", "logout", "my_launches", "official", "operations", "reserve", "rmt", "rmtlaunch", "root", "safe", "security", "settings", "staff", "support", "system", "wallet"]);
export function profileAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || BigInt(value) === 0n) throw new Error("A valid wallet address is required.");
  return getAddress(value);
}
export function profileUsername(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid username.");
  const name = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(name) || reserved.has(name) || /^(?:rmt_|admin_|support_|official_)/.test(name)) {
    throw new Error("Choose an available username of 3–24 letters, numbers or underscores; official names are reserved.");
  }
  return name;
}
function plain(value: unknown, maximum: number, label: string) {
  if (typeof value !== "string") throw new Error(`Invalid ${label}.`);
  const normalized = value.normalize("NFC").trim();
  if (Array.from(normalized).length > maximum || /[<>\p{Cc}\p{Cf}]/u.test(normalized)) throw new Error(`${label} must be plain text of at most ${maximum} characters.`);
  return normalized;
}
export function profileXHandle(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Enter an X username.");
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle) || /^(home|intent|i|explore|messages|settings|search|notifications|compose|login|logout|signup|share)$/.test(handle)) {
    throw new Error("Enter an X username of up to 15 letters, numbers or underscores.");
  }
  return handle;
}
export function profileShareIntent(profile: Pick<PublicCreatorProfile, "username" | "walletAddress">) {
  const username = profileUsername(profile.username);
  const path = username ? "/u/" + username : "/creator/" + profileAddress(profile.walletAddress);
  const params = new URLSearchParams({ url: "https://www.rmtlaunch.fun" + path, text: "Check out this creator on RMT Launch" });
  return "https://twitter.com/intent/tweet?" + params.toString();
}
export function profileEdit(value: unknown): ProfileEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid profile.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["username", "displayName", "bio", "xHandle", "links", "preferences"].includes(key))) throw new Error("Unexpected profile field.");
  if (!Array.isArray(row.links) || row.links.length > 3) throw new Error("Use at most three HTTPS links.");
  const links = row.links.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["label", "url"].includes(key))) throw new Error("Invalid profile link.");
    const { label, url } = item as Record<string, unknown>;
    if (typeof url !== "string" || url.length > 512) throw new Error("Invalid HTTPS link.");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname || /[\p{Cc}\p{Cf}]/u.test(url)) throw new Error("Links must use HTTPS without embedded credentials.");
    return { label: plain(label, 32, "Link label"), url: parsed.href };
  });
  const prefs = row.preferences;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) throw new Error("Invalid profile preferences.");
  const settings = prefs as Record<string, unknown>;
  if (Object.keys(settings).some(key => !["theme", "reducedMotion"].includes(key)) || !["system", "dark", "light"].includes(String(settings.theme)) || typeof settings.reducedMotion !== "boolean") throw new Error("Invalid profile preferences.");
  return { username: profileUsername(row.username), displayName: plain(row.displayName, 48, "Display name"), bio: plain(row.bio, 280, "Bio"), links,
    ...(Object.hasOwn(row, "xHandle") && { xHandle: profileXHandle(row.xHandle) }),
    preferences: { theme: settings.theme as ProfilePreferences["theme"], reducedMotion: settings.reducedMotion } };
}
