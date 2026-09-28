// Public table reservation form + booking status check (used by #/book).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, AlertCircle, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatKES } from "@/lib/format";
import { type Info, type Result, type Guest, publicApi, PayInstructions, MpesaPaste, mpesaReady, GuestFields, Done } from "@/components/public-booking-parts";

export function TableTab({ info }: { info: Info }) {
  const [f, setF] = useState({ outlet: "restaurant", date: info.today, time: "19:00", party: "2", notes: "" });
  const [g, setG] = useState<Guest>({ name: "", phone: "", email: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const deposit = info.tableDeposit;
  const submit = useMutation({
    mutationFn: () => publicApi<Result>("POST", "/api/public/table-reservations", {
      outlet: f.outlet, date: f.date, time: f.time, partySize: Number(f.party), notes: f.notes || undefined,
      guestName: g.name, guestPhone: g.phone, guestEmail: g.email || undefined, mpesaMessage: deposit > 0 ? msg : undefined,
    }),
    onSuccess: (r) => { setDone(r); setErr(null); },
    onError: (e: any) => setErr(e.message),
  });
  if (done) return <Done r={done} onAgain={() => { setDone(null); setMsg(""); }} />;
  const payOk = deposit <= 0 || (mpesaReady(msg, deposit) && !!info.mpesa.number);
  const ready = g.name.trim().length >= 2 && g.phone.trim().length >= 9 && !!f.date && !!f.time && Number(f.party) >= 1 && payOk;

  return (
    <Card className="p-4 space-y-4">
      <div className="grid gap-3 grid-cols-2">
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <Label>Where</Label>
          <Select value={f.outlet} onValueChange={(v) => setF((x) => ({ ...x, outlet: v }))}>
            <SelectTrigger data-testid="select-outlet" aria-label="Restaurant or bar"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="restaurant">Restaurant</SelectItem><SelectItem value="bar">Bar</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label htmlFor="t-party">Guests</Label><Input id="t-party" type="number" min={1} max={info.tableMaxParty} value={f.party} onChange={(e) => setF((x) => ({ ...x, party: e.target.value }))} data-testid="input-party-size" /></div>
        <div className="space-y-1.5"><Label htmlFor="t-date">Date</Label><Input id="t-date" type="date" min={info.today} value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} data-testid="input-reservation-date" /></div>
        <div className="space-y-1.5"><Label htmlFor="t-time">Time</Label><Input id="t-time" type="time" min={info.tableOpenTime} max={info.tableCloseTime} value={f.time} onChange={(e) => setF((x) => ({ ...x, time: e.target.value }))} data-testid="input-reservation-time" /></div>
        <p className="col-span-2 text-xs text-muted-foreground">Open {info.tableOpenTime}–{info.tableCloseTime}. Up to {info.tableMaxParty} guests online; call us for larger groups.</p>
        <div className="space-y-1.5 col-span-2"><Label htmlFor="t-notes">Special requests (optional)</Label><Input id="t-notes" value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} data-testid="input-reservation-notes" /></div>
      </div>
      <GuestFields g={g} set={(k, v) => setG((x) => ({ ...x, [k]: v }))} />
      {deposit > 0 && (
        <>
          <PayInstructions info={info} amount={deposit} />
          <p className="text-xs text-muted-foreground">The {formatKES(deposit)} deposit secures your table and is deducted from your bill.</p>
          <MpesaPaste value={msg} onChange={setMsg} amountDue={deposit} mpesa={info.mpesa} />
        </>
      )}
      {err && <p className="text-sm text-destructive flex items-start gap-1" data-testid="text-reservation-error"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{err}</p>}
      <Button className="w-full" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-table-reservation">
        {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Request table
      </Button>
    </Card>
  );
}

export function StatusCheck() {
  const [ref, setRef] = useState("");
  const [phone, setPhone] = useState("");
  const q = useMutation({ mutationFn: () => publicApi<{ ref: string; status: string; summary: string; note: string | null }>("GET", `/api/public/booking-status?ref=${encodeURIComponent(ref.trim())}&phone=${encodeURIComponent(phone.trim())}`) });
  const label = (s: string) => s === "verified" ? "Confirmed" : s === "rejected" ? "Not confirmed" : "Awaiting payment verification";
  return (
    <Card className="p-4 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2"><Search className="h-4 w-4" /> Check a booking</h2>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="Reference e.g. RMS-…" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Booking reference" data-testid="input-status-ref" />
        <Input placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" data-testid="input-status-phone" />
        <Button variant="outline" disabled={!ref.trim() || phone.trim().length < 9 || q.isPending} onClick={() => q.mutate()} data-testid="button-check-status">Check</Button>
      </div>
      {q.data && <p className="text-sm" data-testid="text-status-result"><span className="font-semibold">{label(q.data.status)}</span>: {q.data.summary}{q.data.note ? ` (${q.data.note})` : ""}</p>}
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
    </Card>
  );
}
