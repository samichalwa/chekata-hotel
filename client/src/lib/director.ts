import { useState } from "react";
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

export interface MovieRecentBooking { id: number; guestName: string; seat: string; showTitle: string; showDate: string; showTime: string | null; amount: number; paid: number; due: number; createdAt: number }

export interface MovieShowSummary { id: number; title: string; date?: string; time: string | null; sold: number; capacity: number; paid?: number; due?: number }

export interface DirectorSummary {
  date: string;
  generatedAt: number;
  income: { streams: StreamIncome[]; totalToday: number; totalYesterday: number; totalMtd: number };
  rooms: null | { total: number; inHouse: number; occupancyPct: number; arrivals: number; arrivalsPendingPayment: number; departures: number; outOfOrder: number };
  arrivals: { id: number; guestName: string; roomName: string | null; status: string; balance: number }[];
  events: { id: number; clientName: string; facilityName: string | null; startTime: string | null; endTime: string | null; amount: number; status: string }[];
  shows: MovieShowSummary[];
  movie?: null | { bookedToday: { count: number; amount: number }; unpaid: { count: number; amount: number }; upcoming: MovieShowSummary[]; recent?: MovieRecentBooking[]; totalBookings?: number };
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

type NotificationsData = { unread: number; items: NotificationItem[] };

// Reading (opening) or deleting a notification removes it. Updates the list
// optimistically so the row disappears immediately.
export function useRemoveNotifications() {
  return useMutation({
    mutationFn: async (ids?: number[]) => apiRequest("POST", "/api/notifications/delete", ids ? { ids } : {}),
    onMutate: async (ids?: number[]) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const prev = queryClient.getQueryData<NotificationsData>(NOTIFICATIONS_KEY);
      if (prev) {
        const items = ids ? prev.items.filter((i) => !ids.includes(i.id)) : [];
        const removed = prev.items.length - items.length;
        queryClient.setQueryData<NotificationsData>(NOTIFICATIONS_KEY, { unread: ids ? Math.max(0, prev.unread - removed) : 0, items });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(NOTIFICATIONS_KEY, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

// Live alerts are computed from current data, so they can't be deleted — but
// they can be dismissed from the bell. A dismissal is remembered on this device
// until the alert's wording changes (e.g. a new amount) or the day rolls over.
const DISMISS_KEY = "chaims.dismissedAlerts";
function alertSig(a: DirectorAlert): string { return `${a.id}|${a.title}|${a.detail ?? ""}`; }
function todayKey(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }); }
function readDismissed(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DISMISS_KEY) || "null");
    return raw && raw.day === todayKey() && Array.isArray(raw.sigs) ? raw.sigs : [];
  } catch { return []; }
}
export function useDismissedAlerts() {
  const [sigs, setSigs] = useState<string[]>(() => readDismissed());
  const save = (next: string[]) => {
    setSigs(next);
    try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify({ day: todayKey(), sigs: next })); } catch { /* storage unavailable */ }
  };
  return {
    isDismissed: (a: DirectorAlert) => sigs.includes(alertSig(a)),
    dismiss: (a: DirectorAlert) => save(Array.from(new Set([...sigs, alertSig(a)]))),
    dismissAll: (list: DirectorAlert[]) => save(Array.from(new Set([...sigs, ...list.map(alertSig)]))),
  };
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
