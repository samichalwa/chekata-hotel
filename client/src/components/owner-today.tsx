import { Link } from "wouter";
import {
  CheckSquare, BedDouble, PartyPopper, Receipt, FileBarChart, Landmark, AlertTriangle, AlertOctagon, Info,
  ChevronRight, LogIn, LogOut, Film, Users, Wallet, RefreshCw,
  Droplets,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKES } from "@/lib/format";
import { useCurrentUser, canAccess } from "@/hooks/use-auth";
import { useDirectorSummary, hasAnyApprovalModule, type DirectorAlert } from "@/lib/director";
import type { ModuleKey } from "@shared/schema";
import { DailyCloseActions } from "@/components/daily-close-actions";

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
}

const SEVERITY: Record<DirectorAlert["severity"], { icon: typeof Info; cls: string; label: string }> = {
  critical: { icon: AlertOctagon, cls: "border-l-destructive text-destructive", label: "Critical" },
  warning: { icon: AlertTriangle, cls: "border-l-amber-500 text-amber-600 dark:text-amber-400", label: "Warning" },
  info: { icon: Info, cls: "border-l-primary text-primary", label: "Info" },
};

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

function shortDate(d?: string): string {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function ShowLabel({ title, when, due }: { title: string; when: string; due?: number }) {
  return (
    <>
      <span className="block truncate">{title}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {when}
        {(due ?? 0) > 0.5 && <span className="text-amber-600 dark:text-amber-400"> · {formatKES(due!)} due</span>}
      </span>
    </>
  );
}

function Row({ label, value, href, muted, testId }: { label: React.ReactNode; value: React.ReactNode; href?: string; muted?: boolean; testId?: string }) {
  const inner = (
    <div className={`flex items-center justify-between gap-3 py-2 text-sm ${href ? "hover-elevate rounded-md px-2 -mx-2" : ""}`} data-testid={testId}>
      <span className={`min-w-0 truncate ${muted ? "text-muted-foreground" : ""}`}>{label}</span>
      <span className="flex items-center gap-1 shrink-0 tabular-nums font-medium">{value}{href && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}</span>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

interface QuickAction { label: string; href: string; icon: typeof Info; module?: ModuleKey; count?: number; show?: boolean }

export function OwnerToday() {
  const { data: user } = useCurrentUser();
  const { data: s, isLoading, isError, refetch, isFetching } = useDirectorSummary();

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="owner-today-loading">
        <Skeleton className="h-6 w-56" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </div>
    );
  }
  if (isError || !s) {
    return (
      <Card className="p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Today's briefing couldn't be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-owner-today-retry">Try again</Button>
      </Card>
    );
  }

  const actions: QuickAction[] = [
    { label: "Approvals", href: "/approvals", icon: CheckSquare, count: s.approvals.total, show: hasAnyApprovalModule(user) },
    { label: "Bookings", href: "/bookings", icon: BedDouble, show: (["accommodation", "facilities", "movie-room"] as const).some((m) => canAccess(user, m)) },
    { label: "Events", href: "/facilities", icon: PartyPopper, module: "facilities" },
    { label: "Movie Room", href: "/movie-room", icon: Film, module: "movie-room" },
    { label: "Water", href: "/water-sales", icon: Droplets, module: "water-sales" },
    { label: "Finance", href: "/finance", icon: Landmark, module: "finance" },
    { label: "Expenses", href: "/expenses", icon: Receipt, module: "expenses" },
    { label: "Reports", href: "/reports", icon: FileBarChart, module: "reports" },
  ];
  const visibleActions = actions.filter((a) => (a.show ?? true) && (!a.module || canAccess(user, a.module)));

  const streams = [...s.income.streams].sort((a, b) => b.today - a.today || b.mtd - a.mtd);
  const maxToday = Math.max(1, ...streams.map((x) => x.today));
  const receivablesTotal = s.receivables.reduce((a, r) => a + r.amount, 0);
  const budgetPct = s.budget && s.budget.budgeted > 0 ? Math.min(100, Math.round((s.budget.actual / s.budget.budgeted) * 100)) : 0;
  const proRataPct = s.budget && s.budget.budgeted > 0 ? Math.min(100, Math.round((s.budget.proRataBudget / s.budget.budgeted) * 100)) : 0;

  return (
    <section className="space-y-4" aria-labelledby="owner-today-title" data-testid="owner-today">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="owner-today-title" className="text-xl font-semibold" data-testid="text-owner-today-date">Today · {longDate(s.date)}</h2>
          <p className="text-xs text-muted-foreground">Updated {timeOf(s.generatedAt)} · refreshes every minute</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} title="Refresh" data-testid="button-owner-today-refresh">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <DailyCloseActions user={user} date={s.date} showView />

      {visibleActions.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2" data-testid="owner-quick-actions">
          {visibleActions.map((a) => (
            <Link key={a.label} href={a.href}>
              <div className="relative flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card hover-elevate active-elevate-2 cursor-pointer" data-testid={`quick-${a.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <a.icon className="h-5 w-5 text-primary" />
                <span className="px-1 text-center text-xs font-medium leading-tight">{a.label}</span>
                {a.count !== undefined && a.count > 0 && (
                  <span className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-destructive px-1.5 text-center text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums" data-testid={`badge-quick-${a.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {a.count > 99 ? "99+" : a.count}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {s.alerts.length > 0 && (
        <Card className="p-4" data-testid="owner-alerts">
          <SectionTitle action={<Badge variant="secondary">{s.alerts.length}</Badge>}>Needs your attention</SectionTitle>
          <ul className="space-y-2">
            {s.alerts.map((a) => {
              const sev = SEVERITY[a.severity];
              return (
                <li key={a.id}>
                  <Link href={a.link}>
                    <div className={`flex items-start gap-3 rounded-md border border-border border-l-4 ${sev.cls} bg-background px-3 py-2 hover-elevate cursor-pointer`} data-testid={`alert-${a.id}`}>
                      <sev.icon className="mt-0.5 h-4 w-4 shrink-0" aria-label={sev.label} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{a.title}</p>
                        {a.detail && <p className="text-xs text-muted-foreground">{a.detail}</p>}
                      </div>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Income by stream */}
        <Card className="p-4" data-testid="owner-income">
          <SectionTitle>Income today</SectionTitle>
          <p className="text-3xl font-semibold tabular-nums" data-testid="text-income-today">{formatKES(s.income.totalToday)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Yesterday <span className="font-medium text-foreground tabular-nums">{formatKES(s.income.totalYesterday)}</span></span>
            <span>Month to date <span className="font-medium text-foreground tabular-nums" data-testid="text-income-mtd">{formatKES(s.income.totalMtd)}</span></span>
          </div>
          <div className="mt-4 divide-y divide-border">
            {streams.length === 0 && <p className="py-2 text-sm text-muted-foreground">No revenue streams available for your access.</p>}
            {streams.map((st) => (
              <Link key={st.key} href={st.link}>
                <div className="py-2 hover-elevate rounded-md px-2 -mx-2 cursor-pointer" data-testid={`stream-${st.key}`}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{st.label}{st.todayCount > 0 && <span className="ml-1 text-xs text-muted-foreground">· {st.todayCount}</span>}</span>
                    <span className="tabular-nums font-medium">{formatKES(st.today)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((st.today / maxToday) * 100)}%` }} />
                    </div>
                    <span className="w-28 text-right text-[11px] text-muted-foreground tabular-nums">MTD {formatKES(st.mtd)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">Recognised on check-in, event, show and sale dates; rent on payment date. Net of credit notes.</p>
        </Card>

        {/* Operations */}
        <Card className="p-4" data-testid="owner-operations">
          <SectionTitle>Operations</SectionTitle>
          {s.rooms ? (
            <>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-semibold tabular-nums" data-testid="text-occupancy">{s.rooms.occupancyPct}%</p>
                <p className="text-sm text-muted-foreground">occupancy · {s.rooms.inHouse} of {s.rooms.total} rooms</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/60 py-2"><LogIn className="mx-auto h-4 w-4 text-primary" /><p className="text-lg font-semibold tabular-nums">{s.rooms.arrivals}</p><p className="text-[11px] text-muted-foreground">Arrivals</p></div>
                <div className="rounded-md bg-muted/60 py-2"><LogOut className="mx-auto h-4 w-4 text-primary" /><p className="text-lg font-semibold tabular-nums">{s.rooms.departures}</p><p className="text-[11px] text-muted-foreground">Departures</p></div>
                <div className="rounded-md bg-muted/60 py-2"><BedDouble className="mx-auto h-4 w-4 text-primary" /><p className="text-lg font-semibold tabular-nums">{s.rooms.outOfOrder}</p><p className="text-[11px] text-muted-foreground">Out of order</p></div>
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">Accommodation isn't part of your access.</p>}

          {s.arrivals.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Arriving today</p>
              <div className="divide-y divide-border">
                {s.arrivals.map((a) => (
                  <Row key={a.id} href="/accommodation" testId={`arrival-${a.id}`}
                    label={<>{a.guestName}<span className="text-muted-foreground"> · {a.roomName ?? "—"}</span></>}
                    value={a.balance > 0 ? <span className="text-amber-600 dark:text-amber-400">{formatKES(a.balance)} due</span> : <span className="text-muted-foreground">Paid</span>} />
                ))}
              </div>
            </div>
          )}
          {s.events.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Events today</p>
              <div className="divide-y divide-border">
                {s.events.map((e) => (
                  <Row key={e.id} href="/facilities" testId={`event-${e.id}`}
                    label={<>{e.clientName}<span className="text-muted-foreground"> · {e.facilityName ?? "—"}</span></>}
                    value={<span className="text-muted-foreground">{e.startTime ?? ""}{e.endTime ? `–${e.endTime}` : ""}</span>} />
                ))}
              </div>
            </div>
          )}
          {s.movie && (
            <div className="mt-4" data-testid="owner-movie">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <p className="text-xs font-medium text-muted-foreground"><Film className="inline h-3.5 w-3.5 mr-1" />Movie room</p>
                <Link href="/movie-room" className="text-xs text-primary hover:underline" data-testid="link-owner-movie">Open</Link>
              </div>
              <div className="divide-y divide-border">
                <Row href="/movie-room" testId="row-movie-booked-today" label="Seats booked today"
                  value={<>{s.movie.bookedToday.count}{s.movie.bookedToday.amount > 0 && <span className="text-muted-foreground font-normal"> · {formatKES(s.movie.bookedToday.amount)}</span>}</>} />
                {s.shows.map((sh) => (
                  <Row key={sh.id} href="/movie-room" testId={`show-${sh.id}`}
                    label={<ShowLabel title={sh.title} when={`Today${sh.time ? ` · ${sh.time}` : ""}`} due={sh.due} />}
                    value={`${sh.sold}/${sh.capacity} seats`} />
                ))}
                {s.movie.upcoming.map((sh) => (
                  <Row key={sh.id} href="/movie-room" testId={`upcoming-show-${sh.id}`}
                    label={<ShowLabel title={sh.title} when={`${shortDate(sh.date)}${sh.time ? ` · ${sh.time}` : ""}`} due={sh.due} />}
                    value={`${sh.sold}/${sh.capacity} seats`} />
                ))}
                {s.shows.length === 0 && s.movie.upcoming.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">No upcoming shows. <Link href="/movie-room" className="text-primary hover:underline">Schedule one</Link></p>
                )}
              </div>
              {(s.movie.recent?.length ?? 0) > 0 && (
                <div className="mt-3" data-testid="owner-movie-recent">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Latest seat bookings{(s.movie.totalBookings ?? 0) > 0 && <span className="font-normal"> · {s.movie.totalBookings} in total</span>}</p>
                  <div className="divide-y divide-border">
                    {s.movie.recent!.map((b) => (
                      <Row key={b.id} href="/movie-room?tab=bookings" testId={`movie-booking-${b.id}`}
                        label={<>
                          <span className="block truncate">{b.guestName}<span className="text-muted-foreground"> · Seat {b.seat}</span></span>
                          <span className="block truncate text-xs text-muted-foreground">{b.showTitle} · {shortDate(b.showDate)}{b.showTime ? ` · ${b.showTime}` : ""}</span>
                        </>}
                        value={b.due > 0.5
                          ? <span className="text-amber-600 dark:text-amber-400">{formatKES(b.due)} due</span>
                          : <span className="text-muted-foreground">Paid</span>} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {s.rooms && s.arrivals.length === 0 && s.events.length === 0 && s.shows.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No arrivals or events scheduled today.</p>
          )}
          {s.people && (
            <div className="mt-4 border-t border-border pt-3">
              <Row href="/leave" testId="row-people" label={<><Users className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />Staff on duty</>}
                value={<>{s.people.activeStaff - s.people.onLeaveToday}<span className="text-muted-foreground font-normal"> / {s.people.activeStaff}</span></>} />
              {s.people.onLeaveToday > 0 && <p className="text-xs text-muted-foreground">On leave: {s.people.names.join(", ")}</p>}
            </div>
          )}
        </Card>

        {/* Money position */}
        <Card className="p-4" data-testid="owner-money">
          <SectionTitle>Money position</SectionTitle>
          {s.cash ? (
            <>
              <p className="text-xs text-muted-foreground">Cash & bank</p>
              <p className="text-3xl font-semibold tabular-nums" data-testid="text-cash-total">{formatKES(s.cash.total)}</p>
              <div className="mt-2 divide-y divide-border">
                {s.cash.accounts.map((a) => <Row key={a.id} muted label={a.name} value={formatKES(a.balance)} testId={`cash-${a.id}`} />)}
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground"><Wallet className="inline h-4 w-4 mr-1" />Bank balances need Finance access.</p>}

          {s.receivables.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1"><span>Owed to the hotel</span><span className="tabular-nums font-medium text-foreground">{formatKES(receivablesTotal)}</span></div>
              <div className="divide-y divide-border">
                {s.receivables.map((r) => (
                  <Row key={r.key} href={r.link} testId={`receivable-${r.key}`} label={<>{r.label}{r.count > 0 && <span className="text-muted-foreground"> · {r.count}</span>}</>} value={formatKES(r.amount)} />
                ))}
              </div>
            </div>
          )}

          {s.expenses && (
            <div className="mt-4 border-t border-border pt-3">
              <Row href="/expenses" testId="row-expenses" label="Expenses today" value={formatKES(s.expenses.today)} />
              <Row href="/expenses" testId="row-expenses-mtd" muted label="Expenses month to date" value={formatKES(s.expenses.mtd)} />
            </div>
          )}

          {s.budget && s.budget.budgeted > 0 && (
            <Link href="/budgeting">
              <div className="mt-4 border-t border-border pt-3 cursor-pointer" data-testid="owner-budget">
                <div className="flex items-center justify-between text-sm">
                  <span>Income vs budget ({s.budget.month})</span>
                  <span className="tabular-nums font-medium">{budgetPct}%</span>
                </div>
                <div className="relative mt-2 h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${budgetPct}%` }} />
                  <div className="absolute -top-1 h-4 w-0.5 bg-foreground/60" style={{ left: `${proRataPct}%` }} title="Where you should be today" />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{formatKES(s.budget.actual)} posted of {formatKES(s.budget.budgeted)} · target today {formatKES(s.budget.proRataBudget)}</p>
              </div>
            </Link>
          )}
        </Card>
      </div>
    </section>
  );
}
