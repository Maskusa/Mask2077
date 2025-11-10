export interface ProxyConfig {
  host: string;
  apiBase: string;
  apiToken: string;
  testingAndDebug: boolean;
}

const DEFAULT_PROXY_HOST = '45-151-183-153.sslip.io';
const DEFAULT_PROXY_API_BASE = 'https://45-151-183-153.sslip.io:8787';
const DEFAULT_PROXY_API_TOKEN = 'e55757bca55ed0a2f6b5e003c6f2c7b1';
const DEFAULT_TESTING_DEBUG = false;

const resolveBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = value.toString().trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'debug'].includes(normalized) ? true : fallback;
};

export const PROXY_CONFIG: ProxyConfig = {
  host: import.meta.env.VITE_PROXY_HOST ?? DEFAULT_PROXY_HOST,
  apiBase: import.meta.env.VITE_PROXY_API_BASE ?? DEFAULT_PROXY_API_BASE,
  apiToken: import.meta.env.VITE_PROXY_API_TOKEN ?? DEFAULT_PROXY_API_TOKEN,
  testingAndDebug: resolveBoolean(import.meta.env.VITE_PROXY_TESTING_DEBUG, DEFAULT_TESTING_DEBUG),
};
