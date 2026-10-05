// Settings → Receipts to Finance. Every receipt (and every invoice issued with a payment already
// on it) can post a journal automatically: Dr the cash/bank account for how the guest paid,
// Cr the income account for that revenue stream. All accounts are chosen in Settings.
export const RECEIPT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "mpesa", label: "M-Pesa (Paybill / Till)" },
  { key: "card", label: "Card" },
  { key: "bank_transfer", label: "Bank transfer" },
] as const;
export const RECEIPT_CATEGORIES = [
  { key: "accommodation", label: "Accommodation" },
  { key: "facility", label: "Conference & facilities" },
  { key: "movie", label: "Movie room" },
  { key: "bar", label: "Bar" },
  { key: "restaurant", label: "Restaurant" },
  { key: "water", label: "Water sales" },
  { key: "tenancy", label: "Shop rent & electricity" },
] as const;

export interface ReceiptPostingConfig {
  enabled: boolean;
  /** payment method → bank_accounts.id (the cash / bank account the money lands in) */
  accounts: Partial<Record<string, number | null>>;
  /** receipt category → chart_of_accounts.id (income account); "default" is used when a stream has none */
  income: Partial<Record<string, number | null>>;
  /** receipts issued before this date (YYYY-MM-DD) are never auto-posted */
  startDate?: string | null;
}

export function parseReceiptPosting(raw: string | null | undefined): ReceiptPostingConfig {
  try {
    const j = raw ? JSON.parse(raw) : {};
    return { enabled: !!j.enabled, accounts: j.accounts ?? {}, income: j.income ?? {}, startDate: j.startDate ?? null };
  } catch {
    return { enabled: false, accounts: {}, income: {}, startDate: null };
  }
}

export function normalizeMethod(m: unknown): string {
  const k = String(m ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (k === "m_pesa" || k === "mpesa") return "mpesa";
  if (k === "bank" || k === "bank_transfer" || k === "eft" || k === "rtgs") return "bank_transfer";
  if (k === "cash" || k === "card") return k;
  return "";
}
