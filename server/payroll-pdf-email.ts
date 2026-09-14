import type { IStorage } from "./storage";
import { buildPayslipPdf } from "./pdf";
import { sendTransactionalEmail } from "./email";
import type { PayrollRun, PayrollLine, Staff, Settings } from "@shared/schema";

// Payslips are deliberately kept OUT of the generic documents/public-token/WhatsApp
// system used everywhere else in the app — payroll data is sensitive, so this flow
// only ever emails a direct PDF attachment, gated exclusively by requireModule("payroll")
// at the route layer. There is no public link and no WhatsApp button for payslips.
function periodLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split("-").map(Number);
  if (!y || !m) return periodMonth;
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", { month: "long", year: "numeric" });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function emailPayslipForLine(
  storage: IStorage,
  settings: Settings,
  run: PayrollRun,
  line: PayrollLine,
  staff: Staff | undefined,
): Promise<void> {
  if (!staff) {
    await storage.setPayslipEmailStatus(line.id, "failed", "Staff record not found");
    return;
  }
  if (!staff.email) {
    await storage.setPayslipEmailStatus(line.id, "skipped", "No email address on file for this employee.");
    return;
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await buildPayslipPdf(settings, {
      runNumber: run.runNumber,
      periodLabel: periodLabel(run.periodMonth),
      staffName: staff.name,
      staffRole: staff.role,
      staffDepartment: staff.department,
      employmentType: line.employmentType,
      daysOrHours: line.daysOrHours,
      nationalId: staff.nationalId,
      bankName: line.bankName,
      bankAccountNumber: line.bankAccountNumber,
      grossPay: line.grossPay,
      payeAmount: line.payeAmount,
      nssfEmployeeAmount: line.nssfEmployeeAmount,
      shifAmount: line.shifAmount,
      housingLevyEmployeeAmount: line.housingLevyEmployeeAmount,
      totalDeductions: line.totalDeductions,
      netPay: line.netPay,
      nssfEmployerAmount: line.nssfEmployerAmount,
      housingLevyEmployerAmount: line.housingLevyEmployerAmount,
    });
  } catch (e: any) {
    await storage.setPayslipEmailStatus(line.id, "failed", `PDF generation failed: ${e?.message || e}`);
    return;
  }

  const hotelName = settings.hotelName || "The Chekata";
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2a2118;line-height:1.5;">
      <p>Dear ${escapeHtml(staff.name)},</p>
      <p>Please find attached your payslip for <strong>${escapeHtml(periodLabel(run.periodMonth))}</strong> from ${escapeHtml(hotelName)}.</p>
      <p><strong>Net pay:</strong> KES ${Math.round(line.netPay).toLocaleString("en-KE")}</p>
      <p>This payslip is confidential and intended solely for you. If you have any questions, please contact HR.</p>
      <p>${escapeHtml(hotelName)}</p>
    </div>`;

  const result = await sendTransactionalEmail({
    settings,
    to: staff.email,
    toName: staff.name,
    subject: `Payslip \u2014 ${periodLabel(run.periodMonth)} \u2014 ${hotelName}`,
    html,
    attachment: { filename: `Payslip-${run.runNumber}-${staff.name.replace(/\s+/g, "_")}.pdf`, content: pdfBuffer },
  });

  await storage.setPayslipEmailStatus(line.id, result.ok ? "sent" : "failed", result.ok ? undefined : result.error);
}

export interface PayslipEmailSummary {
  sent: number;
  skipped: number;
  failed: number;
  total: number;
}

export async function emailPayslipsForRun(storage: IStorage, settings: Settings, run: PayrollRun): Promise<PayslipEmailSummary> {
  const lines = await storage.listPayrollLines(run.id);
  const summary: PayslipEmailSummary = { sent: 0, skipped: 0, failed: 0, total: lines.length };
  for (const line of lines) {
    const staff = await storage.getStaff(line.staffId);
    await emailPayslipForLine(storage, settings, run, line, staff);
  }
  // Re-read the lines so the summary reflects the status actually persisted
  // (emailPayslipForLine writes status via storage, not a return value).
  const updatedLines = await storage.listPayrollLines(run.id);
  for (const line of updatedLines) {
    if (line.payslipEmailStatus === "sent") summary.sent++;
    else if (line.payslipEmailStatus === "skipped") summary.skipped++;
    else summary.failed++;
  }
  return summary;
}
