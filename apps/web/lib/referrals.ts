import type { User } from "firebase/auth";
import { getFirebaseClient } from "./firebase-client";

export const REFERRAL_CODE_PATTERN = /^RMT-[A-HJ-NP-Z2-9]{8}$/;
const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PENDING_REFERRAL_KEY = "rmt-pending-referral-v1";
const PENDING_REFERRAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export type ReferralSummary = {
  code: string;
  verifiedActivations: number;
};

function requireVerifiedUser(user: User) {
  if (!user.emailVerified) throw new Error("Verify your profile email before using referrals.");
  return user;
}

export function normalizeReferralCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return REFERRAL_CODE_PATTERN.test(code) ? code : "";
}

export function generateReferralCode() {
  const values = crypto.getRandomValues(new Uint8Array(8));
  return `RMT-${Array.from(values, (value) => REFERRAL_ALPHABET[value % REFERRAL_ALPHABET.length]).join("")}`;
}

export function capturePendingReferral(value: unknown) {
  if (typeof window === "undefined") return false;
  const code = normalizeReferralCode(value);
  if (!code) return false;
  window.localStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify({ code, capturedAt: Date.now() }));
  return true;
}

export function readPendingReferral() {
  if (typeof window === "undefined") return "";
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_REFERRAL_KEY) || "null") as {
      code?: unknown;
      capturedAt?: unknown;
    } | null;
    const code = normalizeReferralCode(parsed?.code);
    const capturedAt = typeof parsed?.capturedAt === "number" ? parsed.capturedAt : 0;
    if (!code || capturedAt <= 0 || Date.now() - capturedAt > PENDING_REFERRAL_MAX_AGE_MS) {
      window.localStorage.removeItem(PENDING_REFERRAL_KEY);
      return "";
    }
    return code;
  } catch {
    window.localStorage.removeItem(PENDING_REFERRAL_KEY);
    return "";
  }
}

export function clearPendingReferral() {
  if (typeof window !== "undefined") window.localStorage.removeItem(PENDING_REFERRAL_KEY);
}

function parseReferralSummary(value: unknown, fallbackCode = ""): ReferralSummary | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const code = normalizeReferralCode(data.code) || normalizeReferralCode(fallbackCode);
  const verifiedActivations = typeof data.verifiedActivations === "number"
    && Number.isSafeInteger(data.verifiedActivations)
    && data.verifiedActivations >= 0
    ? data.verifiedActivations
    : 0;
  return code ? { code, verifiedActivations } : null;
}

export async function createReferralCode(user: User) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) throw new Error("Firebase profile sync is not configured.");
  const userReference = client.firestoreApi.doc(client.db, "users", verified.uid);
  const profileReference = client.firestoreApi.doc(userReference, "referralProfile", "current");

  const existing = await client.firestoreApi.getDoc(profileReference);
  if (existing.exists()) {
    const code = normalizeReferralCode(existing.data().code);
    if (code) return code;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    const codeReference = client.firestoreApi.doc(client.db, "referralCodes", code);
    const batch = client.firestoreApi.writeBatch(client.db);
    const now = client.firestoreApi.serverTimestamp();
    batch.set(profileReference, {
      schemaVersion: 1,
      code,
      createdAt: now
    });
    batch.set(codeReference, {
      schemaVersion: 1,
      code,
      ownerId: verified.uid,
      verifiedActivations: 0,
      createdAt: now,
      updatedAt: now
    });
    try {
      await batch.commit();
      return code;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error("RMT could not create a unique referral code.");
}

export async function loadReferralSummary(user: User) {
  const verified = requireVerifiedUser(user);
  const client = await getFirebaseClient();
  if (!client) return null;
  const profileReference = client.firestoreApi.doc(
    client.db,
    "users",
    verified.uid,
    "referralProfile",
    "current"
  );
  const profileSnapshot = await client.firestoreApi.getDoc(profileReference);
  if (!profileSnapshot.exists()) return null;
  const code = normalizeReferralCode(profileSnapshot.data().code);
  if (!code) return null;
  const codeSnapshot = await client.firestoreApi.getDoc(client.firestoreApi.doc(client.db, "referralCodes", code));
  return codeSnapshot.exists() ? parseReferralSummary(codeSnapshot.data(), code) : { code, verifiedActivations: 0 };
}

export async function claimPendingReferral(user: User) {
  const verified = requireVerifiedUser(user);
  const code = readPendingReferral();
  if (!code) return false;
  const client = await getFirebaseClient();
  if (!client) return false;
  const userReference = client.firestoreApi.doc(client.db, "users", verified.uid);
  const claimReference = client.firestoreApi.doc(userReference, "referralClaim", "current");
  const existingClaim = await client.firestoreApi.getDoc(claimReference);
  if (existingClaim.exists()) {
    clearPendingReferral();
    return false;
  }

  const codeReference = client.firestoreApi.doc(client.db, "referralCodes", code);
  const batch = client.firestoreApi.writeBatch(client.db);
  const now = client.firestoreApi.serverTimestamp();
  batch.set(claimReference, {
    schemaVersion: 1,
    code,
    claimedAt: now
  });
  batch.update(codeReference, {
    verifiedActivations: client.firestoreApi.increment(1),
    updatedAt: now
  });
  try {
    await batch.commit();
    clearPendingReferral();
    return true;
  } catch {
    return false;
  }
}

export function referralUrl(code: string, origin = "https://www.rmtlaunch.fun") {
  const normalized = normalizeReferralCode(code);
  return normalized ? `${origin.replace(/\/+$/, "")}/r/${normalized}` : "";
}

export function referralXIntent(code: string, origin?: string) {
  const url = referralUrl(code, origin);
  const text = "I’m using Robinhood Meme Terminal to discover and verify Robinhood Chain markets. Build your RMT desk with my invite:";
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
