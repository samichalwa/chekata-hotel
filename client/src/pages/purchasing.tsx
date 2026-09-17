import { Fragment, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, ShoppingCart, Truck, FileText, PackageCheck, Ban, CheckCircle2, Send, Lock } from "lucide-react";
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
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES } from "@/lib/format";
import type {
  Supplier, InventoryItem, Store, ChartOfAccount,
  PurchaseRequisition, PurchaseRequisitionLine,
  PurchaseOrder, PurchaseOrderLine,
  GoodsReceipt, GoodsReceiptLine,
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

const prStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", pending_review: "outline", pending_approval: "default", approved: "secondary", rejected: "destructive", cancelled: "destructive",
};
const poStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", pending_review: "outline", pending_approval: "default", approved: "secondary", rejected: "destructive", partially_received: "default", received: "secondary", cancelled: "destructive",
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ================= Suppliers =================
const supplierFormSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  active: z.number(),
  notes: z.string().optional().nullable(),
});

function SupplierFormDialog({ supplier, trigger }: { supplier?: Supplier; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof supplierFormSchema>>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: supplier
      ? { name: supplier.name, contactPerson: supplier.contactPerson ?? "", phone: supplier.phone ?? "", email: supplier.email ?? "", paymentTerms: supplier.paymentTerms ?? "", active: supplier.active, notes: supplier.notes ?? "" }
      : { name: "", contactPerson: "", phone: "", email: "", paymentTerms: "", active: 1, notes: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof supplierFormSchema>) => {
      if (supplier) return apiRequest("PATCH", `/api/purchasing/suppliers/${supplier.id}`, values);
      return apiRequest("POST", "/api/purchasing/suppliers", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/suppliers"] });
      toast({ title: supplier ? "Supplier updated" : "Supplier created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Supplier name</FormLabel><FormControl><Input {...field} data-testid="input-supplier-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="contactPerson" render={({ field }) => (
                <FormItem><FormLabel>Contact person (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-supplier-contact" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-supplier-phone" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-supplier-email" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="paymentTerms" render={({ field }) => (
                <FormItem><FormLabel>Payment terms (optional)</FormLabel><FormControl><Input placeholder="e.g. Net 30" {...field} value={field.value ?? ""} data-testid="input-supplier-terms" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-supplier-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-supplier-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-supplier">{mutation.isPending ? "Saving..." : "Save supplier"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function SuppliersTab({ canAdjust }: { canAdjust: boolean }) {
  const { toast } = useToast();
  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({ queryKey: ["/api/purchasing/suppliers"] });
  const deleteSupplier = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/purchasing/suppliers/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/suppliers"] }); toast({ title: "Supplier deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete supplier", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{suppliers.length} supplier{suppliers.length === 1 ? "" : "s"}</div>
        <SupplierFormDialog trigger={<Button size="sm" data-testid="button-new-supplier"><Plus className="h-4 w-4 mr-1" /> Add supplier</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading suppliers…</div>
      ) : suppliers.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No suppliers yet. Add the first one.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead>
                <TableHead>Terms</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.contactPerson || "—"}</TableCell>
                  <TableCell>{s.phone || "—"}</TableCell>
                  <TableCell>{s.paymentTerms || "—"}</TableCell>
                  <TableCell><Badge variant={s.active ? "secondary" : "outline"}>{s.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <SupplierFormDialog supplier={s} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-supplier-${s.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      {canAdjust ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-supplier-${s.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Delete {s.name}?</AlertDialogTitle><AlertDialogDescription>This removes the supplier record.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteSupplier.mutate(s.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Button size="icon" variant="ghost" disabled title="Requires the 'adjust inventory' right" data-testid={`button-delete-supplier-${s.id}`}><Lock className="h-4 w-4" /></Button>
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

// ================= Reason dialog (reject/cancel) =================
function ReasonDialog({ trigger, title, label, onConfirm, confirmLabel = "Confirm", variant = "destructive" }: { trigger: React.ReactNode; title: string; label: string; onConfirm: (reason: string) => void; confirmLabel?: string; variant?: "destructive" | "default" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">{label}</label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-reason" />
        </div>
        <DialogFooter>
          <Button variant={variant} disabled={!reason} onClick={() => { onConfirm(reason); setOpen(false); setReason(""); }} data-testid="button-confirm-reason">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= Purchase Requisitions =================
type PrLineForm = { itemId: string; description: string; quantity: string; unitOfMeasure: string; estimatedUnitCost: string; notes: string };

function NewPrDialog({ items }: { items: InventoryItem[] }) {
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState("");
  const [purpose, setPurpose] = useState("");
  const [type, setType] = useState<"stock" | "direct">("stock");
  const [lines, setLines] = useState<PrLineForm[]>([{ itemId: "", description: "", quantity: "", unitOfMeasure: "", estimatedUnitCost: "", notes: "" }]);
  const { toast } = useToast();

  const updateLine = (idx: number, patch: Partial<PrLineForm>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/purchasing/requisitions", {
      department: department || undefined,
      purpose,
      type,
      lines: lines.filter((l) => l.description).map((l) => ({
        itemId: l.itemId && l.itemId !== "none" ? Number(l.itemId) : undefined,
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unitOfMeasure: l.unitOfMeasure || undefined,
        estimatedUnitCost: Number(l.estimatedUnitCost) || 0,
        notes: l.notes || undefined,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/requisitions"] });
      toast({ title: "Purchase requisition created as draft" });
      setOpen(false);
      setDepartment(""); setPurpose(""); setType("stock");
      setLines([{ itemId: "", description: "", quantity: "", unitOfMeasure: "", estimatedUnitCost: "", notes: "" }]);
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-pr"><Plus className="h-4 w-4 mr-1" /> New requisition</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
        <DialogHeader><DialogTitle>New purchase requisition</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={type} onValueChange={(v) => setType(v as "stock" | "direct")}>
                <SelectTrigger data-testid="select-pr-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock (replenish store)</SelectItem>
                  <SelectItem value="direct">Direct expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Department (optional)</label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="input-pr-department" />
            </div>
            <div>
              <label className="text-sm font-medium">Purpose</label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} data-testid="input-pr-purpose" />
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-2 items-start">
                <Select value={line.itemId} onValueChange={(v) => updateLine(idx, { itemId: v })}>
                  <SelectTrigger data-testid={`select-pr-line-item-${idx}`}><SelectValue placeholder="Catalogue item (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (custom description)</SelectItem>
                    {items.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.code} — {i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, { description: e.target.value })} data-testid={`input-pr-line-desc-${idx}`} />
                <Input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} data-testid={`input-pr-line-qty-${idx}`} />
                <Input placeholder="Unit" value={line.unitOfMeasure} onChange={(e) => updateLine(idx, { unitOfMeasure: e.target.value })} data-testid={`input-pr-line-unit-${idx}`} />
                <Input type="number" placeholder="Est. unit cost" value={line.estimatedUnitCost} onChange={(e) => updateLine(idx, { estimatedUnitCost: e.target.value })} data-testid={`input-pr-line-cost-${idx}`} />
                <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} disabled={lines.length <= 1} data-testid={`button-remove-pr-line-${idx}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { itemId: "", description: "", quantity: "", unitOfMeasure: "", estimatedUnitCost: "", notes: "" }])} data-testid="button-add-pr-line">
              <Plus className="h-4 w-4 mr-1" /> Add line
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!purpose || lines.every((l) => !l.description) || mutation.isPending} data-testid="button-save-pr">
            {mutation.isPending ? "Saving..." : "Create draft requisition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovePrDialog({ pr, suppliers, accounts, trigger }: { pr: PurchaseRequisition; suppliers: Supplier[]; accounts: ChartOfAccount[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState<string>("");
  const [payableAccountId, setPayableAccountId] = useState<string>("");
  const [expenseAccountId, setExpenseAccountId] = useState<string>("");
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/purchasing/requisitions/${pr.id}/approve`, {
      supplierId: Number(supplierId),
      payableAccountId: Number(payableAccountId),
      expenseAccountId: pr.type === "direct" ? Number(expenseAccountId) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/requisitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] });
      toast({ title: "Requisition approved", description: "A purchase order has been generated." });
      setOpen(false); setSupplierId(""); setPayableAccountId(""); setExpenseAccountId("");
    },
    onError: (err: Error) => toast({ title: "Couldn't approve requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const canSubmit = supplierId && payableAccountId && (pr.type !== "direct" || expenseAccountId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Approve {pr.prNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Supplier</label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger data-testid="select-approve-pr-supplier"><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>{suppliers.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Payable account (liability)</label>
            <Select value={payableAccountId} onValueChange={setPayableAccountId}>
              <SelectTrigger data-testid="select-approve-pr-payable"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.filter((a) => a.type === "liability").map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {pr.type === "direct" && (
            <div>
              <label className="text-sm font-medium">Expense account</label>
              <Select value={expenseAccountId} onValueChange={setExpenseAccountId}>
                <SelectTrigger data-testid="select-approve-pr-expense"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((a) => a.type === "expense").map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} data-testid="button-confirm-approve-pr">
            {mutation.isPending ? "Approving..." : "Approve & generate PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrLinesPreview({ prId }: { prId: number }) {
  const { data: lines = [] } = useQuery<PurchaseRequisitionLine[]>({ queryKey: [`/api/purchasing/requisitions/${prId}/lines`] });
  if (lines.length === 0) return <div className="text-sm text-muted-foreground p-3">No lines.</div>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Est. unit cost</TableHead></TableRow></TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.description}</TableCell>
              <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
              <TableCell>{l.unitOfMeasure || "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKES(l.estimatedUnitCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PurchaseRequisitionsTab({ canAdjust }: { canAdjust: boolean }) {
  const { toast } = useToast();
  const { data: prs = [], isLoading } = useQuery<PurchaseRequisition[]>({ queryKey: ["/api/purchasing/requisitions"] });
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/purchasing/suppliers"] });
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/purchasing/gl-accounts"] });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const submitPr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchasing/requisitions/${id}/submit`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/requisitions"] }); toast({ title: "Requisition submitted for approval" }); },
    onError: (err: Error) => toast({ title: "Couldn't submit requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const reviewPr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchasing/requisitions/${id}/review`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/requisitions"] }); toast({ title: "Requisition marked as reviewed" }); },
    onError: (err: Error) => toast({ title: "Couldn't review requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const rejectPr = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/purchasing/requisitions/${id}/reject`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/requisitions"] }); toast({ title: "Requisition rejected" }); },
    onError: (err: Error) => toast({ title: "Couldn't reject requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const cancelPr = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/purchasing/requisitions/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/requisitions"] }); toast({ title: "Requisition cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const sorted = [...prs].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{prs.length} requisition{prs.length === 1 ? "" : "s"}</div>
        <NewPrDialog items={items} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading purchase requisitions…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No purchase requisitions yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PR #</TableHead><TableHead>Type</TableHead><TableHead>Purpose</TableHead>
                <TableHead>Requested by</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((pr) => (
                <Fragment key={pr.id}>
                  <TableRow key={pr.id} data-testid={`row-pr-${pr.id}`}>
                    <TableCell className="font-mono">
                      <button className="underline-offset-2 hover:underline" onClick={() => setExpandedId(expandedId === pr.id ? null : pr.id)} data-testid={`button-expand-pr-${pr.id}`}>
                        {pr.prNumber}
                      </button>
                    </TableCell>
                    <TableCell className="capitalize">{pr.type}</TableCell>
                    <TableCell>{pr.purpose}</TableCell>
                    <TableCell>{pr.requestedBy}</TableCell>
                    <TableCell><Badge variant={prStatusVariant[pr.status]}>{titleCase(pr.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-1">
                        {pr.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => submitPr.mutate(pr.id)} disabled={submitPr.isPending} data-testid={`button-submit-pr-${pr.id}`}>
                            <Send className="h-3.5 w-3.5 mr-1" /> Submit
                          </Button>
                        )}
                        {pr.status === "pending_review" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => reviewPr.mutate(pr.id)} disabled={reviewPr.isPending} data-testid={`button-review-pr-${pr.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark reviewed
                            </Button>
                            <ReasonDialog
                              title={`Reject ${pr.prNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject requisition"
                              onConfirm={(reason) => rejectPr.mutate({ id: pr.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-pr-${pr.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {pr.status === "pending_approval" && (
                          <>
                            <ApprovePrDialog pr={pr} suppliers={suppliers} accounts={accounts} trigger={
                              <Button size="sm" variant="outline" data-testid={`button-approve-pr-${pr.id}`}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve</Button>
                            } />
                            <ReasonDialog
                              title={`Reject ${pr.prNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject requisition"
                              onConfirm={(reason) => rejectPr.mutate({ id: pr.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-pr-${pr.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {(pr.status === "draft" || pr.status === "pending_review" || pr.status === "pending_approval" || pr.status === "approved") && (
                          canAdjust ? (
                            <ReasonDialog
                              title={`Cancel ${pr.prNumber}?`}
                              label="Reason for cancellation"
                              confirmLabel="Confirm cancellation"
                              onConfirm={(reason) => cancelPr.mutate({ id: pr.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Cancel" data-testid={`button-cancel-pr-${pr.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          ) : (
                            <Button size="icon" variant="ghost" disabled title="Requires the 'adjust inventory' right" data-testid={`button-cancel-pr-${pr.id}`}><Lock className="h-4 w-4" /></Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === pr.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <PrLinesPreview prId={pr.id} />
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

// ================= Purchase Orders =================
type PoLineForm = { itemId: string; description: string; quantity: string; unitOfMeasure: string; unitCost: string };

function NewPoDialog({ items, suppliers, accounts }: { items: InventoryItem[]; suppliers: Supplier[]; accounts: ChartOfAccount[] }) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [type, setType] = useState<"stock" | "direct">("stock");
  const [payableAccountId, setPayableAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PoLineForm[]>([{ itemId: "", description: "", quantity: "", unitOfMeasure: "", unitCost: "" }]);
  const { toast } = useToast();

  const updateLine = (idx: number, patch: Partial<PoLineForm>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/purchasing/orders", {
      supplierId: Number(supplierId),
      type,
      payableAccountId: Number(payableAccountId),
      expenseAccountId: type === "direct" ? Number(expenseAccountId) : undefined,
      notes: notes || undefined,
      lines: lines.filter((l) => l.description).map((l) => ({
        itemId: l.itemId && l.itemId !== "none" ? Number(l.itemId) : undefined,
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unitOfMeasure: l.unitOfMeasure || undefined,
        unitCost: Number(l.unitCost) || 0,
        lineTotal: (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] });
      toast({ title: "Purchase order created as draft" });
      setOpen(false);
      setSupplierId(""); setType("stock"); setPayableAccountId(""); setExpenseAccountId(""); setNotes("");
      setLines([{ itemId: "", description: "", quantity: "", unitOfMeasure: "", unitCost: "" }]);
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const canSubmit = supplierId && payableAccountId && (type !== "direct" || expenseAccountId) && lines.some((l) => l.description);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-new-po"><Plus className="h-4 w-4 mr-1" /> New purchase order</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
        <DialogHeader><DialogTitle>New purchase order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Supplier</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger data-testid="select-po-supplier"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{suppliers.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={type} onValueChange={(v) => setType(v as "stock" | "direct")}>
                <SelectTrigger data-testid="select-po-type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="stock">Stock</SelectItem><SelectItem value="direct">Direct expense</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Payable account (liability)</label>
              <Select value={payableAccountId} onValueChange={setPayableAccountId}>
                <SelectTrigger data-testid="select-po-payable"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => a.type === "liability").map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {type === "direct" && (
              <div>
                <label className="text-sm font-medium">Expense account</label>
                <Select value={expenseAccountId} onValueChange={setExpenseAccountId}>
                  <SelectTrigger data-testid="select-po-expense"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>{accounts.filter((a) => a.type === "expense").map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-2 items-start">
                <Select value={line.itemId} onValueChange={(v) => updateLine(idx, { itemId: v })}>
                  <SelectTrigger data-testid={`select-po-line-item-${idx}`}><SelectValue placeholder="Catalogue item (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (custom description)</SelectItem>
                    {items.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.code} — {i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, { description: e.target.value })} data-testid={`input-po-line-desc-${idx}`} />
                <Input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} data-testid={`input-po-line-qty-${idx}`} />
                <Input placeholder="Unit" value={line.unitOfMeasure} onChange={(e) => updateLine(idx, { unitOfMeasure: e.target.value })} data-testid={`input-po-line-unit-${idx}`} />
                <Input type="number" placeholder="Unit cost" value={line.unitCost} onChange={(e) => updateLine(idx, { unitCost: e.target.value })} data-testid={`input-po-line-cost-${idx}`} />
                <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} disabled={lines.length <= 1} data-testid={`button-remove-po-line-${idx}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { itemId: "", description: "", quantity: "", unitOfMeasure: "", unitCost: "" }])} data-testid="button-add-po-line">
              <Plus className="h-4 w-4 mr-1" /> Add line
            </Button>
          </div>
          <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-po-notes" />
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} data-testid="button-save-po">
            {mutation.isPending ? "Saving..." : "Create draft order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveGoodsDialog({ po, stores, trigger }: { po: PurchaseOrder; stores: Store[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const { data: lines = [] } = useQuery<PurchaseOrderLine[]>({ queryKey: [`/api/purchasing/orders/${po.id}/lines`], enabled: open });
  const [receipts, setReceipts] = useState<Record<number, { quantityReceived: string; unitCost: string }>>({});

  const outstanding = (l: PurchaseOrderLine) => l.quantity - l.quantityReceived;

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/purchasing/orders/${po.id}/receive`, {
      storeId: Number(storeId),
      notes: notes || undefined,
      lines: lines
        .filter((l) => receipts[l.id]?.quantityReceived && Number(receipts[l.id].quantityReceived) > 0)
        .map((l) => ({
          poLineId: l.id,
          quantityReceived: Number(receipts[l.id].quantityReceived),
          unitCost: Number(receipts[l.id].unitCost) || l.unitCost,
        })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchasing/goods-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-ledger"] });
      toast({ title: "Goods received into stock" });
      setOpen(false); setStoreId(""); setNotes(""); setReceipts({});
    },
    onError: (err: Error) => toast({ title: "Couldn't receive goods", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const hasAnyQty = Object.values(receipts).some((r) => Number(r.quantityReceived) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
        <DialogHeader><DialogTitle>Receive goods — {po.poNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Receiving store</label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger data-testid="select-receive-store"><SelectValue placeholder="Select store" /></SelectTrigger>
              <SelectContent>{stores.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Description</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Qty received</TableHead><TableHead className="text-right">Unit cost</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id} data-testid={`row-receive-line-${l.id}`}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{outstanding(l)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        className="w-24 ml-auto"
                        disabled={outstanding(l) <= 0}
                        value={receipts[l.id]?.quantityReceived ?? ""}
                        onChange={(e) => setReceipts((prev) => ({ ...prev, [l.id]: { quantityReceived: e.target.value, unitCost: prev[l.id]?.unitCost ?? String(l.unitCost) } }))}
                        data-testid={`input-receive-qty-${l.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        className="w-28 ml-auto"
                        disabled={outstanding(l) <= 0}
                        value={receipts[l.id]?.unitCost ?? String(l.unitCost)}
                        onChange={(e) => setReceipts((prev) => ({ ...prev, [l.id]: { quantityReceived: prev[l.id]?.quantityReceived ?? "", unitCost: e.target.value } }))}
                        data-testid={`input-receive-cost-${l.id}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-receive-notes" />
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!storeId || !hasAnyQty || mutation.isPending} data-testid="button-confirm-receive">
            {mutation.isPending ? "Receiving..." : "Confirm receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoLinesPreview({ poId }: { poId: number }) {
  const { data: lines = [] } = useQuery<PurchaseOrderLine[]>({ queryKey: [`/api/purchasing/orders/${poId}/lines`] });
  if (lines.length === 0) return <div className="text-sm text-muted-foreground p-3">No lines.</div>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Line total</TableHead></TableRow></TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.description}</TableCell>
              <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
              <TableCell className="text-right tabular-nums">{l.quantityReceived}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKES(l.unitCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKES(l.lineTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PurchaseOrdersTab({ canAdjust }: { canAdjust: boolean }) {
  const { toast } = useToast();
  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({ queryKey: ["/api/purchasing/orders"] });
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/purchasing/suppliers"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/purchasing/gl-accounts"] });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const supplierName = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `#${id}`;

  const submitPo = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchasing/orders/${id}/submit`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] }); toast({ title: "Purchase order submitted for approval" }); },
    onError: (err: Error) => toast({ title: "Couldn't submit order", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const reviewPo = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchasing/orders/${id}/review`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] }); toast({ title: "Purchase order marked as reviewed" }); },
    onError: (err: Error) => toast({ title: "Couldn't review order", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const approvePo = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchasing/orders/${id}/approve`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] }); toast({ title: "Purchase order approved" }); },
    onError: (err: Error) => toast({ title: "Couldn't approve order", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const rejectPo = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/purchasing/orders/${id}/reject`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] }); toast({ title: "Purchase order rejected" }); },
    onError: (err: Error) => toast({ title: "Couldn't reject order", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const receiveDirect = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/purchasing/orders/${id}/receive-direct`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] }); toast({ title: "Direct expense posted" }); },
    onError: (err: Error) => toast({ title: "Couldn't post direct expense", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const cancelPo = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/purchasing/orders/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/purchasing/orders"] }); toast({ title: "Purchase order cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel order", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{orders.length} order{orders.length === 1 ? "" : "s"}</div>
        <NewPoDialog items={items} suppliers={suppliers} accounts={accounts} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading purchase orders…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No purchase orders yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead><TableHead>Supplier</TableHead><TableHead>Type</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((po) => (
                <Fragment key={po.id}>
                  <TableRow key={po.id} data-testid={`row-po-${po.id}`}>
                    <TableCell className="font-mono">
                      <button className="underline-offset-2 hover:underline" onClick={() => setExpandedId(expandedId === po.id ? null : po.id)} data-testid={`button-expand-po-${po.id}`}>
                        {po.poNumber}
                      </button>
                    </TableCell>
                    <TableCell>{supplierName(po.supplierId)}</TableCell>
                    <TableCell className="capitalize">{po.type}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(po.totalAmount)}</TableCell>
                    <TableCell><Badge variant={poStatusVariant[po.status]}>{titleCase(po.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-1">
                        {po.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => submitPo.mutate(po.id)} disabled={submitPo.isPending} data-testid={`button-submit-po-${po.id}`}>
                            <Send className="h-3.5 w-3.5 mr-1" /> Submit
                          </Button>
                        )}
                        {po.status === "pending_review" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => reviewPo.mutate(po.id)} disabled={reviewPo.isPending} data-testid={`button-review-po-${po.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark reviewed
                            </Button>
                            <ReasonDialog
                              title={`Reject ${po.poNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject order"
                              onConfirm={(reason) => rejectPo.mutate({ id: po.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-po-${po.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {po.status === "pending_approval" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approvePo.mutate(po.id)} disabled={approvePo.isPending} data-testid={`button-approve-po-${po.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <ReasonDialog
                              title={`Reject ${po.poNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject order"
                              onConfirm={(reason) => rejectPo.mutate({ id: po.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-po-${po.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {(po.status === "approved" || po.status === "partially_received") && po.type === "stock" && (
                          <ReceiveGoodsDialog po={po} stores={stores} trigger={
                            <Button size="sm" variant="outline" data-testid={`button-receive-po-${po.id}`}><PackageCheck className="h-3.5 w-3.5 mr-1" /> Receive</Button>
                          } />
                        )}
                        {po.status === "approved" && po.type === "direct" && (
                          <Button size="sm" variant="outline" onClick={() => receiveDirect.mutate(po.id)} disabled={receiveDirect.isPending} data-testid={`button-receive-direct-po-${po.id}`}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Post expense
                          </Button>
                        )}
                        {(po.status === "draft" || po.status === "pending_review" || po.status === "pending_approval" || po.status === "approved" || po.status === "partially_received") && (
                          canAdjust ? (
                            <ReasonDialog
                              title={`Cancel ${po.poNumber}?`}
                              label="Reason for cancellation"
                              confirmLabel="Confirm cancellation"
                              onConfirm={(reason) => cancelPo.mutate({ id: po.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Cancel" data-testid={`button-cancel-po-${po.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          ) : (
                            <Button size="icon" variant="ghost" disabled title="Requires the 'adjust inventory' right" data-testid={`button-cancel-po-${po.id}`}><Lock className="h-4 w-4" /></Button>
                          )
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === po.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <PoLinesPreview poId={po.id} />
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

// ================= Goods Receipts (read-only trail) =================
function GrnLinesPreview({ grnId }: { grnId: number }) {
  const { data: lines = [] } = useQuery<GoodsReceiptLine[]>({ queryKey: [`/api/purchasing/goods-receipts/${grnId}/lines`] });
  if (lines.length === 0) return <div className="text-sm text-muted-foreground p-3">No lines.</div>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty received</TableHead><TableHead className="text-right">Unit cost</TableHead></TableRow></TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>#{l.itemId}</TableCell>
              <TableCell className="text-right tabular-nums">{l.quantityReceived}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKES(l.unitCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GoodsReceiptsTab() {
  const { data: receipts = [], isLoading } = useQuery<GoodsReceipt[]>({ queryKey: ["/api/purchasing/goods-receipts"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? `#${id}`;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const sorted = [...receipts].sort((a, b) => b.receivedAt - a.receivedAt);
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{receipts.length} goods receipt{receipts.length === 1 ? "" : "s"}</div>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading goods receipts…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No goods receipts yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>GRN #</TableHead><TableHead>PO</TableHead><TableHead>Store</TableHead><TableHead>Received by</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((g) => (
                <Fragment key={g.id}>
                  <TableRow key={g.id} data-testid={`row-grn-${g.id}`}>
                    <TableCell className="font-mono">
                      <button className="underline-offset-2 hover:underline" onClick={() => setExpandedId(expandedId === g.id ? null : g.id)} data-testid={`button-expand-grn-${g.id}`}>
                        {g.grnNumber}
                      </button>
                    </TableCell>
                    <TableCell>#{g.poId}</TableCell>
                    <TableCell>{storeName(g.storeId)}</TableCell>
                    <TableCell>{g.receivedBy}</TableCell>
                    <TableCell>{new Date(g.receivedAt).toLocaleString("en-KE")}</TableCell>
                    <TableCell><Badge variant={g.status === "cancelled" ? "outline" : "secondary"}>{titleCase(g.status)}</Badge></TableCell>
                  </TableRow>
                  {expandedId === g.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <GrnLinesPreview grnId={g.id} />
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
export default function Purchasing() {
  const { data: currentUser } = useCurrentUser();
  const canAdjust = Boolean(currentUser?.isAdmin || currentUser?.canAdjustInventory);
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/purchasing/suppliers"] });
  const { data: prs = [] } = useQuery<PurchaseRequisition[]>({ queryKey: ["/api/purchasing/requisitions"] });
  const { data: orders = [] } = useQuery<PurchaseOrder[]>({ queryKey: ["/api/purchasing/orders"] });

  const pendingPrs = prs.filter((p) => p.status === "pending_approval").length;
  const openPos = orders.filter((o) => o.status === "approved" || o.status === "partially_received").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Purchasing" description="Suppliers, purchase requisitions, purchase orders, and goods receipts." />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Suppliers" value={String(suppliers.length)} icon={Truck} testId="stat-suppliers-count" />
        <StatCard label="PRs pending approval" value={String(pendingPrs)} icon={FileText} accent="warning" testId="stat-pending-prs" />
        <StatCard label="Open purchase orders" value={String(openPos)} icon={ShoppingCart} testId="stat-open-pos" />
        <StatCard label="Total purchase orders" value={String(orders.length)} icon={PackageCheck} accent="muted" testId="stat-total-pos" />
      </div>

      <Tabs defaultValue="requisitions">
        <TabsList>
          <TabsTrigger value="requisitions" data-testid="tab-purchase-requisitions">Purchase Requisitions</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-purchase-orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="receipts" data-testid="tab-goods-receipts">Goods Receipts</TabsTrigger>
          <TabsTrigger value="suppliers" data-testid="tab-suppliers">Suppliers</TabsTrigger>
        </TabsList>
        <TabsContent value="requisitions" className="mt-4"><PurchaseRequisitionsTab canAdjust={canAdjust} /></TabsContent>
        <TabsContent value="orders" className="mt-4"><PurchaseOrdersTab canAdjust={canAdjust} /></TabsContent>
        <TabsContent value="receipts" className="mt-4"><GoodsReceiptsTab /></TabsContent>
        <TabsContent value="suppliers" className="mt-4"><SuppliersTab canAdjust={canAdjust} /></TabsContent>
      </Tabs>
    </div>
  );
}
