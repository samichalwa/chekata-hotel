// Integrity checks: read-only reports that confirm the books, bookings, stock and payroll agree.
// Daily checks run nightly and on demand; the tax check runs once a month (previous month) and on demand.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, AlertTriangle, XCircle, Play, Download, Save } from "lucide-react";
import { PageHeader } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import type { Settings } from "@shared/schema";

type Status = "pass" | "warn" | "fail";
interface CheckItem { label: string; detail: string; link?: string }
interface Check { id: string; group: string; title: string; description: string; status: Status; summary: string; count: number; items: CheckItem[] }
interface TaxRow { taxName: string; ratePercent: number; stream: string; gross: number; base: number; tax: number; creditGross: number; creditTax: number; netTax: number; documents: number }
interface Run { id: number; kind: "daily" | "tax"; period: string; ranAt: number; ranBy: string; fails: number; warns: number; checks: Check[]; taxSummary?: TaxRow[] }
interface Latest { run: Run | null; history: { id: number; period: string; ran_at: string; ran_by: string; fails: number; warns: number }[]; previousMonth: string }

const kes = (v: number) => `KES ${Math.round(v || 0).toLocaleString("en-KE")}`;
const when = (ms: number) => new Date(Number(ms)).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("en-KE", { month: "long", year: "numeric" });

const STATUS: Record<Status, { label: string; icon: any; cls: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, cls: "text-emerald-700 dark:text-emerald-400" },
  warn: { label: "Warning", icon: AlertTriangle, cls: "text-amber-700 dark:text-amber-400" },
  fail: { label: "Fail", icon: XCircle, cls: "text-red-700 dark:text-red-400" },
};

function CheckCard({ c }: { c: Check }) {
  const [open, setOpen] = useState(c.status === "fail");
  const S = STATUS[c.status];
  return (
    <Card className="p-4" data-testid={`card-check-${c.id}`}>
      <div className="flex items-start gap-3">
        <S.icon className={`h-5 w-5 mt-0.5 shrink-0 ${S.cls}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="font-semibold text-sm">{c.id} · {c.title}</h3>
            <span className={`text-xs font-semibold ${S.cls}`} data-testid={`status-check-${c.id}`}>{S.label}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
          <p className="text-sm mt-1.5" data-testid={`text-check-summary-${c.id}`}>{c.summary}</p>
          {c.items.length > 0 && (
            <>
              <Button variant="ghost" size="sm" className="px-0 h-7 mt-1" onClick={() => setOpen((v) => !v)} data-testid={`button-toggle-check-${c.id}`}>
                {open ? "Hide records" : `Show ${c.count > c.items.length ? `first ${c.items.length} of ${c.count}` : c.items.length} record${c.items.length === 1 ? "" : "s"}`}
              </Button>
              {open && (
                <ul className="mt-1 divide-y divide-border border-t border-border">
                  {c.items.map((it, i) => (
                    <li key={i} className="py-2 text-sm">
                      <div className="font-medium [overflow-wrap:anywhere]">{it.link ? <Link href={it.link} className="underline-offset-2 hover:underline">{it.label}</Link> : it.label}</div>
                      <div className="text-muted-foreground [overflow-wrap:anywhere]">{it.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function RunHeader({ run, onRun, running, runLabel, extra }: { run: Run | null; onRun: () => void; running: boolean; runLabel: string; extra?: React.ReactNode }) {
  return (
    <Card className="p-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {run ? (
          <>
            <div className="text-sm font-semibold" data-testid="text-run-result">
              {run.fails > 0 ? <span className={STATUS.fail.cls}>{run.fails} failed</span> : <span className={STATUS.pass.cls}>No failures</span>}
              <span className="text-muted-foreground font-normal"> · {run.warns} warning{run.warns === 1 ? "" : "s"} · {run.checks.length - run.fails - run.warns} passed</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Last run {when(run.ranAt)} by {run.ranBy}</div>
          </>
        ) : <div className="text-sm text-muted-foreground">Not run yet.</div>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {extra}
        {run && (
          <Button variant="outline" size="sm" asChild data-testid={`button-excel-${run.kind}`}>
            <a href={`/api/integrity/runs/${run.id}/excel`}><Download className="h-3.5 w-3.5 mr-1.5" />Excel</a>
          </Button>
        )}
        <Button size="sm" onClick={onRun} disabled={running} data-testid={`button-run-${runLabel}`}>
          <Play className="h-3.5 w-3.5 mr-1.5" />{running ? "Running…" : "Run checks"}
        </Button>
      </div>
    </Card>
  );
}

function Groups({ run }: { run: Run }) {
  const groups = Array.from(new Set(run.checks.map((c) => c.group)));
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{g}</h2>
          {run.checks.filter((c) => c.group === g).map((c) => <CheckCard key={c.id} c={c} />)}
        </section>
      ))}
    </div>
  );
}

function TaxSummary({ rows }: { rows: TaxRow[] }) {
  if (!rows.length) return <Card className="p-4 text-sm text-muted-foreground">No taxed sales in this month.</Card>;
  const names = Array.from(new Set(rows.map((r) => r.taxName)));
  const num = (v: number) => Math.round(v || 0).toLocaleString("en-KE");
  const hide = "hidden sm:table-cell";
  return (
    <Card className="p-4">
      <h2 className="font-semibold text-sm mb-2">Tax summary · KES</h2>
      <table className="w-full table-fixed text-[13px] sm:text-sm" data-testid="table-tax-summary">
        <thead><tr className="border-b border-border text-[11px] text-muted-foreground">
          <th className="text-left py-1.5 w-[40%] sm:w-[34%]">Tax / stream</th><th className={`text-right ${hide}`}>Docs</th><th className="text-right">Gross sales</th><th className="text-right">Tax</th><th className={`text-right ${hide}`}>Reversed</th><th className="text-right">Net due</th>
        </tr></thead>
        <tbody>
          {names.map((name) => {
            const rs = rows.filter((r) => r.taxName === name);
            const t = (k: keyof TaxRow) => rs.reduce((a, r) => a + Number(r[k] || 0), 0);
            return [
              ...rs.map((r) => (
                <tr key={`${name}-${r.stream}-${r.ratePercent}`} className="border-b border-border/50 tabular-nums align-top">
                  <td className="py-1.5 pr-1 [overflow-wrap:anywhere]">{r.taxName} {r.ratePercent}%<span className="block text-[11px] text-muted-foreground sm:inline sm:text-sm sm:text-foreground"><span className="hidden sm:inline"> · </span>{r.stream}</span></td>
                  <td className={`text-right py-1.5 ${hide}`}>{r.documents}</td><td className="text-right py-1.5">{num(r.gross)}</td><td className="text-right py-1.5">{num(r.tax)}</td><td className={`text-right py-1.5 ${hide}`}>{num(r.creditTax)}</td><td className="text-right py-1.5">{num(r.netTax)}</td>
                </tr>
              )),
              <tr key={`${name}-total`} className="border-t-2 border-foreground/70 font-semibold tabular-nums align-top">
                <td className="py-1.5 pr-1">Total {name}</td><td className={`text-right py-1.5 ${hide}`}>{t("documents")}</td><td className="text-right py-1.5">{num(t("gross"))}</td><td className="text-right py-1.5">{num(t("tax"))}</td><td className={`text-right py-1.5 ${hide}`}>{num(t("creditTax"))}</td><td className="text-right py-1.5">{num(t("netTax"))}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground mt-2">Gross sales are tax-inclusive. Reversed = tax on credit notes. Full detail in the Excel download.</p>
    </Card>
  );
}

function Schedule() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const [time, setTime] = useState("02:00");
  const [day, setDay] = useState("1");
  useEffect(() => { if (settings) { setTime((settings as any).integrityCheckTime || "02:00"); setDay(String((settings as any).integrityTaxDay || 1)); } }, [settings]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/settings", { integrityCheckTime: time, integrityTaxDay: Math.min(Math.max(Number(day) || 1, 1), 28) })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); toast({ title: "Schedule saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  if (!settings) return null;
  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-semibold text-sm">Automatic runs</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="ic-time">Daily checks at (Nairobi)</Label><Input id="ic-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-36" data-testid="input-integrity-time" /></div>
        <div className="space-y-1.5"><Label htmlFor="ic-day">Tax check on day of month</Label><Input id="ic-day" type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} className="w-28" data-testid="input-integrity-tax-day" /></div>
        <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending || !/^\d{2}:\d{2}$/.test(time)} data-testid="button-save-integrity-schedule"><Save className="h-3.5 w-3.5 mr-1.5" />Save</Button>
      </div>
      <p className="text-xs text-muted-foreground">The tax check covers the previous calendar month. Failures appear as alerts on the dashboard and in the daily close report.</p>
    </Card>
  );
}

function DailyTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Latest>({ queryKey: ["/api/integrity/latest?kind=daily"] });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrity/run", { kind: "daily" })).json(),
    onSuccess: (r: Run) => { queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/integrity") || q.queryKey[0] === "/api/director/summary" }); toast({ title: r.fails ? `${r.fails} check${r.fails === 1 ? "" : "s"} failed` : "All checks passed", variant: r.fails ? "destructive" : undefined }); },
    onError: (e: any) => toast({ title: "Couldn't run checks", description: e?.message, variant: "destructive" }),
  });
  if (isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  return (
    <div className="space-y-4">
      <RunHeader run={data?.run ?? null} onRun={() => run.mutate()} running={run.isPending} runLabel="daily" />
      {data?.run && <Groups run={data.run} />}
    </div>
  );
}

function TaxTab() {
  const { toast } = useToast();
  const { data: base } = useQuery<Latest>({ queryKey: ["/api/integrity/latest?kind=tax"] });
  const [month, setMonth] = useState<string>("");
  useEffect(() => { if (base && !month) setMonth(base.run?.period || base.previousMonth); }, [base, month]);
  const { data, isLoading } = useQuery<Latest>({ queryKey: [`/api/integrity/latest?kind=tax&period=${month}`], enabled: !!month });
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrity/run", { kind: "tax", month })).json(),
    onSuccess: (r: Run) => { queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/integrity") || q.queryKey[0] === "/api/director/summary" }); toast({ title: r.fails ? `Tax check: ${r.fails} failed` : `Tax check for ${monthLabel(month)} passed`, variant: r.fails ? "destructive" : undefined }); },
    onError: (e: any) => toast({ title: "Couldn't run the tax check", description: e?.message, variant: "destructive" }),
  });
  const picker = (
    <div className="space-y-1.5">
      <Label>Month</Label>
      <Select value={month} onValueChange={setMonth}>
        <SelectTrigger className="w-44" data-testid="select-tax-month"><SelectValue placeholder="Month" /></SelectTrigger>
        <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="space-y-4">
      <RunHeader run={data?.run ?? null} onRun={() => run.mutate()} running={run.isPending || !month} runLabel="tax" extra={picker} />
      {isLoading ? <Skeleton className="h-40 w-full" /> : data?.run && (<><TaxSummary rows={data.run.taxSummary ?? []} /><Groups run={data.run} /></>)}
    </div>
  );
}

export default function Integrity() {
  const { data: user } = useCurrentUser();
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <PageHeader title="Integrity checks" description="Read-only checks that the money, bookings, stock, payroll and tax all agree. Nothing is changed — each problem links to the record to fix." />
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily" data-testid="tab-integrity-daily">Daily checks</TabsTrigger>
          <TabsTrigger value="tax" data-testid="tab-integrity-tax">Monthly tax check</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="pt-4"><DailyTab /></TabsContent>
        <TabsContent value="tax" className="pt-4"><TaxTab /></TabsContent>
      </Tabs>
      {user?.isAdmin && <Schedule />}
    </div>
  );
}
