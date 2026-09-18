import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Wallet, BookOpen, Landmark, Receipt, FileBarChart, Ban, CheckCircle2, CalendarRange, Lock, LockOpen } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, formatDate, todayISO } from "@/lib/format";
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS,
  type ChartOfAccount, type AccountingPeriod, type JournalEntry, type JournalEntryLine,
  type BankAccount, type PaymentVoucher,
} from "@shared/schema";

// ================= Chart of Accounts =================
const accountFormSchema = z.object({
  code: z.string().min(1, "Account code is required"),
  name: z.string().min(1, "Account name is required"),
  type: z.string().min(1),
  description: z.string().optional().nullable(),
  active: z.coerce.number().default(1),
});

function AccountFormDialog({ account, trigger }: { account?: ChartOfAccount; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.input<typeof accountFormSchema>, any, z.output<typeof accountFormSchema>>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: account
      ? { code: account.code, name: account.name, type: account.type, description: account.description ?? "", active: account.active }
      : { code: "", name: "", type: "asset", description: "", active: 1 },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof accountFormSchema>) => {
      if (account) return apiRequest("PATCH", `/api/finance/accounts/${account.id}`, values);
      return apiRequest("POST", "/api/finance/accounts", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/accounts"] });
      toast({ title: account ? "Account updated" : "Account created" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem><FormLabel>Account code</FormLabel><FormControl><Input placeholder="e.g. 1000" {...field} data-testid="input-account-code" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-account-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Account name</FormLabel><FormControl><Input {...field} data-testid="input-account-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-account-description" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-account-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-account">
                {mutation.isPending ? "Saving..." : "Save account"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ChartOfAccountsTab() {
  const { toast } = useToast();
  const { data: accounts = [], isLoading } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/finance/accounts"] });
  const deleteAccount = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/finance/accounts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/accounts"] }); toast({ title: "Account deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete account", description: err.message, variant: "destructive" }),
  });
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{accounts.length} account{accounts.length === 1 ? "" : "s"}</div>
        <AccountFormDialog trigger={<Button size="sm" data-testid="button-new-account"><Plus className="h-4 w-4 mr-1" /> Add account</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading chart of accounts…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No accounts yet. Add the first one.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((a) => (
                <TableRow key={a.id} data-testid={`row-account-${a.id}`}>
                  <TableCell className="font-mono">{a.code}</TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{ACCOUNT_TYPE_LABELS[a.type as keyof typeof ACCOUNT_TYPE_LABELS] ?? a.type}</TableCell>
                  <TableCell><Badge variant={a.active ? "secondary" : "outline"}>{a.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <AccountFormDialog account={a} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-account-${a.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-account-${a.id}`}><Trash2 className="h-4 w-4" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {a.name}?</AlertDialogTitle>
                            <AlertDialogDescription>This removes the account from the Chart of Accounts. Accounts with posted transactions can't be deleted.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteAccount.mutate(a.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
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

// ================= Accounting Periods =================
const periodFormSchema = z.object({
  name: z.string().min(1, "Period name is required"),
  financialYear: z.string().min(1, "Financial year is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  status: z.string().default("open"),
});

function PeriodFormDialog({ period, trigger }: { period?: AccountingPeriod; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const today = todayISO();
  const form = useForm<z.input<typeof periodFormSchema>, any, z.output<typeof periodFormSchema>>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: period
      ? { name: period.name, financialYear: period.financialYear, startDate: period.startDate, endDate: period.endDate, status: period.status }
      : { name: "", financialYear: `FY${today.slice(0, 4)}`, startDate: today.slice(0, 8) + "01", endDate: today, status: "open" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof periodFormSchema>) => {
      if (period) return apiRequest("PATCH", `/api/finance/periods/${period.id}`, values);
      return apiRequest("POST", "/api/finance/periods", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/periods"] });
      toast({ title: period ? "Period updated" : "Period created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{period ? "Edit period" : "New accounting period"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Period name</FormLabel><FormControl><Input placeholder="e.g. September 2026" {...field} data-testid="input-period-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="financialYear" render={({ field }) => (
                <FormItem><FormLabel>Financial year</FormLabel><FormControl><Input placeholder="e.g. FY2026" {...field} data-testid="input-period-fy" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem><FormLabel>Start date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-period-start" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem><FormLabel>End date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-period-end" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-period-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-period">
                {mutation.isPending ? "Saving..." : "Save period"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function PeriodsTab() {
  const { toast } = useToast();
  const { data: periods = [], isLoading } = useQuery<AccountingPeriod[]>({ queryKey: ["/api/finance/periods"] });
  const deletePeriod = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/finance/periods/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/periods"] }); toast({ title: "Period deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete period", description: err.message, variant: "destructive" }),
  });
  const toggleStatus = useMutation({
    mutationFn: (p: AccountingPeriod) => apiRequest("PATCH", `/api/finance/periods/${p.id}`, { status: p.status === "open" ? "closed" : "open" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/periods"] }); toast({ title: "Period status updated" }); },
    onError: (err: Error) => toast({ title: "Couldn't update period status", description: err.message, variant: "destructive" }),
  });
  const sorted = [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{periods.length} period{periods.length === 1 ? "" : "s"} — postings are blocked once a period is closed.</div>
        <PeriodFormDialog trigger={<Button size="sm" data-testid="button-new-period"><Plus className="h-4 w-4 mr-1" /> New period</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading accounting periods…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No accounting periods yet. Create one to enable journal posting and period-close controls.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead><TableHead>Financial year</TableHead><TableHead>Date range</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.id} data-testid={`row-period-${p.id}`}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.financialYear}</TableCell>
                  <TableCell>{formatDate(p.startDate)} – {formatDate(p.endDate)}</TableCell>
                  <TableCell><Badge variant={p.status === "open" ? "secondary" : "outline"}>{p.status === "open" ? "Open" : "Closed"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title={p.status === "open" ? "Close period" : "Reopen period"} onClick={() => toggleStatus.mutate(p)} data-testid={`button-toggle-period-${p.id}`}>
                        {p.status === "open" ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </Button>
                      <PeriodFormDialog period={p} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-period-${p.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-period-${p.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {p.name}?</AlertDialogTitle><AlertDialogDescription>This removes the accounting period.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deletePeriod.mutate(p.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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

// ================= Journal Entries =================
type JournalLineForm = { accountId: string; debit: string; credit: string; description: string };

function NewJournalEntryDialog({ accounts }: { accounts: ChartOfAccount[] }) {
  const [open, setOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<JournalLineForm[]>([
    { accountId: "", debit: "", credit: "", description: "" },
    { accountId: "", debit: "", credit: "", description: "" },
  ]);
  const { toast } = useToast();

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/finance/journal-entries", {
        entryDate, description,
        lines: lines.filter((l) => l.accountId).map((l) => ({
          accountId: Number(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || undefined,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/journal-entries"] });
      toast({ title: "Journal entry posted" });
      setOpen(false);
      setEntryDate(todayISO()); setDescription("");
      setLines([{ accountId: "", debit: "", credit: "", description: "" }, { accountId: "", debit: "", credit: "", description: "" }]);
    },
    onError: (err: Error) => toast({ title: "Couldn't post journal entry", description: err.message, variant: "destructive" }),
  });

  const updateLine = (idx: number, patch: Partial<JournalLineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-journal-entry"><Plus className="h-4 w-4 mr-1" /> New journal entry</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
        <DialogHeader><DialogTitle>New journal entry</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Entry date</label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} data-testid="input-je-date" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-je-description" />
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_2fr_auto] gap-2 items-start">
                <Select value={line.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                  <SelectTrigger data-testid={`select-je-account-${idx}`}><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.active).sort((a, b) => a.code.localeCompare(b.code)).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Debit" value={line.debit} onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} data-testid={`input-je-debit-${idx}`} />
                <Input type="number" placeholder="Credit" value={line.credit} onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} data-testid={`input-je-credit-${idx}`} />
                <Input placeholder="Line description (optional)" value={line.description} onChange={(e) => updateLine(idx, { description: e.target.value })} data-testid={`input-je-line-desc-${idx}`} />
                <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} disabled={lines.length <= 2} data-testid={`button-remove-je-line-${idx}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { accountId: "", debit: "", credit: "", description: "" }])} data-testid="button-add-je-line">
              <Plus className="h-4 w-4 mr-1" /> Add line
            </Button>
          </div>
          <div className="flex items-center justify-between text-sm border-t border-border pt-3">
            <span>Total debit: <strong className="tabular-nums">{formatKES(totalDebit)}</strong></span>
            <span>Total credit: <strong className="tabular-nums">{formatKES(totalCredit)}</strong></span>
            <Badge variant={balanced ? "secondary" : "destructive"}>{balanced ? "Balanced" : "Not balanced"}</Badge>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!balanced || !description || mutation.isPending} data-testid="button-post-journal-entry">
            {mutation.isPending ? "Posting..." : "Post entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelEntryDialog({ onConfirm, label }: { onConfirm: (reason: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" title="Cancel"><Ban className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason for cancellation</label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-cancel-reason" />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={!reason} onClick={() => { onConfirm(reason); setOpen(false); setReason(""); }} data-testid="button-confirm-cancel">
            Confirm cancellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JournalEntriesTab() {
  const { toast } = useToast();
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/finance/accounts"] });
  const { data: entries = [], isLoading } = useQuery<JournalEntry[]>({ queryKey: ["/api/finance/journal-entries"] });
  const cancelEntry = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/finance/journal-entries/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/journal-entries"] }); toast({ title: "Journal entry cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel entry", description: err.message, variant: "destructive" }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</div>
        <NewJournalEntryDialog accounts={accounts} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading journal entries…</div>
      ) : entries.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No journal entries yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id} data-testid={`row-journal-entry-${e.id}`}>
                  <TableCell className="font-mono">{e.entryNumber}</TableCell>
                  <TableCell>{formatDate(e.entryDate)}</TableCell>
                  <TableCell>{e.description}</TableCell>
                  <TableCell className="capitalize">{e.sourceModule.replace(/-/g, " ")}</TableCell>
                  <TableCell><Badge variant={e.status === "cancelled" ? "outline" : "secondary"}>{e.status === "cancelled" ? "Cancelled" : "Posted"}</Badge></TableCell>
                  <TableCell className="text-right">
                    {e.status === "posted" && (
                      <CancelEntryDialog label={`Cancel ${e.entryNumber}?`} onConfirm={(reason) => cancelEntry.mutate({ id: e.id, reason })} />
                    )}
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

// ================= Bank Accounts =================
const bankAccountFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  bankName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  glAccountId: z.coerce.number().min(1, "Linked GL account is required"),
  openingBalance: z.coerce.number().default(0),
  active: z.coerce.number().default(1),
  notes: z.string().optional().nullable(),
});

function BankAccountFormDialog({ account, accounts, trigger }: { account?: BankAccount; accounts: ChartOfAccount[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.input<typeof bankAccountFormSchema>, any, z.output<typeof bankAccountFormSchema>>({
    resolver: zodResolver(bankAccountFormSchema),
    defaultValues: account
      ? { name: account.name, bankName: account.bankName ?? "", accountNumber: account.accountNumber ?? "", glAccountId: account.glAccountId, openingBalance: account.openingBalance, active: account.active, notes: account.notes ?? "" }
      : { name: "", bankName: "", accountNumber: "", glAccountId: accounts[0]?.id ?? 0, openingBalance: 0, active: 1, notes: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof bankAccountFormSchema>) => {
      if (account) return apiRequest("PATCH", `/api/finance/bank-accounts/${account.id}`, values);
      return apiRequest("POST", "/api/finance/bank-accounts", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/bank-accounts"] });
      toast({ title: account ? "Bank account updated" : "Bank account created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{account ? "Edit bank account" : "New bank account"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Account name</FormLabel><FormControl><Input {...field} data-testid="input-bank-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="bankName" render={({ field }) => (
                <FormItem><FormLabel>Bank (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-bank-bank-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="accountNumber" render={({ field }) => (
                <FormItem><FormLabel>Account number (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-bank-account-number" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="glAccountId" render={({ field }) => (
              <FormItem>
                <FormLabel>Linked GL account</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-bank-gl-account"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {accounts.filter((a) => a.type === "asset").sort((a, b) => a.code.localeCompare(b.code)).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="openingBalance" render={({ field }) => (
              <FormItem><FormLabel>Opening balance (KES)</FormLabel><FormControl><Input type="number" {...field} value={field.value as any} data-testid="input-bank-opening-balance" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-bank-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-bank-account">{mutation.isPending ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function BankAccountsTab() {
  const { toast } = useToast();
  const { data: bankAccounts = [], isLoading } = useQuery<BankAccount[]>({ queryKey: ["/api/finance/bank-accounts"] });
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/finance/accounts"] });
  const deleteBankAccount = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/finance/bank-accounts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/bank-accounts"] }); toast({ title: "Bank account deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete bank account", description: err.message, variant: "destructive" }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{bankAccounts.length} bank account{bankAccounts.length === 1 ? "" : "s"}</div>
        <BankAccountFormDialog accounts={accounts} trigger={<Button size="sm" data-testid="button-new-bank-account"><Plus className="h-4 w-4 mr-1" /> Add bank account</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading bank accounts…</div>
      ) : bankAccounts.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No bank accounts yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Bank</TableHead><TableHead>Account #</TableHead>
                <TableHead className="text-right">Opening balance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankAccounts.map((b) => (
                <TableRow key={b.id} data-testid={`row-bank-account-${b.id}`}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.bankName || "—"}</TableCell>
                  <TableCell>{b.accountNumber || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(b.openingBalance)}</TableCell>
                  <TableCell><Badge variant={b.active ? "secondary" : "outline"}>{b.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <BankAccountFormDialog account={b} accounts={accounts} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-bank-account-${b.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-bank-account-${b.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {b.name}?</AlertDialogTitle><AlertDialogDescription>This removes the bank account record.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteBankAccount.mutate(b.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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

// ================= Payment Vouchers =================
const voucherFormSchema = z.object({
  voucherDate: z.string().min(1),
  payeeName: z.string().min(1, "Payee is required"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  paymentMethod: z.string().min(1),
  paymentReference: z.string().optional().nullable(),
  expenseAccountId: z.coerce.number().min(1, "Expense account is required"),
  bankAccountId: z.coerce.number().min(1, "Bank/cash account is required"),
  description: z.string().min(1, "Description is required"),
});

const PAYMENT_METHODS = ["cash", "mpesa", "card", "bank_transfer", "cheque"];

function VoucherFormDialog({ accounts, bankAccounts, trigger }: { accounts: ChartOfAccount[]; bankAccounts: BankAccount[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.input<typeof voucherFormSchema>, any, z.output<typeof voucherFormSchema>>({
    resolver: zodResolver(voucherFormSchema),
    defaultValues: { voucherDate: todayISO(), payeeName: "", amount: 0, paymentMethod: "cash", paymentReference: "", expenseAccountId: 0, bankAccountId: bankAccounts[0]?.id ?? 0, description: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof voucherFormSchema>) => apiRequest("POST", "/api/finance/payment-vouchers", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/payment-vouchers"] });
      toast({ title: "Payment voucher created as draft" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New payment voucher</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="voucherDate" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-pv-date" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="payeeName" render={({ field }) => (
                <FormItem><FormLabel>Payee</FormLabel><FormControl><Input {...field} data-testid="input-pv-payee" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount (KES)</FormLabel><FormControl><Input type="number" {...field} value={field.value as any} data-testid="input-pv-amount" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-pv-method"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="paymentReference" render={({ field }) => (
              <FormItem><FormLabel>Payment reference (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-pv-reference" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="expenseAccountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Expense / payable account (debit)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <FormControl><SelectTrigger data-testid="select-pv-expense-account"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {accounts.filter((a) => a.type === "expense" || a.type === "liability").sort((a, b) => a.code.localeCompare(b.code)).map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="bankAccountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Pay from (credit)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <FormControl><SelectTrigger data-testid="select-pv-bank-account"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {bankAccounts.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} data-testid="input-pv-description" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-voucher">{mutation.isPending ? "Saving..." : "Create draft voucher"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const voucherStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", pending_approval: "default", approved: "default", posted: "secondary", cancelled: "destructive",
};

function PaymentVouchersTab() {
  const { toast } = useToast();
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/finance/accounts"] });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/finance/bank-accounts"] });
  const { data: vouchers = [], isLoading } = useQuery<PaymentVoucher[]>({ queryKey: ["/api/finance/payment-vouchers"] });
  const postVoucher = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/finance/payment-vouchers/${id}/post`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/payment-vouchers"] }); toast({ title: "Payment voucher posted" }); },
    onError: (err: Error) => toast({ title: "Couldn't post voucher", description: err.message, variant: "destructive" }),
  });
  const cancelVoucher = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/finance/payment-vouchers/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finance/payment-vouchers"] }); toast({ title: "Payment voucher cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel voucher", description: err.message, variant: "destructive" }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{vouchers.length} voucher{vouchers.length === 1 ? "" : "s"}</div>
        <VoucherFormDialog accounts={accounts} bankAccounts={bankAccounts} trigger={<Button size="sm" data-testid="button-new-voucher"><Plus className="h-4 w-4 mr-1" /> New payment voucher</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading payment vouchers…</div>
      ) : vouchers.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No payment vouchers yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voucher #</TableHead><TableHead>Date</TableHead><TableHead>Payee</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((v) => (
                <TableRow key={v.id} data-testid={`row-voucher-${v.id}`}>
                  <TableCell className="font-mono">{v.voucherNumber}</TableCell>
                  <TableCell>{formatDate(v.voucherDate)}</TableCell>
                  <TableCell>{v.payeeName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(v.amount)}</TableCell>
                  <TableCell className="capitalize">{v.paymentMethod.replace(/_/g, " ")}</TableCell>
                  <TableCell><Badge variant={voucherStatusVariant[v.status]}>{v.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {v.status !== "posted" && v.status !== "cancelled" && (
                        <Button size="icon" variant="ghost" title="Post" onClick={() => postVoucher.mutate(v.id)} data-testid={`button-post-voucher-${v.id}`}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      {v.status !== "posted" && v.status !== "cancelled" && (
                        <CancelEntryDialog label={`Cancel ${v.voucherNumber}?`} onConfirm={(reason) => cancelVoucher.mutate({ id: v.id, reason })} />
                      )}
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

// ================= Reports =================
function ReportsTab() {
  const [asOf, setAsOf] = useState(todayISO());
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(todayISO());
  const { data: trialBalance = [] } = useQuery<any[]>({ queryKey: ["/api/finance/reports/trial-balance", asOf], queryFn: () => fetch(`/api/finance/reports/trial-balance?asOf=${asOf}`, { credentials: "include" }).then((r) => r.json()) });
  const { data: pnl } = useQuery<any>({ queryKey: ["/api/finance/reports/profit-loss", from, to], queryFn: () => fetch(`/api/finance/reports/profit-loss?from=${from}&to=${to}`, { credentials: "include" }).then((r) => r.json()) });
  const { data: bs } = useQuery<any>({ queryKey: ["/api/finance/reports/balance-sheet", asOf], queryFn: () => fetch(`/api/finance/reports/balance-sheet?asOf=${asOf}`, { credentials: "include" }).then((r) => r.json()) });

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Trial Balance</h3>
          <Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="input-tb-as-of" />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
            <TableBody>
              {trialBalance.map((r: any) => (
                <TableRow key={r.accountId}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.balance > 0 ? formatKES(r.balance) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.balance < 0 ? formatKES(-r.balance) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Profit &amp; Loss</h3>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-pnl-from" />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-pnl-to" />
        </div>
        {pnl && (
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-medium mb-2">Income</div>
              {pnl.income.map((l: any) => (
                <div key={l.accountId} className="flex justify-between text-sm py-1"><span>{l.name}</span><span className="tabular-nums">{formatKES(l.amount)}</span></div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1"><span>Total income</span><span className="tabular-nums">{formatKES(pnl.totalIncome)}</span></div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Expenses</div>
              {pnl.expense.map((l: any) => (
                <div key={l.accountId} className="flex justify-between text-sm py-1"><span>{l.name}</span><span className="tabular-nums">{formatKES(l.amount)}</span></div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1"><span>Total expenses</span><span className="tabular-nums">{formatKES(pnl.totalExpense)}</span></div>
            </div>
            <div className="col-span-2 flex justify-between text-base font-bold border-t border-border pt-2"><span>Net profit</span><span className="tabular-nums">{formatKES(pnl.netProfit)}</span></div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Balance Sheet</h3>
          <Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="input-bs-as-of" />
        </div>
        {bs && (
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-medium mb-2">Assets</div>
              {bs.assets.map((l: any) => (
                <div key={l.accountId} className="flex justify-between text-sm py-1"><span>{l.name}</span><span className="tabular-nums">{formatKES(l.balance)}</span></div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1"><span>Total assets</span><span className="tabular-nums">{formatKES(bs.totalAssets)}</span></div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Liabilities</div>
                {bs.liabilities.map((l: any) => (
                  <div key={l.accountId} className="flex justify-between text-sm py-1"><span>{l.name}</span><span className="tabular-nums">{formatKES(l.balance)}</span></div>
                ))}
                <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1"><span>Total liabilities</span><span className="tabular-nums">{formatKES(bs.totalLiabilities)}</span></div>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Equity</div>
                {bs.equity.map((l: any) => (
                  <div key={l.accountId} className="flex justify-between text-sm py-1"><span>{l.name}</span><span className="tabular-nums">{formatKES(l.balance)}</span></div>
                ))}
                <div className="flex justify-between text-sm py-1"><span>Retained earnings (net income to date)</span><span className="tabular-nums">{formatKES(bs.retainedEarnings)}</span></div>
                <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1"><span>Total equity</span><span className="tabular-nums">{formatKES(bs.totalEquity)}</span></div>
              </div>
            </div>
            <div className="col-span-2 flex justify-between text-base font-bold border-t border-border pt-2"><span>Total liabilities &amp; equity</span><span className="tabular-nums">{formatKES(bs.totalLiabilitiesAndEquity)}</span></div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ================= Page =================
export default function Finance() {
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/finance/accounts"] });
  const { data: vouchers = [] } = useQuery<PaymentVoucher[]>({ queryKey: ["/api/finance/payment-vouchers"] });
  const { data: pnl } = useQuery<any>({ queryKey: ["/api/finance/reports/profit-loss", "stat"], queryFn: () => fetch(`/api/finance/reports/profit-loss`, { credentials: "include" }).then((r) => r.json()) });

  const draftVouchers = vouchers.filter((v) => v.status === "draft" || v.status === "pending_approval").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Finance" description="Chart of accounts, general ledger, payment vouchers, banking, and financial reports." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Chart of accounts" value={String(accounts.length)} icon={BookOpen} testId="stat-accounts-count" />
        <StatCard label="Pending vouchers" value={String(draftVouchers)} icon={Receipt} accent="warning" testId="stat-pending-vouchers" />
        <StatCard label="Net profit (all-time)" value={pnl ? formatKES(pnl.netProfit) : "—"} icon={Wallet} accent="success" testId="stat-net-profit" />
      </div>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts" data-testid="tab-accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="periods" data-testid="tab-periods">Accounting Periods</TabsTrigger>
          <TabsTrigger value="journal" data-testid="tab-journal">Journal Entries</TabsTrigger>
          <TabsTrigger value="vouchers" data-testid="tab-vouchers">Payment Vouchers</TabsTrigger>
          <TabsTrigger value="banking" data-testid="tab-banking">Bank Accounts</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4"><ChartOfAccountsTab /></TabsContent>
        <TabsContent value="periods" className="mt-4"><PeriodsTab /></TabsContent>
        <TabsContent value="journal" className="mt-4"><JournalEntriesTab /></TabsContent>
        <TabsContent value="vouchers" className="mt-4"><PaymentVouchersTab /></TabsContent>
        <TabsContent value="banking" className="mt-4"><BankAccountsTab /></TabsContent>
        <TabsContent value="reports" className="mt-4"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
