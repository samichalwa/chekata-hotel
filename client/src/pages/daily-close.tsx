import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/use-auth";
import type { DirectorSummary } from "@/lib/director";
import { DailyCloseActions } from "@/components/daily-close-actions";
import chekataLogo from "@/assets/chekata-logo.jpg";

// On-screen Daily close report — mirrors the PDF section for section, so what
// the owner reads here is exactly what gets shared. Same data as the PDF
// (GET /api/director/daily-report/data → buildDirectorSummary), filtered by
// the signed-in user's module access.

interface ReportData { hotel: { name: string; address: string | null; phone: string | null }; today: string; summary: DirectorSummary }

const kes = (v: number) => `KES ${Math.round(v || 0).toLocaleString("en-KE")}`;
const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function clock(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-[0.06em] text-primary">{children}</h2>;
}

type Align = "left" | "right";
interface Col { label: string; align?: Align; hideOnMobile?: boolean; className?: string }

function ReportTable({ cols, rows, total, testId }: { cols: Col[]; rows: React.ReactNode[][]; total?: boolean; testId?: string }) {
  return (
    <table className="w-full table-fixed border-collapse text-[13px] sm:text-sm" data-testid={testId}>
      <thead>
        <tr className="border-b border-border">
          {cols.map((c, i) => (
            <th key={i} className={`py-1.5 px-1 text-[11px] font-semibold text-muted-foreground ${c.align === "right" ? "text-right" : "text-left"} ${c.hideOnMobile ? "hidden sm:table-cell" : ""} ${c.className ?? ""}`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => {
          const isTotal = total && ri === rows.length - 1;
          return (
            <tr key={ri} className={isTotal ? "border-t-2 border-foreground/70 font-semibold" : "border-b border-border/50 last:border-0"}>
              {r.map((cell, ci) => (
                <td key={ci} className={`py-1.5 px-1 align-top tabular-nums ${cols[ci].align === "right" ? "text-right whitespace-nowrap" : "text-left [overflow-wrap:anywhere]"} ${cols[ci].hideOnMobile ? "hidden sm:table-cell" : ""}`}>{cell}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// On phones the Yesterday / Txns columns fold under the stream name so the
// table fits a 375px screen without sideways scrolling.
function StreamCell({ label, count, yesterday }: { label: string; count?: number; yesterday: number }) {
  return (
    <div>
      <div>{label}</div>
      <div className="text-[11px] font-normal text-muted-foreground sm:hidden">{count ? `${count} txn${count === 1 ? "" : "s"} · ` : ""}Yest. {kes(yesterday)}</div>
    </div>
  );
}

function KV({ pairs, testId }: { pairs: [string, string][]; testId?: string }) {
  return <ReportTable testId={testId} cols={[{ label: "Item", className: "w-[55%]" }, { label: "Value", align: "right" }]} rows={pairs.map(([a, b]) => [a, b])} />;
}

export default function DailyClosePage() {
  const params = useParams<{ date?: string }>();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const requested = isDate(params.date) ? params.date! : "";
  const { data, isLoading, isError, refetch, isFetching } = useQuery<ReportData>({
    queryKey: [`/api/director/daily-report/data${requested ? `?date=${requested}` : ""}`],
    staleTime: 30_000,
  });
  const s = data?.summary;
  const date = s?.date ?? requested;
  const today = data?.today ?? "";
  const go = (d: string) => { if (isDate(d) && (!today || d <= today)) navigate(`/daily-close/${d}`); };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/"><Button variant="ghost" size="icon" title="Back to Today" data-testid="button-daily-back"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-xl font-semibold">Daily close report</h1>
            <p className="text-xs text-muted-foreground">View the report on screen, then share or download the PDF.</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => date && go(shiftDate(date, -1))} disabled={!date} title="Previous day" data-testid="button-daily-prev"><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={date} max={today || undefined} onChange={(e) => go(e.target.value)} className="h-9 w-[150px]" aria-label="Report date" data-testid="input-daily-date" />
          <Button variant="outline" size="icon" onClick={() => date && go(shiftDate(date, 1))} disabled={!date || (!!today && date >= today)} title="Next day" data-testid="button-daily-next"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} title="Refresh" data-testid="button-daily-refresh"><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {date && <DailyCloseActions user={user} date={date} />}

      {isLoading && <Card className="p-6 space-y-3"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-20" /><Skeleton className="h-48" /></Card>}
      {isError && (
        <Card className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">The report couldn't be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-daily-retry">Try again</Button>
        </Card>
      )}

      {s && data && <ReportBody data={data} />}
    </div>
  );
}

function ReportBody({ data }: { data: ReportData }) {
  const { hotel, summary: s } = data;
  const kpis: [string, string][] = [["Income today", kes(s.income.totalToday)]];
  if (s.rooms) kpis.push(["Occupancy", `${s.rooms.occupancyPct}%`]);
  if (s.cash) kpis.push(["Cash & bank", kes(s.cash.total)]);
  kpis.push(["Awaiting approval", String(s.approvals.total)]);

  const streams = [...s.income.streams].sort((a, b) => b.today - a.today);
  const ops: [string, string][] = [];
  if (s.rooms) {
    ops.push(["Occupancy", `${s.rooms.occupancyPct}% · ${s.rooms.inHouse} of ${s.rooms.total} rooms`]);
    ops.push(["Arrivals / departures", `${s.rooms.arrivals} / ${s.rooms.departures}`]);
    ops.push(["Rooms out of order", String(s.rooms.outOfOrder)]);
  }
  if (s.people) ops.push(["Staff on duty", `${s.people.activeStaff - s.people.onLeaveToday} of ${s.people.activeStaff}${s.people.onLeaveToday ? ` (on leave: ${s.people.names.join(", ")})` : ""}`]);
  const money: [string, string][] = [];
  if (s.expenses) { money.push(["Expenses today", kes(s.expenses.today)]); money.push(["Expenses month to date", kes(s.expenses.mtd)]); }
  if (s.budget && s.budget.budgeted > 0) {
    money.push([`Income vs budget (${s.budget.month})`, `${s.budget.pctOfBudget}% · ${kes(s.budget.actual)} of ${kes(s.budget.budgeted)}`]);
    money.push(["Pro-rata target by today", kes(s.budget.proRataBudget)]);
  }
  const waiting = s.approvals.byType.filter((a) => a.count > 0);
  const sev = { critical: "Urgent", warning: "Check", info: "FYI" } as const;

  return (
    <Card className="p-4 sm:p-8" data-testid="daily-close-report">
      {/* Letterhead */}
      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <img src={chekataLogo} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover ring-1 ring-border" />
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight text-primary sm:text-xl" data-testid="text-daily-hotel">{hotel.name}</p>
            {hotel.address && <p className="text-xs text-muted-foreground">{hotel.address}</p>}
            {hotel.phone && <p className="text-xs text-muted-foreground">Tel: {hotel.phone}</p>}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-base font-bold tracking-wide sm:text-lg">DAILY CLOSE REPORT</p>
          <p className="text-xs text-muted-foreground" data-testid="text-daily-date">{longDate(s.date)}</p>
          <p className="text-xs text-muted-foreground">Generated {clock(s.generatedAt)} (EAT)</p>
        </div>
      </div>

      {/* Headline figures */}
      <div className={`mt-4 grid grid-cols-2 gap-2 ${kpis.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {kpis.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md border border-border bg-muted/40 px-3 py-2" data-testid={`kpi-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="truncate text-lg font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <Heading>Income today by stream</Heading>
      <ReportTable
        testId="table-daily-income"
        total
        cols={[{ label: "Stream", className: "w-[42%] sm:w-[34%]" }, { label: "Txns", align: "right", hideOnMobile: true, className: "w-[9%]" }, { label: "Today", align: "right" }, { label: "Yesterday", align: "right", hideOnMobile: true }, { label: "Month to date", align: "right" }]}
        rows={[
          ...streams.map((st) => [<StreamCell label={st.label} count={st.todayCount} yesterday={st.yesterday} />, st.todayCount || "—", kes(st.today), kes(st.yesterday), kes(st.mtd)]),
          [<StreamCell label="Total" yesterday={s.income.totalYesterday} />, "", kes(s.income.totalToday), kes(s.income.totalYesterday), kes(s.income.totalMtd)],
        ]}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">Recognised on check-in, event, show and sale dates; rent on payment date. Net of credit notes.</p>

      {(ops.length > 0 || s.arrivals.length > 0 || s.events.length > 0 || s.shows.length > 0) && (
        <>
          <Heading>Operations</Heading>
          <div className="space-y-4">
            {ops.length > 0 && <KV pairs={ops} testId="table-daily-ops" />}
            {s.arrivals.length > 0 && (
              <ReportTable cols={[{ label: "Arriving guest", className: "w-[45%]" }, { label: "Room" }, { label: "Balance", align: "right" }]}
                rows={s.arrivals.map((a) => [a.guestName, a.roomName ?? "—", a.balance > 0 ? `${kes(a.balance)} due` : "Paid"])} />
            )}
            {s.events.length > 0 && (
              <ReportTable cols={[{ label: "Event client", className: "w-[34%]" }, { label: "Venue" }, { label: "Time", hideOnMobile: true }, { label: "Amount", align: "right" }]}
                rows={s.events.map((e) => [e.clientName, e.facilityName ?? "—", [e.startTime, e.endTime].filter(Boolean).join("–") || "—", kes(e.amount)])} />
            )}
            {s.shows.length > 0 && (
              <ReportTable cols={[{ label: "Movie show", className: "w-[55%]" }, { label: "Time" }, { label: "Seats sold", align: "right" }]}
                rows={s.shows.map((m) => [m.title, m.time ?? "—", `${m.sold}/${m.capacity}`])} />
            )}
          </div>
        </>
      )}

      {(s.cash || s.receivables.length > 0 || money.length > 0) && (
        <>
          <Heading>Money position</Heading>
          <div className="space-y-4">
            {s.cash && (
              <ReportTable testId="table-daily-cash" total cols={[{ label: "Account", className: "w-[55%]" }, { label: "Balance", align: "right" }]}
                rows={[...s.cash.accounts.map((a) => [a.name, kes(a.balance)]), ["Total cash & bank", kes(s.cash.total)]]} />
            )}
            {s.receivables.length > 0 && (
              <ReportTable total cols={[{ label: "Owed to the hotel", className: "w-[48%]" }, { label: "Open", align: "right", className: "w-[16%]" }, { label: "Amount", align: "right" }]}
                rows={[...s.receivables.map((r) => [r.label, String(r.count), kes(r.amount)]), ["Total owed to the hotel", "", kes(s.receivables.reduce((a, r) => a + r.amount, 0))]]} />
            )}
            {money.length > 0 && <KV pairs={money} />}
          </div>
        </>
      )}

      <Heading>Approvals &amp; alerts</Heading>
      <div className="space-y-4">
        {waiting.length > 0
          ? <ReportTable cols={[{ label: "Awaiting approval", className: "w-[62%]" }, { label: "Count", align: "right" }]} rows={waiting.map((a) => [a.label, String(a.count)])} />
          : <p className="text-sm">No approvals waiting.</p>}
        {s.alerts.length > 0 && (
          <ReportTable testId="table-daily-alerts" cols={[{ label: "Level", className: "w-[18%] sm:w-[12%]" }, { label: "Alert" }]}
            rows={s.alerts.map((a) => [sev[a.severity], a.detail ? `${a.title} — ${a.detail}` : a.title])} />
        )}
      </div>

      <p className="mt-8 border-t border-border pt-3 text-center text-[11px] text-muted-foreground">
        Daily close report · {s.date} · Balances and approvals are as at the time generated.
      </p>
    </Card>
  );
}
