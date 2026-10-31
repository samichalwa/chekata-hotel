// Metered water customers: monthly meter readings → monthly bills (m³), payments, statements.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileText, MessageCircle, Send, Ban, FileSpreadsheet, Gauge, Users, Wallet, AlertTriangle, Save, Receipt, Camera, ScanLine, ImageIcon, PiggyBank, CheckCircle2, BellRing, XCircle, Smartphone } from "lucide-react";
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
import { PaymentSmsPaste, bankFromSmsAccount } from "@/components/payment-sms-paste";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, todayISO } from "@/lib/format";
import { buildWhatsAppLink, buildDocumentPdfUrl } from "@/lib/whatsapp";
import { calcWaterCharge, calcWaterChargeStep, consumptionOf, validateTariff, monthLabel, type WaterBand } from "@shared/water-billing";

type Tariff = { id: number; name: string; bands: WaterBand[]; serviceCharge: number; minimumCharge: number; active: number; notes: string | null; customers?: number };
type Customer = { id: number; accountNo: string; name: string; phone: string | null; email: string | null; location: string | null; meterNumber: string | null; tariffId: number; tariffName: string | null; openingReading: number; connectionDate: string | null; status: "active" | "disconnected"; depositAmount: number; depositPosted?: number; depositReference: string | null; depositDate: string | null; notes: string | null; lastReading: number | null; lastMonth: string | null; balance: number };
type ReadingRow = { customerId: number; accountNo: string; name: string; location: string | null; meterNumber: string | null; status: string; tariff: { name: string; bands: WaterBand[]; serviceCharge: number; minimumCharge: number }; previousReading: number; laterMonth: string | null; lastReadingDate?: string | null;
  monthBilled: { used: number; charged: number; bills: number };
  history: { id: number; readingDate: string; currentReading: number; consumption: number; meterReplaced: boolean; billId: number | null; billNumber: string | null; billStatus: string | null; billAmount: number | null }[];
  reading: null | { id: number; currentReading: number; meterReplaced: boolean; oldMeterFinal: number | null; newMeterStart: number | null; consumption: number; readingDate: string; billId: number | null; billNumber: string | null; billStatus: string | null; photoUrl?: string | null; photoMeterNumber?: string | null; photoReading?: number | null; photoMeterVerified?: number | null; photoConfidence?: string | null } };
type Bill = { id: number; billNumber: string; customerId: number; customerName: string; accountNo: string; phone: string | null; email: string | null; meterNumber: string | null; periodMonth: string; previousReading: number; currentReading: number; consumption: number; tariffName: string; currentCharges: number; balanceBroughtForward: number; totalDue: number; amountPaid: number; billDate: string; dueDate: string; status: string; cancelReason: string | null; smsStatus: string | null; emailStatus: string | null; documentId: number | null; documentToken: string | null; customerBalance: number; kind?: "water" | "penalty"; charge?: any };
const penaltyText = (b: Bill) => `${b.charge?.percent ?? 0}% of ${formatKES(b.charge?.base ?? 0)} unpaid on ${b.charge?.forBillNumber ?? "an earlier bill"}`;

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const thisMonth = () => todayISO().slice(0, 7);
const m3 = (v: number) => `${Math.round(v * 1000) / 1000} m³`;
/** Default "date read" for a month: today in the current month, otherwise the month's last day. */
export const defaultReadDate = (month: string) => {
  const t = todayISO(); if (!/^\d{4}-\d{2}$/.test(month) || month >= t.slice(0, 7)) return t;
  const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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
        <StatCard label={`Read · ${monthLabel(thisMonth())}`} value={`${summary?.readings ?? 0} / ${summary?.activeCustomers ?? 0}`} hint={`${summary?.billed ?? 0} bill${summary?.billed === 1 ? "" : "s"} · ${m3(summary?.consumption ?? 0)}`} icon={Gauge} accent="muted" testId="stat-metered-read" />
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
type PhotoScan = { token: string; url: string; reading: number | null; meterNumber: string | null; verified: boolean | null; confidence: string };
type Draft = { current: string; replaced: boolean; oldFinal: string; newStart: string; photo?: PhotoScan | null };
type ScanResult = { status: "matched" | "unverified" | "mismatch" | "unregistered" | "serial_unreadable" | "disconnected" | "photo_only"; message: string; photoUrl: string; token: string | null;
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
  useEffect(() => { setReadingDate(defaultReadDate(month)); }, [month]);
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
      if (result.status === "photo_only" && result.token && forId !== null) {
        set(forId, { photo: { token: result.token, url: result.photoUrl, reading: null, meterNumber: null, verified: null, confidence: "" } });
        setScan(null);
        toast({ title: "Photo attached", description: `${result.message} Then press Save readings.` });
        return;
      }
      setScan({ busy: false, preview: jpeg, result, forId });
    } catch (e) { setScan((s) => ({ busy: false, preview: s?.preview, error: errMsg(e), forId })); }
  };
  const applyScan = () => {
    const r = scan?.result; if (!r?.token || !r.customer) return;
    const row = rows.find((x) => x.customerId === r.customer!.id);
    if (!row) { toast({ title: "Customer isn't on this month's sheet", description: `${r.customer.name} is not active for ${monthLabel(month)}.`, variant: "destructive" }); return; }
    if (billed(row) || row.laterMonth) { toast({ title: `${row.name}'s reading can't be changed here`, description: `A reading for ${monthLabel(row.laterMonth ?? month)} already exists.`, variant: "destructive" }); return; }
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
    // Each reading is billed on its own; the price steps and minimum continue from this month's earlier bills.
    return { used, charge: calcWaterChargeStep(r.monthBilled.used, r.monthBilled.charged, used, r.tariff, r.monthBilled.bills === 0), error };
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
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} data-testid="input-meter-photo" />
      {rows.length > 0 && <p className="text-xs text-muted-foreground">{settings?.visionReady ? "Type readings as usual, or use the camera: the photo is read for the meter number and reading, matched to the registered meter, and filled in for you to check before saving." : "Type readings as usual. Use the camera button on a row to attach a meter photo, taken now or chosen from the gallery."}</p>}
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
                        {!locked && <Button size="icon" variant="ghost" title="Add meter photo (camera or gallery)" aria-label={`Add a photo of ${r.name}'s meter`} onClick={() => openCamera(r.customerId)} data-testid={`button-photo-${r.customerId}`}><Camera className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm">
                    {p ? (<><div className="tabular-nums"><span className="font-medium">{m3(p.used)}</span> used</div><div className="tabular-nums text-muted-foreground">{formatKES(p.charge.total)}</div></>) : <span className="text-muted-foreground text-xs">{r.laterMonth ? null : r.history.length ? "Enter the next reading when read again" : r.lastReadingDate ? `Last read ${shortDate(r.lastReadingDate)}` : "Not read yet"}</span>}
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
                  const ph = d.photo ? { url: d.photo.url, reading: d.photo.reading, verified: d.photo.verified !== false, manual: d.photo.verified === null, pending: true } : r.reading?.photoUrl ? { url: r.reading.photoUrl, reading: r.reading.photoReading ?? null, verified: r.reading.photoMeterVerified !== 0, manual: r.reading.photoMeterVerified == null && r.reading.photoReading == null, pending: false } : null;
                  if (!ph) return null;
                  const edited = ph.reading !== null && d.current !== "" && Math.abs(Number(d.current) - ph.reading) > 0.0005;
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid={`photo-info-${r.customerId}`}>
                      <a href={ph.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"><ImageIcon className="h-3.5 w-3.5" />Meter photo</a>
                      {!ph.manual && <span className="text-muted-foreground">{ph.reading === null ? "reading not readable" : `photo read ${ph.reading}`}</span>}
                      {!ph.verified && <Badge variant="outline">Meter no. not verified</Badge>}
                      {edited && <Badge variant="outline">Changed by staff</Badge>}
                      {ph.pending && <span className="text-muted-foreground">· attached when you save</span>}
                      {ph.pending && <button type="button" className="text-muted-foreground underline" onClick={() => set(r.customerId, { photo: null })}>remove</button>}
                    </div>
                  );
                })()}
                {r.history.length > 0 && (
                  <div className="mt-2 border-t pt-2 space-y-1" data-testid={`history-reading-${r.customerId}`}>
                    <div className="text-xs text-muted-foreground">Read earlier in {monthLabel(month)}{r.monthBilled.bills ? ` · billed so far ${m3(r.monthBilled.used)}, ${formatKES(r.monthBilled.charged)}` : ""}</div>
                    {r.history.map((h) => (
                      <div key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
                        <span className="w-14 text-muted-foreground">{shortDate(h.readingDate)}</span>
                        <span>Reading {h.currentReading}</span>
                        <span>{m3(h.consumption)} used{h.meterReplaced ? " (meter replaced)" : ""}</span>
                        <span className="text-muted-foreground">{h.billId && h.billStatus !== "cancelled" ? `Billed ${h.billNumber}${h.billAmount !== null ? ` · ${formatKES(h.billAmount)}` : ""}` : h.billStatus === "cancelled" ? `${h.billNumber} cancelled` : "Not billed"}</span>
                      </div>
                    ))}
                  </div>
                )}
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
    onSuccess: () => { invalidateAll(); toast(cancel?.kind === "penalty" ? { title: "Penalty waived", description: "A credit note was issued. It won't be charged again." } : { title: "Bill cancelled", description: "A credit note was issued (and for any penalty on it). The reading can now be corrected and billed again." }); setCancel(null); setReason(""); },
    onError: (e) => toast({ title: "Couldn't cancel", description: errMsg(e), variant: "destructive" }),
  });
  const whatsapp = (b: Bill) => {
    let msg = b.kind === "penalty" ? `Dear ${b.customerName}, a late payment penalty of ${formatKES(b.currentCharges)} (${penaltyText(b)}) has been added to your water account ${b.accountNo}.` : `Dear ${b.customerName}, your water bill ${b.billNumber} for ${monthLabel(b.periodMonth)}: ${m3(b.consumption)} (meter ${b.previousReading} → ${b.currentReading}), ${formatKES(b.currentCharges)}.`;
    if (b.kind !== "penalty" && Math.abs(b.balanceBroughtForward) > 0.5) msg += ` ${b.balanceBroughtForward > 0 ? "Arrears" : "Credit"} brought forward ${formatKES(Math.abs(b.balanceBroughtForward))}.`;
    msg += b.kind === "penalty" ? ` Total due ${formatKES(Math.max(0, b.totalDue))}.` : ` Total due ${formatKES(Math.max(0, b.totalDue))} by ${prettyDate(b.dueDate)}.`;
    if (b.documentId && b.documentToken) msg += `\n\nView/download your bill (PDF): ${buildDocumentPdfUrl(b.documentId, b.documentToken)}`;
    const link = buildWhatsAppLink(b.phone, msg, me?.environment);
    if (link) window.open(link, "_blank"); else toast({ title: "No valid phone number on this customer", variant: "destructive" });
  };
  return (
    <div className="space-y-4">
      <PaymentClaimsCard />
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
                    <div className="text-xs text-muted-foreground">{b.billNumber} · {b.kind === "penalty" ? `added ${prettyDate(b.billDate)}` : `${monthLabel(b.periodMonth)} · due ${prettyDate(b.dueDate)}`}</div>
                  </div>
                  {b.kind === "penalty"
                    ? <div className="text-sm"><div className="font-medium text-amber-700 dark:text-amber-400" data-testid={`text-penalty-${b.id}`}>Late payment penalty</div><div className="text-muted-foreground text-xs">{penaltyText(b)}</div></div>
                    : <div className="text-sm tabular-nums"><div>{b.previousReading} → {b.currentReading}</div><div className="text-muted-foreground text-xs">{m3(b.consumption)} · {b.tariffName}</div></div>}
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
                    {open && <Button size="icon" variant="ghost" title={b.kind === "penalty" ? "Waive penalty" : "Cancel bill"} onClick={() => { setCancel(b); setReason(""); }} data-testid={`button-bill-cancel-${b.id}`}><Ban className="h-4 w-4" /></Button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{cancel?.kind === "penalty" ? `Waive penalty ${cancel?.billNumber}?` : `Cancel bill ${cancel?.billNumber}?`}</DialogTitle>
            {cancel?.kind === "penalty" ? <DialogDescription>A credit note is issued for {formatKES(cancel?.currentCharges ?? 0)}. Any payment already applied stays on the account as credit. A waived penalty is not charged again.</DialogDescription> : <DialogDescription>A credit note is issued for {formatKES(cancel?.currentCharges ?? 0)}. Any payment already applied stays on the customer's account as credit. The reading is unlocked so you can correct it and bill again. Only the customer's latest bill can be cancelled. Any late payment penalty on it is cancelled too.</DialogDescription>}</DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="wb-reason">Reason</Label><Textarea id="wb-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={cancel?.kind === "penalty" ? "e.g. Agreed with the customer" : "e.g. Wrong meter reading"} data-testid="input-cancel-reason" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCancel(null)}>{cancel?.kind === "penalty" ? "Keep penalty" : "Keep bill"}</Button><Button variant="destructive" disabled={!reason.trim() || doCancel.isPending} onClick={() => doCancel.mutate()} data-testid="button-confirm-cancel-bill">{cancel?.kind === "penalty" ? "Waive penalty" : "Cancel bill"}</Button></DialogFooter>
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
  const [dep, setDep] = useState<Customer | null>(null);
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
                <TableCell className={`text-right tabular-nums text-sm font-medium ${c.balance > 0.5 ? "text-destructive" : ""}`} data-testid={`text-balance-${c.id}`}>{c.balance < -0.5 ? `${formatKES(-c.balance)} cr` : formatKES(Math.max(0, c.balance))}<DepositStatus c={c} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end flex-wrap gap-1">
                    <RecordPaymentButton endpoint={`/api/water-billing/customers/${c.id}/record-payment`} due={c.balance} guestName={`${c.name} (${c.accountNo})`} summary="Account balance — applied to the oldest bill first" invalidate={[["/api/water-billing/bills"], ["/api/water-billing/customers"], ["/api/water-billing/summary"]]} testId={`wc-${c.id}`} compact />
                    <Button size="sm" variant="outline" title="Deposit" onClick={() => setDep(c)} data-testid={`button-deposit-${c.id}`}><PiggyBank className="h-4 w-4 mr-1" />Deposit</Button>
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
      {dep && <DepositDialog customer={dep} onClose={() => setDep(null)} />}
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
          <div className="sm:col-span-2 border-t pt-3 text-sm font-medium">Connection deposit <span className="font-normal text-xs text-muted-foreground">— typed in by hand, not receipted or posted to Finance. To receipt a deposit and post it, use the Deposit button on the customer list.</span></div>
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
function RemindersCard({ settings }: { settings: any }) {
  const { toast } = useToast();
  const [f, setF] = useState({ time: "09:00", pct: "5", grace: "10", from: "" });
  useEffect(() => { if (settings) setF({ time: settings.waterReminderTime, pct: String(settings.waterPenaltyPercent), grace: String(settings.waterPenaltyGraceDays), from: settings.waterPenaltyFrom }); }, [settings]);
  const { data: log = [], isLoading: logLoading } = useQuery<{ date: string; customer: string; accountNo: string; balance: number; sms: string | null; email: string | null }[]>({ queryKey: ["/api/water-billing/reminders"] });
  const save = useMutation({
    mutationFn: async (patch: any) => (await apiRequest("PATCH", "/api/water-billing/settings", patch)).json(),
    onSuccess: (r) => { queryClient.setQueryData(["/api/water-billing/settings"], r); toast({ title: "Reminder settings saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/water-billing/reminders/run", {})).json(),
    onSuccess: (r: any) => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ["/api/water-billing/reminders"] }); toast({ title: `${r.reminders.length} reminder${r.reminders.length === 1 ? "" : "s"} sent`, description: `${r.penalties.length} new penalt${r.penalties.length === 1 ? "y" : "ies"}. Customers already reminded today are skipped.` }); },
    onError: (e) => toast({ title: "Couldn't send reminders", description: errMsg(e), variant: "destructive" }),
  });
  const dirty = !!settings && (f.time !== settings.waterReminderTime || Number(f.pct) !== settings.waterPenaltyPercent || Number(f.grace) !== settings.waterPenaltyGraceDays || f.from !== settings.waterPenaltyFrom);
  const latest = log.length ? log[0].date : null;
  const latestRows = log.filter((l) => l.date === latest);
  const on = (k: string) => Number(settings?.[k] ?? 0) === 1;
  return (
    <Card className="p-4 space-y-4" data-testid="card-water-reminders">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="text-sm font-medium flex items-center gap-2"><BellRing className="h-4 w-4" />Reminders &amp; late payment penalties</div>
          <p className="text-xs text-muted-foreground mt-0.5">Every day at the set time, customers with an unpaid balance get a reminder until they are fully paid.</p></div>
        <Button variant="outline" size="sm" disabled={!settings || run.isPending} onClick={() => run.mutate()} data-testid="button-run-reminders"><Send className="h-4 w-4 mr-1" />{run.isPending ? "Sending…" : "Send today's reminders now"}</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={on("waterReminderEnabled")} onCheckedChange={(v) => save.mutate({ waterReminderEnabled: v ? 1 : 0 })} data-testid="switch-water-reminders" />Daily reminders</label>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5"><Label htmlFor="wr-time">Send at</Label><Input id="wr-time" type="time" className="w-32" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} data-testid="input-reminder-time" /></div>
            <label className="flex items-center gap-2 text-sm pb-2"><Switch checked={on("waterReminderSms")} onCheckedChange={(v) => save.mutate({ waterReminderSms: v ? 1 : 0 })} data-testid="switch-reminder-sms" />SMS</label>
            <label className="flex items-center gap-2 text-sm pb-2"><Switch checked={on("waterReminderEmail")} onCheckedChange={(v) => save.mutate({ waterReminderEmail: v ? 1 : 0 })} data-testid="switch-reminder-email" />Email with statement PDF</label>
          </div>
        </div>
        <div className="space-y-3 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={on("waterPenaltyEnabled")} onCheckedChange={(v) => save.mutate({ waterPenaltyEnabled: v ? 1 : 0 })} data-testid="switch-water-penalty" />Late payment penalty</label>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5"><Label htmlFor="wp-pct">Penalty (%)</Label><Input id="wp-pct" type="number" min="0" max="100" step="0.5" className="w-24" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} data-testid="input-penalty-percent" /></div>
            <div className="space-y-1.5"><Label htmlFor="wp-grace">Days after due date</Label><Input id="wp-grace" type="number" min="0" max="365" className="w-24" value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} data-testid="input-penalty-grace" /></div>
            <div className="space-y-1.5"><Label htmlFor="wp-from">For bills due from</Label><Input id="wp-from" type="date" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="input-penalty-from" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Charged once per bill, on what is still unpaid, when it is more than {f.grace || 0} days past its due date. Penalties never attract penalties. Waive one with its cancel button in Bills.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="text-reminder-last">{logLoading ? "" : latest ? `Last reminders ${prettyDate(latest)}: ${latestRows.length} customer${latestRows.length === 1 ? "" : "s"}${latestRows.length ? ` (${latestRows.slice(0, 4).map((l) => `${l.customer} ${formatKES(l.balance)}`).join(", ")}${latestRows.length > 4 ? ", …" : ""})` : ""}.` : "No reminders sent yet."}</p>
        <Button disabled={!dirty || save.isPending || !f.time || !f.from} onClick={() => save.mutate({ waterReminderTime: f.time, waterPenaltyPercent: Number(f.pct), waterPenaltyGraceDays: Number(f.grace), waterPenaltyFrom: f.from })} data-testid="button-save-reminders"><Save className="h-4 w-4 mr-1" />Save</Button>
      </div>
      {settings && !settings.smsEnabled && <p className="text-xs text-muted-foreground">SMS is turned off in Settings → SMS, so reminders will only be emailed.</p>}
    </Card>
  );
}

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
      <RemindersCard settings={settings} />
      <DepositAccountsCard />
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

/* ---------------- Deposits ---------------- */
type DepositRow = { id: number; amount: number; paid_on: string; payment_method: string; payment_reference: string | null; void_reference: string | null; bank_name: string | null; entry_number: string | null; reversal_number: string | null; status: string; cancel_reason: string | null; recorded_by: string | null; document_id: number | null };
const METHOD_LABEL: Record<string, string> = { mpesa: "M-Pesa", cash: "Cash", card: "Card", bank_transfer: "Bank transfer" };

/** "Deposit Ksh 1,500 · paid" when receipted and in Finance; "not receipted" when only typed in by hand; "No deposit yet" otherwise. */
function DepositStatus({ c }: { c: Customer }) {
  const total = c.depositAmount || 0, posted = c.depositPosted ?? 0;
  const paid = posted > 0.5 && total - posted < 0.5;
  return (
    <div className={`text-xs font-normal whitespace-nowrap ${paid ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`} data-testid={`text-deposit-${c.id}`}>
      {total < 0.5 ? "No deposit yet" : paid ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />Deposit {formatKES(total)} paid</span> : `Deposit ${formatKES(total)} · not receipted`}
    </div>
  );
}

function DepositDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const { data, isLoading } = useQuery<{ deposits: DepositRow[]; posted: number; total: number; handEntered: number }>({ queryKey: [`/api/water-billing/customers/${customer.id}/deposits`] });
  const { data: acc } = useQuery<{ liabilities: any[]; banks: any[]; depositAccountId: number | null; depositBankAccountId: number | null }>({ queryKey: ["/api/water-billing/deposit-accounts"] });
  const [f, setF] = useState({ amount: "", paymentMethod: "mpesa", paymentReference: "", paidOn: todayISO(), bankAccountId: "" });
  const [replaces, setReplaces] = useState(false);
  const [another, setAnother] = useState(false);
  const [sms, setSms] = useState("");
  const [smsAccount, setSmsAccount] = useState<string | null>(null);
  const [cancel, setCancel] = useState<DepositRow | null>(null);
  const [reason, setReason] = useState("");
  // The SMS names the receiving account (e.g. "***9914"): pick that bank once the list has loaded.
  useEffect(() => { const b = acc && bankFromSmsAccount(acc.banks ?? [], smsAccount); if (b) setF((x) => ({ ...x, bankAccountId: String(b.id) })); }, [acc, smsAccount]);
  useEffect(() => { if (acc && !f.bankAccountId && acc.depositBankAccountId) setF((x) => ({ ...x, bankAccountId: String(acc.depositBankAccountId) })); }, [acc]);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: [`/api/water-billing/customers/${customer.id}/deposits`] }); queryClient.invalidateQueries({ queryKey: ["/api/water-billing/customers"] }); queryClient.invalidateQueries({ queryKey: ["/api/documents"] }); };
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/water-billing/customers/${customer.id}/deposits`, {
      amount: Number(f.amount), paymentMethod: f.paymentMethod, paymentReference: f.paymentReference.trim() || null, paidOn: f.paidOn,
      bankAccountId: f.bankAccountId ? Number(f.bankAccountId) : null, replacesHandEntered: replaces })).json(),
    onSuccess: (r: any) => {
      refresh();
      toast({ title: `Deposit ${formatKES(r.amount)} recorded`, description: `Receipt ${r.receiptNo} · journal ${r.entryNumber} · SMS ${r.sms} · email ${r.email ?? "—"}. Total deposit held ${formatKES(r.total)}.` });
      setF((x) => ({ ...x, amount: "", paymentReference: "" })); setReplaces(false); setSms(""); setSmsAccount(null); setAnother(false);
    },
    onError: (e) => toast({ title: "Couldn't record the deposit", description: errMsg(e), variant: "destructive" }),
  });
  const doCancel = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/water-billing/deposits/${cancel!.id}/cancel`, { reason }),
    onSuccess: () => { refresh(); toast({ title: "Deposit cancelled", description: "The journal was reversed and the reference can be used again." }); setCancel(null); setReason(""); },
    onError: (e) => toast({ title: "Couldn't cancel", description: errMsg(e), variant: "destructive" }),
  });
  const notSetUp = acc && !acc.depositAccountId;
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const valid = Number(f.amount) > 0 && !!f.bankAccountId && (f.paymentMethod !== "mpesa" || f.paymentReference.trim().length > 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Water deposit — {customer.name} ({customer.accountNo})</DialogTitle>
          <DialogDescription>Money held for the customer, not income: it goes into the chosen bank account and the deposits held account in Finance. The customer gets a receipt by SMS{customer.email ? " and email" : ""}.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Card className="p-3"><div className="text-xs text-muted-foreground">Total deposit held</div><div className="font-semibold tabular-nums" data-testid="text-deposit-total">{data ? formatKES(data.total) : "…"}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">Receipted &amp; in Finance</div><div className="font-semibold tabular-nums" data-testid="text-deposit-posted">{data ? formatKES(data.posted) : "…"}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">Typed in by hand only</div><div className="font-semibold tabular-nums" data-testid="text-deposit-hand">{data ? formatKES(data.handEntered) : "…"}</div></Card>
        </div>
        {data && !notSetUp && data.posted > 0.5 && data.handEntered < 0.5 && !another ? (
          <div className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 flex flex-wrap items-center justify-between gap-3" data-testid="box-deposit-paid">
            <div className="text-sm">
              <div className="font-medium flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />Deposit paid — {formatKES(data.posted)}</div>
              <div className="text-muted-foreground text-xs mt-0.5">{data.deposits.filter((d) => d.status === "posted").map((d) => `${formatKES(d.amount)} on ${d.paid_on}${d.payment_reference ? ` (${d.payment_reference})` : ""}`).join(" · ")}. Receipted and posted to Finance — nothing more to record.</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAnother(true)} data-testid="button-deposit-another">Record another deposit</Button>
          </div>
        ) : notSetUp ? (
          <p className="text-sm text-destructive" data-testid="text-deposit-not-setup">Choose the deposits held account first: Water sales → Metered → Tariffs → Deposits{me?.isAdmin ? "" : " (an admin must do this)"}.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 border rounded-md p-3">
            <div className="sm:col-span-2"><PaymentSmsPaste value={sms} onChange={setSms} testId="deposit-sms" onRead={(d) => {
              setSmsAccount(d.account);
              setF((x) => ({ ...x, ...(d.amount != null ? { amount: String(d.amount) } : {}), ...(d.code ? { paymentReference: d.code, paymentMethod: "mpesa" } : {}),
                ...(d.paidOn && d.paidOn <= todayISO() ? { paidOn: d.paidOn } : {}) }));
            }} /></div>
            <div className="space-y-1.5"><Label htmlFor="dep-amt">Amount received (KES)</Label><Input id="dep-amt" type="number" min="0" value={f.amount} onChange={set("amount")} data-testid="input-deposit-amount" /></div>
            <div className="space-y-1.5"><Label>How they paid</Label>
              <Select value={f.paymentMethod} onValueChange={set("paymentMethod")}><SelectTrigger data-testid="select-deposit-method"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(METHOD_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="dep-ref">{f.paymentMethod === "mpesa" ? "M-Pesa code" : "Reference (optional)"}</Label><Input id="dep-ref" value={f.paymentReference} onChange={set("paymentReference")} className="uppercase" data-testid="input-deposit-reference" /></div>
            <div className="space-y-1.5"><Label htmlFor="dep-date">Date paid</Label><Input id="dep-date" type="date" max={todayISO()} value={f.paidOn} onChange={set("paidOn")} data-testid="input-deposit-date" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Paid into</Label>
              <Select value={f.bankAccountId} onValueChange={set("bankAccountId")}><SelectTrigger data-testid="select-deposit-bank"><SelectValue placeholder="Choose bank / cash account" /></SelectTrigger>
                <SelectContent>{(acc?.banks ?? []).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            {(data?.handEntered ?? 0) > 0.5 && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2"><Checkbox checked={replaces} onCheckedChange={(v) => setReplaces(!!v)} data-testid="checkbox-deposit-replaces" />
                <span>This payment is the {formatKES(data!.handEntered)} already typed in by hand — replace that figure instead of adding to it.</span></label>
            )}
            <div className="sm:col-span-2 flex justify-end"><Button disabled={!valid || save.isPending} onClick={() => save.mutate()} data-testid="button-save-deposit">{save.isPending ? "Recording…" : "Record deposit"}</Button></div>
          </div>
        )}
        <div>
          <div className="text-sm font-medium mb-2">Deposits recorded</div>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !data?.deposits.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Paid by</TableHead><TableHead className="hidden sm:table-cell">Finance</TableHead><TableHead className="text-right"></TableHead></TableRow></TableHeader>
              <TableBody>{data.deposits.map((d) => (
                <TableRow key={d.id} data-testid={`row-deposit-${d.id}`}>
                  <TableCell className="text-sm whitespace-nowrap">{d.paid_on}<div className="text-xs text-muted-foreground">{customer.accountNo}-D{d.id}</div></TableCell>
                  <TableCell className={`text-right tabular-nums text-sm ${d.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>{formatKES(d.amount)}</TableCell>
                  <TableCell className="text-sm">{METHOD_LABEL[d.payment_method] ?? d.payment_method}{(d.payment_reference || d.void_reference) ? ` · ${d.payment_reference || d.void_reference}` : ""}<div className="text-xs text-muted-foreground">{d.bank_name}</div></TableCell>
                  <TableCell className="hidden sm:table-cell text-xs">{d.entry_number}{d.status === "cancelled" ? <div className="text-muted-foreground">Cancelled{d.reversal_number ? ` (${d.reversal_number})` : ""}: {d.cancel_reason}</div> : null}</TableCell>
                  <TableCell className="text-right">{d.status === "posted" && <Button size="sm" variant="ghost" onClick={() => setCancel(d)} data-testid={`button-cancel-deposit-${d.id}`}><Ban className="h-4 w-4 mr-1" />Cancel</Button>}</TableCell>
                </TableRow>))}</TableBody>
            </Table></div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        <Dialog open={!!cancel} onOpenChange={(o) => { if (!o) { setCancel(null); setReason(""); } }}>
          <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Cancel deposit {cancel ? formatKES(cancel.amount) : ""}?</DialogTitle>
            <DialogDescription>Only for a deposit entered by mistake. The Finance entry is reversed today and the payment reference can be used again.</DialogDescription></DialogHeader>
            <div className="space-y-1.5"><Label htmlFor="dep-reason">Reason</Label><Textarea id="dep-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-cancel-deposit-reason" /></div>
            <DialogFooter><Button variant="outline" onClick={() => setCancel(null)}>Keep</Button><Button variant="destructive" disabled={reason.trim().length < 3 || doCancel.isPending} onClick={() => doCancel.mutate()} data-testid="button-confirm-cancel-deposit">Cancel deposit</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function DepositAccountsCard() {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const { data } = useQuery<{ liabilities: any[]; banks: any[]; depositAccountId: number | null; depositBankAccountId: number | null }>({ queryKey: ["/api/water-billing/deposit-accounts"] });
  const save = useMutation({
    mutationFn: async (patch: any) => apiRequest("PATCH", "/api/water-billing/deposit-accounts", patch),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/water-billing/deposit-accounts"] }); toast({ title: "Deposit accounts saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  if (!data) return null;
  return (
    <Card className="p-4 flex flex-wrap items-end gap-4" data-testid="card-deposit-accounts">
      <div className="w-full"><div className="text-sm font-medium">Deposits</div><p className="text-xs text-muted-foreground">Where customer meter deposits post in Finance. Deposits are held for the customer, so they go to a liability account, not income.</p></div>
      <div className="space-y-1.5 min-w-[16rem]"><Label>Deposits held account (liability)</Label>
        <Select disabled={!me?.isAdmin} value={data.depositAccountId ? String(data.depositAccountId) : ""} onValueChange={(v) => save.mutate({ depositAccountId: Number(v) })}>
          <SelectTrigger data-testid="select-deposit-liability"><SelectValue placeholder="Choose account" /></SelectTrigger>
          <SelectContent>{data.liabilities.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.code} · {a.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5 min-w-[14rem]"><Label>Usually paid into</Label>
        <Select disabled={!me?.isAdmin} value={data.depositBankAccountId ? String(data.depositBankAccountId) : ""} onValueChange={(v) => save.mutate({ depositBankAccountId: Number(v) })}>
          <SelectTrigger data-testid="select-deposit-default-bank"><SelectValue placeholder="Choose bank / cash account" /></SelectTrigger>
          <SelectContent>{data.banks.map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent></Select></div>
      {!me?.isAdmin && <p className="text-xs text-muted-foreground w-full">Only an admin can change these.</p>}
      {data.liabilities.length === 0 && <p className="text-xs text-destructive w-full">No liability accounts yet. Add one in Finance → Chart of accounts (e.g. 2150 Water Customer Deposits).</p>}
    </Card>
  );
}

export type Check = { key: string; label: string; ok: boolean; block?: boolean; detail: string };
export function CheckList({ checks, testId }: { checks: Check[]; testId?: string }) {
  return (
    <ul className="space-y-1 text-sm" data-testid={testId}>
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          {c.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" /> : c.block ? <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />}
          <span><span className="font-medium">{c.label}</span> <span className="text-muted-foreground">· {c.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

type PaymentClaim = { id: number; customerId: number; customerName: string; accountNo: string; message: string; reference: string; amount: number; paidAt: number | null; payerName: string | null; status: string; submittedBy: string; submittedAt: number; balance: number; checks: Check[] };
/** M-Pesa messages pasted by meter readers. The office confirms (posts the payment) or rejects; reminders pause meanwhile. */
function PaymentClaimsCard() {
  const { toast } = useToast();
  const { data: claims = [] } = useQuery<PaymentClaim[]>({ queryKey: ["/api/water-billing/payment-claims", "pending"], queryFn: async () => (await apiRequest("GET", "/api/water-billing/payment-claims?status=pending")).json(), refetchInterval: 60000 });
  const [confirm, setConfirm] = useState<PaymentClaim | null>(null);
  const [reject, setReject] = useState<PaymentClaim | null>(null);
  const [amount, setAmount] = useState(""); const [reason, setReason] = useState("");
  const refresh = () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ["/api/water-billing/payment-claims"] }); };
  const doConfirm = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/water-billing/payment-claims/${confirm!.id}/confirm`, { amount: Number(amount) })).json(),
    onSuccess: (r: any) => { refresh(); toast({ title: "Payment posted", description: `${formatKES(r.amount)} received. ${r.balance > 0.5 ? `Balance ${formatKES(r.balance)}.` : "Account fully paid."} Receipt sent.` }); setConfirm(null); },
    onError: (e) => toast({ title: "Couldn't post", description: errMsg(e), variant: "destructive" }),
  });
  const doReject = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/water-billing/payment-claims/${reject!.id}/reject`, { reason })).json(),
    onSuccess: () => { refresh(); toast({ title: "Payment rejected", description: "Reminders to this customer resume." }); setReject(null); setReason(""); },
    onError: (e) => toast({ title: "Couldn't reject", description: errMsg(e), variant: "destructive" }),
  });
  if (!claims.length) return null;
  return (
    <Card className="p-4 space-y-3 border-amber-500/50" data-testid="card-payment-claims">
      <div><div className="text-sm font-medium flex items-center gap-2"><Smartphone className="h-4 w-4" />Payments to check ({claims.length})</div>
        <p className="text-xs text-muted-foreground mt-0.5">M-Pesa and bank messages pasted by meter readers. Check each against your M-Pesa / bank statement, then confirm to post it. Reminders and penalties for these customers are paused until you decide.</p></div>
      {claims.map((c) => {
        const warn = c.checks.filter((x) => !x.ok).length;
        return (
          <div key={c.id} className="rounded-md border p-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-start" data-testid={`row-payment-claim-${c.id}`}>
            <div className="min-w-0 text-sm">
              <div className="font-medium truncate">{c.customerName} <span className="text-xs text-muted-foreground font-normal">{c.accountNo}</span></div>
              <div><span className="font-medium">{formatKES(c.amount)}</span> · {c.reference}</div>
              <div className="text-xs text-muted-foreground">Balance {formatKES(c.balance)} · pasted by {c.submittedBy}, {new Date(c.submittedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              <Badge variant={warn ? "default" : "secondary"} className="mt-1">{warn ? `${warn} check${warn === 1 ? "" : "s"} need attention` : "All checks passed"}</Badge>
            </div>
            <div className="space-y-2 min-w-0"><CheckList checks={c.checks} testId={`list-payment-claim-checks-${c.id}`} />
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Pasted message</summary><p className="mt-1 whitespace-pre-wrap break-words">{c.message}</p></details></div>
            <div className="flex gap-2 md:flex-col">
              <Button size="sm" onClick={() => { setConfirm(c); setAmount(String(Math.min(c.amount, Math.max(0, c.balance)))); }} data-testid={`button-confirm-claim-${c.id}`}><CheckCircle2 className="h-4 w-4 mr-1" />Confirm &amp; post</Button>
              <Button size="sm" variant="outline" onClick={() => { setReject(c); setReason(""); }} data-testid={`button-reject-claim-${c.id}`}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
            </div>
          </div>
        );
      })}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Post {confirm?.reference}?</DialogTitle>
            <DialogDescription>Only confirm once you have seen this payment on the M-Pesa or bank statement. The payment is applied to {confirm?.customerName}'s oldest bills first and a receipt is sent.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="pc-amount">Amount to post (KES)</Label><Input id="pc-amount" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-claim-amount" />
            {confirm && confirm.amount > confirm.balance + 0.5 && <p className="text-xs text-muted-foreground">The message shows {formatKES(confirm.amount)} but the balance is {formatKES(confirm.balance)}.</p>}</div>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Back</Button><Button disabled={!(Number(amount) > 0) || doConfirm.isPending} onClick={() => doConfirm.mutate()} data-testid="button-confirm-claim-post">{doConfirm.isPending ? "Posting…" : "Confirm & post"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reject {reject?.reference}?</DialogTitle>
            <DialogDescription>Nothing is posted and payment reminders to {reject?.customerName} resume. {reject?.submittedBy} is told why.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="pc-reason">Reason</Label><Textarea id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not on the M-Pesa statement" data-testid="input-claim-reject-reason" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setReject(null)}>Back</Button><Button variant="destructive" disabled={reason.trim().length < 3 || doReject.isPending} onClick={() => doReject.mutate()} data-testid="button-confirm-claim-reject">Reject</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
