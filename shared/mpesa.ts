// Reads the details out of a pasted M-Pesa confirmation SMS. Used on the
// public booking page (live preview while the guest pastes) and on the server
// (the authoritative check before seats/tables are held).
//
// Typical customer-side messages:
//   "SJR7AB12CD Confirmed. Ksh1,000.00 paid to THE CHEKATA. on 27/9/26 at 10:15 AM.New M-PESA balance is Ksh2,340.00. Transaction cost, Ksh0.00."
//   "SJR7AB12CD Confirmed. Ksh1,000.00 sent to THE CHEKATA for account MOV123 on 27/9/26 at 10:15 AM New M-PESA balance is ..."
//   "SJR7AB12CD Confirmed. Ksh500.00 sent to JOHN DOE 0712345678 on 27/9/26 at 10:15 AM. New M-PESA balance ..."
// Typical business-side (office) message:
//   "SJR7AB12CD Confirmed. Ksh1,000.00 received from JANE WANJIKU 254712345678 on 27/9/26 at 10:15 AM ..."

export interface ParsedMpesa {
  code: string | null;
  amount: number | null;
  direction: "sent" | "received" | null;
  recipient: string | null; // who was paid (customer-side messages)
  account: string | null; // paybill account number, if any
  counterpartyName: string | null; // payer (received) or payee person (sent)
  counterpartyPhone: string | null;
  paidAt: number | null; // epoch ms (message time is Kenya local time, UTC+3)
  paidAtText: string | null;
}

const CODE_RE = /\b([A-Z0-9]{10})\b(?=\s*(?:Confirmed|confirmed|CONFIRMED))/;
const CODE_FALLBACK_RE = /^\s*([A-Z0-9]{10})\b/;
// "Ksh1,000.00", "Ksh 1,000", "Kshs.1,000", "KES 1,000.00"
const AMOUNT_RE = /(?:Kshs?\.?|KES)\s?([\d,]+(?:\.\d{1,2})?)/i;
// "on 27/9/26 at 10:15 AM", "on 27-09-2026 at 22:15", "on 27/9/26 at 10:15AM"
const DATE_RE = /\bon\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*([AP]\.?M\.?)?/i;

export function parseMpesaMessage(raw: string): ParsedMpesa {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  const out: ParsedMpesa = {
    code: null, amount: null, direction: null, recipient: null, account: null,
    counterpartyName: null, counterpartyPhone: null, paidAt: null, paidAtText: null,
  };
  if (!text) return out;

  const upper = text.toUpperCase();
  const codeMatch = upper.match(CODE_RE) ?? upper.match(CODE_FALLBACK_RE);
  // A real code mixes letters and digits; reject all-letter words like "CONFIRMED".
  if (codeMatch && /\d/.test(codeMatch[1]) && /[A-Z]/.test(codeMatch[1])) out.code = codeMatch[1];

  const amt = text.match(AMOUNT_RE);
  if (amt) {
    const n = Number(amt[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.amount = n;
  }

  const d = text.match(DATE_RE);
  if (d) {
    let [, dd, mm, yy, hh, mi, ap] = d;
    let year = Number(yy);
    if (year < 100) year += 2000;
    let hour = Number(hh);
    if (ap) {
      const pm = ap.toUpperCase().startsWith("P");
      if (pm && hour < 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    }
    const ms = Date.UTC(year, Number(mm) - 1, Number(dd), hour - 3, Number(mi));
    if (Number.isFinite(ms)) {
      out.paidAt = ms;
      out.paidAtText = `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${year} ${String(hour).padStart(2, "0")}:${mi}`;
    }
  }

  const received = text.match(/received\s+(?:Ksh\s?[\d,]+(?:\.\d{1,2})?\s+)?from\s+(.+?)(?:\s+(\+?\d[\d\s]{8,13}\d))?\s+on\s+\d/i);
  if (received) {
    out.direction = "received";
    out.counterpartyName = received[1].replace(/[.,]+$/, "").trim();
    out.counterpartyPhone = received[2]?.replace(/\s/g, "") ?? null;
    return out;
  }

  const paid = text.match(/(?:paid to|sent to)\s+(.+?)(?:\s+for account\s+(\S+?))?(?:\.|\s)+on\s+\d/i)
    // "You have paid Ksh… to X on …" style
    ?? text.match(/paid\s+(?:Kshs?\.?|KES)\s?[\d,]+(?:\.\d{1,2})?\s+to\s+(.+?)(?:\s+for account\s+(\S+?))?(?:\.|\s)+on\s+\d/i);
  if (paid) {
    out.direction = "sent";
    let who = paid[1].trim();
    const phone = who.match(/\s(\+?\d[\d\s]{8,13}\d)$/);
    if (phone) {
      out.counterpartyPhone = phone[1].replace(/\s/g, "");
      who = who.slice(0, phone.index).trim();
    }
    out.recipient = who.replace(/[.,]+$/, "").trim();
    out.counterpartyName = out.recipient;
    out.account = paid[2]?.replace(/[.,]+$/, "") ?? null;
  }
  return out;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** True when the M-Pesa recipient looks like the configured business name / number. */
export function recipientMatches(parsed: ParsedMpesa, businessName?: string | null, number?: string | null): boolean {
  const who = norm(`${parsed.recipient ?? ""} ${parsed.counterpartyPhone ?? ""}`);
  if (!who) return false;
  const name = norm(businessName ?? "");
  if (name && (who.includes(name) || name.includes(norm(parsed.recipient ?? "")) && norm(parsed.recipient ?? "").length >= 4)) return true;
  const num = norm(number ?? "").replace(/^254/, "0");
  const phone = norm(parsed.counterpartyPhone ?? "").replace(/^254/, "0");
  if (num && phone && (phone === num || phone.endsWith(num.slice(-9)))) return true;
  return false;
}

export const MPESA_CODE_RE = /^[A-Z0-9]{10}$/;

/** The details a guest's M-Pesa message must contain before a booking can be submitted. */
export const REQUIRED_MPESA_FIELDS = ["code", "amount", "recipient", "paidAt"] as const;
export type RequiredMpesaField = (typeof REQUIRED_MPESA_FIELDS)[number];
export const MPESA_FIELD_LABELS: Record<RequiredMpesaField, string> = {
  code: "Transaction code", amount: "Amount paid", recipient: "Paid to", paidAt: "Date & time",
};
/** Required fields that could not be read from the message. */
export function missingMpesaFields(p: ParsedMpesa): RequiredMpesaField[] {
  return REQUIRED_MPESA_FIELDS.filter((k) => p[k] == null || p[k] === "");
}
