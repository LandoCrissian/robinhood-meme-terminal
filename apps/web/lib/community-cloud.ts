import { getFirebaseClient } from "./firebase-client";
import {
  GLOBAL_COMMUNITY_ROOM,
  normalizeCommunityRoomId,
  parseCommunityMessage,
  type CommunityMessage
} from "./community";

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
    body: JSON.stringify({ roomId, body, replyTo })
  });
  const result = await response.json().catch(() => null) as { error?: unknown; messageId?: unknown } | null;
  if (!response.ok || typeof result?.messageId !== "string") {
    throw new Error(typeof result?.error === "string" ? result.error : "Message could not be posted.");
  }
  return result.messageId;
}
