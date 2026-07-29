import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const FIREBASE_ADMIN_APP_NAME = "rmt-server";

function serverCredential() {
  const projectId = (
    process.env.FIREBASE_ADMIN_PROJECT_ID
    ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ?? ""
  ).trim();
  const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? "").trim();
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replaceAll("\\n", "\n").trim();
  if (
    !/^[a-z0-9-]{4,64}$/.test(projectId)
    || !clientEmail.endsWith(".gserviceaccount.com")
    || !privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
    || !privateKey.endsWith("-----END PRIVATE KEY-----")
  ) return null;
  return { projectId, clientEmail, privateKey };
}

export function getRmtAdminFirestore() {
  const credential = serverCredential();
  if (!credential) return null;
  const existing = getApps().find((app) => app.name === FIREBASE_ADMIN_APP_NAME);
  const app = existing ?? initializeApp({
    credential: cert(credential),
    projectId: credential.projectId
  }, FIREBASE_ADMIN_APP_NAME);
  return getFirestore(app);
}

export function getRmtAdminAuth() {
  const credential = serverCredential();
  if (!credential) return null;
  const existing = getApps().find((app) => app.name === FIREBASE_ADMIN_APP_NAME);
  const app = existing ?? initializeApp({
    credential: cert(credential),
    projectId: credential.projectId
  }, FIREBASE_ADMIN_APP_NAME);
  return getAuth(app);
}
