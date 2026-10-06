// Owner / Director "Today" briefing + in-app notifications.
//
// Everything here is read-only aggregation over existing tables, except the
// `notifications` table (bootstrapped in storage.ts) which stores per-user
// in-app notifications written by `notifyUsers(...)`.
//
// Every section of the summary is gated by the signed-in user's module
// permissions (admins see everything), so a user never sees figures from a
// module they haven't been granted.
import type { Express, Request } from "express";
import { sql, storage } from "./storage";
import { parseReceiptPosting } from "@shared/receipt-posting";
import { receivedOn, ORIGINAL_DOC } from "./receipt-posting";
import { parsePermissions } from "./auth";
import type { ModuleKey } from "@shared/schema";
import { sendPushToUsers } from "./push";

const TZ = "Africa/Nairobi";

// YYYY-MM-DD for "now" in the hotel's timezone (EAT). Using toISOString()
// would give the UTC date, which is still "yesterday" until 03:00 EAT.
export function hotelToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Epoch-ms bounds for a hotel-local calendar day range [from, to] inclusive.
// Nairobi is a fixed UTC+3 offset (no daylight saving).
function dayBoundsMs(from: string, to: string): [number, number] {
  return [Date.parse(`${from}T00:00:00+03:00`), Date.parse(`${addDays(to, 1)}T00:00:00+03:00`)];
}

function userModules(user: any): (k: ModuleKey) => boolean {
  if (user?.isAdmin) return () => true;
  const perms = new Set(parsePermissions(user?.permissions ?? "[]"));
  return (k) => perms.has(k);
}

const n = (v: unknown) => Number(v) || 0;

export function kesText(v: unknown): string {
  return `KES ${Math.round(n(v)).toLocaleString("en-KE")}`;
}

type Range = { from: string; to: string };

interface StreamDef {
  key: string;
  label: string;
  module: ModuleKey;
  link: string;
  query: (r: Range) => Promise<{ amount: number; count: number }>;
}

const STREAMS: StreamDef[] = [
  {
    key: "accommodation", label: "Accommodation", module: "accommodation", link: "/accommodation",
    query: async ({ from, to }) => {
      const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount),0) AS amount, COUNT(*)::int AS count
        FROM accommodation_bookings WHERE status <> 'cancelled' AND check_in BETWEEN ${from} AND ${to}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
  {
    key: "facilities", label: "Conference & Facilities", module: "facilities", link: "/facilities",
    query: async ({ from, to }) => {
      const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount),0) AS amount, COUNT(*)::int AS count
        FROM facility_bookings WHERE status <> 'cancelled' AND event_date BETWEEN ${from} AND ${to}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
  {
    key: "movie", label: "Movie Room", module: "movie-room", link: "/movie-room",
    query: async ({ from, to }) => {
      const [r] = await sql`SELECT COALESCE(SUM(b.ticket_price - b.credited_amount),0) AS amount, COUNT(*)::int AS count
        FROM movie_seat_bookings b JOIN movie_shows s ON s.id = b.show_id
        WHERE b.status <> 'cancelled' AND s.show_date BETWEEN ${from} AND ${to}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
  {
    key: "bar", label: "Bar", module: "bar-restaurant", link: "/bar-restaurant",
    query: async ({ from, to }) => {
      const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount),0) AS amount, COUNT(*)::int AS count
        FROM orders WHERE outlet = 'bar' AND status = 'paid' AND order_date BETWEEN ${from} AND ${to}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
  {
    key: "restaurant", label: "Restaurant", module: "bar-restaurant", link: "/bar-restaurant",
    query: async ({ from, to }) => {
      const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount),0) AS amount, COUNT(*)::int AS count
        FROM orders WHERE outlet = 'restaurant' AND status = 'paid' AND order_date BETWEEN ${from} AND ${to}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
  {
    key: "water", label: "Water Sales", module: "water-sales", link: "/water-sales",
    query: async ({ from, to }) => {
      const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount),0) AS amount, COUNT(*)::int AS count
        FROM water_sales WHERE status = 'completed' AND sale_date BETWEEN ${from} AND ${to}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
  {
    key: "rent", label: "Shop Rent & Electricity", module: "tenants", link: "/tenants",
    query: async ({ from, to }) => {
      const [a, b] = dayBoundsMs(from, to);
      const [r] = await sql`SELECT COALESCE(SUM(amount),0) AS amount, COUNT(*)::int AS count
        FROM rent_invoice_payments WHERE paid_at >= ${a} AND paid_at < ${b}`;
      return { amount: n(r.amount), count: n(r.count) };
    },
  },
];

export interface DirectorAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  link: string;
}

// Counts of documents currently awaiting a decision, per workflow the user can act on.
async function pendingApprovalCounts(can: (k: ModuleKey) => boolean) {
  const out: { key: string; label: string; count: number; oldestAt: number | null; link: string }[] = [];
  const add = async (key: string, label: string, link: string, rows: Promise<any[]>) => {
    const [r] = await rows;
    out.push({ key, label, link, count: n(r?.count), oldestAt: r?.oldest ? n(r.oldest) : null });
  };
  const jobs: Promise<void>[] = [];
  if (can("purchasing")) {
    jobs.push(add("purchase_requisition", "Purchase requisitions", "/purchasing",
      sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM purchase_requisitions WHERE status IN ('pending_review','pending_approval')`));
    jobs.push(add("purchase_order", "Purchase orders", "/purchasing",
      sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM purchase_orders WHERE status IN ('pending_review','pending_approval')`));
  }
  if (can("internal-requisitions")) jobs.push(add("internal_requisition", "Internal requisitions", "/internal-requisitions",
    sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM internal_requisitions WHERE status IN ('pending_review','pending_approval')`));
  if (can("hr")) jobs.push(add("temporary_labor_requisition", "Temporary labour", "/temporary-labor-requisitions",
    sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM temporary_labor_requisitions WHERE status IN ('pending_review','pending_approval')`));
  if (can("leave")) jobs.push(add("leave_request", "Leave requests", "/leave",
    sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM leave_requests WHERE status IN ('pending_review','pending_approval')`));
  if (can("payroll")) jobs.push(add("payroll_run", "Payroll runs", "/payroll",
    sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM payroll_runs WHERE status = 'draft'`));
  if (can("finance")) jobs.push(add("payment_voucher", "Payment vouchers", "/finance",
    sql`SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM payment_vouchers WHERE status NOT IN ('posted','cancelled')`));
  await Promise.all(jobs);
  const order = ["purchase_requisition", "purchase_order", "internal_requisition", "temporary_labor_requisition", "leave_request", "payroll_run", "payment_voucher"];
  out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return out;
}

export async function buildDirectorSummary(user: any, date?: string) {
  const can = userModules(user);
  const today = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : hotelToday();
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  const month = today.slice(0, 7);

  // ---- Income by stream (today / yesterday / month-to-date) ----
  const visibleStreams = STREAMS.filter((s) => can(s.module));
  const streams = await Promise.all(
    visibleStreams.map(async (s) => {
      const [t, y, m] = await Promise.all([
        s.query({ from: today, to: today }),
        s.query({ from: yesterday, to: yesterday }),
        s.query({ from: monthStart, to: today }),
      ]);
      return { key: s.key, label: s.label, link: s.link, today: t.amount, todayCount: t.count, yesterday: y.amount, mtd: m.amount };
    }),
  );
  const income = {
    streams,
    totalToday: streams.reduce((a, s) => a + s.today, 0),
    totalYesterday: streams.reduce((a, s) => a + s.yesterday, 0),
    totalMtd: streams.reduce((a, s) => a + s.mtd, 0),
  };

  // ---- Operations today ----
  let rooms: null | { total: number; inHouse: number; occupancyPct: number; arrivals: number; arrivalsPendingPayment: number; departures: number; outOfOrder: number } = null;
  let arrivalsList: any[] = [];
  if (can("accommodation")) {
    const [[rc], [ih], [ar], [dp]] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'maintenance')::int AS ooo FROM rooms`,
      sql`SELECT COUNT(DISTINCT room_id)::int AS c FROM accommodation_bookings
          WHERE status IN ('confirmed','checked_in') AND check_in <= ${today} AND check_out > ${today}`,
      sql`SELECT COUNT(*)::int AS c, COUNT(*) FILTER (WHERE status = 'pending_payment')::int AS unpaid FROM accommodation_bookings
          WHERE status IN ('pending_payment','confirmed','checked_in') AND check_in = ${today}`,
      sql`SELECT COUNT(*)::int AS c FROM accommodation_bookings WHERE status = 'checked_in' AND check_out = ${today}`,
    ]);
    const total = n(rc.total);
    rooms = {
      total,
      inHouse: n(ih.c),
      occupancyPct: total > 0 ? Math.round((n(ih.c) / total) * 100) : 0,
      arrivals: n(ar.c),
      arrivalsPendingPayment: n(ar.unpaid),
      departures: n(dp.c),
      outOfOrder: n(rc.ooo),
    };
    arrivalsList = (await sql`SELECT b.id, b.guest_name, b.status, b.total_amount, b.amount_paid, b.credited_amount, r.name AS room_name
        FROM accommodation_bookings b LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.status IN ('pending_payment','confirmed','checked_in') AND b.check_in = ${today}
        ORDER BY b.id LIMIT 10`).map((r: any) => ({
      id: r.id, guestName: r.guest_name, roomName: r.room_name, status: r.status,
      balance: Math.max(0, n(r.total_amount) - n(r.credited_amount) - n(r.amount_paid)),
    }));
  }
  let events: any[] = [];
  if (can("facilities")) {
    events = (await sql`SELECT b.id, b.client_name, b.start_time, b.end_time, b.total_amount, b.status, f.name AS facility_name
        FROM facility_bookings b LEFT JOIN facilities f ON f.id = b.facility_id
        WHERE b.status <> 'cancelled' AND b.event_date = ${today} ORDER BY b.start_time NULLS LAST LIMIT 10`).map((r: any) => ({
      id: r.id, clientName: r.client_name, facilityName: r.facility_name, startTime: r.start_time, endTime: r.end_time, amount: n(r.total_amount), status: r.status,
    }));
  }
  let shows: any[] = [];
  let movie: null | {
    bookedToday: { count: number; amount: number };
    unpaid: { count: number; amount: number };
    upcoming: { id: number; title: string; date: string; time: string | null; sold: number; capacity: number; paid: number; due: number }[];
    recent: { id: number; guestName: string; seat: string; showTitle: string; showDate: string; showTime: string | null; amount: number; paid: number; due: number; createdAt: number }[];
    totalBookings: number;
  } = null;
  if (can("movie-room")) {
    const showRow = (r: any) => ({
      id: r.id, title: r.name, date: r.show_date, time: r.start_time ?? null, sold: n(r.sold), capacity: 49, paid: n(r.paid), due: n(r.due),
    });
    const withSeats = sql`SELECT s.*,
        (SELECT COUNT(*)::int FROM movie_seat_bookings b WHERE b.show_id = s.id AND b.status <> 'cancelled') AS sold,
        (SELECT COALESCE(SUM(b.amount_paid),0) FROM movie_seat_bookings b WHERE b.show_id = s.id AND b.status <> 'cancelled') AS paid,
        (SELECT COALESCE(SUM(GREATEST(b.ticket_price - b.credited_amount - b.amount_paid, 0)),0) FROM movie_seat_bookings b WHERE b.show_id = s.id AND b.status <> 'cancelled') AS due
        FROM movie_shows s`;
    // Seats booked today = bookings created since Nairobi midnight (created_at is epoch ms).
    const dayStartMs = Date.parse(`${today}T00:00:00+03:00`);
    const [todayRows, upRows, [bt], [un], recentRows, [tot]] = await Promise.all([
      sql`${withSeats} WHERE s.show_date = ${today} AND s.status <> 'cancelled' ORDER BY s.start_time LIMIT 10`,
      sql`${withSeats} WHERE s.show_date > ${today} AND s.status = 'scheduled' ORDER BY s.show_date, s.start_time LIMIT 5`,
      sql`SELECT COUNT(*)::int AS c, COALESCE(SUM(ticket_price - credited_amount),0) AS a FROM movie_seat_bookings
          WHERE status <> 'cancelled' AND created_at >= ${dayStartMs} AND created_at < ${dayStartMs + 86_400_000}`,
      sql`SELECT COUNT(*)::int AS c, COALESCE(SUM(b.ticket_price - b.credited_amount - b.amount_paid),0) AS a
          FROM movie_seat_bookings b JOIN movie_shows s ON s.id = b.show_id
          WHERE b.status <> 'cancelled' AND s.status <> 'cancelled' AND b.ticket_price - b.credited_amount - b.amount_paid > 0.5`,
      sql`SELECT b.id, b.guest_name, b.seat_row, b.seat_number, b.ticket_price, b.credited_amount, b.amount_paid, b.created_at,
          s.name AS show_name, s.show_date, s.start_time
          FROM movie_seat_bookings b JOIN movie_shows s ON s.id = b.show_id
          WHERE b.status <> 'cancelled' ORDER BY b.created_at DESC, b.id DESC LIMIT 5`,
      sql`SELECT COUNT(*)::int AS c FROM movie_seat_bookings WHERE status <> 'cancelled'`,
    ]);
    shows = todayRows.map(showRow);
    movie = {
      bookedToday: { count: n(bt.c), amount: n(bt.a) },
      unpaid: { count: n(un.c), amount: n(un.a) },
      upcoming: upRows.map(showRow),
      recent: recentRows.map((r: any) => {
        const amount = n(r.ticket_price) - n(r.credited_amount);
        return {
          id: r.id, guestName: r.guest_name, seat: `${r.seat_row}${r.seat_number}`, showTitle: r.show_name, showDate: r.show_date,
          showTime: r.start_time ?? null, amount, paid: n(r.amount_paid), due: Math.max(0, amount - n(r.amount_paid)), createdAt: n(r.created_at),
        };
      }),
      totalBookings: n(tot.c),
    };
  }

  // ---- Money position ----
  let cash: null | { total: number; accounts: { id: number; name: string; balance: number }[] } = null;
  if (can("finance")) {
    const rows = await sql`SELECT ba.id, ba.name, ba.opening_balance,
        COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
                  WHERE je.status = 'posted' AND jel.account_id = ba.gl_account_id), 0) AS movement
        FROM bank_accounts ba WHERE ba.active = 1 ORDER BY ba.name`;
    const accounts = rows.map((r: any) => ({ id: r.id, name: r.name, balance: n(r.opening_balance) + n(r.movement) }));
    cash = { total: accounts.reduce((a, x) => a + x.balance, 0), accounts };
  }
  const receivables: { key: string; label: string; amount: number; count: number; link: string }[] = [];
  if (can("accommodation")) {
    const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount - amount_paid),0) AS amount, COUNT(*)::int AS count
      FROM accommodation_bookings WHERE status <> 'cancelled' AND total_amount - credited_amount - amount_paid > 0.5`;
    receivables.push({ key: "accommodation", label: "Guest balances", amount: n(r.amount), count: n(r.count), link: "/accommodation" });
  }
  if (can("facilities")) {
    const [r] = await sql`SELECT COALESCE(SUM(total_amount - credited_amount - amount_paid),0) AS amount, COUNT(*)::int AS count
      FROM facility_bookings WHERE status <> 'cancelled' AND total_amount - credited_amount - amount_paid > 0.5`;
    receivables.push({ key: "facilities", label: "Event balances", amount: n(r.amount), count: n(r.count), link: "/facilities" });
  }
  if (movie) {
    receivables.push({ key: "movie", label: "Movie seat balances", amount: movie.unpaid.amount, count: movie.unpaid.count, link: "/movie-room" });
  }
  let overdueRent = { amount: 0, count: 0 };
  if (can("tenants")) {
    const [r] = await sql`SELECT COALESCE(SUM(total_amount - amount_paid),0) AS amount, COUNT(*)::int AS count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (WHERE due_date < ${today}),0) AS overdue_amount,
        COUNT(*) FILTER (WHERE due_date < ${today})::int AS overdue_count
      FROM rent_invoices WHERE status NOT IN ('paid','cancelled') AND total_amount - amount_paid > 0.5`;
    receivables.push({ key: "rent", label: "Unpaid rent", amount: n(r.amount), count: n(r.count), link: "/tenants" });
    overdueRent = { amount: n(r.overdue_amount), count: n(r.overdue_count) };
  }
  let expenses: null | { today: number; mtd: number } = null;
  if (can("expenses")) {
    const [r] = await sql`SELECT COALESCE(SUM(amount) FILTER (WHERE date = ${today}),0) AS today,
        COALESCE(SUM(amount) FILTER (WHERE date BETWEEN ${monthStart} AND ${today}),0) AS mtd FROM expenses`;
    expenses = { today: n(r.today), mtd: n(r.mtd) };
  }
  let budget: null | { month: string; budgeted: number; actual: number; proRataBudget: number; pctOfBudget: number } = null;
  if (can("budgeting")) {
    const rows = await storage.getBudgetVariance(month, month);
    const budgeted = rows.reduce((a, r) => a + n(r.budgetedAmount), 0);
    const actual = rows.reduce((a, r) => a + n(r.actualAmount), 0);
    const dayOfMonth = Number(today.slice(8, 10));
    const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    const proRataBudget = budgeted * (dayOfMonth / daysInMonth);
    budget = { month, budgeted, actual, proRataBudget, pctOfBudget: budgeted > 0 ? Math.round((actual / budgeted) * 100) : 0 };
  }

  // ---- People ----
  let people: null | { activeStaff: number; onLeaveToday: number; names: string[] } = null;
  if (can("staff") || can("leave")) {
    const [[s], leave] = await Promise.all([
      sql`SELECT COUNT(*)::int AS c FROM staff WHERE status = 'active'`,
      sql`SELECT st.name FROM leave_requests lr JOIN staff st ON st.id = lr.staff_id
          WHERE lr.status = 'approved' AND lr.start_date <= ${today} AND lr.end_date >= ${today} ORDER BY st.name LIMIT 20`,
    ]);
    people = { activeStaff: n(s.c), onLeaveToday: leave.length, names: leave.map((r: any) => r.name) };
  }

  // ---- Approvals ----
  const approvals = await pendingApprovalCounts(can);
  const approvalsTotal = approvals.reduce((a, x) => a + x.count, 0);

  // ---- Alerts (derived live — they clear themselves once the underlying issue is dealt with) ----
  const alerts: DirectorAlert[] = [];
  const DAY = 86_400_000;
  for (const a of approvals) {
    if (a.count === 0) continue;
    const ageDays = a.oldestAt ? Math.floor((Date.now() - a.oldestAt) / DAY) : 0;
    alerts.push({
      id: `approval-${a.key}`,
      severity: ageDays >= 2 ? "warning" : "info",
      title: `${a.count} ${a.label.toLowerCase()} awaiting a decision`,
      detail: ageDays >= 1 ? `Oldest has been waiting ${ageDays} day${ageDays === 1 ? "" : "s"}.` : "Submitted today.",
      link: "/approvals",
    });
  }
  if (rooms && rooms.arrivalsPendingPayment > 0) {
    alerts.push({ id: "arrivals-unpaid", severity: "warning", title: `${rooms.arrivalsPendingPayment} arrival${rooms.arrivalsPendingPayment === 1 ? "" : "s"} today not yet paid`, detail: "Bookings still in Pending payment status.", link: "/accommodation" });
  }
  if (rooms && rooms.outOfOrder > 0) {
    alerts.push({ id: "rooms-ooo", severity: "info", title: `${rooms.outOfOrder} room${rooms.outOfOrder === 1 ? "" : "s"} under maintenance`, detail: "Not available to sell.", link: "/accommodation" });
  }
  for (const sh of shows) {
    if (sh.due > 0.5) alerts.push({ id: `movie-unpaid-${sh.id}`, severity: "warning", title: `KES ${Math.round(sh.due).toLocaleString("en-KE")} unpaid for today's show`, detail: `${sh.title}${sh.time ? ` at ${sh.time}` : ""} · ${sh.sold} seat${sh.sold === 1 ? "" : "s"} booked`, link: "/movie-room" });
  }
  if (can("maintenance")) {
    const [r] = await sql`SELECT COUNT(*) FILTER (WHERE priority IN ('urgent','high'))::int AS hi, COUNT(*)::int AS total
      FROM maintenance_issues WHERE status IN ('open','in_progress')`;
    if (n(r.hi) > 0) alerts.push({ id: "maint-high", severity: "critical", title: `${n(r.hi)} urgent/high maintenance issue${n(r.hi) === 1 ? "" : "s"} open`, detail: `${n(r.total)} open in total.`, link: "/maintenance" });
    else if (n(r.total) > 0) alerts.push({ id: "maint-open", severity: "info", title: `${n(r.total)} maintenance issue${n(r.total) === 1 ? "" : "s"} open`, detail: "None marked urgent or high.", link: "/maintenance" });
  }
  if (can("inventory")) {
    const low = await sql`SELECT i.name, i.reorder_level, COALESCE(SUM(CASE WHEN l.direction = 'in' THEN l.quantity ELSE -l.quantity END),0) AS on_hand
      FROM inventory_items i LEFT JOIN stock_ledger l ON l.item_id = i.id
      WHERE i.active = 1 AND i.reorder_level > 0 GROUP BY i.id, i.name, i.reorder_level
      HAVING COALESCE(SUM(CASE WHEN l.direction = 'in' THEN l.quantity ELSE -l.quantity END),0) <= i.reorder_level
      ORDER BY i.name`;
    if (low.length > 0) {
      const names = low.slice(0, 3).map((r: any) => r.name).join(", ");
      alerts.push({ id: "stock-low", severity: "warning", title: `${low.length} stock item${low.length === 1 ? "" : "s"} at or below reorder level`, detail: names + (low.length > 3 ? ` and ${low.length - 3} more` : ""), link: "/inventory" });
    }
  }
  if (overdueRent.count > 0) {
    alerts.push({ id: "rent-overdue", severity: "warning", title: `${overdueRent.count} rent invoice${overdueRent.count === 1 ? "" : "s"} overdue`, detail: `KES ${Math.round(overdueRent.amount).toLocaleString("en-KE")} outstanding past due date.`, link: "/tenants" });
  }
  if (budget && budget.budgeted > 0 && budget.actual < budget.proRataBudget * 0.9) {
    const gap = budget.proRataBudget - budget.actual;
    alerts.push({ id: "budget-behind", severity: "warning", title: "Posted income is behind budget", detail: `KES ${Math.round(gap).toLocaleString("en-KE")} below the pro-rata target for today.`, link: "/budgeting" });
  }
  if (people && people.onLeaveToday > 0) {
    alerts.push({ id: "leave-today", severity: "info", title: `${people.onLeaveToday} staff on leave today`, detail: people.names.slice(0, 4).join(", ") + (people.names.length > 4 ? "…" : ""), link: "/leave" });
  }
  // ---- Money received, by where it went (cash drawer, M-Pesa, card, bank) ----
  // Read from the receipts/invoices actually issued: receipts carry the payment amount and method,
  // and an invoice issued with a payment already on it (paid at booking) carries its amountPaid.
  const CAT_MODULE: Record<string, ModuleKey> = {
    accommodation: "accommodation", facility: "facilities", movie: "movie-room", bar: "bar-restaurant",
    restaurant: "bar-restaurant", water: "water-sales", tenancy: "tenants",
  };
  const cats = Object.keys(CAT_MODULE).filter((c) => can(CAT_MODULE[c]));
  let collections: null | {
    methods: { key: string; label: string; today: number; todayCount: number; yesterday: number; mtd: number }[];
    totalToday: number; totalYesterday: number; totalMtd: number;
  } = null;
  if (cats.length) {
    const dayStart = Date.parse(`${today}T00:00:00+03:00`);
    const yStart = dayStart - 86_400_000;
    const mStart = Date.parse(`${monthStart}T00:00:00+03:00`);
    const end = dayStart + 86_400_000;
    const rows = await sql`SELECT d.doc_type, d.amount, d.payload_json, d.created_at FROM documents d
      WHERE d.doc_type IN ('receipt','invoice') AND d.category IN ${sql(cats)} AND ${ORIGINAL_DOC("d")}
        AND d.created_at >= ${Math.min(mStart, yStart)} AND d.created_at < ${end}` as any[];
    const st = await storage.getSettings();
    const mpesaLabel = st.mpesaPaymentType === "paybill" ? "M-Pesa Paybill (to bank)" : st.mpesaPaymentType === "phone" ? "M-Pesa (phone)" : "M-Pesa Till";
    const LABEL: Record<string, string> = { cash: "Cash (drawer)", mpesa: mpesaLabel, card: "Card (to bank)", bank_transfer: "Bank transfer", other: "Method not recorded" };
    const agg = new Map<string, { today: number; todayCount: number; yesterday: number; mtd: number }>();
    for (const r of rows) {
      let p: any = {};
      try { p = JSON.parse(r.payload_json || "{}"); } catch { /* old row */ }
      const amt = r.doc_type === "receipt" ? n(p.paymentAmount ?? r.amount) : n(p.amountPaid);
      if (!(amt > 0)) continue;
      const m = String(p.paymentMethod || "").toLowerCase().replace(/[\s-]+/g, "_");
      const key = m === "m_pesa" ? "mpesa" : m === "bank" ? "bank_transfer" : (LABEL[m] ? m : "other");
      const a = agg.get(key) ?? { today: 0, todayCount: 0, yesterday: 0, mtd: 0 };
      const at = n(r.created_at);
      if (at >= dayStart) { a.today += amt; a.todayCount += 1; }
      else if (at >= yStart) a.yesterday += amt;
      if (at >= mStart) a.mtd += amt;
      agg.set(key, a);
    }
    const order = ["cash", "mpesa", "card", "bank_transfer", "other"];
    const methods = order.filter((k) => agg.has(k)).map((k) => ({ key: k, label: LABEL[k], ...agg.get(k)! }));
    collections = {
      methods,
      totalToday: methods.reduce((t, x) => t + x.today, 0),
      totalYesterday: methods.reduce((t, x) => t + x.yesterday, 0),
      totalMtd: methods.reduce((t, x) => t + x.mtd, 0),
    };
  }

  // Receipts → Finance: flag payments that should have posted but didn't (closed period, missing account…).
  if (can("finance")) {
    const cfg = parseReceiptPosting((await storage.getSettings() as any).receiptPosting);
    if (cfg.enabled) {
      const fromMs = Date.parse(`${cfg.startDate || today}T00:00:00+03:00`);
      const rows = await sql`SELECT d.doc_type, d.amount, d.payload_json FROM documents d
        WHERE d.doc_type IN ('receipt','invoice') AND d.created_at >= ${fromMs} AND ${ORIGINAL_DOC("d")}
          AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_module = 'receipts' AND je.source_id = d.id AND je.status = 'posted')` as any[];
      const unposted = rows.map((r) => receivedOn({ docType: r.doc_type, amount: n(r.amount), payloadJson: r.payload_json }).amount).filter((a) => a > 0);
      if (unposted.length) alerts.push({ id: "receipts-unposted", severity: "warning", title: `${unposted.length} receipt${unposted.length === 1 ? "" : "s"} not posted to Finance`, detail: `${kesText(unposted.reduce((t, a) => t + a, 0))} — check the accounting period is open and accounts are chosen in Settings → Receipts to Finance.`, link: "/settings" });
    }
  }

  // Integrity checks: surface the latest failures (daily checks and the monthly tax check).
  if (can("integrity")) {
    const runs = await sql`SELECT DISTINCT ON (kind) kind, period, fails, warns FROM integrity_runs ORDER BY kind, id DESC` as any[];
    for (const r of runs) {
      if (Number(r.fails) > 0) alerts.push({ id: `integrity-${r.kind}`, severity: r.kind === "daily" ? "critical" : "warning",
        title: r.kind === "daily" ? `Integrity checks: ${r.fails} failed` : `Tax check ${r.period}: ${r.fails} failed`,
        detail: `${r.fails} failed, ${r.warns} warning${Number(r.warns) === 1 ? "" : "s"} — open Integrity checks to see each record.`, link: r.kind === "daily" ? "/integrity" : "/integrity" });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    date: today,
    generatedAt: Date.now(),
    income,
    rooms,
    arrivals: arrivalsList,
    events,
    shows,
    movie,
    cash,
    collections,
    receivables,
    expenses,
    budget,
    people,
    approvals: { total: approvalsTotal, byType: approvals },
    alerts,
  };
}

// ---------------- In-app notifications ----------------

export interface NotifyInput {
  title: string;
  body?: string | null;
  linkPath?: string | null;
  category?: string; // approval | decision | booking | maintenance | leave | system
}

// Store a notification for a set of user ids. Never throws — a notification
// failure must never break the business action that triggered it.
export async function notifyUserIds(userIds: number[], input: NotifyInput): Promise<void> {
  try {
    const ids = Array.from(new Set(userIds.filter((x) => Number.isFinite(x))));
    if (ids.length === 0) return;
    const now = Date.now();
    for (const uid of ids) {
      await sql`INSERT INTO notifications (user_id, category, title, body, link_path, created_at)
        VALUES (${uid}, ${input.category ?? "system"}, ${input.title}, ${input.body ?? null}, ${input.linkPath ?? null}, ${now})`;
    }
    // Also deliver to the users' phones/browsers that turned on push alerts.
    void sendPushToUsers(ids, { title: input.title, body: input.body ?? null, url: input.linkPath ?? "/", tag: input.category ?? "system" });
  } catch (err) {
    console.error("[notifications] failed to store notification:", err);
  }
}

// Notify every active user who holds `moduleKey` (admins always included).
export async function notifyModuleUsers(moduleKey: ModuleKey, input: NotifyInput, excludeUserId?: number): Promise<void> {
  try {
    const users = await storage.listUsers();
    const ids = users
      .filter((u: any) => u.active && (u.isAdmin || parsePermissions(u.permissions).includes(moduleKey)))
      .map((u: any) => u.id as number)
      .filter((id) => id !== excludeUserId);
    await notifyUserIds(ids, input);
  } catch (err) {
    console.error("[notifications] failed to resolve recipients:", err);
  }
}

// Notify the active user whose full name matches (requesters are stored by name).
export async function notifyUserByFullName(fullName: string, input: NotifyInput): Promise<void> {
  try {
    const users = await storage.listUsers();
    const ids = users.filter((u: any) => u.active && u.fullName === fullName).map((u: any) => u.id as number);
    await notifyUserIds(ids, input);
  } catch (err) {
    console.error("[notifications] failed to resolve requester:", err);
  }
}

function currentUserId(req: Request): number {
  return Number((req as any).user?.id);
}

// Mounted after `app.use("/api", requireAuth)` in routes.ts, so req.user is always set.
export function registerDirectorRoutes(app: Express) {
  app.get("/api/director/summary", async (req, res) => {
    try {
      res.json(await buildDirectorSummary((req as any).user, typeof req.query.date === "string" ? req.query.date : undefined));
    } catch (err: any) {
      console.error("[director] summary failed:", err);
      res.status(500).json({ error: err?.message ?? "Failed to build summary" });
    }
  });

  // Notifications are removed as soon as they are read (opened) or deleted,
  // so the list only ever holds what still needs attention.
  app.get("/api/notifications", async (req, res) => {
    const uid = currentUserId(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = await sql`SELECT id, category, title, body, link_path, created_at, read_at FROM notifications
      WHERE user_id = ${uid} AND read_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    const [{ c }] = await sql`SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ${uid} AND read_at IS NULL`;
    res.json({
      unread: n(c),
      items: rows.map((r: any) => ({ id: r.id, category: r.category, title: r.title, body: r.body, linkPath: r.link_path, createdAt: n(r.created_at), readAt: null })),
    });
  });

  // Body: { ids?: number[] } — omit ids to remove everything for this user.
  const removeNotifications = async (req: any, res: any) => {
    const uid = currentUserId(req);
    if (!uid) return res.status(401).json({ error: "Not signed in" });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter(Number.isFinite) : null;
    if (ids && ids.length > 0) {
      await sql`DELETE FROM notifications WHERE user_id = ${uid} AND id IN ${sql(ids)}`;
    } else {
      await sql`DELETE FROM notifications WHERE user_id = ${uid}`;
    }
    res.json({ ok: true });
  };
  app.post("/api/notifications/read", removeNotifications);
  app.post("/api/notifications/delete", removeNotifications);
  app.delete("/api/notifications/read", removeNotifications);
  app.delete("/api/notifications/:id", async (req, res) => {
    const uid = currentUserId(req);
    if (!uid) return res.status(401).json({ error: "Not signed in" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    await sql`DELETE FROM notifications WHERE user_id = ${uid} AND id = ${id}`;
    res.json({ ok: true });
  });
}
