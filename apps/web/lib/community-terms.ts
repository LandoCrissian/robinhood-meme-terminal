export const COMMUNITY_TERMS_VERSION = "2026-07-29";
export const COMMUNITY_TERMS_STORAGE_KEY = "rmt:community-terms";

type CommunityTermsAcceptance = {
  version: string;
  acceptedAt: string;
};

export function parseCommunityTermsAcceptance(value: string | null) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as Partial<CommunityTermsAcceptance>;
    return parsed.version === COMMUNITY_TERMS_VERSION
      && typeof parsed.acceptedAt === "string"
      && Number.isFinite(Date.parse(parsed.acceptedAt));
  } catch {
    return false;
  }
}

export function communityTermsAcceptanceRecord(now = new Date()) {
  return JSON.stringify({
    version: COMMUNITY_TERMS_VERSION,
    acceptedAt: now.toISOString()
  } satisfies CommunityTermsAcceptance);
}
