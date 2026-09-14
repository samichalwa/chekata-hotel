import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Download, CheckCircle2, Ban, Wallet, Users, FileSpreadsheet, Landmark } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, titleCase, todayISO } from "@/lib/format";
import type { Staff as StaffMember, StatutoryRateTable, PayeBand, PayrollRun, PayrollLine } from "@shared/schema";

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch { /* not JSON */ }
  return body;
}

function periodLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split("-").map(Number);
  if (!y || !m) return periodMonth;
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", { month: "long", year: "numeric" });
}

const runStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", approved: "secondary", cancelled: "destructive",
};

// ---------------- Statutory Rates tab ----------------
function PersonalReliefCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ payePersonalRelief: number }>({ queryKey: ["/api/payroll/personal-relief"] });
  const [value, setValue] = useState("");
  useEffect(() => { if (data) setValue(String(data.payePersonalRelief)); }, [data]);

  const mutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/payroll/personal-relief", { payePersonalRelief: Number(value) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/personal-relief"] }); toast({ title: "Personal relief updated" }); },
    onError: (err: Error) => toast({ title: "Could not update personal relief", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Card className="p-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <Label>PAYE personal relief (KES/month)</Label>
        <p className="text-sm text-muted-foreground mt-1">Deducted from computed PAYE for every employee, per KRA rules.</p>
      </div>
      <div className="flex items-end gap-2">
        <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="w-36" disabled={isLoading} data-testid="input-personal-relief" />
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-personal-relief">
          {mutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </Card>
  );
}

function StatutoryRateEditDialog({ rate }: { rate: StatutoryRateTable }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({
    ratePercent: String(rate.ratePercent), lowerLimit: rate.lowerLimit != null ? String(rate.lowerLimit) : "",
    upperLimit: rate.upperLimit != null ? String(rate.upperLimit) : "", minAmount: rate.minAmount != null ? String(rate.minAmount) : "",
    active: !!rate.active,
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/payroll/statutory-rates/${rate.id}`, {
      ratePercent: Number(form.ratePercent),
      lowerLimit: form.lowerLimit === "" ? null : Number(form.lowerLimit),
      upperLimit: form.upperLimit === "" ? null : Number(form.upperLimit),
      minAmount: form.minAmount === "" ? null : Number(form.minAmount),
      active: form.active ? 1 : 0,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/statutory-rates"] }); toast({ title: "Rate updated" }); setOpen(false); },
    onError: (err: Error) => toast({ title: "Could not update rate", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-rate-${rate.id}`}><Pencil className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {rate.label}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Rate (%)</Label><Input type="number" step="0.01" value={form.ratePercent} onChange={(e) => setForm((f) => ({ ...f, ratePercent: e.target.value }))} data-testid="input-rate-percent" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Lower limit (KES, optional)</Label><Input type="number" value={form.lowerLimit} onChange={(e) => setForm((f) => ({ ...f, lowerLimit: e.target.value }))} data-testid="input-rate-lower" /></div>
            <div><Label>Upper limit (KES, optional)</Label><Input type="number" value={form.upperLimit} onChange={(e) => setForm((f) => ({ ...f, upperLimit: e.target.value }))} data-testid="input-rate-upper" /></div>
          </div>
          <div><Label>Minimum amount (KES, optional)</Label><Input type="number" value={form.minAmount} onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))} data-testid="input-rate-min" /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-rate">{mutation.isPending ? "Saving..." : "Save rate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatutoryRatesTable() {
  const { data: rates = [], isLoading } = useQuery<StatutoryRateTable[]>({ queryKey: ["/api/payroll/statutory-rates"] });
  return (
    <Card>
      <div className="p-4 border-b"><h3 className="font-medium">Statutory rates</h3><p className="text-sm text-muted-foreground">NSSF, SHIF and Housing Levy rates — edit as KRA/NSSF rules change.</p></div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Lower limit</TableHead>
                <TableHead className="text-right">Upper limit</TableHead>
                <TableHead className="text-right">Min amount</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id} data-testid={`row-rate-${r.key}`}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.ratePercent}%</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lowerLimit != null ? formatKES(r.lowerLimit) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.upperLimit != null ? formatKES(r.upperLimit) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.minAmount != null ? formatKES(r.minAmount) : "—"}</TableCell>
                  <TableCell><Badge variant={r.active ? "secondary" : "outline"}>{r.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right"><StatutoryRateEditDialog rate={r} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function PayeBandFormDialog({ band, trigger }: { band?: PayeBand; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({
    bandFrom: band ? String(band.bandFrom) : "0", bandTo: band?.bandTo != null ? String(band.bandTo) : "",
    ratePercent: band ? String(band.ratePercent) : "10", sortOrder: band ? String(band.sortOrder) : "0",
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { bandFrom: Number(form.bandFrom), bandTo: form.bandTo === "" ? null : Number(form.bandTo), ratePercent: Number(form.ratePercent), sortOrder: Number(form.sortOrder) };
      if (band) return apiRequest("PATCH", `/api/payroll/paye-bands/${band.id}`, payload);
      return apiRequest("POST", "/api/payroll/paye-bands", payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/paye-bands"] }); toast({ title: band ? "PAYE band updated" : "PAYE band added" }); setOpen(false); },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{band ? "Edit PAYE band" : "Add PAYE band"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Band from (KES)</Label><Input type="number" value={form.bandFrom} onChange={(e) => setForm((f) => ({ ...f, bandFrom: e.target.value }))} data-testid="input-band-from" /></div>
            <div><Label>Band to (KES, blank = no limit)</Label><Input type="number" value={form.bandTo} onChange={(e) => setForm((f) => ({ ...f, bandTo: e.target.value }))} data-testid="input-band-to" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Rate (%)</Label><Input type="number" step="0.5" value={form.ratePercent} onChange={(e) => setForm((f) => ({ ...f, ratePercent: e.target.value }))} data-testid="input-band-rate" /></div>
            <div><Label>Sort order</Label><Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} data-testid="input-band-sort" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-band">{mutation.isPending ? "Saving..." : "Save band"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayeBandsTable() {
  const { toast } = useToast();
  const { data: bands = [], isLoading } = useQuery<PayeBand[]>({ queryKey: ["/api/payroll/paye-bands"] });
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder || a.bandFrom - b.bandFrom);
  const deleteBand = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/payroll/paye-bands/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/paye-bands"] }); toast({ title: "PAYE band removed" }); },
  });

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <div><h3 className="font-medium">PAYE bands</h3><p className="text-sm text-muted-foreground">Progressive income-tax bands per KRA (Finance Act 2023).</p></div>
        <PayeBandFormDialog trigger={<Button size="sm" data-testid="button-new-band"><Plus className="h-4 w-4 mr-1" /> Add band</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((b) => (
                <TableRow key={b.id} data-testid={`row-band-${b.id}`}>
                  <TableCell className="tabular-nums">{formatKES(b.bandFrom)}</TableCell>
                  <TableCell className="tabular-nums">{b.bandTo != null ? formatKES(b.bandTo) : "No limit"}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.ratePercent}%</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <PayeBandFormDialog band={b} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-band-${b.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-band-${b.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete this PAYE band?</AlertDialogTitle><AlertDialogDescription>This removes the band permanently.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteBand.mutate(b.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function StatutoryRatesTab() {
  return (
    <div className="space-y-6">
      <PersonalReliefCard />
      <StatutoryRatesTable />
      <PayeBandsTable />
    </div>
  );
}

// ---------------- Pay Runs tab ----------------
function NewPayRunDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const today = todayISO();
  const [form, setForm] = useState({ periodMonth: today.slice(0, 7), periodStart: today.slice(0, 8) + "01", periodEnd: today });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/payroll/runs", form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] }); toast({ title: "Pay run created" }); setOpen(false); },
    onError: (err: Error) => toast({ title: "Could not create pay run", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-payrun"><Plus className="h-4 w-4 mr-1" /> New pay run</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New pay run</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Period month</Label><Input type="month" value={form.periodMonth} onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value }))} data-testid="input-payrun-month" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Period start</Label><Input type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} data-testid="input-payrun-start" /></div>
            <div><Label>Period end</Label><Input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} data-testid="input-payrun-end" /></div>
          </div>
          <p className="text-sm text-muted-foreground">Calculates gross pay, PAYE, NSSF, SHIF and Housing Levy for every active staff member as of this run.</p>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-create-payrun">{mutation.isPending ? "Creating..." : "Create pay run"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayRunDetailSheet({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { toast } = useToast();
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const { data: lines = [], isLoading } = useQuery<PayrollLine[]>({ queryKey: [`/api/payroll/runs/${run.id}/lines`] });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const approve = useMutation({
    mutationFn: () => apiRequest("POST", `/api/payroll/runs/${run.id}/approve`).then((r) => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: [`/api/payroll/runs/${run.id}/lines`] });
      const summary = data?.payslipEmailSummary as { sent: number; skipped: number; failed: number; total: number } | undefined;
      let description = "Payslips have been emailed to staff with an email on file.";
      if (summary) {
        const parts: string[] = [];
        if (summary.sent > 0) parts.push(`${summary.sent} emailed`);
        if (summary.skipped > 0) parts.push(`${summary.skipped} skipped (no email on file)`);
        if (summary.failed > 0) parts.push(`${summary.failed} failed to send`);
        description = parts.length > 0 ? `Payslips: ${parts.join(", ")}.` : "No payslips to email for this run.";
      }
      toast({
        title: "Pay run approved",
        description,
        variant: summary && summary.failed > 0 ? "destructive" : undefined,
      });
    },
    onError: (err: Error) => toast({ title: "Could not approve pay run", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: () => apiRequest("POST", `/api/payroll/runs/${run.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      toast({ title: "Pay run cancelled" });
      setCancelOpen(false);
      onClose();
    },
    onError: (err: Error) => toast({ title: "Could not cancel pay run", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <SheetContent className="sm:max-w-2xl overflow-y-auto">
      <SheetHeader>
        <SheetTitle>{run.runNumber} — {periodLabel(run.periodMonth)}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant={runStatusVariant[run.status]}>{titleCase(run.status)}</Badge>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild data-testid="button-download-bankadvice">
              <a href={`/api/payroll/runs/${run.id}/bank-advice`} target="_blank" rel="noopener noreferrer">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Bank advice
              </a>
            </Button>
            {run.status === "draft" && (
              <>
                <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="button-approve-payrun">
                  <CheckCircle2 className="h-4 w-4 mr-1" /> {approve.isPending ? "Approving..." : "Approve & email payslips"}
                </Button>
                <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
                  <AlertDialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-cancel-payrun"><Ban className="h-4 w-4 mr-1" /> Cancel</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Cancel this pay run?</AlertDialogTitle><AlertDialogDescription>Provide a reason for the cancellation.</AlertDialogDescription></AlertDialogHeader>
                    <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancellation" data-testid="input-cancel-payrun-reason" />
                    <AlertDialogFooter><AlertDialogCancel>Back</AlertDialogCancel><AlertDialogAction onClick={() => cancel.mutate()}>Confirm cancel</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><div className="text-muted-foreground">Gross</div><div className="font-medium tabular-nums">{formatKES(run.totalGross)}</div></div>
          <div><div className="text-muted-foreground">Deductions</div><div className="font-medium tabular-nums">{formatKES(run.totalDeductions)}</div></div>
          <div><div className="text-muted-foreground">Net pay</div><div className="font-medium tabular-nums">{formatKES(run.totalNet)}</div></div>
          <div><div className="text-muted-foreground">Employer cost</div><div className="font-medium tabular-nums">{formatKES(run.totalEmployerCost)}</div></div>
        </div>

        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading lines…</div>
        ) : (
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">PAYE</TableHead>
                  <TableHead className="text-right">NSSF</TableHead>
                  <TableHead className="text-right">SHIF</TableHead>
                  <TableHead className="text-right">Housing</TableHead>
                  <TableHead className="text-right">Net pay</TableHead>
                  <TableHead>Payslip email</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id} data-testid={`row-payrollline-${l.id}`}>
                    <TableCell className="font-medium">{staffMap.get(l.staffId)?.name ?? `Staff #${l.staffId}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.grossPay)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.payeAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.nssfEmployeeAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.shifAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.housingLevyEmployeeAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatKES(l.netPay)}</TableCell>
                    <TableCell>
                      {l.payslipEmailStatus ? (
                        <Badge variant={l.payslipEmailStatus === "sent" ? "secondary" : l.payslipEmailStatus === "failed" ? "destructive" : "outline"} title={l.payslipEmailError ?? undefined}>
                          {titleCase(l.payslipEmailStatus)}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" title="Download payslip" asChild data-testid={`button-download-payslip-${l.id}`}>
                        <a href={`/api/payroll/lines/${l.id}/payslip-pdf`} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" /></a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SheetContent>
  );
}

function PayRunsTab() {
  const { data: runs = [], isLoading } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll/runs"] });
  const [selected, setSelected] = useState<PayrollRun | null>(null);
  const sorted = [...runs].sort((a, b) => b.id - a.id);

  return (
    <Card>
      <div className="p-4 flex justify-end border-b">
        <NewPayRunDialog />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No pay runs yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id} data-testid={`row-payrun-${r.id}`} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="font-medium">{r.runNumber}</TableCell>
                  <TableCell>{periodLabel(r.periodMonth)}</TableCell>
                  <TableCell><Badge variant={runStatusVariant[r.status]}>{titleCase(r.status)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(r.totalGross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(r.totalNet)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelected(r); }} data-testid={`button-view-payrun-${r.id}`}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        {selected && <PayRunDetailSheet run={selected} onClose={() => setSelected(null)} />}
      </Sheet>
    </Card>
  );
}

export default function Payroll() {
  const { data: runs = [] } = useQuery<PayrollRun[]>({ queryKey: ["/api/payroll/runs"] });
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const activeStaff = staff.filter((s) => s.status === "active").length;
  const lastApproved = [...runs].filter((r) => r.status === "approved").sort((a, b) => b.id - a.id)[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Payroll" description="Statutory rates, PAYE bands, pay runs, payslips and bank-advice exports." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Active staff" value={String(activeStaff)} icon={Users} testId="stat-payroll-staff" />
        <StatCard label="Pay runs" value={String(runs.length)} icon={Wallet} testId="stat-payroll-runs" />
        <StatCard label="Last approved net pay" value={lastApproved ? formatKES(lastApproved.totalNet) : "—"} icon={Landmark} testId="stat-payroll-lastnet" />
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs" data-testid="tab-payroll-runs">Pay runs</TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-payroll-rates">Statutory rates</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="mt-4"><PayRunsTab /></TabsContent>
        <TabsContent value="rates" className="mt-4"><StatutoryRatesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
