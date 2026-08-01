import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const FIREBASE_APP_NAME = "rmt-profile";
const REGISTERED_AUTH_HELPER_HOSTS = new Set([
  "www.rmtlaunch.fun",
  "robinhood-meme-terminal-git-code-437b4e-landocrissians-projects.vercel.app",
  "robinhood-meme-terminal-git-code-d34b50-landocrissians-projects.vercel.app"
]);
const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY?.trim();
const configuredAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: configuredAuthDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim()
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.authDomain
  && firebaseConfig.projectId
  && firebaseConfig.appId
);

export function firebaseAuthDomainForHost(authDomain: string | undefined, hostname: string) {
  const normalizedAuthDomain = authDomain?.trim().toLowerCase();
  if (!normalizedAuthDomain) return authDomain;
  const normalizedHost = hostname.trim().toLowerCase();

  // Google OAuth redirect URIs are exact-match values. Temporary Vercel
  // hostnames must not become Firebase auth helpers unless their exact handler
  // is registered. RMT keeps only its canonical host and stable QA hosts here.
  if (REGISTERED_AUTH_HELPER_HOSTS.has(normalizedHost)) return normalizedHost;
  return normalizedAuthDomain;
}

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
    const runtimeConfig = {
      ...firebaseConfig,
      authDomain: firebaseAuthDomainForHost(configuredAuthDomain, window.location.hostname)
    };
    const app = appApi.getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME)
      ?? appApi.initializeApp(runtimeConfig, FIREBASE_APP_NAME);

    if (appCheckSiteKey) {
      const appCheckApi = await import("firebase/app-check");
      appCheckApi.initializeAppCheck(app, {
        provider: new appCheckApi.ReCaptchaEnterpriseProvider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true
      });
    }

    const auth = authApi.getAuth(app);
    for (const persistence of [
      authApi.browserLocalPersistence,
      authApi.browserSessionPersistence,
      authApi.inMemoryPersistence
    ]) {
      try {
        await authApi.setPersistence(auth, persistence);
        break;
      } catch {
        // Keep profile sign-in available when a browser blocks a stronger
        // persistence layer. The next option is progressively less durable.
      }
    }
    return { app, auth, db: firestoreApi.getFirestore(app), authApi, firestoreApi };
  })().catch((error) => {
    firebaseClientPromise = undefined;
    throw error;
  });

  return firebaseClientPromise;
}
