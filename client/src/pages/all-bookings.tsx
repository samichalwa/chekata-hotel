import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, PartyPopper, Clapperboard, ChevronRight, Plus, Wallet } from "lucide-react";
import type { AccommodationBooking, Room, FacilityBooking, Facility, MovieShow, MovieSeatBooking } from "@shared/schema";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKES, formatDate } from "@/lib/format";
import { useCurrentUser, canAccess } from "@/hooks/use-auth";
import { hotelTodayClient } from "@/lib/director";

// "All bookings" is a shortcut view, NOT a module: each section is shown only
// when the user holds that module (accommodation / facilities / movie-room),
// and data is fetched from those modules' own permission-checked endpoints.

type Kind = "room" | "event" | "movie";
interface UnifiedBooking {
  key: string;
  kind: Kind;
  name: string;
  detail: string;
  date: string; // YYYY-MM-DD used for sorting / upcoming filter
  endDate?: string;
  time?: string | null;
  amount: number;
  due: number;
  status: string;
  createdAt: number;
  href: string;
}

const KIND_META: Record<Kind, { label: string; icon: typeof BedDouble; module: "accommodation" | "facilities" | "movie-room"; href: string }> = {
  room: { label: "Rooms", icon: BedDouble, module: "accommodation", href: "/accommodation" },
  event: { label: "Conference & events", icon: PartyPopper, module: "facilities", href: "/facilities" },
  movie: { label: "Movie room", icon: Clapperboard, module: "movie-room", href: "/movie-room" },
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending_payment: "outline", confirmed: "secondary", checked_in: "default", checked_out: "outline",
  completed: "outline", booked: "secondary", cancelled: "destructive",
};
function titleCase(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

type Range = "upcoming" | "past" | "all";

export default function AllBookingsPage() {
  const { data: user } = useCurrentUser();
  const canRooms = canAccess(user, "accommodation");
  const canEvents = canAccess(user, "facilities");
  const canMovie = canAccess(user, "movie-room");

  const rooms = useQuery<Room[]>({ queryKey: ["/api/rooms"], enabled: canRooms });
  const roomBookings = useQuery<AccommodationBooking[]>({ queryKey: ["/api/accommodation-bookings"], enabled: canRooms });
  const facilities = useQuery<Facility[]>({ queryKey: ["/api/facilities"], enabled: canEvents });
  const facilityBookings = useQuery<FacilityBooking[]>({ queryKey: ["/api/facility-bookings"], enabled: canEvents });
  const shows = useQuery<MovieShow[]>({ queryKey: ["/api/movie-shows"], enabled: canMovie });
  const seats = useQuery<MovieSeatBooking[]>({ queryKey: ["/api/movie-seat-bookings"], enabled: canMovie });

  const loading = (canRooms && (rooms.isLoading || roomBookings.isLoading))
    || (canEvents && (facilities.isLoading || facilityBookings.isLoading))
    || (canMovie && (shows.isLoading || seats.isLoading));

  const [range, setRange] = useState<Range>("upcoming");
  const [kind, setKind] = useState<Kind | "all">("all");
  const today = hotelTodayClient();

  const all = useMemo<UnifiedBooking[]>(() => {
    const out: UnifiedBooking[] = [];
    if (canRooms) {
      const roomById = new Map((rooms.data ?? []).map((r) => [r.id, r]));
      for (const b of roomBookings.data ?? []) {
        const amount = b.totalAmount - (b.creditedAmount ?? 0);
        out.push({
          key: `room-${b.id}`, kind: "room", name: b.guestName,
          detail: `${roomById.get(b.roomId)?.name ?? "Room"}${b.numberOfGuests > 1 ? ` · ${b.numberOfGuests} guests` : ""}`,
          date: b.checkIn, endDate: b.checkOut, amount, due: Math.max(0, amount - b.amountPaid), status: b.status,
          createdAt: b.createdAt, href: "/accommodation",
        });
      }
    }
    if (canEvents) {
      const facById = new Map((facilities.data ?? []).map((f) => [f.id, f]));
      for (const b of facilityBookings.data ?? []) {
        const amount = b.totalAmount - (b.creditedAmount ?? 0);
        out.push({
          key: `event-${b.id}`, kind: "event", name: b.clientName, detail: facById.get(b.facilityId)?.name ?? "Facility",
          date: b.eventDate, time: [b.startTime, b.endTime].filter(Boolean).join("–") || null,
          amount, due: Math.max(0, amount - b.amountPaid), status: b.status, createdAt: b.createdAt, href: "/facilities",
        });
      }
    }
    if (canMovie) {
      // One row per purchase (booking reference + show), listing all its seats.
      const showById = new Map((shows.data ?? []).map((s) => [s.id, s]));
      const groups = new Map<string, MovieSeatBooking[]>();
      for (const b of seats.data ?? []) {
        const k = `${b.bookingRef}|${b.showId}`;
        groups.set(k, [...(groups.get(k) ?? []), b]);
      }
      Array.from(groups.entries()).forEach(([k, list]) => {
        const live = list.filter((b) => b.status !== "cancelled");
        const use = live.length ? live : list;
        const show = showById.get(use[0].showId);
        const amount = use.reduce((a, b) => a + b.ticketPrice - (b.creditedAmount ?? 0), 0);
        const paid = use.reduce((a, b) => a + b.amountPaid, 0);
        const seatsLabel = use.map((b) => `${b.seatRow}${b.seatNumber}`).sort().join(", ");
        out.push({
          key: `movie-${k}`, kind: "movie", name: use[0].guestName,
          detail: `${show?.name ?? "Show"} · Seat${use.length > 1 ? "s" : ""} ${seatsLabel}`,
          date: show?.showDate ?? "", time: show?.startTime ?? null,
          amount, due: live.length ? Math.max(0, amount - paid) : 0, status: live.length ? "booked" : "cancelled",
          createdAt: Math.max(...use.map((b) => b.createdAt)), href: "/movie-room?tab=bookings",
        });
      });
    }
    return out;
  }, [canRooms, canEvents, canMovie, rooms.data, roomBookings.data, facilities.data, facilityBookings.data, shows.data, seats.data]);

  const inRange = (b: UnifiedBooking) => {
    const last = b.endDate ?? b.date;
    if (range === "upcoming") return last >= today && b.status !== "cancelled" && b.status !== "checked_out" && b.status !== "completed";
    if (range === "past") return last < today || b.status === "checked_out" || b.status === "completed";
    return true;
  };
  const visible = all
    .filter((b) => (kind === "all" || b.kind === kind) && inRange(b))
    .sort((a, b) => (range === "upcoming" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || b.createdAt - a.createdAt);

  const kinds = (Object.keys(KIND_META) as Kind[]).filter((k) => canAccess(user, KIND_META[k].module));
  const countFor = (k: Kind) => all.filter((b) => b.kind === k && inRange(b)).length;
  const dueTotal = visible.reduce((a, b) => a + b.due, 0);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <PageHeader title="All bookings" description="Rooms, conference & events and movie room seats in one list." />

      {kinds.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">You don't have access to any booking modules.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {kinds.map((k) => (
              <StatCard key={k} label={KIND_META[k].label} value={String(countFor(k))} icon={KIND_META[k].icon} testId={`stat-bookings-${k}`} />
            ))}
            <StatCard label="Balance due" value={formatKES(dueTotal)} icon={Wallet} accent="warning" testId="stat-bookings-due" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Date range">
              {(["upcoming", "past", "all"] as Range[]).map((r) => (
                <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${range === r ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                  data-testid={`range-${r}`}>{titleCase(r)}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", ...kinds] as (Kind | "all")[]).map((k) => (
                <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} className="h-8" onClick={() => setKind(k)} data-testid={`filter-${k}`}>
                  {k === "all" ? "All types" : KIND_META[k].label}
                </Button>
              ))}
            </div>
          </div>

          <Card>
            {loading ? (
              <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : visible.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-bookings">
                {range === "upcoming" ? "No upcoming bookings." : "No bookings found."}
                {range === "upcoming" && all.length > 0 && (
                  <> <button type="button" className="text-primary hover:underline" onClick={() => setRange("all")}>Show all {all.length}</button></>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border" data-testid="list-all-bookings">
                {visible.map((b) => {
                  const M = KIND_META[b.kind];
                  return (
                    <li key={b.key}>
                      <Link href={b.href}>
                        <div className="flex items-center gap-3 px-4 py-3 hover-elevate cursor-pointer" data-testid={`booking-${b.key}`}>
                          <M.icon className="h-4 w-4 shrink-0 text-primary" aria-label={M.label} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{b.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{b.detail}</p>
                            <p className="text-xs text-muted-foreground">
                              {b.date ? formatDate(b.date) : "—"}{b.endDate ? ` → ${formatDate(b.endDate)}` : ""}{b.time ? ` · ${b.time}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-medium tabular-nums">{formatKES(b.amount)}</p>
                            {b.due > 0.5
                              ? <p className="text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400">{formatKES(b.due)} due</p>
                              : <p className="text-xs text-muted-foreground">{b.status === "cancelled" ? "—" : "Paid"}</p>}
                            <Badge variant={STATUS_VARIANT[b.status] ?? "outline"} className="mt-1 text-[10px] px-1.5 py-0">{titleCase(b.status)}</Badge>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Link key={k} href={KIND_META[k].href}>
                <Button variant="outline" size="sm" data-testid={`button-new-${k}`}><Plus className="h-4 w-4 mr-1" />New {k === "room" ? "room booking" : k === "event" ? "event booking" : "seat booking"}</Button>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
