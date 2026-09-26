import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp, Inbox, RefreshCw, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser, canAccess } from "@/hooks/use-auth";
import { formatKES } from "@/lib/format";
import { hasAnyApprovalModule, SUMMARY_KEY, relativeTime } from "@/lib/director";
import { ApprovePrDialog } from "@/pages/purchasing";
import type { Supplier, ChartOfAccount } from "@shared/schema";

// One inbox for every approval workflow the signed-in user has module access
// to. It is not a permission of its own: each list below is fetched only when
// the user holds that module, and the server still enforces the approval
// matrix (who may review/approve) on every action.

type Kind = "purchase_requisition" | "purchase_order" | "internal_requisition" | "temporary_labor_requisition" | "leave_request" | "payroll_run" | "payment_voucher";

interface Item {
  key: string;
  id: number;
  kind: Kind;
  category: string;
  stageLabel: string;
  number: string;
  title: string;
  subtitle: string;
  amount?: number;
  date: number | string | null;
  actionUrl: string;
  actionLabel: string;
  rejectUrl?: string;
  rejectLabel?: string;
  rejectNeedsReason: boolean;
  linesUrl?: string;
  pageLink: string;
  pr?: { id: number; prNumber: string; type: string };
}

function extractErrorMessage(raw: string): string {
  const m = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = m ? m[1] : raw;
  try { const j = JSON.parse(body); if (j && typeof j.error === "string") return j.error; } catch { /* not JSON */ }
  return body;
}

function toMs(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
  return 0;
}

function stageOf(status: string | null | undefined): "review" | "approve" | null {
  const s = (status ?? "").toLowerCase();
  if (s === "pending_review") return "review";
  if (s === "pending_approval") return "approve";
  return null;
}

const CATEGORY_ORDER = ["Purchasing", "Internal Requisitions", "Temporary Labour", "Leave", "Payroll", "Payment Vouchers"];

function usePending() {
  const { data: user } = useCurrentUser();
  const can = {
    purchasing: canAccess(user, "purchasing"),
    ir: canAccess(user, "internal-requisitions"),
    hr: canAccess(user, "hr"),
    leave: canAccess(user, "leave"),
    staff: canAccess(user, "staff"),
    payroll: canAccess(user, "payroll"),
    finance: canAccess(user, "finance"),
  };
  const pr = useQuery<any[]>({ queryKey: ["/api/purchasing/requisitions"], enabled: can.purchasing });
  const po = useQuery<any[]>({ queryKey: ["/api/purchasing/orders"], enabled: can.purchasing });
  const suppliers = useQuery<Supplier[]>({ queryKey: ["/api/purchasing/suppliers"], enabled: can.purchasing });
  const glAccounts = useQuery<ChartOfAccount[]>({ queryKey: ["/api/purchasing/gl-accounts"], enabled: can.purchasing });
  const ir = useQuery<any[]>({ queryKey: ["/api/internal-requisitions"], enabled: can.ir });
  const tlr = useQuery<any[]>({ queryKey: ["/api/temporary-labor-requisitions"], enabled: can.hr });
  const leave = useQuery<any[]>({ queryKey: ["/api/leave-requests"], enabled: can.leave });
  const leaveTypes = useQuery<any[]>({ queryKey: ["/api/leave-types"], enabled: can.leave });
  const staff = useQuery<any[]>({ queryKey: ["/api/staff"], enabled: can.staff && (can.leave || can.payroll) });
  const payroll = useQuery<any[]>({ queryKey: ["/api/payroll/runs"], enabled: can.payroll });
  const vouchers = useQuery<any[]>({ queryKey: ["/api/finance/payment-vouchers"], enabled: can.finance });

  const items = useMemo(() => {
    const out: Item[] = [];
    const supplierName = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]));
    const staffName = new Map((staff.data ?? []).map((s: any) => [s.id, s.name]));
    const leaveTypeName = new Map((leaveTypes.data ?? []).map((t: any) => [t.id, t.name]));

    const pushRA = (kind: Kind, category: string, docLabel: string, base: string, pageLink: string, row: any, extra: Pick<Item, "number" | "title" | "subtitle"> & Partial<Item>) => {
      const stage = stageOf(row.status);
      if (!stage) return;
      out.push({
        key: `${kind}-${row.id}`, id: row.id, kind, category,
        stageLabel: `${docLabel} · ${stage === "review" ? "Awaiting review" : "Awaiting approval"}`,
        date: row.createdAt ?? null,
        actionUrl: `${base}/${row.id}/${stage === "review" ? "review" : "approve"}`,
        actionLabel: stage === "review" ? "Mark reviewed" : "Approve",
        rejectUrl: `${base}/${row.id}/reject`, rejectLabel: "Reject", rejectNeedsReason: true,
        linesUrl: `${base}/${row.id}/lines`, pageLink,
        ...extra,
      });
    };

    for (const r of pr.data ?? []) {
      pushRA("purchase_requisition", "Purchasing", "Purchase requisition", "/api/purchasing/requisitions", "/purchasing", r, {
        number: r.prNumber, title: r.purpose,
        subtitle: `Requested by ${r.requestedBy}${r.department ? " · " + r.department : ""} · ${r.type === "direct" ? "Direct purchase" : "Stock"}`,
        pr: stageOf(r.status) === "approve" ? { id: r.id, prNumber: r.prNumber, type: r.type } : undefined,
      });
    }
    for (const r of po.data ?? []) {
      pushRA("purchase_order", "Purchasing", "Purchase order", "/api/purchasing/orders", "/purchasing", r, {
        number: r.poNumber, title: supplierName.get(r.supplierId) ?? `Purchase order ${r.poNumber}`,
        subtitle: `Raised by ${r.createdBy}${r.type ? " · " + (r.type === "direct" ? "Direct" : "Stock") : ""}`,
        amount: r.totalAmount,
      });
    }
    for (const r of ir.data ?? []) {
      pushRA("internal_requisition", "Internal Requisitions", "Internal requisition", "/api/internal-requisitions", "/internal-requisitions", r, {
        number: r.irNumber, title: r.purpose, subtitle: `Requested by ${r.requestedBy}${r.department ? " · " + r.department : ""}`,
      });
    }
    for (const r of tlr.data ?? []) {
      pushRA("temporary_labor_requisition", "Temporary Labour", "Temporary labour", "/api/temporary-labor-requisitions", "/temporary-labor-requisitions", r, {
        number: r.tlrNumber, title: r.purpose, subtitle: `Requested by ${r.requestedBy}`,
      });
    }
    for (const r of leave.data ?? []) {
      pushRA("leave_request", "Leave", "Leave request", "/api/leave-requests", "/leave", r, {
        number: leaveTypeName.get(r.leaveTypeId) ?? "Leave",
        title: `${staffName.get(r.staffId) ?? `Staff #${r.staffId}`}: ${r.startDate} → ${r.endDate}`,
        subtitle: `${r.days} day${r.days === 1 ? "" : "s"}${r.reason ? " · " + r.reason : ""}`,
        linesUrl: undefined,
      });
    }
    for (const r of payroll.data ?? []) {
      if ((r.status ?? "").toLowerCase() !== "draft") continue;
      out.push({
        key: `payroll_run-${r.id}`, id: r.id, kind: "payroll_run", category: "Payroll", stageLabel: "Payroll run · Awaiting approval",
        number: r.runNumber ?? `Run #${r.id}`, title: `Payroll ${r.periodMonth ?? ""}`.trim(),
        subtitle: `Gross ${formatKES(r.totalGross ?? 0)} · Deductions ${formatKES(r.totalDeductions ?? 0)} · Employer cost ${formatKES(r.totalEmployerCost ?? 0)}`,
        amount: r.totalNet, date: r.createdAt ?? null,
        actionUrl: `/api/payroll/runs/${r.id}/approve`, actionLabel: "Approve & post",
        rejectUrl: `/api/payroll/runs/${r.id}/cancel`, rejectLabel: "Cancel run", rejectNeedsReason: false,
        linesUrl: `/api/payroll/runs/${r.id}/lines`, pageLink: "/payroll",
      });
    }
    for (const r of vouchers.data ?? []) {
      const st = (r.status ?? "").toLowerCase();
      if (st === "posted" || st === "cancelled") continue;
      const method = r.paymentMethod ? String(r.paymentMethod).replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "";
      out.push({
        key: `payment_voucher-${r.id}`, id: r.id, kind: "payment_voucher", category: "Payment Vouchers", stageLabel: "Payment voucher · Awaiting posting",
        number: r.voucherNumber, title: r.payeeName,
        subtitle: [r.description, method, r.requestedBy ? `by ${r.requestedBy}` : ""].filter(Boolean).join(" · "),
        amount: r.amount, date: r.voucherDate ?? r.createdAt ?? null,
        actionUrl: `/api/finance/payment-vouchers/${r.id}/post`, actionLabel: "Post payment",
        rejectUrl: `/api/finance/payment-vouchers/${r.id}/cancel`, rejectLabel: "Cancel voucher", rejectNeedsReason: true,
        pageLink: "/finance",
      });
    }
    out.sort((a, b) => toMs(b.date) - toMs(a.date));
    return out;
  }, [pr.data, po.data, suppliers.data, ir.data, tlr.data, leave.data, leaveTypes.data, staff.data, payroll.data, vouchers.data]);

  const all = [pr, po, ir, tlr, leave, payroll, vouchers];
  const isLoading = all.some((q) => q.isLoading && q.fetchStatus !== "idle");
  const errorCount = all.filter((q) => q.isError).length;
  const isFetching = all.some((q) => q.isFetching);
  const refetch = () => Promise.all([...all, suppliers, glAccounts, leaveTypes, staff].filter((q) => q.fetchStatus !== "idle" || q.data !== undefined).map((q) => q.refetch()));
  return { items, isLoading, errorCount, isFetching, refetch, suppliers: suppliers.data ?? [], glAccounts: glAccounts.data ?? [], can };
}

function invalidateAfterDecision() {
  for (const k of ["/api/purchasing/requisitions", "/api/purchasing/orders", "/api/internal-requisitions", "/api/temporary-labor-requisitions", "/api/leave-requests", "/api/payroll/runs", "/api/finance/payment-vouchers"]) {
    queryClient.invalidateQueries({ queryKey: [k] });
  }
  queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
  queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
}

function LinesPreview({ item, can }: { item: Item; can: { staff: boolean } }) {
  const { data: lines = [], isLoading } = useQuery<any[]>({ queryKey: [item.linesUrl!], enabled: !!item.linesUrl });
  const { data: invItems = [] } = useQuery<any[]>({ queryKey: ["/api/inventory/items"], enabled: item.kind === "internal_requisition" });
  const { data: staff = [] } = useQuery<any[]>({ queryKey: ["/api/staff"], enabled: item.kind === "payroll_run" && can.staff });
  const itemName = new Map(invItems.map((i: any) => [i.id, i.name]));
  const staffName = new Map(staff.map((s: any) => [s.id, s.name]));
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No lines.</p>;
  const rows = lines.map((l: any) => {
    switch (item.kind) {
      case "purchase_requisition": return { t: l.description, d: `${l.quantity} ${l.unitOfMeasure ?? ""} × ${formatKES(l.estimatedUnitCost ?? 0)} (est.)`, a: (l.quantity ?? 0) * (l.estimatedUnitCost ?? 0) };
      case "purchase_order": return { t: l.description, d: `${l.quantity} ${l.unitOfMeasure ?? ""} × ${formatKES(l.unitCost ?? 0)}`, a: l.lineTotal };
      case "internal_requisition": return { t: itemName.get(l.itemId) ?? `Item #${l.itemId}`, d: `Qty requested ${l.quantityRequested}${l.notes ? " · " + l.notes : ""}` };
      case "temporary_labor_requisition": return { t: l.role, d: `${l.headcount} × ${l.durationValue} ${l.durationUnit}${l.dateNeeded ? " · from " + l.dateNeeded : ""}${l.notes ? " · " + l.notes : ""}` };
      case "payroll_run": return { t: staffName.get(l.staffId) ?? `Staff #${l.staffId}`, d: `Gross ${formatKES(l.grossPay ?? 0)} · Deductions ${formatKES(l.totalDeductions ?? 0)}`, a: l.netPay };
      default: return { t: String(l.description ?? l.id), d: "" };
    }
  }) as { t: string; d: string; a?: number }[];
  const hasAmounts = rows.some((r) => typeof r.a === "number");
  const total = rows.reduce((s, r) => s + (r.a ?? 0), 0);
  return (
    <div className="divide-y divide-border rounded-md border border-border bg-background">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0"><p className="truncate">{r.t}</p>{r.d && <p className="text-xs text-muted-foreground">{r.d}</p>}</div>
          {typeof r.a === "number" && <span className="shrink-0 tabular-nums">{formatKES(r.a)}</span>}
        </div>
      ))}
      {hasAmounts && <div className="flex justify-between px-3 py-2 text-sm font-medium"><span>Total</span><span className="tabular-nums">{formatKES(total)}</span></div>}
    </div>
  );
}

function ApprovalCard({ item, suppliers, glAccounts, can }: { item: Item; suppliers: Supplier[]; glAccounts: ChartOfAccount[]; can: { staff: boolean } }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const decide = useMutation({
    mutationFn: async ({ url, body }: { url: string; body?: Record<string, unknown> }) => apiRequest("POST", url, body ?? {}),
    onSuccess: (_d, vars) => {
      invalidateAfterDecision();
      const rejected = vars.url === item.rejectUrl;
      toast({ title: rejected ? `${item.number} ${item.rejectLabel === "Reject" ? "rejected" : "cancelled"}` : `${item.number} — ${item.actionLabel.toLowerCase()} done` });
      setRejectOpen(false); setConfirmOpen(false); setReason("");
    },
    onError: (err: Error) => toast({ title: "Action not completed", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const primaryBtn = (
    <Button size="sm" disabled={decide.isPending} data-testid={`button-approve-${item.key}`}
      onClick={item.pr ? undefined : () => setConfirmOpen(true)}>
      <CheckCircle2 className="h-4 w-4 mr-1" />{item.actionLabel}
    </Button>
  );

  return (
    <Card className="p-4" data-testid={`approval-${item.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{item.stageLabel}</p>
          <p className="font-medium leading-snug"><span className="tabular-nums">{item.number}</span>{item.title ? <span className="text-muted-foreground font-normal"> · </span> : null}{item.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          {typeof item.amount === "number" && <p className="font-semibold tabular-nums">{formatKES(item.amount)}</p>}
          {item.date && <p className="text-[11px] text-muted-foreground">{typeof item.date === "number" ? relativeTime(item.date) : item.date}</p>}
        </div>
      </div>

      {expanded && item.linesUrl && <div className="mt-3"><LinesPreview item={item} can={can} /></div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.pr ? (
          <ApprovePrDialog pr={item.pr as any} suppliers={suppliers} accounts={glAccounts} trigger={primaryBtn} onApproved={invalidateAfterDecision} />
        ) : primaryBtn}
        {item.rejectUrl && (
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setRejectOpen(true)} data-testid={`button-reject-${item.key}`}>
            <XCircle className="h-4 w-4 mr-1" />{item.rejectLabel}
          </Button>
        )}
        {item.linesUrl && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} data-testid={`button-lines-${item.key}`}>
            {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}{expanded ? "Hide lines" : "Lines"}
          </Button>
        )}
        <Link href={item.pageLink}>
          <Button size="sm" variant="ghost" className="ml-auto" data-testid={`button-open-${item.key}`}><ExternalLink className="h-4 w-4 mr-1" />Open</Button>
        </Link>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{item.actionLabel} {item.number}?</DialogTitle>
            <DialogDescription>{item.title}{typeof item.amount === "number" ? ` · ${formatKES(item.amount)}` : ""}</DialogDescription>
          </DialogHeader>
          {(item.kind === "payroll_run" || item.kind === "payment_voucher") && (
            <p className="text-sm text-muted-foreground">This posts to the general ledger and can't be undone from here.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Back</Button>
            <Button onClick={() => decide.mutate({ url: item.actionUrl })} disabled={decide.isPending} data-testid={`button-confirm-approve-${item.key}`}>
              {decide.isPending ? "Working..." : item.actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{item.rejectLabel} {item.number}</DialogTitle>
            <DialogDescription>{item.kind === "payment_voucher" ? "A cancellation reason is required." : item.rejectNeedsReason ? "The requester will be notified with your reason." : "This can't be undone."}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={item.rejectNeedsReason ? "Reason (required)" : "Reason (optional)"} data-testid={`input-reject-reason-${item.key}`} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={decide.isPending || (item.rejectNeedsReason && !reason.trim())}
              onClick={() => decide.mutate({ url: item.rejectUrl!, body: { reason: reason.trim() } })} data-testid={`button-confirm-reject-${item.key}`}>
              {decide.isPending ? "Working..." : item.rejectLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function ApprovalsPage() {
  const { data: user } = useCurrentUser();
  const { items, isLoading, errorCount, isFetching, refetch, suppliers, glAccounts, can } = usePending();
  const [filter, setFilter] = useState<string>("All");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return CATEGORY_ORDER.filter((c) => m.has(c)).map((c) => ({ c, n: m.get(c)! }));
  }, [items]);
  const shown = filter === "All" ? items : items.filter((i) => i.category === filter);

  if (!hasAnyApprovalModule(user)) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <PageHeader title="Approvals" />
        <Card className="p-6 text-sm text-muted-foreground">None of your modules have an approval workflow.</Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
      <PageHeader title="Approvals" description="Everything waiting for a decision, across all your modules."
        action={<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-approvals-refresh"><RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>} />

      {counts.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Filter approvals">
          {[{ c: "All", n: items.length }, ...counts].map(({ c, n }) => (
            <Button key={c} size="sm" variant={filter === c ? "default" : "outline"} className="shrink-0" onClick={() => setFilter(c)} role="tab" aria-selected={filter === c} data-testid={`filter-${c.toLowerCase().replace(/\s+/g, "-")}`}>
              {c}<Badge variant="secondary" className="ml-1.5 px-1.5 tabular-nums">{n}</Badge>
            </Button>
          ))}
        </div>
      )}

      {errorCount > 0 && <Card className="p-3 text-sm text-destructive">Some lists couldn't be loaded. Pull to refresh or try again.</Card>}

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : shown.length === 0 ? (
        <Card className="p-8 flex flex-col items-center text-center gap-2" data-testid="approvals-empty">
          <Inbox className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">You're all caught up</p>
          <p className="text-sm text-muted-foreground">Nothing is waiting for review, approval or posting.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((i) => <ApprovalCard key={i.key} item={i} suppliers={suppliers} glAccounts={glAccounts} can={can} />)}
        </div>
      )}
    </div>
  );
}
