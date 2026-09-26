import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ModuleKey } from "@shared/schema";
import { canAccess } from "@/hooks/use-auth";

// Shape of GET /api/director/summary (server/director.ts). Every section is
// filtered server-side by the signed-in user's module permissions, so a
// section is null / empty when the user can't see that module.
export interface StreamIncome { key: string; label: string; today: number; todayCount: number; yesterday: number; mtd: number; link: string }
export interface DirectorAlert { id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; link: string }
export interface ApprovalCount { key: string; label: string; count: number; oldestAt: number | null; link: string }

export interface DirectorSummary {
  date: string;
  generatedAt: number;
  income: { streams: StreamIncome[]; totalToday: number; totalYesterday: number; totalMtd: number };
  rooms: null | { total: number; inHouse: number; occupancyPct: number; arrivals: number; arrivalsPendingPayment: number; departures: number; outOfOrder: number };
  arrivals: { id: number; guestName: string; roomName: string | null; status: string; balance: number }[];
  events: { id: number; clientName: string; facilityName: string | null; startTime: string | null; endTime: string | null; amount: number; status: string }[];
  shows: { id: number; title: string; time: string | null; sold: number; capacity: number }[];
  cash: null | { total: number; accounts: { id: number; name: string; balance: number }[] };
  receivables: { key: string; label: string; amount: number; count: number; link: string }[];
  expenses: null | { today: number; mtd: number };
  budget: null | { month: string; budgeted: number; actual: number; proRataBudget: number; pctOfBudget: number };
  people: null | { activeStaff: number; onLeaveToday: number; names: string[] };
  approvals: { total: number; byType: ApprovalCount[] };
  alerts: DirectorAlert[];
}

export const SUMMARY_KEY = ["/api/director/summary"] as const;
export const NOTIFICATIONS_KEY = ["/api/notifications"] as const;

export function useDirectorSummary() {
  return useQuery<DirectorSummary>({
    queryKey: SUMMARY_KEY,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  });
}

export interface NotificationItem { id: number; category: string; title: string; body: string | null; linkPath: string | null; createdAt: number; readAt: number | null }

export function useNotifications() {
  return useQuery<{ unread: number; items: NotificationItem[] }>({
    queryKey: NOTIFICATIONS_KEY,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useMarkNotificationsRead() {
  return useMutation({
    mutationFn: async (ids?: number[]) => apiRequest("POST", "/api/notifications/read", ids ? { ids } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useClearReadNotifications() {
  return useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/notifications/read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

// Modules that carry an approval workflow. Used only to decide whether to show
// the Approvals shortcut — it is NOT a permission of its own.
export const APPROVAL_MODULES: ModuleKey[] = ["purchasing", "internal-requisitions", "hr", "leave", "payroll", "finance"];

export function hasAnyApprovalModule(user: Parameters<typeof canAccess>[0]): boolean {
  return APPROVAL_MODULES.some((k) => canAccess(user, k));
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
