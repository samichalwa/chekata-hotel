import type { IStorage } from "./storage";
import { issueDocument } from "./documents";
import { sendSms } from "./sms";
import { sendTransactionalEmail } from "./email";

function currentPeriodMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface BillingCycleResult {
  invoicesCreated: number;
  invoicesSkipped: number;
  invoiceErrors: { leaseId: number; error: string }[];
  remindersSent: number;
  reminderErrors: { invoiceId: number; error: string }[];
}

// Idempotent — safe to run repeatedly (hourly/daily and once at boot). For every
// active lease it ensures the current period's rent invoice exists (creating +
// emailing it once), then sends reminder SMS/email for any unpaid invoice that
// has crossed its lease's configured reminder window and hasn't been reminded yet.
export async function runTenantBillingCycle(storage: IStorage, createdBy = "system"): Promise<BillingCycleResult> {
  const result: BillingCycleResult = {
    invoicesCreated: 0,
    invoicesSkipped: 0,
    invoiceErrors: [],
    remindersSent: 0,
    reminderErrors: [],
  };

  const periodMonth = currentPeriodMonth();
  const leases = await storage.listTenancyLeases();
  const activeLeases = leases.filter((l) => l.status === "active");

  for (const lease of activeLeases) {
    try {
      const existing = await storage.getRentInvoiceForPeriod(lease.id, periodMonth);
      if (existing) {
        result.invoicesSkipped++;
        continue;
      }
      const invoice = await storage.createRentInvoiceForPeriod(lease.id, periodMonth, createdBy);
      result.invoicesCreated++;

      const tenant = await storage.getTenant(lease.tenantId);
      const shop = await storage.getShop(lease.shopId);
      const lineItems = [
        { label: `Shop ${shop?.shopNumber ?? lease.shopId} rent — ${periodMonth}`, amount: invoice.rentAmount },
        ...(invoice.electricityAmount > 0
          ? [{ label: "Electricity", detail: `${periodMonth} consumption`, amount: invoice.electricityAmount }]
          : []),
      ];
      await issueDocument(storage, {
        docType: "invoice",
        category: "tenancy",
        sourceId: invoice.id,
        customDocNumber: invoice.invoiceNumber,
        recipientName: tenant?.name ?? "Tenant",
        recipientEmail: tenant?.email ?? null,
        issueDate: formatDate(),
        lineItems,
        totalAmount: invoice.totalAmount,
        amountPaid: 0,
        balance: invoice.totalAmount,
        notes: `Due ${invoice.dueDate}`,
      });
    } catch (e: any) {
      result.invoiceErrors.push({ leaseId: lease.id, error: e?.message ?? String(e) });
    }
  }

  try {
    const due = await storage.listUnpaidRentInvoicesDueForReminder();
    const settings = await storage.getSettings();
    for (const inv of due) {
      try {
        const balance = inv.totalAmount - inv.amountPaid;
        const message = `Dear ${inv.tenantName}, your rent invoice ${inv.invoiceNumber} for KES ${Math.round(balance).toLocaleString("en-KE")} is due ${inv.dueDate}. Please check your email for the invoice.`;
        if (inv.tenantPhone) {
          await sendSms({ settings, to: inv.tenantPhone, message });
        }
        if (inv.tenantEmail) {
          await sendTransactionalEmail({
            settings,
            to: inv.tenantEmail,
            toName: inv.tenantName,
            subject: `Rent invoice ${inv.invoiceNumber} due ${inv.dueDate}`,
            html: `<div style="font-family:Arial,sans-serif;color:#2a2118;line-height:1.5;">
              <p>Dear ${escapeHtml(inv.tenantName)},</p>
              <p>This is a reminder that rent invoice <strong>${escapeHtml(inv.invoiceNumber)}</strong> for
              KES ${Math.round(balance).toLocaleString("en-KE")} is due on ${escapeHtml(inv.dueDate)}.</p>
              <p>Please refer to the invoice previously emailed to you, or contact us if you need it resent.</p>
              <p>${escapeHtml(settings.hotelName || "The Chekata")}</p>
            </div>`,
          });
        }
        await storage.markRentInvoiceReminderSent(inv.id);
        result.remindersSent++;
      } catch (e: any) {
        result.reminderErrors.push({ invoiceId: inv.id, error: e?.message ?? String(e) });
      }
    }
  } catch (e: any) {
    result.reminderErrors.push({ invoiceId: -1, error: e?.message ?? String(e) });
  }

  return result;
}
