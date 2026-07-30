export const EXPERIENCE_ONBOARDING_VERSION = 1;
export const EXPERIENCE_SCHEMA_VERSION = 1;
export const EXPERIENCE_PREFERENCES_STORAGE_KEY = "rmt:experience-preferences";
export const EXPERIENCE_SESSION_STORAGE_KEY = "rmt:experience-stages:v1";
export const EXPERIENCE_PREFERENCES_EVENT = "rmt:experience-preferences";

export const EXPERIENCE_STAGES = [
  "visit_started",
  "terminal_opened",
  "discovery_used",
  "market_opened",
  "trade_preparation_opened",
  "wallet_connect_started",
  "wallet_connected",
  "quote_ready",
  "wallet_review_started"
] as const;

export type ExperienceStage = typeof EXPERIENCE_STAGES[number];
export type ExperienceDevice = "mobile" | "desktop";

export type ExperiencePreferences = {
  schemaVersion: typeof EXPERIENCE_SCHEMA_VERSION;
  onboardingVersion: number;
  diagnosticsEnabled: boolean;
  updatedAt: number;
};

export const EXPERIENCE_STAGE_COPY: Record<ExperienceStage, { label: string; detail: string }> = {
  visit_started: { label: "Opted-in visits", detail: "Opened any public trading surface." },
  terminal_opened: { label: "Terminal reached", detail: "Reached the live market terminal." },
  discovery_used: { label: "Discovery engaged", detail: "Opened a market from RMT discovery." },
  market_opened: { label: "Market reviewed", detail: "Reached a dedicated market workspace." },
  trade_preparation_opened: { label: "Trade preparation", detail: "Opened Buy or Sell preparation." },
  wallet_connect_started: { label: "Wallet connection started", detail: "Selected a wallet connection path." },
  wallet_connected: { label: "Wallet connected", detail: "Connected a wallet during the visit." },
  quote_ready: { label: "Protected quote ready", detail: "Reached a fresh, reviewable route quote." },
  wallet_review_started: { label: "Wallet review requested", detail: "Sent a prepared action to the wallet for review." }
};

export function normalizeExperienceStage(value: unknown): ExperienceStage | null {
  return typeof value === "string" && EXPERIENCE_STAGES.includes(value as ExperienceStage)
    ? value as ExperienceStage
    : null;
}

export function normalizeExperienceDevice(value: unknown): ExperienceDevice | null {
  return value === "mobile" || value === "desktop" ? value : null;
}

export function experienceDayId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function defaultExperiencePreferences(): ExperiencePreferences {
  return {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    onboardingVersion: 0,
    diagnosticsEnabled: false,
    updatedAt: 0
  };
}

export function normalizeExperiencePreferences(value: unknown): ExperiencePreferences {
  const fallback = defaultExperiencePreferences();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = value as Partial<ExperiencePreferences>;
  return {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    onboardingVersion: Number.isInteger(candidate.onboardingVersion) && Number(candidate.onboardingVersion) >= 0
      ? Math.min(Number(candidate.onboardingVersion), EXPERIENCE_ONBOARDING_VERSION)
      : 0,
    diagnosticsEnabled: candidate.diagnosticsEnabled === true,
    updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) && candidate.updatedAt > 0
      ? candidate.updatedAt
      : 0
  };
}

export function readExperiencePreferences() {
  if (typeof window === "undefined") return defaultExperiencePreferences();
  try {
    return normalizeExperiencePreferences(JSON.parse(
      window.localStorage.getItem(EXPERIENCE_PREFERENCES_STORAGE_KEY) || "null"
    ));
  } catch {
    return defaultExperiencePreferences();
  }
}

export function saveExperiencePreferences(update: Partial<Pick<ExperiencePreferences, "diagnosticsEnabled" | "onboardingVersion">>) {
  if (typeof window === "undefined") return defaultExperiencePreferences();
  const current = readExperiencePreferences();
  const next = normalizeExperiencePreferences({
    ...current,
    ...update,
    updatedAt: Date.now()
  });
  window.localStorage.setItem(EXPERIENCE_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EXPERIENCE_PREFERENCES_EVENT, { detail: next }));
  return next;
}

function readRecordedStages() {
  if (typeof window === "undefined") return new Set<ExperienceStage>();
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(EXPERIENCE_SESSION_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(normalizeExperienceStage).filter(Boolean) as ExperienceStage[] : []);
  } catch {
    return new Set<ExperienceStage>();
  }
}

export function recordExperienceStage(stage: ExperienceStage) {
  if (typeof window === "undefined" || !readExperiencePreferences().diagnosticsEnabled) return false;
  const recorded = readRecordedStages();
  if (recorded.has(stage)) return false;
  recorded.add(stage);
  window.sessionStorage.setItem(EXPERIENCE_SESSION_STORAGE_KEY, JSON.stringify([...recorded]));
  const device: ExperienceDevice = window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
  void fetch("/api/experience/funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, device, schemaVersion: EXPERIENCE_SCHEMA_VERSION }),
    credentials: "same-origin",
    keepalive: true
  }).catch(() => undefined);
  return true;
}
