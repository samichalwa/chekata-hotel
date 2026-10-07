// Integrity checks. Read-only: nothing here ever changes data, it only reports.
//  • Daily checks (money & Finance, payments & bookings, stock & payroll): button + nightly.
//  • Tax check (monthly, per calendar month): button + automatic run for the previous month.
// Every run is stored in integrity_runs so the last result shows on the page and in alerts.
import { sql, storage } from "./storage";
import { runWithEnvironment } from "./db-context";
import { parseReceiptPosting } from "@shared/receipt-posting";
import { receivedOn, ORIGINAL_DOC, NOT_SELF_POSTED } from "./receipt-posting";
import { normalizeRef, isRealRef } from "./payment-refs";
import { computeInclusiveTaxBreakdown } from "./tax";
import { DOC_CATEGORY_TO_TAX_CATEGORY } from "./documents";
import type { Tax } from "@shared/schema";
import { linkProblems } from "./shpms";

export type CheckStatus = "pass" | "warn" | "fail";
export interface CheckItem { label: string; detail: string; link?: string }
export interface CheckResult { id: string; group: string; title: string; description: string; status: CheckStatus; summary: string; count: number; items: CheckItem[] }
export interface IntegrityRun { id?: number; kind: "daily" | "tax"; period: string; ranAt: number; ranBy: string; fails: number; warns: number; checks: CheckResult[]; taxSummary?: TaxSummaryRow[] }
export interface TaxSummaryRow { taxName: string; ratePercent: number; stream: string; gross: number; base: number; tax: number; creditGross: number; creditTax: number; netTax: number; documents: number }

const MAX_ITEMS = 40;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const TZ = 3 * 3600_000;
const nairobiDate = (ms: number) => new Date(ms + TZ).toISOString().slice(0, 10);
export const nairobiToday = () => nairobiDate(Date.now());
const parse = (j: unknown): any => { try { return JSON.parse(String(j || "{}")); } catch { return {}; } };
const LINK: Record<string, string> = { accommodation: "/accommodation", facility: "/facilities", movie: "/movie-room", bar: "/bar-restaurant", restaurant: "/bar-restaurant", tenancy: "/tenants", water: "/water-sales", water_bill: "/water-sales" };
const STREAM: Record<string, string> = { accommodation: "Accommodation", facility: "Conference & facilities", movie: "Movie room", bar: "Bar", restaurant: "Restaurant", tenancy: "Shop rent & electricity", water: "Water sales", water_bill: "Metered water bills" };

function result(group: string, id: string, title: string, description: string, items: CheckItem[], level: "warn" | "fail", okText: string, badText: (k: number) => string): CheckResult {
  return { id, group, title, description, status: items.length ? level : "pass", count: items.length, summary: items.length ? badText(items.length) : okText, items: items.slice(0, MAX_ITEMS) };
}
async function guarded(group: string, id: string, title: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try { return await fn(); } catch (e: any) {
    return { id, group, title, description: "", status: "fail", count: 1, summary: `The check could not run: ${e?.message ?? e}`, items: [] };
  }
}

// ======================= Daily checks =======================
const A = "Money & Finance", B = "Payments & bookings", D = "Stock & payroll";

async function checkReceiptsPosted(): Promise<CheckResult> {
  const cfg = parseReceiptPosting((await storage.getSettings() as any).receiptPosting);
  const title = "Every receipt is posted to Finance with the right amount";
  const desc = "Each payment receipt since the posting start date has exactly one Finance journal for the same amount.";
  if (!cfg.enabled) return { id: "A1", group: A, title, description: desc, status: "warn", count: 0, summary: "Receipts to Finance is switched off (Settings → Receipts to Finance), so this can't be checked.", items: [] };
  const fromMs = Date.parse(`${cfg.startDate || "2000-01-01"}T00:00:00+03:00`);
  const docs = await sql`SELECT d.id, d.doc_type, d.category, d.recipient_name, d.amount, d.payload_json, d.created_at FROM documents d
    WHERE d.doc_type IN ('receipt','invoice') AND d.created_at >= ${fromMs} AND ${ORIGINAL_DOC("d")} AND ${NOT_SELF_POSTED("d")} ORDER BY d.created_at` as any[];
  const jes = await sql`SELECT je.source_id, je.entry_number, COALESCE(SUM(l.debit),0) AS dr FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id
    WHERE je.source_module = 'receipts' AND je.status = 'posted' GROUP BY je.id, je.source_id, je.entry_number` as any[];
  const bySrc = new Map<number, { no: string; dr: number }[]>();
  for (const j of jes) { const k = Number(j.source_id); bySrc.set(k, [...(bySrc.get(k) ?? []), { no: j.entry_number, dr: n(j.dr) }]); }
  const items: CheckItem[] = [];
  for (const d of docs) {
    const amt = receivedOn({ docType: d.doc_type, amount: n(d.amount), payloadJson: d.payload_json }).amount;
    if (!(amt > 0)) continue;
    const j = bySrc.get(Number(d.id)) ?? [];
    const label = `${d.doc_type === "receipt" ? "Receipt" : "Invoice"} #${d.id} · ${d.recipient_name ?? ""} · ${nairobiDate(Number(d.created_at))}`;
    if (j.length === 0) items.push({ label, detail: `${kes(amt)} received but not posted to Finance.`, link: "/settings" });
    else if (Math.abs(j[0].dr - amt) > 0.5) items.push({ label, detail: `Receipt ${kes(amt)} but journal ${j[0].no} is ${kes(j[0].dr)}.`, link: "/finance" });
  }
  return result(A, "A1", title, desc, items, "fail", `All receipts since ${cfg.startDate || "the start"} are posted.`, (k) => `${k} receipt${k === 1 ? "" : "s"} missing or wrong in Finance.`);
}

async function checkReceiptJournalsTieBack(): Promise<CheckResult> {
  const rows = await sql`SELECT je.id, je.entry_number, je.source_id, je.entry_date, d.id AS doc_id, ${ORIGINAL_DOC("d")} AS original
    FROM journal_entries je LEFT JOIN documents d ON d.id = je.source_id
    WHERE je.source_module = 'receipts' AND je.status = 'posted' ORDER BY je.id` as any[];
  const items: CheckItem[] = [];
  const seen = new Map<number, string>();
  for (const r of rows) {
    if (!r.doc_id) { items.push({ label: `Journal ${r.entry_number} · ${r.entry_date}`, detail: `Posted for receipt #${r.source_id}, which no longer exists. Cancel the journal.`, link: "/finance" }); continue; }
    if (r.original === false) items.push({ label: `Journal ${r.entry_number} · ${r.entry_date}`, detail: `Posted for document #${r.source_id}, a resent copy — the same money is already counted on the original. Cancel this journal.`, link: "/finance" });
    const prev = seen.get(Number(r.source_id));
    if (prev) items.push({ label: `Journal ${r.entry_number} · ${r.entry_date}`, detail: `Second posting for receipt #${r.source_id} (first was ${prev}). Cancel one.`, link: "/finance" });
    else seen.set(Number(r.source_id), r.entry_number);
  }
  return result(A, "A2", "Finance receipt journals tie back to a receipt, once", "No receipt journal without its receipt, none for a resent copy, and none posted twice.", items, "fail", "Every receipt journal matches one receipt.", (k) => `${k} receipt journal${k === 1 ? "" : "s"} to correct.`);
}

async function checkJournalsBalance(): Promise<CheckResult> {
  const rows = await sql`SELECT je.id, je.entry_number, je.entry_date, je.description, COUNT(l.id) AS lines, COALESCE(SUM(l.debit),0) AS dr, COALESCE(SUM(l.credit),0) AS cr,
      COUNT(l.id) FILTER (WHERE c.id IS NULL) AS bad_accounts
    FROM journal_entries je LEFT JOIN journal_entry_lines l ON l.journal_entry_id = je.id LEFT JOIN chart_of_accounts c ON c.id = l.account_id
    WHERE je.status = 'posted' GROUP BY je.id ORDER BY je.id` as any[];
  const periods = await sql`SELECT name, start_date, end_date, status, closed_at FROM accounting_periods` as any[];
  const created = await sql`SELECT id, created_at FROM journal_entries WHERE status = 'posted'` as any[];
  const createdAt = new Map(created.map((c) => [Number(c.id), Number(c.created_at)]));
  const items: CheckItem[] = [];
  for (const r of rows) {
    const label = `Journal ${r.entry_number} · ${r.entry_date}`;
    if (Number(r.lines) < 2) items.push({ label, detail: `Has ${r.lines} line(s); a journal needs at least two.`, link: "/finance" });
    else if (Math.abs(n(r.dr) - n(r.cr)) > 0.01) items.push({ label, detail: `Debits ${kes(n(r.dr))} ≠ credits ${kes(n(r.cr))}.`, link: "/finance" });
    if (Number(r.bad_accounts) > 0) items.push({ label, detail: `${r.bad_accounts} line(s) point to an account that no longer exists.`, link: "/finance" });
    const p = periods.find((x) => x.status === "closed" && x.start_date <= r.entry_date && x.end_date >= r.entry_date);
    if (p && p.closed_at && (createdAt.get(Number(r.id)) ?? 0) > Number(p.closed_at)) items.push({ label, detail: `Posted after period "${p.name}" was closed.`, link: "/finance" });
  }
  return result(A, "A3", "Every journal balances and respects closed periods", "Debits equal credits, at least two lines, valid accounts, and nothing posted into a period after it was closed.", items, "fail", `All ${rows.length} posted journals balance.`, (k) => `${k} journal problem${k === 1 ? "" : "s"}.`);
}

async function checkCollectionsVsLedger(): Promise<CheckResult> {
  const cfg = parseReceiptPosting((await storage.getSettings() as any).receiptPosting);
  const title = "Money received matches Finance cash & bank, day by day";
  const desc = "For each of the last 7 days: receipts issued (daily close \"Money received\") = receipt postings into the cash & bank accounts.";
  if (!cfg.enabled) return { id: "A4", group: A, title, description: desc, status: "warn", count: 0, summary: "Receipts to Finance is switched off, so the ledger can't be compared.", items: [] };
  const items: CheckItem[] = [];
  const start = cfg.startDate && cfg.startDate > nairobiDate(Date.now() - 7 * 86400_000) ? cfg.startDate : nairobiDate(Date.now() - 7 * 86400_000);
  const fromMs = Date.parse(`${start}T00:00:00+03:00`);
  const docs = await sql`SELECT d.doc_type, d.amount, d.payload_json, d.created_at FROM documents d
    WHERE d.doc_type IN ('receipt','invoice') AND d.created_at >= ${fromMs} AND ${ORIGINAL_DOC("d")} AND ${NOT_SELF_POSTED("d")}` as any[];
  const recv = new Map<string, number>();
  for (const d of docs) { const a = receivedOn({ docType: d.doc_type, amount: n(d.amount), payloadJson: d.payload_json }).amount; if (a > 0) { const k = nairobiDate(Number(d.created_at)); recv.set(k, (recv.get(k) ?? 0) + a); } }
  const led = await sql`SELECT je.entry_date, SUM(l.debit) AS dr FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id
    JOIN bank_accounts b ON b.gl_account_id = l.account_id
    WHERE je.source_module = 'receipts' AND je.status = 'posted' AND je.entry_date >= ${start} GROUP BY je.entry_date` as any[];
  const ledger = new Map(led.map((x) => [String(x.entry_date), n(x.dr)]));
  const days = new Set(Array.from(recv.keys()).concat(Array.from(ledger.keys())));
  for (const day of Array.from(days).sort()) {
    const a = recv.get(day) ?? 0, b = ledger.get(day) ?? 0;
    if (Math.abs(a - b) > 0.5) items.push({ label: day, detail: `Receipts ${kes(a)} vs Finance cash & bank ${kes(b)} (difference ${kes(a - b)}).`, link: "/daily-close" });
  }
  return result(A, "A4", title, desc, items, "fail", `Matched for every day since ${start}.`, (k) => `${k} day${k === 1 ? "" : "s"} don't match.`);
}

async function checkDuplicateRefs(): Promise<CheckResult> {
  // owner = the one record a reference belongs to; `refs` = booking refs that an online payment may legitimately share it with.
  const uses = new Map<string, { owner: string; label: string; refs: string[] }[]>();
  const add = (ref: unknown, owner: string, label: string, refs: string[] = []) => {
    const r = normalizeRef(ref); if (!isRealRef(r)) return;
    const list = uses.get(r) ?? []; if (!list.some((x) => x.owner === owner)) list.push({ owner, label, refs }); uses.set(r, list);
  };
  const T: [string, string, string, string | null][] = [
    ["accommodation_bookings", "Room booking", "id", "booking_ref"], ["facility_bookings", "Event booking", "id", null],
    ["movie_seat_bookings", "Movie booking", "booking_ref", "booking_ref"], ["orders", "Bar/restaurant order", "id", null],
    ["payment_vouchers", "Payment voucher", "id", null], ["rent_invoice_payments", "Rent payment", "id", null],
    ["water_sales", "Water sale", "id", null], ["water_bill_payments", "Metered water payment", "id", null], ["table_reservations", "Table reservation", "reservation_ref", "reservation_ref"],
  ];
  for (const [table, label, key, refCol] of T) {
    const rows = await sql.unsafe(`SELECT ${key} AS k${refCol ? `, ${refCol} AS bref` : ""}, payment_reference FROM ${table} WHERE COALESCE(payment_reference,'') <> ''`) as any[];
    for (const r of rows) add(r.payment_reference, `${table}:${r.k}`, `${label} ${r.k}`, r.bref ? [String(r.bref)] : []);
  }
  const op = await sql`SELECT id, mpesa_code, target_ref, kind FROM online_payments WHERE status <> 'rejected'` as any[];
  const items: CheckItem[] = [];
  for (const [ref, list] of Array.from(uses.entries())) if (list.length > 1) items.push({ label: ref, detail: `Used on ${list.map((x) => x.label).join("; ")}.` });
  for (const o of op) {
    const list = uses.get(normalizeRef(o.mpesa_code)) ?? [];
    const foreign = list.filter((x) => !(x.refs.includes(String(o.target_ref))) && !(o.kind === "bill" && x.owner.startsWith("orders:")));
    if (foreign.length) items.push({ label: normalizeRef(o.mpesa_code), detail: `Online payment for ${o.target_ref} and also ${foreign.map((x) => x.label).join("; ")}.`, link: "/online-bookings" });
  }
  return result(B, "B5", "No payment reference is used twice", "Each M-Pesa code / bank reference belongs to one booking, order, voucher or sale only.", items, "fail", `${uses.size} payment references checked — no duplicates.`, (k) => `${k} reference${k === 1 ? "" : "s"} used more than once.`);
}

async function checkBookingBalances(): Promise<CheckResult> {
  const items: CheckItem[] = [];
  const lastDoc = new Map<string, number>();
  const docs = await sql`SELECT d.category, d.source_id, d.payload_json FROM documents d WHERE d.doc_type IN ('receipt','invoice') AND ${ORIGINAL_DOC("d")} ORDER BY d.id` as any[];
  for (const d of docs) lastDoc.set(`${d.category}:${d.source_id}`, n(parse(d.payload_json).amountPaid));
  const rooms = await sql`SELECT id, guest_name, total_amount, amount_paid, credited_amount, status FROM accommodation_bookings WHERE status <> 'cancelled'` as any[];
  const events = await sql`SELECT id, client_name AS guest_name, total_amount, amount_paid, credited_amount, status FROM facility_bookings WHERE status <> 'cancelled'` as any[];
  const seats = await sql`SELECT booking_ref, MIN(id) AS id, MIN(guest_name) AS guest_name, SUM(ticket_price) AS total_amount, SUM(amount_paid) AS amount_paid, SUM(credited_amount) AS credited_amount
    FROM movie_seat_bookings WHERE status <> 'cancelled' GROUP BY booking_ref` as any[];
  const scan = (rows: any[], cat: string, what: string) => {
    for (const r of rows) {
      const total = n(r.total_amount) - n(r.credited_amount), paid = n(r.amount_paid);
      const label = `${what} ${r.booking_ref ?? `#${r.id}`} · ${r.guest_name}`;
      if (paid < -0.01) items.push({ label, detail: `Amount paid is negative (${kes(paid)}).`, link: LINK[cat] });
      else if (paid > total + 0.5) items.push({ label, detail: `Paid ${kes(paid)} is more than the total ${kes(total)} — overpaid by ${kes(paid - total)}.`, link: LINK[cat] });
      const docPaid = lastDoc.get(`${cat}:${r.id}`);
      if (paid > 0.5 && docPaid === undefined) items.push({ label, detail: `${kes(paid)} recorded as paid but no invoice or receipt was issued.`, link: LINK[cat] });
      else if (docPaid !== undefined && Math.abs(docPaid - paid) > 0.5) items.push({ label, detail: `Booking shows ${kes(paid)} paid; its latest invoice/receipt shows ${kes(docPaid)}.`, link: LINK[cat] });
    }
  };
  scan(rooms, "accommodation", "Room booking"); scan(events, "facility", "Event"); scan(seats, "movie", "Movie booking");
  return result(B, "B6", "Booking balances agree with receipts", "Paid is never negative or more than the total, and every payment has a matching invoice/receipt.", items, "fail", `${rooms.length + events.length + seats.length} bookings checked.`, (k) => `${k} booking${k === 1 ? "" : "s"} to review.`);
}

async function checkOnlinePayments(): Promise<CheckResult> {
  const items: CheckItem[] = [];
  const confirmedUnpaid = await sql`SELECT id, guest_name, status FROM accommodation_bookings WHERE status IN ('confirmed','checked_in') AND amount_paid <= 0 AND overridden_by IS NULL` as any[];
  for (const r of confirmedUnpaid) items.push({ label: `Room booking #${r.id} · ${r.guest_name}`, detail: `Status "${r.status}" with no payment and no recorded override.`, link: "/accommodation" });
  const evUnpaid = await sql`SELECT id, client_name FROM facility_bookings WHERE status = 'confirmed' AND amount_paid <= 0 AND overridden_by IS NULL` as any[];
  for (const r of evUnpaid) items.push({ label: `Event #${r.id} · ${r.client_name}`, detail: "Confirmed with no payment and no recorded override.", link: "/facilities" });
  const old = await sql`SELECT id, kind, target_ref, guest_name, amount, created_at FROM online_payments WHERE status = 'pending' AND created_at < ${Date.now() - 24 * 3600_000}` as any[];
  for (const r of old) items.push({ label: `Online payment ${r.target_ref} · ${r.guest_name}`, detail: `${kes(n(r.amount))} waiting for verification since ${nairobiDate(Number(r.created_at))} (over 24 h).`, link: "/online-bookings" });
  const stuck = await sql`SELECT op.target_ref, op.guest_name FROM online_payments op JOIN accommodation_bookings b ON b.booking_ref = op.target_ref
    WHERE op.kind = 'room' AND op.status = 'verified' AND b.status = 'pending_payment'` as any[];
  for (const r of stuck) items.push({ label: `Online room ${r.target_ref} · ${r.guest_name}`, detail: "Payment verified but the booking is still awaiting payment.", link: "/accommodation" });
  const stuckT = await sql`SELECT op.target_ref, op.guest_name FROM online_payments op JOIN table_reservations t ON t.reservation_ref = op.target_ref
    WHERE op.kind = 'table' AND op.status = 'verified' AND t.status = 'awaiting_verification'` as any[];
  for (const r of stuckT) items.push({ label: `Table reservation ${r.target_ref} · ${r.guest_name}`, detail: "Deposit verified but the reservation is still awaiting verification.", link: "/online-bookings" });
  return result(B, "B7", "Confirmed bookings are paid; online payments are dealt with", "No booking confirmed without payment (unless overridden), no online payment pending over 24 h, and verified payments have confirmed their booking.", items, "fail", "All confirmed bookings are paid and online payments are up to date.", (k) => `${k} item${k === 1 ? "" : "s"} to deal with.`);
}

async function checkShpmsLink(): Promise<CheckResult> {
  const title = "SHPMS and The Chekata agree";
  const desc = "Every SHPMS update was recorded, every payment confirmed here reached SHPMS and Finance, and invoice balances match SHPMS.";
  const items = await linkProblems();
  if (items === null) return { id: "B9", group: B, title, description: desc, status: "pass", count: 0, summary: "The SHPMS link is switched off.", items: [] };
  return result(B, "B9", title, desc, items, "warn", "SHPMS and The Chekata match.", (k) => `${k} difference${k === 1 ? "" : "s"} with SHPMS.`);
}

async function checkRooms(): Promise<CheckResult> {
  const items: CheckItem[] = [];
  const overlaps = await sql`SELECT a.id AS a_id, b.id AS b_id, a.guest_name AS a_name, b.guest_name AS b_name, r.name AS room, a.check_in, a.check_out, b.check_in AS b_in, b.check_out AS b_out
    FROM accommodation_bookings a JOIN accommodation_bookings b ON a.room_id = b.room_id AND a.id < b.id
    LEFT JOIN rooms r ON r.id = a.room_id
    WHERE a.status <> 'cancelled' AND b.status <> 'cancelled' AND a.check_in < b.check_out AND b.check_in < a.check_out` as any[];
  for (const o of overlaps) items.push({ label: `Room ${o.room ?? ""} double-booked`, detail: `#${o.a_id} ${o.a_name} (${o.check_in}→${o.check_out}) overlaps #${o.b_id} ${o.b_name} (${o.b_in}→${o.b_out}).`, link: "/accommodation" });
  const out = await sql`SELECT id, guest_name, total_amount, amount_paid, credited_amount, check_out FROM accommodation_bookings
    WHERE status = 'checked_out' AND total_amount - credited_amount - amount_paid > 0.5` as any[];
  for (const o of out) items.push({ label: `Room booking #${o.id} · ${o.guest_name}`, detail: `Checked out ${o.check_out} owing ${kes(n(o.total_amount) - n(o.credited_amount) - n(o.amount_paid))}.`, link: "/accommodation" });
  return result(B, "B8", "No double-booked rooms; checked-out guests have settled", "Active bookings never overlap in the same room, and no one has checked out with a balance.", items, "fail", "No overlaps and no unpaid check-outs.", (k) => `${k} room issue${k === 1 ? "" : "s"}.`);
}

async function checkStock(): Promise<CheckResult> {
  const items: CheckItem[] = [];
  const rows = await sql`SELECT l.item_id, l.store_id, i.name AS item, s.name AS store,
      SUM(CASE WHEN l.direction = 'in' THEN l.quantity ELSE -l.quantity END) AS computed,
      (ARRAY_AGG(l.balance_after ORDER BY l.created_at DESC, l.id DESC))[1] AS last_balance
    FROM stock_ledger l LEFT JOIN inventory_items i ON i.id = l.item_id LEFT JOIN stores s ON s.id = l.store_id
    GROUP BY l.item_id, l.store_id, i.name, s.name` as any[];
  for (const r of rows) {
    const label = `${r.item ?? `Item ${r.item_id}`} · ${r.store ?? `Store ${r.store_id}`}`;
    if (n(r.last_balance) < -0.0001) items.push({ label, detail: `Negative stock: ${r2(n(r.last_balance))}.`, link: "/inventory" });
    if (Math.abs(n(r.computed) - n(r.last_balance)) > 0.0001) items.push({ label, detail: `Stock on hand ${r2(n(r.last_balance))} but receipts − issues = ${r2(n(r.computed))}.`, link: "/inventory" });
  }
  return result(D, "D12", "Stock is never negative and the ledger adds up", "For each item and store, quantity on hand equals everything received minus everything issued.", items, "fail", `${rows.length} item/store balances checked.`, (k) => `${k} stock problem${k === 1 ? "" : "s"}.`);
}

async function checkPayroll(): Promise<CheckResult> {
  const items: CheckItem[] = [];
  const runs = await sql`SELECT * FROM payroll_runs WHERE status <> 'cancelled' ORDER BY id` as any[];
  const lines = await sql`SELECT l.*, s.name AS full_name FROM payroll_lines l LEFT JOIN staff s ON s.id = l.staff_id` as any[];
  for (const run of runs) {
    const ls = lines.filter((l) => Number(l.payroll_run_id) === Number(run.id));
    const label = `Payroll ${run.run_number} (${run.period_month})`;
    for (const l of ls) {
      const ded = n(l.paye_amount) + n(l.nssf_employee_amount) + n(l.shif_amount) + n(l.housing_levy_employee_amount);
      if (Math.abs(n(l.total_deductions) - ded) > 1) items.push({ label, detail: `${l.full_name ?? `Staff ${l.staff_id}`}: deductions ${kes(n(l.total_deductions))} ≠ PAYE+NSSF+SHIF+AHL ${kes(ded)}.`, link: "/payroll" });
      if (Math.abs(n(l.gross_pay) - n(l.total_deductions) - n(l.net_pay)) > 1) items.push({ label, detail: `${l.full_name ?? `Staff ${l.staff_id}`}: gross ${kes(n(l.gross_pay))} − deductions ${kes(n(l.total_deductions))} ≠ net ${kes(n(l.net_pay))}.`, link: "/payroll" });
      if (n(l.net_pay) < -0.01) items.push({ label, detail: `${l.full_name ?? `Staff ${l.staff_id}`}: negative net pay.`, link: "/payroll" });
    }
    const sum = (k: string) => ls.reduce((t, l) => t + n(l[k]), 0);
    if (Math.abs(sum("gross_pay") - n(run.total_gross)) > 1 || Math.abs(sum("net_pay") - n(run.total_net)) > 1) items.push({ label, detail: `Run totals (gross ${kes(n(run.total_gross))}, net ${kes(n(run.total_net))}) don't equal its lines (gross ${kes(sum("gross_pay"))}, net ${kes(sum("net_pay"))}).`, link: "/payroll" });
    if (run.status === "approved") {
      if (!run.journal_entry_id) { items.push({ label, detail: "Approved but no payroll journal was posted.", link: "/payroll" }); continue; }
      const je = (await sql`SELECT je.status, COALESCE(SUM(l.debit),0) AS dr, COALESCE(SUM(l.credit),0) AS cr FROM journal_entries je LEFT JOIN journal_entry_lines l ON l.journal_entry_id = je.id WHERE je.id = ${run.journal_entry_id} GROUP BY je.id` as any[])[0];
      const employer = sum("nssf_employer_amount") + sum("housing_levy_employer_amount");
      if (!je) items.push({ label, detail: "Its payroll journal no longer exists.", link: "/finance" });
      else if (je.status !== "posted") items.push({ label, detail: "Its payroll journal has been cancelled while the run is still approved.", link: "/finance" });
      else if (Math.abs(n(je.dr) - (sum("gross_pay") + employer)) > 1) items.push({ label, detail: `Journal debits ${kes(n(je.dr))} ≠ gross + employer costs ${kes(sum("gross_pay") + employer)}.`, link: "/finance" });
    }
  }
  return result(D, "D13", "Payroll adds up and matches its journal", "On every line gross − deductions = net; run totals equal the lines; each approved run has a matching posted journal.", items, "fail", `${runs.length} payroll run${runs.length === 1 ? "" : "s"} checked.`, (k) => `${k} payroll problem${k === 1 ? "" : "s"}.`);
}

export async function runDailyChecks(ranBy: string): Promise<IntegrityRun> {
  const defs: [string, string, string, () => Promise<CheckResult>][] = [
    [A, "A1", "Receipts posted to Finance", checkReceiptsPosted],
    [A, "A2", "Receipt journals tie back", checkReceiptJournalsTieBack],
    [A, "A3", "Journals balance", checkJournalsBalance],
    [A, "A4", "Money received vs ledger", checkCollectionsVsLedger],
    [B, "B5", "Duplicate payment references", checkDuplicateRefs],
    [B, "B6", "Booking balances", checkBookingBalances],
    [B, "B7", "Confirmed & online payments", checkOnlinePayments],
    [B, "B8", "Rooms", checkRooms],
    [B, "B9", "SHPMS link", checkShpmsLink],
    [D, "D12", "Stock", checkStock],
    [D, "D13", "Payroll", checkPayroll],
  ];
  const checks: CheckResult[] = [];
  for (const [g, id, t, fn] of defs) checks.push(await guarded(g, id, t, fn));
  return save({ kind: "daily", period: nairobiToday(), ranAt: Date.now(), ranBy, checks, fails: checks.filter((c) => c.status === "fail").length, warns: checks.filter((c) => c.status === "warn").length });
}

// ======================= Monthly tax check =======================
export function previousMonth(): string {
  const [y, m] = nairobiToday().split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function runTaxCheck(month: string, ranBy: string): Promise<IntegrityRun> {
  const G = "Tax";
  const start = Date.parse(`${month}-01T00:00:00+03:00`);
  const [y, m] = month.split("-").map(Number);
  const end = Date.parse(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+03:00`);
  const taxes = await storage.listTaxes() as Tax[];
  const docs = await sql`SELECT d.id, d.doc_type, d.category, d.source_id, d.recipient_name, d.amount, d.payload_json, d.created_at, d.related_document_id
    FROM documents d WHERE d.created_at >= ${start} AND d.created_at < ${end} AND ${ORIGINAL_DOC("d")} ORDER BY d.id` as any[];
  // The taxable sale is the first invoice for a record (or its first receipt where no invoice is issued, e.g. bar & water).
  const firstSale = new Map<string, any>();
  const earlier = await sql`SELECT DISTINCT category, source_id FROM documents WHERE doc_type IN ('invoice','receipt') AND created_at < ${start}` as any[];
  const before = new Set(earlier.map((e) => `${e.category}:${e.source_id}`));
  for (const d of docs) {
    if (d.doc_type === "credit_note") continue;
    const k = `${d.category}:${d.source_id}`;
    if (before.has(k)) continue;
    const cur = firstSale.get(k);
    if (!cur || (cur.doc_type === "receipt" && d.doc_type === "invoice")) firstSale.set(k, d);
  }
  const arith: CheckItem[] = [], missing: CheckItem[] = [], rates: CheckItem[] = [], credits: CheckItem[] = [], mismatch: CheckItem[] = [];
  const summary = new Map<string, TaxSummaryRow>();
  const row = (tax: string, rate: number, cat: string) => {
    const k = `${tax}|${rate}|${cat}`;
    if (!summary.has(k)) summary.set(k, { taxName: tax, ratePercent: rate, stream: STREAM[cat] ?? cat, gross: 0, base: 0, tax: 0, creditGross: 0, creditTax: 0, netTax: 0, documents: 0 });
    return summary.get(k)!;
  };
  for (const d of Array.from(firstSale.values())) {
    const p = parse(d.payload_json);
    const total = n(p.totalAmount ?? d.amount);
    const tb = p.taxBreakdown;
    const label = `${d.doc_type === "invoice" ? "Invoice" : "Receipt"} #${d.id} · ${STREAM[d.category] ?? d.category} · ${d.recipient_name ?? ""}`;
    const expected = computeInclusiveTaxBreakdown(total, taxes, DOC_CATEGORY_TO_TAX_CATEGORY[d.category]);
    if (!tb) {
      // Issued before tax snapshots were stored on documents: the summary uses today's Settings for it.
      if (expected.lines.length && total > 0) missing.push({ label, detail: `Issued without a stored tax breakdown; counted in the summary at today's rates (${kes(expected.totalTax)} on ${kes(total)}).`, link: "/documents" });
      for (const l of expected.lines) { const r = row(l.name, l.ratePercent, d.category); r.gross += total; r.base += expected.preTaxBase; r.tax += l.amount; r.documents++; }
      continue;
    }
    if (Math.abs(n(tb.preTaxBase) + n(tb.totalTax) - total) > 1) arith.push({ label, detail: `Base ${kes(n(tb.preTaxBase))} + tax ${kes(n(tb.totalTax))} ≠ total ${kes(total)}.`, link: "/documents" });
    for (const l of tb.lines ?? []) {
      if (Math.abs(r2(n(tb.preTaxBase) * n(l.ratePercent) / 100) - n(l.amount)) > 0.05) arith.push({ label, detail: `${l.name} ${l.ratePercent}% should be ${kes(n(tb.preTaxBase) * n(l.ratePercent) / 100)} but shows ${kes(n(l.amount))}.`, link: "/documents" });
      const r = row(l.name, n(l.ratePercent), d.category); r.gross += total; r.base += n(tb.preTaxBase); r.tax += n(l.amount); r.documents++;
    }
    const want = expected.lines.map((l) => `${l.name} ${l.ratePercent}%`).sort().join(", ");
    const got = (tb.lines ?? []).map((l: any) => `${l.name} ${l.ratePercent}%`).sort().join(", ");
    if (want !== got) rates.push({ label, detail: `Charged ${got || "no tax"}; Settings now say ${want || "no tax"}.`, link: "/settings" });
  }
  // Bookings edited after invoicing: tax was declared on the invoice amount, not the current booking total.
  const cmp: [string, string][] = [["accommodation", "accommodation_bookings"], ["facility", "facility_bookings"]];
  for (const [cat, table] of cmp) {
    const ids = Array.from(firstSale.values()).filter((d) => d.category === cat && d.doc_type === "invoice").map((d) => Number(d.source_id));
    if (!ids.length) continue;
    const bs = await sql.unsafe(`SELECT id, total_amount, status FROM ${table} WHERE id = ANY($1::int[])`, [ids]) as any[];
    const latestInv = await sql`SELECT DISTINCT ON (source_id) source_id, payload_json FROM documents d WHERE d.doc_type = 'invoice' AND d.category = ${cat} AND d.source_id IN ${sql(ids)} AND ${ORIGINAL_DOC("d")} ORDER BY source_id, id DESC` as any[];
    const inv = new Map(latestInv.map((x) => [Number(x.source_id), n(parse(x.payload_json).totalAmount)]));
    for (const b of bs) {
      if (b.status === "cancelled") continue;
      const t = inv.get(Number(b.id));
      if (t !== undefined && Math.abs(t - n(b.total_amount)) > 0.5) mismatch.push({ label: `${STREAM[cat]} #${b.id}`, detail: `Booking total ${kes(n(b.total_amount))} but the latest invoice is ${kes(t)} — tax was declared on the invoice.`, link: LINK[cat] });
    }
  }
  for (const d of docs.filter((x) => x.doc_type === "credit_note")) {
    const p = parse(d.payload_json);
    const amt = n(p.totalAmount ?? d.amount);
    const label = `Credit note #${d.id} · ${STREAM[d.category] ?? d.category} · ${d.recipient_name ?? ""}`;
    const rel = d.related_document_id ? (await sql`SELECT id, payload_json, amount FROM documents WHERE id = ${d.related_document_id}` as any[])[0] : null;
    if (!rel) { credits.push({ label, detail: "Not linked to an existing invoice/receipt.", link: "/documents" }); continue; }
    const relTotal = n(parse(rel.payload_json).totalAmount ?? rel.amount);
    if (amt > relTotal + 0.5) credits.push({ label, detail: `Credits ${kes(amt)}, more than the original ${kes(relTotal)}.`, link: "/documents" });
    const bd = computeInclusiveTaxBreakdown(amt, taxes, DOC_CATEGORY_TO_TAX_CATEGORY[d.category]);
    const relTb = parse(rel.payload_json).taxBreakdown;
    const ratio = relTotal > 0 ? amt / relTotal : 0;
    for (const l of relTb?.lines?.length ? relTb.lines : bd.lines) {
      const r = row(l.name, n(l.ratePercent), d.category); r.creditGross += amt; r.creditTax += relTb?.lines?.length ? n(l.amount) * ratio : n(l.amount);
    }
  }
  const taxSummary = Array.from(summary.values()).map((r) => ({ ...r, gross: r2(r.gross), base: r2(r.base), tax: r2(r.tax), creditGross: r2(r.creditGross), creditTax: r2(r.creditTax), netTax: r2(r.tax - r.creditTax) }))
    .sort((a, b) => a.taxName.localeCompare(b.taxName) || a.stream.localeCompare(b.stream));
  const sales = firstSale.size;
  const checks = [
    result(G, "T1", "Tax arithmetic on every sale is correct", "Base + tax = total, and each tax line = base × its rate.", arith, "fail", `${sales} sale document${sales === 1 ? "" : "s"} checked.`, (k) => `${k} calculation error${k === 1 ? "" : "s"}.`),
    result(G, "T2", "Every sale has its tax recorded", "Each invoice/receipt stores the tax it was issued with. Older documents without one are counted at today's rates.", missing, "warn", "Every sale has a stored tax breakdown.", (k) => `${k} older document${k === 1 ? "" : "s"} without a stored breakdown.`),
    result(G, "T3", "Rates charged match Settings", "The taxes on each document are the ones Settings → Taxes applies to that stream today (including tax-free sales on a taxed stream).", rates, "warn", "All documents use the current rates.", (k) => `${k} document${k === 1 ? "" : "s"} at a different rate (fine if rates changed during the month).`),
    result(G, "T4", "Credit notes are valid and reverse their tax", "Each credit note links to an existing invoice/receipt and never exceeds it.", credits, "fail", "All credit notes are valid.", (k) => `${k} credit note problem${k === 1 ? "" : "s"}.`),
    result(G, "T5", "Invoices agree with the bookings they bill", "Booking totals changed after invoicing mean the declared tax may be wrong.", mismatch, "warn", "Every invoice still matches its booking.", (k) => `${k} booking${k === 1 ? "" : "s"} changed after invoicing.`),
  ];
  return save({ kind: "tax", period: month, ranAt: Date.now(), ranBy, checks, taxSummary, fails: checks.filter((c) => c.status === "fail").length, warns: checks.filter((c) => c.status === "warn").length });
}

// ======================= Storage & schedule =======================
async function save(run: IntegrityRun): Promise<IntegrityRun> {
  const [row] = await sql`INSERT INTO integrity_runs (kind, period, ran_at, ran_by, fails, warns, result_json)
    VALUES (${run.kind}, ${run.period}, ${run.ranAt}, ${run.ranBy}, ${run.fails}, ${run.warns}, ${JSON.stringify(run)}) RETURNING id` as any[];
  return { ...run, id: row.id };
}
export async function latestRun(kind: "daily" | "tax", period?: string): Promise<IntegrityRun | null> {
  const rows = period
    ? await sql`SELECT id, result_json FROM integrity_runs WHERE kind = ${kind} AND period = ${period} ORDER BY id DESC LIMIT 1` as any[]
    : await sql`SELECT id, result_json FROM integrity_runs WHERE kind = ${kind} ORDER BY id DESC LIMIT 1` as any[];
  return rows[0] ? { ...JSON.parse(rows[0].result_json), id: rows[0].id } : null;
}
export async function runHistory(kind: "daily" | "tax") {
  return await sql`SELECT id, kind, period, ran_at, ran_by, fails, warns FROM integrity_runs WHERE kind = ${kind} ORDER BY id DESC LIMIT 30` as any[];
}

const SYSTEM = "System (scheduled)";
export function startIntegritySchedule(log: (m: string) => void) {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    runWithEnvironment("live", async () => {
      try {
        const st = await storage.getSettings() as any;
        const time = /^\d{2}:\d{2}$/.test(st.integrityCheckTime || "") ? st.integrityCheckTime : "02:00";
        const hhmm = new Date(Date.now() + TZ).toISOString().slice(11, 16);
        if (hhmm < time) return;
        const today = nairobiToday();
        const done = await sql`SELECT 1 FROM integrity_runs WHERE kind = 'daily' AND period = ${today} AND ran_by = ${SYSTEM} LIMIT 1` as any[];
        if (!done.length) { const r = await runDailyChecks(SYSTEM); log(`integrity daily ${today}: ${r.fails} failed, ${r.warns} warnings`); }
        const day = Math.min(Math.max(Number(st.integrityTaxDay) || 1, 1), 28);
        if (Number(today.slice(8, 10)) >= day) {
          const month = previousMonth();
          const tdone = await sql`SELECT 1 FROM integrity_runs WHERE kind = 'tax' AND period = ${month} AND ran_by = ${SYSTEM} LIMIT 1` as any[];
          if (!tdone.length) { const r = await runTaxCheck(month, SYSTEM); log(`integrity tax ${month}: ${r.fails} failed, ${r.warns} warnings`); }
        }
      } catch (e: any) { log(`integrity checks failed: ${e?.message ?? e}`); }
      finally { busy = false; }
    });
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 10 * 60 * 1000);
}

// ======================= Excel export =======================
export async function integrityWorkbook(run: IntegrityRun, hotelName: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = hotelName;
  const head = (ws: any, cols: { header: string; key: string; width: number; fmt?: string }[]) => {
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : undefined }));
    const r = ws.getRow(1); r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A2118" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  };
  const title = run.kind === "tax" ? `Tax integrity check — ${run.period}` : `Daily integrity checks — ${run.period}`;
  const s = wb.addWorksheet("Summary");
  head(s, [{ header: "Check", key: "id", width: 8 }, { header: "Group", key: "group", width: 22 }, { header: "What it checks", key: "title", width: 52 }, { header: "Result", key: "status", width: 10 }, { header: "Problems", key: "count", width: 10 }, { header: "Summary", key: "summary", width: 70 }]);
  for (const c of run.checks) {
    const row = s.addRow({ ...c, status: c.status === "pass" ? "Pass" : c.status === "warn" ? "Warning" : "Fail" });
    row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.status === "pass" ? "FFDCEFD8" : c.status === "warn" ? "FFFBE7C6" : "FFF6D5D5" } };
  }
  s.addRow({});
  s.addRow({ title: `${title} · run ${new Date(run.ranAt + TZ).toISOString().slice(0, 16).replace("T", " ")} by ${run.ranBy}` });
  s.addRow({ title: `${run.fails} failed · ${run.warns} warnings · ${run.checks.length - run.fails - run.warns} passed` });
  const d = wb.addWorksheet("Problems");
  head(d, [{ header: "Check", key: "id", width: 8 }, { header: "Result", key: "status", width: 10 }, { header: "Record", key: "label", width: 48 }, { header: "Problem", key: "detail", width: 90 }]);
  for (const c of run.checks) for (const it of c.items) d.addRow({ id: c.id, status: c.status === "warn" ? "Warning" : "Fail", label: it.label, detail: it.detail });
  if (run.taxSummary) {
    const t = wb.addWorksheet("Tax summary");
    const money = "#,##0.00";
    head(t, [{ header: "Tax", key: "taxName", width: 22 }, { header: "Rate %", key: "ratePercent", width: 9 }, { header: "Revenue stream", key: "stream", width: 26 }, { header: "Documents", key: "documents", width: 11 },
      { header: "Gross sales (KES, tax-inclusive)", key: "gross", width: 20, fmt: money }, { header: "Pre-tax base (KES)", key: "base", width: 18, fmt: money }, { header: "Tax (KES)", key: "tax", width: 14, fmt: money },
      { header: "Credit notes gross (KES)", key: "creditGross", width: 18, fmt: money }, { header: "Tax reversed (KES)", key: "creditTax", width: 16, fmt: money }, { header: "Net tax due (KES)", key: "netTax", width: 16, fmt: money }]);
    for (const r of run.taxSummary) t.addRow(r);
    const names = Array.from(new Set(run.taxSummary.map((r) => r.taxName)));
    for (const name of names) {
      const rs = run.taxSummary.filter((r) => r.taxName === name);
      const tot = t.addRow({ taxName: `Total ${name}`, documents: rs.reduce((a, r) => a + r.documents, 0), gross: rs.reduce((a, r) => a + r.gross, 0), base: rs.reduce((a, r) => a + r.base, 0), tax: rs.reduce((a, r) => a + r.tax, 0), creditGross: rs.reduce((a, r) => a + r.creditGross, 0), creditTax: rs.reduce((a, r) => a + r.creditTax, 0), netTax: rs.reduce((a, r) => a + r.netTax, 0) });
      tot.font = { bold: true }; tot.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EEE4" } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
