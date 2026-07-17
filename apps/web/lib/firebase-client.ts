import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.authDomain
  && firebaseConfig.projectId
  && firebaseConfig.appId
);

type FirebaseClient = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  authApi: typeof import("firebase/auth");
  firestoreApi: typeof import("firebase/firestore");
};

let firebaseClientPromise: Promise<FirebaseClient | null> | undefined;

export function getFirebaseClient() {
  if (firebaseClientPromise) return firebaseClientPromise;
  if (typeof window === "undefined" || !firebaseConfigured) return Promise.resolve(null);

  firebaseClientPromise = (async () => {
    const [appApi, authApi, firestoreApi] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore")
    ]);
    const app = appApi.getApps().length > 0 ? appApi.getApp() : appApi.initializeApp(firebaseConfig);
    const auth = authApi.getAuth(app);
    await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    return { app, auth, db: firestoreApi.getFirestore(app), authApi, firestoreApi };
  })();

  return firebaseClientPromise;
}
