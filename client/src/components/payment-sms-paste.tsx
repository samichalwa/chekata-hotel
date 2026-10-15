// Staff-side "paste the payment SMS" box. Reads an M-Pesa confirmation or a bank credit alert
// ("We have received a credit of KES 1500.00 from … MPESA Ref …") and hands the details to the form,
// which fills in the amount, M-Pesa code, date, method and (when the account number matches) the bank.
import { useMemo } from "react";
import { ClipboardPaste, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseMpesaMessage, type ParsedMpesa } from "@shared/mpesa";
import { formatKES } from "@/lib/format";

export interface PaymentSmsDetails {
  code: string | null;
  amount: number | null;
  paidOn: string | null; // YYYY-MM-DD, Kenya time
  payerName: string | null;
  payerPhone: string | null;
  account: string | null;
  parsed: ParsedMpesa;
}

/** YYYY-MM-DD in Kenya time (UTC+3) for an epoch-ms instant. */
const kenyaDay = (ms: number) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

export function readPaymentSms(text: string): PaymentSmsDetails {
  const p = parseMpesaMessage(text);
  const payer = p.direction === "received" ? p.counterpartyName : null;
  return {
    code: p.code, amount: p.amount, paidOn: p.paidAt ? kenyaDay(p.paidAt) : null,
    payerName: payer, payerPhone: p.direction === "received" ? p.counterpartyPhone : null, account: p.account, parsed: p,
  };
}

/** The bank/cash account whose number ends with the digits shown in the SMS (e.g. "***9914"), if exactly one does. */
export function bankFromSmsAccount<T extends { id: number; accountNumber?: string | null }>(banks: T[], account: string | null): T | null {
  const tail = (account ?? "").replace(/\D/g, "");
  if (tail.length < 3) return null;
  const hits = banks.filter((b) => (b.accountNumber ?? "").replace(/\D/g, "").endsWith(tail.slice(-4)));
  return hits.length === 1 ? hits[0] : null;
}

export function PaymentSmsPaste({ value, onChange, onRead, testId = "payment-sms" }: {
  value: string; onChange: (v: string) => void; onRead: (d: PaymentSmsDetails) => void; testId?: string;
}) {
  const d = useMemo(() => readPaymentSms(value), [value]);
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
  const take = (t: string) => { onChange(t); const r = readPaymentSms(t); if (r.code || r.amount) onRead(r); };
  const fromClipboard = async () => { try { const t = await navigator.clipboard.readText(); if (t) take(t); } catch { /* permission refused: long-press and paste instead */ } };
  const found = [
    d.code && `Code ${d.code}`,
    d.amount != null && formatKES(d.amount),
    d.parsed.paidAtText && d.parsed.paidAtText,
    d.payerName && `from ${d.payerName}`,
    d.account && `account ${d.account}`,
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-3">
      <div className="flex items-end justify-between gap-2">
        <Label htmlFor={`${testId}-text`}>Paste payment SMS</Label>
        {canPaste && <Button type="button" variant="outline" size="sm" onClick={fromClipboard} data-testid={`button-${testId}-paste`}><ClipboardPaste className="h-4 w-4 mr-1" />Paste</Button>}
      </div>
      <Textarea id={`${testId}-text`} rows={3} value={value} onChange={(e) => take(e.target.value)}
        placeholder="e.g. Dear THE CHEKATA HOTEL, We have received a credit of KES 1500.00 from … MPESA Ref UJCHE9UDY6"
        data-testid={`input-${testId}`} />
      {value.trim() ? (
        found.length && d.code && d.amount != null ? (
          <p className="text-xs flex items-start gap-1" data-testid={`text-${testId}-read`}><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />Filled in: {found.join(" · ")}. Check the fields below before saving.</p>
        ) : (
          <p className="text-xs text-destructive flex items-start gap-1" data-testid={`text-${testId}-missing`}><AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{found.length ? `Read: ${found.join(" · ")}. ` : ""}Couldn't find the {[!d.code && "M-Pesa code", d.amount == null && "amount"].filter(Boolean).join(" or ")}. Paste the full, unedited SMS or type the details below.</p>
        )
      ) : <p className="text-xs text-muted-foreground">Paste the M-Pesa or bank alert SMS: the amount, M-Pesa code and date are filled in for you.</p>}
    </div>
  );
}
