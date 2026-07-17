export type TraderMode = "scout" | "momentum" | "builder";
export type TerminalDensity = "focused" | "compact";

export type RmtProfile = {
  displayName: string;
  handle: string;
  bio: string;
  traderMode: TraderMode;
  density: TerminalDensity;
};

export const DEFAULT_PROFILE: RmtProfile = {
  displayName: "RMT Trader",
  handle: "",
  bio: "",
  traderMode: "scout",
  density: "focused"
};

export const PROFILE_EVENT = "rmt:profile-changed";
const STORAGE_KEY = "rmt-profile-v1";

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeProfile(value: unknown): RmtProfile {
  if (!value || typeof value !== "object") return DEFAULT_PROFILE;
  const profile = value as Partial<RmtProfile>;
  return {
    displayName: cleanText(profile.displayName, 40) || DEFAULT_PROFILE.displayName,
    handle: cleanText(profile.handle, 24).replace(/^@+/, "").replace(/[^a-zA-Z0-9_]/g, ""),
    bio: cleanText(profile.bio, 180),
    traderMode: profile.traderMode === "momentum" || profile.traderMode === "builder" ? profile.traderMode : "scout",
    density: profile.density === "compact" ? "compact" : "focused"
  };
}

export function readLocalProfile() {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    return normalizeProfile(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function writeLocalProfile(profile: RmtProfile) {
  if (typeof window === "undefined") return;
  const normalized = normalizeProfile(profile);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(PROFILE_EVENT));
}
