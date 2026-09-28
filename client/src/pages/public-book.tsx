// Public booking page (no login): https://hms.thechekata.com/#/book
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BedDouble, CalendarDays, Clock, Film, Loader2, UtensilsCrossed, AlertCircle, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatKES } from "@/lib/format";
import chekataLogo from "@/assets/chekata-logo.jpg";
import { type Info, type PublicShow, type Result, type Guest, publicApi, niceDate, PayInstructions, MpesaPaste, mpesaReady, GuestFields, Done, SeatMap } from "@/components/public-booking-parts";
import { TableTab, StatusCheck } from "@/components/public-table-booking";
import { RoomTab } from "@/components/public-room-booking";

function MovieTab({ info }: { info: Info }) {
  const { data: shows, isLoading, refetch } = useQuery<PublicShow[]>({ queryKey: ["public-shows"], queryFn: () => publicApi("GET", "/api/public/movie-shows"), refetchInterval: 30000 });
  const [showId, setShowId] = useState<number | null>(null);
  const [seats, setSeats] = useState<string[]>([]);
  const [g, setG] = useState<Guest>({ name: "", phone: "", email: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const show = shows?.find((s) => s.id === showId) ?? null;
  const total = (show?.ticketPrice ?? 0) * seats.length;
  const takenKey = show?.takenSeats.join(",") ?? "";
  useEffect(() => { if (show) setSeats((s) => s.filter((k) => !show.takenSeats.includes(k))); }, [takenKey]);

  const submit = useMutation({
    mutationFn: () => publicApi<Result>("POST", "/api/public/movie-bookings", {
      showId, seats: seats.map((k) => ({ row: k[0], number: Number(k.slice(1)) })),
      guestName: g.name, guestPhone: g.phone, guestEmail: g.email || undefined, mpesaMessage: msg,
    }),
    onSuccess: (r) => { setDone(r); setErr(null); refetch(); },
    onError: (e: any) => { setErr(e.message); refetch(); },
  });

  if (done) return <Done r={done} onAgain={() => { setDone(null); setShowId(null); setSeats([]); setMsg(""); }} />;
  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!shows?.length) return <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-shows">No shows are scheduled right now. Please check again soon.</Card>;

  if (!show) {
    return (
      <div className="space-y-3" data-testid="list-public-shows">
        <h2 className="text-base font-semibold">Scheduled shows</h2>
        {shows.map((s) => {
          const left = s.totalSeats - s.takenSeats.length;
          return (
            <Card key={s.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`card-show-${s.id}`}>
              <div className="space-y-1">
                <p className="font-semibold">{s.name}</p>
                <p className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" />{niceDate(s.showDate)}</span>
                  <span className="flex items-center gap-1 tabular-nums"><Clock className="h-4 w-4" />{s.startTime}{s.endTime ? `–${s.endTime}` : ""}</span>
                  <span className="tabular-nums">{formatKES(s.ticketPrice)} / seat</span>
                </p>
                {s.notes && <p className="text-sm text-muted-foreground">{s.notes}</p>}
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className={`text-sm tabular-nums ${left === 0 ? "text-destructive" : "text-muted-foreground"}`}>{left === 0 ? "Sold out" : `${left} seats left`}</span>
                {info.movieEnabled && <Button disabled={left === 0} onClick={() => { setShowId(s.id); setSeats([]); setErr(null); }} data-testid={`button-choose-show-${s.id}`}>Choose seats</Button>}
              </div>
            </Card>
          );
        })}
      </div>
    );
  }

  const toggle = (k: string) => setSeats((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= info.movieMaxSeats ? cur : [...cur, k]);
  const ready = seats.length > 0 && g.name.trim().length >= 2 && g.phone.trim().length >= 9 && mpesaReady(msg, total) && !!info.mpesa.number;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setShowId(null)} data-testid="button-back-to-shows"><ArrowLeft className="h-4 w-4 mr-1" /> All shows</Button>
      <Card className="p-4 space-y-4">
        <div>
          <p className="font-semibold">{show.name}</p>
          <p className="text-sm text-muted-foreground tabular-nums">{niceDate(show.showDate)} · {show.startTime}{show.endTime ? `–${show.endTime}` : ""} · {formatKES(show.ticketPrice)} per seat</p>
        </div>
        <SeatMap info={info} show={show} selected={seats} toggle={toggle} />
        <p className="text-sm text-center" data-testid="text-seat-summary">
          {seats.length ? <>Seats {[...seats].sort().join(", ")} · <span className="font-semibold tabular-nums">{formatKES(total)}</span></> : `Tap up to ${info.movieMaxSeats} seats.`}
        </p>
      </Card>
      {seats.length > 0 && (
        <Card className="p-4 space-y-4">
          <GuestFields g={g} set={(k, v) => setG((x) => ({ ...x, [k]: v }))} />
          <PayInstructions info={info} amount={total} />
          <MpesaPaste value={msg} onChange={setMsg} amountDue={total} mpesa={info.mpesa} />
          {err && <p className="text-sm text-destructive flex items-start gap-1" data-testid="text-booking-error"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{err}</p>}
          <Button className="w-full" disabled={!ready || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-movie-booking">
            {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Submit booking
          </Button>
          <p className="text-xs text-muted-foreground">Seats are held only after you submit a valid M-Pesa message. Each M-Pesa code can be used once.</p>
        </Card>
      )}
    </div>
  );
}

export default function PublicBookPage() {
  const { data: info, isLoading, error } = useQuery<Info>({ queryKey: ["public-booking-info"], queryFn: () => publicApi("GET", "/api/public/booking-info") });
  useEffect(() => { document.title = `${info?.hotelName ?? "The Chekata"} — Book rooms, movie seats & tables`; }, [info?.hotelName]);
  const defaultTab = !info ? "room" : info.roomEnabled ? "room" : info.movieEnabled ? "movie" : info.tableEnabled ? "table" : "movie";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <img src={chekataLogo} alt="" className="h-10 w-10 rounded-md object-cover" />
          <div className="leading-tight">
            <p className="font-semibold" data-testid="text-public-hotel-name">{info?.hotelName ?? "The Chekata"}</p>
            <p className="text-xs text-muted-foreground">Book rooms, movie seats and tables</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {error && <Card className="p-6 text-sm text-destructive">{(error as Error).message}</Card>}
        {info && (
          <>
            {info.note && <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground" data-testid="text-public-note">{info.note}</p>}
            <Tabs defaultValue={defaultTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="room" data-testid="tab-public-room"><BedDouble className="h-4 w-4 mr-1.5 shrink-0" /> Rooms</TabsTrigger>
                <TabsTrigger value="movie" data-testid="tab-public-movie"><Film className="h-4 w-4 mr-1.5 shrink-0" /> Movies</TabsTrigger>
                <TabsTrigger value="table" data-testid="tab-public-table"><UtensilsCrossed className="h-4 w-4 mr-1.5 shrink-0" /> Tables</TabsTrigger>
              </TabsList>
              <TabsContent value="room" className="mt-4">
                {info.roomEnabled ? <RoomTab info={info} /> : <Card className="p-6 text-center text-sm text-muted-foreground">Online room booking is closed at the moment. Please call reception{info.hotelPhone ? ` on ${info.hotelPhone}` : ""}.</Card>}
              </TabsContent>
              <TabsContent value="movie" className="mt-4">
                {!info.movieEnabled && <p className="mb-3 text-sm text-muted-foreground">Online seat booking is closed at the moment. Shows are listed for information; please book at reception.</p>}
                <MovieTab info={info} />
              </TabsContent>
              <TabsContent value="table" className="mt-4">
                {info.tableEnabled ? <TableTab info={info} /> : <Card className="p-6 text-center text-sm text-muted-foreground">Online table reservations are closed at the moment. Please call reception{info.hotelPhone ? ` on ${info.hotelPhone}` : ""}.</Card>}
              </TabsContent>
            </Tabs>
            <StatusCheck />
            <p className="pb-6 text-center text-xs text-muted-foreground">{info.hotelName}{info.hotelPhone ? ` · ${info.hotelPhone}` : ""}{info.hotelEmail ? ` · ${info.hotelEmail}` : ""}</p>
          </>
        )}
      </main>
    </div>
  );
}
