export const COMMUNITY_MESSAGE_COOLDOWN_MS = 5_000;
export const COMMUNITY_MESSAGE_WINDOW_MS = 60 * 60_000;
export const COMMUNITY_GUEST_MESSAGE_LIMIT = 60;
export const COMMUNITY_MEMBER_MESSAGE_LIMIT = 200;

type TimestampLike = {
  toMillis(): number;
};

export type CommunityMessageActorState = {
  bannedUntil?: TimestampLike;
  lastMessageAt?: TimestampLike;
  windowStartedAt?: TimestampLike;
  windowCount?: number;
};

export type CommunityMessagePolicyDecision =
  | { allowed: false; reason: "banned" | "cooldown" | "quota" }
  | {
      allowed: true;
      sameWindow: boolean;
      windowCount: number;
      nextWindowCount: number;
    };

function validMillis(value: TimestampLike | undefined) {
  if (!value) return null;
  const milliseconds = value.toMillis();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function decideCommunityMessagePolicy(
  actor: CommunityMessageActorState | undefined,
  options: { guest: boolean; now: number }
): CommunityMessagePolicyDecision {
  const bannedUntil = validMillis(actor?.bannedUntil);
  if (bannedUntil !== null && bannedUntil > options.now) {
    return { allowed: false, reason: "banned" };
  }

  const lastMessageAt = validMillis(actor?.lastMessageAt);
  if (
    lastMessageAt !== null
    && options.now - lastMessageAt < COMMUNITY_MESSAGE_COOLDOWN_MS
  ) {
    return { allowed: false, reason: "cooldown" };
  }

  const windowStartedAt = validMillis(actor?.windowStartedAt);
  const sameWindow = Boolean(
    windowStartedAt !== null
    && options.now - windowStartedAt < COMMUNITY_MESSAGE_WINDOW_MS
  );
  const rawWindowCount = sameWindow ? actor?.windowCount ?? 0 : 0;
  const windowCount = Number.isSafeInteger(rawWindowCount) && rawWindowCount > 0
    ? rawWindowCount
    : 0;
  const limit = options.guest
    ? COMMUNITY_GUEST_MESSAGE_LIMIT
    : COMMUNITY_MEMBER_MESSAGE_LIMIT;
  if (windowCount >= limit) return { allowed: false, reason: "quota" };

  return {
    allowed: true,
    sameWindow,
    windowCount,
    nextWindowCount: windowCount + 1
  };
}
