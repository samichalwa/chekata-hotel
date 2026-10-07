// Meter Readings — a standalone module for meter readers. Readers record water meters (metered water
// customers) and electricity meters (tenant leases with an electricity rate), by typing or photo, and see
// units only — never charges or balances. Saved readings bill automatically once the review window in
// Settings (default 24 h) has passed, so staff can correct a wrong reading first:
//   • water → a metered water bill (same as Water Sales → Raise bills)
//   • electricity → a separate tenant electricity invoice (rent_invoices.invoice_kind = 'electricity'),
//     posted Dr tenant receivable / Cr electricity income, PDF emailed, optional SMS.
import type { Express, Request } from "express";
import { z } from "zod";
import { sql, storage } from "./storage";
import { requireModule, requireAnyModule } from "./auth";
import { issueDocument } from "./documents";
import { sendSms } from "./sms";
import { inFlight } from "./payment-refs";
import { runWithEnvironment } from "./db-context";
import { waterReadingRows, saveWaterReadings, scanMeterPhoto, takeScan, raiseWaterBills, UserError } from "./water-billing";
import { UploadValidationError } from "./uploads";
import { monthLabel } from "@shared/water-billing";

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const TZ = 3 * 3600_000;
const today = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400_000).toISOString().slice(0, 10);
const prettyDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const who = (req: Request) => (req as any).user?.fullName ?? (req as any).user?.username ?? "staff";
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const AUTO = "system (auto-billing)";

function baseUrl(req?: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (req) { const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "https"; return `${proto}://${req.get("host")}`; }
  return "https://hms.thechekata.com";
}
const fail = (res: any, err: any) => res.status(err?.issues ? 400 : err?.status ?? 400).json({ error: err?.issues ? err.issues[0]?.message : err?.message ?? "Failed" });

async function billingSettings() {
  const s = await storage.getSettings() as any;
  return {
    delayHours: Math.max(0, Number(s.meterBillDelayHours ?? 24)),
    autoFrom: s.meterAutoBillingFrom ? Number(s.meterAutoBillingFrom) : null,
    electricityDueDays: Number(s.electricityDueDays ?? 14),
    electricityIncomeAccountId: s.electricityIncomeAccountId ?? null,
    electricitySms: Number(s.electricitySms ?? 1),
    visionReady: !!(s.meterVisionProvider && s.meterVisionApiKey),
    raw: s,
  };
}
/** When a reading saved at `savedAt` bills automatically, or null if it never will (saved before auto-billing began). */
const autoBillAt = (savedAt: number, cfg: { delayHours: number; autoFrom: number | null }) =>
  cfg.autoFrom && savedAt >= cfg.autoFrom ? savedAt + cfg.delayHours * 3600_000 : null;

// ---------------- Electricity readings ----------------
export async function electricityRows(month: string) {
  const cfg = await billingSettings();
  const leases = await sql`SELECT l.*, t.name AS tenant_name, s.shop_number FROM tenancy_leases l JOIN tenants t ON t.id = l.tenant_id LEFT JOIN shops s ON s.id = l.shop_id
    WHERE (l.status = 'active' AND l.electricity_rate_per_unit > 0) OR EXISTS (SELECT 1 FROM meter_readings m WHERE m.lease_id = l.id AND m.period_month = ${month})
    ORDER BY s.shop_number NULLS LAST, t.name` as any[];
  const readings = await sql`SELECT m.*, i.invoice_number, i.status AS invoice_status FROM meter_readings m LEFT JOIN rent_invoices i ON i.id = m.invoice_id WHERE m.period_month = ${month}` as any[];
  const out = [];
  for (const l of leases) {
    const r = readings.find((x) => Number(x.lease_id) === Number(l.id));
    const [prev] = await sql`SELECT end_reading FROM meter_readings WHERE lease_id = ${l.id} AND period_month < ${month} ORDER BY period_month DESC LIMIT 1` as any[];
    const [later] = await sql`SELECT MIN(period_month) AS m FROM meter_readings WHERE lease_id = ${l.id} AND period_month > ${month}` as any[];
    const savedAt = r ? Number(r.updated_at ?? r.created_at) : 0;
    const invoiced = !!(r && r.invoice_id && Number(r.invoice_id) > 0 && r.invoice_status !== "cancelled");
    out.push({
      leaseId: Number(l.id), name: l.tenant_name, ref: `Shop ${l.shop_number ?? l.id}`, meterNumber: l.meter_number ?? null, active: l.status === "active",
      previousReading: r ? n(r.start_reading) : prev ? n(prev.end_reading) : null, needsStart: !r && !prev,
      laterMonth: later?.m ?? null,
      reading: r ? {
        id: Number(r.id), currentReading: n(r.end_reading), startReading: n(r.start_reading), consumption: n(r.consumption), readingDate: r.reading_date, recordedBy: r.recorded_by,
        savedAt, autoBillAt: invoiced || (r.invoice_id !== null && Number(r.invoice_id) === 0) ? null : autoBillAt(savedAt, cfg),
        invoiced, invoiceNumber: r.invoice_number ?? null, invoiceStatus: r.invoice_status ?? null, nothingToBill: r.invoice_id !== null && Number(r.invoice_id) === 0,
        photoUrl: r.photo_url ?? null, photoReading: r.photo_reading === null ? null : n(r.photo_reading), photoMeterVerified: r.photo_meter_verified === null ? null : Number(r.photo_meter_verified),
      } : null,
    });
  }
  return out;
}

const elecInput = z.object({ month: z.string(), readings: z.array(z.object({
  leaseId: z.number().int(), currentReading: z.number().min(0), startReading: z.number().min(0).nullable().optional(),
  readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), photoToken: z.string().nullable().optional(),
})) });

export async function saveElectricityReadings(input: unknown, by: string) {
  const body = elecInput.parse(input);
  if (!isMonth(body.month)) throw new UserError("Choose a month.");
  const errors: { leaseId: number; error: string }[] = []; let saved = 0;
  for (const r of body.readings) {
    const [l] = await sql`SELECT l.*, t.name AS tenant_name, s.shop_number FROM tenancy_leases l JOIN tenants t ON t.id = l.tenant_id LEFT JOIN shops s ON s.id = l.shop_id WHERE l.id = ${r.leaseId}` as any[];
    if (!l) { errors.push({ leaseId: r.leaseId, error: "Lease not found" }); continue; }
    const label = `${l.tenant_name} (Shop ${l.shop_number ?? l.id})`;
    if (!(n(l.electricity_rate_per_unit) > 0)) { errors.push({ leaseId: l.id, error: `${label}: the lease has no electricity rate, so there is nothing to bill.` }); continue; }
    const [existing] = await sql`SELECT m.*, i.status AS invoice_status, i.invoice_number FROM meter_readings m LEFT JOIN rent_invoices i ON i.id = m.invoice_id WHERE m.lease_id = ${l.id} AND m.period_month = ${body.month}` as any[];
    if (existing && existing.invoice_id && Number(existing.invoice_id) > 0 && existing.invoice_status !== "cancelled") {
      errors.push({ leaseId: l.id, error: `${label}: already invoiced (${existing.invoice_number}) — ask Tenants staff to cancel the invoice to correct it.` }); continue;
    }
    const [later] = await sql`SELECT period_month FROM meter_readings WHERE lease_id = ${l.id} AND period_month > ${body.month} LIMIT 1` as any[];
    if (later) { errors.push({ leaseId: l.id, error: `${label}: a reading for ${monthLabel(later.period_month)} already exists — readings must be entered in order.` }); continue; }
    const [prev] = await sql`SELECT end_reading FROM meter_readings WHERE lease_id = ${l.id} AND period_month < ${body.month} ORDER BY period_month DESC LIMIT 1` as any[];
    const start = prev ? n(prev.end_reading) : r.startReading ?? (existing ? n(existing.start_reading) : null);
    if (start === null) { errors.push({ leaseId: l.id, error: `${label}: this is the first reading for this meter — enter the start reading too.` }); continue; }
    if (r.currentReading < start) { errors.push({ leaseId: l.id, error: `${label}: ${r.currentReading} is lower than the previous reading (${start}). Check the meter; if it was replaced, ask Tenants staff.` }); continue; }
    let photo: any = null;
    if (r.photoToken) {
      photo = takeScan(r.photoToken, "electricity", Number(l.id));
      if (!photo) { errors.push({ leaseId: l.id, error: `${label}: the meter photo has expired or belongs to another meter — scan it again or save without it.` }); continue; }
    }
    const used = r3(r.currentReading - start);
    const amount = r2(used * n(l.electricity_rate_per_unit));
    const now = Date.now();
    if (existing) {
      await sql`UPDATE meter_readings SET start_reading = ${start}, end_reading = ${r.currentReading}, consumption = ${used}, amount = ${amount}, reading_date = ${r.readingDate},
        recorded_by = ${by}, updated_at = ${now}, invoice_id = NULL WHERE id = ${existing.id}`;
      if (photo) await sql`UPDATE meter_readings SET photo_url = ${photo.photoUrl}, photo_meter_number = ${photo.meterNumber}, photo_reading = ${photo.reading}, photo_meter_verified = ${photo.verified ? 1 : 0}, photo_confidence = ${photo.confidence} WHERE id = ${existing.id}`;
    } else {
      await sql`INSERT INTO meter_readings (lease_id, period_month, start_reading, end_reading, consumption, amount, reading_date, recorded_by, created_at, updated_at,
          photo_url, photo_meter_number, photo_reading, photo_meter_verified, photo_confidence)
        VALUES (${l.id}, ${body.month}, ${start}, ${r.currentReading}, ${used}, ${amount}, ${r.readingDate}, ${by}, ${now}, ${now},
          ${photo?.photoUrl ?? null}, ${photo?.meterNumber ?? null}, ${photo?.reading ?? null}, ${photo ? (photo.verified ? 1 : 0) : null}, ${photo?.confidence ?? null})`;
    }
    saved++;
  }
  return { saved, errors };
}

/** Raises the separate electricity invoice for one saved reading. Idempotent: a reading already invoiced is skipped. */
export async function createElectricityInvoice(readingId: number, by: string, base: string) {
  const [m] = await sql`SELECT m.*, i.status AS invoice_status FROM meter_readings m LEFT JOIN rent_invoices i ON i.id = m.invoice_id WHERE m.id = ${readingId}` as any[];
  if (!m) throw new UserError("Reading not found");
  if (m.invoice_id !== null && (Number(m.invoice_id) === 0 || m.invoice_status !== "cancelled")) return { skipped: true as const };
  const lease = await storage.getTenancyLease(Number(m.lease_id));
  if (!lease) throw new UserError("Lease not found");
  // Before this feature, electricity was added onto the month's rent invoice — never bill that reading twice.
  const [onRent] = await sql`SELECT id FROM rent_invoices WHERE lease_id = ${m.lease_id} AND period_month = ${m.period_month} AND invoice_kind = 'rent' AND status <> 'cancelled' AND electricity_amount > 0 LIMIT 1` as any[];
  if (onRent) { await sql`UPDATE meter_readings SET invoice_id = ${onRent.id} WHERE id = ${m.id}`; return { skipped: true as const }; }
  const tenant = await storage.getTenant(lease.tenantId);
  const shop = await storage.getShop(lease.shopId);
  const cfg = await billingSettings();
  const rate = n(lease.electricityRatePerUnit);
  const units = n(m.consumption);
  const amount = r2(units * rate);
  if (amount <= 0) { await sql`UPDATE meter_readings SET invoice_id = 0, amount = 0 WHERE id = ${m.id}`; return { skipped: true as const, nothingToBill: true }; }
  if (!lease.receivableAccountId) throw new UserError(`Shop ${shop?.shopNumber ?? lease.shopId}: the lease has no receivable account set — set it on the lease first.`);
  const incomeAccountId = cfg.electricityIncomeAccountId || lease.incomeAccountId;
  if (!incomeAccountId) throw new UserError(`Shop ${shop?.shopNumber ?? lease.shopId}: no electricity income account — set one in Meter Readings → Settings.`);
  const issueIso = today();
  // Check the accounting period first so a closed month never leaves a half-made invoice.
  const period = await (storage as any).findOpenPeriodForDate(issueIso);
  if (period && period.status === "closed") throw new UserError(`Accounting period "${period.name}" is closed, so electricity can't be invoiced today. Reopen it in Finance; the reading will bill on the next run.`);
  let invoiceNumber = await storage.getNextSequenceNumber("rent_invoice");
  for (let i = 0; i < 200 && (await sql`SELECT 1 FROM rent_invoices WHERE invoice_number = ${invoiceNumber}` as any[]).length; i++) invoiceNumber = await storage.getNextSequenceNumber("rent_invoice");
  const dueDate = addDays(issueIso, cfg.electricityDueDays);
  const [inv] = await sql`INSERT INTO rent_invoices (invoice_number, lease_id, period_month, rent_amount, electricity_amount, total_amount, amount_paid, due_date, status, created_at, invoice_kind, meter_reading_id)
    VALUES (${invoiceNumber}, ${lease.id}, ${m.period_month}, 0, ${amount}, ${amount}, 0, ${dueDate}, 'unpaid', ${Date.now()}, 'electricity', ${m.id}) RETURNING *` as any[];
  await sql`UPDATE meter_readings SET invoice_id = ${inv.id}, amount = ${amount} WHERE id = ${m.id}`;
  let entry: any;
  try { entry = await storage.postJournalEntry(
    { entryDate: issueIso, description: `Electricity invoice ${invoiceNumber} — period ${m.period_month}`, sourceModule: "tenants", sourceId: Number(inv.id), createdBy: by, createdAt: Date.now() } as any,
    [
      { accountId: lease.receivableAccountId, debit: amount, credit: 0, description: `Electricity invoice ${invoiceNumber}` },
      { accountId: incomeAccountId, debit: 0, credit: amount, description: `Electricity invoice ${invoiceNumber}` },
    ] as any,
  ); } catch (e) {
    // Undo so the reading is billed cleanly on the next run.
    await sql`UPDATE meter_readings SET invoice_id = NULL WHERE id = ${m.id}`;
    await sql`DELETE FROM rent_invoices WHERE id = ${inv.id}`;
    throw e;
  }
  await sql`UPDATE rent_invoices SET journal_entry_id = ${entry.id} WHERE id = ${inv.id}`;
  const shopNo = shop?.shopNumber ?? String(lease.shopId);
  const doc = await issueDocument(storage, {
    docType: "invoice", category: "tenancy", sourceId: Number(inv.id), customDocNumber: invoiceNumber,
    recipientName: tenant?.name ?? "Tenant", recipientEmail: tenant?.email ?? null, issueDate: prettyDate(issueIso),
    lineItems: [{ label: `Shop ${shopNo} electricity — ${monthLabel(m.period_month)}`, detail: `Meter ${lease.meterNumber ?? ""} ${n(m.start_reading)} to ${n(m.end_reading)} = ${units} kWh × KES ${rate}`.replace("Meter  ", "Meter "), amount }],
    totalAmount: amount, amountPaid: 0, balance: amount,
    serviceLabel: "Tenancy (Electricity)",
    meterPhotoUrl: m.photo_url ?? null,
    meterPhotoCaption: m.photo_url ? `Meter ${lease.meterNumber ?? ""} read ${prettyDate(m.reading_date)}: ${n(m.end_reading)} kWh${Number(m.photo_meter_verified) === 0 ? " (meter number not readable in the photo)" : ""}.` : undefined,
    notes: `Electricity for ${monthLabel(m.period_month)}. Due ${prettyDate(dueDate)}.`,
  } as any).catch((e: any) => ({ status: "failed", errorMessage: e?.message } as any));
  let sms = "skipped";
  if (cfg.electricitySms !== 0 && tenant?.phone) {
    const pdf = doc?.id && doc?.publicToken ? ` Invoice: ${base}/api/public/documents/${doc.id}/pdf?token=${doc.publicToken}` : "";
    const s = cfg.raw;
    const pay = s.mpesaNumber ? (s.mpesaPaymentType === "paybill" ? ` Pay via M-Pesa Paybill ${s.mpesaNumber}, Acc ${s.mpesaAccountNumber || invoiceNumber}.` : s.mpesaPaymentType === "phone" ? ` Pay via M-Pesa to ${s.mpesaNumber}.` : ` Pay via M-Pesa Till ${s.mpesaNumber}.`) : "";
    const msg = `Dear ${tenant.name}, your ${s.hotelName || "The Chekata"} electricity invoice ${invoiceNumber} for Shop ${shopNo}, ${monthLabel(m.period_month)}: ${units} kWh, ${kes(amount)}, due ${prettyDate(dueDate)}.${pay}${pdf}`;
    const r = await sendSms({ settings: s, to: tenant.phone, message: msg }).catch((e: any) => ({ ok: false, error: e?.message }));
    sms = r.ok ? "sent" : `failed: ${(r as any).error ?? ""}`;
  }
  return { invoiceNumber, amount, email: doc?.status ?? "failed", sms };
}

/** Bills every saved reading whose review window has passed. Safe to run repeatedly. */
export async function runMeterAutoBilling(base = baseUrl()) {
  const cfg = await billingSettings();
  const out = { water: 0, electricity: 0, errors: [] as string[] };
  if (!cfg.autoFrom) return out;
  const cutoff = Date.now() - cfg.delayHours * 3600_000;
  if (!inFlight.has("water-raise")) {
    inFlight.add("water-raise");
    try {
      const due = await sql`SELECT id FROM water_readings WHERE bill_id IS NULL AND COALESCE(updated_at, created_at) >= ${cfg.autoFrom} AND COALESCE(updated_at, created_at) <= ${cutoff} ORDER BY period_month, id` as any[];
      if (due.length) {
        const r = await raiseWaterBills({ readingIds: due.map((x) => Number(x.id)), by: AUTO, base });
        out.water = r.raised;
        for (const x of r.results) if (x.error) out.errors.push(`water ${x.customer}: ${x.error}`);
      }
    } catch (e: any) { out.errors.push(`water: ${e?.message ?? e}`); }
    finally { inFlight.delete("water-raise"); }
  }
  const dueE = await sql`SELECT id FROM meter_readings WHERE invoice_id IS NULL AND COALESCE(updated_at, created_at) >= ${cfg.autoFrom} AND COALESCE(updated_at, created_at) <= ${cutoff} ORDER BY period_month, id` as any[];
  for (const x of dueE) {
    const key = `elec-invoice-${x.id}`; // same lock as Tenants → Invoice now
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    try { const r = await createElectricityInvoice(Number(x.id), AUTO, base); if (!("skipped" in r)) out.electricity++; }
    catch (e: any) { out.errors.push(`electricity reading ${x.id}: ${e?.message ?? e}`); }
    finally { inFlight.delete(key); }
  }
  return out;
}

export function startMeterAutoBillingSchedule(log: (m: string) => void) {
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      for (const env of (process.env.TEST_DATABASE_URL ? ["live", "test"] : ["live"]) as ("live" | "test")[]) {
        await runWithEnvironment(env, async () => {
          try {
            const r = await runMeterAutoBilling();
            if (r.water || r.electricity || r.errors.length) log(`meter auto-billing (${env}): ${r.water} water bill(s), ${r.electricity} electricity invoice(s)${r.errors.length ? `; errors: ${r.errors.join(" | ")}` : ""}`);
          } catch (e: any) { log(`meter auto-billing (${env}) failed: ${e?.message ?? e}`); }
        });
      }
    } finally { busy = false; }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 15 * 60 * 1000);
}

// ---------------- Routes ----------------
export function registerMeterReadingRoutes(app: Express) {
  const M = requireModule("meter-readings");
  const ANY = requireAnyModule(["meter-readings", "water-sales", "tenants"]);

  app.get("/api/meter-reader/settings", ANY, async (_req, res) => {
    const c = await billingSettings();
    res.json({ delayHours: c.delayHours, autoFrom: c.autoFrom, electricityDueDays: c.electricityDueDays, electricityIncomeAccountId: c.electricityIncomeAccountId, electricitySms: c.electricitySms, visionReady: c.visionReady });
  });
  app.patch("/api/meter-reader/settings", ANY, async (req, res) => {
    try {
      if (!(req as any).user?.isAdmin) return res.status(403).json({ error: "Only an admin can change meter billing settings." });
      const b = z.object({ delayHours: z.number().int().min(0).max(720).optional(), electricityDueDays: z.number().int().min(0).max(90).optional(),
        electricityIncomeAccountId: z.number().int().nullable().optional(), electricitySms: z.number().int().min(0).max(1).optional() }).parse(req.body);
      const patch: any = {};
      if (b.delayHours !== undefined) patch.meterBillDelayHours = b.delayHours;
      if (b.electricityDueDays !== undefined) patch.electricityDueDays = b.electricityDueDays;
      if (b.electricityIncomeAccountId !== undefined) {
        if (b.electricityIncomeAccountId !== null) {
          const [a] = await sql`SELECT type, active FROM chart_of_accounts WHERE id = ${b.electricityIncomeAccountId}` as any[];
          if (!a || a.type !== "income") return res.status(400).json({ error: "Choose an income account." });
        }
        patch.electricityIncomeAccountId = b.electricityIncomeAccountId;
      }
      if (b.electricitySms !== undefined) patch.electricitySms = b.electricitySms;
      await storage.updateSettings(patch);
      const c = await billingSettings();
      res.json({ delayHours: c.delayHours, autoFrom: c.autoFrom, electricityDueDays: c.electricityDueDays, electricityIncomeAccountId: c.electricityIncomeAccountId, electricitySms: c.electricitySms, visionReady: c.visionReady });
    } catch (e) { fail(res, e); }
  });
  app.get("/api/meter-reader/income-accounts", ANY, async (_req, res) => {
    res.json(await sql`SELECT id, code, name FROM chart_of_accounts WHERE type = 'income' AND active = 1 ORDER BY code`);
  });
  // Admin: bill everything whose review window has passed, right now (the job also runs every 15 minutes).
  app.post("/api/meter-reader/run-auto-billing", ANY, async (req, res) => {
    if (!(req as any).user?.isAdmin) return res.status(403).json({ error: "Only an admin can run billing." });
    try { res.json(await runMeterAutoBilling(baseUrl(req))); } catch (e) { fail(res, e); }
  });

  // Water meters — units only (no tariff, charges or balances).
  app.get("/api/meter-reader/water", M, async (req, res) => {
    const month = String(req.query.month ?? "");
    if (!isMonth(month)) return res.status(400).json({ error: "Choose a month." });
    const cfg = await billingSettings();
    const rows = await waterReadingRows(month);
    res.json(rows.map((r: any) => ({
      id: r.customerId, name: r.name, ref: r.accountNo, location: r.location, meterNumber: r.meterNumber, previousReading: r.previousReading, needsStart: false, laterMonth: r.laterMonth,
      reading: r.reading ? {
        id: r.reading.id, currentReading: r.reading.currentReading, consumption: r.reading.consumption, readingDate: r.reading.readingDate,
        meterReplaced: r.reading.meterReplaced, oldMeterFinal: r.reading.oldMeterFinal, newMeterStart: r.reading.newMeterStart,
        invoiced: !!r.reading.billId && r.reading.billStatus !== "cancelled", invoiceNumber: r.reading.billNumber, invoiceStatus: r.reading.billStatus,
        awaitingStaff: !!r.reading.billId && r.reading.billStatus === "cancelled",
        autoBillAt: r.reading.billId ? null : autoBillAt(r.reading.savedAt ?? 0, cfg), savedAt: r.reading.savedAt ?? null,
        photoUrl: r.reading.photoUrl, photoReading: r.reading.photoReading, photoMeterVerified: r.reading.photoMeterVerified,
      } : null,
    })));
  });
  app.put("/api/meter-reader/water", M, async (req, res) => {
    try { res.json(await saveWaterReadings(req.body, who(req))); } catch (e) { fail(res, e); }
  });

  // Electricity meters (tenant leases with an electricity rate) — units only.
  app.get("/api/meter-reader/electricity", M, async (req, res) => {
    const month = String(req.query.month ?? "");
    if (!isMonth(month)) return res.status(400).json({ error: "Choose a month." });
    res.json((await electricityRows(month)).map((r) => ({ id: r.leaseId, name: r.name, ref: r.ref, location: null, meterNumber: r.meterNumber, previousReading: r.previousReading, needsStart: r.needsStart, laterMonth: r.laterMonth,
      reading: r.reading ? { ...r.reading, awaitingStaff: false } : null })));
  });
  app.put("/api/meter-reader/electricity", M, async (req, res) => {
    try { res.json(await saveElectricityReadings(req.body, who(req))); } catch (e) { fail(res, e); }
  });

  app.post("/api/meter-reader/scan", M, async (req, res) => {
    try {
      const b = z.object({ kind: z.enum(["water", "electricity"]), imageBase64: z.string().min(100), mimeType: z.enum(["image/jpeg", "image/png"]), targetId: z.number().int().nullable().optional() }).parse(req.body);
      res.json(await scanMeterPhoto({ kind: b.kind, imageBase64: b.imageBase64, mimeType: b.mimeType, targetId: b.targetId ?? null }));
    } catch (e: any) {
      if (e instanceof UploadValidationError) return res.status(400).json({ error: e.message });
      fail(res, e);
    }
  });

  // Tenants staff: full electricity reading list with billing status, correct/delete before invoicing, invoice now.
  app.get("/api/tenants/electricity-readings", requireModule("tenants"), async (req, res) => {
    const month = String(req.query.month ?? "");
    if (!isMonth(month)) return res.status(400).json({ error: "Choose a month." });
    res.json(await electricityRows(month));
  });
  app.put("/api/tenants/electricity-readings", requireModule("tenants"), async (req, res) => {
    try { res.json(await saveElectricityReadings(req.body, who(req))); } catch (e) { fail(res, e); }
  });
  app.delete("/api/tenants/electricity-readings/:id", requireModule("tenants"), async (req, res) => {
    const [m] = await sql`SELECT m.*, i.status AS invoice_status FROM meter_readings m LEFT JOIN rent_invoices i ON i.id = m.invoice_id WHERE m.id = ${Number(req.params.id)}` as any[];
    if (!m) return res.status(404).json({ error: "Reading not found" });
    if (m.invoice_id && Number(m.invoice_id) > 0 && m.invoice_status !== "cancelled") return res.status(409).json({ error: "This reading has been invoiced. Cancel the invoice first." });
    const [later] = await sql`SELECT 1 FROM meter_readings WHERE lease_id = ${m.lease_id} AND period_month > ${m.period_month} LIMIT 1` as any[];
    if (later) return res.status(409).json({ error: "A later month's reading exists, so this one can't be removed." });
    await sql`DELETE FROM meter_readings WHERE id = ${m.id}`;
    res.json({ ok: true });
  });
  app.post("/api/tenants/electricity-readings/:id/invoice", requireModule("tenants"), async (req, res) => {
    const key = `elec-invoice-${req.params.id}`;
    if (inFlight.has(key)) return res.status(409).json({ error: "Already being invoiced." });
    inFlight.add(key);
    try {
      const r = await createElectricityInvoice(Number(req.params.id), who(req), baseUrl(req));
      if ("skipped" in r) return res.status(409).json({ error: (r as any).nothingToBill ? "No units used — nothing to invoice." : "Already invoiced." });
      res.json(r);
    } catch (e) { fail(res, e); }
    finally { inFlight.delete(key); }
  });
}
