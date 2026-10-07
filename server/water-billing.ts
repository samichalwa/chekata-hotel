// Metered water billing: customers with water meters, tariffs (bands + service charge + minimum),
// monthly readings, monthly bills (balance brought forward), payments with receipts, statements.
// Bills are invoices in the documents table (category "water_bill") so they email as PDFs, show in
// Invoices & Receipts, carry the water tax from Settings, and receipts post via Receipts to Finance.
import type { Express, Request } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { sql, storage } from "./storage";
import { requireModule } from "./auth";
import { issueDocument, issueCreditNote } from "./documents";
import { sendSms } from "./sms";
import { normalizeRef, isRealRef, inFlight, findReferenceUse, duplicateRefMessage } from "./payment-refs";
import { companyDisplayName, drawCompanyHeaderName, LOGO_EXISTS, LOGO_PATH } from "./pdf";
import { calcWaterCharge, consumptionOf, validateTariff, normalizeBands, monthLabel, type WaterBand } from "@shared/water-billing";

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const TZ = 3 * 3600_000;
const today = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400_000).toISOString().slice(0, 10);
const prettyDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const who = (req: Request) => (req as any).user?.fullName ?? (req as any).user?.username ?? "staff";
const fmtM3 = (v: number) => `${Math.round(v * 1000) / 1000} m³`;

function baseUrl(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

// ---------- data access ----------
const tariffRow = (t: any) => ({ id: t.id, name: t.name, bands: normalizeBands(JSON.parse(t.bands_json || "[]")), serviceCharge: n(t.service_charge), minimumCharge: n(t.minimum_charge), active: Number(t.active), notes: t.notes ?? null });
async function getTariff(id: number) { const [t] = await sql`SELECT * FROM water_tariffs WHERE id = ${id}` as any[]; return t ? tariffRow(t) : null; }

async function customerBalances(): Promise<Map<number, { billed: number; paid: number; balance: number }>> {
  const b = await sql`SELECT customer_id, COALESCE(SUM(current_charges),0) AS billed FROM water_bills WHERE status <> 'cancelled' GROUP BY customer_id` as any[];
  const p = await sql`SELECT customer_id, COALESCE(SUM(amount),0) AS paid FROM water_bill_payments GROUP BY customer_id` as any[];
  const out = new Map<number, { billed: number; paid: number; balance: number }>();
  for (const r of b) out.set(Number(r.customer_id), { billed: n(r.billed), paid: 0, balance: n(r.billed) });
  for (const r of p) { const x = out.get(Number(r.customer_id)) ?? { billed: 0, paid: 0, balance: 0 }; x.paid = n(r.paid); x.balance = r2(x.billed - x.paid); out.set(Number(r.customer_id), x); }
  return out;
}
async function balanceOf(customerId: number) { return (await customerBalances()).get(customerId)?.balance ?? 0; }

/** The reading a month starts from: last month's closing reading (or the opening reading). */
async function previousReading(customerId: number, month: string, opening: number) {
  const [r] = await sql`SELECT current_reading FROM water_readings WHERE customer_id = ${customerId} AND period_month < ${month} ORDER BY period_month DESC LIMIT 1` as any[];
  return r ? n(r.current_reading) : opening;
}

function chargeLines(charge: any, bill: any) {
  const items = charge.lines.map((l: any) => ({ label: `Water: ${l.label.charAt(0).toLowerCase()}${l.label.slice(1)}`, detail: `${fmtM3(l.units)} × KES ${l.rate.toLocaleString("en-KE")}`, amount: l.amount }));
  if (!items.length) items.push({ label: "Water consumption", detail: fmtM3(0), amount: 0 });
  items[0].detail = `Meter ${bill.previous_reading} to ${bill.current_reading} (${fmtM3(n(bill.consumption))} used) · ${items[0].detail}`;
  if (charge.serviceCharge > 0) items.push({ label: "Monthly service charge", amount: charge.serviceCharge });
  if (charge.minimumTopUp > 0) items.push({ label: "Minimum charge adjustment", detail: `Minimum monthly bill`, amount: charge.minimumTopUp });
  return items;
}

async function issueBillDocument(bill: any, customer: any) {
  const charge = JSON.parse(bill.charge_json);
  const bf = n(bill.balance_brought_forward);
  return issueDocument(storage, {
    docType: "invoice", category: "water_bill", sourceId: bill.id, customDocNumber: bill.bill_number,
    recipientName: customer.name, recipientEmail: customer.email || null, issueDate: prettyDate(bill.bill_date),
    lineItems: chargeLines(charge, bill), totalAmount: n(bill.current_charges), amountPaid: 0, balance: Math.max(0, n(bill.total_due)), broughtForward: bf,
    notes: [
      `Water bill for ${monthLabel(bill.period_month)} · Account ${customer.account_no}${customer.meter_number ? ` · Meter ${customer.meter_number}` : ""}${customer.location ? ` · ${customer.location}` : ""}.`,
      `Please pay ${kes(Math.max(0, n(bill.total_due)))} by ${prettyDate(bill.due_date)}${Math.abs(bf) > 0.5 ? ` (this month's charges ${bf > 0 ? "plus arrears" : "less credit"} brought forward)` : ""}.`,
    ].filter(Boolean).join(" "),
  });
}

function billSms(settings: any, bill: any, customer: any, pdfUrl: string | null) {
  const pay = settings.mpesaNumber
    ? settings.mpesaPaymentType === "paybill" ? ` Pay via M-Pesa Paybill ${settings.mpesaNumber}, Acc ${settings.mpesaAccountNumber || customer.account_no}.` : settings.mpesaPaymentType === "phone" ? ` Pay via M-Pesa to ${settings.mpesaNumber}.` : ` Pay via M-Pesa Till ${settings.mpesaNumber}.`
    : "";
  const bf = n(bill.balance_brought_forward);
  return `Dear ${customer.name}, your ${settings.hotelName || "The Chekata"} water bill ${bill.bill_number} for ${monthLabel(bill.period_month)}: ${fmtM3(n(bill.consumption))}, ${kes(n(bill.current_charges))}.${Math.abs(bf) > 0.5 ? ` ${bf > 0 ? "Arrears" : "Credit"} ${kes(Math.abs(bf))}.` : ""} Total due ${kes(Math.max(0, n(bill.total_due)))} by ${prettyDate(bill.due_date)}.${pay}${pdfUrl ? ` Bill: ${pdfUrl}` : ""}`;
}

/** Applies payments oldest-bill-first and rewrites each bill's amount_paid/status. */
async function reallocate(customerId: number) {
  const bills = await sql`SELECT id, current_charges FROM water_bills WHERE customer_id = ${customerId} AND status <> 'cancelled' ORDER BY period_month, id` as any[];
  let pool = n((await sql`SELECT COALESCE(SUM(amount),0) AS paid FROM water_bill_payments WHERE customer_id = ${customerId}` as any[])[0].paid);
  for (const b of bills) {
    const due = n(b.current_charges);
    const paid = r2(Math.min(due, Math.max(0, pool)));
    pool = r2(pool - paid);
    const status = paid >= due - 0.01 ? "paid" : paid > 0.01 ? "partially_paid" : "unpaid";
    await sql`UPDATE water_bills SET amount_paid = ${paid}, status = ${status} WHERE id = ${b.id}`;
  }
}

// ---------- statement ----------
async function statement(customerId: number) {
  const [c] = await sql`SELECT * FROM water_customers WHERE id = ${customerId}` as any[];
  if (!c) return null;
  const bills = await sql`SELECT * FROM water_bills WHERE customer_id = ${customerId} AND status <> 'cancelled' ORDER BY bill_date, id` as any[];
  const pays = await sql`SELECT * FROM water_bill_payments WHERE customer_id = ${customerId} ORDER BY paid_at, id` as any[];
  const rows: { date: string; ref: string; description: string; charges: number; payments: number; balance: number }[] = [];
  const events = [
    ...bills.map((b) => ({ t: Number(b.created_at), date: b.bill_date, ref: b.bill_number, description: `Water bill ${monthLabel(b.period_month)} · ${fmtM3(n(b.consumption))}`, charges: n(b.current_charges), payments: 0 })),
    ...pays.map((p) => ({ t: Number(p.paid_at), date: new Date(Number(p.paid_at) + TZ).toISOString().slice(0, 10), ref: p.payment_reference || `PAY-${p.id}`, description: `Payment · ${String(p.payment_method).replace("_", " ")}`, charges: 0, payments: n(p.amount) })),
  ].sort((a, b) => a.t - b.t);
  let bal = 0;
  for (const e of events) { bal = r2(bal + e.charges - e.payments); rows.push({ date: e.date, ref: e.ref, description: e.description, charges: e.charges, payments: e.payments, balance: bal }); }
  return { customer: c, rows, balance: bal, totalBilled: r2(bills.reduce((t, b) => t + n(b.current_charges), 0)), totalPaid: r2(pays.reduce((t, p) => t + n(p.amount), 0)) };
}

async function statementPdf(st: NonNullable<Awaited<ReturnType<typeof statement>>>): Promise<Buffer> {
  const settings = await storage.getSettings();
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const dark = "#2A2118", muted = "#6B6157", brand = "#B5502F";
  if (LOGO_EXISTS) { try { doc.image(LOGO_PATH, 48, 44, { width: 46 }); } catch { /* logo optional */ } }
  drawCompanyHeaderName(doc, companyDisplayName(settings), LOGO_EXISTS ? 104 : 48, 50, LOGO_EXISTS ? 266 : 322, dark);
  doc.font("Helvetica").fontSize(9).fillColor(muted).text([settings.hotelPhone, settings.hotelEmail].filter(Boolean).join(" · "), LOGO_EXISTS ? 104 : 48, 76, { width: 266 });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(brand).text("WATER STATEMENT", 380, 52, { width: 167, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Issued ${prettyDate(today())}`, 380, 72, { width: 167, align: "right" });
  const c = st.customer;
  let y = 116;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(dark).text(c.name, 48, y);
  doc.font("Helvetica").fontSize(9).fillColor(muted).text([`Account ${c.account_no}`, c.meter_number ? `Meter ${c.meter_number}` : "", c.location || "", c.phone || ""].filter(Boolean).join(" · "), 48, y + 16, { width: 499 });
  y += 44;
  const cols = [{ x: 48, w: 62, h: "Date" }, { x: 112, w: 78, h: "Reference" }, { x: 192, w: 170, h: "Description" }, { x: 364, w: 60, h: "Charges", r: true }, { x: 426, w: 60, h: "Payments", r: true }, { x: 488, w: 59, h: "Balance", r: true }];
  const header = () => {
    doc.rect(48, y, 499, 20).fill(dark);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF");
    for (const col of cols) doc.text(col.h, col.x + 3, y + 6, { width: col.w - 6, align: col.r ? "right" : "left" });
    y += 22;
  };
  header();
  doc.font("Helvetica").fontSize(8.5);
  const num = (v: number) => (Math.abs(v) < 0.005 ? "" : Math.round(v).toLocaleString("en-KE"));
  for (const r of st.rows) {
    const h = Math.max(16, doc.heightOfString(r.description, { width: 164 }) + 6);
    if (y + h > 770) { doc.addPage(); y = 48; header(); doc.font("Helvetica").fontSize(8.5); }
    doc.fillColor(dark);
    doc.text(prettyDate(r.date), 51, y + 3, { width: 56 });
    doc.text(r.ref, 115, y + 3, { width: 72 });
    doc.text(r.description, 195, y + 3, { width: 164 });
    doc.text(num(r.charges), 367, y + 3, { width: 54, align: "right" });
    doc.text(num(r.payments), 429, y + 3, { width: 54, align: "right" });
    doc.text(Math.round(r.balance).toLocaleString("en-KE"), 491, y + 3, { width: 53, align: "right" });
    y += h;
    doc.moveTo(48, y).lineTo(547, y).strokeColor("#E4DED4").lineWidth(0.5).stroke();
  }
  if (!st.rows.length) { doc.fillColor(muted).text("No bills or payments yet.", 51, y + 4); y += 20; }
  y += 10;
  if (y > 720) { doc.addPage(); y = 48; }
  doc.font("Helvetica").fontSize(9.5).fillColor(dark);
  doc.text(`Total billed: ${kes(st.totalBilled)}`, 300, y, { width: 247, align: "right" });
  doc.text(`Total paid: ${kes(st.totalPaid)}`, 300, y + 15, { width: 247, align: "right" });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(st.balance > 0.5 ? brand : dark)
    .text(st.balance >= -0.5 ? `Balance due: ${kes(Math.max(0, st.balance))}` : `In credit: ${kes(-st.balance)}`, 300, y + 32, { width: 247, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor(muted).text("All amounts in Kenya Shillings (KES), tax inclusive.", 48, y + 36, { width: 240 });
  doc.end();
  return done;
}

// ---------- Excel ----------
async function excelReport(fromMonth: string, toMonth: string, hotelName: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); wb.creator = hotelName;
  const money = "#,##0.00";
  const head = (ws: any, cols: any[]) => {
    ws.columns = cols;
    const r = ws.getRow(1); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A2118" } };
    ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  };
  const bills = await sql`SELECT b.*, c.account_no, c.name, c.meter_number, c.location, c.phone FROM water_bills b JOIN water_customers c ON c.id = b.customer_id
    WHERE b.period_month BETWEEN ${fromMonth} AND ${toMonth} ORDER BY b.period_month, c.account_no` as any[];
  const ws = wb.addWorksheet("Bills");
  head(ws, [
    { header: "Month", key: "month", width: 10 }, { header: "Bill no.", key: "bill", width: 12 }, { header: "Account", key: "acc", width: 10 }, { header: "Customer", key: "name", width: 26 },
    { header: "Meter", key: "meter", width: 12 }, { header: "Location", key: "loc", width: 18 }, { header: "Tariff", key: "tariff", width: 14 },
    { header: "Previous", key: "prev", width: 10 }, { header: "Current", key: "cur", width: 10 }, { header: "Used (m³)", key: "used", width: 10 },
    { header: "Water (KES)", key: "water", width: 13, style: { numFmt: money } }, { header: "Service (KES)", key: "service", width: 13, style: { numFmt: money } },
    { header: "Min. adj. (KES)", key: "min", width: 13, style: { numFmt: money } }, { header: "Current charges (KES)", key: "charges", width: 16, style: { numFmt: money } },
    { header: "Brought forward (KES)", key: "bf", width: 16, style: { numFmt: money } }, { header: "Total due (KES)", key: "due", width: 14, style: { numFmt: money } },
    { header: "Paid on this bill (KES)", key: "paid", width: 16, style: { numFmt: money } }, { header: "Bill balance (KES)", key: "bal", width: 14, style: { numFmt: money } },
    { header: "Bill date", key: "date", width: 11 }, { header: "Due date", key: "duedate", width: 11 }, { header: "Status", key: "status", width: 13 },
  ]);
  for (const b of bills) {
    const ch = JSON.parse(b.charge_json);
    const cancelled = b.status === "cancelled";
    ws.addRow({ month: b.period_month, bill: b.bill_number, acc: b.account_no, name: b.name, meter: b.meter_number, loc: b.location, tariff: b.tariff_name,
      prev: n(b.previous_reading), cur: n(b.current_reading), used: n(b.consumption), water: n(ch.consumptionAmount), service: n(ch.serviceCharge), min: n(ch.minimumTopUp),
      charges: n(b.current_charges), bf: n(b.balance_brought_forward), due: n(b.total_due), paid: n(b.amount_paid), bal: cancelled ? 0 : r2(n(b.current_charges) - n(b.amount_paid)),
      date: b.bill_date, duedate: b.due_date, status: cancelled ? `cancelled: ${b.cancel_reason ?? ""}` : String(b.status).replace("_", " ") });
  }
  const live = bills.filter((b) => b.status !== "cancelled");
  const tot = ws.addRow({ name: "Total (excluding cancelled)", used: live.reduce((t, b) => t + n(b.consumption), 0), charges: live.reduce((t, b) => t + n(b.current_charges), 0), paid: live.reduce((t, b) => t + n(b.amount_paid), 0), bal: live.reduce((t, b) => t + n(b.current_charges) - n(b.amount_paid), 0) });
  tot.font = { bold: true };

  const fromMs = Date.parse(`${fromMonth}-01T00:00:00+03:00`);
  const [ty, tm] = toMonth.split("-").map(Number);
  const toMs = Date.parse(`${tm === 12 ? ty + 1 : ty}-${String(tm === 12 ? 1 : tm + 1).padStart(2, "0")}-01T00:00:00+03:00`);
  const pays = await sql`SELECT p.*, c.account_no, c.name FROM water_bill_payments p JOIN water_customers c ON c.id = p.customer_id WHERE p.paid_at >= ${fromMs} AND p.paid_at < ${toMs} ORDER BY p.paid_at` as any[];
  const wp = wb.addWorksheet("Payments");
  head(wp, [{ header: "Date", key: "date", width: 12 }, { header: "Account", key: "acc", width: 10 }, { header: "Customer", key: "name", width: 26 }, { header: "Method", key: "method", width: 14 }, { header: "Reference", key: "ref", width: 16 }, { header: "Amount (KES)", key: "amt", width: 14, style: { numFmt: money } }, { header: "Recorded by", key: "by", width: 18 }]);
  for (const p of pays) wp.addRow({ date: new Date(Number(p.paid_at) + TZ).toISOString().slice(0, 10), acc: p.account_no, name: p.name, method: String(p.payment_method).replace("_", " "), ref: p.payment_reference, amt: n(p.amount), by: p.recorded_by });
  wp.addRow({ name: "Total", amt: pays.reduce((t, p) => t + n(p.amount), 0) }).font = { bold: true };

  const customers = await sql`SELECT c.*, t.name AS tariff FROM water_customers c LEFT JOIN water_tariffs t ON t.id = c.tariff_id ORDER BY c.account_no` as any[];
  const bal = await customerBalances();
  const now = today();
  const open = await sql`SELECT customer_id, due_date, current_charges - amount_paid AS owing FROM water_bills WHERE status IN ('unpaid','partially_paid')` as any[];
  const wa = wb.addWorksheet("Arrears");
  head(wa, [{ header: "Account", key: "acc", width: 10 }, { header: "Customer", key: "name", width: 26 }, { header: "Phone", key: "phone", width: 14 }, { header: "Meter", key: "meter", width: 12 }, { header: "Tariff", key: "tariff", width: 14 }, { header: "Status", key: "status", width: 12 },
    { header: "Not yet due (KES)", key: "current", width: 15, style: { numFmt: money } }, { header: "Overdue 1–30 days", key: "d30", width: 15, style: { numFmt: money } }, { header: "Overdue 31–60", key: "d60", width: 14, style: { numFmt: money } }, { header: "Overdue 60+", key: "d90", width: 14, style: { numFmt: money } }, { header: "Total balance (KES)", key: "bal", width: 16, style: { numFmt: money } }]);
  for (const c of customers) {
    const age = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const o of open.filter((x) => Number(x.customer_id) === Number(c.id))) {
      const days = Math.floor((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${o.due_date}T00:00:00Z`)) / 86400_000);
      const k = days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : "d90"; age[k] += n(o.owing);
    }
    wa.addRow({ acc: c.account_no, name: c.name, phone: c.phone, meter: c.meter_number, tariff: c.tariff, status: c.status, ...age, bal: bal.get(Number(c.id))?.balance ?? 0 });
  }
  wa.addRow({ name: "Total", bal: Array.from(bal.values()).reduce((t, b) => t + b.balance, 0) }).font = { bold: true };

  const wc = wb.addWorksheet("Customers");
  head(wc, [{ header: "Account", key: "acc", width: 10 }, { header: "Customer", key: "name", width: 26 }, { header: "Phone", key: "phone", width: 14 }, { header: "Email", key: "email", width: 24 }, { header: "Location / plot", key: "loc", width: 20 }, { header: "Meter no.", key: "meter", width: 12 }, { header: "Tariff", key: "tariff", width: 14 }, { header: "Opening reading", key: "open", width: 14 }, { header: "Connected", key: "conn", width: 12 }, { header: "Status", key: "status", width: 12 }, { header: "Deposit (KES)", key: "dep", width: 13, style: { numFmt: money } }, { header: "Deposit ref.", key: "depref", width: 14 }]);
  for (const c of customers) wc.addRow({ acc: c.account_no, name: c.name, phone: c.phone, email: c.email, loc: c.location, meter: c.meter_number, tariff: c.tariff, open: n(c.opening_reading), conn: c.connection_date, status: c.status, dep: n(c.deposit_amount), depref: c.deposit_reference });

  const tariffs = await sql`SELECT * FROM water_tariffs ORDER BY name` as any[];
  const wt = wb.addWorksheet("Tariffs");
  head(wt, [{ header: "Tariff", key: "name", width: 18 }, { header: "Bands", key: "bands", width: 50 }, { header: "Service charge (KES)", key: "svc", width: 16 }, { header: "Minimum bill (KES)", key: "min", width: 16 }, { header: "Active", key: "active", width: 8 }]);
  for (const t of tariffs) {
    const bands = normalizeBands(JSON.parse(t.bands_json || "[]"));
    let from = 0;
    const text = bands.map((b) => { const s = b.upTo === null ? `above ${from} m³ @ ${b.rate}` : `${from}–${b.upTo} m³ @ ${b.rate}`; from = b.upTo ?? from; return s; }).join("; ");
    wt.addRow({ name: t.name, bands: text, svc: n(t.service_charge), min: n(t.minimum_charge), active: Number(t.active) ? "Yes" : "No" });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- routes ----------
const tariffSchema = z.object({
  name: z.string().trim().min(1), bands: z.array(z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0) })).min(1),
  serviceCharge: z.number().min(0).default(0), minimumCharge: z.number().min(0).default(0), active: z.number().int().min(0).max(1).default(1), notes: z.string().nullable().optional(),
});
const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name"), phone: z.string().trim().nullable().optional(), email: z.string().trim().email("Enter a valid email").or(z.literal("")).nullable().optional(),
  location: z.string().trim().nullable().optional(), meterNumber: z.string().trim().nullable().optional(), tariffId: z.number().int().positive("Choose a tariff"),
  openingReading: z.number().min(0).default(0), connectionDate: z.string().nullable().optional(), status: z.enum(["active", "disconnected"]).default("active"),
  depositAmount: z.number().min(0).default(0), depositReference: z.string().trim().nullable().optional(), depositDate: z.string().nullable().optional(), notes: z.string().nullable().optional(),
});

export function registerWaterBillingRoutes(app: Express) {
  const W = requireModule("water-sales");
  const fail = (res: any, err: any, status = 400) => res.status(err?.issues ? 400 : status).json({ error: err?.issues ? err.issues[0]?.message : err?.message ?? "Failed" });

  // Tariffs
  app.get("/api/water-billing/tariffs", W, async (_req, res) => {
    const rows = await sql`SELECT t.*, (SELECT COUNT(*) FROM water_customers c WHERE c.tariff_id = t.id)::int AS customers FROM water_tariffs t ORDER BY t.active DESC, t.name` as any[];
    res.json(rows.map((t) => ({ ...tariffRow(t), customers: t.customers })));
  });
  app.post("/api/water-billing/tariffs", W, async (req, res) => {
    try {
      const t = tariffSchema.parse(req.body); const err = validateTariff(t); if (err) return res.status(400).json({ error: err });
      const [row] = await sql`INSERT INTO water_tariffs (name, bands_json, service_charge, minimum_charge, active, notes, created_at)
        VALUES (${t.name}, ${JSON.stringify(normalizeBands(t.bands))}, ${t.serviceCharge}, ${t.minimumCharge}, ${t.active}, ${t.notes ?? null}, ${Date.now()}) RETURNING *` as any[];
      res.status(201).json(tariffRow(row));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/water-billing/tariffs/:id", W, async (req, res) => {
    try {
      const t = tariffSchema.parse(req.body); const err = validateTariff(t); if (err) return res.status(400).json({ error: err });
      const [row] = await sql`UPDATE water_tariffs SET name = ${t.name}, bands_json = ${JSON.stringify(normalizeBands(t.bands))}, service_charge = ${t.serviceCharge},
        minimum_charge = ${t.minimumCharge}, active = ${t.active}, notes = ${t.notes ?? null} WHERE id = ${Number(req.params.id)} RETURNING *` as any[];
      if (!row) return res.status(404).json({ error: "Tariff not found" });
      res.json(tariffRow(row));
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/water-billing/tariffs/:id", W, async (req, res) => {
    const id = Number(req.params.id);
    const [u] = await sql`SELECT COUNT(*)::int AS c FROM water_customers WHERE tariff_id = ${id}` as any[];
    if (u.c > 0) return res.status(409).json({ error: `${u.c} customer${u.c === 1 ? " uses" : "s use"} this tariff. Move them to another tariff, or mark it inactive instead.` });
    await sql`DELETE FROM water_tariffs WHERE id = ${id}`;
    res.json({ ok: true });
  });

  // Billing settings (water module users can change these without full Settings access)
  app.get("/api/water-billing/settings", W, async (_req, res) => {
    const s = await storage.getSettings() as any;
    res.json({ waterBillDueDays: Number(s.waterBillDueDays ?? 14), waterBillSms: Number(s.waterBillSms ?? 1), smsEnabled: !!s.smsEnabled });
  });
  app.patch("/api/water-billing/settings", W, async (req, res) => {
    try {
      const b = z.object({ waterBillDueDays: z.number().int().min(0).max(90), waterBillSms: z.number().int().min(0).max(1) }).parse(req.body);
      const s = await storage.updateSettings(b as any) as any;
      res.json({ waterBillDueDays: Number(s.waterBillDueDays), waterBillSms: Number(s.waterBillSms), smsEnabled: !!s.smsEnabled });
    } catch (e) { fail(res, e); }
  });

  // Customers
  app.get("/api/water-billing/customers", W, async (_req, res) => {
    const rows = await sql`SELECT c.*, t.name AS tariff_name,
        (SELECT r.current_reading FROM water_readings r WHERE r.customer_id = c.id ORDER BY r.period_month DESC LIMIT 1) AS last_reading,
        (SELECT r.period_month FROM water_readings r WHERE r.customer_id = c.id ORDER BY r.period_month DESC LIMIT 1) AS last_month
      FROM water_customers c LEFT JOIN water_tariffs t ON t.id = c.tariff_id ORDER BY c.status, c.name` as any[];
    const bal = await customerBalances();
    res.json(rows.map((c) => ({ id: c.id, accountNo: c.account_no, name: c.name, phone: c.phone, email: c.email, location: c.location, meterNumber: c.meter_number,
      tariffId: c.tariff_id, tariffName: c.tariff_name, openingReading: n(c.opening_reading), connectionDate: c.connection_date, status: c.status,
      depositAmount: n(c.deposit_amount), depositReference: c.deposit_reference, depositDate: c.deposit_date, notes: c.notes,
      lastReading: c.last_reading === null ? null : n(c.last_reading), lastMonth: c.last_month, balance: bal.get(Number(c.id))?.balance ?? 0 })));
  });
  app.post("/api/water-billing/customers", W, async (req, res) => {
    try {
      const c = customerSchema.parse(req.body);
      if (!(await getTariff(c.tariffId))) return res.status(400).json({ error: "Choose a valid tariff." });
      if (c.meterNumber) { const [d] = await sql`SELECT account_no FROM water_customers WHERE LOWER(meter_number) = LOWER(${c.meterNumber}) LIMIT 1` as any[]; if (d) return res.status(409).json({ error: `Meter ${c.meterNumber} is already on account ${d.account_no}.` }); }
      const acc = await storage.getNextSequenceNumber("water_customer");
      const [row] = await sql`INSERT INTO water_customers (account_no, name, phone, email, location, meter_number, tariff_id, opening_reading, connection_date, status, deposit_amount, deposit_reference, deposit_date, notes, created_at)
        VALUES (${acc}, ${c.name}, ${c.phone || null}, ${c.email || null}, ${c.location || null}, ${c.meterNumber || null}, ${c.tariffId}, ${c.openingReading}, ${c.connectionDate || null}, ${c.status}, ${c.depositAmount}, ${c.depositReference || null}, ${c.depositDate || null}, ${c.notes || null}, ${Date.now()}) RETURNING *` as any[];
      res.status(201).json(row);
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/water-billing/customers/:id", W, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const c = customerSchema.parse(req.body);
      if (!(await getTariff(c.tariffId))) return res.status(400).json({ error: "Choose a valid tariff." });
      if (c.meterNumber) { const [d] = await sql`SELECT account_no FROM water_customers WHERE LOWER(meter_number) = LOWER(${c.meterNumber}) AND id <> ${id} LIMIT 1` as any[]; if (d) return res.status(409).json({ error: `Meter ${c.meterNumber} is already on account ${d.account_no}.` }); }
      const [cur] = await sql`SELECT opening_reading FROM water_customers WHERE id = ${id}` as any[];
      if (!cur) return res.status(404).json({ error: "Customer not found" });
      const [hasReadings] = await sql`SELECT COUNT(*)::int AS c FROM water_readings WHERE customer_id = ${id}` as any[];
      if (hasReadings.c > 0 && Math.abs(n(cur.opening_reading) - c.openingReading) > 0.0001) return res.status(409).json({ error: "The opening reading can't change once readings have been entered." });
      const [row] = await sql`UPDATE water_customers SET name = ${c.name}, phone = ${c.phone || null}, email = ${c.email || null}, location = ${c.location || null}, meter_number = ${c.meterNumber || null},
        tariff_id = ${c.tariffId}, opening_reading = ${c.openingReading}, connection_date = ${c.connectionDate || null}, status = ${c.status}, deposit_amount = ${c.depositAmount},
        deposit_reference = ${c.depositReference || null}, deposit_date = ${c.depositDate || null}, notes = ${c.notes || null} WHERE id = ${id} RETURNING *` as any[];
      res.json(row);
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/water-billing/customers/:id", W, async (req, res) => {
    const id = Number(req.params.id);
    const [u] = await sql`SELECT (SELECT COUNT(*) FROM water_readings WHERE customer_id = ${id})::int + (SELECT COUNT(*) FROM water_bill_payments WHERE customer_id = ${id})::int AS c` as any[];
    if (u.c > 0) return res.status(409).json({ error: "This customer has readings or payments, so they can't be deleted. Mark them disconnected instead." });
    await sql`DELETE FROM water_customers WHERE id = ${id}`;
    res.json({ ok: true });
  });

  // Statement
  app.get("/api/water-billing/customers/:id/statement", W, async (req, res) => {
    const st = await statement(Number(req.params.id));
    if (!st) return res.status(404).json({ error: "Customer not found" });
    res.json({ rows: st.rows, balance: st.balance, totalBilled: st.totalBilled, totalPaid: st.totalPaid });
  });
  app.get("/api/water-billing/customers/:id/statement/pdf", W, async (req, res) => {
    const st = await statement(Number(req.params.id));
    if (!st) return res.status(404).json({ error: "Customer not found" });
    const pdf = await statementPdf(st);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="water-statement-${st.customer.account_no}.pdf"`);
    res.send(pdf);
  });
  app.get("/api/water-billing/customers/:id/statement/excel", W, async (req, res) => {
    const st = await statement(Number(req.params.id));
    if (!st) return res.status(404).json({ error: "Customer not found" });
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Statement");
    ws.addRow([`Water statement — ${st.customer.name} (${st.customer.account_no})`]).font = { bold: true, size: 13 };
    ws.addRow([[st.customer.meter_number ? `Meter ${st.customer.meter_number}` : "", st.customer.location || "", st.customer.phone || ""].filter(Boolean).join(" · ")]);
    ws.addRow([]);
    const h = ws.addRow(["Date", "Reference", "Description", "Charges (KES)", "Payments (KES)", "Balance (KES)"]); h.font = { bold: true, color: { argb: "FFFFFFFF" } }; h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A2118" } };
    for (const r of st.rows) ws.addRow([r.date, r.ref, r.description, r.charges || null, r.payments || null, r.balance]);
    ws.addRow([]); ws.addRow(["", "", "Total billed", st.totalBilled]); ws.addRow(["", "", "Total paid", null, st.totalPaid]);
    ws.addRow(["", "", st.balance >= 0 ? "Balance due" : "In credit", null, null, Math.abs(st.balance)]).font = { bold: true };
    ws.columns = [{ width: 12 }, { width: 16 }, { width: 40 }, { width: 15, style: { numFmt: "#,##0.00" } }, { width: 15, style: { numFmt: "#,##0.00" } }, { width: 15, style: { numFmt: "#,##0.00" } }];
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="water-statement-${st.customer.account_no}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });

  // Readings for a month: every active customer (plus anyone already read that month)
  app.get("/api/water-billing/readings", W, async (req, res) => {
    const month = String(req.query.month ?? "");
    if (!isMonth(month)) return res.status(400).json({ error: "Choose a month." });
    const customers = await sql`SELECT c.*, t.name AS tariff_name, t.bands_json, t.service_charge, t.minimum_charge FROM water_customers c LEFT JOIN water_tariffs t ON t.id = c.tariff_id
      WHERE c.status = 'active' OR EXISTS (SELECT 1 FROM water_readings r WHERE r.customer_id = c.id AND r.period_month = ${month}) ORDER BY c.location NULLS LAST, c.name` as any[];
    const readings = await sql`SELECT r.*, b.bill_number, b.status AS bill_status FROM water_readings r LEFT JOIN water_bills b ON b.id = r.bill_id WHERE r.period_month = ${month}` as any[];
    const later = await sql`SELECT customer_id, MIN(period_month) AS m FROM water_readings WHERE period_month > ${month} GROUP BY customer_id` as any[];
    const laterBy = new Map(later.map((l) => [Number(l.customer_id), l.m]));
    const out = [];
    for (const c of customers) {
      const r = readings.find((x) => Number(x.customer_id) === Number(c.id));
      const prev = r ? n(r.previous_reading) : await previousReading(Number(c.id), month, n(c.opening_reading));
      out.push({ customerId: c.id, accountNo: c.account_no, name: c.name, location: c.location, meterNumber: c.meter_number, status: c.status,
        tariff: { name: c.tariff_name, bands: normalizeBands(JSON.parse(c.bands_json || "[]")), serviceCharge: n(c.service_charge), minimumCharge: n(c.minimum_charge) },
        previousReading: prev, reading: r ? { id: r.id, currentReading: n(r.current_reading), meterReplaced: !!r.meter_replaced, oldMeterFinal: r.old_meter_final === null ? null : n(r.old_meter_final), newMeterStart: r.new_meter_start === null ? null : n(r.new_meter_start), consumption: n(r.consumption), readingDate: r.reading_date, billId: r.bill_id, billNumber: r.bill_number, billStatus: r.bill_status } : null,
        laterMonth: laterBy.get(Number(c.id)) ?? null });
    }
    res.json(out);
  });
  app.put("/api/water-billing/readings", W, async (req, res) => {
    try {
      const body = z.object({ month: z.string(), readings: z.array(z.object({
        customerId: z.number().int(), currentReading: z.number().min(0), readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        meterReplaced: z.boolean().optional(), oldMeterFinal: z.number().min(0).nullable().optional(), newMeterStart: z.number().min(0).nullable().optional(),
      })) }).parse(req.body);
      if (!isMonth(body.month)) return res.status(400).json({ error: "Choose a month." });
      const errors: { customerId: number; error: string }[] = []; let saved = 0;
      for (const r of body.readings) {
        const [c] = await sql`SELECT * FROM water_customers WHERE id = ${r.customerId}` as any[];
        if (!c) { errors.push({ customerId: r.customerId, error: "Customer not found" }); continue; }
        const [existing] = await sql`SELECT id, bill_id FROM water_readings WHERE customer_id = ${c.id} AND period_month = ${body.month}` as any[];
        if (existing?.bill_id) { const [b] = await sql`SELECT status FROM water_bills WHERE id = ${existing.bill_id}` as any[]; if (b && b.status !== "cancelled") { errors.push({ customerId: c.id, error: `${c.name}: already billed for this month — cancel the bill to correct the reading.` }); continue; } }
        const [later] = await sql`SELECT period_month FROM water_readings WHERE customer_id = ${c.id} AND period_month > ${body.month} LIMIT 1` as any[];
        if (later) { errors.push({ customerId: c.id, error: `${c.name}: a reading for ${monthLabel(later.period_month)} already exists — readings must be entered in order.` }); continue; }
        const prev = await previousReading(Number(c.id), body.month, n(c.opening_reading));
        const replaced = r.meterReplaced ? { oldFinal: n(r.oldMeterFinal), newStart: n(r.newMeterStart) } : null;
        if (replaced) {
          if (replaced.oldFinal < prev) { errors.push({ customerId: c.id, error: `${c.name}: the old meter's final reading can't be below the previous reading (${prev}).` }); continue; }
          if (r.currentReading < replaced.newStart) { errors.push({ customerId: c.id, error: `${c.name}: the new meter's reading can't be below its start reading.` }); continue; }
        } else if (r.currentReading < prev) { errors.push({ customerId: c.id, error: `${c.name}: ${r.currentReading} is lower than last month's ${prev}. If the meter was replaced or reset, tick "Meter replaced".` }); continue; }
        const used = consumptionOf(prev, r.currentReading, replaced);
        if (existing) {
          await sql`UPDATE water_readings SET previous_reading = ${prev}, current_reading = ${r.currentReading}, meter_replaced = ${replaced ? 1 : 0}, old_meter_final = ${replaced?.oldFinal ?? null},
            new_meter_start = ${replaced?.newStart ?? null}, consumption = ${used}, reading_date = ${r.readingDate}, bill_id = NULL, recorded_by = ${who(req)} WHERE id = ${existing.id}`;
        } else {
          await sql`INSERT INTO water_readings (customer_id, period_month, previous_reading, current_reading, meter_replaced, old_meter_final, new_meter_start, consumption, reading_date, recorded_by, created_at)
            VALUES (${c.id}, ${body.month}, ${prev}, ${r.currentReading}, ${replaced ? 1 : 0}, ${replaced?.oldFinal ?? null}, ${replaced?.newStart ?? null}, ${used}, ${r.readingDate}, ${who(req)}, ${Date.now()})`;
        }
        saved++;
      }
      res.json({ saved, errors });
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/water-billing/readings/:id", W, async (req, res) => {
    const [r] = await sql`SELECT r.*, b.status FROM water_readings r LEFT JOIN water_bills b ON b.id = r.bill_id WHERE r.id = ${Number(req.params.id)}` as any[];
    if (!r) return res.status(404).json({ error: "Reading not found" });
    if (r.bill_id && r.status !== "cancelled") return res.status(409).json({ error: "This reading has been billed. Cancel the bill first." });
    const [later] = await sql`SELECT 1 FROM water_readings WHERE customer_id = ${r.customer_id} AND period_month > ${r.period_month} LIMIT 1` as any[];
    if (later) return res.status(409).json({ error: "A later month's reading exists, so this one can't be removed." });
    await sql`DELETE FROM water_readings WHERE id = ${r.id}`;
    res.json({ ok: true });
  });

  // Bills
  app.get("/api/water-billing/bills", W, async (req, res) => {
    const month = isMonth(req.query.month) ? String(req.query.month) : null;
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const rows = await sql`SELECT b.*, c.name, c.account_no, c.phone, c.email, c.meter_number, c.location,
        (SELECT d.id FROM documents d WHERE d.category = 'water_bill' AND d.source_id = b.id AND d.doc_type = 'invoice' ORDER BY d.id DESC LIMIT 1) AS doc_id,
        (SELECT d.public_token FROM documents d WHERE d.category = 'water_bill' AND d.source_id = b.id AND d.doc_type = 'invoice' ORDER BY d.id DESC LIMIT 1) AS doc_token,
        (SELECT d.status FROM documents d WHERE d.category = 'water_bill' AND d.source_id = b.id AND d.doc_type = 'invoice' ORDER BY d.id DESC LIMIT 1) AS email_status
      FROM water_bills b JOIN water_customers c ON c.id = b.customer_id
      WHERE (${month}::text IS NULL OR b.period_month = ${month}) AND (${customerId}::int IS NULL OR b.customer_id = ${customerId})
      ORDER BY b.period_month DESC, c.name` as any[];
    const bal = await customerBalances();
    res.json(rows.map((b) => ({ id: b.id, billNumber: b.bill_number, customerId: b.customer_id, customerName: b.name, accountNo: b.account_no, phone: b.phone, email: b.email,
      meterNumber: b.meter_number, location: b.location, periodMonth: b.period_month, previousReading: n(b.previous_reading), currentReading: n(b.current_reading), consumption: n(b.consumption),
      tariffName: b.tariff_name, charge: JSON.parse(b.charge_json), currentCharges: n(b.current_charges), balanceBroughtForward: n(b.balance_brought_forward), totalDue: n(b.total_due),
      amountPaid: n(b.amount_paid), billDate: b.bill_date, dueDate: b.due_date, status: b.status, cancelReason: b.cancel_reason, smsStatus: b.sms_status, emailStatus: b.email_status,
      documentId: b.doc_id, documentToken: b.doc_token, customerBalance: bal.get(Number(b.customer_id))?.balance ?? 0 })));
  });
  app.post("/api/water-billing/bills/raise", W, async (req, res) => {
    const key = "water-raise";
    if (inFlight.has(key)) return res.status(409).json({ error: "Bills are already being raised. Wait a moment." });
    inFlight.add(key);
    try {
      const body = z.object({ month: z.string(), billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), customerIds: z.array(z.number().int()).optional() }).parse(req.body);
      if (!isMonth(body.month)) return res.status(400).json({ error: "Choose a month." });
      const settings = await storage.getSettings() as any;
      const billDate = body.billDate || today();
      const dueDate = addDays(billDate, Number(settings.waterBillDueDays ?? 14));
      const pending = await sql`SELECT r.*, c.tariff_id FROM water_readings r JOIN water_customers c ON c.id = r.customer_id
        WHERE r.period_month = ${body.month} AND (r.bill_id IS NULL OR EXISTS (SELECT 1 FROM water_bills b WHERE b.id = r.bill_id AND b.status = 'cancelled'))` as any[];
      const results: any[] = [];
      for (const r of pending.filter((p) => !body.customerIds || body.customerIds.includes(Number(p.customer_id)))) {
        const [c] = await sql`SELECT * FROM water_customers WHERE id = ${r.customer_id}` as any[];
        const tariff = await getTariff(Number(c.tariff_id));
        if (!tariff) { results.push({ customer: c.name, error: "No tariff" }); continue; }
        const charge = calcWaterCharge(n(r.consumption), tariff);
        const bf = await balanceOf(Number(c.id));
        const number = await storage.getNextSequenceNumber("water_bill");
        const [bill] = await sql`INSERT INTO water_bills (bill_number, customer_id, period_month, reading_id, previous_reading, current_reading, consumption, tariff_name, charge_json, current_charges, balance_brought_forward, total_due, bill_date, due_date, status, created_by, created_at)
          VALUES (${number}, ${c.id}, ${body.month}, ${r.id}, ${n(r.previous_reading)}, ${n(r.current_reading)}, ${n(r.consumption)}, ${tariff.name}, ${JSON.stringify(charge)}, ${charge.total}, ${bf}, ${r2(charge.total + bf)}, ${billDate}, ${dueDate}, 'unpaid', ${who(req)}, ${Date.now()}) RETURNING *` as any[];
        await sql`UPDATE water_readings SET bill_id = ${bill.id} WHERE id = ${r.id}`;
        await reallocate(Number(c.id)); // a credit on the account pays the new bill straight away
        let doc: any = null;
        try { doc = await issueBillDocument(bill, c); } catch (e: any) { doc = { status: "failed", errorMessage: e?.message }; }
        const pdfUrl = doc?.id && doc?.publicToken ? `${baseUrl(req)}/api/public/documents/${doc.id}/pdf?token=${doc.publicToken}` : null;
        let sms = "skipped";
        if (settings.waterBillSms !== 0 && c.phone) {
          const s = await sendSms({ settings, to: c.phone, message: billSms(settings, bill, c, pdfUrl) }).catch((e: any) => ({ ok: false, error: e?.message }));
          sms = s.ok ? "sent" : `failed: ${(s as any).error ?? ""}`;
        }
        await sql`UPDATE water_bills SET sms_status = ${sms} WHERE id = ${bill.id}`;
        results.push({ billNumber: number, customer: c.name, amount: charge.total, totalDue: r2(charge.total + bf), email: doc?.status ?? "failed", sms });
      }
      res.json({ raised: results.filter((x) => x.billNumber).length, results, dueDate });
    } catch (e) { fail(res, e); }
    finally { inFlight.delete(key); }
  });
  app.post("/api/water-billing/bills/:id/resend", W, async (req, res) => {
    try {
      const [bill] = await sql`SELECT * FROM water_bills WHERE id = ${Number(req.params.id)}` as any[];
      if (!bill || bill.status === "cancelled") return res.status(404).json({ error: "Bill not found" });
      const [c] = await sql`SELECT * FROM water_customers WHERE id = ${bill.customer_id}` as any[];
      const [orig] = await sql`SELECT id FROM documents WHERE category = 'water_bill' AND source_id = ${bill.id} AND doc_type = 'invoice' ORDER BY id LIMIT 1` as any[];
      const doc = orig ? await (async () => { const d = await storage.getDocument(orig.id); const p = JSON.parse(d!.payloadJson); return issueDocument(storage, { ...p, resendOf: orig.id, recipientEmail: c.email || p.recipientEmail }); })() : await issueBillDocument(bill, c);
      let sms = "skipped";
      const settings = await storage.getSettings() as any;
      if (req.body?.sms && c.phone) {
        const pdfUrl = doc?.id && doc?.publicToken ? `${baseUrl(req)}/api/public/documents/${doc.id}/pdf?token=${doc.publicToken}` : null;
        const s = await sendSms({ settings, to: c.phone, message: billSms(settings, bill, c, pdfUrl) }).catch((e: any) => ({ ok: false, error: e?.message }));
        sms = s.ok ? "sent" : `failed: ${(s as any).error ?? ""}`;
        await sql`UPDATE water_bills SET sms_status = ${sms} WHERE id = ${bill.id}`;
      }
      res.json({ email: doc.status, errorMessage: doc.errorMessage, sms });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/water-billing/bills/:id/cancel", W, async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "Give a reason for cancelling." });
      const [bill] = await sql`SELECT * FROM water_bills WHERE id = ${Number(req.params.id)}` as any[];
      if (!bill) return res.status(404).json({ error: "Bill not found" });
      if (bill.status === "cancelled") return res.status(409).json({ error: "Already cancelled." });
      const [later] = await sql`SELECT bill_number FROM water_bills WHERE customer_id = ${bill.customer_id} AND status <> 'cancelled' AND (period_month > ${bill.period_month} OR (period_month = ${bill.period_month} AND id > ${bill.id})) LIMIT 1` as any[];
      if (later) return res.status(409).json({ error: `Bill ${later.bill_number} was raised after this one. Cancel the later bill first.` });
      const [c] = await sql`SELECT * FROM water_customers WHERE id = ${bill.customer_id}` as any[];
      await sql`UPDATE water_bills SET status = 'cancelled', cancel_reason = ${reason}, amount_paid = 0 WHERE id = ${bill.id}`;
      await reallocate(Number(bill.customer_id)); // any payment on it stays on the account as credit
      if (n(bill.current_charges) > 0) {
        await issueCreditNote(storage, { category: "water_bill", sourceId: bill.id, requestedAmount: n(bill.current_charges), reason, recipientName: c.name, recipientEmail: c.email || null,
          currentCreditedAmount: 0, totalAmount: n(bill.current_charges), amountPaid: 0, lineItemLabel: `Water bill ${bill.bill_number} cancelled` }).catch(() => null);
      }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // Payments — on the customer's account, applied oldest bill first.
  app.post("/api/water-billing/customers/:id/record-payment", W, async (req, res) => {
    let lock: string | null = null;
    try {
      const id = Number(req.params.id);
      const [c] = await sql`SELECT * FROM water_customers WHERE id = ${id}` as any[];
      if (!c) return res.status(404).json({ error: "Customer not found" });
      const due = await balanceOf(id);
      const amount = r2(Number(req.body?.amount));
      const method = String(req.body?.paymentMethod ?? "").trim();
      const reference = String(req.body?.paymentReference ?? "").trim().toUpperCase() || null;
      if (!(due > 0.004)) return res.status(409).json({ error: "This account has nothing to pay." });
      if (!(amount > 0)) return res.status(400).json({ error: "Enter the amount received." });
      if (amount > due + 0.5) return res.status(400).json({ error: `That is more than the balance of ${kes(due)}.` });
      if (!["cash", "mpesa", "card", "bank_transfer"].includes(method)) return res.status(400).json({ error: "Choose how the customer paid." });
      if (method === "mpesa" && !reference) return res.status(400).json({ error: "Enter the M-Pesa code." });
      if (reference) {
        const k = normalizeRef(reference);
        if (isRealRef(k)) {
          if (inFlight.has(k)) return res.status(409).json({ error: duplicateRefMessage(reference, "another payment being saved right now") });
          const used = await findReferenceUse(reference);
          if (used) return res.status(409).json({ error: duplicateRefMessage(reference, used) });
          lock = k; inFlight.add(k);
        }
      }
      const open = await sql`SELECT id, bill_number, current_charges - amount_paid AS owing FROM water_bills WHERE customer_id = ${id} AND status IN ('unpaid','partially_paid') ORDER BY period_month, id` as any[];
      let left = amount; const alloc: { billId: number; billNumber: string; amount: number }[] = [];
      for (const b of open) { if (left <= 0.004) break; const a = r2(Math.min(left, n(b.owing))); if (a > 0) { alloc.push({ billId: b.id, billNumber: b.bill_number, amount: a }); left = r2(left - a); } }
      const firstBill = alloc[0]?.billId ?? open[0]?.id ?? null;
      const [p] = await sql`INSERT INTO water_bill_payments (customer_id, bill_id, amount, payment_method, payment_reference, allocation_json, paid_at, recorded_by)
        VALUES (${id}, ${firstBill}, ${amount}, ${method}, ${reference}, ${JSON.stringify(alloc)}, ${Date.now()}, ${who(req)}) RETURNING *` as any[];
      await reallocate(id);
      const balance = r2(due - amount);
      const doc = firstBill ? await issueDocument(storage, {
        docType: "receipt", category: "water_bill", sourceId: firstBill, customDocNumber: `${c.account_no}-P${p.id}`,
        recipientName: c.name, recipientEmail: c.email || null, issueDate: prettyDate(today()),
        lineItems: alloc.length ? alloc.map((a) => ({ label: `Payment towards water bill ${a.billNumber}`, amount: a.amount })) : [{ label: "Water account payment", amount }],
        totalAmount: due, amountPaid: amount, balance, paymentAmount: amount, paymentMethod: method, paymentReference: reference,
        notes: `Account ${c.account_no}${c.meter_number ? ` · Meter ${c.meter_number}` : ""}. ${balance > 0.5 ? `Remaining balance: ${kes(balance)}.` : "Account fully paid."}`,
      }).catch(() => null) : null;
      if (c.phone) {
        const settings = await storage.getSettings();
        void sendSms({ settings, to: c.phone, message: `Hi ${c.name}, payment received for your water account ${c.account_no}: ${kes(amount)}${reference ? ` (${reference})` : ""}. ${balance > 0.5 ? `Balance: ${kes(balance)}.` : "Paid in full."} Thank you.` }).catch(() => null);
      }
      res.status(201).json({ ok: true, amount, balance, allocation: alloc, _document: doc ? { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken } : null });
    } catch (e) { fail(res, e); }
    finally { if (lock) inFlight.delete(lock); }
  });
  app.get("/api/water-billing/customers/:id/payments", W, async (req, res) => {
    res.json(await sql`SELECT * FROM water_bill_payments WHERE customer_id = ${Number(req.params.id)} ORDER BY paid_at DESC` as any[]);
  });

  // Summary + Excel report
  app.get("/api/water-billing/summary", W, async (req, res) => {
    const month = isMonth(req.query.month) ? String(req.query.month) : today().slice(0, 7);
    const [cust] = await sql`SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*)::int AS total FROM water_customers` as any[];
    const [rd] = await sql`SELECT COUNT(*)::int AS read, COUNT(*) FILTER (WHERE bill_id IS NOT NULL AND EXISTS (SELECT 1 FROM water_bills b WHERE b.id = bill_id AND b.status <> 'cancelled'))::int AS billed, COALESCE(SUM(consumption),0) AS m3 FROM water_readings WHERE period_month = ${month}` as any[];
    const [bl] = await sql`SELECT COALESCE(SUM(current_charges),0) AS billed, COALESCE(SUM(amount_paid),0) AS paid FROM water_bills WHERE period_month = ${month} AND status <> 'cancelled'` as any[];
    const bal = await customerBalances();
    const [overdue] = await sql`SELECT COALESCE(SUM(current_charges - amount_paid),0) AS amt, COUNT(DISTINCT customer_id)::int AS customers FROM water_bills WHERE status IN ('unpaid','partially_paid') AND due_date < ${today()}` as any[];
    res.json({ month, activeCustomers: cust.active, customers: cust.total, readings: rd.read, billed: rd.billed, consumption: n(rd.m3), billedAmount: n(bl.billed), paidOnMonth: n(bl.paid),
      outstanding: r2(Array.from(bal.values()).reduce((t, b) => t + Math.max(0, b.balance), 0)), overdue: n(overdue.amt), overdueCustomers: overdue.customers });
  });
  app.get("/api/water-billing/report/excel", W, async (req, res) => {
    const from = isMonth(req.query.from) ? String(req.query.from) : today().slice(0, 7);
    const to = isMonth(req.query.to) ? String(req.query.to) : from;
    const settings = await storage.getSettings();
    const buf = await excelReport(from <= to ? from : to, from <= to ? to : from, settings.hotelName || "The Chekata");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="water-billing-${from}-to-${to}.xlsx"`);
    res.send(buf);
  });
}

export type { WaterBand };
