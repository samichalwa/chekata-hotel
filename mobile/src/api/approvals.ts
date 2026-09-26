import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { hasModule } from "./types";
import type { SafeUser } from "./types";

// Every approval workflow the CHAIMS backend exposes. The server enforces the
// approval matrix (who may review / approve which document) — the app simply
// lists what is awaiting a decision and shows the server's error if the
// signed-in user isn't the assigned reviewer/approver.
export type ApprovalKind =
  | "purchase_requisition"
  | "purchase_order"
  | "internal_requisition"
  | "temporary_labor_requisition"
  | "leave_request"
  | "payroll_run"
  | "payment_voucher";

// review   → pending_review, POST /review moves it to pending_approval
// approve  → pending_approval (or draft payroll run), POST /approve
// post     → payment voucher awaiting posting to the ledger, POST /post
export type ApprovalStage = "review" | "approve" | "post";

export interface ApprovalItem {
  key: string;
  id: number;
  kind: ApprovalKind;
  category: string;
  moduleLabel: string;
  number: string;
  title: string;
  subtitle: string;
  amount?: number;
  date: number | string | null;
  status: string;
  stage: ApprovalStage;
  actionUrl: string;
  actionLabel: string;
  rejectUrl?: string;
  rejectLabel?: string; // "Reject" or "Cancel" depending on the backend action
  linesUrl?: string;
  // Purchase requisitions need a supplier + payable account (and an expense
  // account for direct-type) before the server will raise the PO.
  needsPurchaseDetails?: boolean;
  prType?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await api.get<T>(url);
  return res.data;
}

function stageFor(status: string | null | undefined): ApprovalStage | null {
  const s = (status ?? "").toLowerCase();
  if (s === "pending_review") return "review";
  if (s === "pending_approval") return "approve";
  return null;
}

function toMs(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

interface ReviewApproveDoc {
  kind: ApprovalKind;
  category: string;
  moduleLabel: string;
  base: string; // e.g. /api/purchasing/requisitions
}

function pushReviewApprove(items: ApprovalItem[], doc: ReviewApproveDoc, row: any, extra: Partial<ApprovalItem> & Pick<ApprovalItem, "number" | "title" | "subtitle">) {
  const stage = stageFor(row.status);
  if (!stage) return;
  items.push({
    key: `${doc.kind}-${row.id}`,
    id: row.id,
    kind: doc.kind,
    category: doc.category,
    moduleLabel: `${doc.moduleLabel} · ${stage === "review" ? "Review" : "Approval"}`,
    date: row.createdAt ?? null,
    status: row.status,
    stage,
    actionUrl: `${doc.base}/${row.id}/${stage === "review" ? "review" : "approve"}`,
    actionLabel: stage === "review" ? "Mark reviewed" : "Approve",
    rejectUrl: `${doc.base}/${row.id}/reject`,
    rejectLabel: "Reject",
    linesUrl: `${doc.base}/${row.id}/lines`,
    ...extra,
  });
}

export function usePendingApprovals(user: SafeUser | null) {
  const canPurchasing = hasModule(user, "purchasing");
  const canInternalReq = hasModule(user, "internal-requisitions");
  const canHr = hasModule(user, "hr");
  const canLeave = hasModule(user, "leave");
  const canStaff = hasModule(user, "staff");
  const canPayroll = hasModule(user, "payroll");
  const canFinance = hasModule(user, "finance");

  const q = (key: string, url: string, enabled: boolean) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: ["approvals", key], queryFn: () => fetchJson<any[]>(url), enabled });

  const prQuery = q("purchase-requisitions", "/api/purchasing/requisitions", canPurchasing);
  const poQuery = q("purchase-orders", "/api/purchasing/orders", canPurchasing);
  const supplierQuery = q("suppliers", "/api/purchasing/suppliers", canPurchasing);
  const irQuery = q("internal-requisitions", "/api/internal-requisitions", canInternalReq);
  const tlrQuery = q("temporary-labor-requisitions", "/api/temporary-labor-requisitions", canHr);
  const leaveQuery = q("leave-requests", "/api/leave-requests", canLeave);
  const leaveTypeQuery = q("leave-types", "/api/leave-types", canLeave);
  const staffQuery = q("staff", "/api/staff", canLeave && canStaff);
  const payrollQuery = q("payroll-runs", "/api/payroll/runs", canPayroll);
  const voucherQuery = q("payment-vouchers", "/api/finance/payment-vouchers", canFinance);

  const suppliersById = new Map<number, string>((supplierQuery.data ?? []).map((s: any) => [s.id, s.name]));
  const staffById = new Map<number, string>((staffQuery.data ?? []).map((s: any) => [s.id, s.name]));
  const leaveTypeById = new Map<number, string>((leaveTypeQuery.data ?? []).map((t: any) => [t.id, t.name]));

  const items: ApprovalItem[] = [];

  for (const pr of prQuery.data ?? []) {
    pushReviewApprove(items, { kind: "purchase_requisition", category: "Purchasing", moduleLabel: "Purchase Requisition", base: "/api/purchasing/requisitions" }, pr, {
      number: pr.prNumber,
      title: pr.purpose,
      subtitle: `Requested by ${pr.requestedBy}${pr.department ? " · " + pr.department : ""} · ${pr.type === "direct" ? "Direct purchase" : "Stock"}`,
      needsPurchaseDetails: stageFor(pr.status) === "approve",
      prType: pr.type,
    });
  }

  for (const po of poQuery.data ?? []) {
    pushReviewApprove(items, { kind: "purchase_order", category: "Purchasing", moduleLabel: "Purchase Order", base: "/api/purchasing/orders" }, po, {
      number: po.poNumber,
      title: suppliersById.get(po.supplierId) ?? `Purchase Order ${po.poNumber}`,
      subtitle: `Raised by ${po.createdBy}${po.type ? " · " + (po.type === "direct" ? "Direct" : "Stock") : ""}`,
      amount: po.totalAmount,
    });
  }

  for (const ir of irQuery.data ?? []) {
    pushReviewApprove(items, { kind: "internal_requisition", category: "Internal Requisitions", moduleLabel: "Internal Requisition", base: "/api/internal-requisitions" }, ir, {
      number: ir.irNumber,
      title: ir.purpose,
      subtitle: `Requested by ${ir.requestedBy}${ir.department ? " · " + ir.department : ""}`,
    });
  }

  for (const tlr of tlrQuery.data ?? []) {
    pushReviewApprove(items, { kind: "temporary_labor_requisition", category: "Temporary Labour", moduleLabel: "Temporary Labour", base: "/api/temporary-labor-requisitions" }, tlr, {
      number: tlr.tlrNumber,
      title: tlr.purpose,
      subtitle: `Requested by ${tlr.requestedBy}`,
    });
  }

  for (const lr of leaveQuery.data ?? []) {
    const staffName = staffById.get(lr.staffId) ?? `Staff #${lr.staffId}`;
    const typeName = leaveTypeById.get(lr.leaveTypeId) ?? "Leave";
    pushReviewApprove(items, { kind: "leave_request", category: "Leave", moduleLabel: "Leave Request", base: "/api/leave-requests" }, lr, {
      number: `${typeName}`,
      title: `${staffName}: ${lr.startDate} → ${lr.endDate}`,
      subtitle: `${lr.days} day${lr.days === 1 ? "" : "s"}${lr.reason ? " · " + lr.reason : ""}`,
      linesUrl: undefined,
    });
  }

  // Payroll runs are single-stage: draft → approved (or cancelled).
  for (const run of payrollQuery.data ?? []) {
    if ((run.status ?? "").toLowerCase() !== "draft") continue;
    items.push({
      key: `payroll_run-${run.id}`,
      id: run.id,
      kind: "payroll_run",
      category: "Payroll",
      moduleLabel: "Payroll Run · Approval",
      number: run.runNumber ?? `Run #${run.id}`,
      title: `Payroll ${run.periodMonth ?? ""}`.trim(),
      subtitle: `Gross ${fmt(run.totalGross)} · Deductions ${fmt(run.totalDeductions)} · Employer cost ${fmt(run.totalEmployerCost)}`,
      amount: run.totalNet,
      date: run.createdAt ?? null,
      status: "pending_approval",
      stage: "approve",
      actionUrl: `/api/payroll/runs/${run.id}/approve`,
      actionLabel: "Approve & post",
      rejectUrl: `/api/payroll/runs/${run.id}/cancel`,
      rejectLabel: "Cancel run",
      linesUrl: `/api/payroll/runs/${run.id}/lines`,
    });
  }

  // Payment vouchers: anything not yet posted/cancelled is awaiting posting.
  for (const pv of voucherQuery.data ?? []) {
    const s = (pv.status ?? "").toLowerCase();
    if (s === "posted" || s === "cancelled") continue;
    items.push({
      key: `payment_voucher-${pv.id}`,
      id: pv.id,
      kind: "payment_voucher",
      category: "Payment Vouchers",
      moduleLabel: "Payment Voucher · Posting",
      number: pv.voucherNumber,
      title: pv.payeeName,
      subtitle: `${pv.description ?? ""}${pv.paymentMethod ? " · " + String(pv.paymentMethod).replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : ""}${pv.requestedBy ? " · by " + pv.requestedBy : ""}`.replace(/^ · /, ""),
      amount: pv.amount,
      date: pv.voucherDate ?? pv.createdAt ?? null,
      status: pv.status,
      stage: "post",
      actionUrl: `/api/finance/payment-vouchers/${pv.id}/post`,
      actionLabel: "Post payment",
      rejectUrl: `/api/finance/payment-vouchers/${pv.id}/cancel`,
      rejectLabel: "Cancel voucher",
    });
  }

  items.sort((a, b) => toMs(b.date) - toMs(a.date));

  const queries = [prQuery, poQuery, irQuery, tlrQuery, leaveQuery, payrollQuery, voucherQuery];
  const isLoading = queries.some((qq) => qq.isLoading && qq.fetchStatus !== "idle");
  const errors = queries.filter((qq) => qq.isError).length;

  const refetchAll = () =>
    Promise.all(
      [prQuery, poQuery, supplierQuery, irQuery, tlrQuery, leaveQuery, leaveTypeQuery, staffQuery, payrollQuery, voucherQuery]
        .filter((qq) => qq.fetchStatus !== "idle" || qq.data !== undefined || qq.isError)
        .map((qq) => qq.refetch()),
    );

  return { items, isLoading, refetchAll, errors, suppliers: supplierQuery.data ?? [] };
}

function fmt(n: unknown): string {
  const v = typeof n === "number" ? n : 0;
  return `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

export function extractApiError(err: any): string {
  const data = err?.response?.data;
  if (data && typeof data === "object" && typeof data.error === "string") return data.error;
  if (typeof data === "string" && data.length < 300) return data;
  return err?.message ?? "Something went wrong";
}

export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ url, body }: { url: string; body?: Record<string, unknown> }) => {
      const res = await api.post(url, body ?? {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["finance"] });
      queryClient.invalidateQueries({ queryKey: ["director"] });
    },
  });
}

export function useApprovalLines(url: string | undefined) {
  return useQuery({
    queryKey: ["approvals", "lines", url],
    queryFn: () => fetchJson<any[]>(url as string),
    enabled: !!url,
  });
}

export function useGlAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ["finance", "accounts"],
    queryFn: () => fetchJson<any[]>("/api/finance/accounts"),
    enabled,
    retry: false,
  });
}
