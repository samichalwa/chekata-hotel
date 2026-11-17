// Message Log: every text the system tried to send and every invoice, receipt or credit note it emailed.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, RefreshCw, FileText } from "lucide-react";
import { PageHeader } from "@/components/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmsLogTab } from "@/components/sms-log";
import { formatKES, titleCase, todayISO } from "@/lib/format";

type Row = { id: number; createdAt: number; docType: string; category: string; sourceId: number; recipientName: string | null; recipientEmail: string | null; amount: number; status: "sent" | "failed" | "skipped"; error: string | null; pdfUrl: string | null };
type Resp = { from: string; to: string; summary: { total: number; sent: number; failed: number; skipped: number }; rows: Row[]; truncated: boolean };

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const time = (ms: number) => new Date(ms).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const CATEGORY: Record<string, string> = { accommodation: "Accommodation", facility: "Conference / Movie room", bar: "Bar", restaurant: "Restaurant", movie: "Movie room", water: "Water sales", water_bill: "Metered water", water_deposit: "Water deposit", tenancy: "Shop rent" };
const STATUS: Record<Row["status"], { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Sent", variant: "secondary" }, failed: { label: "Failed", variant: "destructive" }, skipped: { label: "No email on file", variant: "outline" },
};

function EmailLogTab() {
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ from, to, ...(status !== "all" ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const { data, isLoading, isFetching, error, refetch } = useQuery<Resp>({ queryKey: [`/api/message-log/emails?${params.toString()}`] });
  const s = data?.summary;
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <div className="text-sm font-medium flex items-center gap-2"><Mail className="h-4 w-4" />Emails</div>
          <p className="text-xs text-muted-foreground">Every invoice, receipt and credit note the system emailed, with its PDF. "Sent" means the mail server accepted it.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="em-from">From</Label><Input id="em-from" type="date" className="w-40" value={from} max={todayISO()} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} data-testid="input-email-from" /></div>
          <div className="space-y-1.5"><Label htmlFor="em-to">To</Label><Input id="em-to" type="date" className="w-40" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} data-testid="input-email-to" /></div>
          <div className="space-y-1.5"><Label>Status</Label>
            <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44" data-testid="select-email-status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="skipped">No email on file</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5 flex-1 min-w-[12rem]"><Label htmlFor="em-q">Search</Label><Input id="em-q" placeholder="Name, email or type" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-email-search" /></div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-email-refresh"><RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
        {s && (
          <div className="flex flex-wrap gap-2 text-sm" data-testid="text-email-summary">
            <Badge variant="outline">{s.total} email{s.total === 1 ? "" : "s"}</Badge>
            <Badge variant="secondary">{s.sent} sent</Badge>
            {s.failed > 0 && <Badge variant="destructive">{s.failed} failed</Badge>}
            {s.skipped > 0 && <Badge variant="outline">{s.skipped} with no email on file</Badge>}
          </div>
        )}
      </Card>
      {error ? <Card className="p-6 text-sm text-destructive">{errMsg(error)}</Card>
        : isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        : !data?.rows.length ? <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-email-log">No emails {from === to ? `on ${from}` : `from ${from} to ${to}`}{status !== "all" || q ? " match these filters" : ""}.</Card>
        : (
          <div className="space-y-2">
            {data.rows.map((r) => (
              <Card key={r.id} className="p-3" data-testid={`row-email-${r.id}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="tabular-nums text-muted-foreground whitespace-nowrap">{time(r.createdAt)}</span>
                  <span className="font-medium">{r.recipientName || "—"}</span>
                  {r.recipientEmail && <span className="text-muted-foreground break-all">{r.recipientEmail}</span>}
                  <Badge variant="outline">{titleCase(r.docType.replace(/_/g, " "))} · {CATEGORY[r.category] ?? titleCase(r.category.replace(/_/g, " "))}</Badge>
                  <Badge variant={STATUS[r.status]?.variant ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  <span className="tabular-nums">{formatKES(r.amount)}</span>
                  {r.pdfUrl && <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline" data-testid={`link-email-pdf-${r.id}`}><FileText className="h-4 w-4" />PDF</a>}
                </div>
                {r.status === "failed" && r.error && <p className="mt-1 text-xs text-destructive" data-testid={`error-email-${r.id}`}>{r.error}</p>}
              </Card>
            ))}
            {data.truncated && <p className="text-xs text-muted-foreground">Showing the latest 2,000 emails. Choose a shorter date range to see the rest.</p>}
          </div>
        )}
    </div>
  );
}

export default function MessageLogPage() {
  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      <PageHeader title="Message Log" description="Every text and email the system has sent, kept for reference. Choose dates and search by name, phone or type." />
      <Tabs defaultValue="sms">
        <TabsList>
          <TabsTrigger value="sms" data-testid="tab-log-sms">Texts (SMS)</TabsTrigger>
          <TabsTrigger value="email" data-testid="tab-log-email">Emails</TabsTrigger>
        </TabsList>
        <TabsContent value="sms" className="pt-4"><SmsLogTab /></TabsContent>
        <TabsContent value="email" className="pt-4"><EmailLogTab /></TabsContent>
      </Tabs>
    </div>
  );
}
