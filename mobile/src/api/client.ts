import axios from "axios";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// expo-secure-store has no web implementation (its .web.js module resolves
// to an empty object), so on web we fall back to an in-memory store instead
// of calling the native-only functions. Native builds (iOS/Android) are
// unaffected and keep using the real Keychain/Keystore-backed SecureStore.
const memoryStore = new Map<string, string>();
const webStore = {
  getItemAsync: async (key: string) => memoryStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    memoryStore.delete(key);
  },
};
const Store = Platform.OS === "web" ? webStore : SecureStore;

// The two backends the app can point at. Production is the default; Test
// exists so an admin can safely try things (e.g. QA a new build) without
// touching real guest/financial data. Matches the web app's Live/Test split.
export const API_ENVIRONMENTS = {
  production: "https://hms.thechekata.com",
  // Swap this for your own DigitalOcean test endpoint if you stand up a
  // separate test host; for now the same server distinguishes Live vs Test
  // by the session's `environment`, set at login.
  test: "https://hms.thechekata.com",
} as const;

const SESSION_TOKEN_KEY = "chekata_session_token";
const API_BASE_KEY = "chekata_api_base";

let cachedToken: string | null | undefined = undefined;
let cachedBase: string | undefined = undefined;

export async function getApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  const stored = await Store.getItemAsync(API_BASE_KEY);
  cachedBase = stored ?? API_ENVIRONMENTS.production;
  return cachedBase;
}

export async function setApiBase(base: string) {
  cachedBase = base;
  await Store.setItemAsync(API_BASE_KEY, base);
}

export async function getSessionToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  const stored = await Store.getItemAsync(SESSION_TOKEN_KEY);
  cachedToken = stored ?? null;
  return cachedToken;
}

export async function setSessionToken(token: string | null) {
  cachedToken = token;
  if (token) {
    await Store.setItemAsync(SESSION_TOKEN_KEY, token);
  } else {
    await Store.deleteItemAsync(SESSION_TOKEN_KEY);
  }
}

export const api = axios.create({
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  const base = await getApiBase();
  config.baseURL = base;
  const token = await getSessionToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any)["x-session-token"] = token;
  }
  return config;
});

// Central 401 handling: any authenticated call that comes back unauthorized
// clears the stored token so the app falls back to the login screen instead
// of silently retrying with a dead session.
let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error?.response?.status === 401) {
      await setSessionToken(null);
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);
