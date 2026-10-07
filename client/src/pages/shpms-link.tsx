// Tenants → SHPMS link. Tenant payments declared in SHPMS wait here for staff to Confirm or Query;
// payments recorded here go to SHPMS first. Admins set up the link (address, shared key, accounts).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, CheckCircle2, HelpCircle, RefreshCw, KeyRound, Copy, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, todayISO } from "@/lib/format";

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const when = (ms?: number | null) => (ms ? new Date(Number(ms)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const refresh = () => { for (const k of ["/api/shpms/declarations", "/api/shpms/payments", "/api/shpms/events", "/api/shpms/settings", "/api/rent-invoices", "/api/tenancy-leases", "/api/tenants-list", "/api/shops"]) queryClient.invalidateQueries({ queryKey: [k] }); };

interface LinkSettings { enabled: boolean; baseUrl: string; secretHint: string; hasSecret: boolean; bankAccountId: number | null; receivableAccountId: number | null; rentIncomeAccountId: number | null; otherIncomeAccountId: number | null; depositAccountId: number | null; lastSnapshotAt: number | null; environment: string; webhookPath: string; isAdmin: boolean }
interface Accounts { accounts: { id: number; code: string; name: string; type: string }[]; banks: { id: number; name: string }[] }
interface Decl { id: number; declaration_no: string | null; lease_id: number; amount: number; paid_on: string | null; method: string | null; reference: string | null; period_start: string | null; narrative: string | null; status: string; query_reason: string | null; confirmed_by: string | null; confirmed_in: string | null; tenant_name: string | null; shop_number: string | null; receipt_no: string | null }
interface Pay { id: number; source: string; lease_id: number; amount: number; paid_on: string; payment_method: string | null; payment_reference: string | null; attempted_reference: string | null; receipt_no: string | null; status: string; error: string | null; recorded_by: string | null; tenant_name: string | null; shop_number: string | null; bank_name: string | null; entry_number: string | null; created_at: number }
interface Ev { id: number; event_id: string; event_type: string; status: string; error: string | null; attempts: number; received_at: number }

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  declared: { label: "To confirm", variant: "default" }, queried: { label: "Queried", variant: "destructive" }, confirmed: { label: "Confirmed", variant: "secondary" }, withdrawn: { label: "Withdrawn", variant: "outline" },
  posted: { label: "Posted", variant: "secondary" }, failed: { label: "Not recorded", variant: "outline" }, pending: { label: "In progress", variant: "outline" }, journal_failed: { label: "Finance failed", variant: "destructive" }, void: { label: "Voided", variant: "outline" },
  processed: { label: "Recorded", variant: "secondary" }, ignored: { label: "Not needed", variant: "outline" },
};
const StatusBadge = ({ s }: { s: string }) => <Badge variant={STATUS[s]?.variant ?? "outline"} className="whitespace-nowrap">{STATUS[s]?.label ?? s}</Badge>;
const EVENT: Record<string, string> = { "lease.updated": "Lease", "invoice.updated": "Invoice", "credit_note.issued": "Credit note", "declaration.updated": "Tenant payment", "receipt.updated": "Receipt" };

export function ShpmsTab() {
  const { data: settings } = useQuery<LinkSettings>({ queryKey: ["/api/shpms/settings"] });
  const { data: decls = [] } = useQuery<Decl[]>({ queryKey: ["/api/shpms/declarations"], refetchInterval: 60_000 });
  const { data: pays = [] } = useQuery<Pay[]>({ queryKey: ["/api/shpms/payments"] });
  const { data: events = [] } = useQuery<Ev[]>({ queryKey: ["/api/shpms/events"] });
  // Attempts SHPMS turned away left nothing behind, so they are not listed as payments.
  const shownPays = pays.filter((p) => p.status !== "failed");
  const sortedEvents = [...events].sort((a, b) => Number(b.status === "failed") - Number(a.status === "failed"));
  const toConfirm = decls.filter((d) => d.status === "declared" || d.status === "queried");
  const done = decls.filter((d) => !(d.status === "declared" || d.status === "queried"));
  const [confirm, setConfirm] = useState<Decl | null>(null);
  const [query, setQuery] = useState<Decl | null>(null);
  const [record, setRecord] = useState(false);
  const failedEvents = events.filter((e) => e.status === "failed").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground max-w-3xl">
          Tenancies for The Chekata are managed in SHPMS (Seanes Homes). Leases, rent invoices and tenant payments arrive here automatically and post to Finance.
          Confirm a payment here or in SHPMS, whichever comes first; the other system updates itself.
        </p>
        <div className="flex items-center gap-2">
          {settings && <Badge variant={settings.enabled ? "secondary" : "outline"} data-testid="badge-shpms-status"><Link2 className="h-3 w-3 mr-1" />{settings.enabled ? "Link on" : "Link off"}</Badge>}
          <Button size="sm" variant="outline" onClick={() => setRecord(true)} disabled={!settings?.enabled} data-testid="button-shpms-record-payment"><Plus className="h-4 w-4 mr-1" /> Record payment</Button>
        </div>
      </div>

      <Card className="p-4 space-y-3" data-testid="card-shpms-to-confirm">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Payments to confirm</h2><Badge variant="outline">{toConfirm.length}</Badge></div>
        {toConfirm.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting. Payments tenants declare in SHPMS appear here.</p> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Paid on</TableHead><TableHead>Shop / Tenant</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Method · Reference</TableHead><TableHead>For</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{toConfirm.map((d) => (
              <TableRow key={d.id} data-testid={`row-shpms-decl-${d.id}`}>
                <TableCell className="whitespace-nowrap">{d.paid_on ?? "—"}</TableCell>
                <TableCell className="min-w-[11rem]">{d.shop_number ?? "—"} — {d.tenant_name ?? "—"}{d.narrative ? <div className="text-xs text-muted-foreground">{d.narrative}</div> : null}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKES(d.amount)}</TableCell>
                <TableCell className="whitespace-nowrap">{methodLabel(d.method)}{d.reference ? <> · <span className="font-mono">{d.reference}</span></> : null}</TableCell>
                <TableCell className="whitespace-nowrap">{d.period_start ? d.period_start.slice(0, 7) : "—"}</TableCell>
                <TableCell><StatusBadge s={d.status} />{d.status === "queried" && d.query_reason ? <div className="text-xs text-muted-foreground mt-1">{d.query_reason}</div> : null}</TableCell>
                <TableCell className="text-right"><div className="flex justify-end gap-1">
                  <Button size="sm" onClick={() => setConfirm(d)} data-testid={`button-shpms-confirm-${d.id}`}><CheckCircle2 className="h-4 w-4 mr-1" /> Confirm</Button>
                  {d.status === "declared" && <Button size="sm" variant="outline" onClick={() => setQuery(d)} data-testid={`button-shpms-query-${d.id}`}><HelpCircle className="h-4 w-4 mr-1" /> Query</Button>}
                </div></TableCell>
              </TableRow>))}
            </TableBody></Table></div>)}
      </Card>

      <Card className="p-4 space-y-3" data-testid="card-shpms-payments">
        <h2 className="font-semibold">Rent payments</h2>
        {shownPays.length === 0 ? <p className="text-sm text-muted-foreground">No SHPMS rent payments yet.</p> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Paid on</TableHead><TableHead>Shop / Tenant</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reference</TableHead><TableHead>SHPMS receipt</TableHead><TableHead>Confirmed</TableHead><TableHead>Finance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{shownPays.map((p) => (
              <TableRow key={p.id} data-testid={`row-shpms-payment-${p.id}`}>
                <TableCell className="whitespace-nowrap">{p.paid_on}</TableCell>
                <TableCell className="min-w-[11rem]">{p.shop_number ?? "—"} — {p.tenant_name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKES(p.amount)}</TableCell>
                <TableCell className="whitespace-nowrap"><span className="font-mono">{p.payment_reference ?? p.attempted_reference ?? "—"}</span></TableCell>
                <TableCell className="whitespace-nowrap">{p.receipt_no ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{p.source === "chekata" ? `Here · ${p.recorded_by ?? ""}` : "In SHPMS"}</TableCell>
                <TableCell className="whitespace-nowrap">{p.entry_number ? `${p.entry_number} · ${p.bank_name ?? ""}` : "—"}</TableCell>
                <TableCell><StatusBadge s={p.status} />{p.error && p.status !== "posted" ? <div className="text-xs text-muted-foreground mt-1 max-w-xs">{p.error}</div> : null}</TableCell>
              </TableRow>))}
            </TableBody></Table></div>)}
      </Card>

      {settings?.isAdmin ? <LinkSettingsCard settings={settings} /> : settings && (
        <Card className="p-4 text-sm text-muted-foreground">Only an admin can change the SHPMS link settings.{settings.lastSnapshotAt ? ` Last full sync ${when(settings.lastSnapshotAt)}.` : ""}</Card>
      )}

      <Card className="p-4 space-y-3" data-testid="card-shpms-events">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Updates from SHPMS</h2>{failedEvents > 0 && <Badge variant="destructive">{failedEvents} not recorded</Badge>}</div>
        {events.length === 0 ? <p className="text-sm text-muted-foreground">No updates received yet.</p> : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto"><Table>
            <TableHeader><TableRow><TableHead>Received</TableHead><TableHead>Update</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>{sortedEvents.slice(0, 100).map((e) => (
              <TableRow key={e.id}><TableCell className="whitespace-nowrap">{when(e.received_at)}</TableCell><TableCell className="whitespace-nowrap">{EVENT[e.event_type] ?? `Other (${e.event_type})`}</TableCell>
                <TableCell><StatusBadge s={e.status} /></TableCell><TableCell className="text-xs text-muted-foreground">{e.error ?? (e.attempts > 1 ? `Recorded after ${e.attempts} tries` : "")}</TableCell></TableRow>))}
            </TableBody></Table></div>)}
        {failedEvents > 0 && <p className="text-xs text-muted-foreground">SHPMS keeps resending an update that wasn't recorded until it succeeds — fix the reason shown (for example, reopen a closed accounting period).</p>}
      </Card>

      {confirm && <ConfirmDialog decl={confirm} defaultBank={settings?.bankAccountId ?? null} onClose={() => setConfirm(null)} />}
      {query && <QueryDialog decl={query} onClose={() => setQuery(null)} />}
      {record && <RecordDialog defaultBank={settings?.bankAccountId ?? null} onClose={() => setRecord(false)} />}
    </div>
  );
}

function BankSelect({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  const { data } = useQuery<Accounts>({ queryKey: ["/api/shpms/accounts"] });
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder="Select bank account" /></SelectTrigger>
      <SelectContent>{(data?.banks ?? []).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function ConfirmDialog({ decl, defaultBank, onClose }: { decl: Decl; defaultBank: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const [bank, setBank] = useState(defaultBank ? String(defaultBank) : "");
  const [paidOn, setPaidOn] = useState(decl.paid_on ?? todayISO());
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/shpms/declarations/${decl.id}/confirm`, { bankAccountId: bank ? Number(bank) : null, paidOn })).json(),
    onSuccess: (r: any) => { refresh(); toast({ title: "Payment confirmed", description: `${formatKES(r.amount)} posted to Finance${r.receiptNo ? `; SHPMS receipt ${r.receiptNo}` : ""}.` }); onClose(); },
    onError: (e) => { refresh(); toast({ title: "Not confirmed", description: errMsg(e), variant: "destructive" }); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Confirm payment</DialogTitle>
          <DialogDescription>Check that {formatKES(decl.amount)}{decl.reference ? ` (${decl.reference})` : ""} reached the bank before you confirm. SHPMS issues the tenant's receipt.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm"><span className="text-muted-foreground">From:</span> {decl.shop_number ?? ""} — {decl.tenant_name ?? ""}</div>
          <div className="space-y-1.5"><Label>Paid into</Label><BankSelect value={bank} onChange={setBank} testId="select-shpms-confirm-bank" /></div>
          <div className="space-y-1.5"><Label htmlFor="shpms-paid-on">Date received</Label><Input id="shpms-paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} data-testid="input-shpms-confirm-date" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!bank || !paidOn || m.isPending} data-testid="button-shpms-confirm-save">{m.isPending ? "Confirming…" : "Confirm payment"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueryDialog({ decl, onClose }: { decl: Decl; onClose: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/shpms/declarations/${decl.id}/query`, { reason })).json(),
    onSuccess: () => { refresh(); toast({ title: "Query sent to SHPMS", description: "The tenant is asked to check the payment." }); onClose(); },
    onError: (e) => toast({ title: "Not sent", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Query payment</DialogTitle><DialogDescription>{formatKES(decl.amount)}{decl.reference ? ` · ${decl.reference}` : ""} from {decl.tenant_name ?? "the tenant"}. Say what's wrong so they can fix it.</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No M-Pesa payment with this code reached the account." data-testid="input-shpms-query-reason" />
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} disabled={reason.trim().length < 3 || m.isPending} data-testid="button-shpms-query-send">{m.isPending ? "Sending…" : "Send query"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordDialog({ defaultBank, onClose }: { defaultBank: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: leases = [] } = useQuery<any[]>({ queryKey: ["/api/tenancy-leases"] });
  const { data: shops = [] } = useQuery<any[]>({ queryKey: ["/api/shops"] });
  const { data: tenants = [] } = useQuery<any[]>({ queryKey: ["/api/tenants-list"] });
  const linked = leases.filter((l) => l.shpmsLeaseId && l.status === "active");
  const [leaseId, setLeaseId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("mpesa");
  const [ref, setRef] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [bank, setBank] = useState(defaultBank ? String(defaultBank) : "");
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shpms/payments", { leaseId: Number(leaseId), amount: Number(amount), paymentMethod: method, paymentReference: ref || null, paidOn, bankAccountId: bank ? Number(bank) : null })).json(),
    onSuccess: (r: any) => { refresh(); toast({ title: "Payment recorded", description: `${formatKES(r.amount)} sent to SHPMS${r.receiptNo ? ` (receipt ${r.receiptNo})` : ""} and posted to Finance.` }); onClose(); },
    onError: (e) => { refresh(); toast({ title: "Not recorded", description: errMsg(e), variant: "destructive" }); },
  });
  const label = (l: any) => `${shops.find((s) => s.id === l.shopId)?.shopNumber ?? l.shopId} — ${tenants.find((t) => t.id === l.tenantId)?.name ?? l.tenantId}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record rent payment</DialogTitle><DialogDescription>For money that reached The Chekata's account without the tenant declaring it in SHPMS. SHPMS allocates it and issues the receipt.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Lease</Label>
            <Select value={leaseId || undefined} onValueChange={setLeaseId}><SelectTrigger data-testid="select-shpms-record-lease"><SelectValue placeholder="Select lease" /></SelectTrigger>
              <SelectContent>{linked.map((l) => <SelectItem key={l.id} value={String(l.id)}>{label(l)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="shpms-amt">Amount (KES)</Label><Input id="shpms-amt" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-shpms-record-amount" /></div>
            <div className="space-y-1.5"><Label htmlFor="shpms-date">Date received</Label><Input id="shpms-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} data-testid="input-shpms-record-date" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Method</Label>
              <Select value={method} onValueChange={setMethod}><SelectTrigger data-testid="select-shpms-record-method"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="mpesa">M-Pesa</SelectItem><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="cheque">Cheque</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="shpms-ref">Reference</Label><Input id="shpms-ref" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="M-Pesa code / slip no." data-testid="input-shpms-record-ref" /></div>
          </div>
          <div className="space-y-1.5"><Label>Paid into</Label><BankSelect value={bank} onChange={setBank} testId="select-shpms-record-bank" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!leaseId || !(Number(amount) > 0) || !bank || !paidOn || m.isPending} data-testid="button-shpms-record-save">{m.isPending ? "Recording…" : "Record payment"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkSettingsCard({ settings }: { settings: LinkSettings }) {
  const { toast } = useToast();
  const { data } = useQuery<Accounts>({ queryKey: ["/api/shpms/accounts"] });
  const acc = (t: string) => (data?.accounts ?? []).filter((a) => a.type === t);
  const s = (v: number | null) => (v ? String(v) : "");
  const [enabled, setEnabled] = useState(settings.enabled);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [secret, setSecret] = useState("");
  const [shown, setShown] = useState("");
  const [bank, setBank] = useState(s(settings.bankAccountId));
  const [recv, setRecv] = useState(s(settings.receivableAccountId));
  const [rent, setRent] = useState(s(settings.rentIncomeAccountId));
  const [other, setOther] = useState(s(settings.otherIncomeAccountId));
  const [dep, setDep] = useState(s(settings.depositAccountId));
  useEffect(() => { setEnabled(settings.enabled); setBaseUrl(settings.baseUrl); setBank(s(settings.bankAccountId)); setRecv(s(settings.receivableAccountId)); setRent(s(settings.rentIncomeAccountId)); setOther(s(settings.otherIncomeAccountId)); setDep(s(settings.depositAccountId)); }, [settings]);
  const num = (v: string) => (v && v !== "none" ? Number(v) : null);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/shpms/settings", { enabled, baseUrl, ...(secret ? { secret } : {}), bankAccountId: num(bank), receivableAccountId: num(recv), rentIncomeAccountId: num(rent), otherIncomeAccountId: num(other), depositAccountId: num(dep) })).json(),
    onSuccess: () => { setSecret(""); setShown(""); refresh(); toast({ title: "SHPMS link saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const gen = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shpms/generate-secret", {})).json(),
    onSuccess: (r: any) => { setSecret(r.secret); setShown(r.secret); },
  });
  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shpms/test", {})).json(),
    onSuccess: () => toast({ title: "SHPMS answered", description: "The address and shared key work." }),
    onError: (e) => toast({ title: "Connection failed", description: errMsg(e), variant: "destructive" }),
  });
  const pull = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shpms/pull", {})).json(),
    onSuccess: (r: any) => { refresh(); toast({ title: "Synced from SHPMS", description: `${r.leases} leases, ${r.invoices} invoices, ${r.declarations} tenant payments, ${r.receipts} receipts.${r.failed?.length ? ` ${r.failed.length} not recorded — see Updates from SHPMS.` : ""}`, variant: r.failed?.length ? "destructive" : undefined }); },
    onError: (e) => toast({ title: "Sync failed", description: errMsg(e), variant: "destructive" }),
  });
  const webhook = `${window.location.origin}${settings.webhookPath}`;
  const AccSelect = ({ value, set, type, testId, optional }: { value: string; set: (v: string) => void; type: string; testId: string; optional?: string }) => (
    <Select value={value || (optional ? "none" : undefined)} onValueChange={set}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder="Select account" /></SelectTrigger>
      <SelectContent>{optional && <SelectItem value="none">{optional}</SelectItem>}{acc(type).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
    </Select>
  );
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast({ title: "Copied" })).catch(() => undefined); };
  return (
    <Card className="p-4 space-y-4" data-testid="card-shpms-settings">
      <div className="flex flex-wrap items-center gap-2"><Settings2 className="h-4 w-4 text-muted-foreground" /><h2 className="font-semibold">Link settings</h2><Badge variant="outline">Admin only</Badge>
        <Badge variant="outline">{settings.environment === "test" ? "Test system" : "Live system"}</Badge></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="shpms-url">SHPMS address</Label><Input id="shpms-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://pms.seaneshomes.com" data-testid="input-shpms-url" /></div>
        <div className="space-y-1.5"><Label htmlFor="shpms-key">Shared key</Label>
          <div className="flex gap-2"><Input id="shpms-key" type={shown ? "text" : "password"} value={secret} onChange={(e) => { setSecret(e.target.value); setShown(""); }} placeholder={settings.hasSecret ? `Saved (${settings.secretHint}) — leave blank to keep` : "Paste or generate"} data-testid="input-shpms-secret" autoComplete="off" />
            <Button type="button" variant="outline" onClick={() => gen.mutate()} title="Generate a new key" data-testid="button-shpms-generate-key"><KeyRound className="h-4 w-4" /></Button></div>
          {shown && <p className="text-xs text-muted-foreground">New key shown once. Copy it into SHPMS's link settings, then Save here. <button type="button" className="underline" onClick={() => copy(shown)}><Copy className="inline h-3 w-3" /> Copy</button></p>}
        </div>
        <div className="space-y-1.5"><Label>Rent is paid into</Label><BankSelect value={bank} onChange={setBank} testId="select-shpms-bank" /></div>
        <div className="space-y-1.5"><Label>Tenant receivable</Label><AccSelect value={recv} set={setRecv} type="asset" testId="select-shpms-receivable" /></div>
        <div className="space-y-1.5"><Label>Rent income</Label><AccSelect value={rent} set={setRent} type="income" testId="select-shpms-rent-income" /></div>
        <div className="space-y-1.5"><Label>Other charges income</Label><AccSelect value={other} set={setOther} type="income" testId="select-shpms-other-income" optional="Same as rent income" /></div>
        <div className="space-y-1.5"><Label>Tenant deposits held</Label><AccSelect value={dep} set={setDep} type="liability" testId="select-shpms-deposit" optional="Not used (deposits held by Seanes Homes)" /></div>
        <div className="space-y-1.5"><Label htmlFor="shpms-on">Link switched on</Label><div className="h-9 flex items-center gap-2"><Switch id="shpms-on" checked={enabled} onCheckedChange={setEnabled} data-testid="switch-shpms-enabled" /><span className="text-sm text-muted-foreground">{enabled ? "Receiving updates from SHPMS" : "Updates from SHPMS are refused"}</span></div></div>
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
        <div>Address for SHPMS to send updates to:</div>
        <div className="flex items-center gap-2"><code className="text-xs break-all" data-testid="text-shpms-webhook">{webhook}</code><Button size="icon" variant="ghost" onClick={() => copy(webhook)} title="Copy"><Copy className="h-4 w-4" /></Button></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-shpms-save">{save.isPending ? "Saving…" : "Save"}</Button>
        <Button variant="outline" onClick={() => test.mutate()} disabled={!settings.enabled || test.isPending} data-testid="button-shpms-test">{test.isPending ? "Testing…" : "Test connection"}</Button>
        <Button variant="outline" onClick={() => pull.mutate()} disabled={!settings.enabled || pull.isPending} data-testid="button-shpms-pull"><RefreshCw className="h-4 w-4 mr-1" />{pull.isPending ? "Syncing…" : "Sync everything from SHPMS"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Sync everything is safe to repeat: anything already recorded is skipped.{settings.lastSnapshotAt ? ` Last full sync ${when(settings.lastSnapshotAt)}.` : ""}</p>
    </Card>
  );
}

const METHODS: Record<string, string> = { mpesa: "M-Pesa", "m-pesa": "M-Pesa", cash: "Cash", bank: "Bank transfer", bank_transfer: "Bank transfer", cheque: "Cheque", card: "Card" };
function methodLabel(m?: string | null) { if (!m) return "—"; return METHODS[m.toLowerCase()] ?? m; }
