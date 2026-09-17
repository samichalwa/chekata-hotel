import { Fragment, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, ClipboardCheck, Send, CheckCircle2, Ban, PackageMinus, Undo2, Lock } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import type {
  Store, InventoryItem, ChartOfAccount,
  InternalRequisition, InternalRequisitionLine,
} from "@shared/schema";

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {
    // not JSON, fall through
  }
  return body;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const irStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", pending_review: "outline", pending_approval: "default", approved: "default", rejected: "destructive", cancelled: "destructive", issued: "secondary",
};

// ================= Reason dialog (reject/cancel) =================
function ReasonDialog({ trigger, title, label, onConfirm, confirmLabel = "Confirm" }: { trigger: React.ReactNode; title: string; label: string; onConfirm: (reason: string) => void; confirmLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">{label}</label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-ir-reason" />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={!reason} onClick={() => { onConfirm(reason); setOpen(false); setReason(""); }} data-testid="button-confirm-ir-reason">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= New Internal Requisition =================
type IrLineForm = { itemId: string; quantityRequested: string; notes: string };

function NewIrDialog({ items, stores, accounts }: { items: InventoryItem[]; stores: Store[]; accounts: ChartOfAccount[] }) {
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState("");
  const [storeId, setStoreId] = useState("");
  const [type, setType] = useState<"permanent" | "loan">("permanent");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<IrLineForm[]>([{ itemId: "", quantityRequested: "", notes: "" }]);
  const { toast } = useToast();

  const updateLine = (idx: number, patch: Partial<IrLineForm>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/internal-requisitions", {
      department: department || undefined,
      storeId: Number(storeId),
      type,
      expenseAccountId: type === "permanent" ? Number(expenseAccountId) : undefined,
      purpose,
      lines: lines.filter((l) => l.itemId).map((l) => ({
        itemId: Number(l.itemId),
        quantityRequested: Number(l.quantityRequested) || 0,
        notes: l.notes || undefined,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] });
      toast({ title: "Internal requisition created as draft" });
      setOpen(false);
      setDepartment(""); setStoreId(""); setType("permanent"); setExpenseAccountId(""); setPurpose("");
      setLines([{ itemId: "", quantityRequested: "", notes: "" }]);
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const canSubmit = storeId && purpose && (type !== "permanent" || expenseAccountId) && lines.some((l) => l.itemId && Number(l.quantityRequested) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-ir"><Plus className="h-4 w-4 mr-1" /> New requisition</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
        <DialogHeader><DialogTitle>New internal requisition</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={type} onValueChange={(v) => setType(v as "permanent" | "loan")}>
                <SelectTrigger data-testid="select-ir-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="permanent">Permanent (consumes stock)</SelectItem>
                  <SelectItem value="loan">Loan (returnable)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Issuing store</label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger data-testid="select-ir-store"><SelectValue placeholder="Select store" /></SelectTrigger>
                <SelectContent>{stores.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Department (optional)</label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="input-ir-department" />
            </div>
            <div>
              <label className="text-sm font-medium">Purpose</label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} data-testid="input-ir-purpose" />
            </div>
          </div>
          {type === "permanent" && (
            <div>
              <label className="text-sm font-medium">Expense account</label>
              <Select value={expenseAccountId} onValueChange={setExpenseAccountId}>
                <SelectTrigger data-testid="select-ir-expense-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => a.type === "expense").map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[2fr_1fr_2fr_auto] gap-2 items-start">
                <Select value={line.itemId} onValueChange={(v) => updateLine(idx, { itemId: v })}>
                  <SelectTrigger data-testid={`select-ir-line-item-${idx}`}><SelectValue placeholder="Item" /></SelectTrigger>
                  <SelectContent>{items.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.code} — {i.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="Qty" value={line.quantityRequested} onChange={(e) => updateLine(idx, { quantityRequested: e.target.value })} data-testid={`input-ir-line-qty-${idx}`} />
                <Input placeholder="Notes (optional)" value={line.notes} onChange={(e) => updateLine(idx, { notes: e.target.value })} data-testid={`input-ir-line-notes-${idx}`} />
                <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} disabled={lines.length <= 1} data-testid={`button-remove-ir-line-${idx}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { itemId: "", quantityRequested: "", notes: "" }])} data-testid="button-add-ir-line">
              <Plus className="h-4 w-4 mr-1" /> Add line
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} data-testid="button-save-ir">
            {mutation.isPending ? "Saving..." : "Create draft requisition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= Loan return dialog =================
function LoanReturnDialog({ line, trigger }: { line: InternalRequisitionLine; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [quantityReturned, setQuantityReturned] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const outstanding = line.quantityIssued - line.quantityReturned;
  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/internal-requisition-lines/${line.id}/return`, {
      quantityReturned: Number(quantityReturned),
      condition: condition || undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/internal-requisitions/${line.requisitionId}/lines`] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-ledger"] });
      toast({ title: "Loan return recorded" });
      setOpen(false); setQuantityReturned(""); setCondition(""); setNotes("");
    },
    onError: (err: Error) => toast({ title: "Couldn't record return", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record loan return</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Outstanding on loan: <strong className="tabular-nums">{outstanding}</strong></p>
          <div>
            <label className="text-sm font-medium">Quantity returned</label>
            <Input type="number" max={outstanding} value={quantityReturned} onChange={(e) => setQuantityReturned(e.target.value)} data-testid="input-return-qty" />
          </div>
          <div>
            <label className="text-sm font-medium">Condition (optional)</label>
            <Input placeholder="e.g. Good, Damaged" value={condition} onChange={(e) => setCondition(e.target.value)} data-testid="input-return-condition" />
          </div>
          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-return-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!quantityReturned || Number(quantityReturned) <= 0 || Number(quantityReturned) > outstanding || mutation.isPending}
            data-testid="button-confirm-return"
          >
            {mutation.isPending ? "Recording..." : "Record return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IrLinesPreview({ ir, items }: { ir: InternalRequisition; items: InventoryItem[] }) {
  const { data: lines = [] } = useQuery<InternalRequisitionLine[]>({ queryKey: [`/api/internal-requisitions/${ir.id}/lines`] });
  const itemName = (id: number) => { const it = items.find((i) => i.id === id); return it ? `${it.code} — ${it.name}` : `#${id}`; };
  if (lines.length === 0) return <div className="text-sm text-muted-foreground p-3">No lines.</div>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead><TableHead className="text-right">Requested</TableHead>
            <TableHead className="text-right">Issued</TableHead><TableHead className="text-right">Returned</TableHead>
            {ir.type === "loan" && ir.status === "issued" && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const outstanding = l.quantityIssued - l.quantityReturned;
            return (
              <TableRow key={l.id} data-testid={`row-ir-line-${l.id}`}>
                <TableCell>{itemName(l.itemId)}</TableCell>
                <TableCell className="text-right tabular-nums">{l.quantityRequested}</TableCell>
                <TableCell className="text-right tabular-nums">{l.quantityIssued}</TableCell>
                <TableCell className="text-right tabular-nums">{l.quantityReturned}</TableCell>
                {ir.type === "loan" && ir.status === "issued" && (
                  <TableCell className="text-right">
                    {outstanding > 0 ? (
                      <LoanReturnDialog line={l} trigger={
                        <Button size="sm" variant="outline" data-testid={`button-return-line-${l.id}`}><Undo2 className="h-3.5 w-3.5 mr-1" /> Return</Button>
                      } />
                    ) : (
                      <span className="text-xs text-muted-foreground">Fully returned</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function InternalRequisitionsTab({ canAdjust }: { canAdjust: boolean }) {
  const { toast } = useToast();
  const { data: irs = [], isLoading } = useQuery<InternalRequisition[]>({ queryKey: ["/api/internal-requisitions"] });
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/purchasing/gl-accounts"] });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? `#${id}`;

  const submitIr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/internal-requisitions/${id}/submit`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] }); toast({ title: "Requisition submitted for approval" }); },
    onError: (err: Error) => toast({ title: "Couldn't submit requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const reviewIr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/internal-requisitions/${id}/review`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] }); toast({ title: "Requisition marked as reviewed" }); },
    onError: (err: Error) => toast({ title: "Couldn't review requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const approveIr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/internal-requisitions/${id}/approve`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] }); toast({ title: "Requisition approved" }); },
    onError: (err: Error) => toast({ title: "Couldn't approve requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const rejectIr = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/internal-requisitions/${id}/reject`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] }); toast({ title: "Requisition rejected" }); },
    onError: (err: Error) => toast({ title: "Couldn't reject requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const issueIr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/internal-requisitions/${id}/issue`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-ledger"] });
      toast({ title: "Stock issued" });
    },
    onError: (err: Error) => toast({ title: "Couldn't issue stock", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const cancelIr = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/internal-requisitions/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/internal-requisitions"] }); toast({ title: "Requisition cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const sorted = [...irs].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{irs.length} requisition{irs.length === 1 ? "" : "s"}</div>
        <NewIrDialog items={items} stores={stores} accounts={accounts} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading internal requisitions…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No internal requisitions yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IR #</TableHead><TableHead>Type</TableHead><TableHead>Store</TableHead>
                <TableHead>Purpose</TableHead><TableHead>Requested by</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((ir) => (
                <Fragment key={ir.id}>
                  <TableRow data-testid={`row-ir-${ir.id}`}>
                    <TableCell className="font-mono">
                      <button className="underline-offset-2 hover:underline" onClick={() => setExpandedId(expandedId === ir.id ? null : ir.id)} data-testid={`button-expand-ir-${ir.id}`}>
                        {ir.irNumber}
                      </button>
                    </TableCell>
                    <TableCell className="capitalize">{ir.type}</TableCell>
                    <TableCell>{storeName(ir.storeId)}</TableCell>
                    <TableCell>{ir.purpose}</TableCell>
                    <TableCell>{ir.requestedBy}</TableCell>
                    <TableCell><Badge variant={irStatusVariant[ir.status]}>{titleCase(ir.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-1">
                        {ir.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => submitIr.mutate(ir.id)} disabled={submitIr.isPending} data-testid={`button-submit-ir-${ir.id}`}>
                            <Send className="h-3.5 w-3.5 mr-1" /> Submit
                          </Button>
                        )}
                        {ir.status === "pending_review" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => reviewIr.mutate(ir.id)} disabled={reviewIr.isPending} data-testid={`button-review-ir-${ir.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark reviewed
                            </Button>
                            <ReasonDialog
                              title={`Reject ${ir.irNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject requisition"
                              onConfirm={(reason) => rejectIr.mutate({ id: ir.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-ir-${ir.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {ir.status === "pending_approval" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approveIr.mutate(ir.id)} disabled={approveIr.isPending} data-testid={`button-approve-ir-${ir.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <ReasonDialog
                              title={`Reject ${ir.irNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject requisition"
                              onConfirm={(reason) => rejectIr.mutate({ id: ir.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-ir-${ir.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {ir.status === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => issueIr.mutate(ir.id)} disabled={issueIr.isPending} data-testid={`button-issue-ir-${ir.id}`}>
                            <PackageMinus className="h-3.5 w-3.5 mr-1" /> Issue stock
                          </Button>
                        )}
                        {(ir.status === "draft" || ir.status === "pending_review" || ir.status === "pending_approval" || ir.status === "approved") && (
                          canAdjust ? (
                            <ReasonDialog
                              title={`Cancel ${ir.irNumber}?`}
                              label="Reason for cancellation"
                              confirmLabel="Confirm cancellation"
                              onConfirm={(reason) => cancelIr.mutate({ id: ir.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Cancel" data-testid={`button-cancel-ir-${ir.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          ) : (
                            <Button size="icon" variant="ghost" disabled title="Requires the 'adjust inventory' right" data-testid={`button-cancel-ir-${ir.id}`}><Lock className="h-4 w-4" /></Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === ir.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/30">
                        <IrLinesPreview ir={ir} items={items} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ================= Page =================
export default function InternalRequisitions() {
  const { data: currentUser } = useCurrentUser();
  const canAdjust = Boolean(currentUser?.isAdmin || currentUser?.canAdjustInventory);
  const { data: irs = [] } = useQuery<InternalRequisition[]>({ queryKey: ["/api/internal-requisitions"] });

  const pendingCount = irs.filter((i) => i.status === "pending_approval").length;
  const issuedCount = irs.filter((i) => i.status === "issued").length;
  const loanCount = irs.filter((i) => i.type === "loan" && i.status === "issued").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Internal Requisitions" description="Request, approve, and issue stock for internal use — permanent consumption or returnable loans." />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Total requisitions" value={String(irs.length)} icon={ClipboardCheck} testId="stat-ir-total" />
        <StatCard label="Pending approval" value={String(pendingCount)} icon={Send} accent="warning" testId="stat-ir-pending" />
        <StatCard label="Issued" value={String(issuedCount)} icon={PackageMinus} accent="success" testId="stat-ir-issued" />
        <StatCard label="Loans outstanding" value={String(loanCount)} icon={Undo2} accent="muted" testId="stat-ir-loans" />
      </div>

      <Tabs defaultValue="requisitions">
        <TabsList>
          <TabsTrigger value="requisitions" data-testid="tab-internal-requisitions">Requisitions</TabsTrigger>
        </TabsList>
        <TabsContent value="requisitions" className="mt-4"><InternalRequisitionsTab canAdjust={canAdjust} /></TabsContent>
      </Tabs>
    </div>
  );
}
