import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getSessionToken, setSessionToken, registerUnauthorizedHandler } from "../api/client";
import type { LoginResponse, SafeUser } from "../api/types";

interface AuthContextValue {
  user: SafeUser | null;
  environment: "live" | "test";
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string, environment?: "live" | "test") => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getSessionToken();
      if (!token) {
        setUser(null);
        return;
      }
      const res = await api.get<SafeUser>("/api/auth/me");
      setUser(res.data);
    } catch {
      setUser(null);
      await setSessionToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => setUser(null));
    restoreSession();
  }, [restoreSession]);

  const login = useCallback(async (username: string, password: string, env: "live" | "test" = "live") => {
    setError(null);
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", {
        username: username.trim().toLowerCase(),
        password,
        environment: env,
      });
      await setSessionToken(res.data.sessionToken);
      setEnvironment(res.data.environment ?? env);
      setUser(res.data);
    } catch (err: any) {
      const message = err?.response?.data?.error ?? "Could not sign in. Check your connection and try again.";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignore — we clear local state regardless
    }
    await setSessionToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, environment, isLoading, isAuthenticated: !!user, login, logout, error }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
