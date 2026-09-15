import { randomBytes } from "node:crypto";
import type { IStorage } from "./storage";
import { buildDocumentPdf, type DocLineItem } from "./pdf";
import { sendTransactionalEmail } from "./email";
import { computeInclusiveTaxBreakdown } from "./tax";
import type { DocumentRecord, TaxCategory } from "@shared/schema";

const DOC_CATEGORY_TO_TAX_CATEGORY: Record<string, TaxCategory> = {
  accommodation: "accommodation",
  facility: "facilities",
  bar: "bar",
  restaurant: "restaurant",
  movie: "facilities",
  tenancy: "tenancy",
};

export interface IssueDocumentInput {
  docType: "invoice" | "receipt" | "credit_note";
  category: "accommodation" | "facility" | "bar" | "restaurant" | "movie" | "tenancy";
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
  // Credit notes only: the invoice/receipt document being credited, its display number
  // (for the PDF's "Against invoice" line), and the reason given for the credit.
  relatedDocumentId?: number;
  relatedDocNumber?: string;
  reason?: string;
}

// Generates a PDF, attempts to email it, and always logs the outcome to the
// documents table so it shows up in the Invoices & Receipts page.
export async function issueDocument(storage: IStorage, input: IssueDocumentInput): Promise<DocumentRecord> {
  const settings = await storage.getSettings();

  // Compute the tax breakdown once up front and bake it into the stored
  // payload snapshot, so re-viewing or re-downloading this document later
  // (via /api/documents/:id/pdf) reproduces the exact same tax lines that
  // were shown at the time it was issued, instead of silently omitting them.
  const allTaxesForSnapshot = await storage.listTaxes();
  const taxCategoryForSnapshot = DOC_CATEGORY_TO_TAX_CATEGORY[input.category];
  const taxBreakdownForSnapshot = computeInclusiveTaxBreakdown(input.totalAmount, allTaxesForSnapshot, taxCategoryForSnapshot);
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
  category: "accommodation" | "facility" | "movie" | "bar" | "restaurant";
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
