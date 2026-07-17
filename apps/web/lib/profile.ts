export type TraderMode = "scout" | "momentum" | "builder";
export type TerminalDensity = "focused" | "compact";

export type RmtProfile = {
  displayName: string;
  handle: string;
  bio: string;
  traderMode: TraderMode;
  density: TerminalDensity;
};

export type LocalProfileSnapshot = {
  profile: RmtProfile;
  updatedAt: number;
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
const STORAGE_VERSION = 2;

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function nextProfileTimestamp(previous = 0) {
  return Math.max(Date.now(), cleanTimestamp(previous) + 1);
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

export function isDefaultProfile(profile: RmtProfile) {
  return profile.displayName === DEFAULT_PROFILE.displayName
    && profile.handle === DEFAULT_PROFILE.handle
    && profile.bio === DEFAULT_PROFILE.bio
    && profile.traderMode === DEFAULT_PROFILE.traderMode
    && profile.density === DEFAULT_PROFILE.density;
}

export function readLocalProfileSnapshot(): LocalProfileSnapshot {
  if (typeof window === "undefined") return { profile: DEFAULT_PROFILE, updatedAt: 0 };
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed && typeof parsed === "object" && "profile" in parsed) {
      const stored = parsed as { profile?: unknown; updatedAt?: unknown };
      return {
        profile: normalizeProfile(stored.profile),
        updatedAt: cleanTimestamp(stored.updatedAt)
      };
    }
    return { profile: normalizeProfile(parsed), updatedAt: 0 };
  } catch {
    return { profile: DEFAULT_PROFILE, updatedAt: 0 };
  }
}

export function readLocalProfile() {
  return readLocalProfileSnapshot().profile;
}

export function writeLocalProfile(profile: RmtProfile, updatedAt?: number) {
  if (typeof window === "undefined") return;
  const normalized = normalizeProfile(profile);
  const previous = readLocalProfileSnapshot();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: STORAGE_VERSION,
    profile: normalized,
    updatedAt: updatedAt === undefined ? nextProfileTimestamp(previous.updatedAt) : cleanTimestamp(updatedAt)
  }));
  window.dispatchEvent(new Event(PROFILE_EVENT));
}
