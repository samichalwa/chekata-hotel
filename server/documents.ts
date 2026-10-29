import { postReceiptToFinance } from "./receipt-posting";
import { randomBytes } from "node:crypto";
import type { IStorage } from "./storage";
import { buildDocumentPdf, type DocLineItem } from "./pdf";
import { sendTransactionalEmail } from "./email";
import { computeInclusiveTaxBreakdown } from "./tax";
import type { DocumentRecord, TaxCategory } from "@shared/schema";

export const DOC_CATEGORY_TO_TAX_CATEGORY: Record<string, TaxCategory> = {
  accommodation: "accommodation",
  facility: "facilities",
  bar: "bar",
  restaurant: "restaurant",
  movie: "facilities",
  tenancy: "tenancy",
  water: "water",
  water_bill: "water",
};

export interface IssueDocumentInput {
  docType: "invoice" | "receipt" | "credit_note";
  category: "accommodation" | "facility" | "bar" | "restaurant" | "movie" | "tenancy" | "water" | "water_bill" | "water_deposit" | "pos_bill";
  sourceId: number;
  customDocNumber?: string; // e.g. a module's own sequence number like RENT-000012
  recipientName: string;
  recipientEmail?: string | null;
  issueDate: string;
  lineItems: DocLineItem[];
  totalAmount: number;
  amountPaid: number;
  balance: number;
  paymentAmount?: number;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  notes?: string;
  broughtForward?: number; // metered water bills: arrears/credit carried onto the bill (display only)
  meterPhotoUrl?: string | null;
  meterPhotoCaption?: string;
  serviceLabel?: string; // overrides the category's "Service:" label on the PDF
  resendOf?: number; // set on resent copies so they are never counted or posted twice
  // Credit notes only: the invoice/receipt document being credited, its display number
  // (for the PDF's "Against invoice" line), and the reason given for the credit.
  relatedDocumentId?: number;
  relatedDocNumber?: string;
  reason?: string;
  // Mixed documents: tax worked out per revenue stream (e.g. { bar: 1200, restaurant: 800 }).
  taxSplit?: Record<string, number>;
  // Payment split by income stream for Finance posting (room bills with bar/restaurant orders).
  incomeSplit?: Record<string, number>;
}

// Generates a PDF, attempts to email it, and always logs the outcome to the
// documents table so it shows up in the Invoices & Receipts page.
export async function issueDocument(storage: IStorage, input: IssueDocumentInput): Promise<DocumentRecord> {
  if (input.category === "accommodation" && (input.docType === "receipt" || input.docType === "invoice")) {
    try { input = await applyRoomPosCharges(input); } catch (e: any) { console.warn(`[pos→room] booking ${input.sourceId}: ${e?.message ?? e}`); }
  }
  const doc = await issueDocumentCore(storage, input);
  // Receipts → Finance (Settings). Never blocks or fails the receipt itself.
  if (doc && (input.docType === "receipt" || input.docType === "invoice")) {
    try {
      const r = await postReceiptToFinance(storage, doc as any);
      if (r.status === "failed") console.warn(`[receipt-posting] document ${doc.id}: ${r.reason}`);
    } catch (e: any) { console.warn(`[receipt-posting] document ${doc.id}: ${e?.message ?? e}`); }
  }
  return doc;
}

async function issueDocumentCore(storage: IStorage, input: IssueDocumentInput): Promise<DocumentRecord> {
  const settings = await storage.getSettings();

  // Compute the tax breakdown once up front and bake it into the stored
  // payload snapshot, so re-viewing or re-downloading this document later
  // (via /api/documents/:id/pdf) reproduces the exact same tax lines that
  // were shown at the time it was issued, instead of silently omitting them.
  const allTaxesForSnapshot = await storage.listTaxes();
  const taxCategoryForSnapshot = DOC_CATEGORY_TO_TAX_CATEGORY[input.category];
  const taxBreakdownForSnapshot = input.taxSplit
    ? mergeTaxBreakdowns(Object.entries(input.taxSplit).map(([cat, amt]) => computeInclusiveTaxBreakdown(amt, allTaxesForSnapshot, DOC_CATEGORY_TO_TAX_CATEGORY[cat])))
    : computeInclusiveTaxBreakdown(input.totalAmount, allTaxesForSnapshot, taxCategoryForSnapshot);
  const inputWithTax: IssueDocumentInput & { taxBreakdown: ReturnType<typeof computeInclusiveTaxBreakdown> } = {
    ...input,
    taxBreakdown: taxBreakdownForSnapshot,
  };

  const payloadJson = JSON.stringify(inputWithTax);
  // Every document gets a public link, regardless of email outcome, so it can be embedded in a
  // free click-to-send WhatsApp confirmation (which can only carry text, not a real attachment).
  const publicToken = randomBytes(16).toString("hex");

  // For invoices/receipts the logged "amount" is the total/payment amount; for credit notes
  // it's simply the credit amount itself (input.totalAmount carries that for credit_note).
  const loggedAmount = input.docType === "receipt" ? (input.paymentAmount ?? input.totalAmount) : input.totalAmount;

  if (!input.recipientEmail) {
    return storage.createDocument({
      docType: input.docType,
      category: input.category,
      sourceId: input.sourceId,
      recipientName: input.recipientName,
      recipientEmail: null,
      amount: loggedAmount,
      status: "skipped",
      errorMessage: "No email address on file for this guest/client.",
      payloadJson,
      createdAt: Date.now(),
      publicToken,
      relatedDocumentId: input.relatedDocumentId ?? null,
      reason: input.reason ?? null,
    });
  }

  if (!settings.invoicesEnabled) {
    return storage.createDocument({
      docType: input.docType,
      category: input.category,
      sourceId: input.sourceId,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      amount: loggedAmount,
      status: "skipped",
      errorMessage: "Invoicing/receipts are turned off in Settings.",
      payloadJson,
      createdAt: Date.now(),
      publicToken,
      relatedDocumentId: input.relatedDocumentId ?? null,
      reason: input.reason ?? null,
    });
  }

  let pdfBuffer: Buffer;
  const tempDoc = { docNumber: input.sourceId, ...input } as any;
  const taxBreakdown = taxBreakdownForSnapshot;
  try {
    pdfBuffer = await buildDocumentPdf(settings, {
      docType: input.docType,
      docNumber: input.sourceId,
      category: input.category,
      customDocNumber: input.customDocNumber,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      issueDate: input.issueDate,
      lineItems: input.lineItems,
      totalAmount: input.totalAmount,
      amountPaid: input.amountPaid,
      balance: input.balance,
      broughtForward: input.broughtForward,
      meterPhotoUrl: input.meterPhotoUrl,
      meterPhotoCaption: input.meterPhotoCaption,
      serviceLabel: input.serviceLabel,
      paymentAmount: input.paymentAmount,
      paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference,
      notes: input.notes,
      taxBreakdown,
      relatedDocNumber: input.relatedDocNumber,
      reason: input.reason,
    });
  } catch (e: any) {
    return storage.createDocument({
      docType: input.docType,
      category: input.category,
      sourceId: input.sourceId,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      amount: loggedAmount,
      status: "failed",
      errorMessage: `PDF generation failed: ${e?.message || e}`,
      payloadJson,
      createdAt: Date.now(),
      publicToken,
      relatedDocumentId: input.relatedDocumentId ?? null,
      reason: input.reason ?? null,
    });
  }

  const title = input.docType === "invoice" ? "Invoice" : input.docType === "receipt" ? "Receipt" : "Credit Note";
  const filename = `${title.replace(/\s+/g, "")}-${input.sourceId}.pdf`;
  const html = input.docType === "credit_note" ? `
    <div style="font-family:Arial,sans-serif;color:#2a2118;line-height:1.5;">
      <p>Dear ${escapeHtml(input.recipientName)},</p>
      <p>Please find attached a credit note from ${escapeHtml(settings.hotelName || "The Chekata")}${input.relatedDocNumber ? ` against invoice ${escapeHtml(input.relatedDocNumber)}` : ""}.</p>
      <p><strong>Credit amount:</strong> KES ${Math.round(input.totalAmount).toLocaleString("en-KE")}</p>
      ${input.reason ? `<p><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>` : ""}
      <p>Your updated outstanding balance is <strong>KES ${Math.round(Math.max(0, input.balance)).toLocaleString("en-KE")}</strong>.</p>
      <p>Thank you for choosing us.</p>
      <p>${escapeHtml(settings.hotelName || "The Chekata")}</p>
    </div>` : `
    <div style="font-family:Arial,sans-serif;color:#2a2118;line-height:1.5;">
      <p>Dear ${escapeHtml(input.recipientName)},</p>
      <p>Please find attached your ${title.toLowerCase()} from ${escapeHtml(settings.hotelName || "The Chekata")}.</p>
      <p><strong>Total:</strong> KES ${Math.round(input.totalAmount).toLocaleString("en-KE")}<br/>
      <strong>Balance:</strong> KES ${Math.round(Math.max(0, input.balance)).toLocaleString("en-KE")}</p>
      ${(input.paymentMethod || input.paymentReference) ? `<p>${input.paymentMethod ? `<strong>Payment method:</strong> ${escapeHtml(input.paymentMethod)}<br/>` : ""}${input.paymentReference ? `<strong>Payment reference:</strong> ${escapeHtml(input.paymentReference)}` : ""}</p>` : ""}
      <p>Thank you for choosing us.</p>
      <p>${escapeHtml(settings.hotelName || "The Chekata")}</p>
    </div>`;

  const result = await sendTransactionalEmail({
    settings,
    to: input.recipientEmail,
    toName: input.recipientName,
    subject: `${title} from ${settings.hotelName || "The Chekata"}`,
    html,
    attachment: { filename, content: pdfBuffer },
  });

  return storage.createDocument({
    docType: input.docType,
    category: input.category,
    sourceId: input.sourceId,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    amount: loggedAmount,
    status: result.ok ? "sent" : "failed",
    errorMessage: result.ok ? null : result.error,
    payloadJson,
    createdAt: Date.now(),
    publicToken,
    relatedDocumentId: input.relatedDocumentId ?? null,
    reason: input.reason ?? null,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

export interface IssueCreditNoteParams {
  category: "accommodation" | "facility" | "movie" | "bar" | "restaurant" | "water" | "water_bill" | "water_deposit";
  sourceId: number;
  requestedAmount: number;
  reason?: string;
  recipientName: string;
  recipientEmail?: string | null;
  currentCreditedAmount: number;
  // The full original charge for this record (invoice/receipt total), used to compute the
  // remaining creditable balance and the new outstanding balance shown on the credit note.
  totalAmount: number;
  amountPaid: number;
  lineItemLabel: string;
}

export type IssueCreditNoteResult =
  | { ok: true; document: DocumentRecord; newCreditedAmount: number; newBalance: number }
  | { ok: false; error: string };

// Shared validation + issuance path for all 4 credit-note-eligible modules (Accommodation,
// Facilities, Movie Room, Bar & Restaurant). Requires an existing invoice/receipt for the
// source record, caps the credit at the remaining creditable balance, and logs+emails the
// credit note PDF exactly like an invoice/receipt. Does NOT update the booking/order row's
// creditedAmount — the caller does that with the returned `newCreditedAmount`, using
// whichever update method matches its table.
export async function issueCreditNote(storage: IStorage, params: IssueCreditNoteParams): Promise<IssueCreditNoteResult> {
  const { category, sourceId, requestedAmount, reason, recipientName, recipientEmail, currentCreditedAmount, totalAmount, amountPaid, lineItemLabel } = params;

  if (!(requestedAmount > 0)) {
    return { ok: false, error: "Credit amount must be greater than zero." };
  }

  const billingDoc = await storage.getBillingDocumentBySource(category, sourceId);
  if (!billingDoc) {
    return { ok: false, error: "No invoice or receipt was found for this record, so a credit note cannot be issued against it." };
  }

  const remaining = totalAmount - currentCreditedAmount;
  if (requestedAmount > remaining + 0.01) {
    return { ok: false, error: `Credit amount exceeds the remaining creditable balance of KES ${Math.round(Math.max(0, remaining)).toLocaleString("en-KE")}.` };
  }

  const newCreditedAmount = currentCreditedAmount + requestedAmount;
  const newBalance = Math.max(0, totalAmount - amountPaid - newCreditedAmount);
  const relatedDocPrefix = billingDoc.docType === "invoice" ? "INV" : "RCT";
  const relatedDocNumber = `${relatedDocPrefix}-${String(billingDoc.sourceId).padStart(5, "0")}`;
  // Dedicated CN-###### sequence (seeded in document_sequences) so two credit notes against
  // the same booking/order get distinct numbers instead of both showing the source's id.
  const customDocNumber = await storage.getNextSequenceNumber("credit_note");

  const document = await issueDocument(storage, {
    docType: "credit_note",
    category,
    sourceId,
    customDocNumber,
    recipientName,
    recipientEmail,
    issueDate: formatDate(),
    lineItems: [{ label: lineItemLabel, amount: requestedAmount }],
    totalAmount: requestedAmount,
    amountPaid: 0,
    balance: newBalance,
    relatedDocumentId: billingDoc.id,
    relatedDocNumber,
    reason,
  });

  return { ok: true, document, newCreditedAmount, newBalance };
}


type TaxBreakdown = ReturnType<typeof computeInclusiveTaxBreakdown>;
function mergeTaxBreakdowns(parts: TaxBreakdown[]): TaxBreakdown {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lines = new Map<string, { name: string; ratePercent: number; amount: number }>();
  let preTaxBase = 0, totalTax = 0;
  for (const p of parts) {
    preTaxBase += p.preTaxBase; totalTax += p.totalTax;
    for (const l of p.lines) {
      const k = `${l.name}|${l.ratePercent}`;
      const cur = lines.get(k);
      if (cur) cur.amount = r2(cur.amount + l.amount); else lines.set(k, { ...l });
    }
  }
  return { ...(parts[0] ?? {}), preTaxBase: r2(preTaxBase), totalTax: r2(totalTax), lines: Array.from(lines.values()) } as TaxBreakdown;
}

// Bar/restaurant orders posted to a room are part of that booking's bill (pos_charges, included in
// totalAmount). Payments on the room bill settle the room first, then the posted orders oldest
// first; the bar/restaurant part is recorded against those orders and posted as bar/restaurant income.
async function applyRoomPosCharges(input: IssueDocumentInput): Promise<IssueDocumentInput> {
  const { sql } = await import("./storage");
  const b = (await sql`SELECT total_amount, pos_charges FROM accommodation_bookings WHERE id = ${input.sourceId}` as any[])[0];
  const pos = Number(b?.pos_charges ?? 0);
  if (!(pos > 0)) return input;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const posted = await sql`SELECT id, order_no, outlet, total_amount, credited_amount, amount_paid FROM orders
    WHERE room_booking_id = ${input.sourceId} AND status = 'room_posted' ORDER BY COALESCE(ordered_at, created_at), id` as any[];
  const byOutlet: Record<string, number> = {};
  for (const o of posted) { const k = o.outlet === "bar" ? "bar" : "restaurant"; byOutlet[k] = r2((byOutlet[k] ?? 0) + Number(o.total_amount) - Number(o.credited_amount ?? 0)); }
  const roomTotal = r2(Math.max(0, input.totalAmount - pos));
  // Tax per stream: the posted amount split across bar/restaurant in proportion to their orders.
  const sumNet = Object.values(byOutlet).reduce((a, b) => a + b, 0);
  const taxSplit: Record<string, number> = { accommodation: roomTotal };
  for (const [k, v] of Object.entries(byOutlet)) taxSplit[k] = sumNet > 0 ? r2((pos * v) / sumNet) : 0;
  const posNote = `Includes bar & restaurant charges ${"KES " + pos.toLocaleString("en-KE", { maximumFractionDigits: 2 })}${posted.length ? ` (${posted.map((o: any) => o.order_no ?? `#${o.id}`).join(", ")})` : ""}.`;
  const out: IssueDocumentInput = { ...input, taxSplit, notes: input.notes?.includes("Includes bar & restaurant") ? input.notes : [input.notes, posNote].filter(Boolean).join("\n") };
  if (input.resendOf) return out;
  const received = input.docType === "receipt" ? Number(input.paymentAmount ?? 0) : Number(input.amountPaid ?? 0);
  if (!(received > 0)) return out;
  const after = Number(input.amountPaid ?? 0);
  const before = Math.max(0, after - received);
  const roomPart = r2(Math.max(0, Math.min(after, roomTotal) - Math.min(before, roomTotal)));
  let posPart = r2(received - roomPart);
  const split: Record<string, number> = { accommodation: roomPart };
  for (const o of posted) {
    if (!(posPart > 0)) break;
    const owed = r2(Number(o.total_amount) - Number(o.credited_amount ?? 0) - Number(o.amount_paid ?? 0));
    if (!(owed > 0)) continue;
    const take = Math.min(owed, posPart);
    const k = o.outlet === "bar" ? "bar" : "restaurant";
    split[k] = r2((split[k] ?? 0) + take);
    posPart = r2(posPart - take);
    await sql`UPDATE orders SET amount_paid = amount_paid + ${take} WHERE id = ${o.id}`;
  }
  if (posPart > 0) split.accommodation = r2(split.accommodation + posPart);
  return { ...out, incomeSplit: split };
}
