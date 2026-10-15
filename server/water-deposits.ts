// Metered water: connection deposits.
// A deposit is money held for the customer, not income: Dr bank (where it was paid in) / Cr the
// "deposits held" liability chosen in Water settings. Each deposit gets a receipt (email + SMS),
// and its payment reference can be used only once anywhere in the system.
// Cancelling a deposit entered by mistake reverses its journal and frees the reference.
import type { Express, Request } from "express";
import { z } from "zod";
import { sql, storage } from "./storage";
import { requireModule } from "./auth";
import { issueDocument } from "./documents";
import { sendSms } from "./sms";
import { normalizeRef, isRealRef, inFlight, findReferenceUse, duplicateRefMessage } from "./payment-refs";

const TZ = 3 * 3600_000;
const today = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const who = (req: Request) => (req as any).user?.fullName ?? (req as any).user?.username ?? "staff";
const prettyDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
function baseUrl(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}
class DepositError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function postedTotal(customerId: number): Promise<number> {
  const [r] = await sql`SELECT COALESCE(SUM(amount), 0) AS t FROM water_deposits WHERE customer_id = ${customerId} AND status = 'posted'` as any[];
  return r2(n(r?.t));
}

export function registerWaterDepositRoutes(app: Express) {
  const W = requireModule("water-sales");
  const fail = (res: any, err: any) => res.status(err?.issues ? 400 : err instanceof DepositError ? err.status : 500)
    .json({ error: err?.issues ? err.issues[0]?.message : err?.message ?? "Failed" });

  // Accounts for the Water settings card.
  app.get("/api/water-billing/deposit-accounts", W, async (_req, res) => {
    const s = await storage.getSettings() as any;
    res.json({
      liabilities: await sql`SELECT id, code, name FROM chart_of_accounts WHERE active = 1 AND type = 'liability' ORDER BY code`,
      banks: await sql`SELECT id, name, account_number AS "accountNumber" FROM bank_accounts WHERE active = 1 ORDER BY name`,
      depositAccountId: s.waterDepositAccountId ?? null, depositBankAccountId: s.waterDepositBankAccountId ?? null,
    });
  });
  app.patch("/api/water-billing/deposit-accounts", W, async (req, res) => {
    try {
      if (!(req as any).user?.isAdmin) throw new DepositError("Only an admin can change where deposits post.", 403);
      const b = z.object({ depositAccountId: z.number().int().positive().nullable().optional(), depositBankAccountId: z.number().int().positive().nullable().optional() }).parse(req.body);
      if (b.depositAccountId) {
        const [a] = await sql`SELECT type FROM chart_of_accounts WHERE id = ${b.depositAccountId}` as any[];
        if (!a || a.type !== "liability") throw new DepositError("Choose a liability account for deposits held.");
      }
      if (b.depositBankAccountId && !(await storage.getBankAccount(b.depositBankAccountId))) throw new DepositError("Bank account not found.");
      const patch: any = {};
      if (b.depositAccountId !== undefined) patch.waterDepositAccountId = b.depositAccountId;
      if (b.depositBankAccountId !== undefined) patch.waterDepositBankAccountId = b.depositBankAccountId;
      await storage.updateSettings(patch);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/water-billing/customers/:id/deposits", W, async (req, res) => {
    const id = Number(req.params.id);
    const rows = await sql`SELECT d.*, b.name AS bank_name, j.entry_number, r.entry_number AS reversal_number
      FROM water_deposits d LEFT JOIN bank_accounts b ON b.id = d.bank_account_id
      LEFT JOIN journal_entries j ON j.id = d.journal_entry_id LEFT JOIN journal_entries r ON r.id = d.reversal_journal_id
      WHERE d.customer_id = ${id} ORDER BY d.id DESC` as any[];
    const [c] = await sql`SELECT deposit_amount FROM water_customers WHERE id = ${id}` as any[];
    const posted = await postedTotal(id);
    res.json({ deposits: rows, posted, total: r2(n(c?.deposit_amount)), handEntered: r2(Math.max(0, n(c?.deposit_amount) - posted)) });
  });

  app.post("/api/water-billing/customers/:id/deposits", W, async (req, res) => {
    let lock: string | null = null;
    try {
      const id = Number(req.params.id);
      const [c] = await sql`SELECT * FROM water_customers WHERE id = ${id}` as any[];
      if (!c) throw new DepositError("Customer not found", 404);
      const b = z.object({
        amount: z.coerce.number().positive("Enter the deposit amount."),
        paymentMethod: z.enum(["cash", "mpesa", "card", "bank_transfer"], { message: "Choose how the customer paid." }),
        paymentReference: z.string().trim().max(60).nullable().optional(),
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        bankAccountId: z.coerce.number().int().positive().nullable().optional(),
        replacesHandEntered: z.boolean().optional(),
      }).parse(req.body);
      const amount = r2(b.amount);
      const paidOn = b.paidOn ?? today();
      if (paidOn > today()) throw new DepositError("The payment date can't be in the future.");
      const reference = (b.paymentReference || "").toUpperCase() || null;
      if (b.paymentMethod === "mpesa" && !reference) throw new DepositError("Enter the M-Pesa code.");
      const s = await storage.getSettings() as any;
      const liability = Number(s.waterDepositAccountId) || null;
      if (!liability) throw new DepositError("Choose the deposits held account first (Water sales → Metered → Tariffs → Deposits).", 409);
      const bankId = b.bankAccountId ?? (Number(s.waterDepositBankAccountId) || null);
      if (!bankId) throw new DepositError("Choose the bank account the deposit was paid into.");
      const bank = await storage.getBankAccount(bankId);
      if (!bank) throw new DepositError("That bank account no longer exists.");
      const period = await storage.findOpenPeriodForDate(paidOn);
      if (period && period.status === "closed") throw new DepositError(`Accounting period "${period.name}" covering ${paidOn} is closed. Reopen it in Finance → Accounting periods, then record the deposit.`, 409);
      if (reference) {
        const k = normalizeRef(reference);
        if (isRealRef(k)) {
          if (inFlight.has(k)) throw new DepositError(duplicateRefMessage(reference, "another payment being saved right now"), 409);
          const used = await findReferenceUse(reference);
          if (used) throw new DepositError(duplicateRefMessage(reference, used), 409);
          lock = k; inFlight.add(k);
        }
      }
      const postedBefore = await postedTotal(id);
      const handEntered = r2(Math.max(0, n(c.deposit_amount) - postedBefore));
      const replaced = b.replacesHandEntered ? handEntered : 0;
      const label = `Water deposit — ${c.account_no} ${c.name}${reference ? ` (${reference})` : ""}`;
      const entry = await storage.postJournalEntry(
        { entryDate: paidOn, description: label, sourceModule: "water-deposits", sourceId: id, createdBy: who(req), createdAt: Date.now() } as any,
        [{ accountId: bank.glAccountId, debit: amount, credit: 0, description: `${label} → ${bank.name}` },
          { accountId: liability, debit: 0, credit: amount, description: `Deposit held for ${c.account_no}` }] as any,
      );
      const [d] = await sql`INSERT INTO water_deposits (customer_id, amount, paid_on, payment_method, payment_reference, bank_account_id, journal_entry_id, replaces_hand_entered, recorded_by, created_at)
        VALUES (${id}, ${amount}, ${paidOn}, ${b.paymentMethod}, ${reference}, ${bank.id}, ${entry.id}, ${replaced}, ${who(req)}, ${Date.now()}) RETURNING *` as any[];
      await sql`UPDATE journal_entries SET source_id = ${d.id} WHERE id = ${entry.id}`;
      const newTotal = r2(n(c.deposit_amount) - replaced + amount);
      await sql`UPDATE water_customers SET deposit_amount = ${newTotal}, deposit_reference = ${reference ?? c.deposit_reference}, deposit_date = ${paidOn} WHERE id = ${id}`;
      const doc = await issueDocument(storage, {
        docType: "receipt", category: "water_deposit", sourceId: d.id, customDocNumber: `${c.account_no}-D${d.id}`,
        recipientName: c.name, recipientEmail: c.email || null, issueDate: prettyDate(paidOn),
        lineItems: [{ label: `Water meter deposit — account ${c.account_no}`, amount }],
        totalAmount: amount, amountPaid: amount, balance: 0, paymentAmount: amount, paymentMethod: b.paymentMethod, paymentReference: reference,
        notes: `Refundable deposit held for water account ${c.account_no}${c.meter_number ? ` · Meter ${c.meter_number}` : ""}. Total deposit held: ${kes(newTotal)}.`,
      } as any).catch(() => null);
      if (doc?.id) await sql`UPDATE water_deposits SET document_id = ${doc.id} WHERE id = ${d.id}`;
      let sms = "skipped";
      if (c.phone) {
        const link = doc?.id && (doc as any).publicToken ? ` Receipt: ${baseUrl(req)}/api/public/documents/${doc.id}/pdf?token=${(doc as any).publicToken}` : "";
        const r = await sendSms({ source: "Water deposit", settings: s, to: c.phone, message: `Hi ${c.name}, we have received your water deposit of ${kes(amount)}${reference ? ` (${reference})` : ""} for account ${c.account_no}. Total deposit held: ${kes(newTotal)}. Thank you, The Chekata.${link}` }).catch((e: any) => ({ ok: false, error: e?.message }));
        sms = r.ok ? "sent" : `failed: ${(r as any).error ?? ""}`;
      }
      res.status(201).json({ ok: true, id: d.id, amount, total: newTotal, entryNumber: entry.entryNumber, receiptNo: `${c.account_no}-D${d.id}`, email: doc?.status ?? null, sms,
        _document: doc ? { status: doc.status, errorMessage: (doc as any).errorMessage, id: doc.id, publicToken: (doc as any).publicToken } : null });
    } catch (e) { fail(res, e); }
    finally { if (lock) inFlight.delete(lock); }
  });

  // Cancel a deposit recorded by mistake: reverses the journal, frees the reference, lowers the total.
  app.post("/api/water-billing/deposits/:id/cancel", W, async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 3) throw new DepositError("Give a reason for cancelling.");
      const [d] = await sql`SELECT * FROM water_deposits WHERE id = ${Number(req.params.id)}` as any[];
      if (!d) throw new DepositError("Deposit not found", 404);
      if (d.status !== "posted") throw new DepositError("This deposit is already cancelled.", 409);
      const date = today();
      const period = await storage.findOpenPeriodForDate(date);
      if (period && period.status === "closed") throw new DepositError(`Accounting period "${period.name}" covering ${date} is closed. Reopen it to cancel this deposit.`, 409);
      let revId: number | null = null;
      if (d.journal_entry_id) {
        const lines = await storage.listJournalEntryLines(Number(d.journal_entry_id));
        const rev = await storage.postJournalEntry(
          { entryDate: date, description: `Water deposit cancelled: ${reason}`, sourceModule: "water-deposits", sourceId: d.id, createdBy: who(req), createdAt: Date.now() } as any,
          lines.map((l: any) => ({ accountId: l.accountId, debit: n(l.credit), credit: n(l.debit), description: `Cancelled: ${reason}` })) as any,
        );
        revId = rev.id;
      }
      await sql`UPDATE water_deposits SET status = 'cancelled', cancel_reason = ${reason}, reversal_journal_id = ${revId}, void_reference = payment_reference, payment_reference = NULL,
        cancelled_by = ${who(req)}, cancelled_at = ${Date.now()} WHERE id = ${d.id}`;
      const [c] = await sql`SELECT deposit_amount FROM water_customers WHERE id = ${d.customer_id}` as any[];
      await sql`UPDATE water_customers SET deposit_amount = ${r2(Math.max(0, n(c?.deposit_amount) - n(d.amount) + n(d.replaces_hand_entered)))} WHERE id = ${d.customer_id}`;
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
}
