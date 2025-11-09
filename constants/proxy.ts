export interface ProxyConfig {
  host: string;
  httpPort: number;
  socksPort: number;
  user: string;
  password: string;
  apiBase: string;
  apiToken: string;
  testingAndDebug: boolean;
}

const DEFAULT_PROXY_HOST = '45.151.183.153';
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_SOCKS_PORT = 1080;
const DEFAULT_PROXY_USER = 'masku';
const DEFAULT_PROXY_PASSWORD = 'superproxy123';
const DEFAULT_PROXY_API_BASE = 'http://45.151.183.153:8787';
const DEFAULT_PROXY_API_TOKEN = 'e55757bca55ed0a2f6b5e003c6f2c7b1';
const DEFAULT_TESTING_DEBUG = false;

const resolveNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = value.toString().trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'debug'].includes(normalized) ? true : fallback;
};

export const PROXY_CONFIG: ProxyConfig = {
  host: import.meta.env.VITE_PROXY_HOST ?? DEFAULT_PROXY_HOST,
  httpPort: resolveNumber(import.meta.env.VITE_PROXY_HTTP_PORT, DEFAULT_HTTP_PORT),
  socksPort: resolveNumber(import.meta.env.VITE_PROXY_SOCKS_PORT, DEFAULT_SOCKS_PORT),
  user: import.meta.env.VITE_PROXY_USER ?? DEFAULT_PROXY_USER,
  password: import.meta.env.VITE_PROXY_PASSWORD ?? DEFAULT_PROXY_PASSWORD,
  apiBase: import.meta.env.VITE_PROXY_API_BASE ?? DEFAULT_PROXY_API_BASE,
  apiToken: import.meta.env.VITE_PROXY_API_TOKEN ?? DEFAULT_PROXY_API_TOKEN,
  testingAndDebug: resolveBoolean(import.meta.env.VITE_PROXY_TESTING_DEBUG, DEFAULT_TESTING_DEBUG),
};
