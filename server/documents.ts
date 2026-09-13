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
};

export interface IssueDocumentInput {
  docType: "invoice" | "receipt";
  category: "accommodation" | "facility" | "bar" | "restaurant" | "movie";
  sourceId: number;
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

  if (!input.recipientEmail) {
    return storage.createDocument({
      docType: input.docType,
      category: input.category,
      sourceId: input.sourceId,
      recipientName: input.recipientName,
      recipientEmail: null,
      amount: input.docType === "receipt" ? (input.paymentAmount ?? input.totalAmount) : input.totalAmount,
      status: "skipped",
      errorMessage: "No email address on file for this guest/client.",
      payloadJson,
      createdAt: Date.now(),
    });
  }

  if (!settings.invoicesEnabled) {
    return storage.createDocument({
      docType: input.docType,
      category: input.category,
      sourceId: input.sourceId,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      amount: input.docType === "receipt" ? (input.paymentAmount ?? input.totalAmount) : input.totalAmount,
      status: "skipped",
      errorMessage: "Invoicing/receipts are turned off in Settings.",
      payloadJson,
      createdAt: Date.now(),
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
    });
  } catch (e: any) {
    return storage.createDocument({
      docType: input.docType,
      category: input.category,
      sourceId: input.sourceId,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      amount: input.docType === "receipt" ? (input.paymentAmount ?? input.totalAmount) : input.totalAmount,
      status: "failed",
      errorMessage: `PDF generation failed: ${e?.message || e}`,
      payloadJson,
      createdAt: Date.now(),
    });
  }

  const title = input.docType === "invoice" ? "Invoice" : "Receipt";
  const filename = `${title}-${input.sourceId}.pdf`;
  const html = `
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
    amount: input.docType === "receipt" ? (input.paymentAmount ?? input.totalAmount) : input.totalAmount,
    status: result.ok ? "sent" : "failed",
    errorMessage: result.ok ? null : result.error,
    payloadJson,
    createdAt: Date.now(),
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
