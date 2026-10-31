// Kitchen screen: live tickets for dishes marked "Send to kitchen", moved New → Preparing → Ready → Served.
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChefHat, Volume2, VolumeX, Undo2, Clock, Wine, UtensilsCrossed, MessageSquareWarning } from "lucide-react";
import { PageHeader } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
type Status = "new" | "preparing" | "ready" | "served";
interface KItem { id: number; name: string; quantity: number; notes: string | null; components: string | null; choices: { group: string; options: string[] }[]; status: Status; sentAt: number; readyAt: number | null; servedAt: number | null }
interface Ticket { orderId: number; orderNo: string; outlet: string; table: string | null; customerNo: string | null; customerName: string | null; servedBy: string | null; orderedAt: number; items: KItem[] }

const COLUMNS: { status: Status; title: string; next: Status; action: string }[] = [
  { status: "new", title: "New", next: "preparing", action: "Start preparing" },
  { status: "preparing", title: "Preparing", next: "ready", action: "Mark ready" },
  { status: "ready", title: "Ready to serve", next: "served", action: "Served" },
];
const PREV: Record<Status, Status | null> = { new: null, preparing: "new", ready: "preparing", served: "ready" };
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" });

function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.2, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.25); setTimeout(() => ctx.close(), 500);
  } catch { /* sound not available */ }
}

function TicketCard({ t, items, col, now, lateMin, onMove, busy }: { t: Ticket; items: KItem[]; col: typeof COLUMNS[number]; now: number; lateMin: number; onMove: (ids: number[], s: Status) => void; busy: boolean }) {
  const oldest = Math.min(...items.map((i) => i.sentAt));
  const mins = Math.floor((now - oldest) / 60000);
  const late = col.status !== "ready" && mins >= lateMin;
  const Icon = t.outlet === "bar" ? Wine : UtensilsCrossed;
  return (
    <Card className={`p-3 ${late ? "border-destructive" : ""}`} data-testid={`ticket-${col.status}-${t.orderNo}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-base font-semibold"><Icon className="h-4 w-4 shrink-0" /> {t.orderNo}{t.table ? ` · ${t.table}` : ""}</p>
          <p className="text-xs text-muted-foreground">{t.customerNo ?? ""}{t.customerName ? ` · ${t.customerName}` : ""}{t.servedBy ? ` · ${t.servedBy}` : ""}</p>
        </div>
        <Badge variant={late ? "destructive" : "outline"} className="shrink-0 gap-1 tabular-nums"><Clock className="h-3 w-3" /> {mins < 1 ? "now" : `${mins} min`}</Badge>
      </div>
      <ul className="mt-2 space-y-2">
        {items.map((i) => (
          <li key={i.id} className="rounded-md bg-muted/50 p-2" data-testid={`kitchen-item-${i.id}`}>
            <p className="text-sm font-semibold"><span className="tabular-nums">{i.quantity} ×</span> {i.name}</p>
            {i.choices.length > 0 && <p className="text-sm">{i.choices.map((c) => `${c.group}: ${c.options.join(", ")}`).join(" · ")}</p>}
            {i.components && <p className="text-xs text-muted-foreground">{i.components}</p>}
            {i.notes && <p className="mt-0.5 flex items-start gap-1 text-sm font-medium text-destructive"><MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {i.notes}</p>}
            <p className="text-[11px] text-muted-foreground">Ordered {clock(i.sentAt)}{i.readyAt ? ` · ready ${clock(i.readyAt)}` : ""}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button className="flex-1" onClick={() => onMove(items.map((i) => i.id), col.next)} disabled={busy} data-testid={`button-kitchen-${col.next}-${t.orderNo}`}>{col.action}</Button>
        {PREV[col.status] && <Button variant="outline" size="icon" onClick={() => onMove(items.map((i) => i.id), PREV[col.status]!)} disabled={busy} title="Move back"><Undo2 className="h-4 w-4" /></Button>}
      </div>
    </Card>
  );
}

export default function KitchenPage() {
  const { toast } = useToast();
  const [outlet, setOutlet] = useState<string>(() => localStorage.getItem("kitchen.outlet") ?? "restaurant");
  const [sound, setSound] = useState(() => localStorage.getItem("kitchen.sound") === "1");
  const [lateMin, setLateMin] = useState(() => Number(localStorage.getItem("kitchen.late") ?? 20));
  const [now, setNow] = useState(Date.now());
  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({ queryKey: ["/api/kitchen/tickets"], refetchInterval: 5000 });
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { localStorage.setItem("kitchen.outlet", outlet); }, [outlet]);
  useEffect(() => { localStorage.setItem("kitchen.sound", sound ? "1" : "0"); }, [sound]);
  useEffect(() => { localStorage.setItem("kitchen.late", String(lateMin)); }, [lateMin]);

  const shown = tickets.filter((t) => outlet === "all" || t.outlet === outlet);
  useEffect(() => {
    const ids = new Set(shown.flatMap((t) => t.items.filter((i) => i.status === "new").map((i) => i.id)));
    if (seen.current && sound && Array.from(ids).some((id) => !seen.current!.has(id))) beep();
    seen.current = ids;
  }, [tickets, outlet, sound]);

  const move = useMutation({
    mutationFn: async (v: { ids: number[]; status: Status }) => apiRequest("POST", "/api/kitchen/items/status", { itemIds: v.ids, status: v.status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/kitchen/tickets"] }); queryClient.invalidateQueries({ queryKey: ["/api/pos/customers"] }); },
    onError: (e) => toast({ title: "Couldn't update", description: errMsg(e), variant: "destructive" }),
  });
  const served = shown.flatMap((t) => t.items.filter((i) => i.status === "served").map((i) => ({ t, i }))).sort((a, b) => (b.i.servedAt ?? 0) - (a.i.servedAt ?? 0)).slice(0, 12);

  return (
  <div className="w-full space-y-4 p-4 sm:p-6">
      <PageHeader title="Kitchen" description="New orders appear here automatically. Move each ticket along as you cook." action={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={outlet} onValueChange={setOutlet}>
            <SelectTrigger className="w-36" data-testid="select-kitchen-outlet"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="restaurant">Restaurant</SelectItem><SelectItem value="bar">Bar</SelectItem><SelectItem value="all">Bar & restaurant</SelectItem></SelectContent>
          </Select>
          <Select value={String(lateMin)} onValueChange={(v) => setLateMin(Number(v))}>
            <SelectTrigger className="w-44" data-testid="select-kitchen-late"><SelectValue /></SelectTrigger>
            <SelectContent>{[10, 15, 20, 30, 45].map((m) => <SelectItem key={m} value={String(m)}>Late after {m} min</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={() => { setSound(!sound); if (!sound) beep(); }} data-testid="button-kitchen-sound">{sound ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />} Sound {sound ? "on" : "off"}</Button>
        </div>
      } />
      {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading tickets…</p> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const frags = shown.map((t) => ({ t, items: t.items.filter((i) => i.status === col.status) })).filter((f) => f.items.length)
              .sort((a, b) => Math.min(...a.items.map((i) => i.sentAt)) - Math.min(...b.items.map((i) => i.sentAt)));
            return (
              <section key={col.status} className="space-y-3" data-testid={`column-${col.status}`}>
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{col.title} <Badge variant="secondary">{frags.reduce((s, f) => s + f.items.length, 0)}</Badge></h2>
                {frags.length === 0 ? <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing here.</div> :
                  frags.map((f) => <TicketCard key={f.t.orderId} t={f.t} items={f.items} col={col} now={now} lateMin={lateMin} busy={move.isPending} onMove={(ids, status) => move.mutate({ ids, status })} />)}
              </section>
            );
          })}
        </div>
      )}
      {served.length > 0 && (
        <Card className="p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ChefHat className="h-4 w-4" /> Served in the last 2 hours</h2>
          <div className="divide-y divide-border text-sm">
            {served.map(({ t, i }) => (
              <div key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">{t.orderNo}{t.table ? ` · ${t.table}` : ""} — {i.quantity} × {i.name} <span className="text-muted-foreground">· {i.servedAt ? clock(i.servedAt) : ""}</span></span>
                <Button size="sm" variant="ghost" onClick={() => move.mutate({ ids: [i.id], status: "ready" })} disabled={move.isPending} data-testid={`button-unserve-${i.id}`}><Undo2 className="h-4 w-4 mr-1" /> Undo</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
