import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Wrench, AlertTriangle, CheckCircle2, Lock, Filter, MessageCircle, Trash2, Link2, Pencil } from "lucide-react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { titleCase } from "@/lib/format";
import { buildWhatsAppLink, buildMaintenancePdfUrl } from "@/lib/whatsapp";
import { useCurrentUser } from "@/hooks/use-auth";
import { MAINTENANCE_CATEGORIES, MAINTENANCE_CATEGORY_LABELS, MAINTENANCE_STATUSES } from "@shared/schema";
import type { MaintenanceIssue, MaintenanceCategory, MaintenanceStatus } from "@shared/schema";

/** Asset picker list — available to Maintenance users even without the Assets module. */
export type AssetOption = { id: number; assetNumber: string; name: string; location: string | null; status: string };
export const ASSET_OPTIONS_KEY = "/api/maintenance/asset-options";
const assetLabel = (a: AssetOption) => `${a.assetNumber} — ${a.name}${a.location ? ` (${a.location})` : ""}`;
/** After an issue is attached/detached, refresh both pages' views. */
export const invalidateMaintenanceLinks = () => {
  for (const k of ["/api/maintenance-issues", "/api/assets/maintenance-counts"]) queryClient.invalidateQueries({ queryKey: [k] });
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/api\/assets\/\d+\/maintenance$/.test(q.queryKey[0] as string) });
};

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const priorityVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  low: "outline",
  normal: "secondary",
  high: "default",
  urgent: "destructive",
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "destructive",
  in_progress: "default",
  resolved: "secondary",
  closed: "outline",
};

const issueFormSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES),
  title: z.string().min(1, "Give the issue a short title"),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  reportedBy: z.string().min(1, "Who is reporting this?"),
  reportedPhone: z.string().optional().nullable(),
  priority: z.enum(PRIORITIES),
  assetId: z.string().optional(),
});

export function ReportIssueDialog({ presetAsset, trigger }: { presetAsset?: AssetOption; trigger?: React.ReactNode } = {}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: allAssets = [] } = useQuery<AssetOption[]>({ queryKey: [ASSET_OPTIONS_KEY], enabled: open });
  const assets = allAssets.filter((a) => a.status !== "disposed" || a.id === presetAsset?.id);
  const form = useForm<z.input<typeof issueFormSchema>, any, z.output<typeof issueFormSchema>>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: { category: "electrical", title: "", description: "", reportedBy: "", reportedPhone: "", priority: "normal", assetId: presetAsset ? String(presetAsset.id) : "none", location: presetAsset?.location ?? "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof issueFormSchema>) => {
      const { assetId, ...rest } = values;
      const payload = { ...rest, assetId: assetId && assetId !== "none" ? Number(assetId) : null };
      const res = await apiRequest("POST", "/api/maintenance-issues", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateMaintenanceLinks();
      toast({ title: "Issue reported", description: `Reference #${data.id}` });
      if (data?._sms?.status === "sent") toast({ title: "SMS sent", description: "The reporter was notified by SMS." });
      setOpen(false);
      form.reset({ category: "electrical", title: "", location: presetAsset?.location ?? "", description: "", reportedBy: "", reportedPhone: "", priority: "normal", assetId: presetAsset ? String(presetAsset.id) : "none" });
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" data-testid="button-report-issue"><Plus className="h-4 w-4 mr-1" /> Report issue</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{presetAsset ? `Report an issue — ${presetAsset.name}` : "Report a maintenance issue"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel>Issue title</FormLabel>
                <FormControl><Input placeholder="e.g. Leaking pipe in Room 203 bathroom" {...field} data-testid="input-issue-title" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-issue-category"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {MAINTENANCE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{MAINTENANCE_CATEGORY_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="priority" render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-issue-priority"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem>
                <FormLabel>Location (optional)</FormLabel>
                <FormControl><Input placeholder="e.g. Room 203, Bar, Generator room" {...field} value={field.value ?? ""} data-testid="input-issue-location" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-issue-description" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="assetId" render={({ field }) => (
              <FormItem>
                <FormLabel>Asset (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? "none"}>
                  <FormControl><SelectTrigger data-testid="select-issue-asset"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {assets.map((a) => <SelectItem key={a.id} value={String(a.id)}>{assetLabel(a)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="reportedBy" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reported by</FormLabel>
                  <FormControl><Input placeholder="Staff or guest name" {...field} data-testid="input-issue-reported-by" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="reportedPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional, for SMS updates)</FormLabel>
                  <FormControl><Input placeholder="07XXXXXXXX" {...field} value={field.value ?? ""} data-testid="input-issue-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-issue">
                {mutation.isPending ? "Submitting..." : "Submit report"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Attach, change or remove the asset on an issue that is already logged. */
function AttachAssetDialog({ issue, assets }: { issue: MaintenanceIssue; assets: AssetOption[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(issue.assetId ? String(issue.assetId) : "none");
  const choices = assets.filter((a) => a.status !== "disposed" || a.id === issue.assetId);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/maintenance-issues/${issue.id}`, { assetId: value === "none" ? null : Number(value) })).json(),
    onSuccess: () => { invalidateMaintenanceLinks(); setOpen(false); toast({ title: value === "none" ? "Asset removed from the issue" : "Asset attached", description: `Issue #${issue.id}` }); },
    onError: (err: Error) => toast({ title: "Couldn't update the asset", description: err.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1"), variant: "destructive" }),
  });
  const current = assets.find((a) => a.id === issue.assetId);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(issue.assetId ? String(issue.assetId) : "none"); }}>
      <DialogTrigger asChild>
        {current ? (
          <button type="button" className="inline-flex items-center gap-1 text-left hover:underline underline-offset-2" title="Change the asset" data-testid={`button-attach-asset-${issue.id}`}>
            <span>{current.name}</span><Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
          </button>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" data-testid={`button-attach-asset-${issue.id}`}><Link2 className="h-3.5 w-3.5 mr-1" />Attach</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Asset for issue #{issue.id}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{issue.title}</p>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger data-testid={`select-attach-asset-${issue.id}`}><SelectValue placeholder="Choose an asset" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No asset</SelectItem>
            {choices.map((a) => <SelectItem key={a.id} value={String(a.id)}>{assetLabel(a)}</SelectItem>)}
          </SelectContent>
        </Select>
        {!choices.length && <p className="text-xs text-muted-foreground">No assets registered yet. Assets are added in Assets → Register asset.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={save.isPending || value === (issue.assetId ? String(issue.assetId) : "none")} onClick={() => save.mutate()} data-testid={`button-save-attach-${issue.id}`}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Maintenance() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const canClose = Boolean(currentUser?.isAdmin || currentUser?.canCloseMaintenanceIssues);
  const { data: issues = [], isLoading } = useQuery<MaintenanceIssue[]>({ queryKey: ["/api/maintenance-issues"] });
  const { data: assets = [] } = useQuery<AssetOption[]>({ queryKey: [ASSET_OPTIONS_KEY] });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const updateIssue = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<MaintenanceIssue> }) => {
      const res = await apiRequest("PATCH", `/api/maintenance-issues/${id}`, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-issues"] });
      toast({ title: "Issue updated" });
      if (data?._sms?.status === "sent") toast({ title: "SMS sent", description: "The reporter was notified by SMS." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update issue", description: err.message, variant: "destructive" }),
  });

  const deleteIssue = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/maintenance-issues/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-issues"] }); toast({ title: "Issue removed" }); },
  });

  const filtered = useMemo(() => {
    return issues.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
      if (assetFilter === "none" && i.assetId) return false;
      if (assetFilter !== "all" && assetFilter !== "none" && i.assetId !== Number(assetFilter)) return false;
      return true;
    });
  }, [issues, statusFilter, categoryFilter, assetFilter]);

  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  const openCount = issues.filter((i) => i.status === "open").length;
  const inProgressCount = issues.filter((i) => i.status === "in_progress").length;
  const resolvedCount = issues.filter((i) => i.status === "resolved").length;

  const nextStatus = (s: MaintenanceStatus): MaintenanceStatus | null => {
    if (s === "open") return "in_progress";
    if (s === "in_progress") return "resolved";
    if (s === "resolved") return "closed";
    return null;
  };

  return (
  <div className="p-4 sm:p-6 space-y-6 w-full">
      <PageHeader
        title="Maintenance"
        description="Track every reported maintenance issue from report through to resolution and closure."
        action={<ReportIssueDialog />}
      />

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Open" value={String(openCount)} icon={AlertTriangle} accent="warning" testId="stat-issues-open" />
        <StatCard label="In progress" value={String(inProgressCount)} icon={Wrench} testId="stat-issues-in-progress" />
        <StatCard label="Resolved (awaiting close)" value={String(resolvedCount)} icon={CheckCircle2} accent="success" testId="stat-issues-resolved" />
        <StatCard label="Total logged" value={String(issues.length)} icon={Wrench} accent="muted" testId="stat-issues-total" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-card-border">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" data-testid="select-filter-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {MAINTENANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40" data-testid="select-filter-category"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {MAINTENANCE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{MAINTENANCE_CATEGORY_LABELS[c]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assetFilter} onValueChange={setAssetFilter}>
            <SelectTrigger className="w-52" data-testid="select-filter-asset"><SelectValue placeholder="All assets" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assets</SelectItem>
              <SelectItem value="none">No asset attached</SelectItem>
              {assets.filter((a) => issues.some((i) => i.assetId === a.id)).map((a) => <SelectItem key={a.id} value={String(a.id)}>{assetLabel(a)}</SelectItem>)}
            </SelectContent>
          </Select>
          {(statusFilter !== "all" || categoryFilter !== "all" || assetFilter !== "all") && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setCategoryFilter("all"); setAssetFilter("all"); }} data-testid="button-clear-issue-filters">
              Clear filters
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading issues…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No maintenance issues match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Reported by</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((issue) => {
                  const advance = nextStatus(issue.status as MaintenanceStatus);
                  const closingBlocked = advance === "closed" && !canClose;
                  let message = `The Chekata Maintenance: update on your report "${issue.title}" (ref #${issue.id}) — status is now ${titleCase(issue.status)}.`;
                  if (issue.publicToken) {
                    message += `\n\nView/download the full report: ${buildMaintenancePdfUrl(issue.id, issue.publicToken)}`;
                  }
                  const waLink = buildWhatsAppLink(issue.reportedPhone, message, currentUser?.environment);
                  return (
                    <TableRow key={issue.id} data-testid={`row-issue-${issue.id}`}>
                      <TableCell className="font-mono text-xs">#{issue.id}</TableCell>
                      <TableCell className="font-medium">{issue.title}</TableCell>
                      <TableCell><Badge variant="outline">{MAINTENANCE_CATEGORY_LABELS[issue.category as MaintenanceCategory] ?? titleCase(issue.category)}</Badge></TableCell>
                      <TableCell className="text-sm" data-testid={`cell-issue-asset-${issue.id}`}><AttachAssetDialog issue={issue} assets={assets} /></TableCell>
                      <TableCell>{issue.location || "—"}</TableCell>
                      <TableCell>{issue.reportedBy}</TableCell>
                      <TableCell><Badge variant={priorityVariant[issue.priority]}>{titleCase(issue.priority)}</Badge></TableCell>
                      <TableCell><Badge variant={statusVariant[issue.status]}>{titleCase(issue.status)}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-1">
                          {waLink && (
                            <Button size="icon" variant="ghost" title="Notify via WhatsApp" onClick={() => window.open(waLink, "_blank")} data-testid={`button-whatsapp-issue-${issue.id}`}>
                              <MessageCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {advance && (
                            <Button
                              size="sm"
                              variant={closingBlocked ? "ghost" : "outline"}
                              disabled={closingBlocked || updateIssue.isPending}
                              title={closingBlocked ? "Only an admin or a user with close rights can close this issue" : undefined}
                              onClick={() => updateIssue.mutate({ id: issue.id, data: { status: advance } })}
                              data-testid={`button-advance-issue-${issue.id}`}
                            >
                              {closingBlocked ? <Lock className="h-3.5 w-3.5 mr-1" /> : null}
                              Mark {titleCase(advance)}
                            </Button>
                          )}
                          {currentUser?.isAdmin && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-issue-${issue.id}`}><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this issue?</AlertDialogTitle>
                                  <AlertDialogDescription>This permanently removes the maintenance record for "{issue.title}".</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteIssue.mutate(issue.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
