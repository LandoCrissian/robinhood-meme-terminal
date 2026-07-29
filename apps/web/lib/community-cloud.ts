import { getFirebaseClient } from "./firebase-client";
import {
  COMMUNITY_PRESENCE_HEARTBEAT_MS,
  GLOBAL_COMMUNITY_ROOM,
  normalizeCommunityRoomId,
  parseCommunityMessage,
  parseCommunityPresence,
  type CommunityMessage
} from "./community";
import type { CommunityReportReason } from "./community-moderation";
import { COMMUNITY_TERMS_VERSION } from "./community-terms";
import {
  parsePublicCommunityFeedbackStatus,
  type CommunityFeedbackCategory,
  type PublicCommunityFeedbackStatus
} from "./community-feedback";

export async function ensureCommunityIdentity() {
  const client = await getFirebaseClient();
  if (!client) throw new Error("RMT Live is not configured yet.");
  if (client.auth.currentUser) return client.auth.currentUser;
  try {
    return (await client.authApi.signInAnonymously(client.auth)).user;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "auth/operation-not-allowed") {
      throw new Error("Guest access is awaiting Firebase activation.");
    }
    throw new Error("Guest access could not be started.");
  }
}

export async function subscribeToCommunityMessages(
  roomId: string,
  listener: (messages: CommunityMessage[]) => void,
  onError: () => void
) {
  const normalizedRoom = normalizeCommunityRoomId(roomId);
  if (!normalizedRoom) throw new Error("Community room is invalid.");
  const client = await getFirebaseClient();
  if (!client) throw new Error("RMT Live is not configured yet.");
  const reference = client.firestoreApi.query(
    client.firestoreApi.collection(client.db, "communityRooms", normalizedRoom, "messages"),
    client.firestoreApi.where("status", "==", "visible"),
    client.firestoreApi.orderBy("createdAt", "desc"),
    client.firestoreApi.limit(50)
  );
  return client.firestoreApi.onSnapshot(reference, (snapshot) => {
    listener(snapshot.docs
      .map((document) => parseCommunityMessage(document.id, document.data()))
      .filter((message): message is CommunityMessage => Boolean(message))
      .reverse());
  }, onError);
}

export async function postCommunityMessage(body: string, replyTo = "", roomId = GLOBAL_COMMUNITY_ROOM) {
  const user = await ensureCommunityIdentity();
  const token = await user.getIdToken();
  const response = await fetch("/api/community/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, body, replyTo, communityTermsVersion: COMMUNITY_TERMS_VERSION })
  });
  const result = await response.json().catch(() => null) as { error?: unknown; messageId?: unknown } | null;
  if (!response.ok || typeof result?.messageId !== "string") {
    throw new Error(typeof result?.error === "string" ? result.error : "Message could not be posted.");
  }
  return result.messageId;
}

async function heartbeatCommunityPresence(roomId: string) {
  const normalizedRoom = normalizeCommunityRoomId(roomId);
  if (!normalizedRoom) throw new Error("Community room is invalid.");
  const user = await ensureCommunityIdentity();
  const token = await user.getIdToken();
  const response = await fetch("/api/community/presence", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: normalizedRoom })
  });
  const result = await response.json().catch(() => null);
  const presence = parseCommunityPresence(result);
  if (!response.ok || !presence) {
    const error = result && typeof result === "object" && "error" in result
      ? (result as { error?: unknown }).error
      : null;
    throw new Error(typeof error === "string" ? error : "Community presence is unavailable.");
  }
  return presence;
}

export function startCommunityPresence(
  roomId: string,
  listener: (online: number, capped: boolean) => void,
  onError: (message: string) => void
) {
  let active = true;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const presence = await heartbeatCommunityPresence(roomId);
      if (active) listener(presence.online, presence.capped);
    } catch (error) {
      if (active) onError(error instanceof Error ? error.message : "Community presence is unavailable.");
    } finally {
      running = false;
      if (active) timer = setTimeout(run, COMMUNITY_PRESENCE_HEARTBEAT_MS);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    if (timer) clearTimeout(timer);
    void run();
  };

  document.addEventListener("visibilitychange", onVisibility);
  void run();
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export async function reportCommunityMessage(
  messageId: string,
  reason: CommunityReportReason,
  roomId = GLOBAL_COMMUNITY_ROOM
) {
  const user = await ensureCommunityIdentity();
  const token = await user.getIdToken();
  const response = await fetch("/api/community/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, messageId, reason })
  });
  const result = await response.json().catch(() => null) as { error?: unknown; reportId?: unknown } | null;
  if (!response.ok || typeof result?.reportId !== "string") {
    throw new Error(typeof result?.error === "string" ? result.error : "The report could not be recorded.");
  }
  return result.reportId;
}

export async function submitCommunityFeedback(input: {
  category: CommunityFeedbackCategory;
  title: string;
  description: string;
}) {
  const user = await ensureCommunityIdentity();
  const token = await user.getIdToken();
  const response = await fetch("/api/community/feedback", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, communityTermsVersion: COMMUNITY_TERMS_VERSION })
  });
  const result = await response.json().catch(() => null) as { error?: unknown; feedbackId?: unknown } | null;
  if (!response.ok || typeof result?.feedbackId !== "string") {
    throw new Error(typeof result?.error === "string" ? result.error : "Feedback could not be submitted.");
  }
  return result.feedbackId;
}

export async function withdrawCommunityFeedback(feedbackId: string) {
  if (!/^[A-Za-z0-9]{20}$/.test(feedbackId)) throw new Error("Feedback receipt is invalid.");
  const user = await ensureCommunityIdentity();
  const token = await user.getIdToken();
  const response = await fetch("/api/community/feedback", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ feedbackId })
  });
  const result = await response.json().catch(() => null) as {
    error?: unknown;
    feedbackId?: unknown;
    status?: unknown;
    withdrawn?: unknown;
  } | null;
  if (
    !response.ok
    || result?.feedbackId !== feedbackId
    || result.status !== "closed"
    || result.withdrawn !== true
  ) {
    throw new Error(typeof result?.error === "string" ? result.error : "Feedback could not be withdrawn.");
  }
}

export async function subscribeToCommunityFeedbackStatuses(
  feedbackIds: string[],
  listener: (statuses: PublicCommunityFeedbackStatus[]) => void,
  onError: () => void
) {
  const ids = [...new Set(feedbackIds)].filter((item) => /^[A-Za-z0-9]{20}$/.test(item)).slice(0, 12);
  if (ids.length === 0) {
    listener([]);
    return () => {};
  }
  const client = await getFirebaseClient();
  if (!client) throw new Error("RMT Live is not configured yet.");
  const records = new Map<string, PublicCommunityFeedbackStatus>();
  let failed = false;
  const publish = () => listener(ids.flatMap((id) => {
    const record = records.get(id);
    return record ? [record] : [];
  }));
  const unsubscribes = ids.map((feedbackId) => client.firestoreApi.onSnapshot(
    client.firestoreApi.doc(client.db, "communityFeedbackStatus", feedbackId),
    (snapshot) => {
      const parsed = snapshot.exists() ? parsePublicCommunityFeedbackStatus(snapshot.id, snapshot.data()) : null;
      if (parsed) records.set(feedbackId, parsed);
      else records.delete(feedbackId);
      publish();
    },
    () => {
      if (!failed) {
        failed = true;
        onError();
      }
    }
  ));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
