import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient, setSessionToken } from "@/lib/queryClient";
import type { SafeUser, ModuleKey } from "@shared/schema";

export function useSetupStatus() {
  return useQuery<{ needsSetup: boolean }>({
    queryKey: ["/api/auth/setup-status"],
  });
}

export function useCurrentUser() {
  return useQuery<SafeUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn<SafeUser | null>({ on401: "returnNull" }),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      const body = (await res.json()) as SafeUser & { sessionToken?: string };
      if (body.sessionToken) setSessionToken(body.sessionToken);
      return body;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
    },
  });
}

export function useSetup() {
  return useMutation({
    mutationFn: async (data: { username: string; password: string; fullName: string }) => {
      const res = await apiRequest("POST", "/api/auth/setup", data);
      const body = (await res.json()) as SafeUser & { sessionToken?: string };
      if (body.sessionToken) setSessionToken(body.sessionToken);
      return body;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/me"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/setup-status"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      setSessionToken(null);
      qc.setQueryData(["/api/auth/me"], null);
      qc.clear();
    },
  });
}

export function canAccess(user: SafeUser | null | undefined, moduleKey: ModuleKey): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  try {
    const perms = JSON.parse(user.permissions) as string[];
    return perms.includes(moduleKey);
  } catch {
    return false;
  }
}
