import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { Settings, MaintenanceIssue } from "@shared/schema";
import { getCurrentEnvironment } from "./db-context";

// Every PDF generated while a request is running in the Test environment
// gets "TEST COMPANY — " prefixed onto the company/hotel name wherever it
// appears, so a Test-generated invoice/receipt/payslip/report can never be
// mistaken for a real one, even out of context (e.g. forwarded by email).
function companyDisplayName(settings: Settings): string {
  const name = settings.hotelName || "The Chekata";
  return getCurrentEnvironment() === "test" ? `TEST COMPANY — ${name}` : name;
}

// The "TEST COMPANY — " prefix can make the header name noticeably longer
// than the hotel name alone, which would otherwise run into the document
// title box drawn to its right. Shrink the font just enough to fit the
// available width instead of letting the two overlap.
function drawCompanyHeaderName(doc: PDFKit.PDFDocument, text: string, x: number, y: number, maxWidth: number, color: string): void {
  const maxSize = 22;
  const minSize = 9;
  doc.font("Helvetica-Bold");
  let size = maxSize;
  while (size > minSize && doc.fontSize(size).widthOfString(text) > maxWidth) {
    size -= 1;
  }
  // Force a single line (lineBreak: false) so the name never wraps and pushes
  // into the fixed-position address/phone lines drawn below it — if it still
  // doesn't fit at the floor size, truncate with an ellipsis instead of wrapping.
  doc.fillColor(color).fontSize(size).text(text, x, y + (maxSize - size) * 0.6, { width: maxWidth, ellipsis: true, lineBreak: false });
}

// Resolves next to this file in both dev (server/, run via tsx as ESM,
// where __dirname is undefined) and the production bundle (dist/index.cjs,
// a real CJS module where __dirname is always defined natively) — as long
// as the build step copies assets/ alongside dist/index.cjs (see
// script/build.ts).
const moduleDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(moduleDir, "assets", "chekata-logo.jpg");
const LOGO_EXISTS = fs.existsSync(LOGO_PATH);

export interface DocLineItem {
  label: string;
  detail?: string;
  amount: number;
}

export interface DocPayload {
  docType: "invoice" | "receipt" | "credit_note";
  docNumber: number;
  category: "accommodation" | "facility" | "bar" | "restaurant" | "movie" | "tenancy" | "water";
  customDocNumber?: string; // overrides the auto "INV-00001"/"RCT-00001" label (e.g. a module's own sequence number like RENT-000012)
  recipientName: string;
  recipientEmail?: string | null;
  issueDate: string; // formatted date string
  lineItems: DocLineItem[];
  totalAmount: number;
  amountPaid: number;
  balance: number;
  paymentAmount?: number; // for receipts: the specific payment this receipt covers
  paymentMethod?: string | null;
  paymentReference?: string | null;
  notes?: string;
  taxBreakdown?: { preTaxBase: number; totalTax: number; lines: { name: string; ratePercent: number; amount: number }[] };
  // Credit notes only
  relatedDocNumber?: string; // the invoice/receipt number this credit note is issued against
  reason?: string;
}

function fmtKES(n: number): string {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

const CATEGORY_LABEL: Record<string, string> = {
  accommodation: "Accommodation",
  facility: "Conference & Movie Room",
  bar: "Bar",
  restaurant: "Restaurant",
  movie: "Movie Room (Seat Booking)",
  tenancy: "Tenancy (Shop Rent)",
  water: "Water Sales",
};

export function buildDocumentPdf(settings: Settings, payload: DocPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const accent = "#b5502f"; // terracotta
    const dark = "#2a2118";
    const muted = "#6b6157";

    // ---- Header: hotel identity ----
    const logoSize = 46;
    const textX = LOGO_EXISTS ? 50 + logoSize + 12 : 50;
    if (LOGO_EXISTS) {
      try {
        doc.image(LOGO_PATH, 50, 48, { width: logoSize, height: logoSize });
      } catch {
        // If the image can't be embedded for any reason, fall back to text-only header.
      }
    }
    drawCompanyHeaderName(doc, companyDisplayName(settings), textX, 50, 350 - textX - 10, accent);
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    let y = 78;
    if (settings.hotelAddress) { doc.text(settings.hotelAddress, textX, y); y += 13; }
    if (settings.hotelPhone) { doc.text(`Tel: ${settings.hotelPhone}`, textX, y); y += 13; }
    if (settings.hotelEmail) { doc.text(settings.hotelEmail, textX, y); y += 13; }

    // ---- Doc title box (right) ----
    const title = payload.docType === "invoice" ? "INVOICE" : payload.docType === "receipt" ? "RECEIPT" : "CREDIT NOTE";
    const docPrefix = payload.docType === "invoice" ? "INV" : payload.docType === "receipt" ? "RCT" : "CN";
    doc.fillColor(payload.docType === "credit_note" ? accent : dark).fontSize(18).font("Helvetica-Bold").text(title, 320, 50, { width: 225, align: "right" });
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    doc.text(`No: ${payload.customDocNumber ?? `${docPrefix}-${String(payload.docNumber).padStart(5, "0")}`}`, 320, 74, { width: 225, align: "right" });
    doc.text(`Date: ${payload.issueDate}`, 320, 88, { width: 225, align: "right" });
    doc.text(`Service: ${CATEGORY_LABEL[payload.category] ?? payload.category}`, 320, 102, { width: 225, align: "right" });
    if (payload.docType === "credit_note" && payload.relatedDocNumber) {
      doc.text(`Against: ${payload.relatedDocNumber}`, 320, 116, { width: 225, align: "right" });
    }

    y = Math.max(y, payload.docType === "credit_note" && payload.relatedDocNumber ? 130 : 116) + 20;

    // ---- Divider ----
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
    y += 18;

    // ---- Billed to ----
    doc.fillColor(dark).fontSize(10).font("Helvetica-Bold").text("Billed to", 50, y);
    y += 14;
    doc.fillColor(dark).fontSize(11).font("Helvetica").text(payload.recipientName || "Guest", 50, y);
    y += 14;
    if (payload.recipientEmail) {
      doc.fillColor(muted).fontSize(9).text(payload.recipientEmail, 50, y);
      y += 14;
    }

    y += 14;

    // ---- Line items table ----
    const tableTop = y;
    doc.fillColor("#ffffff").rect(50, tableTop, 495, 20).fill(accent);
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
    doc.text("Description", 58, tableTop + 6);
    doc.text("Amount (KES)", 400, tableTop + 6, { width: 137, align: "right" });
    y = tableTop + 20;

    doc.font("Helvetica").fontSize(10);
    for (const item of payload.lineItems) {
      const rowH = item.detail ? 30 : 20;
      doc.fillColor(dark).text(item.label, 58, y + 5, { width: 330 });
      if (item.detail) {
        doc.fillColor(muted).fontSize(8).text(item.detail, 58, y + 18, { width: 330 });
        doc.fontSize(10);
      }
      doc.fillColor(dark).text(fmtKES(item.amount), 400, y + 5, { width: 137, align: "right" });
      doc.moveTo(50, y + rowH).lineTo(545, y + rowH).strokeColor("#eee5d8").lineWidth(0.5).stroke();
      y += rowH;
    }

    y += 12;

    // ---- Tax breakdown (prices are tax-inclusive; shown for transparency) ----
    if (payload.taxBreakdown && payload.taxBreakdown.lines.length > 0) {
      const tb = payload.taxBreakdown;
      doc.font("Helvetica").fontSize(8).fillColor(muted).text("Tax breakdown (included in total)", 50, y);
      y += 12;
      doc.font("Helvetica").fontSize(8).fillColor(muted).text(`Pre-tax amount`, 58, y, { width: 250 });
      doc.text(fmtKES(tb.preTaxBase), 400, y, { width: 137, align: "right" });
      y += 12;
      for (const line of tb.lines) {
        doc.text(`${line.name} (${line.ratePercent}%)`, 58, y, { width: 250 });
        doc.text(fmtKES(line.amount), 400, y, { width: 137, align: "right" });
        y += 12;
      }
      doc.font("Helvetica-Bold").text(`Total tax included`, 58, y, { width: 250 });
      doc.text(fmtKES(tb.totalTax), 400, y, { width: 137, align: "right" });
      y += 16;
    }

    // ---- Totals ----
    const totalsX = 350;
    if (payload.docType === "credit_note") {
      doc.font("Helvetica").fontSize(10).fillColor(muted);
      doc.text("Credit amount", totalsX, y, { width: 90 });
      doc.fillColor(accent).font("Helvetica-Bold").text(fmtKES(payload.totalAmount), totalsX + 90, y, { width: 105, align: "right" });
      y += 16;
      if (payload.reason) {
        doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Reason: ${payload.reason}`, 50, y, { width: 495 });
        y += 16;
      }
      doc.moveTo(totalsX, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
      y += 8;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(payload.balance > 0 ? "#a3402a" : "#2f7a4f");
      doc.text("New balance", totalsX, y, { width: 90 });
      doc.fontSize(11).text(fmtKES(Math.max(0, payload.balance)), totalsX + 90, y - 1, { width: 105, align: "right" });
      y += 30;
    } else {
      doc.font("Helvetica").fontSize(10).fillColor(muted);
      doc.text("Total", totalsX, y, { width: 90 });
      doc.fillColor(dark).font("Helvetica-Bold").text(fmtKES(payload.totalAmount), totalsX + 90, y, { width: 105, align: "right" });
      y += 16;

      doc.font("Helvetica").fillColor(muted).text("Amount paid", totalsX, y, { width: 90 });
      doc.fillColor(dark).font("Helvetica-Bold").text(fmtKES(payload.amountPaid), totalsX + 90, y, { width: 105, align: "right" });
      y += 16;

      if (payload.docType === "receipt" && payload.paymentAmount) {
        doc.font("Helvetica").fillColor(muted).text("This payment", totalsX, y, { width: 90 });
        doc.fillColor(accent).font("Helvetica-Bold").text(fmtKES(payload.paymentAmount), totalsX + 90, y, { width: 105, align: "right" });
        y += 16;
      }
      if (payload.paymentMethod) {
        doc.font("Helvetica").fillColor(muted).fontSize(9).text(`Method: ${payload.paymentMethod}`, totalsX, y, { width: 195, align: "right" });
        y += 14;
      }
      if (payload.paymentReference) {
        doc.font("Helvetica").fillColor(muted).fontSize(9).text(`Reference: ${payload.paymentReference}`, totalsX, y, { width: 195, align: "right" });
        y += 14;
      }

      doc.moveTo(totalsX, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
      y += 8;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(payload.balance > 0 ? "#a3402a" : "#2f7a4f");
      doc.text(payload.balance > 0 ? "Balance due" : "Balance", totalsX, y, { width: 90 });
      doc.text(fmtKES(Math.max(0, payload.balance)), totalsX + 90, y, { width: 105, align: "right" });
      y += 30;
    }

    if (payload.notes) {
      doc.font("Helvetica").fontSize(9).fillColor(muted).text(payload.notes, 50, y, { width: 495 });
      y += 20;
    }

    // ---- Footer ----
    doc.font("Helvetica").fontSize(8).fillColor(muted)
      .text(`Thank you for choosing ${companyDisplayName(settings)}.`, 50, 760, { width: 495, align: "center" });

    doc.end();
  });
}

export interface PayslipPdfPayload {
  runNumber: string;
  periodLabel: string; // e.g. "September 2026"
  staffName: string;
  staffRole: string;
  staffDepartment: string;
  employmentType: string; // "permanent" | "temporary"
  daysOrHours: number;
  nationalId?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  grossPay: number;
  payeAmount: number;
  nssfEmployeeAmount: number;
  shifAmount: number;
  housingLevyEmployeeAmount: number;
  totalDeductions: number;
  netPay: number;
  nssfEmployerAmount: number;
  housingLevyEmployerAmount: number;
}

// Payslips are deliberately NOT built on DocPayload/issueDocument — payroll data is
// sensitive and bypasses the generic documents/public-token system entirely. This PDF is
// generated on demand and emailed as a direct attachment (see server/payroll-pdf-email.ts).
export function buildPayslipPdf(settings: Settings, p: PayslipPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const accent = "#b5502f";
    const dark = "#2a2118";
    const muted = "#6b6157";

    const logoSize = 46;
    const textX = LOGO_EXISTS ? 50 + logoSize + 12 : 50;
    if (LOGO_EXISTS) {
      try {
        doc.image(LOGO_PATH, 50, 48, { width: logoSize, height: logoSize });
      } catch {
        // fall back to text-only header
      }
    }
    drawCompanyHeaderName(doc, companyDisplayName(settings), textX, 50, 320 - textX - 10, accent);
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    let y = 78;
    if (settings.hotelAddress) { doc.text(settings.hotelAddress, textX, y); y += 13; }
    if (settings.hotelPhone) { doc.text(`Tel: ${settings.hotelPhone}`, textX, y); y += 13; }

    doc.fillColor(dark).fontSize(18).font("Helvetica-Bold").text("PAYSLIP", 320, 50, { width: 225, align: "right" });
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    doc.text(`Run: ${p.runNumber}`, 320, 74, { width: 225, align: "right" });
    doc.text(`Period: ${p.periodLabel}`, 320, 88, { width: 225, align: "right" });

    y = Math.max(y, 116) + 20;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
    y += 18;

    // ---- Employee details ----
    doc.fillColor(dark).fontSize(10).font("Helvetica-Bold").text("Employee", 50, y);
    y += 14;
    doc.fillColor(dark).fontSize(12).font("Helvetica-Bold").text(p.staffName, 50, y);
    y += 16;
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    doc.text(`${p.staffRole}${p.staffDepartment ? ` \u2014 ${p.staffDepartment}` : ""}`, 50, y);
    y += 13;
    doc.text(`Employment type: ${p.employmentType === "temporary" ? "Temporary" : "Permanent"}`, 50, y);
    y += 13;
    if (p.employmentType === "temporary") {
      doc.text(`Days/hours worked: ${p.daysOrHours}`, 50, y);
      y += 13;
    }
    if (p.nationalId) { doc.text(`National ID: ${p.nationalId}`, 50, y); y += 13; }
    if (p.bankName || p.bankAccountNumber) {
      doc.text(`Bank: ${p.bankName ?? "\u2014"}  Acc: ${p.bankAccountNumber ?? "\u2014"}`, 50, y);
      y += 13;
    }

    y += 12;

    // ---- Earnings & deductions table ----
    const tableTop = y;
    doc.fillColor("#ffffff").rect(50, tableTop, 495, 20).fill(accent);
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
    doc.text("Description", 58, tableTop + 6);
    doc.text("Amount (KES)", 400, tableTop + 6, { width: 137, align: "right" });
    y = tableTop + 20;

    const row = (label: string, amount: number, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(dark).text(label, 58, y + 5, { width: 330 });
      doc.text(fmtKES(amount), 400, y + 5, { width: 137, align: "right" });
      doc.moveTo(50, y + 20).lineTo(545, y + 20).strokeColor("#eee5d8").lineWidth(0.5).stroke();
      y += 20;
    };

    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("Earnings", 58, y + 4);
    y += 18;
    row("Gross pay", p.grossPay, true);

    y += 8;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("Statutory deductions", 58, y + 4);
    y += 18;
    row("PAYE", p.payeAmount);
    row("NSSF (employee)", p.nssfEmployeeAmount);
    row("SHIF", p.shifAmount);
    row("Affordable Housing Levy (employee)", p.housingLevyEmployeeAmount);
    row("Total deductions", p.totalDeductions, true);

    y += 16;
    doc.moveTo(350, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
    y += 8;
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#2f7a4f");
    doc.text("NET PAY", 350, y, { width: 90 });
    doc.text(fmtKES(p.netPay), 440, y, { width: 97, align: "right" });
    y += 30;

    // ---- Employer contributions (informational, not deducted from employee) ----
    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("Employer contributions (for your information \u2014 not deducted from net pay)", 50, y, { width: 495 });
    y += 14;
    doc.font("Helvetica").fontSize(9).fillColor(muted);
    doc.text(`NSSF (employer): ${fmtKES(p.nssfEmployerAmount)}`, 50, y, { width: 240 });
    doc.text(`AHL (employer): ${fmtKES(p.housingLevyEmployerAmount)}`, 300, y, { width: 245 });
    y += 30;

    doc.font("Helvetica").fontSize(8).fillColor(muted)
      .text(`This payslip is confidential and intended solely for ${p.staffName}. Issued by ${companyDisplayName(settings)}.`, 50, 760, { width: 495, align: "center" });

    doc.end();
  });
}

const MAINT_PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const MAINT_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

// Lightweight, non-billing report for a maintenance issue (deliberately kept separate from
// buildDocumentPdf/DocPayload, which is billing-specific — an issue has no amount/tax concept).
export function buildMaintenanceReportPdf(settings: Settings, issue: MaintenanceIssue): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const accent = "#b5502f";
    const dark = "#2a2118";
    const muted = "#6b6157";

    const logoSize = 46;
    const textX = LOGO_EXISTS ? 50 + logoSize + 12 : 50;
    if (LOGO_EXISTS) {
      try {
        doc.image(LOGO_PATH, 50, 48, { width: logoSize, height: logoSize });
      } catch {
        // fall back to text-only header
      }
    }
    drawCompanyHeaderName(doc, companyDisplayName(settings), textX, 50, 320 - textX - 10, accent);
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    let y = 78;
    if (settings.hotelAddress) { doc.text(settings.hotelAddress, textX, y); y += 13; }
    if (settings.hotelPhone) { doc.text(`Tel: ${settings.hotelPhone}`, textX, y); y += 13; }
    if (settings.hotelEmail) { doc.text(settings.hotelEmail, textX, y); y += 13; }

    doc.fillColor(dark).fontSize(18).font("Helvetica-Bold").text("MAINTENANCE REPORT", 320, 50, { width: 225, align: "right" });
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    doc.text(`Ref: MNT-${String(issue.id).padStart(5, "0")}`, 320, 74, { width: 225, align: "right" });
    doc.text(`Reported: ${new Date(issue.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`, 320, 88, { width: 225, align: "right" });
    doc.text(`Category: ${issue.category}`, 320, 102, { width: 225, align: "right" });

    y = Math.max(y, 116) + 20;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
    y += 18;

    doc.fillColor(dark).fontSize(14).font("Helvetica-Bold").text(issue.title, 50, y, { width: 495 });
    y += 24;

    const row = (label: string, value: string | null | undefined) => {
      if (!value) return;
      doc.fillColor(muted).fontSize(9).font("Helvetica-Bold").text(label, 50, y, { width: 110 });
      doc.fillColor(dark).fontSize(10).font("Helvetica").text(value, 165, y, { width: 380 });
      y += 18;
    };

    row("Location", issue.location);
    row("Priority", MAINT_PRIORITY_LABEL[issue.priority] ?? issue.priority);
    row("Status", MAINT_STATUS_LABEL[issue.status] ?? issue.status);
    row("Reported by", issue.reportedBy);
    row("Contact phone", issue.reportedPhone);
    row("Assigned to", issue.assignedTo);
    if (issue.resolvedAt) row("Resolved", new Date(issue.resolvedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }));
    if (issue.closedAt) row("Closed", new Date(issue.closedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }));
    row("Closed by", issue.closedBy);

    y += 8;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#d9d0c4").lineWidth(1).stroke();
    y += 16;

    if (issue.description) {
      doc.fillColor(dark).fontSize(10).font("Helvetica-Bold").text("Description", 50, y);
      y += 14;
      doc.fillColor(dark).fontSize(10).font("Helvetica").text(issue.description, 50, y, { width: 495 });
      y += doc.heightOfString(issue.description, { width: 495 }) + 16;
    }

    if (issue.notes) {
      doc.fillColor(dark).fontSize(10).font("Helvetica-Bold").text("Notes", 50, y);
      y += 14;
      doc.fillColor(dark).fontSize(10).font("Helvetica").text(issue.notes, 50, y, { width: 495 });
      y += doc.heightOfString(issue.notes, { width: 495 }) + 16;
    }

    doc.font("Helvetica").fontSize(8).fillColor(muted)
      .text(`${companyDisplayName(settings)} — Maintenance & Facilities`, 50, 760, { width: 495, align: "center" });

    doc.end();
  });
}
