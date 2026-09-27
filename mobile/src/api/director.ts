import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Mirrors GET /api/director/summary on the web server (server/director.ts).
// Every section is filtered server-side by the signed-in user's module
// permissions, so a section is null / empty when the user can't see it.
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

export interface NotificationItem { id: number; category: string; title: string; body: string | null; linkPath: string | null; createdAt: number; readAt: number | null }

export const SUMMARY_KEY = ["director", "summary"] as const;
export const NOTIFICATIONS_KEY = ["director", "notifications"] as const;

export function useDirectorSummary(enabled = true) {
  return useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: async () => (await api.get<DirectorSummary>("/api/director/summary")).data,
    refetchInterval: 60_000,
    staleTime: 20_000,
    enabled,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => (await api.get<{ unread: number; items: NotificationItem[] }>("/api/notifications")).data,
    refetchInterval: 60_000,
    staleTime: 15_000,
    enabled,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: number[]) => (await api.post("/api/notifications/read", ids ? { ids } : {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

// Web paths used in summary/notification links → mobile navigation targets.
// Returns null when the mobile app has no matching screen (row is then
// shown without a chevron and is not tappable).
export function mobileTarget(link: string | null | undefined): { name: string; params?: any } | null {
  if (!link) return null;
  const path = link.split("?")[0];
  if (path.startsWith("/approvals")) return { name: "Approvals" };
  if (path.startsWith("/accommodation")) return { name: "Bookings", params: { screen: "AccommodationBookings" } };
  if (path.startsWith("/facilities")) return { name: "Bookings", params: { screen: "FacilityBookings" } };
  if (path.startsWith("/movie-room")) return { name: "Bookings", params: { screen: "MovieBookings" } };
  if (path.startsWith("/bar-restaurant")) return { name: "Bookings", params: { screen: "BarRestaurant" } };
  if (path.startsWith("/finance") || path.startsWith("/expenses") || path.startsWith("/budgeting")) return { name: "Finance" };
  if (["/purchasing", "/internal-requisitions", "/leave", "/payroll", "/hr"].some((p) => path.startsWith(p))) return { name: "Approvals" };
  return null;
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

// Daily close report (admins). The server returns a summary text and a signed,
// no-login PDF link, so WhatsApp messages always carry the PDF.
export interface DailyReportShare { date: string; url: string; text: string; whatsappPhone: string | null }
export async function fetchDailyReportShare(date?: string): Promise<DailyReportShare> {
  return (await api.get<DailyReportShare>("/api/director/daily-report/share", { params: date ? { date } : undefined })).data;
}
export interface DailyReportSendResult { emails: { to: string; ok: boolean }[]; sms: { to: string; ok: boolean }[]; pushed: number }
export async function sendDailyReportNow(date?: string): Promise<DailyReportSendResult> {
  return (await api.post<DailyReportSendResult>("/api/director/daily-report/send", date ? { date } : {})).data;
}
export function whatsappDigits(raw?: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = "254" + d.slice(1);
  else if (d.length === 9) d = "254" + d;
  return d.length >= 10 ? d : null;
}
