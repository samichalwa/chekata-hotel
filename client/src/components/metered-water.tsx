// Metered water customers: monthly meter readings → monthly bills (m³), payments, statements.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileText, MessageCircle, Send, Ban, FileSpreadsheet, Gauge, Users, Wallet, AlertTriangle, Save, Receipt, Camera, ScanLine, ImageIcon } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecordPaymentButton } from "@/components/record-payment-button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, todayISO } from "@/lib/format";
import { buildWhatsAppLink, buildDocumentPdfUrl } from "@/lib/whatsapp";
import { calcWaterCharge, consumptionOf, validateTariff, monthLabel, type WaterBand } from "@shared/water-billing";

type Tariff = { id: number; name: string; bands: WaterBand[]; serviceCharge: number; minimumCharge: number; active: number; notes: string | null; customers?: number };
type Customer = { id: number; accountNo: string; name: string; phone: string | null; email: string | null; location: string | null; meterNumber: string | null; tariffId: number; tariffName: string | null; openingReading: number; connectionDate: string | null; status: "active" | "disconnected"; depositAmount: number; depositReference: string | null; depositDate: string | null; notes: string | null; lastReading: number | null; lastMonth: string | null; balance: number };
type ReadingRow = { customerId: number; accountNo: string; name: string; location: string | null; meterNumber: string | null; status: string; tariff: { name: string; bands: WaterBand[]; serviceCharge: number; minimumCharge: number }; previousReading: number; laterMonth: string | null;
  reading: null | { id: number; currentReading: number; meterReplaced: boolean; oldMeterFinal: number | null; newMeterStart: number | null; consumption: number; readingDate: string; billId: number | null; billNumber: string | null; billStatus: string | null; photoUrl?: string | null; photoMeterNumber?: string | null; photoReading?: number | null; photoMeterVerified?: number | null; photoConfidence?: string | null } };
type Bill = { id: number; billNumber: string; customerId: number; customerName: string; accountNo: string; phone: string | null; email: string | null; meterNumber: string | null; periodMonth: string; previousReading: number; currentReading: number; consumption: number; tariffName: string; currentCharges: number; balanceBroughtForward: number; totalDue: number; amountPaid: number; billDate: string; dueDate: string; status: string; cancelReason: string | null; smsStatus: string | null; emailStatus: string | null; documentId: number | null; documentToken: string | null; customerBalance: number };

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const thisMonth = () => todayISO().slice(0, 7);
const m3 = (v: number) => `${Math.round(v * 1000) / 1000} m³`;
const prettyDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  unpaid: { label: "Unpaid", variant: "destructive" }, partially_paid: { label: "Part paid", variant: "default" }, paid: { label: "Paid", variant: "secondary" }, cancelled: { label: "Cancelled", variant: "outline" },
};
const invalidateAll = () => { for (const k of ["/api/water-billing/customers", "/api/water-billing/readings", "/api/water-billing/bills", "/api/water-billing/summary", "/api/water-billing/tariffs", "/api/documents", "/api/director/summary"]) queryClient.invalidateQueries({ queryKey: [k] }); };

export function MeteredWater() {
  const [tab, setTab] = useState("readings");
  const { data: summary } = useQuery<any>({ queryKey: ["/api/water-billing/summary", thisMonth()], queryFn: async () => (await apiRequest("GET", `/api/water-billing/summary?month=${thisMonth()}`)).json() });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active metered customers" value={String(summary?.activeCustomers ?? 0)} icon={Users} testId="stat-metered-customers" />
        <StatCard label={`Read · ${monthLabel(thisMonth())}`} value={`${summary?.readings ?? 0} / ${summary?.activeCustomers ?? 0}`} hint={`${summary?.billed ?? 0} billed · ${m3(summary?.consumption ?? 0)}`} icon={Gauge} accent="muted" testId="stat-metered-read" />
        <StatCard label="Outstanding on accounts" value={formatKES(summary?.outstanding ?? 0)} icon={Wallet} accent="warning" testId="stat-metered-outstanding" />
        <StatCard label="Overdue" value={formatKES(summary?.overdue ?? 0)} hint={`${summary?.overdueCustomers ?? 0} customer(s)`} icon={AlertTriangle} accent={summary?.overdue > 0 ? "warning" : "muted"} testId="stat-metered-overdue" />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList>
            <TabsTrigger value="readings" data-testid="tab-metered-readings">Readings</TabsTrigger>
            <TabsTrigger value="bills" data-testid="tab-metered-bills">Bills</TabsTrigger>
            <TabsTrigger value="customers" data-testid="tab-metered-customers">Customers</TabsTrigger>
            <TabsTrigger value="tariffs" data-testid="tab-metered-tariffs">Tariffs</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="readings" className="mt-4"><ReadingsTab onBilled={() => setTab("bills")} /></TabsContent>
        <TabsContent value="bills" className="mt-4"><BillsTab /></TabsContent>
        <TabsContent value="customers" className="mt-4"><CustomersTab /></TabsContent>
        <TabsContent value="tariffs" className="mt-4"><TariffsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Readings ---------------- */
type PhotoScan = { token: string; url: string; reading: number | null; meterNumber: string | null; verified: boolean; confidence: string };
type Draft = { current: string; replaced: boolean; oldFinal: string; newStart: string; photo?: PhotoScan | null };
type ScanResult = { status: "matched" | "unverified" | "mismatch" | "unregistered" | "serial_unreadable" | "disconnected"; message: string; photoUrl: string; token: string | null;
  detected: { meterNumber: string | null; reading: number | null; readingText: string | null; confidence: "high" | "medium" | "low"; notes: string | null };
  customer: { id: number; name: string; accountNo: string; meterNumber: string | null } | null };

/** Shrinks a phone photo to max 1600px JPEG so uploads stay small on mobile data. */
export async function photoToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a photo the browser can open.")); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

function ReadingsTab({ onBilled }: { onBilled: () => void }) {
  const { toast } = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [readingDate, setReadingDate] = useState(todayISO());
  const [billDate, setBillDate] = useState(todayISO());
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState(false);
  const { data: rows = [], isLoading } = useQuery<ReadingRow[]>({ queryKey: ["/api/water-billing/readings", month], queryFn: async () => (await apiRequest("GET", `/api/water-billing/readings?month=${month}`)).json(), enabled: /^\d{4}-\d{2}$/.test(month) });
  const { data: settings } = useQuery<any>({ queryKey: ["/api/water-billing/settings"] });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [scanFor, setScanFor] = useState<number | null>(null); // customer row the camera was opened from (null = Scan a meter)
  const [scan, setScan] = useState<{ busy: boolean; preview?: string; result?: ScanResult; error?: string; forId: number | null } | null>(null);
  const openCamera = (customerId: number | null) => { setScanFor(customerId); if (fileRef.current) { fileRef.current.value = ""; fileRef.current.click(); } };
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    const forId = scanFor;
    setScan({ busy: true, forId });
    try {
      const jpeg = await photoToJpeg(file);
      setScan({ busy: true, preview: jpeg, forId });
      const result: ScanResult = await (await apiRequest("POST", "/api/water-billing/scan", { imageBase64: jpeg, mimeType: "image/jpeg", customerId: forId })).json();
      setScan({ busy: false, preview: jpeg, result, forId });
    } catch (e) { setScan((s) => ({ busy: false, preview: s?.preview, error: errMsg(e), forId })); }
  };
  const applyScan = () => {
    const r = scan?.result; if (!r?.token || !r.customer) return;
    const row = rows.find((x) => x.customerId === r.customer!.id);
    if (!row) { toast({ title: "Customer isn't on this month's sheet", description: `${r.customer.name} is not active for ${monthLabel(month)}.`, variant: "destructive" }); return; }
    if (billed(row) || row.laterMonth) { toast({ title: `${row.name} is already billed for ${monthLabel(month)}`, description: "Cancel that bill first if the reading must change.", variant: "destructive" }); return; }
    const photo: PhotoScan = { token: r.token, url: r.photoUrl, reading: r.detected.reading, meterNumber: r.detected.meterNumber, verified: r.status === "matched", confidence: r.detected.confidence };
    set(row.customerId, { photo, ...(r.detected.reading !== null ? { current: String(r.detected.reading) } : {}) });
    setScan(null);
    setTimeout(() => document.getElementById(`cur-${row.customerId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    toast({ title: `Reading filled in for ${row.name}`, description: "Check it against the photo, then press Save readings." });
  };
  useEffect(() => {
    const d: Record<number, Draft> = {};
    for (const r of rows) d[r.customerId] = r.reading ? { current: String(r.reading.currentReading), replaced: r.reading.meterReplaced, oldFinal: r.reading.oldMeterFinal === null ? "" : String(r.reading.oldMeterFinal), newStart: r.reading.newMeterStart === null ? "" : String(r.reading.newMeterStart) } : { current: "", replaced: false, oldFinal: "", newStart: "0" };
    setDrafts(d); setErrors({});
  }, [rows]);

  const billed = (r: ReadingRow) => !!r.reading?.billId && r.reading.billStatus !== "cancelled";
  // Saved readings bill automatically after the review window (Meter Readings → settings); a reading whose bill
  // was cancelled waits for a manual Raise.
  const { data: meterCfg } = useQuery<{ delayHours: number; autoFrom: number | null }>({ queryKey: ["/api/meter-reader/settings"] });
  const autoAt = (r: ReadingRow) => { const t = (r.reading as any)?.savedAt as number | undefined; return meterCfg?.autoFrom && t && !r.reading?.billId && t >= meterCfg.autoFrom ? t + meterCfg.delayHours * 3600_000 : null; };
  const preview = (r: ReadingRow) => {
    const d = drafts[r.customerId]; if (!d || d.current === "") return null;
    const cur = Number(d.current);
    const rep = d.replaced ? { oldFinal: Number(d.oldFinal || 0), newStart: Number(d.newStart || 0) } : null;
    let error: string | null = null;
    if (rep) { if (rep.oldFinal < r.previousReading) error = `Old meter final can't be below ${r.previousReading}`; else if (cur < rep.newStart) error = "Below the new meter's start"; }
    else if (cur < r.previousReading) error = `Lower than last reading (${r.previousReading}). Tick "Meter replaced" if it was changed or reset.`;
    const used = consumptionOf(r.previousReading, cur, rep);
    return { used, charge: calcWaterCharge(used, r.tariff), error };
  };
  const changed = rows.filter((r) => {
    if (billed(r) || r.laterMonth) return false;
    const d = drafts[r.customerId]; if (!d || d.current === "") return false;
    if (!r.reading) return true;
    return !!d.photo || Number(d.current) !== r.reading.currentReading || d.replaced !== r.reading.meterReplaced || (d.replaced && (Number(d.oldFinal) !== r.reading.oldMeterFinal || Number(d.newStart) !== r.reading.newMeterStart));
  });
  const blocking = changed.some((r) => preview(r)?.error);
  const toBill = rows.filter((r) => r.reading && !billed(r));

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/water-billing/readings", { month, readings: changed.map((r) => { const d = drafts[r.customerId]; return { customerId: r.customerId, currentReading: Number(d.current), readingDate, meterReplaced: d.replaced, oldMeterFinal: d.replaced ? Number(d.oldFinal || 0) : null, newMeterStart: d.replaced ? Number(d.newStart || 0) : null, photoToken: d.photo?.token ?? null }; }) })).json(),
    onSuccess: (r: any) => {
      const e: Record<number, string> = {}; for (const x of r.errors ?? []) e[x.customerId] = x.error; setErrors(e);
      setDrafts((d) => { const n = { ...d }; for (const id of Object.keys(n)) if (n[+id]?.photo && !e[+id]) n[+id] = { ...n[+id], photo: null }; return n; });
      invalidateAll();
      toast({ title: `${r.saved} reading${r.saved === 1 ? "" : "s"} saved`, description: r.errors?.length ? `${r.errors.length} could not be saved — see the highlighted rows.` : undefined, variant: r.errors?.length ? "destructive" : undefined });
    },
    onError: (e) => toast({ title: "Couldn't save readings", description: errMsg(e), variant: "destructive" }),
  });
  const raise = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/water-billing/bills/raise", { month, billDate })).json(),
    onSuccess: (r: any) => {
      invalidateAll(); setConfirm(false);
      const smsFails = (r.results ?? []).filter((x: any) => String(x.sms).startsWith("failed")).length;
      toast({ title: `${r.raised} bill${r.raised === 1 ? "" : "s"} raised`, description: `Due ${prettyDate(r.dueDate)}. Emailed where an address is on file${smsFails ? `; ${smsFails} SMS failed` : ""}.` });
      onBilled();
    },
    onError: (e) => toast({ title: "Couldn't raise bills", description: errMsg(e), variant: "destructive" }),
  });
  const set = (id: number, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const totalPreview = toBill.reduce((t, r) => t + (preview(r)?.charge.total ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="wr-month">Billing month</Label><Input id="wr-month" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="input-readings-month" /></div>
        <div className="space-y-1.5"><Label htmlFor="wr-date">Date read</Label><Input id="wr-date" type="date" className="w-44" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} data-testid="input-readings-date" /></div>
        <div className="flex-1" />
        {settings?.visionReady && <Button variant="outline" onClick={() => openCamera(null)} disabled={!rows.length} data-testid="button-scan-meter"><ScanLine className="h-4 w-4 mr-1" />Scan a meter</Button>}
        <Button variant="outline" disabled={!changed.length || blocking || save.isPending} onClick={() => save.mutate()} data-testid="button-save-readings"><Save className="h-4 w-4 mr-1" />{save.isPending ? "Saving…" : `Save readings${changed.length ? ` (${changed.length})` : ""}`}</Button>
        <Button disabled={!toBill.length || changed.length > 0 || raise.isPending} onClick={() => setConfirm(true)} data-testid="button-raise-bills"><Receipt className="h-4 w-4 mr-1" />Raise bills{toBill.length ? ` (${toBill.length})` : ""}</Button>
      </Card>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} data-testid="input-meter-photo" />
      {settings?.visionReady && rows.length > 0 && <p className="text-xs text-muted-foreground">Type readings as usual, or use the camera: the photo is read for the meter number and reading, matched to the registered meter, and filled in for you to check before saving.</p>}
      {changed.length > 0 && toBill.length > 0 && <p className="text-xs text-muted-foreground">Save the readings you've typed before raising bills.</p>}
      {isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card> : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No active metered customers yet. Add a tariff, then add customers in the Customers tab.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const d = drafts[r.customerId] ?? { current: "", replaced: false, oldFinal: "", newStart: "0" };
            const p = preview(r); const locked = billed(r) || !!r.laterMonth;
            const err = errors[r.customerId] || p?.error;
            return (
              <Card key={r.customerId} className={`p-3 ${err ? "border-destructive" : ""}`} data-testid={`row-reading-${r.customerId}`}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,0.9fr)_minmax(0,1fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name} <span className="text-xs text-muted-foreground font-normal">{r.accountNo}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{[r.meterNumber && `Meter ${r.meterNumber}`, r.location, r.tariff.name].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex items-end gap-3">
                    <div><div className="text-xs text-muted-foreground">Previous</div><div className="tabular-nums font-medium h-9 flex items-center">{r.previousReading}</div></div>
                    <div className="space-y-1">
                      <Label htmlFor={`cur-${r.customerId}`} className="text-xs text-muted-foreground font-normal">{d.replaced ? "New meter now" : "Current"}</Label>
                      <div className="flex items-center gap-1">
                        <Input id={`cur-${r.customerId}`} type="number" inputMode="decimal" step="0.001" min="0" className="w-28 tabular-nums" disabled={locked} value={d.current} onChange={(e) => set(r.customerId, { current: e.target.value })} data-testid={`input-reading-${r.customerId}`} />
                        {settings?.visionReady && !locked && <Button size="icon" variant="ghost" aria-label={`Photo of ${r.name}'s meter`} onClick={() => openCamera(r.customerId)} data-testid={`button-photo-${r.customerId}`}><Camera className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm">
                    {p ? (<><div className="tabular-nums"><span className="font-medium">{m3(p.used)}</span> used</div><div className="tabular-nums text-muted-foreground">{formatKES(p.charge.total)}</div></>) : <span className="text-muted-foreground text-xs">Not read yet</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {billed(r) ? <Badge variant="secondary">Billed {r.reading?.billNumber}</Badge> : r.laterMonth ? <Badge variant="outline">Locked — {monthLabel(r.laterMonth)} read</Badge> : r.reading ? <Badge variant="outline" data-testid={`badge-reading-status-${r.customerId}`}>{autoAt(r) ? `Saved · auto-bills ${autoAt(r)! <= Date.now() ? "shortly" : new Date(autoAt(r)!).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Saved · not billed"}</Badge> : null}
                    {!locked && (
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer"><Checkbox checked={d.replaced} onCheckedChange={(v) => set(r.customerId, { replaced: !!v })} data-testid={`check-replaced-${r.customerId}`} />Meter replaced</label>
                    )}
                  </div>
                </div>
                {d.replaced && !locked && (
                  <div className="mt-3 flex flex-wrap gap-3 rounded-md bg-muted p-2">
                    <div className="space-y-1"><Label className="text-xs">Old meter final reading</Label><Input type="number" step="0.001" className="w-32" value={d.oldFinal} onChange={(e) => set(r.customerId, { oldFinal: e.target.value })} data-testid={`input-old-final-${r.customerId}`} /></div>
                    <div className="space-y-1"><Label className="text-xs">New meter start reading</Label><Input type="number" step="0.001" className="w-32" value={d.newStart} onChange={(e) => set(r.customerId, { newStart: e.target.value })} data-testid={`input-new-start-${r.customerId}`} /></div>
                    <p className="text-xs text-muted-foreground self-center max-w-xs">Units = (old final − previous) + (new reading − new start).</p>
                  </div>
                )}
                {(() => {
                  const ph = d.photo ? { url: d.photo.url, reading: d.photo.reading, verified: d.photo.verified, pending: true } : r.reading?.photoUrl ? { url: r.reading.photoUrl, reading: r.reading.photoReading ?? null, verified: r.reading.photoMeterVerified !== 0, pending: false } : null;
                  if (!ph) return null;
                  const edited = ph.reading !== null && d.current !== "" && Math.abs(Number(d.current) - ph.reading) > 0.0005;
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid={`photo-info-${r.customerId}`}>
                      <a href={ph.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"><ImageIcon className="h-3.5 w-3.5" />Meter photo</a>
                      <span className="text-muted-foreground">{ph.reading === null ? "reading not readable" : `photo read ${ph.reading}`}</span>
                      {!ph.verified && <Badge variant="outline">Meter no. not verified</Badge>}
                      {edited && <Badge variant="outline">Changed by staff</Badge>}
                      {ph.pending && <span className="text-muted-foreground">· attached when you save</span>}
                      {ph.pending && <button type="button" className="text-muted-foreground underline" onClick={() => set(r.customerId, { photo: null })}>remove</button>}
                    </div>
                  );
                })()}
                {err && <p className="mt-2 text-xs text-destructive" data-testid={`error-reading-${r.customerId}`}>{err}</p>}
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!scan} onOpenChange={(o) => { if (!o && !scan?.busy) setScan(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{scan?.busy ? "Reading the photo…" : scan?.result?.status === "matched" || scan?.result?.status === "unverified" ? "Check the reading" : "Photo not used"}</DialogTitle>
            <DialogDescription>{scan?.forId ? `Taken from ${rows.find((x) => x.customerId === scan.forId)?.name ?? "this customer"}'s row.` : "Matched by the meter number in the photo."}</DialogDescription></DialogHeader>
          {scan?.preview && <img src={scan.preview} alt="Meter photo" className="w-full max-h-64 object-contain rounded-md bg-muted" />}
          {scan?.busy && <p className="text-sm text-muted-foreground">This takes a few seconds.</p>}
          {scan?.error && <p className="text-sm text-destructive" data-testid="text-scan-error">{scan.error}</p>}
          {scan?.result && (
            <div className="space-y-2 text-sm" data-testid="scan-result">
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-xs text-muted-foreground">Meter number seen</div><div className="font-medium">{scan.result.detected.meterNumber ?? "Not readable"}</div></div>
                <div><div className="text-xs text-muted-foreground">Reading seen</div><div className="font-medium tabular-nums" data-testid="text-scan-reading">{scan.result.detected.reading === null ? "Not readable" : m3(scan.result.detected.reading)}</div></div>
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
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Raise {toBill.length} water bill{toBill.length === 1 ? "" : "s"} for {monthLabel(month)}?</DialogTitle>
            <DialogDescription>Each customer gets a PDF bill by email{settings?.waterBillSms ? " and an SMS with the amount and a link to the PDF" : ""}. Any unpaid balance is brought forward onto the bill.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Current charges</span><span className="font-semibold tabular-nums">{formatKES(totalPreview)}</span></div>
            <div className="space-y-1.5"><Label htmlFor="wb-date">Bill date</Label><Input id="wb-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} data-testid="input-bill-date" /></div>
            <p className="text-xs text-muted-foreground">Due {settings ? `${settings.waterBillDueDays} days after the bill date` : "per the Tariffs tab setting"}.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={raise.isPending} onClick={() => raise.mutate()} data-testid="button-confirm-raise">{raise.isPending ? "Raising…" : "Raise and send"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Bills ---------------- */
function BillsTab() {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("current");
  const [search, setSearch] = useState("");
  const [cancel, setCancel] = useState<Bill | null>(null);
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState(thisMonth()); const [to, setTo] = useState(thisMonth());
  const { data: bills = [], isLoading } = useQuery<Bill[]>({ queryKey: ["/api/water-billing/bills", month], queryFn: async () => (await apiRequest("GET", `/api/water-billing/bills${month ? `?month=${month}` : ""}`)).json() });
  const shown = bills.filter((b) => (status === "all" || (status === "current" ? b.status !== "cancelled" : status === "open" ? b.status === "unpaid" || b.status === "partially_paid" : b.status === status)) && (!search || `${b.customerName} ${b.accountNo} ${b.billNumber} ${b.meterNumber ?? ""}`.toLowerCase().includes(search.toLowerCase())));
  const resend = useMutation({
    mutationFn: async (b: Bill) => (await apiRequest("POST", `/api/water-billing/bills/${b.id}/resend`, { sms: true })).json(),
    onSuccess: (r: any) => { invalidateAll(); toast({ title: "Bill resent", description: `Email: ${r.email}${r.errorMessage ? ` (${r.errorMessage})` : ""} · SMS: ${r.sms}` }); },
    onError: (e) => toast({ title: "Couldn't resend", description: errMsg(e), variant: "destructive" }),
  });
  const doCancel = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/water-billing/bills/${cancel!.id}/cancel`, { reason })).json(),
    onSuccess: () => { invalidateAll(); toast({ title: "Bill cancelled", description: "A credit note was issued. The reading can now be corrected and billed again." }); setCancel(null); setReason(""); },
    onError: (e) => toast({ title: "Couldn't cancel", description: errMsg(e), variant: "destructive" }),
  });
  const whatsapp = (b: Bill) => {
    let msg = `Dear ${b.customerName}, your water bill ${b.billNumber} for ${monthLabel(b.periodMonth)}: ${m3(b.consumption)} (meter ${b.previousReading} → ${b.currentReading}), ${formatKES(b.currentCharges)}.`;
    if (Math.abs(b.balanceBroughtForward) > 0.5) msg += ` ${b.balanceBroughtForward > 0 ? "Arrears" : "Credit"} brought forward ${formatKES(Math.abs(b.balanceBroughtForward))}.`;
    msg += ` Total due ${formatKES(Math.max(0, b.totalDue))} by ${prettyDate(b.dueDate)}.`;
    if (b.documentId && b.documentToken) msg += `\n\nView/download your bill (PDF): ${buildDocumentPdfUrl(b.documentId, b.documentToken)}`;
    const link = buildWhatsAppLink(b.phone, msg, me?.environment);
    if (link) window.open(link, "_blank"); else toast({ title: "No valid phone number on this customer", variant: "destructive" });
  };
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="wbl-month">Month</Label><Input id="wbl-month" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="input-bills-month" /></div>
        <div className="space-y-1.5"><Label>Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-48" data-testid="select-bills-status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="current">All except cancelled</SelectItem><SelectItem value="all">All incl. cancelled</SelectItem><SelectItem value="open">Unpaid / part paid</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5 flex-1 min-w-[10rem]"><Label htmlFor="wbl-search">Search</Label><Input id="wbl-search" placeholder="Name, account, bill or meter no." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-bills-search" /></div>
        {month && <Button variant="ghost" size="sm" onClick={() => setMonth("")}>All months</Button>}
      </Card>
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="text-sm font-medium w-full sm:w-auto sm:mr-2">Excel report <span className="block text-xs font-normal text-muted-foreground">Bills, payments, arrears (aged), customers and tariffs</span></div>
        <div className="space-y-1.5"><Label htmlFor="wr-from">From</Label><Input id="wr-from" type="month" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wr-to">To</Label><Input id="wr-to" type="month" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" asChild data-testid="button-water-report"><a href={`/api/water-billing/report/excel?from=${from}&to=${to}`}><FileSpreadsheet className="h-4 w-4 mr-1" />Download .xlsx</a></Button>
      </Card>
      {isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card> : shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No bills{month ? ` for ${monthLabel(month)}` : ""} yet. Enter readings in the Readings tab, then press Raise bills.</Card>
      ) : (
        <div className="space-y-2">
          {shown.map((b) => {
            const st = STATUS[b.status] ?? STATUS.unpaid;
            const open = b.status !== "cancelled";
            return (
              <Card key={b.id} className="p-3" data-testid={`row-bill-${b.id}`}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1fr)_23rem] md:items-center">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.customerName} <span className="text-xs text-muted-foreground font-normal">{b.accountNo}</span></div>
                    <div className="text-xs text-muted-foreground">{b.billNumber} · {monthLabel(b.periodMonth)} · due {prettyDate(b.dueDate)}</div>
                  </div>
                  <div className="text-sm tabular-nums"><div>{b.previousReading} → {b.currentReading}</div><div className="text-muted-foreground text-xs">{m3(b.consumption)} · {b.tariffName}</div></div>
                  <div className="text-sm tabular-nums">
                    <div>Charges <span className="font-medium">{formatKES(b.currentCharges)}</span></div>
                    <div className="text-xs text-muted-foreground">{b.balanceBroughtForward > 0.5 ? `arrears b/f ${formatKES(b.balanceBroughtForward)} · ` : b.balanceBroughtForward < -0.5 ? `credit b/f ${formatKES(-b.balanceBroughtForward)} · ` : ""}total due {formatKES(Math.max(0, b.totalDue))}</div>
                    {b.status === "partially_paid" && <div className="text-xs">Paid {formatKES(b.amountPaid)}</div>}
                    {b.status === "cancelled" && b.cancelReason && <div className="text-xs text-muted-foreground">Cancelled: {b.cancelReason}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 md:col-span-3 lg:col-span-1 lg:flex-nowrap lg:justify-end">
                    <Badge variant={st.variant} data-testid={`status-bill-${b.id}`}>{st.label}</Badge>
                    {open && <RecordPaymentButton endpoint={`/api/water-billing/customers/${b.customerId}/record-payment`} due={b.customerBalance} guestName={`${b.customerName} (${b.accountNo})`} summary={`Account balance — applied to the oldest bill first`} invalidate={[["/api/water-billing/bills"], ["/api/water-billing/customers"], ["/api/water-billing/summary"]]} testId={`bill-${b.id}`} compact />}
                    {b.documentId && b.documentToken && <Button size="icon" variant="ghost" asChild title="Open PDF"><a href={buildDocumentPdfUrl(b.documentId, b.documentToken)} target="_blank" rel="noreferrer" data-testid={`button-bill-pdf-${b.id}`}><FileText className="h-4 w-4" /></a></Button>}
                    {open && <Button size="icon" variant="ghost" title="WhatsApp with PDF link" onClick={() => whatsapp(b)} data-testid={`button-bill-whatsapp-${b.id}`}><MessageCircle className="h-4 w-4" /></Button>}
                    {open && <Button size="icon" variant="ghost" title="Resend email + SMS" disabled={resend.isPending} onClick={() => resend.mutate(b)} data-testid={`button-bill-resend-${b.id}`}><Send className="h-4 w-4" /></Button>}
                    {open && <Button size="icon" variant="ghost" title="Cancel bill" onClick={() => { setCancel(b); setReason(""); }} data-testid={`button-bill-cancel-${b.id}`}><Ban className="h-4 w-4" /></Button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cancel bill {cancel?.billNumber}?</DialogTitle>
            <DialogDescription>A credit note is issued for {formatKES(cancel?.currentCharges ?? 0)}. Any payment already applied stays on the customer's account as credit. The reading is unlocked so you can correct it and bill again. Only the customer's latest bill can be cancelled.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="wb-reason">Reason</Label><Textarea id="wb-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong meter reading" data-testid="input-cancel-reason" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCancel(null)}>Keep bill</Button><Button variant="destructive" disabled={!reason.trim() || doCancel.isPending} onClick={() => doCancel.mutate()} data-testid="button-confirm-cancel-bill">Cancel bill</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Customers ---------------- */
function CustomersTab() {
  const { toast } = useToast();
  const [edit, setEdit] = useState<Customer | "new" | null>(null);
  const [stmt, setStmt] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [del, setDel] = useState<Customer | null>(null);
  const { data: customers = [], isLoading } = useQuery<Customer[]>({ queryKey: ["/api/water-billing/customers"] });
  const { data: tariffs = [] } = useQuery<Tariff[]>({ queryKey: ["/api/water-billing/tariffs"] });
  const shown = customers.filter((c) => !search || `${c.name} ${c.accountNo} ${c.meterNumber ?? ""} ${c.location ?? ""} ${c.phone ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const remove = useMutation({
    mutationFn: async (c: Customer) => apiRequest("DELETE", `/api/water-billing/customers/${c.id}`),
    onSuccess: () => { invalidateAll(); toast({ title: "Customer deleted" }); setDel(null); },
    onError: (e) => { toast({ title: "Couldn't delete", description: errMsg(e), variant: "destructive" }); setDel(null); },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[12rem]"><Input placeholder="Search name, account, meter, plot or phone" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-customers-search" /></div>
        <Button onClick={() => setEdit("new")} disabled={!tariffs.some((t) => t.active)} data-testid="button-new-metered-customer"><Plus className="h-4 w-4 mr-1" />Add customer</Button>
      </div>
      {!tariffs.some((t) => t.active) && <p className="text-sm text-muted-foreground">Add a tariff in the Tariffs tab first — every customer is billed on a tariff.</p>}
      {isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card> : shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No metered customers yet.</Card>
      ) : (
        <Card><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="hidden md:table-cell">Meter / location</TableHead><TableHead className="hidden lg:table-cell">Tariff</TableHead><TableHead className="text-right">Last reading</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.id} data-testid={`row-metered-customer-${c.id}`}>
                <TableCell><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.accountNo}{c.phone ? ` · ${c.phone}` : ""}</div>{c.status === "disconnected" && <Badge variant="outline" className="mt-1">Disconnected</Badge>}</TableCell>
                <TableCell className="hidden md:table-cell text-sm"><div>{c.meterNumber ?? "—"}</div><div className="text-xs text-muted-foreground">{c.location ?? ""}</div></TableCell>
                <TableCell className="hidden lg:table-cell text-sm">{c.tariffName}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{c.lastReading ?? c.openingReading}<div className="text-xs text-muted-foreground">{c.lastMonth ? monthLabel(c.lastMonth) : "opening"}</div></TableCell>
                <TableCell className={`text-right tabular-nums text-sm font-medium ${c.balance > 0.5 ? "text-destructive" : ""}`} data-testid={`text-balance-${c.id}`}>{c.balance < -0.5 ? `${formatKES(-c.balance)} cr` : formatKES(Math.max(0, c.balance))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end flex-wrap gap-1">
                    <RecordPaymentButton endpoint={`/api/water-billing/customers/${c.id}/record-payment`} due={c.balance} guestName={`${c.name} (${c.accountNo})`} summary="Account balance — applied to the oldest bill first" invalidate={[["/api/water-billing/bills"], ["/api/water-billing/customers"], ["/api/water-billing/summary"]]} testId={`wc-${c.id}`} compact />
                    <Button size="icon" variant="ghost" title="Statement" onClick={() => setStmt(c)} data-testid={`button-statement-${c.id}`}><FileText className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => setEdit(c)} data-testid={`button-edit-customer-${c.id}`}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" title="Delete" onClick={() => setDel(c)} data-testid={`button-delete-customer-${c.id}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></div></Card>
      )}
      {edit && <CustomerDialog customer={edit === "new" ? null : edit} tariffs={tariffs} onClose={() => setEdit(null)} />}
      {stmt && <StatementDialog customer={stmt} onClose={() => setStmt(null)} />}
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Delete {del?.name}?</DialogTitle><DialogDescription>Only customers with no readings or payments can be deleted. Otherwise mark them disconnected.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDel(null)}>Cancel</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => del && remove.mutate(del)} data-testid="button-confirm-delete-customer">Delete</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerDialog({ customer, tariffs, onClose }: { customer: Customer | null; tariffs: Tariff[]; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState(() => ({
    name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", location: customer?.location ?? "", meterNumber: customer?.meterNumber ?? "",
    tariffId: customer ? String(customer.tariffId) : String(tariffs.find((t) => t.active)?.id ?? ""), openingReading: String(customer?.openingReading ?? 0),
    connectionDate: customer?.connectionDate ?? todayISO(), status: customer?.status ?? "active", depositAmount: String(customer?.depositAmount ?? 0),
    depositReference: customer?.depositReference ?? "", depositDate: customer?.depositDate ?? "", notes: customer?.notes ?? "",
  }));
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, tariffId: Number(f.tariffId), openingReading: Number(f.openingReading || 0), depositAmount: Number(f.depositAmount || 0), depositDate: f.depositDate || null, connectionDate: f.connectionDate || null };
      return (await apiRequest(customer ? "PATCH" : "POST", customer ? `/api/water-billing/customers/${customer.id}` : "/api/water-billing/customers", body)).json();
    },
    onSuccess: (r: any) => { invalidateAll(); toast({ title: customer ? "Customer updated" : `Customer added — account ${r.account_no}` }); onClose(); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const valid = f.name.trim() && f.tariffId && Number(f.openingReading) >= 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{customer ? `Edit ${customer.accountNo}` : "New metered customer"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="wc-name">Customer name</Label><Input id="wc-name" value={f.name} onChange={set("name")} data-testid="input-wc-name" /></div>
          <div className="space-y-1.5"><Label htmlFor="wc-phone">Phone (for SMS & WhatsApp)</Label><Input id="wc-phone" value={f.phone} onChange={set("phone")} placeholder="07…" data-testid="input-wc-phone" /></div>
          <div className="space-y-1.5"><Label htmlFor="wc-email">Email (bills are emailed as PDF)</Label><Input id="wc-email" type="email" value={f.email} onChange={set("email")} data-testid="input-wc-email" /></div>
          <div className="space-y-1.5"><Label htmlFor="wc-loc">Location / plot</Label><Input id="wc-loc" value={f.location} onChange={set("location")} data-testid="input-wc-location" /></div>
          <div className="space-y-1.5"><Label htmlFor="wc-meter">Meter number</Label><Input id="wc-meter" value={f.meterNumber} onChange={set("meterNumber")} data-testid="input-wc-meter" /></div>
          <div className="space-y-1.5"><Label>Tariff</Label>
            <Select value={f.tariffId} onValueChange={set("tariffId")}><SelectTrigger data-testid="select-wc-tariff"><SelectValue placeholder="Choose tariff" /></SelectTrigger>
              <SelectContent>{tariffs.filter((t) => t.active || String(t.id) === f.tariffId).map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="wc-open">Opening meter reading (m³)</Label><Input id="wc-open" type="number" step="0.001" min="0" value={f.openingReading} onChange={set("openingReading")} disabled={!!customer?.lastMonth} data-testid="input-wc-opening" />{customer?.lastMonth && <p className="text-xs text-muted-foreground">Locked — readings exist.</p>}</div>
          <div className="space-y-1.5"><Label htmlFor="wc-conn">Connection date</Label><Input id="wc-conn" type="date" value={f.connectionDate} onChange={set("connectionDate")} /></div>
          <div className="space-y-1.5"><Label>Status</Label>
            <Select value={f.status} onValueChange={set("status")}><SelectTrigger data-testid="select-wc-status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">Active (billed monthly)</SelectItem><SelectItem value="disconnected">Disconnected</SelectItem></SelectContent></Select></div>
          <div className="sm:col-span-2 border-t pt-3 text-sm font-medium">Connection deposit <span className="font-normal text-xs text-muted-foreground">— recorded for reference only; it is not receipted or posted to Finance</span></div>
          <div className="space-y-1.5"><Label htmlFor="wc-dep">Deposit amount (KES)</Label><Input id="wc-dep" type="number" min="0" value={f.depositAmount} onChange={set("depositAmount")} /></div>
          <div className="space-y-1.5"><Label htmlFor="wc-depref">Deposit reference</Label><Input id="wc-depref" value={f.depositReference} onChange={set("depositReference")} /></div>
          <div className="space-y-1.5"><Label htmlFor="wc-depdate">Deposit date</Label><Input id="wc-depdate" type="date" value={f.depositDate} onChange={set("depositDate")} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="wc-notes">Notes</Label><Textarea id="wc-notes" value={f.notes} onChange={set("notes")} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.isPending} onClick={() => save.mutate()} data-testid="button-save-customer">{save.isPending ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { data } = useQuery<any>({ queryKey: ["/api/water-billing/customers", customer.id, "statement"], queryFn: async () => (await apiRequest("GET", `/api/water-billing/customers/${customer.id}/statement`)).json() });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Statement — {customer.name}</DialogTitle><DialogDescription>{customer.accountNo}{customer.meterNumber ? ` · Meter ${customer.meterNumber}` : ""}</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild><a href={`/api/water-billing/customers/${customer.id}/statement/pdf`} target="_blank" rel="noreferrer" data-testid="button-statement-pdf"><FileText className="h-4 w-4 mr-1" />PDF</a></Button>
          <Button variant="outline" size="sm" asChild><a href={`/api/water-billing/customers/${customer.id}/statement/excel`} data-testid="button-statement-excel"><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</a></Button>
        </div>
        {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead className="hidden sm:table-cell">Description</TableHead><TableHead className="text-right">Charges</TableHead><TableHead className="text-right">Payments</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No bills or payments yet.</TableCell></TableRow>}
              {data.rows.map((r: any, i: number) => (
                <TableRow key={i}><TableCell className="text-sm whitespace-nowrap">{prettyDate(r.date)}</TableCell><TableCell className="text-sm">{r.ref}</TableCell><TableCell className="hidden sm:table-cell text-sm">{r.description}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{r.charges ? formatKES(r.charges) : ""}</TableCell><TableCell className="text-right tabular-nums text-sm">{r.payments ? formatKES(r.payments) : ""}</TableCell><TableCell className="text-right tabular-nums text-sm font-medium">{r.balance < -0.5 ? `${formatKES(-r.balance)} cr` : formatKES(r.balance)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table></div>
        )}
        {data && <div className="text-sm text-right space-y-0.5"><div>Total billed {formatKES(data.totalBilled)} · paid {formatKES(data.totalPaid)}</div><div className="font-semibold" data-testid="text-statement-balance">{data.balance >= -0.5 ? `Balance due ${formatKES(Math.max(0, data.balance))}` : `In credit ${formatKES(-data.balance)}`}</div></div>}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Tariffs ---------------- */
function TariffsTab() {
  const { toast } = useToast();
  const [edit, setEdit] = useState<Tariff | "new" | null>(null);
  const { data: tariffs = [] } = useQuery<Tariff[]>({ queryKey: ["/api/water-billing/tariffs"] });
  const { data: settings } = useQuery<any>({ queryKey: ["/api/water-billing/settings"] });
  const [due, setDue] = useState("14");
  useEffect(() => { if (settings) setDue(String(settings.waterBillDueDays)); }, [settings]);
  const saveSettings = useMutation({
    mutationFn: async (patch: any) => (await apiRequest("PATCH", "/api/water-billing/settings", { waterBillDueDays: Number(due), waterBillSms: settings?.waterBillSms ?? 1, ...patch })).json(),
    onSuccess: (r) => { queryClient.setQueryData(["/api/water-billing/settings"], r); toast({ title: "Billing settings saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (t: Tariff) => apiRequest("DELETE", `/api/water-billing/tariffs/${t.id}`),
    onSuccess: () => { invalidateAll(); toast({ title: "Tariff deleted" }); },
    onError: (e) => toast({ title: "Couldn't delete", description: errMsg(e), variant: "destructive" }),
  });
  const bandText = (t: Tariff) => { let from = 0; return t.bands.map((b) => { const s = b.upTo === null ? (from === 0 ? `KES ${b.rate}/m³` : `above ${from} m³: KES ${b.rate}`) : `${from}–${b.upTo} m³: KES ${b.rate}`; from = b.upTo ?? from; return s; }).join(" · "); };
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="text-sm font-medium w-full sm:w-auto">Billing settings</div>
        <div className="space-y-1.5"><Label htmlFor="wt-due">Days to pay</Label><div className="flex gap-2"><Input id="wt-due" type="number" min="0" max="90" className="w-24" value={due} onChange={(e) => setDue(e.target.value)} data-testid="input-water-due-days" /><Button variant="outline" disabled={!settings || Number(due) === settings.waterBillDueDays || saveSettings.isPending} onClick={() => saveSettings.mutate({})}>Save</Button></div></div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!settings?.waterBillSms} onCheckedChange={(v) => saveSettings.mutate({ waterBillSms: v ? 1 : 0 })} data-testid="switch-water-sms" />SMS each bill to the customer</label>
        {settings && !settings.smsEnabled && <p className="text-xs text-muted-foreground w-full">SMS is turned off in Settings → SMS, so bills will only be emailed.</p>}
      </Card>
      <PhotoReadingCard settings={settings} />
      <div className="flex justify-end"><Button onClick={() => setEdit("new")} data-testid="button-new-tariff"><Plus className="h-4 w-4 mr-1" />Add tariff</Button></div>
      {tariffs.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">No tariffs yet. A tariff sets the price per m³ (optionally in bands), a monthly service charge and a minimum bill.</Card> : (
        <div className="grid gap-3 md:grid-cols-2">
          {tariffs.map((t) => (
            <Card key={t.id} className="p-4 space-y-2" data-testid={`card-tariff-${t.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.customers ?? 0} customer(s)</div></div>
                <div className="flex items-center gap-1">{!t.active && <Badge variant="outline">Inactive</Badge>}
                  <Button size="icon" variant="ghost" onClick={() => setEdit(t)} data-testid={`button-edit-tariff-${t.id}`}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(t)} data-testid={`button-delete-tariff-${t.id}`}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
              <div className="text-sm">{bandText(t)}</div>
              <div className="text-xs text-muted-foreground">Service charge {formatKES(t.serviceCharge)} / month · Minimum bill {formatKES(t.minimumCharge)} · prices include tax</div>
            </Card>
          ))}
        </div>
      )}
      {edit && <TariffDialog tariff={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PhotoReadingCard({ settings }: { settings: any }) {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const isAdmin = !!(me as any)?.isAdmin;
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  useEffect(() => { if (settings) { setProvider(settings.visionProvider || ""); setModel(settings.visionModel || ""); } }, [settings]);
  const save = useMutation({
    mutationFn: async (patch: any) => (await apiRequest("PATCH", "/api/water-billing/settings", patch)).json(),
    onSuccess: (r) => { queryClient.setQueryData(["/api/water-billing/settings"], r); setKey(""); toast({ title: r.visionReady ? "Photo reading is on" : "Photo reading saved", description: r.visionReady ? "Camera buttons now appear on the Readings tab." : undefined }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  if (!settings) return null;
  return (
    <Card className="p-4 space-y-3" data-testid="card-photo-reading">
      <div className="flex flex-wrap items-center gap-2"><div className="text-sm font-medium">Photo reading (optional)</div>
        <Badge variant={settings.visionReady ? "secondary" : "outline"} data-testid="badge-vision-status">{settings.visionReady ? `On · ${settings.visionProvider === "gemini" ? "Google Gemini" : "OpenAI"} · key ${settings.visionKeyHint}` : "Off"}</Badge></div>
      <p className="text-xs text-muted-foreground">Lets staff photograph a meter: an AI reader picks out the meter number and reading, the meter number is matched to the registered customer, and staff confirm before saving. Typing readings always works without it. Each photo costs well under KES 1 on the provider's account.</p>
      {!isAdmin ? <p className="text-xs text-muted-foreground">Only an admin can turn this on or change the key.</p> : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label>Provider</Label>
            <Select value={provider || "none"} onValueChange={(v) => setProvider(v === "none" ? "" : v)}>
              <SelectTrigger className="w-44" data-testid="select-vision-provider"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Off</SelectItem><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openai">OpenAI</SelectItem></SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label htmlFor="vision-key">API key</Label><Input id="vision-key" type="password" autoComplete="off" className="w-64" placeholder={settings.visionKeySet ? `Saved ${settings.visionKeyHint}` : "Paste the key"} value={key} onChange={(e) => setKey(e.target.value)} data-testid="input-vision-key" /></div>
          <div className="space-y-1.5"><Label htmlFor="vision-model">Model <span className="text-muted-foreground font-normal">(optional)</span></Label><Input id="vision-model" className="w-44" placeholder={provider === "openai" ? "gpt-4o-mini" : "gemini-3.5-flash"} value={model} onChange={(e) => setModel(e.target.value)} data-testid="input-vision-model" /></div>
          <Button disabled={save.isPending || (provider !== "" && !settings.visionKeySet && !key.trim())} onClick={() => save.mutate({ visionProvider: provider, visionModel: model, ...(key.trim() ? { visionApiKey: key.trim() } : {}) })} data-testid="button-save-vision">Save</Button>
          {settings.visionKeySet && <Button variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ clearVisionKey: true, visionProvider: "" })}>Remove key</Button>}
        </div>
      )}
    </Card>
  );
}

function TariffDialog({ tariff, onClose }: { tariff: Tariff | null; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(tariff?.name ?? "");
  const [bands, setBands] = useState<{ upTo: string; rate: string }[]>(tariff ? tariff.bands.map((b) => ({ upTo: b.upTo === null ? "" : String(b.upTo), rate: String(b.rate) })) : [{ upTo: "", rate: "" }]);
  const [service, setService] = useState(String(tariff?.serviceCharge ?? 0));
  const [minimum, setMinimum] = useState(String(tariff?.minimumCharge ?? 0));
  const [active, setActive] = useState(tariff ? !!tariff.active : true);
  const [notes, setNotes] = useState(tariff?.notes ?? "");
  const [test, setTest] = useState("10");
  const parsed = useMemo(() => ({ name, bands: bands.map((b, i) => ({ upTo: i === bands.length - 1 || b.upTo === "" ? null : Number(b.upTo), rate: Number(b.rate) })), serviceCharge: Number(service || 0), minimumCharge: Number(minimum || 0) }), [name, bands, service, minimum]);
  const err = !name.trim() ? "Enter a tariff name." : bands.some((b) => b.rate === "") ? "Enter a price per m³." : bands.slice(0, -1).some((b) => b.upTo === "") ? "Fill in \"Up to\" on every band except the last." : validateTariff(parsed);
  const sample = !err ? calcWaterCharge(Number(test || 0), parsed) : null;
  const save = useMutation({
    mutationFn: async () => (await apiRequest(tariff ? "PATCH" : "POST", tariff ? `/api/water-billing/tariffs/${tariff.id}` : "/api/water-billing/tariffs", { ...parsed, active: active ? 1 : 0, notes: notes || null })).json(),
    onSuccess: () => { invalidateAll(); toast({ title: tariff ? "Tariff updated" : "Tariff added", description: tariff ? "New prices apply to bills raised from now on." : undefined }); onClose(); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tariff ? "Edit tariff" : "New tariff"}</DialogTitle><DialogDescription>Prices are in KES per m³ and include tax (Settings → Taxes, water).</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="tf-name">Name</Label><Input id="tf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Domestic" data-testid="input-tariff-name" /></div>
          <div className="space-y-2">
            <Label>{bands.length === 1 ? "Price per m³" : "Price bands"}</Label>
            {bands.map((b, i) => {
              const last = i === bands.length - 1;
              const from = i === 0 ? 0 : Number(bands[i - 1].upTo || 0);
              return (
                <div key={i} className="flex items-end gap-2">
                  {last ? (
                    <div className="space-y-1 w-28"><span className="text-xs text-muted-foreground">Units</span><div className="h-9 flex items-center text-sm" data-testid={`text-band-range-${i}`}>{bands.length === 1 ? "All units" : `Above ${from} m³`}</div></div>
                  ) : (
                    <div className="space-y-1"><span className="text-xs text-muted-foreground">{i === 0 ? "First (m³)" : `${from} m³ up to`}</span><Input type="number" min="0" className="w-28" value={b.upTo} onChange={(e) => setBands((x) => x.map((y, j) => (j === i ? { ...y, upTo: e.target.value } : y)))} data-testid={`input-band-upto-${i}`} /></div>
                  )}
                  <div className="space-y-1"><span className="text-xs text-muted-foreground">KES per m³</span><Input type="number" min="0" step="0.01" className="w-28" value={b.rate} onChange={(e) => setBands((x) => x.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} data-testid={`input-band-rate-${i}`} /></div>
                  {bands.length > 1 && <Button size="icon" variant="ghost" onClick={() => setBands((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => setBands((x) => [...x, { upTo: "", rate: "" }])} data-testid="button-add-band"><Plus className="h-4 w-4 mr-1" />{bands.length === 1 ? "Add a higher price band" : "Add band"}</Button>
            <p className="text-xs text-muted-foreground">{bands.length === 1 ? "One price for every m³. Add a band only if heavier use is charged at a different price." : "The last band always covers everything above the band before it."}</p>
            {err && <p className="text-sm text-destructive" data-testid="text-tariff-form-error">{err}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="tf-svc">Monthly service charge</Label><Input id="tf-svc" type="number" min="0" value={service} onChange={(e) => setService(e.target.value)} data-testid="input-tariff-service" /></div>
            <div className="space-y-1.5"><Label htmlFor="tf-min">Minimum monthly bill</Label><Input id="tf-min" type="number" min="0" value={minimum} onChange={(e) => setMinimum(e.target.value)} data-testid="input-tariff-minimum" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} />Active (can be given to customers)</label>
          <div className="space-y-1.5"><Label htmlFor="tf-notes">Notes</Label><Textarea id="tf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <div className="flex items-center gap-2"><span>Try it: a customer using</span><Input type="number" className="w-20 h-8" value={test} onChange={(e) => setTest(e.target.value)} data-testid="input-tariff-test" /><span>m³ pays</span></div>
            {err ? <p className="text-destructive text-xs" data-testid="text-tariff-error">{err}</p> : sample && (
              <div className="tabular-nums" data-testid="text-tariff-sample">
                {sample.lines.map((l, i) => <div key={i} className="flex justify-between text-xs"><span>{l.label}: {l.units} × {l.rate}</span><span>{formatKES(l.amount)}</span></div>)}
                {sample.serviceCharge > 0 && <div className="flex justify-between text-xs"><span>Service charge</span><span>{formatKES(sample.serviceCharge)}</span></div>}
                {sample.minimumTopUp > 0 && <div className="flex justify-between text-xs"><span>Minimum bill adjustment</span><span>{formatKES(sample.minimumTopUp)}</span></div>}
                <div className="flex justify-between font-semibold pt-1"><span>Total</span><span>{formatKES(sample.total)}</span></div>
              </div>
            )}
          </div>
        </div>
        {err && <p className="text-sm text-destructive text-right">{err}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!err || save.isPending} onClick={() => save.mutate()} data-testid="button-save-tariff">{save.isPending ? "Saving…" : "Save tariff"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
