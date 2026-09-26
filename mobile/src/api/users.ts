import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { SafeUser, ModuleKey } from "./types";

// Admin-only user management — mirrors the web app's Settings > Users screen.
// Every endpoint here is gated server-side by `requireAdmin`, so a
// non-admin caller gets a 401/403 rather than data.

export interface UpdateUserPayload {
  fullName?: string;
  isAdmin?: boolean;
  permissions?: ModuleKey[];
  active?: boolean;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get<SafeUser[]>("/api/users")).data,
  });
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: UpdateUserPayload }) =>
      (await api.patch<SafeUser>(`/api/users/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}
