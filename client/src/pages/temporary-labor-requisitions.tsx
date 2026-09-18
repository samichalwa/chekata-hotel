import { Fragment, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, ClipboardCheck, Send, CheckCircle2, Ban, Users } from "lucide-react";
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
import type { TemporaryLaborRequisition, TemporaryLaborRequisitionLine } from "@shared/schema";

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

const tlrStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline", pending_review: "outline", pending_approval: "default", approved: "default", rejected: "destructive", cancelled: "destructive",
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
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-tlr-reason" />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={!reason} onClick={() => { onConfirm(reason); setOpen(false); setReason(""); }} data-testid="button-confirm-tlr-reason">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= New Temporary Labor Requisition =================
type TlrLineForm = { role: string; headcount: string; durationValue: string; durationUnit: "days" | "hours"; dateNeeded: string; notes: string };

const emptyLine = (): TlrLineForm => ({ role: "", headcount: "1", durationValue: "", durationUnit: "days", dateNeeded: "", notes: "" });

function NewTlrDialog() {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<TlrLineForm[]>([emptyLine()]);
  const { toast } = useToast();

  const updateLine = (idx: number, patch: Partial<TlrLineForm>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/temporary-labor-requisitions", {
      purpose,
      lines: lines.filter((l) => l.role.trim()).map((l) => ({
        role: l.role.trim(),
        headcount: Number(l.headcount) || 0,
        durationValue: Number(l.durationValue) || 0,
        durationUnit: l.durationUnit,
        dateNeeded: l.dateNeeded || undefined,
        notes: l.notes || undefined,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/temporary-labor-requisitions"] });
      toast({ title: "Temporary labor requisition created as draft" });
      setOpen(false);
      setPurpose(""); setLines([emptyLine()]);
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const canSubmit = purpose.trim() && lines.some((l) => l.role.trim() && Number(l.headcount) > 0 && Number(l.durationValue) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-tlr"><Plus className="h-4 w-4 mr-1" /> New requisition</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl">
        <DialogHeader><DialogTitle>New temporary labor requisition</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Purpose</label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Weekend event coverage" data-testid="input-tlr-purpose" />
          </div>
          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                <div className="grid grid-cols-[2fr_1fr_auto] gap-2 items-start">
                  <Input placeholder="Role (e.g. Waiter, Mason)" value={line.role} onChange={(e) => updateLine(idx, { role: e.target.value })} data-testid={`input-tlr-line-role-${idx}`} />
                  <Input type="number" min={1} placeholder="Headcount" value={line.headcount} onChange={(e) => updateLine(idx, { headcount: e.target.value })} data-testid={`input-tlr-line-headcount-${idx}`} />
                  <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} disabled={lines.length <= 1} data-testid={`button-remove-tlr-line-${idx}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" min={0} step="0.5" placeholder="Duration" value={line.durationValue} onChange={(e) => updateLine(idx, { durationValue: e.target.value })} data-testid={`input-tlr-line-duration-${idx}`} />
                  <Select value={line.durationUnit} onValueChange={(v) => updateLine(idx, { durationUnit: v as "days" | "hours" })}>
                    <SelectTrigger data-testid={`select-tlr-line-unit-${idx}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="date" value={line.dateNeeded} onChange={(e) => updateLine(idx, { dateNeeded: e.target.value })} data-testid={`input-tlr-line-date-${idx}`} />
                </div>
                <Input placeholder="Notes (optional)" value={line.notes} onChange={(e) => updateLine(idx, { notes: e.target.value })} data-testid={`input-tlr-line-notes-${idx}`} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])} data-testid="button-add-tlr-line">
              <Plus className="h-4 w-4 mr-1" /> Add role
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} data-testid="button-save-tlr">
            {mutation.isPending ? "Saving..." : "Create draft requisition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TlrLinesPreview({ tlr }: { tlr: TemporaryLaborRequisition }) {
  const { data: lines = [] } = useQuery<TemporaryLaborRequisitionLine[]>({ queryKey: [`/api/temporary-labor-requisitions/${tlr.id}/lines`] });
  if (lines.length === 0) return <div className="text-sm text-muted-foreground p-3">No lines.</div>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead><TableHead className="text-right">Headcount</TableHead>
            <TableHead className="text-right">Duration</TableHead><TableHead>Needed from</TableHead><TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id} data-testid={`row-tlr-line-${l.id}`}>
              <TableCell>{l.role}</TableCell>
              <TableCell className="text-right tabular-nums">{l.headcount}</TableCell>
              <TableCell className="text-right tabular-nums">{l.durationValue} {l.durationUnit}</TableCell>
              <TableCell>{l.dateNeeded ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{l.notes ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TemporaryLaborRequisitionsTab() {
  const { toast } = useToast();
  const { data: tlrs = [], isLoading } = useQuery<TemporaryLaborRequisition[]>({ queryKey: ["/api/temporary-labor-requisitions"] });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const submitTlr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/temporary-labor-requisitions/${id}/submit`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/temporary-labor-requisitions"] }); toast({ title: "Requisition submitted for approval" }); },
    onError: (err: Error) => toast({ title: "Couldn't submit requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const reviewTlr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/temporary-labor-requisitions/${id}/review`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/temporary-labor-requisitions"] }); toast({ title: "Requisition marked as reviewed" }); },
    onError: (err: Error) => toast({ title: "Couldn't review requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const approveTlr = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/temporary-labor-requisitions/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/temporary-labor-requisitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Requisition approved", description: "Placeholder staff slots were created on the Staff page — fill in real names and rates." });
    },
    onError: (err: Error) => toast({ title: "Couldn't approve requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const rejectTlr = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/temporary-labor-requisitions/${id}/reject`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/temporary-labor-requisitions"] }); toast({ title: "Requisition rejected" }); },
    onError: (err: Error) => toast({ title: "Couldn't reject requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const cancelTlr = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/temporary-labor-requisitions/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/temporary-labor-requisitions"] }); toast({ title: "Requisition cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel requisition", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const sorted = [...tlrs].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{tlrs.length} requisition{tlrs.length === 1 ? "" : "s"}</div>
        <NewTlrDialog />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading temporary labor requisitions…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No temporary labor requisitions yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TLR #</TableHead><TableHead>Purpose</TableHead><TableHead>Requested by</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((tlr) => (
                <Fragment key={tlr.id}>
                  <TableRow data-testid={`row-tlr-${tlr.id}`}>
                    <TableCell className="font-mono">
                      <button className="underline-offset-2 hover:underline" onClick={() => setExpandedId(expandedId === tlr.id ? null : tlr.id)} data-testid={`button-expand-tlr-${tlr.id}`}>
                        {tlr.tlrNumber}
                      </button>
                    </TableCell>
                    <TableCell>{tlr.purpose}</TableCell>
                    <TableCell>{tlr.requestedBy}</TableCell>
                    <TableCell><Badge variant={tlrStatusVariant[tlr.status]}>{titleCase(tlr.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-1">
                        {tlr.status === "draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => submitTlr.mutate(tlr.id)} disabled={submitTlr.isPending} data-testid={`button-submit-tlr-${tlr.id}`}>
                              <Send className="h-3.5 w-3.5 mr-1" /> Submit
                            </Button>
                            <ReasonDialog
                              title={`Cancel ${tlr.tlrNumber}?`}
                              label="Reason for cancellation"
                              confirmLabel="Confirm cancellation"
                              onConfirm={(reason) => cancelTlr.mutate({ id: tlr.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Cancel" data-testid={`button-cancel-tlr-${tlr.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {tlr.status === "pending_review" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => reviewTlr.mutate(tlr.id)} disabled={reviewTlr.isPending} data-testid={`button-review-tlr-${tlr.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark reviewed
                            </Button>
                            <ReasonDialog
                              title={`Reject ${tlr.tlrNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject requisition"
                              onConfirm={(reason) => rejectTlr.mutate({ id: tlr.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-tlr-${tlr.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {tlr.status === "pending_approval" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approveTlr.mutate(tlr.id)} disabled={approveTlr.isPending} data-testid={`button-approve-tlr-${tlr.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <ReasonDialog
                              title={`Reject ${tlr.tlrNumber}?`}
                              label="Reason for rejection"
                              confirmLabel="Reject requisition"
                              onConfirm={(reason) => rejectTlr.mutate({ id: tlr.id, reason })}
                              trigger={<Button size="icon" variant="ghost" title="Reject" data-testid={`button-reject-tlr-${tlr.id}`}><Ban className="h-4 w-4" /></Button>}
                            />
                          </>
                        )}
                        {tlr.status === "approved" && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Placeholder staff created</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === tlr.id && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/30">
                        <TlrLinesPreview tlr={tlr} />
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
export default function TemporaryLaborRequisitions() {
  const { data: tlrs = [] } = useQuery<TemporaryLaborRequisition[]>({ queryKey: ["/api/temporary-labor-requisitions"] });

  const pendingCount = tlrs.filter((t) => t.status === "pending_review" || t.status === "pending_approval").length;
  const approvedCount = tlrs.filter((t) => t.status === "approved").length;
  const draftCount = tlrs.filter((t) => t.status === "draft").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Temporary Labor Requisitions" description="Request temporary workers ahead of time, by role, headcount, and duration — approval auto-creates placeholder staff slots for HR to fill in." />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Total requisitions" value={String(tlrs.length)} icon={ClipboardCheck} testId="stat-tlr-total" />
        <StatCard label="Drafts" value={String(draftCount)} icon={Send} accent="muted" testId="stat-tlr-draft" />
        <StatCard label="Pending" value={String(pendingCount)} icon={Send} accent="warning" testId="stat-tlr-pending" />
        <StatCard label="Approved" value={String(approvedCount)} icon={Users} accent="success" testId="stat-tlr-approved" />
      </div>

      <Tabs defaultValue="requisitions">
        <TabsList>
          <TabsTrigger value="requisitions" data-testid="tab-temporary-labor-requisitions">Requisitions</TabsTrigger>
        </TabsList>
        <TabsContent value="requisitions" className="mt-4"><TemporaryLaborRequisitionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
