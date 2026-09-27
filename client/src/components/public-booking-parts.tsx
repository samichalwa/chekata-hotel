// Shared building blocks for the public booking page (#/book).
import { useMemo } from "react";
import { CheckCircle2, Smartphone, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatKES } from "@/lib/format";
import { parseMpesaMessage } from "@shared/mpesa";

export interface Info {
  hotelName: string; hotelPhone: string | null; hotelEmail: string | null;
  movieEnabled: boolean; tableEnabled: boolean; roomEnabled: boolean;
  roomPayPercent: number; roomMaxNights: number; roomAdvanceDays: number; roomCheckInTime: string; roomCheckOutTime: string; roomMaxGuests: number;
  mpesa: { type: "till" | "paybill" | "phone"; number: string | null; accountNumber: string | null; businessName: string };
  tableDeposit: number; tableMaxParty: number; tableOpenTime: string; tableCloseTime: string;
  movieMaxSeats: number; note: string | null; seatRows: string[]; seatNumbers: number[]; today: string;
}
export interface PublicShow { id: number; name: string; showDate: string; startTime: string; endTime: string | null; ticketPrice: number; notes: string | null; takenSeats: string[]; totalSeats: number }
export interface Result { ref: string; status: string; summary: string; amount: number; mpesaCode: string | null }

export async function publicApi<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: "omit" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "Something went wrong. Please try again.");
  return data as T;
}

export const niceDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function PayInstructions({ info, amount }: { info: Info; amount: number }) {
  const m = info.mpesa;
  const path = m.type === "paybill" ? "Lipa na M-PESA → Pay Bill" : m.type === "till" ? "Lipa na M-PESA → Buy Goods and Services" : "Send Money";
  const numLabel = m.type === "paybill" ? "Business number" : m.type === "till" ? "Till number" : "Phone number";
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm space-y-2" data-testid="box-pay-instructions">
      <p className="font-medium flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" /> Pay {formatKES(amount)} by M-Pesa</p>
      {m.number ? (
        <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
          <li>Open M-PESA → {path}.</li>
          <li>{numLabel}: <span className="font-semibold text-foreground tabular-nums">{m.number}</span></li>
          {m.type === "paybill" && <li>Account number: <span className="font-semibold text-foreground">{m.accountNumber || "your mobile number"}</span></li>}
          <li>Amount: <span className="font-semibold text-foreground tabular-nums">{formatKES(amount)}</span>, paid to <span className="font-semibold text-foreground">{m.businessName}</span>.</li>
          <li>Copy the whole confirmation SMS from M-PESA and paste it below.</li>
        </ol>
      ) : (
        <p className="text-muted-foreground">Please contact reception{info.hotelPhone ? ` on ${info.hotelPhone}` : ""} for M-Pesa payment details.</p>
      )}
    </div>
  );
}

export function MpesaPaste({ value, onChange, amountDue }: { value: string; onChange: (v: string) => void; amountDue: number }) {
  const p = useMemo(() => parseMpesaMessage(value), [value]);
  const short = p.amount != null && p.amount + 0.5 < amountDue;
  return (
    <div className="space-y-2">
      <Label htmlFor="mpesa-message">M-Pesa confirmation message</Label>
      <Textarea id="mpesa-message" rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. SJR7AB12CD Confirmed. Ksh1,000.00 paid to THE CHEKATA. on 27/9/26 at 10:15 AM…" data-testid="input-mpesa-message" />
      {value.trim() && (
        <div className="rounded-md border border-border p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1" data-testid="box-mpesa-preview">
          <span className="text-muted-foreground">Transaction code</span><span className="text-right font-medium">{p.code ?? "—"}</span>
          <span className="text-muted-foreground">Amount</span><span className={`text-right font-medium tabular-nums ${short ? "text-destructive" : ""}`}>{p.amount != null ? formatKES(p.amount) : "—"}</span>
          <span className="text-muted-foreground">Paid to</span><span className="text-right">{p.recipient ?? "—"}</span>
          <span className="text-muted-foreground">Date</span><span className="text-right tabular-nums">{p.paidAtText ?? "—"}</span>
          {(!p.code || p.amount == null) && <p className="col-span-2 text-destructive flex items-center gap-1 pt-1"><AlertCircle className="h-4 w-4 shrink-0" /> We can't read this message yet. Paste the full M-PESA SMS.</p>}
          {short && <p className="col-span-2 text-destructive flex items-center gap-1 pt-1"><AlertCircle className="h-4 w-4 shrink-0" /> {formatKES(amountDue)} is due.</p>}
        </div>
      )}
    </div>
  );
}

export function mpesaReady(msg: string, due: number) {
  const p = parseMpesaMessage(msg);
  return !!p.code && p.amount != null && p.amount + 0.5 >= due;
}

export type Guest = { name: string; phone: string; email: string };
export function GuestFields({ g, set }: { g: Guest; set: (k: keyof Guest, v: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="g-name">Full name</Label><Input id="g-name" value={g.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" data-testid="input-guest-name" /></div>
      <div className="space-y-1.5"><Label htmlFor="g-phone">Mobile number</Label><Input id="g-phone" inputMode="tel" value={g.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0712 345 678" autoComplete="tel" data-testid="input-guest-phone" /></div>
      <div className="space-y-1.5"><Label htmlFor="g-email">Email (optional)</Label><Input id="g-email" type="email" value={g.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" data-testid="input-guest-email" /></div>
    </div>
  );
}

export function Done({ r, onAgain }: { r: Result; onAgain: () => void }) {
  return (
    <Card className="p-6 space-y-3 text-center" data-testid="card-booking-done">
      <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
      <h2 className="text-lg font-semibold">Booking received</h2>
      <p className="text-sm text-muted-foreground">{r.summary}</p>
      <p className="text-sm">Reference <span className="font-semibold tabular-nums" data-testid="text-booking-ref">{r.ref}</span>{r.mpesaCode ? <> · M-Pesa {r.mpesaCode}</> : null}</p>
      <p className="text-sm text-muted-foreground">Our office is verifying your payment. You'll get an SMS once it's confirmed. Keep your reference to check the status below.</p>
      <Button variant="outline" onClick={onAgain} data-testid="button-book-again">Make another booking</Button>
    </Card>
  );
}

export function SeatMap({ info, show, selected, toggle }: { info: Info; show: PublicShow; selected: string[]; toggle: (k: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="mx-auto h-2 w-4/5 rounded-full bg-primary/70" aria-hidden />
      <p className="text-center text-xs uppercase tracking-wider text-muted-foreground">Screen</p>
      <div className="mx-auto grid w-fit gap-1.5" aria-label="Seat map">
        {info.seatRows.map((row) => (
          <div key={row} className="flex items-center gap-1.5">
            <span className="w-4 text-xs text-muted-foreground">{row}</span>
            {info.seatNumbers.map((n) => {
              const k = `${row}${n}`;
              const taken = show.takenSeats.includes(k);
              const on = selected.includes(k);
              return (
                <button key={k} type="button" disabled={taken} onClick={() => toggle(k)} aria-pressed={on} aria-label={`Seat ${k}${taken ? " (taken)" : ""}`}
                  className={`h-9 w-9 rounded-md border text-xs font-medium transition-colors ${taken ? "cursor-not-allowed border-border bg-muted text-muted-foreground/50 line-through" : on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary"}`}
                  data-testid={`seat-${k}`}>{n}</button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-border bg-background" /> Free</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-primary" /> Selected</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-muted" /> Taken</span>
      </div>
    </div>
  );
}
