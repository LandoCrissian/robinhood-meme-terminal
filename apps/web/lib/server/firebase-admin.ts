import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const FIREBASE_ADMIN_APP_NAME = "rmt-live-server";

function serverCredential(env: NodeJS.ProcessEnv = process.env) {
  const projectId = (
    env.FIREBASE_ADMIN_PROJECT_ID
    ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ?? ""
  ).trim();
  const clientEmail = (env.FIREBASE_ADMIN_CLIENT_EMAIL ?? "").trim();
  const privateKey = (env.FIREBASE_ADMIN_PRIVATE_KEY ?? "")
    .replaceAll("\\n", "\n")
    .trim();
  if (
    !/^[a-z0-9-]{4,64}$/.test(projectId)
    || !clientEmail.endsWith(".gserviceaccount.com")
    || !privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
    || !privateKey.endsWith("-----END PRIVATE KEY-----")
  ) return null;
  return { projectId, clientEmail, privateKey };
}

export function hasRmtAdminConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(serverCredential(env));
}

function getRmtLiveAdminApp() {
  const credential = serverCredential();
  if (!credential) return null;
  return getApps().find((app) => app.name === FIREBASE_ADMIN_APP_NAME) ?? initializeApp({
    credential: cert(credential),
    projectId: credential.projectId
  }, FIREBASE_ADMIN_APP_NAME);
}

export function getRmtAdminFirestore() {
  const app = getRmtLiveAdminApp();
  return app ? getFirestore(app) : null;
}

export function getRmtAdminAuth() {
  const app = getRmtLiveAdminApp();
  return app ? getAuth(app) : null;
}
