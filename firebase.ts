import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
  logEvent,
  type Analytics,
} from 'firebase/analytics';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';

type FirebaseConfig = {
  apiKey?: string;
  authDomain?: string;
  databaseURL?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
};

type GoogleServicesJson = {
  project_info?: {
    project_number?: string;
    firebase_url?: string;
    project_id?: string;
    storage_bucket?: string;
  };
  client?: Array<{
    client_info?: {
      mobilesdk_app_id?: string;
    };
    api_key?: Array<{
      current_key?: string;
    }>;
    services?: {
      analytics_service?: {
        status?: number;
        analytics_property?: {
          tracking_id?: string;
        };
      };
    };
  }>;
};

const readEnvConfig = (): FirebaseConfig => ({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
});

const parseGoogleServicesConfig = (rawJson: string): FirebaseConfig => {
  if (!rawJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawJson) as GoogleServicesJson;
    const project = parsed.project_info ?? {};
    const client = parsed.client?.[0];

    return {
      apiKey: client?.api_key?.[0]?.current_key,
      authDomain: project.project_id ? `${project.project_id}.firebaseapp.com` : undefined,
      databaseURL: project.firebase_url,
      projectId: project.project_id,
      storageBucket: project.storage_bucket,
      messagingSenderId: project.project_number,
      appId: client?.client_info?.mobilesdk_app_id,
      measurementId: client?.services?.analytics_service?.analytics_property?.tracking_id,
    };
  } catch (error) {
    console.warn('[Firebase] Failed to parse google-services.json:', error);
    return {};
  }
};

const mergeConfigs = (...configs: FirebaseConfig[]): FirebaseConfig => {
  return configs.reduce<FirebaseConfig>((acc, current) => {
    Object.entries(current).forEach(([key, value]) => {
      if (value) {
        acc[key as keyof FirebaseConfig] = value;
      }
    });
    return acc;
  }, {});
};

const googleServicesCandidates = import.meta.glob('./android/app/google-services.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string | undefined>;

const googleServicesRaw = Object.values(googleServicesCandidates)[0];

const googleServicesConfig: FirebaseConfig = googleServicesRaw
  ? parseGoogleServicesConfig(googleServicesRaw)
  : {};

if (!googleServicesRaw && import.meta.env.DEV) {
  console.info('[Firebase] google-services.json not found in android/app – relying on environment variables.');
}

const config: FirebaseConfig = mergeConfigs(googleServicesConfig, readEnvConfig());

const requiredKeys: (keyof FirebaseConfig)[] = [
  'apiKey',
  'authDomain',
  'databaseURL',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const missingKeys = requiredKeys.filter((key) => !config[key]);
if (missingKeys.length > 0) {
  console.warn('[Firebase] Missing configuration keys:', missingKeys.join(', '));
}

let appInstance: FirebaseApp | null = null;
let analyticsInstance: Analytics | null = null;
let databaseInstance: Database | null = null;
let authInstance: Auth | null = null;

const initApp = (): FirebaseApp | null => {
  if (appInstance) {
    return appInstance;
  }

  if (missingKeys.length > 0) {
    return null;
  }

  appInstance = getApps().length ? getApps()[0] : initializeApp(config);
  return appInstance;
};

export const initAnalytics = async (): Promise<Analytics | null> => {
  if (analyticsInstance) {
    return analyticsInstance;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const app = initApp();
  if (!app) {
    return null;
  }

  if (await isAnalyticsSupported()) {
    try {
      analyticsInstance = getAnalytics(app);
      if (!config.measurementId) {
        console.info('[Firebase] Measurement ID is missing – relying on native analytics configuration.');
      }
      return analyticsInstance;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Firebase] Analytics initialization failed:', message);
      return null;
    }
  }

  console.warn('[Firebase] Analytics is not supported in this environment.');
  return null;
};

export const logFirebaseEvent = async (
  eventName: Parameters<typeof logEvent>[1],
  eventParams?: Parameters<typeof logEvent>[2],
): Promise<void> => {
  const analytics = await initAnalytics();
  if (!analytics) {
    return;
  }

  logEvent(analytics, eventName, eventParams);
};

export const getFirebaseDatabase = (): Database | null => {
  if (databaseInstance) {
    return databaseInstance;
  }

  const app = initApp();
  if (!app) {
    return null;
  }

  databaseInstance = getDatabase(app);
  return databaseInstance;
};

export const getFirebaseApp = (): FirebaseApp | null => {
  return initApp();
};

export const getFirebaseAuth = (): Auth | null => {
  if (authInstance) {
    return authInstance;
  }
  const app = initApp();
  if (!app) {
    return null;
  }
  authInstance = getAuth(app);
  return authInstance;
};

export const signInAnonymouslyIfNeeded = async (): Promise<Auth | null> => {
  const auth = getFirebaseAuth();
  if (!auth) {
    console.warn('[Firebase] Auth not configured – skipping anonymous sign-in.');
    return null;
  }

  if (auth.currentUser) {
    return auth;
  }

  try {
    await signInAnonymously(auth);
    return auth;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Firebase] Anonymous sign-in failed:', message);
    throw error;
  }
};
