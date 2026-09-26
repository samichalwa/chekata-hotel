import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await api.get<T>(url);
  return res.data;
}

export interface PnlLine { accountId: number; code: string; name: string; amount: number }
export interface ProfitLoss { income: PnlLine[]; expense: PnlLine[]; totalIncome: number; totalExpense: number; netProfit: number }
export interface BsLine { accountId?: number; id?: number; code: string; name: string; balance: number }
export interface BalanceSheet {
  assets: BsLine[]; liabilities: BsLine[]; equity: BsLine[];
  totalAssets: number; totalLiabilities: number; totalEquity: number; totalLiabilitiesAndEquity: number;
  retainedEarnings?: number;
}
export interface TrialBalanceRow { id: number; code: string; name: string; type: string; totalDebit: number; totalCredit: number; balance: number }
export interface BudgetVarianceRow { month: string; incomeStreamCode: string; incomeStreamLabel: string; budgetedAmount: number; actualAmount: number; variance: number }

export type PeriodKey = "this_month" | "last_month" | "quarter" | "ytd";
export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: "This month",
  last_month: "Last month",
  quarter: "This quarter",
  ytd: "Year to date",
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function periodRange(key: PeriodKey, now = new Date()): { from: string; to: string; fromMonth: string; toMonth: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  let start: Date;
  let end: Date;
  if (key === "last_month") { start = new Date(y, m - 1, 1); end = new Date(y, m, 0); }
  else if (key === "quarter") { const qs = Math.floor(m / 3) * 3; start = new Date(y, qs, 1); end = new Date(y, m + 1, 0); }
  else if (key === "ytd") { start = new Date(y, 0, 1); end = new Date(y, m + 1, 0); }
  else { start = new Date(y, m, 1); end = new Date(y, m + 1, 0); }
  return { from: ymd(start), to: ymd(end), fromMonth: ymd(start).slice(0, 7), toMonth: ymd(end).slice(0, 7) };
}

export function useProfitLoss(from: string, to: string, enabled: boolean) {
  return useQuery({ queryKey: ["finance", "pnl", from, to], queryFn: () => fetchJson<ProfitLoss>(`/api/finance/reports/profit-loss?from=${from}&to=${to}`), enabled });
}
export function useBalanceSheet(asOf: string, enabled: boolean) {
  return useQuery({ queryKey: ["finance", "bs", asOf], queryFn: () => fetchJson<BalanceSheet>(`/api/finance/reports/balance-sheet?asOf=${asOf}`), enabled });
}
export function useTrialBalance(asOf: string, enabled: boolean) {
  return useQuery({ queryKey: ["finance", "tb", asOf], queryFn: () => fetchJson<TrialBalanceRow[]>(`/api/finance/reports/trial-balance?asOf=${asOf}`), enabled });
}
export function useBankAccounts(enabled: boolean) {
  return useQuery({ queryKey: ["finance", "bank-accounts"], queryFn: () => fetchJson<any[]>("/api/finance/bank-accounts"), enabled });
}
export function usePaymentVouchers(enabled: boolean) {
  return useQuery({ queryKey: ["finance", "payment-vouchers"], queryFn: () => fetchJson<any[]>("/api/finance/payment-vouchers"), enabled });
}
export function useBudgetVariance(fromMonth: string, toMonth: string, enabled: boolean) {
  return useQuery({
    queryKey: ["finance", "budget-variance", fromMonth, toMonth],
    queryFn: () => fetchJson<BudgetVarianceRow[]>(`/api/budget-lines/variance?from=${fromMonth}&to=${toMonth}`),
    enabled,
  });
}
export function useExpenses(enabled: boolean) {
  return useQuery({ queryKey: ["finance", "expenses"], queryFn: () => fetchJson<any[]>("/api/expenses"), enabled });
}
