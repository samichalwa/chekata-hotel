// SHPMS link — Seanes Homes' property management system (SHPMS) is the master for the tenancies of
// The Chekata property. Rent is paid to The Chekata's own bank, and The Chekata bills electricity/water itself.
//
//   SHPMS → Chekata (signed webhook, POST /api/integrations/shpms/events)
//     lease.updated        tenant + unit + lease snapshot → Tenants (read-only here)
//     invoice.updated      issued / allocations / void → mirrored rent invoice + Dr receivable / Cr income
//     credit_note.issued   → Dr income / Cr receivable, invoice total reduced
//     declaration.updated  tenant says "I paid" → queue for staff to Confirm / Query
//     receipt.updated      payment confirmed (or voided) in SHPMS → Dr bank / Cr receivable (or reversed)
//   Chekata → SHPMS (signed calls, made at the moment staff act; nothing is posted unless SHPMS accepts)
//     POST /declarations/:id/confirm, POST /declarations/:id/query, POST /payments, GET /snapshot
//
// Either side may confirm a payment; whichever is first wins and the other is told (SHPMS answers 409).
// Every payment reference is used once across the whole system (shpms_payments is in payment-refs SOURCES).
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { z } from "zod";
import { sql, storage } from "./storage";
import { requireModule } from "./auth";
import { issueDocument } from "./documents";
import { runWithEnvironment, getCurrentEnvironment, type DbEnvironment } from "./db-context";
import { findReferenceUse, normalizeRef, isRealRef, inFlight, duplicateRefMessage } from "./payment-refs";

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const TZ = 3 * 3600_000;
const today = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const who = (req: Request) => (req as any).user?.fullName ?? (req as any).user?.username ?? "staff";
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const SYS = "SHPMS link";
const MAX_SKEW_S = 300;

export class LinkError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

// ---------------------------------------------------------------- settings
export interface LinkConfig {
  enabled: boolean; baseUrl: string; secret: string;
  bankAccountId: number | null; receivableAccountId: number | null; rentIncomeAccountId: number | null;
  otherIncomeAccountId: number | null; depositAccountId: number | null; lastSnapshotAt: number | null;
}
export async function linkConfig(): Promise<LinkConfig> {
  const [r] = await sql`SELECT * FROM shpms_link WHERE id = 1` as any[];
  const id = (v: unknown) => (v === null || v === undefined || Number(v) <= 0 ? null : Number(v));
  return {
    enabled: Number(r?.enabled) === 1, baseUrl: String(r?.base_url ?? "").replace(/\/+$/, ""), secret: String(r?.secret ?? ""),
    bankAccountId: id(r?.bank_account_id), receivableAccountId: id(r?.receivable_account_id), rentIncomeAccountId: id(r?.rent_income_account_id),
    otherIncomeAccountId: id(r?.other_income_account_id), depositAccountId: id(r?.deposit_account_id), lastSnapshotAt: r?.last_snapshot_at ? Number(r.last_snapshot_at) : null,
  };
}
const hint = (s: string) => (s ? `••••${s.slice(-4)}` : "");

// ---------------------------------------------------------------- signing
// signature = "sha256=" + hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), timestamp = Unix seconds.
export function signBody(secret: string, ts: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}
function verify(secret: string, ts: string | undefined, sig: string | undefined, raw: string): string | null {
  if (!ts || !sig) return "Missing signature headers.";
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > MAX_SKEW_S) return "Timestamp too old or invalid.";
  const want = Buffer.from(signBody(secret, ts, raw));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "Bad signature.";
  return null;
}

/** Signed call to SHPMS. Throws LinkError with SHPMS's message on failure. */
export async function callShpms(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const cfg = await linkConfig();
  if (!cfg.enabled) throw new LinkError("The SHPMS link is switched off (Tenants → SHPMS link).", 409);
  if (!cfg.baseUrl || !cfg.secret) throw new LinkError("The SHPMS link isn't set up yet — add the SHPMS address and shared key.", 409);
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const env = getCurrentEnvironment();
  let res: globalThis.Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api/integrations/chekata${path}`, {
      method, body: method === "GET" ? undefined : raw,
      headers: { "content-type": "application/json", "x-link-timestamp": ts, "x-link-signature": signBody(cfg.secret, ts, raw), "x-link-environment": env, "x-link-request-id": randomBytes(8).toString("hex") },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e: any) {
    throw new LinkError(`SHPMS can't be reached right now (${e?.name === "TimeoutError" ? "timed out" : e?.message ?? "network error"}). Nothing was recorded — try again shortly.`, 502);
  }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  return { status: res.status, data };
}

// ---------------------------------------------------------------- mapping helpers
const leaseSnap = z.object({
  id: z.number().int(), lease_no: z.string().nullish(), status: z.string(), start_date: z.string(), end_date: z.string().nullish(),
  rent: z.coerce.number(), rent_due_day: z.coerce.number().int().nullish(),
  unit: z.object({ id: z.number().int(), label: z.string().min(1), property_name: z.string().nullish() }),
  tenant: z.object({ id: z.number().int(), name: z.string().min(1), contact_person: z.string().nullish(), phone: z.string().nullish(), email: z.string().nullish(), id_number: z.string().nullish() }),
});
type LeaseSnap = z.infer<typeof leaseSnap>;

async function upsertLease(s: LeaseSnap, cfg: LinkConfig): Promise<any | null> {
  const now = Date.now();
  // Tenant
  let [t] = await sql`SELECT * FROM tenants WHERE shpms_tenant_id = ${s.tenant.id}` as any[];
  if (t) {
    await sql`UPDATE tenants SET name = ${s.tenant.name}, contact_person = ${s.tenant.contact_person ?? null}, phone = ${s.tenant.phone ?? null},
      email = ${s.tenant.email ?? null}, id_number = ${s.tenant.id_number ?? null}, active = 1 WHERE id = ${t.id}`;
  } else {
    [t] = await sql`INSERT INTO tenants (name, contact_person, phone, email, id_number, active, notes, created_at, shpms_tenant_id)
      VALUES (${s.tenant.name}, ${s.tenant.contact_person ?? null}, ${s.tenant.phone ?? null}, ${s.tenant.email ?? null}, ${s.tenant.id_number ?? null}, 1,
        'Managed in SHPMS (Seanes Homes).', ${now}, ${s.tenant.id}) RETURNING *` as any[];
  }
  // Shop (unit)
  let [shop] = await sql`SELECT * FROM shops WHERE shpms_unit_id = ${s.unit.id}` as any[];
  if (!shop) {
    [shop] = await sql`SELECT * FROM shops WHERE shop_number = ${s.unit.label} AND shpms_unit_id IS NULL` as any[];
    if (shop) await sql`UPDATE shops SET shpms_unit_id = ${s.unit.id} WHERE id = ${shop.id}`;
    else {
      let num = s.unit.label;
      if ((await sql`SELECT 1 FROM shops WHERE shop_number = ${num}` as any[]).length) num = `${s.unit.label} (SHPMS ${s.unit.id})`;
      [shop] = await sql`INSERT INTO shops (shop_number, description, active, created_at, shpms_unit_id)
        VALUES (${num}, ${s.unit.property_name ? `${s.unit.property_name} — managed in SHPMS` : "Managed in SHPMS"}, 1, ${now}, ${s.unit.id}) RETURNING *` as any[];
    }
  }
  // Lease
  const status = s.status === "active" ? "active" : ["expired", "terminated", "ended"].includes(s.status) ? "ended" : null;
  const dueDay = Math.min(Math.max(Number(s.rent_due_day) || 5, 1), 28);
  const start = isoDate(s.start_date) ?? today();
  const end = isoDate(s.end_date ?? null);
  const [existing] = await sql`SELECT * FROM tenancy_leases WHERE shpms_lease_id = ${s.id}` as any[];
  if (existing) {
    await sql`UPDATE tenancy_leases SET shop_id = ${shop.id}, tenant_id = ${t.id}, monthly_rent = ${n(s.rent)}, lease_start = ${start}, lease_end = ${end},
      due_day_of_month = ${dueDay}, status = ${status ?? existing.status} WHERE id = ${existing.id}`;
    return (await sql`SELECT * FROM tenancy_leases WHERE id = ${existing.id}` as any[])[0];
  }
  if (!status) return null; // a draft lease is not mirrored until it starts
  const [created] = await sql`INSERT INTO tenancy_leases (shop_id, tenant_id, monthly_rent, electricity_rate_per_unit, lease_start, lease_end, due_day_of_month,
      reminder_days_before, receivable_account_id, income_account_id, status, notes, created_at, shpms_lease_id)
    VALUES (${shop.id}, ${t.id}, ${n(s.rent)}, 0, ${start}, ${end}, ${dueDay}, 3, ${cfg.receivableAccountId}, ${cfg.rentIncomeAccountId}, ${status},
      ${`SHPMS lease ${s.lease_no ?? s.id}. Rent, dates and tenant details are managed in SHPMS; set the electricity rate and meter number here.`}, ${now}, ${s.id}) RETURNING *` as any[];
  return created;
}

async function needLease(s: unknown, cfg: LinkConfig) {
  const lease = await upsertLease(leaseSnap.parse(s), cfg);
  if (!lease) throw new LinkError("The lease is still a draft in SHPMS, so nothing is recorded yet.", 422);
  return lease;
}

function receivableFor(lease: any, cfg: LinkConfig): number {
  const id = cfg.receivableAccountId ?? (lease.receivable_account_id ? Number(lease.receivable_account_id) : null);
  if (!id) throw new LinkError("Choose the tenant receivable account in Tenants → SHPMS link.", 409);
  return id;
}
function accountForLine(category: string, cfg: LinkConfig, lease: any): number {
  const c = (category || "").toLowerCase();
  if (c.includes("deposit")) {
    if (!cfg.depositAccountId) throw new LinkError("An SHPMS invoice has a deposit line — choose the tenant deposits account in Tenants → SHPMS link.", 409);
    return cfg.depositAccountId;
  }
  const rent = cfg.rentIncomeAccountId ?? (lease.income_account_id ? Number(lease.income_account_id) : null);
  const id = c === "rent" ? rent : cfg.otherIncomeAccountId ?? rent;
  if (!id) throw new LinkError("Choose the rent income account in Tenants → SHPMS link.", 409);
  return id;
}

async function assertOpen(date: string) {
  const p = await (storage as any).findOpenPeriodForDate(date);
  if (p && p.status === "closed") throw new LinkError(`Accounting period "${p.name}" covering ${date} is closed. Reopen it in Finance; SHPMS will resend this update.`, 503);
}
async function reverseJournal(journalId: number, date: string, why: string): Promise<number> {
  const lines = await storage.listJournalEntryLines(journalId);
  const entry = await storage.postJournalEntry(
    { entryDate: date, description: why, sourceModule: "shpms", sourceId: journalId, createdBy: SYS, createdAt: Date.now() } as any,
    lines.map((l: any) => ({ accountId: l.accountId, debit: n(l.credit), credit: n(l.debit), description: why })) as any,
  );
  return entry.id;
}
async function bankGl(bankAccountId: number | null): Promise<{ id: number; gl: number; name: string }> {
  if (!bankAccountId) throw new LinkError("Choose the bank account rent is paid into (Tenants → SHPMS link).", 409);
  const b = await storage.getBankAccount(bankAccountId);
  if (!b) throw new LinkError("The selected bank account no longer exists.", 409);
  return { id: b.id, gl: b.glAccountId, name: b.name };
}
const statusFor = (shpms: string, total: number, paid: number) =>
  shpms === "void" ? "cancelled" : paid >= total - 0.01 && total > 0 ? "paid" : paid > 0.01 ? "partially_paid" : "unpaid";

// ---------------------------------------------------------------- inbound processors
const invoiceSnap = z.object({
  id: z.number().int(), invoice_no: z.string().min(1), period_start: z.string(), period_end: z.string().nullish(), issue_date: z.string(), due_date: z.string(),
  status: z.string(), landlord_total: z.coerce.number(), landlord_balance: z.coerce.number(), void_reason: z.string().nullish(),
  lines: z.array(z.object({ description: z.string(), category: z.string().default("other"), amount: z.coerce.number(), payee: z.string().default("landlord") })).default([]),
});

async function onInvoice(data: any, cfg: LinkConfig) {
  const lease = await needLease(data.lease, cfg);
  const inv = invoiceSnap.parse(data.invoice);
  const [ex] = await sql`SELECT * FROM rent_invoices WHERE shpms_invoice_id = ${inv.id}` as any[];
  const landlordLines = inv.lines.filter((l) => l.payee !== "seanes" && n(l.amount) !== 0);
  const total = r2(n(inv.landlord_total));
  if (!ex) {
    if (inv.status === "draft" || inv.status === "void" || total <= 0) return "ignored";
    const issue = isoDate(inv.issue_date) ?? today();
    await assertOpen(issue);
    const recv = receivableFor(lease, cfg);
    // Group credits by account; any rounding gap goes to the first rent/other line.
    const credits = new Map<number, number>();
    for (const l of landlordLines) { const a = accountForLine(l.category, cfg, lease); credits.set(a, r2((credits.get(a) ?? 0) + n(l.amount))); }
    if (!credits.size) credits.set(accountForLine("rent", cfg, lease), total);
    const sum = r2(Array.from(credits.values()).reduce((a, b) => a + b, 0));
    if (Math.abs(sum - total) > 0.01) { const k = Array.from(credits.keys())[0]; credits.set(k, r2((credits.get(k) ?? 0) + total - sum)); }
    let number = inv.invoice_no;
    if ((await sql`SELECT 1 FROM rent_invoices WHERE invoice_number = ${number}` as any[]).length) number = `${inv.invoice_no}-SHPMS`;
    const paid = r2(Math.min(Math.max(total - n(inv.landlord_balance), 0), total));
    const [row] = await sql`INSERT INTO rent_invoices (invoice_number, lease_id, period_month, rent_amount, electricity_amount, total_amount, amount_paid, due_date, status,
        created_at, invoice_kind, shpms_invoice_id, shpms_status)
      VALUES (${number}, ${lease.id}, ${inv.period_start.slice(0, 7)}, ${total}, 0, ${total}, ${paid}, ${isoDate(inv.due_date) ?? issue}, ${statusFor(inv.status, total, paid)},
        ${Date.now()}, 'rent', ${inv.id}, ${inv.status}) RETURNING *` as any[];
    let entry: any;
    try {
      entry = await storage.postJournalEntry(
        { entryDate: issue, description: `SHPMS rent invoice ${inv.invoice_no}`, sourceModule: "shpms", sourceId: Number(row.id), createdBy: SYS, createdAt: Date.now() } as any,
        [{ accountId: recv, debit: total, credit: 0, description: `SHPMS invoice ${inv.invoice_no}` },
          ...Array.from(credits.entries()).map(([accountId, amt]) => ({ accountId, debit: amt < 0 ? -amt : 0, credit: amt > 0 ? amt : 0, description: `SHPMS invoice ${inv.invoice_no}` }))] as any,
      );
    } catch (e) { await sql`DELETE FROM rent_invoices WHERE id = ${row.id}`; throw e; }
    await sql`UPDATE rent_invoices SET journal_entry_id = ${entry.id} WHERE id = ${row.id}`;
    // Tax record (inclusive, Settings → Taxes for tenancy). SHPMS emails the tenant, so no email from here.
    const shop = await storage.getShop(Number(lease.shop_id));
    const tenant = await storage.getTenant(Number(lease.tenant_id));
    const doc = await issueDocument(storage, {
      docType: "invoice", category: "tenancy", sourceId: Number(row.id), customDocNumber: number,
      recipientName: tenant?.name ?? "Tenant", recipientEmail: null, issueDate: issue,
      lineItems: (landlordLines.length ? landlordLines : [{ description: `Shop ${shop?.shopNumber ?? ""} rent`, amount: total }]).map((l: any) => ({ label: l.description, amount: n(l.amount) })),
      totalAmount: total, amountPaid: 0, balance: total, notes: `Issued in SHPMS (Seanes Homes) as ${inv.invoice_no}. Due ${isoDate(inv.due_date) ?? ""}.`,
    } as any).catch(() => null);
    if (doc?.id) await sql`UPDATE documents SET error_message = 'Issued and sent to the tenant by SHPMS.' WHERE id = ${doc.id}`;
    return "created";
  }
  if (inv.status === "void") {
    if (ex.status === "cancelled") return "unchanged";
    const d = today();
    await assertOpen(d);
    if (ex.journal_entry_id) await reverseJournal(Number(ex.journal_entry_id), d, `SHPMS invoice ${inv.invoice_no} voided${inv.void_reason ? `: ${inv.void_reason}` : ""}`);
    await sql`UPDATE rent_invoices SET status = 'cancelled', shpms_status = 'void', cancel_reason = ${`Voided in SHPMS${inv.void_reason ? `: ${inv.void_reason}` : ""}`} WHERE id = ${ex.id}`;
    return "voided";
  }
  const tot = n(ex.total_amount);
  const paid = r2(Math.min(Math.max(tot - n(inv.landlord_balance), 0), tot));
  await sql`UPDATE rent_invoices SET amount_paid = ${paid}, status = ${statusFor(inv.status, tot, paid)}, shpms_status = ${inv.status}, due_date = ${isoDate(inv.due_date) ?? ex.due_date} WHERE id = ${ex.id}`;
  return "updated";
}

async function onCreditNote(data: any, cfg: LinkConfig) {
  const lease = await needLease(data.lease, cfg);
  const c = z.object({ id: z.number().int(), credit_note_no: z.string().nullish(), invoice_id: z.number().int(), amount: z.coerce.number().positive(), date: z.string().nullish(), category: z.string().default("rent"), reason: z.string().nullish() }).parse(data.credit_note);
  if ((await sql`SELECT 1 FROM shpms_credit_notes WHERE shpms_credit_note_id = ${c.id}` as any[]).length) return "unchanged";
  const [inv] = await sql`SELECT * FROM rent_invoices WHERE shpms_invoice_id = ${c.invoice_id}` as any[];
  if (!inv) throw new LinkError(`Credit note for SHPMS invoice ${c.invoice_id}, which hasn't arrived yet — SHPMS will resend.`, 503);
  const d = isoDate(c.date) ?? today();
  await assertOpen(d);
  const amt = r2(c.amount);
  const label = `SHPMS credit note ${c.credit_note_no ?? c.id} on ${inv.invoice_number}`;
  const entry = await storage.postJournalEntry(
    { entryDate: d, description: label, sourceModule: "shpms", sourceId: Number(inv.id), createdBy: SYS, createdAt: Date.now() } as any,
    [{ accountId: accountForLine(c.category, cfg, lease), debit: amt, credit: 0, description: label }, { accountId: receivableFor(lease, cfg), debit: 0, credit: amt, description: label }] as any,
  );
  await sql`INSERT INTO shpms_credit_notes (shpms_credit_note_id, rent_invoice_id, amount, journal_entry_id, created_at) VALUES (${c.id}, ${inv.id}, ${amt}, ${entry.id}, ${Date.now()})`;
  const tot = r2(Math.max(n(inv.total_amount) - amt, 0));
  await sql`UPDATE rent_invoices SET total_amount = ${tot}, rent_amount = ${tot}, amount_paid = LEAST(amount_paid, ${tot}), status = ${statusFor(inv.shpms_status ?? "", tot, Math.min(n(inv.amount_paid), tot))} WHERE id = ${inv.id}`;
  return "created";
}

const declSnap = z.object({
  id: z.number().int(), declaration_no: z.string().nullish(), amount: z.coerce.number(), paid_on: z.string().nullish(), method_code: z.string().nullish(),
  reference: z.string().nullish(), period_start: z.string().nullish(), narrative: z.string().nullish(), status: z.string(),
  query_reason: z.string().nullish(), confirmed_by_name: z.string().nullish(), confirmed_at: z.string().nullish(),
});
async function onDeclaration(data: any, cfg: LinkConfig) {
  const lease = await needLease(data.lease, cfg);
  const d = declSnap.parse(data.declaration);
  const now = Date.now();
  const [ex] = await sql`SELECT * FROM shpms_declarations WHERE shpms_declaration_id = ${d.id}` as any[];
  if (!ex) {
    await sql`INSERT INTO shpms_declarations (shpms_declaration_id, declaration_no, lease_id, amount, paid_on, method, reference, period_start, narrative, status, query_reason,
        confirmed_by, confirmed_at, confirmed_in, created_at, updated_at)
      VALUES (${d.id}, ${d.declaration_no ?? null}, ${lease.id}, ${n(d.amount)}, ${isoDate(d.paid_on)}, ${d.method_code ?? null}, ${d.reference ?? null}, ${isoDate(d.period_start)},
        ${d.narrative ?? null}, ${d.status}, ${d.query_reason ?? null}, ${d.status === "confirmed" ? d.confirmed_by_name ?? "SHPMS" : null},
        ${d.status === "confirmed" ? now : null}, ${d.status === "confirmed" ? "shpms" : null}, ${now}, ${now})`;
    return "created";
  }
  // A declaration confirmed here stays confirmed; otherwise SHPMS's status is the truth.
  if (ex.status === "confirmed") return "unchanged";
  await sql`UPDATE shpms_declarations SET amount = ${n(d.amount)}, paid_on = ${isoDate(d.paid_on)}, method = ${d.method_code ?? null}, reference = ${d.reference ?? null},
      period_start = ${isoDate(d.period_start)}, narrative = ${d.narrative ?? null}, status = ${d.status}, query_reason = ${d.query_reason ?? null},
      confirmed_by = ${d.status === "confirmed" ? d.confirmed_by_name ?? "SHPMS" : null}, confirmed_at = ${d.status === "confirmed" ? now : null},
      confirmed_in = ${d.status === "confirmed" ? "shpms" : null}, updated_at = ${now} WHERE id = ${ex.id}`;
  return "updated";
}

const receiptSnap = z.object({
  id: z.number().int(), receipt_no: z.string().nullish(), declaration_id: z.number().int().nullish(), amount: z.coerce.number().positive(), paid_at: z.string(),
  method: z.string().nullish(), reference: z.string().nullish(), status: z.string(), chekata_payment_id: z.number().int().nullish(),
});
async function onReceipt(data: any, cfg: LinkConfig) {
  const lease = await needLease(data.lease, cfg);
  const r = receiptSnap.parse(data.receipt);
  let [p] = r.chekata_payment_id
    ? await sql`SELECT * FROM shpms_payments WHERE id = ${r.chekata_payment_id}` as any[]
    : await sql`SELECT * FROM shpms_payments WHERE shpms_receipt_id = ${r.id}` as any[];
  if (p && !p.shpms_receipt_id) { await sql`UPDATE shpms_payments SET shpms_receipt_id = ${r.id}, receipt_no = ${r.receipt_no ?? null} WHERE id = ${p.id}`; }
  if (r.status === "void") {
    if (!p || p.status !== "posted") return "unchanged";
    const d = today();
    await assertOpen(d);
    const rev = p.journal_entry_id ? await reverseJournal(Number(p.journal_entry_id), d, `SHPMS receipt ${r.receipt_no ?? r.id} voided`) : null;
    // A voided payment releases nothing: the reference stays recorded so it can't be reused.
    await sql`UPDATE shpms_payments SET status = 'void', reversal_journal_id = ${rev} WHERE id = ${p.id}`;
    if (p.shpms_declaration_id) await sql`UPDATE shpms_declarations SET status = 'queried', query_reason = 'Receipt voided in SHPMS', updated_at = ${Date.now()} WHERE shpms_declaration_id = ${p.shpms_declaration_id}`;
    return "voided";
  }
  if (p) return "unchanged"; // already posted (confirmed here, or an earlier delivery)
  const ref = normalizeRef(r.reference);
  if (isRealRef(ref)) {
    const used = await findReferenceUse(ref);
    if (used) throw new LinkError(`${duplicateRefMessage(ref, used)} SHPMS receipt ${r.receipt_no ?? r.id} was not posted — check it in SHPMS.`, 422);
  }
  const bank = await bankGl(cfg.bankAccountId);
  let date = isoDate(r.paid_at) ?? today();
  const per = await (storage as any).findOpenPeriodForDate(date);
  if (per && per.status === "closed") date = today();
  await assertOpen(date);
  const label = `Rent payment — SHPMS receipt ${r.receipt_no ?? r.id}${ref ? ` (${ref})` : ""}`;
  const entry = await storage.postJournalEntry(
    { entryDate: date, description: label, sourceModule: "shpms", sourceId: r.id, createdBy: SYS, createdAt: Date.now() } as any,
    [{ accountId: bank.gl, debit: r2(r.amount), credit: 0, description: label }, { accountId: receivableFor(lease, cfg), debit: 0, credit: r2(r.amount), description: label }] as any,
  );
  const [pay] = await sql`INSERT INTO shpms_payments (source, lease_id, shpms_declaration_id, shpms_receipt_id, receipt_no, amount, paid_on, payment_method, payment_reference,
      bank_account_id, journal_entry_id, status, recorded_by, created_at)
    VALUES ('shpms', ${lease.id}, ${r.declaration_id ?? null}, ${r.id}, ${r.receipt_no ?? null}, ${r2(r.amount)}, ${date}, ${r.method ?? null}, ${ref || null},
      ${bank.id}, ${entry.id}, 'posted', 'SHPMS', ${Date.now()}) RETURNING id` as any[];
  if (r.declaration_id) await sql`UPDATE shpms_declarations SET status = 'confirmed', confirmed_in = COALESCE(confirmed_in, 'shpms'), confirmed_by = COALESCE(confirmed_by, 'SHPMS'),
      confirmed_at = COALESCE(confirmed_at, ${Date.now()}), payment_id = ${pay.id}, updated_at = ${Date.now()} WHERE shpms_declaration_id = ${r.declaration_id}`;
  return "created";
}

const HANDLERS: Record<string, (data: any, cfg: LinkConfig) => Promise<string>> = {
  "lease.updated": async (data, cfg) => ((await upsertLease(leaseSnap.parse(data.lease), cfg)) ? "updated" : "ignored"),
  "invoice.updated": onInvoice,
  "credit_note.issued": onCreditNote,
  "declaration.updated": onDeclaration,
  "receipt.updated": onReceipt,
};

// One event at a time per environment, so two deliveries for the same lease never race.
const chains = new Map<DbEnvironment, Promise<unknown>>();
function serial<T>(env: DbEnvironment, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(env) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(env, next.catch(() => undefined));
  return next;
}

export async function processEvent(ev: { event_id: string; type: string; data: any }, cfg: LinkConfig): Promise<{ status: number; body: any }> {
  const [seen] = await sql`SELECT id, status FROM shpms_events WHERE event_id = ${ev.event_id}` as any[];
  if (seen && seen.status !== "failed") return { status: 200, body: { ok: true, duplicate: true, result: seen.status } };
  const h = HANDLERS[ev.type];
  const now = Date.now();
  const save = async (status: string, error: string | null) => {
    if (seen) await sql`UPDATE shpms_events SET status = ${status}, error = ${error}, attempts = attempts + 1, payload_json = ${JSON.stringify(ev)}, processed_at = ${now} WHERE id = ${seen.id}`;
    else await sql`INSERT INTO shpms_events (event_id, event_type, status, error, payload_json, received_at, processed_at) VALUES (${ev.event_id}, ${ev.type}, ${status}, ${error}, ${JSON.stringify(ev)}, ${now}, ${now})`;
  };
  if (!h) { await save("ignored", `Unknown event type ${ev.type}`); return { status: 200, body: { ok: true, ignored: true } }; }
  try {
    const result = await h(ev.data ?? {}, cfg);
    await save(result === "ignored" ? "ignored" : "processed", null);
    return { status: 200, body: { ok: true, result } };
  } catch (e: any) {
    const msg = e?.issues ? `Bad data: ${e.issues[0]?.path?.join(".")} ${e.issues[0]?.message}` : e?.message ?? String(e);
    await save("failed", msg);
    // 422 = SHPMS must fix the data; everything else is worth retrying.
    return { status: e?.issues ? 422 : e instanceof LinkError && e.status === 422 ? 422 : 503, body: { ok: false, error: msg } };
  }
}

// ---------------------------------------------------------------- outbound actions (staff)
async function pendingPayment(o: { leaseId: number; amount: number; paidOn: string; method: string | null; ref: string; bankAccountId: number; declId: number | null; invoiceId: number | null; by: string }) {
  const [p] = await sql`INSERT INTO shpms_payments (source, lease_id, shpms_declaration_id, rent_invoice_id, amount, paid_on, payment_method, attempted_reference, bank_account_id, status, recorded_by, created_at)
    VALUES ('chekata', ${o.leaseId}, ${o.declId}, ${o.invoiceId}, ${o.amount}, ${o.paidOn}, ${o.method}, ${o.ref || null}, ${o.bankAccountId}, 'pending', ${o.by}, ${Date.now()}) RETURNING id` as any[];
  return Number(p.id);
}
async function postPayment(payId: number, lease: any, cfg: LinkConfig, o: { amount: number; paidOn: string; ref: string; bankAccountId: number; receiptId: number | null; receiptNo: string | null; label: string }) {
  const bank = await bankGl(o.bankAccountId);
  // SHPMS already has the receipt from here on, so the reference stays reserved whatever happens.
  await sql`UPDATE shpms_payments SET payment_reference = ${o.ref || null}, receipt_no = ${o.receiptNo} WHERE id = ${payId}`;
  if (o.receiptId) {
    try { await sql`UPDATE shpms_payments SET shpms_receipt_id = ${o.receiptId} WHERE id = ${payId}`; }
    catch { await sql`UPDATE shpms_payments SET error = ${`SHPMS receipt id ${o.receiptId} is already linked to another payment here.`} WHERE id = ${payId}`; }
  }
  let entry: any;
  try {
    entry = await storage.postJournalEntry(
      { entryDate: o.paidOn, description: o.label, sourceModule: "shpms", sourceId: payId, createdBy: SYS, createdAt: Date.now() } as any,
      [{ accountId: bank.gl, debit: o.amount, credit: 0, description: o.label }, { accountId: receivableFor(lease, cfg), debit: 0, credit: o.amount, description: o.label }] as any,
    );
  } catch (e: any) {
    await sql`UPDATE shpms_payments SET status = 'journal_failed', error = ${e?.message ?? String(e)} WHERE id = ${payId}`;
    throw new LinkError(`SHPMS recorded the payment, but posting to Finance failed: ${e?.message ?? e}. It is listed in Integrity Checks.`, 500);
  }
  await sql`UPDATE shpms_payments SET status = 'posted', journal_entry_id = ${entry.id} WHERE id = ${payId}`;
}
async function precheck(ref: string, paidOn: string, bankAccountId: number | null, lease: any, cfg: LinkConfig) {
  if (isRealRef(ref)) { const used = await findReferenceUse(ref); if (used) throw new LinkError(duplicateRefMessage(ref, used), 409); }
  await bankGl(bankAccountId);
  receivableFor(lease, cfg);
  const p = await (storage as any).findOpenPeriodForDate(paidOn);
  if (p && p.status === "closed") throw new LinkError(`Accounting period "${p.name}" covering ${paidOn} is closed. Use a date in an open period, or reopen it in Finance.`, 409);
}

export async function confirmDeclaration(id: number, b: { bankAccountId?: number | null; paidOn?: string | null }, by: string) {
  const cfg = await linkConfig();
  const [d] = await sql`SELECT * FROM shpms_declarations WHERE id = ${id}` as any[];
  if (!d) throw new LinkError("Payment not found.", 404);
  if (!["declared", "queried"].includes(d.status)) throw new LinkError(`This payment is already ${d.status}.`, 409);
  const lease = (await sql`SELECT * FROM tenancy_leases WHERE id = ${d.lease_id}` as any[])[0];
  const ref = normalizeRef(d.reference);
  const paidOn = isoDate(b.paidOn) ?? isoDate(d.paid_on) ?? today();
  const bankAccountId = b.bankAccountId ?? cfg.bankAccountId;
  const lock = `shpms-decl-${getCurrentEnvironment()}-${id}`; const rlock = ref ? `ref-${getCurrentEnvironment()}-${ref}` : "";
  if (inFlight.has(lock) || (rlock && inFlight.has(rlock))) throw new LinkError("This payment is being confirmed already.", 409);
  inFlight.add(lock); if (rlock) inFlight.add(rlock);
  try {
    await precheck(ref, paidOn, bankAccountId, lease, cfg);
    const bank = await bankGl(bankAccountId);
    const payId = await pendingPayment({ leaseId: Number(d.lease_id), amount: r2(n(d.amount)), paidOn, method: d.method, ref, bankAccountId: bank.id, declId: Number(d.shpms_declaration_id), invoiceId: null, by });
    let res;
    try { res = await callShpms("POST", `/declarations/${d.shpms_declaration_id}/confirm`, { chekata_payment_id: payId, confirmed_by: by, paid_on: paidOn, bank_account: bank.name }); }
    catch (e: any) { await sql`UPDATE shpms_payments SET status = 'failed', error = ${e?.message ?? String(e)} WHERE id = ${payId}`; throw e; }
    if (res.status === 409 && res.data?.code === "reference_used") {
      await sql`UPDATE shpms_payments SET status = 'failed', error = ${res.data?.error ?? "Reference already used in SHPMS"} WHERE id = ${payId}`;
      throw new LinkError(`SHPMS refused: payment reference ${ref || ""} has already been used there. Each payment reference can only be used once. Nothing was recorded.`, 409);
    }
    if (res.status === 409) {
      await sql`UPDATE shpms_payments SET status = 'failed', error = ${res.data?.error ?? "Already handled in SHPMS"} WHERE id = ${payId}`;
      const st = res.data?.code === "withdrawn" ? "withdrawn" : "confirmed";
      await sql`UPDATE shpms_declarations SET status = ${st}, confirmed_in = ${st === "confirmed" ? "shpms" : null}, updated_at = ${Date.now()} WHERE id = ${id}`;
      throw new LinkError(st === "confirmed" ? "SHPMS confirmed this payment first. Its receipt posts here automatically — nothing more to do." : "The tenant withdrew this payment in SHPMS.", 409);
    }
    if (res.status < 200 || res.status >= 300) {
      const msg = res.data?.error ?? `SHPMS answered ${res.status}`;
      await sql`UPDATE shpms_payments SET status = 'failed', error = ${msg} WHERE id = ${payId}`;
      throw new LinkError(`SHPMS did not accept the confirmation: ${msg}. Nothing was recorded.`, 502);
    }
    const rc = res.data?.receipt ?? {};
    await postPayment(payId, lease, cfg, { amount: r2(n(d.amount)), paidOn, ref, bankAccountId: bank.id, receiptId: rc.id ? Number(rc.id) : null, receiptNo: rc.receipt_no ?? null,
      label: `Rent payment — SHPMS ${d.declaration_no ?? `declaration ${d.shpms_declaration_id}`}${rc.receipt_no ? `, receipt ${rc.receipt_no}` : ""}${ref ? ` (${ref})` : ""}` });
    await sql`UPDATE shpms_declarations SET status = 'confirmed', confirmed_in = 'chekata', confirmed_by = ${by}, confirmed_at = ${Date.now()}, payment_id = ${payId}, updated_at = ${Date.now()} WHERE id = ${id}`;
    return { ok: true, receiptNo: rc.receipt_no ?? null, amount: r2(n(d.amount)) };
  } finally { inFlight.delete(lock); if (rlock) inFlight.delete(rlock); }
}

export async function queryDeclaration(id: number, reason: string, by: string) {
  const [d] = await sql`SELECT * FROM shpms_declarations WHERE id = ${id}` as any[];
  if (!d) throw new LinkError("Payment not found.", 404);
  if (d.status !== "declared") throw new LinkError(`This payment is already ${d.status}.`, 409);
  const res = await callShpms("POST", `/declarations/${d.shpms_declaration_id}/query`, { reason, queried_by: by });
  if (res.status === 409) throw new LinkError(res.data?.error ?? "SHPMS has already handled this payment.", 409);
  if (res.status < 200 || res.status >= 300) throw new LinkError(`SHPMS did not accept the query: ${res.data?.error ?? res.status}.`, 502);
  await sql`UPDATE shpms_declarations SET status = 'queried', query_reason = ${reason}, updated_at = ${Date.now()} WHERE id = ${id}`;
  return { ok: true };
}

export async function recordPayment(b: { leaseId: number; invoiceId?: number | null; amount: number; paymentMethod?: string | null; paymentReference?: string | null; paidOn?: string | null; bankAccountId?: number | null }, by: string) {
  const cfg = await linkConfig();
  const [lease] = await sql`SELECT * FROM tenancy_leases WHERE id = ${b.leaseId}` as any[];
  if (!lease?.shpms_lease_id) throw new LinkError("This lease isn't managed in SHPMS.", 400);
  let inv: any = null;
  if (b.invoiceId) {
    [inv] = await sql`SELECT * FROM rent_invoices WHERE id = ${b.invoiceId}` as any[];
    if (!inv?.shpms_invoice_id || Number(inv.lease_id) !== Number(lease.id)) throw new LinkError("Invoice not found for this lease.", 404);
    if (inv.status === "cancelled") throw new LinkError("This invoice was voided in SHPMS.", 409);
  }
  const amount = r2(n(b.amount));
  if (amount <= 0) throw new LinkError("Enter an amount above zero.", 400);
  const ref = normalizeRef(b.paymentReference);
  const paidOn = isoDate(b.paidOn) ?? today();
  const bankAccountId = b.bankAccountId ?? cfg.bankAccountId;
  const rlock = ref ? `ref-${getCurrentEnvironment()}-${ref}` : "";
  if (rlock && inFlight.has(rlock)) throw new LinkError("A payment with this reference is being saved right now.", 409);
  if (rlock) inFlight.add(rlock);
  try {
    await precheck(ref, paidOn, bankAccountId, lease, cfg);
    const bank = await bankGl(bankAccountId);
    const payId = await pendingPayment({ leaseId: Number(lease.id), amount, paidOn, method: b.paymentMethod ?? null, ref, bankAccountId: bank.id, declId: null, invoiceId: inv ? Number(inv.id) : null, by });
    let res;
    try {
      res = await callShpms("POST", "/payments", { chekata_payment_id: payId, lease_id: Number(lease.shpms_lease_id), invoice_id: inv ? Number(inv.shpms_invoice_id) : null,
        amount, paid_on: paidOn, method: b.paymentMethod ?? null, reference: ref || null, recorded_by: by, bank_account: bank.name });
    } catch (e: any) { await sql`UPDATE shpms_payments SET status = 'failed', error = ${e?.message ?? String(e)} WHERE id = ${payId}`; throw e; }
    if (res.status < 200 || res.status >= 300) {
      const msg = res.data?.error ?? `SHPMS answered ${res.status}`;
      await sql`UPDATE shpms_payments SET status = 'failed', error = ${msg} WHERE id = ${payId}`;
      throw new LinkError(`SHPMS did not accept the payment: ${msg}. Nothing was recorded.`, res.status === 409 ? 409 : 502);
    }
    const rc = res.data?.receipt ?? {};
    await postPayment(payId, lease, cfg, { amount, paidOn, ref, bankAccountId: bank.id, receiptId: rc.id ? Number(rc.id) : null, receiptNo: rc.receipt_no ?? null,
      label: `Rent payment — SHPMS${rc.receipt_no ? ` receipt ${rc.receipt_no}` : ""}${inv ? ` for ${inv.invoice_number}` : ""}${ref ? ` (${ref})` : ""}` });
    // Show it straight away; SHPMS's allocation (invoice.updated) is the final word.
    if (inv) {
      const paid = r2(Math.min(n(inv.amount_paid) + amount, n(inv.total_amount)));
      await sql`UPDATE rent_invoices SET amount_paid = ${paid}, status = ${statusFor(inv.shpms_status ?? "", n(inv.total_amount), paid)} WHERE id = ${inv.id}`;
    }
    return { ok: true, receiptNo: rc.receipt_no ?? null, amount };
  } finally { if (rlock) inFlight.delete(rlock); }
}

// ---------------------------------------------------------------- snapshot (initial load + nightly check)
/** Pulls everything SHPMS holds for the linked property and processes it as events. */
export async function pullSnapshot() {
  const cfg = await linkConfig();
  const res = await callShpms("GET", "/snapshot");
  if (res.status !== 200) throw new LinkError(`SHPMS snapshot failed: ${res.data?.error ?? res.status}`, 502);
  const s = res.data ?? {};
  const out = { leases: 0, invoices: 0, creditNotes: 0, declarations: 0, receipts: 0, failed: [] as string[] };
  const run = async (type: string, key: string, data: any, count: keyof typeof out) => {
    const r = await serial(getCurrentEnvironment(), () => processEvent({ event_id: `snapshot:${key}:${hashOf(data)}`, type, data }, cfg));
    if (r.status === 200) (out[count] as number)++; else out.failed.push(`${key}: ${r.body?.error}`);
  };
  const byLease = new Map<number, any>((s.leases ?? []).map((l: any) => [Number(l.id), l]));
  for (const l of s.leases ?? []) await run("lease.updated", `lease:${l.id}`, { lease: l }, "leases");
  for (const i of s.invoices ?? []) await run("invoice.updated", `invoice:${i.id}`, { lease: byLease.get(Number(i.lease_id)), invoice: i }, "invoices");
  for (const c of s.credit_notes ?? []) await run("credit_note.issued", `credit_note:${c.id}`, { lease: byLease.get(Number(c.lease_id)), credit_note: c }, "creditNotes");
  for (const d of s.declarations ?? []) await run("declaration.updated", `declaration:${d.id}`, { lease: byLease.get(Number(d.lease_id)), declaration: d }, "declarations");
  for (const r of s.receipts ?? []) await run("receipt.updated", `receipt:${r.id}`, { lease: byLease.get(Number(r.lease_id)), receipt: r }, "receipts");
  await sql`UPDATE shpms_link SET last_snapshot_at = ${Date.now()} WHERE id = 1`;
  return { ...out, snapshot: s };
}
function hashOf(v: unknown) { return createHmac("sha256", "x").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16); }

/** Integrity check B9 — compares SHPMS with The Chekata. Returns problem rows. */
export async function linkProblems(): Promise<{ label: string; detail: string; link?: string }[] | null> {
  const cfg = await linkConfig();
  if (!cfg.enabled) return null;
  const items: { label: string; detail: string; link?: string }[] = [];
  const failed = await sql`SELECT event_id, event_type, error, received_at FROM shpms_events WHERE status = 'failed' ORDER BY id DESC LIMIT 20` as any[];
  for (const f of failed) items.push({ label: `SHPMS update ${f.event_type}`, detail: `Not recorded: ${f.error}`, link: "/tenants" });
  const bad = await sql`SELECT p.*, t.name FROM shpms_payments p LEFT JOIN tenancy_leases l ON l.id = p.lease_id LEFT JOIN tenants t ON t.id = l.tenant_id
    WHERE p.status IN ('journal_failed', 'pending') AND p.created_at < ${Date.now() - 10 * 60_000} ORDER BY p.id DESC LIMIT 20` as any[];
  for (const p of bad) items.push({ label: `Payment ${kes(n(p.amount))} · ${p.name ?? ""}`, detail: p.status === "pending" ? "Started but never completed — check SHPMS for a receipt." : `In SHPMS (receipt ${p.receipt_no ?? "?"}) but not posted to Finance: ${p.error}`, link: "/tenants" });
  const dup = await sql`SELECT s.shop_number, COUNT(*) AS k FROM tenancy_leases l JOIN shops s ON s.id = l.shop_id WHERE l.status = 'active'
    AND l.shop_id IN (SELECT shop_id FROM tenancy_leases WHERE shpms_lease_id IS NOT NULL AND status = 'active') GROUP BY s.shop_number HAVING COUNT(*) > 1` as any[];
  for (const d of dup) items.push({ label: `Shop ${d.shop_number}`, detail: "Has an SHPMS lease and another active lease here — end the old Chekata lease so rent isn't billed twice.", link: "/tenants" });
  try {
    const res = await callShpms("GET", "/snapshot");
    if (res.status !== 200) { items.push({ label: "SHPMS", detail: `Comparison failed: ${res.data?.error ?? res.status}` }); return items; }
    const mine = new Map((await sql`SELECT * FROM rent_invoices WHERE shpms_invoice_id IS NOT NULL` as any[]).map((r) => [Number(r.shpms_invoice_id), r]));
    for (const i of res.data?.invoices ?? []) {
      const m = mine.get(Number(i.id));
      if (["draft"].includes(i.status) || n(i.landlord_total) <= 0) continue;
      if (!m) { if (i.status !== "void") items.push({ label: `SHPMS invoice ${i.invoice_no}`, detail: "Not in The Chekata yet.", link: "/tenants" }); continue; }
      if (i.status === "void" ? m.status !== "cancelled" : m.status === "cancelled") items.push({ label: m.invoice_number, detail: `SHPMS says ${i.status}, The Chekata says ${m.status}.`, link: "/tenants" });
      else if (i.status !== "void" && Math.abs(n(m.total_amount) - n(m.amount_paid) - n(i.landlord_balance)) > 0.5) items.push({ label: m.invoice_number, detail: `Balance ${kes(n(m.total_amount) - n(m.amount_paid))} here vs ${kes(n(i.landlord_balance))} in SHPMS.`, link: "/tenants" });
      mine.delete(Number(i.id));
    }
    for (const m of Array.from(mine.values())) if (m.status !== "cancelled") items.push({ label: m.invoice_number, detail: "In The Chekata but no longer in SHPMS.", link: "/tenants" });
    const receipts = new Set((res.data?.receipts ?? []).filter((r: any) => r.status !== "void").map((r: any) => Number(r.id)));
    for (const p of await sql`SELECT id, receipt_no, shpms_receipt_id, amount FROM shpms_payments WHERE status = 'posted' AND shpms_receipt_id IS NOT NULL` as any[])
      if (!receipts.has(Number(p.shpms_receipt_id))) items.push({ label: `Receipt ${p.receipt_no ?? p.shpms_receipt_id}`, detail: `${kes(n(p.amount))} posted here but not an active receipt in SHPMS.`, link: "/tenants" });
  } catch (e: any) { items.push({ label: "SHPMS", detail: `Could not compare: ${e?.message ?? e}` }); }
  return items;
}

// ---------------------------------------------------------------- routes
const fail = (res: Response, e: any) => res.status(e?.issues ? 400 : e instanceof LinkError ? e.status : 400).json({ error: e?.issues ? e.issues[0]?.message : e?.message ?? "Failed" });

/** Public, signed webhook — registered before requireAuth. */
export function registerShpmsPublicRoutes(app: Express) {
  app.post("/api/integrations/shpms/events", (req, res) => {
    const env: DbEnvironment = String(req.headers["x-link-environment"] ?? "live") === "test" ? "test" : "live";
    runWithEnvironment(env, async () => {
      try {
        const cfg = await linkConfig();
        if (!cfg.enabled || !cfg.secret) return res.status(503).json({ ok: false, error: "The Chekata has the SHPMS link switched off." });
        const raw = Buffer.isBuffer((req as any).rawBody) ? (req as any).rawBody.toString("utf8") : "";
        const bad = verify(cfg.secret, req.headers["x-link-timestamp"] as string, req.headers["x-link-signature"] as string, raw);
        if (bad) return res.status(401).json({ ok: false, error: bad });
        const ev = z.object({ event_id: z.string().min(1).max(200), type: z.string().min(1), data: z.any() }).safeParse(req.body);
        if (!ev.success) return res.status(422).json({ ok: false, error: "Body must be { event_id, type, data }." });
        const r = await serial(env, () => processEvent(ev.data as any, cfg));
        res.status(r.status).json(r.body);
      } catch (e: any) { res.status(503).json({ ok: false, error: e?.message ?? "Failed" }); }
    });
  });
}

const ADMIN_ONLY = (req: Request, res: Response) => { if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "Only an admin can change the SHPMS link." }); return false; } return true; };

export function registerShpmsRoutes(app: Express) {
  const T = requireModule("tenants");
  app.get("/api/shpms/settings", T, async (req, res) => {
    const c = await linkConfig();
    res.json({ enabled: c.enabled, baseUrl: c.baseUrl, secretHint: hint(c.secret), hasSecret: !!c.secret, bankAccountId: c.bankAccountId, receivableAccountId: c.receivableAccountId,
      rentIncomeAccountId: c.rentIncomeAccountId, otherIncomeAccountId: c.otherIncomeAccountId, depositAccountId: c.depositAccountId, lastSnapshotAt: c.lastSnapshotAt,
      environment: getCurrentEnvironment(), webhookPath: "/api/integrations/shpms/events", isAdmin: !!(req as any).user?.isAdmin });
  });
  app.patch("/api/shpms/settings", T, async (req, res) => {
    try {
      if (!ADMIN_ONLY(req, res)) return;
      const b = z.object({ enabled: z.boolean().optional(), baseUrl: z.string().trim().max(300).optional(), secret: z.string().trim().min(24, "Use a key of at least 24 characters.").max(300).optional(),
        clearSecret: z.boolean().optional(), bankAccountId: z.number().int().nullable().optional(), receivableAccountId: z.number().int().nullable().optional(),
        rentIncomeAccountId: z.number().int().nullable().optional(), otherIncomeAccountId: z.number().int().nullable().optional(), depositAccountId: z.number().int().nullable().optional() }).parse(req.body);
      if (b.baseUrl && !/^https:\/\/[^\s/]+/.test(b.baseUrl)) return res.status(400).json({ error: "The SHPMS address must start with https://" });
      const want: Record<string, string> = { receivableAccountId: "asset", rentIncomeAccountId: "income", otherIncomeAccountId: "income", depositAccountId: "liability" };
      for (const [k, type] of Object.entries(want)) {
        const v = (b as any)[k];
        if (v) { const [a] = await sql`SELECT type FROM chart_of_accounts WHERE id = ${v}` as any[]; if (!a || a.type !== type) return res.status(400).json({ error: `Choose a${type === "asset" || type === "income" ? "n" : ""} ${type} account.` }); }
      }
      if (b.bankAccountId && !(await storage.getBankAccount(b.bankAccountId))) return res.status(400).json({ error: "Bank account not found." });
      const cur = await linkConfig();
      const next = {
        enabled: b.enabled ?? cur.enabled, base_url: b.baseUrl !== undefined ? b.baseUrl.replace(/\/+$/, "") : cur.baseUrl,
        secret: b.clearSecret ? "" : b.secret ?? cur.secret,
        bank_account_id: b.bankAccountId !== undefined ? b.bankAccountId : cur.bankAccountId, receivable_account_id: b.receivableAccountId !== undefined ? b.receivableAccountId : cur.receivableAccountId,
        rent_income_account_id: b.rentIncomeAccountId !== undefined ? b.rentIncomeAccountId : cur.rentIncomeAccountId,
        other_income_account_id: b.otherIncomeAccountId !== undefined ? b.otherIncomeAccountId : cur.otherIncomeAccountId,
        deposit_account_id: b.depositAccountId !== undefined ? b.depositAccountId : cur.depositAccountId,
      };
      if (next.enabled && (!next.base_url || !next.secret || !next.bank_account_id || !next.receivable_account_id || !next.rent_income_account_id))
        return res.status(400).json({ error: "Before switching the link on, set the SHPMS address, the shared key, the bank account, the receivable account and the rent income account." });
      await sql`UPDATE shpms_link SET enabled = ${next.enabled ? 1 : 0}, base_url = ${next.base_url || null}, secret = ${next.secret || null}, bank_account_id = ${next.bank_account_id},
        receivable_account_id = ${next.receivable_account_id}, rent_income_account_id = ${next.rent_income_account_id}, other_income_account_id = ${next.other_income_account_id},
        deposit_account_id = ${next.deposit_account_id}, updated_at = ${Date.now()}, updated_by = ${who(req)} WHERE id = 1`;
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/shpms/generate-secret", T, async (req, res) => {
    if (!ADMIN_ONLY(req, res)) return;
    res.json({ secret: randomBytes(32).toString("base64url") });
  });
  app.get("/api/shpms/accounts", T, async (_req, res) => {
    res.json({
      accounts: await sql`SELECT id, code, name, type FROM chart_of_accounts WHERE active = 1 AND type IN ('asset','income','liability') ORDER BY code`,
      banks: await sql`SELECT id, name FROM bank_accounts WHERE active = 1 ORDER BY name`,
    });
  });
  app.post("/api/shpms/test", T, async (req, res) => {
    try {
      if (!ADMIN_ONLY(req, res)) return;
      const r = await callShpms("GET", "/ping");
      if (r.status !== 200) return res.status(502).json({ error: `SHPMS answered ${r.status}: ${r.data?.error ?? ""}`.trim() });
      res.json({ ok: true, shpms: r.data });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/shpms/pull", T, async (req, res) => {
    try {
      if (!ADMIN_ONLY(req, res)) return;
      const { snapshot, ...r } = await pullSnapshot();
      res.json(r);
    } catch (e) { fail(res, e); }
  });
  app.get("/api/shpms/declarations", T, async (_req, res) => {
    res.json(await sql`SELECT d.*, t.name AS tenant_name, s.shop_number, p.receipt_no, p.status AS payment_status
      FROM shpms_declarations d LEFT JOIN tenancy_leases l ON l.id = d.lease_id LEFT JOIN tenants t ON t.id = l.tenant_id LEFT JOIN shops s ON s.id = l.shop_id
      LEFT JOIN shpms_payments p ON p.id = d.payment_id
      ORDER BY CASE d.status WHEN 'declared' THEN 0 WHEN 'queried' THEN 1 ELSE 2 END, d.id DESC LIMIT 300`);
  });
  app.get("/api/shpms/payments", T, async (_req, res) => {
    res.json(await sql`SELECT p.*, t.name AS tenant_name, s.shop_number, b.name AS bank_name, j.entry_number
      FROM shpms_payments p LEFT JOIN tenancy_leases l ON l.id = p.lease_id LEFT JOIN tenants t ON t.id = l.tenant_id LEFT JOIN shops s ON s.id = l.shop_id
      LEFT JOIN bank_accounts b ON b.id = p.bank_account_id LEFT JOIN journal_entries j ON j.id = p.journal_entry_id
      ORDER BY p.id DESC LIMIT 300`);
  });
  app.get("/api/shpms/events", T, async (_req, res) => {
    res.json(await sql`SELECT id, event_id, event_type, status, error, attempts, received_at, processed_at FROM shpms_events ORDER BY id DESC LIMIT 200`);
  });
  app.post("/api/shpms/declarations/:id/confirm", T, async (req, res) => {
    try {
      const b = z.object({ bankAccountId: z.number().int().nullable().optional(), paidOn: z.string().nullable().optional() }).parse(req.body ?? {});
      res.json(await confirmDeclaration(Number(req.params.id), b, who(req)));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/shpms/declarations/:id/query", T, async (req, res) => {
    try {
      const b = z.object({ reason: z.string().trim().min(3, "Say what's wrong, so the tenant can fix it.").max(500) }).parse(req.body ?? {});
      res.json(await queryDeclaration(Number(req.params.id), b.reason, who(req)));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/shpms/payments", T, async (req, res) => {
    try {
      const b = z.object({ leaseId: z.number().int(), invoiceId: z.number().int().nullable().optional(), amount: z.number().positive(), paymentMethod: z.string().nullable().optional(),
        paymentReference: z.string().nullable().optional(), paidOn: z.string().nullable().optional(), bankAccountId: z.number().int().nullable().optional() }).parse(req.body);
      res.status(201).json(await recordPayment(b, who(req)));
    } catch (e) { fail(res, e); }
  });
}

// ---------------------------------------------------------------- write guard for linked records
// Mounted on /api after auth. SHPMS is the master for linked tenants/leases/invoices, so the
// matching fields can't be changed here; rent invoice payments on SHPMS invoices go through SHPMS.
const LEASE_LOCAL = new Set(["electricityRatePerUnit", "meterNumber", "notes", "documentUrl", "reminderDaysBefore"]);
export async function shpmsWriteGuard(req: Request, res: Response, next: () => void) {
  try {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
    const p = req.path;
    if (req.body && typeof req.body === "object" && /^\/(tenants-list|tenancy-leases|shops|rent-invoices)/.test(p)) {
      for (const k of ["shpmsTenantId", "shpmsLeaseId", "shpmsUnitId", "shpmsInvoiceId", "shpmsStatus"]) delete (req.body as any)[k];
    }
    let m = p.match(/^\/tenancy-leases\/(\d+)(\/end)?$/);
    if (m) {
      const [l] = await sql`SELECT shpms_lease_id FROM tenancy_leases WHERE id = ${Number(m[1])}` as any[];
      if (l?.shpms_lease_id) {
        if (m[2] || req.method === "DELETE") return res.status(409).json({ error: "This lease is managed in SHPMS — end it there." });
        const blocked = Object.keys(req.body ?? {}).filter((k) => !LEASE_LOCAL.has(k));
        const [cur] = await sql`SELECT * FROM tenancy_leases WHERE id = ${Number(m[1])}` as any[];
        const camel: Record<string, string> = { shopId: "shop_id", tenantId: "tenant_id", monthlyRent: "monthly_rent", leaseStart: "lease_start", leaseEnd: "lease_end", dueDayOfMonth: "due_day_of_month", receivableAccountId: "receivable_account_id", incomeAccountId: "income_account_id", status: "status" };
        const changed = blocked.filter((k) => camel[k] && String((req.body as any)[k] ?? "") !== String(cur?.[camel[k]] ?? ""));
        if (changed.length) return res.status(409).json({ error: "Rent, dates, shop and tenant for this lease are managed in SHPMS. Here you can only change the electricity rate, meter number, reminder days and notes." });
        for (const k of blocked) delete (req.body as any)[k];
      }
      return next();
    }
    m = p.match(/^\/tenants-list\/(\d+)$/);
    if (m) {
      const [t] = await sql`SELECT * FROM tenants WHERE id = ${Number(m[1])}` as any[];
      if (t?.shpms_tenant_id) {
        if (req.method === "DELETE") return res.status(409).json({ error: "This tenant is managed in SHPMS." });
        const map: Record<string, string> = { name: "name", contactPerson: "contact_person", phone: "phone", email: "email", idNumber: "id_number", active: "active" };
        const changed = Object.keys(req.body ?? {}).filter((k) => map[k] && String((req.body as any)[k] ?? "") !== String(t[map[k]] ?? ""));
        if (changed.length) return res.status(409).json({ error: "Name and contact details for this tenant are managed in SHPMS — change them there. Here you can only edit notes." });
      }
      return next();
    }
    m = p.match(/^\/shops\/(\d+)$/);
    if (m && req.method === "DELETE") {
      const [s] = await sql`SELECT shpms_unit_id FROM shops WHERE id = ${Number(m[1])}` as any[];
      if (s?.shpms_unit_id) return res.status(409).json({ error: "This shop is linked to an SHPMS unit." });
      return next();
    }
    if (p === "/rent-invoices/generate") {
      const id = Number((req.body as any)?.leaseId);
      const [l] = id ? await sql`SELECT shpms_lease_id FROM tenancy_leases WHERE id = ${id}` as any[] : [];
      if (l?.shpms_lease_id) return res.status(409).json({ error: "Rent for this lease is invoiced in SHPMS." });
      return next();
    }
    m = p.match(/^\/rent-invoices\/(\d+)\/(payments|cancel|resend)$/);
    if (m) {
      const [inv] = await sql`SELECT id, lease_id, shpms_invoice_id FROM rent_invoices WHERE id = ${Number(m[1])}` as any[];
      if (!inv?.shpms_invoice_id) return next();
      if (m[2] === "cancel") return res.status(409).json({ error: "This invoice comes from SHPMS — void or credit it there." });
      if (m[2] === "resend") return res.status(409).json({ error: "This invoice comes from SHPMS — resend it from SHPMS." });
      const b = (req.body ?? {}) as any;
      try {
        const r = await recordPayment({ leaseId: Number(inv.lease_id), invoiceId: Number(inv.id), amount: Number(b.amount), paymentMethod: b.paymentMethod ?? null,
          paymentReference: b.paymentReference ?? null, bankAccountId: b.bankAccountId ? Number(b.bankAccountId) : null }, who(req));
        return res.status(201).json({ ...r, _document: null, shpms: true });
      } catch (e) { return fail(res, e); }
    }
    next();
  } catch (e) { fail(res, e); }
}
