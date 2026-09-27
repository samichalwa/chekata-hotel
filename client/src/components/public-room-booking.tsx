// Public room booking (used by #/book): pick dates, see available room categories, pay by M-Pesa, paste the SMS.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, BedDouble, Loader2, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatKES } from "@/lib/format";
import { type Info, type Result, type Guest, publicApi, niceDate, PayInstructions, MpesaPaste, mpesaReady, GuestFields, Done } from "@/components/public-booking-parts";

interface RoomOption { key: string; type: string; label: string; rate: number; total: number; available: number; stayTotal: number; payNow: number }
interface Availability { checkIn: string; checkOut: string; nights: number; options: RoomOption[] }

const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function RoomTab({ info }: { info: Info }) {
  const [dates, setDates] = useState({ checkIn: info.today, checkOut: plusDays(info.today, 1) });
  const [guests, setGuests] = useState("1");
  const [pick, setPick] = useState<RoomOption | null>(null);
  const [g, setG] = useState<Guest>({ name: "", phone: "", email: "" });
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const validDates = !!dates.checkIn && !!dates.checkOut && dates.checkOut > dates.checkIn;

  const avail = useQuery<Availability>({
    queryKey: ["public-room-availability", dates.checkIn, dates.checkOut],
    queryFn: () => publicApi("GET", `/api/public/room-availability?checkIn=${dates.checkIn}&checkOut=${dates.checkOut}`),
    enabled: validDates,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () => publicApi<Result>("POST", "/api/public/room-bookings", {
      checkIn: dates.checkIn, checkOut: dates.checkOut, guests: Number(guests), roomOption: pick?.key, notes: notes || undefined,
      guestName: g.name, guestPhone: g.phone, guestEmail: g.email || undefined, mpesaMessage: msg,
    }),
    onSuccess: (r) => { setDone(r); setErr(null); avail.refetch(); },
    onError: (e: any) => { setErr(e.message); avail.refetch(); },
  });

  if (done) return <Done r={done} onAgain={() => { setDone(null); setPick(null); setMsg(""); }} />;

  const setDate = (k: "checkIn" | "checkOut", v: string) => {
    setPick(null);
    setDates((d) => {
      const next = { ...d, [k]: v };
      if (k === "checkIn" && v && next.checkOut <= v) next.checkOut = plusDays(v, 1);
      return next;
    });
  };

  if (pick && avail.data) {
    const a = avail.data;
    const ready = g.name.trim().length >= 2 && g.phone.trim().length >= 9 && mpesaReady(msg, pick.payNow) && !!info.mpesa.number;
    const balance = pick.stayTotal - pick.payNow;
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setPick(null)} data-testid="button-back-to-rooms"><ArrowLeft className="h-4 w-4 mr-1" /> All rooms</Button>
        <Card className="p-4 space-y-1">
          <p className="font-semibold">{pick.label} room</p>
          <p className="text-sm text-muted-foreground tabular-nums">{niceDate(a.checkIn)} → {niceDate(a.checkOut)} · {a.nights} night{a.nights > 1 ? "s" : ""} · {guests} guest{guests === "2" ? "s" : ""}</p>
          <p className="text-sm tabular-nums">{formatKES(pick.rate)} × {a.nights} = <span className="font-semibold">{formatKES(pick.stayTotal)}</span></p>
          {balance > 0 && <p className="text-sm text-muted-foreground tabular-nums">Pay {formatKES(pick.payNow)} now ({info.roomPayPercent}%) · balance {formatKES(balance)} at check-in</p>}
        </Card>
        <Card className="p-4 space-y-4">
          <GuestFields g={g} set={(k, v) => setG((x) => ({ ...x, [k]: v }))} />
          <div className="space-y-1.5"><Label htmlFor="r-notes">Special requests (optional)</Label><Input id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. late arrival, extra pillow" data-testid="input-room-notes" /></div>
          <PayInstructions info={info} amount={pick.payNow} />
          <MpesaPaste value={msg} onChange={setMsg} amountDue={pick.payNow} />
          {err && <p className="text-sm text-destructive flex items-start gap-1" data-testid="text-room-error"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{err}</p>}
          <Button className="w-full" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-room-booking">
            {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Submit booking
          </Button>
          <p className="text-xs text-muted-foreground">The room is held only after you submit a valid M-Pesa message. Each M-Pesa code can be used once. Check-in from {info.roomCheckInTime}, check-out by {info.roomCheckOutTime}. Please bring your ID or passport.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="r-in">Check-in</Label><Input id="r-in" className="min-w-0 px-2 text-sm sm:px-3" type="date" min={info.today} value={dates.checkIn} onChange={(e) => setDate("checkIn", e.target.value)} data-testid="input-check-in" /></div>
          <div className="space-y-1.5"><Label htmlFor="r-out">Check-out</Label><Input id="r-out" className="min-w-0 px-2 text-sm sm:px-3" type="date" min={dates.checkIn ? plusDays(dates.checkIn, 1) : info.today} value={dates.checkOut} onChange={(e) => setDate("checkOut", e.target.value)} data-testid="input-check-out" /></div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label>Guests</Label>
            <Select value={guests} onValueChange={setGuests}>
              <SelectTrigger aria-label="Guests" data-testid="select-room-guests"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="1">1 guest</SelectItem><SelectItem value="2">2 guests</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Up to {info.roomMaxGuests} guests per room and {info.roomMaxNights} nights online. Check-in from {info.roomCheckInTime}, check-out by {info.roomCheckOutTime}.</p>
      </Card>

      {!validDates && <p className="text-sm text-destructive">Check-out must be after check-in.</p>}
      {avail.isLoading && validDates && <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {avail.error && <Card className="p-4 text-sm text-destructive" data-testid="text-room-avail-error">{(avail.error as Error).message}</Card>}
      {avail.data && (
        avail.data.options.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">No rooms are listed yet. Please call reception{info.hotelPhone ? ` on ${info.hotelPhone}` : ""}.</Card>
        ) : (
          <div className="space-y-3" data-testid="list-room-options">
            <h2 className="text-base font-semibold">Rooms for {avail.data.nights} night{avail.data.nights > 1 ? "s" : ""}</h2>
            {avail.data.options.map((o) => (
              <Card key={o.key} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`card-room-${o.type}`}>
                <div className="flex items-start gap-3">
                  <BedDouble className="mt-0.5 h-5 w-5 text-primary" />
                  <div className="space-y-0.5">
                    <p className="font-semibold">{o.label} room</p>
                    <p className="text-sm text-muted-foreground tabular-nums">{formatKES(o.rate)} / night · {formatKES(o.stayTotal)} total</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className={`text-sm tabular-nums ${o.available === 0 ? "text-destructive" : "text-muted-foreground"}`}>{o.available === 0 ? "Fully booked" : `${o.available} available`}</span>
                  <Button disabled={o.available === 0} onClick={() => { setPick(o); setErr(null); }} data-testid={`button-choose-room-${o.type}`}>Book</Button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
