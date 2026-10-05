// Posts receipts into Finance (see shared/receipt-posting.ts). Best-effort: a posting problem never
// blocks the receipt itself; it is logged and the receipt can be posted later from Settings.
import { sql, type IStorage } from "./storage";
import { parseReceiptPosting, normalizeMethod } from "@shared/receipt-posting";

export interface PostableDoc { id: number; docType: string; category: string; sourceId: number; recipientName: string; createdAt: number; payloadJson?: string | null }

const nairobiDate = (ms: number) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

/** Amount actually received on this document, and how. */
export function receivedOn(doc: { docType: string; amount?: number; payloadJson?: string | null }) {
  let p: any = {};
  try { p = JSON.parse(doc.payloadJson || "{}"); } catch { /* old row */ }
  const amount = doc.docType === "receipt" ? Number(p.paymentAmount ?? doc.amount ?? 0) : doc.docType === "invoice" ? Number(p.amountPaid ?? 0) : 0;
  return { amount: Math.round((amount || 0) * 100) / 100, method: normalizeMethod(p.paymentMethod), reference: p.paymentReference ?? null, docNumber: p.customDocNumber ?? null };
}

export type PostResult = { status: "posted" | "skipped" | "failed"; reason?: string; entryId?: number };

export async function postReceiptToFinance(storage: IStorage, doc: PostableDoc, opts: { force?: boolean; by?: string } = {}): Promise<PostResult> {
  const settings = await storage.getSettings();
  const cfg = parseReceiptPosting((settings as any).receiptPosting);
  if (!cfg.enabled) return { status: "skipped", reason: "Receipt posting is off" };
  const r = receivedOn(doc);
  if (!(r.amount > 0)) return { status: "skipped", reason: "No payment on this document" };
  const date = nairobiDate(doc.createdAt);
  if (!opts.force && cfg.startDate && date < cfg.startDate) return { status: "skipped", reason: "Before the posting start date" };
  const already = await sql`SELECT id FROM journal_entries WHERE source_module = 'receipts' AND source_id = ${doc.id} AND status = 'posted' LIMIT 1` as any[];
  if (already[0]) return { status: "skipped", reason: "Already posted", entryId: already[0].id };
  if (!r.method) return { status: "failed", reason: "Payment method not recorded on the receipt" };
  const bankId = cfg.accounts[r.method];
  if (!bankId) return { status: "failed", reason: `No cash/bank account chosen for ${r.method} in Settings` };
  const bank = await storage.getBankAccount(Number(bankId));
  if (!bank) return { status: "failed", reason: "The chosen cash/bank account no longer exists" };
  const incomeId = cfg.income[doc.category] || cfg.income.default;
  if (!incomeId) return { status: "failed", reason: `No income account chosen for ${doc.category} in Settings` };
  const label = `${doc.docType === "receipt" ? "Receipt" : "Payment on invoice"} #${doc.id} — ${doc.recipientName}${r.reference ? ` (${r.reference})` : ""}`;
  try {
    const entry = await storage.postJournalEntry(
      { entryDate: date, description: label, sourceModule: "receipts", sourceId: doc.id, createdBy: opts.by ?? "System (receipt posting)", createdAt: Date.now() } as any,
      [
        { accountId: bank.glAccountId, debit: r.amount, credit: 0, description: `${label} → ${bank.name}` },
        { accountId: Number(incomeId), debit: 0, credit: r.amount, description: `${doc.category} income` },
      ],
    );
    return { status: "posted", entryId: entry.id };
  } catch (e: any) {
    return { status: "failed", reason: e?.message ?? "Posting failed" };
  }
}
