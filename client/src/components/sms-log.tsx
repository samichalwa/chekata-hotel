// Settings → SMS log: every SMS the system tried to send (bills, receipts, bookings, reminders, reports…).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/format";

type Row = { id: number; createdAt: number; recipient: string | null; phone: string | null; message: string; source: string; status: "sent" | "failed" | "test"; error: string | null; providerStatus: string | null; cost: string | null; messageId: string | null };
type Resp = { from: string; to: string; summary: { total: number; sent: number; failed: number; test: number; cost: number }; rows: Row[]; truncated: boolean };

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const time = (ms: number) => new Date(ms).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<Row["status"], { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Sent", variant: "secondary" }, failed: { label: "Failed", variant: "destructive" }, test: { label: "Test only", variant: "outline" },
};

export function SmsLogTab() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ from, to, ...(status !== "all" ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const { data, isLoading, isFetching, error, refetch } = useQuery<Resp>({ queryKey: [`/api/settings/sms-log?${params.toString()}`] });
  const s = data?.summary;
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <div className="text-sm font-medium flex items-center gap-2"><MessageSquare className="h-4 w-4" />SMS log</div>
          <p className="text-xs text-muted-foreground">Every text the system tries to send: bills, receipts, booking confirmations, reminders and reports. "Sent" means Africa's Talking accepted it; delivery to the phone shows in your Africa's Talking account.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="sms-from">From</Label><Input id="sms-from" type="date" className="w-40" value={from} max={todayISO()} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} data-testid="input-sms-from" /></div>
          <div className="space-y-1.5"><Label htmlFor="sms-to">To</Label><Input id="sms-to" type="date" className="w-40" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} data-testid="input-sms-to" /></div>
          <div className="space-y-1.5"><Label>Status</Label>
            <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36" data-testid="select-sms-status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="test">Test only</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5 flex-1 min-w-[12rem]"><Label htmlFor="sms-q">Search</Label><Input id="sms-q" placeholder="Name, phone, text or type" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-sms-search" /></div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-sms-refresh"><RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
        {s && (
          <div className="flex flex-wrap gap-2 text-sm" data-testid="text-sms-summary">
            <Badge variant="outline">{s.total} message{s.total === 1 ? "" : "s"}</Badge>
            <Badge variant="secondary">{s.sent} sent</Badge>
            {s.failed > 0 && <Badge variant="destructive">{s.failed} failed</Badge>}
            {s.test > 0 && <Badge variant="outline">{s.test} test only</Badge>}
            {s.cost > 0 && <Badge variant="outline">Cost KES {s.cost.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Badge>}
          </div>
        )}
      </Card>
      {error ? <Card className="p-6 text-sm text-destructive">{errMsg(error)}</Card>
        : isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        : !data?.rows.length ? <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-sms-log">No texts {from === to ? `on ${from}` : `from ${from} to ${to}`}{status !== "all" || q ? " match these filters" : ""}. Texts are listed from the day this log was switched on.</Card>
        : (
          <div className="space-y-2">
            {data.rows.map((r) => (
              <Card key={r.id} className="p-3" data-testid={`row-sms-${r.id}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="tabular-nums text-muted-foreground whitespace-nowrap">{time(r.createdAt)}</span>
                  <span className="font-medium tabular-nums">{r.phone || r.recipient || "—"}</span>
                  <Badge variant="outline">{r.source}</Badge>
                  <Badge variant={STATUS[r.status]?.variant ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  {r.cost && <span className="text-xs text-muted-foreground">{r.cost}</span>}
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap break-words">{r.message}</p>
                {r.status === "failed" && r.error && <p className="mt-1 text-xs text-destructive" data-testid={`error-sms-${r.id}`}>{r.error}</p>}
              </Card>
            ))}
            {data.truncated && <p className="text-xs text-muted-foreground">Showing the latest 2,000 texts. Choose a shorter date range to see the rest.</p>}
          </div>
        )}
    </div>
  );
}
