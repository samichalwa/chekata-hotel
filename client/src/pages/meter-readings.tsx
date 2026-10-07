// Meter Readings — for meter readers. Water meters (metered water customers) and electricity meters (tenant
// leases with an electricity rate). Units only: no tariffs, charges or balances are shown here. Saved readings
// are billed by the system automatically once the review window (Settings below, admin only) has passed.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge, Droplets, Zap, Save, Camera, ScanLine, ImageIcon, Settings2, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { todayISO } from "@/lib/format";
import { monthLabel } from "@shared/water-billing";
import { photoToJpeg } from "@/components/metered-water";

type Kind = "water" | "electricity";
type Row = {
  id: number; name: string; ref: string; location: string | null; meterNumber: string | null; previousReading: number | null; needsStart: boolean; laterMonth: string | null;
  reading: null | {
    id: number; currentReading: number; startReading?: number; consumption: number; readingDate: string; meterReplaced?: boolean; oldMeterFinal?: number | null; newMeterStart?: number | null;
    invoiced: boolean; invoiceNumber: string | null; invoiceStatus: string | null; awaitingStaff: boolean; nothingToBill?: boolean; autoBillAt: number | null;
    photoUrl: string | null; photoReading: number | null; photoMeterVerified: number | null;
  };
};
type ReaderSettings = { delayHours: number; autoFrom: number | null; electricityDueDays: number; electricityIncomeAccountId: number | null; electricitySms: number; visionReady: boolean };
type ScanResult = { status: string; message: string; photoUrl: string; token: string | null; detected: { meterNumber: string | null; reading: number | null; confidence: string; notes?: string | null }; customer: { id: number; name: string; accountNo: string; meterNumber: string | null } | null };
type Draft = { current: string; start: string; replaced: boolean; oldFinal: string; newStart: string; photo?: { token: string; url: string; reading: number | null; verified: boolean } | null };

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const thisMonth = () => todayISO().slice(0, 7);
const UNIT: Record<Kind, string> = { water: "m³", electricity: "kWh" };
const fmtUnits = (v: number, k: Kind) => `${Math.round(v * 1000) / 1000} ${UNIT[k]}`;
const when = (ms: number) => {
  const d = new Date(ms); const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = d.toDateString() === new Date().toDateString() ? "today" : d.toDateString() === new Date(Date.now() + 86400_000).toDateString() ? "tomorrow" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${day} ${t}`;
};

export default function MeterReadingsPage() {
  const { data: user } = useCurrentUser();
  const { data: settings } = useQuery<ReaderSettings>({ queryKey: ["/api/meter-reader/settings"] });
  const [tab, setTab] = useState<Kind>("water");
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl">
      <div className="flex items-start gap-3">
        <Gauge className="h-6 w-6 text-primary mt-1 shrink-0" />
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Meter Readings</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Record this month's water and electricity meter readings. Saved readings are billed automatically
            {settings ? (settings.delayHours ? ` ${settings.delayHours} hour${settings.delayHours === 1 ? "" : "s"} after saving` : " shortly after saving") : " after a review window"}, so a mistake can be corrected before then.
          </p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
        <TabsList>
          <TabsTrigger value="water" data-testid="tab-water-meters"><Droplets className="h-4 w-4 mr-1" />Water</TabsTrigger>
          <TabsTrigger value="electricity" data-testid="tab-electricity-meters"><Zap className="h-4 w-4 mr-1" />Electricity</TabsTrigger>
        </TabsList>
        <TabsContent value="water" className="mt-4"><ReaderSheet kind="water" settings={settings} /></TabsContent>
        <TabsContent value="electricity" className="mt-4"><ReaderSheet kind="electricity" settings={settings} /></TabsContent>
      </Tabs>
      {!!user?.isAdmin && !!settings && <BillingSettingsCard settings={settings} />}
    </div>
  );
}

function ReaderSheet({ kind, settings }: { kind: Kind; settings?: ReaderSettings }) {
  const { toast } = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [readingDate, setReadingDate] = useState(todayISO());
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const key = `/api/meter-reader/${kind}`;
  const { data: rows = [], isLoading, error } = useQuery<Row[]>({ queryKey: [key, month], queryFn: async () => (await apiRequest("GET", `${key}?month=${month}`)).json(), enabled: /^\d{4}-\d{2}$/.test(month) });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [scanFor, setScanFor] = useState<number | null>(null);
  const [scan, setScan] = useState<{ busy: boolean; preview?: string; result?: ScanResult; error?: string; forId: number | null } | null>(null);
  const vision = !!settings?.visionReady;
  const noun = kind === "water" ? "customer" : "tenant";

  useEffect(() => {
    const d: Record<number, Draft> = {};
    for (const r of rows) d[r.id] = r.reading
      ? { current: String(r.reading.currentReading), start: r.reading.startReading === undefined ? "" : String(r.reading.startReading), replaced: !!r.reading.meterReplaced, oldFinal: r.reading.oldMeterFinal == null ? "" : String(r.reading.oldMeterFinal), newStart: r.reading.newMeterStart == null ? "0" : String(r.reading.newMeterStart) }
      : { current: "", start: "", replaced: false, oldFinal: "", newStart: "0" };
    setDrafts(d); setErrors({});
  }, [rows]);

  const locked = (r: Row) => !!r.reading?.invoiced || !!r.laterMonth || !!r.reading?.awaitingStaff;
  // Electricity: the first reading for a meter also needs its start reading (no previous month to carry forward).
  const prevOf = (r: Row, d: Draft) => r.previousReading ?? (d.start === "" ? null : Number(d.start));
  const firstReading = (r: Row) => kind === "electricity" && r.needsStart;
  const preview = (r: Row) => {
    const d = drafts[r.id]; if (!d || d.current === "") return null;
    const cur = Number(d.current);
    const prev = prevOf(r, d);
    if (prev === null) return { used: null as number | null, error: firstReading(r) ? "First reading for this meter — enter the start reading too." : null };
    if (d.replaced) {
      const oldF = Number(d.oldFinal || 0), ns = Number(d.newStart || 0);
      if (oldF < prev) return { used: null, error: `Old meter final can't be below ${prev}` };
      if (cur < ns) return { used: null, error: "Below the new meter's start" };
      return { used: (oldF - prev) + (cur - ns), error: null };
    }
    if (cur < prev) return { used: null, error: kind === "water" ? `Lower than last reading (${prev}). Tick "Meter replaced" if it was changed or reset.` : `Lower than last reading (${prev}). If the meter was replaced, tell the Tenants office.` };
    return { used: cur - prev, error: null };
  };
  const changed = rows.filter((r) => {
    if (locked(r)) return false;
    const d = drafts[r.id]; if (!d || d.current === "") return false;
    if (!r.reading) return true;
    return !!d.photo || Number(d.current) !== r.reading.currentReading || !!d.replaced !== !!r.reading.meterReplaced
      || (d.replaced && (Number(d.oldFinal) !== r.reading.oldMeterFinal || Number(d.newStart) !== r.reading.newMeterStart));
  });
  const blocking = changed.some((r) => preview(r)?.error);
  const set = (id: number, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const save = useMutation({
    mutationFn: async () => {
      const readings = changed.map((r) => {
        const d = drafts[r.id];
        return kind === "water"
          ? { customerId: r.id, currentReading: Number(d.current), readingDate, meterReplaced: d.replaced, oldMeterFinal: d.replaced ? Number(d.oldFinal || 0) : null, newMeterStart: d.replaced ? Number(d.newStart || 0) : null, photoToken: d.photo?.token ?? null }
          : { leaseId: r.id, currentReading: Number(d.current), startReading: d.start === "" ? null : Number(d.start), readingDate, photoToken: d.photo?.token ?? null };
      });
      return (await apiRequest("PUT", key, { month, readings })).json();
    },
    onSuccess: (r: any) => {
      const e: Record<number, string> = {}; for (const x of r.errors ?? []) e[x.customerId ?? x.leaseId] = x.error; setErrors(e);
      queryClient.invalidateQueries({ queryKey: [key] });
      queryClient.invalidateQueries({ queryKey: ["/api/water-billing/readings"] });
      toast({ title: `${r.saved} reading${r.saved === 1 ? "" : "s"} saved`, description: r.errors?.length ? `${r.errors.length} could not be saved — see the highlighted rows.` : "They will be billed automatically after the review window.", variant: r.errors?.length ? "destructive" : undefined });
    },
    onError: (e) => toast({ title: "Couldn't save readings", description: errMsg(e), variant: "destructive" }),
  });

  const openCamera = (id: number | null) => { setScanFor(id); if (fileRef.current) { fileRef.current.value = ""; fileRef.current.click(); } };
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    const forId = scanFor;
    setScan({ busy: true, forId });
    try {
      const jpeg = await photoToJpeg(file);
      setScan({ busy: true, preview: jpeg, forId });
      const result: ScanResult = await (await apiRequest("POST", "/api/meter-reader/scan", { kind, imageBase64: jpeg, mimeType: "image/jpeg", targetId: forId })).json();
      setScan({ busy: false, preview: jpeg, result, forId });
    } catch (e) { setScan((s) => ({ busy: false, preview: s?.preview, error: errMsg(e), forId })); }
  };
  const applyScan = () => {
    const r = scan?.result; if (!r?.token || !r.customer) return;
    const row = rows.find((x) => x.id === r.customer!.id);
    if (!row) { toast({ title: `Not on this month's sheet`, description: `${r.customer.name} is not active for ${monthLabel(month)}.`, variant: "destructive" }); return; }
    if (locked(row)) { toast({ title: `${row.name} is already billed for ${monthLabel(month)}`, description: "The office must cancel that bill before the reading can change.", variant: "destructive" }); return; }
    set(row.id, { photo: { token: r.token, url: r.photoUrl, reading: r.detected.reading, verified: r.status === "matched" }, ...(r.detected.reading !== null ? { current: String(r.detected.reading) } : {}) });
    setScan(null);
    setTimeout(() => document.getElementById(`mr-${kind}-${row.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    toast({ title: `Reading filled in for ${row.name}`, description: "Check it against the photo, then press Save readings." });
  };

  const statusBadge = (r: Row) => {
    const x = r.reading;
    if (x?.invoiced) return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Billed {x.invoiceNumber}</Badge>;
    if (r.laterMonth) return <Badge variant="outline">Locked — {monthLabel(r.laterMonth)} read</Badge>;
    if (!x) return null;
    if (x.awaitingStaff) return <Badge variant="outline">Bill cancelled — office to re-bill</Badge>;
    if (x.nothingToBill) return <Badge variant="outline">No units used</Badge>;
    if (x.autoBillAt) return <Badge variant="outline" className="gap-1" data-testid={`badge-autobill-${kind}-${r.id}`}><Clock className="h-3 w-3" />Saved · bills {x.autoBillAt <= Date.now() ? "shortly" : when(x.autoBillAt)}</Badge>;
    return <Badge variant="outline">Saved · office to bill</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor={`mr-month-${kind}`}>Month</Label><Input id={`mr-month-${kind}`} type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} data-testid={`input-month-${kind}`} /></div>
        <div className="space-y-1.5"><Label htmlFor={`mr-date-${kind}`}>Date read</Label><Input id={`mr-date-${kind}`} type="date" className="w-44" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} data-testid={`input-date-${kind}`} /></div>
        <div className="flex-1" />
        {vision && <Button variant="outline" onClick={() => openCamera(null)} disabled={!rows.length} data-testid={`button-scan-${kind}`}><ScanLine className="h-4 w-4 mr-1" />Scan a meter</Button>}
        <Button disabled={!changed.length || blocking || save.isPending} onClick={() => save.mutate()} data-testid={`button-save-${kind}`}><Save className="h-4 w-4 mr-1" />{save.isPending ? "Saving…" : `Save readings${changed.length ? ` (${changed.length})` : ""}`}</Button>
      </Card>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} data-testid={`input-photo-${kind}`} />
      {error ? <Card className="p-6 text-sm text-destructive">{errMsg(error)}</Card> : isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card> : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground" data-testid={`empty-${kind}`}>
          {kind === "water" ? "No metered water customers yet. They are added in Water Sales → Metered customers." : "No electricity meters yet. A tenant appears here when their lease has an electricity rate per unit (Tenants → Leases)."}
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const d = drafts[r.id] ?? { current: "", start: "", replaced: false, oldFinal: "", newStart: "0" };
            const p = preview(r); const lk = locked(r);
            const err = errors[r.id] || p?.error;
            const showStart = kind === "electricity" && r.needsStart && !lk;
            return (
              <Card key={r.id} className={`p-3 ${err ? "border-destructive" : ""}`} data-testid={`row-${kind}-${r.id}`}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,0.6fr)_minmax(0,1fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name} <span className="text-xs text-muted-foreground font-normal">{r.ref}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{[r.meterNumber ? `Meter ${r.meterNumber}` : "No meter number registered", r.location].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex items-end gap-3">
                    {showStart ? (
                      <div className="space-y-1">
                        <Label htmlFor={`mr-start-${kind}-${r.id}`} className="text-xs text-muted-foreground font-normal">Start reading</Label>
                        <Input id={`mr-start-${kind}-${r.id}`} type="number" inputMode="decimal" step="0.01" min="0" className="w-28 tabular-nums" value={d.start} onChange={(e) => set(r.id, { start: e.target.value })} data-testid={`input-start-${kind}-${r.id}`} />
                      </div>
                    ) : (
                      <div><div className="text-xs text-muted-foreground">Previous</div><div className="tabular-nums font-medium h-9 flex items-center" data-testid={`text-prev-${kind}-${r.id}`}>{r.previousReading ?? "—"}</div></div>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor={`mr-${kind}-${r.id}`} className="text-xs text-muted-foreground font-normal">{d.replaced ? "New meter now" : "Current"}</Label>
                      <div className="flex items-center gap-1">
                        <Input id={`mr-${kind}-${r.id}`} type="number" inputMode="decimal" step={kind === "water" ? "0.001" : "0.01"} min="0" className="w-28 tabular-nums" disabled={lk} value={d.current} onChange={(e) => set(r.id, { current: e.target.value })} data-testid={`input-current-${kind}-${r.id}`} />
                        {vision && !lk && <Button size="icon" variant="ghost" aria-label={`Photo of ${r.name}'s meter`} onClick={() => openCamera(r.id)} data-testid={`button-photo-${kind}-${r.id}`}><Camera className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm">
                    {p?.used != null ? <div className="tabular-nums" data-testid={`text-used-${kind}-${r.id}`}><span className="font-medium">{fmtUnits(p.used, kind)}</span> used</div> : r.reading ? null : <span className="text-muted-foreground text-xs">Not read yet</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {statusBadge(r)}
                    {kind === "water" && !lk && (
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer"><Checkbox checked={d.replaced} onCheckedChange={(v) => set(r.id, { replaced: !!v })} data-testid={`check-replaced-${r.id}`} />Meter replaced</label>
                    )}
                  </div>
                </div>
                {d.replaced && !lk && (
                  <div className="mt-3 flex flex-wrap gap-3 rounded-md bg-muted p-2">
                    <div className="space-y-1"><Label className="text-xs">Old meter final reading</Label><Input type="number" step="0.001" className="w-32" value={d.oldFinal} onChange={(e) => set(r.id, { oldFinal: e.target.value })} data-testid={`input-old-final-${r.id}`} /></div>
                    <div className="space-y-1"><Label className="text-xs">New meter start reading</Label><Input type="number" step="0.001" className="w-32" value={d.newStart} onChange={(e) => set(r.id, { newStart: e.target.value })} data-testid={`input-new-start-${r.id}`} /></div>
                  </div>
                )}
                {(() => {
                  const ph = d.photo ? { url: d.photo.url, reading: d.photo.reading, verified: d.photo.verified, pending: true } : r.reading?.photoUrl ? { url: r.reading.photoUrl, reading: r.reading.photoReading, verified: r.reading.photoMeterVerified !== 0, pending: false } : null;
                  if (!ph) return null;
                  const edited = ph.reading !== null && d.current !== "" && Math.abs(Number(d.current) - ph.reading) > 0.0005;
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid={`photo-info-${kind}-${r.id}`}>
                      <a href={ph.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"><ImageIcon className="h-3.5 w-3.5" />Meter photo</a>
                      <span className="text-muted-foreground">{ph.reading === null ? "reading not readable" : `photo read ${ph.reading}`}</span>
                      {!ph.verified && <Badge variant="outline">Meter no. not verified</Badge>}
                      {edited && <Badge variant="outline">Changed by reader</Badge>}
                      {ph.pending && <span className="text-muted-foreground">· attached when you save</span>}
                      {ph.pending && <button type="button" className="text-muted-foreground underline" onClick={() => set(r.id, { photo: null })}>remove</button>}
                    </div>
                  );
                })()}
                {err && <p className="mt-2 text-xs text-destructive" data-testid={`error-${kind}-${r.id}`}>{err}</p>}
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!scan} onOpenChange={(o) => { if (!o && !scan?.busy) setScan(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{scan?.busy ? "Reading the photo…" : scan?.result?.status === "matched" || scan?.result?.status === "unverified" ? "Check the reading" : "Photo not used"}</DialogTitle>
            <DialogDescription>{scan?.forId ? `Taken from ${rows.find((x) => x.id === scan.forId)?.name ?? `this ${noun}`}'s row.` : "Matched by the meter number in the photo."}</DialogDescription></DialogHeader>
          {scan?.preview && <img src={scan.preview} alt="Meter photo" className="w-full max-h-64 object-contain rounded-md bg-muted" />}
          {scan?.busy && <p className="text-sm text-muted-foreground">This takes a few seconds.</p>}
          {scan?.error && <p className="text-sm text-destructive" data-testid="text-scan-error">{scan.error}</p>}
          {scan?.result && (
            <div className="space-y-2 text-sm" data-testid="scan-result">
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-xs text-muted-foreground">Meter number seen</div><div className="font-medium">{scan.result.detected.meterNumber ?? "Not readable"}</div></div>
                <div><div className="text-xs text-muted-foreground">Reading seen</div><div className="font-medium tabular-nums" data-testid="text-scan-reading">{scan.result.detected.reading === null ? "Not readable" : fmtUnits(scan.result.detected.reading, kind)}</div></div>
              </div>
              <p className={scan.result.status === "matched" ? "text-sm" : "text-sm text-destructive"} data-testid="text-scan-message">{scan.result.message}</p>
              {scan.result.detected.confidence !== "high" && (scan.result.status === "matched" || scan.result.status === "unverified") && <p className="text-xs text-muted-foreground">The reader wasn't fully sure{scan.result.detected.notes ? `: ${scan.result.detected.notes.replace(/[.!]?\s*$/, ".")}` : "."} Compare the digits with the photo.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={scan?.busy} onClick={() => setScan(null)}>Close</Button>
            {!scan?.busy && <Button variant="outline" onClick={() => { const id = scan?.forId ?? null; setScan(null); openCamera(id); }} data-testid="button-scan-retake"><Camera className="h-4 w-4 mr-1" />Retake</Button>}
            {scan?.result?.token && <Button onClick={applyScan} data-testid="button-scan-use">{scan.result.detected.reading === null ? "Attach photo" : "Use this reading"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BillingSettingsCard({ settings }: { settings: ReaderSettings }) {
  const { toast } = useToast();
  const [delay, setDelay] = useState(String(settings.delayHours));
  const [due, setDue] = useState(String(settings.electricityDueDays));
  const [acct, setAcct] = useState<string>(settings.electricityIncomeAccountId ? String(settings.electricityIncomeAccountId) : "lease");
  const [sms, setSms] = useState(settings.electricitySms !== 0);
  const { data: accounts = [] } = useQuery<{ id: number; code: string; name: string }[]>({ queryKey: ["/api/meter-reader/income-accounts"] });
  useEffect(() => { setDelay(String(settings.delayHours)); setDue(String(settings.electricityDueDays)); setAcct(settings.electricityIncomeAccountId ? String(settings.electricityIncomeAccountId) : "lease"); setSms(settings.electricitySms !== 0); }, [settings]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/meter-reader/settings", { delayHours: Number(delay), electricityDueDays: Number(due), electricityIncomeAccountId: acct === "lease" ? null : Number(acct), electricitySms: sms ? 1 : 0 })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/meter-reader/settings"] }); queryClient.invalidateQueries({ queryKey: ["/api/meter-reader/water"] }); queryClient.invalidateQueries({ queryKey: ["/api/meter-reader/electricity"] }); toast({ title: "Meter billing settings saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/meter-reader/run-auto-billing", {})).json(),
    onSuccess: (r: any) => {
      for (const k of ["/api/meter-reader/water", "/api/meter-reader/electricity", "/api/water-billing/bills", "/api/rent-invoices", "/api/tenants/electricity-readings"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: `${r.water} water bill${r.water === 1 ? "" : "s"}, ${r.electricity} electricity invoice${r.electricity === 1 ? "" : "s"} raised`, description: r.errors?.length ? r.errors.join(" · ") : "Only readings past the review window are billed.", variant: r.errors?.length ? "destructive" : undefined });
    },
    onError: (e) => toast({ title: "Couldn't run billing", description: errMsg(e), variant: "destructive" }),
  });
  const delayOk = /^\d+$/.test(delay) && Number(delay) <= 720; const dueOk = /^\d+$/.test(due) && Number(due) <= 90;
  return (
    <Card className="p-4 space-y-4" data-testid="card-meter-billing-settings">
      <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-muted-foreground" /><h2 className="font-semibold">Automatic billing settings</h2><Badge variant="outline">Admin only</Badge></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5"><Label htmlFor="mr-delay">Review window (hours)</Label><Input id="mr-delay" type="number" min="0" max="720" value={delay} onChange={(e) => setDelay(e.target.value)} data-testid="input-review-hours" />
          <p className="text-xs text-muted-foreground">Time after a reading is saved before it bills. 0 = bill at the next run (every 15 minutes).</p></div>
        <div className="space-y-1.5"><Label htmlFor="mr-due">Electricity due (days)</Label><Input id="mr-due" type="number" min="0" max="90" value={due} onChange={(e) => setDue(e.target.value)} data-testid="input-electricity-due-days" />
          <p className="text-xs text-muted-foreground">Water bills use the due days in Water Sales → Tariffs.</p></div>
        <div className="space-y-1.5"><Label>Electricity income account</Label>
          <Select value={acct} onValueChange={setAcct}><SelectTrigger data-testid="select-electricity-income"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="lease">Same as the lease's income account</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="mr-sms">SMS tenant with the electricity invoice</Label><div className="h-9 flex items-center"><Switch id="mr-sms" checked={sms} onCheckedChange={setSms} data-testid="switch-electricity-sms" /></div>
          <p className="text-xs text-muted-foreground">The PDF invoice is always emailed when the tenant has an email address.</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!delayOk || !dueOk || save.isPending} onClick={() => save.mutate()} data-testid="button-save-meter-settings">{save.isPending ? "Saving…" : "Save settings"}</Button>
        <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()} data-testid="button-run-auto-billing">{run.isPending ? "Billing…" : "Bill due readings now"}</Button>
      </div>
      {(!delayOk || !dueOk) && <p className="text-xs text-destructive">Use whole numbers: review window 0–720 hours, due days 0–90.</p>}
    </Card>
  );
}
