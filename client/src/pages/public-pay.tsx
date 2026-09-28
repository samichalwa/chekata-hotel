// Public "pay your bill" page (no login): https://hms.thechekata.com/#/pay/<token>
// Staff share the link from a bar/restaurant bill. The guest pays by M-Pesa, pastes the SMS,
// and the bill stays open until staff verify the payment under Online bookings.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKES } from "@/lib/format";
import chekataLogo from "@/assets/chekata-logo.jpg";
import { type Info, type Result, publicApi, PayInstructions, MpesaPaste, mpesaReady } from "@/components/public-booking-parts";

interface Bill {
  ref: string; outlet: string; outletName: string; reference: string | null; orderDate: string; status: string; total: number;
  items: { name: string; quantity: number; subtotal: number }[];
  pending: { mpesaCode: string; amount: number } | null; paidReference: string | null;
}

export default function PublicPayPage({ token, onBack }: { token: string; onBack?: () => void }) {
  const { data: info } = useQuery<Info>({ queryKey: ["public-booking-info"], queryFn: () => publicApi("GET", "/api/public/booking-info") });
  const { data: bill, isLoading, error, refetch } = useQuery<Bill>({ queryKey: ["public-bill", token], queryFn: () => publicApi("GET", `/api/public/bill/${encodeURIComponent(token)}`), refetchInterval: 30000 });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  useEffect(() => { document.title = `${info?.hotelName ?? "The Chekata"} — Pay your bill`; }, [info?.hotelName]);

  const submit = useMutation({
    mutationFn: () => publicApi<Result>("POST", "/api/public/bill-payments", { token, guestName: name, guestPhone: phone, mpesaMessage: msg }),
    onSuccess: (r) => { setDone(r); setErr(null); refetch(); },
    onError: (e: any) => setErr(e?.message ?? "Something went wrong."),
  });
  const total = bill?.total ?? 0;
  const ready = !!bill && name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 9 && mpesaReady(msg, total) && !!info?.mpesa.number;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <img src={chekataLogo} alt="" className="h-10 w-10 rounded-md object-cover" />
          <div className="leading-tight">
            <p className="font-semibold" data-testid="text-pay-hotel-name">{info?.hotelName ?? "The Chekata"}</p>
            <p className="text-xs text-muted-foreground">Pay your bill by M-Pesa</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-5">
        {isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {error && <Card className="p-6 text-sm text-destructive" data-testid="text-pay-error">{(error as Error).message}</Card>}
        {onBack && <button type="button" onClick={onBack} className="text-sm text-primary underline-offset-2 hover:underline" data-testid="button-back-to-bills">← All bills at this table</button>}
        {bill && (
          <>
            <Card className="p-4 space-y-3" data-testid="card-bill">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold">{bill.outletName} bill{bill.reference ? ` · ${bill.reference}` : ""}</h1>
                  <p className="text-xs text-muted-foreground">Ref {bill.ref} · {bill.orderDate}</p>
                </div>
                <p className="text-right"><span className="block text-xs text-muted-foreground">Total</span><span className="text-lg font-semibold tabular-nums" data-testid="text-bill-total">{formatKES(bill.total)}</span></p>
              </div>
              <div className="divide-y divide-border rounded-md border border-border text-sm">
                {bill.items.length === 0 ? <p className="p-3 text-center text-muted-foreground">No items yet.</p> : bill.items.map((i, k) => (
                  <div key={k} className="flex justify-between gap-3 p-2.5" data-testid={`row-bill-item-${k}`}><span>{i.name} <span className="text-muted-foreground">× {i.quantity}</span></span><span className="tabular-nums">{formatKES(i.subtotal)}</span></div>
                ))}
              </div>
            </Card>

            {bill.status === "paid" ? (
              <Card className="p-6 space-y-2 text-center" data-testid="card-bill-paid">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">This bill is paid</h2>
                <p className="text-sm text-muted-foreground">Thank you{bill.paidReference ? `. Payment ${bill.paidReference}` : ""}.</p>
              </Card>
            ) : bill.status !== "open" ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">This bill is closed. Please ask our staff.</Card>
            ) : done || bill.pending ? (
              <Card className="p-6 space-y-2 text-center" data-testid="card-bill-pending">
                <Clock className="mx-auto h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Payment received — waiting for confirmation</h2>
                <p className="text-sm">M-Pesa <span className="font-semibold tabular-nums">{done?.mpesaCode ?? bill.pending?.mpesaCode}</span> · {formatKES(done?.amount ?? bill.pending?.amount ?? 0)}</p>
                <p className="text-sm text-muted-foreground">Our staff will check this payment and confirm it. You'll get an SMS once it's confirmed.</p>
              </Card>
            ) : bill.total <= 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">This bill has no items yet. Please ask our staff.</Card>
            ) : info ? (
              <Card className="p-4 space-y-4">
                <PayInstructions info={info} amount={bill.total} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="pay-name">Your name</Label><Input id="pay-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="input-pay-name" /></div>
                  <div className="space-y-1.5"><Label htmlFor="pay-phone">Mobile number</Label><Input id="pay-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="tel" data-testid="input-pay-phone" /></div>
                </div>
                <MpesaPaste value={msg} onChange={setMsg} amountDue={bill.total} mpesa={info.mpesa} />
                {err && <p className="flex items-start gap-1 text-sm text-destructive" data-testid="text-pay-submit-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {err}</p>}
                <Button className="w-full" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-bill-payment">
                  {submit.isPending ? "Sending…" : `Submit payment of ${formatKES(bill.total)}`}
                </Button>
              </Card>
            ) : null}
            {info && <p className="pb-6 text-center text-xs text-muted-foreground">{info.hotelName}{info.hotelPhone ? ` · ${info.hotelPhone}` : ""}{info.hotelEmail ? ` · ${info.hotelEmail}` : ""}</p>}
          </>
        )}
      </main>
    </div>
  );
}

// Table QR (#/pay/t/<token>): shows the open bill(s) for that table so a walk-in patron can pay.
interface TableBills { tableName: string; bills: { token: string; ref: string; outletName: string; total: number; orderDate: string; createdAt: number; pending: boolean }[] }

export function PublicTablePayPage({ token }: { token: string }) {
  const { data: info } = useQuery<Info>({ queryKey: ["public-booking-info"], queryFn: () => publicApi("GET", "/api/public/booking-info") });
  const { data, isLoading, error, refetch, isFetching } = useQuery<TableBills>({ queryKey: ["public-table-bills", token], queryFn: () => publicApi("GET", `/api/public/table-bills/${encodeURIComponent(token)}`) });
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = chosen ?? (data?.bills.length === 1 ? data.bills[0].token : null);
  if (pick) return <PublicPayPage token={pick} onBack={data && data.bills.length > 1 ? () => setChosen(null) : undefined} />;
  const time = (ts: number) => new Date(ts).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <img src={chekataLogo} alt="" className="h-10 w-10 rounded-md object-cover" />
          <div className="leading-tight">
            <p className="font-semibold">{info?.hotelName ?? "The Chekata"}</p>
            <p className="text-xs text-muted-foreground">Pay your bill by M-Pesa{data ? ` · ${data.tableName}` : ""}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-5">
        {isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {error && <Card className="p-6 text-sm text-destructive" data-testid="text-pay-error">{(error as Error).message}</Card>}
        {data && data.bills.length === 0 && (
          <Card className="p-6 space-y-3 text-center" data-testid="card-no-open-bill">
            <h1 className="text-lg font-semibold">No open bill for {data.tableName} yet</h1>
            <p className="text-sm text-muted-foreground">Once our staff have entered your order, tap Refresh to see your bill and pay.</p>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-table-bills">{isFetching ? "Checking…" : "Refresh"}</Button>
          </Card>
        )}
        {data && data.bills.length > 1 && (
          <Card className="p-4 space-y-3" data-testid="card-choose-bill">
            <div>
              <h1 className="text-lg font-semibold">Which bill is yours?</h1>
              <p className="text-sm text-muted-foreground">There are {data.bills.length} open bills at {data.tableName}.</p>
            </div>
            <div className="space-y-2">
              {data.bills.map((b) => (
                <button key={b.token} type="button" onClick={() => setChosen(b.token)} className="flex w-full items-center justify-between gap-3 rounded-md border border-border p-3 text-left hover-elevate" data-testid={`button-choose-bill-${b.ref}`}>
                  <span><span className="block font-medium">{b.outletName} bill · {b.ref}</span><span className="text-xs text-muted-foreground">Opened {time(b.createdAt)}{b.pending ? " · payment waiting for confirmation" : ""}</span></span>
                  <span className="font-semibold tabular-nums">{formatKES(b.total)}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
