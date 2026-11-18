import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { ProfileConfig } from "./config";

export function profileFirebase(config: ProfileConfig) {
  // Config validation must run before any SDK creation; Auth/Firestore endpoints must be loopback emulators.
  const name = "rmt-launch-profiles-" + config.mode + "-v1";
  const credential = config.mode === "cloud" ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) : undefined;
  const app = getApps().find(item => item.name === name) ?? initializeApp({ projectId: config.projectId, ...(credential && { credential }) }, name);
  if (app.options.projectId !== config.projectId) throw new Error("Profile Firebase identity changed");
  return { auth: getAuth(app), db: getFirestore(app) };
}
