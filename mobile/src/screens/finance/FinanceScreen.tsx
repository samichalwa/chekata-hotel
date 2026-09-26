import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../../context/AuthContext";
import { hasModule } from "../../api/types";
import { extractApiError } from "../../api/approvals";
import {
  PERIOD_LABELS, PeriodKey, periodRange,
  useProfitLoss, useBalanceSheet, useTrialBalance, useBankAccounts, usePaymentVouchers, useBudgetVariance, useExpenses,
} from "../../api/finance";
import { Screen, Card, KpiCard, SectionTitle, StatusBadge, EmptyState } from "../../components/ui";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { formatDate, formatKes, titleCase } from "../../utils/format";

type Section = "overview" | "pnl" | "bs" | "cash" | "vouchers" | "budget" | "expenses" | "tb";
const SECTION_LABELS: Record<Section, string> = {
  overview: "Overview",
  pnl: "Profit & Loss",
  bs: "Balance Sheet",
  cash: "Cash & Bank",
  vouchers: "Payment Vouchers",
  budget: "Budget vs Actual",
  expenses: "Expenses",
  tb: "Trial Balance",
};

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function FinanceScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const canFinance = hasModule(user, "finance");
  const canBudget = hasModule(user, "budgeting");
  const canExpenses = hasModule(user, "expenses");

  const sections: Section[] = [
    "overview",
    ...(canFinance ? (["pnl", "bs", "cash", "vouchers"] as Section[]) : []),
    ...(canBudget ? (["budget"] as Section[]) : []),
    ...(canExpenses ? (["expenses"] as Section[]) : []),
    ...(canFinance ? (["tb"] as Section[]) : []),
  ];

  const [section, setSection] = useState<Section>("overview");
  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [refreshing, setRefreshing] = useState(false);
  const range = useMemo(() => periodRange(period), [period]);
  const asOf = useMemo(() => { const t = todayYmd(); return range.to < t ? range.to : t; }, [range.to]);

  const pnl = useProfitLoss(range.from, range.to, canFinance);
  const bs = useBalanceSheet(asOf, canFinance);
  const tb = useTrialBalance(asOf, canFinance);
  const banks = useBankAccounts(canFinance);
  const vouchers = usePaymentVouchers(canFinance);
  const budget = useBudgetVariance(range.fromMonth, range.toMonth, canBudget);
  const expenses = useExpenses(canExpenses);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const qs = [
        ...(canFinance ? [pnl, bs, tb, banks, vouchers] : []),
        ...(canBudget ? [budget] : []),
        ...(canExpenses ? [expenses] : []),
      ];
      await Promise.all(qs.map((q) => q.refetch()));
    } finally {
      setRefreshing(false);
    }
  }, [canFinance, canBudget, canExpenses, pnl, bs, tb, banks, vouchers, budget, expenses]);

  // Cash & bank: each bank account's ledger balance comes from its linked GL account.
  const tbById = new Map((tb.data ?? []).map((r) => [r.id, r]));
  const bankRows = (banks.data ?? []).map((b: any) => ({
    id: b.id,
    name: b.name,
    sub: [b.bankName, b.accountNumber].filter(Boolean).join(" · "),
    active: b.active !== 0,
    balance: tbById.get(b.glAccountId)?.balance ?? 0,
    glLabel: tbById.get(b.glAccountId) ? `${tbById.get(b.glAccountId)!.code} ${tbById.get(b.glAccountId)!.name}` : undefined,
  }));
  const cashTotal = bankRows.filter((b) => b.active).reduce((s, b) => s + b.balance, 0);

  const openVouchers = (vouchers.data ?? []).filter((v: any) => !["posted", "cancelled"].includes(String(v.status).toLowerCase()));
  const openVoucherValue = openVouchers.reduce((s: number, v: any) => s + (v.amount ?? 0), 0);

  const periodExpenses = (expenses.data ?? [])
    .filter((e: any) => typeof e.date === "string" && e.date >= range.from && e.date <= range.to)
    .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const periodExpenseTotal = periodExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);

  const budgetByStream = useMemo(() => {
    const m = new Map<string, { label: string; budgeted: number; actual: number }>();
    for (const r of budget.data ?? []) {
      const cur = m.get(r.incomeStreamCode) ?? { label: r.incomeStreamLabel, budgeted: 0, actual: 0 };
      cur.budgeted += r.budgetedAmount; cur.actual += r.actualAmount;
      m.set(r.incomeStreamCode, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.budgeted - a.budgeted);
  }, [budget.data]);
  const budgetTotals = budgetByStream.reduce((s, r) => ({ b: s.b + r.budgeted, a: s.a + r.actual }), { b: 0, a: 0 });

  const showsPeriod = section === "overview" || section === "pnl" || section === "budget" || section === "expenses";
  const showsAsOf = section === "bs" || section === "cash" || section === "tb";

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
        <Text style={styles.title}>Finance</Text>
        <Text style={styles.subtitle}>
          {section === "vouchers" ? "All payment vouchers, newest first" : showsAsOf ? `Balances as of ${formatDate(asOf)}` : `${PERIOD_LABELS[period]} · ${formatDate(range.from)} – ${formatDate(range.to)}`}
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {sections.map((s) => <Chip key={s} label={SECTION_LABELS[s]} active={section === s} onPress={() => setSection(s)} />)}
        </ScrollView>
        {showsPeriod || showsAsOf ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((p) => (
              <Chip key={p} small label={PERIOD_LABELS[p]} active={period === p} onPress={() => setPeriod(p)} />
            ))}
          </ScrollView>
        ) : null}

        {section === "overview" ? (
          <>
            {canFinance ? (
              <>
                <SectionTitle>Profit & loss</SectionTitle>
                <QueryState q={pnl} />
                <View style={styles.kpiGrid}>
                  <KpiCard label="Income" value={formatKes(pnl.data?.totalIncome)} />
                  <KpiCard label="Expenses" value={formatKes(pnl.data?.totalExpense)} />
                  <KpiCard label="Net profit" value={formatKes(pnl.data?.netProfit)} tone={(pnl.data?.netProfit ?? 0) < 0 ? "danger" : "default"} />
                  <KpiCard label="Net margin" value={pnl.data && pnl.data.totalIncome ? `${((pnl.data.netProfit / pnl.data.totalIncome) * 100).toFixed(1)}%` : "—"} />
                </View>
                <SectionTitle>Financial position</SectionTitle>
                <QueryState q={bs} />
                <View style={styles.kpiGrid}>
                  <KpiCard label="Cash & bank" value={formatKes(cashTotal)} tone={cashTotal < 0 ? "danger" : "default"} />
                  <KpiCard label="Total assets" value={formatKes(bs.data?.totalAssets)} />
                  <KpiCard label="Total liabilities" value={formatKes(bs.data?.totalLiabilities)} />
                  <KpiCard label="Total equity" value={formatKes(bs.data?.totalEquity)} />
                </View>
                <SectionTitle>Payments</SectionTitle>
                <Pressable onPress={() => navigation.navigate("Approvals")}>
                  <Card>
                    <Text style={styles.rowTitle}>{openVouchers.length} payment voucher{openVouchers.length === 1 ? "" : "s"} awaiting posting</Text>
                    <Text style={styles.rowSub}>{formatKes(openVoucherValue)} · tap to review in Approvals</Text>
                  </Card>
                </Pressable>
              </>
            ) : null}
            {canBudget ? (
              <>
                <SectionTitle>Budget vs actual (income)</SectionTitle>
                <QueryState q={budget} />
                <View style={styles.kpiGrid}>
                  <KpiCard label="Budgeted" value={formatKes(budgetTotals.b)} />
                  <KpiCard label="Actual" value={formatKes(budgetTotals.a)} />
                  <KpiCard label="Variance" value={formatKes(budgetTotals.a - budgetTotals.b)} tone={budgetTotals.a - budgetTotals.b < 0 ? "danger" : "default"} />
                  <KpiCard label="Achieved" value={budgetTotals.b ? `${((budgetTotals.a / budgetTotals.b) * 100).toFixed(1)}%` : "—"} />
                </View>
              </>
            ) : null}
            {canExpenses ? (
              <>
                <SectionTitle>Operating expenses</SectionTitle>
                <QueryState q={expenses} />
                <View style={styles.kpiGrid}>
                  <KpiCard label="Recorded this period" value={formatKes(periodExpenseTotal)} />
                  <KpiCard label="Entries" value={periodExpenses.length} />
                </View>
              </>
            ) : null}
            {!canFinance && !canBudget && !canExpenses ? (
              <EmptyState title="No finance access" subtitle="Ask an administrator to grant Finance, Budgeting or Expenses access." />
            ) : null}
          </>
        ) : null}

        {section === "pnl" ? (
          <>
            <QueryState q={pnl} />
            <StatementBlock title="Income" lines={(pnl.data?.income ?? []).map((l) => ({ key: l.accountId, label: `${l.code} ${l.name}`, amount: l.amount }))} total={pnl.data?.totalIncome} />
            <StatementBlock title="Expenses" lines={(pnl.data?.expense ?? []).map((l) => ({ key: l.accountId, label: `${l.code} ${l.name}`, amount: l.amount }))} total={pnl.data?.totalExpense} />
            <Card style={styles.totalCard}>
              <View style={styles.lineRow}>
                <Text style={styles.totalLabel}>Net profit</Text>
                <Text style={[styles.totalValue, (pnl.data?.netProfit ?? 0) < 0 && { color: colors.danger }]}>{formatKes(pnl.data?.netProfit)}</Text>
              </View>
            </Card>
          </>
        ) : null}

        {section === "bs" ? (
          <>
            <QueryState q={bs} />
            <StatementBlock title="Assets" lines={(bs.data?.assets ?? []).map((l, i) => ({ key: l.accountId ?? i, label: `${l.code} ${l.name}`, amount: l.balance }))} total={bs.data?.totalAssets} />
            <StatementBlock title="Liabilities" lines={(bs.data?.liabilities ?? []).map((l, i) => ({ key: l.accountId ?? i, label: `${l.code} ${l.name}`, amount: l.balance }))} total={bs.data?.totalLiabilities} />
            <StatementBlock
              title="Equity"
              lines={[
                ...(bs.data?.equity ?? []).map((l, i) => ({ key: l.accountId ?? i, label: `${l.code} ${l.name}`, amount: l.balance })),
                ...(bs.data ? [{ key: "re", label: "Retained earnings (current profit)", amount: bs.data.totalEquity - (bs.data.equity ?? []).reduce((s, l) => s + l.balance, 0) }] : []),
              ]}
              total={bs.data?.totalEquity}
            />
            <Card style={styles.totalCard}>
              <View style={styles.lineRow}>
                <Text style={styles.totalLabel}>Liabilities + equity</Text>
                <Text style={styles.totalValue}>{formatKes(bs.data?.totalLiabilitiesAndEquity)}</Text>
              </View>
              {bs.data && Math.abs(bs.data.totalAssets - bs.data.totalLiabilitiesAndEquity) > 0.5 ? (
                <Text style={styles.errorText}>Out of balance by {formatKes(bs.data.totalAssets - bs.data.totalLiabilitiesAndEquity)}</Text>
              ) : bs.data ? <Text style={styles.okText}>Balanced</Text> : null}
            </Card>
          </>
        ) : null}

        {section === "cash" ? (
          <>
            <QueryState q={banks} />
            <QueryState q={tb} />
            <Card style={styles.totalCard}>
              <View style={styles.lineRow}>
                <Text style={styles.totalLabel}>Total cash & bank</Text>
                <Text style={[styles.totalValue, cashTotal < 0 && { color: colors.danger }]}>{formatKes(cashTotal)}</Text>
              </View>
            </Card>
            {bankRows.length === 0 && !banks.isLoading ? <EmptyState title="No bank accounts" subtitle="Add bank accounts in Finance on the web app." /> : null}
            {bankRows.map((b) => (
              <Card key={b.id} style={styles.rowCard}>
                <View style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{b.name}{b.active ? "" : " (inactive)"}</Text>
                    {b.sub ? <Text style={styles.rowSub}>{b.sub}</Text> : null}
                    {b.glLabel ? <Text style={styles.rowSub}>Ledger: {b.glLabel}</Text> : null}
                  </View>
                  <Text style={[styles.amount, b.balance < 0 && { color: colors.danger }]}>{formatKes(b.balance)}</Text>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {section === "vouchers" ? (
          <>
            <QueryState q={vouchers} />
            {(vouchers.data ?? []).length === 0 && !vouchers.isLoading ? <EmptyState title="No payment vouchers" /> : null}
            {[...(vouchers.data ?? [])]
              .sort((a: any, b: any) => String(b.voucherDate ?? "").localeCompare(String(a.voucherDate ?? "")))
              .map((v: any) => (
                <Card key={v.id} style={styles.rowCard}>
                  <View style={styles.headRow}>
                    <Text style={styles.rowLabel}>{v.voucherNumber}</Text>
                    <StatusBadge status={v.status} />
                  </View>
                  <View style={styles.lineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{v.payeeName}</Text>
                      <Text style={styles.rowSub}>{[formatDate(v.voucherDate), v.paymentMethod ? titleCase(v.paymentMethod) : null, v.paymentReference].filter(Boolean).join(" · ")}</Text>
                      {v.description ? <Text style={styles.rowSub}>{v.description}</Text> : null}
                    </View>
                    <Text style={styles.amount}>{formatKes(v.amount)}</Text>
                  </View>
                </Card>
              ))}
          </>
        ) : null}

        {section === "budget" ? (
          <>
            <QueryState q={budget} />
            {budgetByStream.length === 0 && !budget.isLoading ? <EmptyState title="No budget lines for this period" subtitle="Set budgets in Budgeting on the web app." /> : null}
            {budgetByStream.map((r) => {
              const pct = r.budgeted ? Math.min(100, Math.max(0, (r.actual / r.budgeted) * 100)) : 0;
              const variance = r.actual - r.budgeted;
              return (
                <Card key={r.label} style={styles.rowCard}>
                  <View style={styles.lineRow}>
                    <Text style={[styles.rowTitle, { flex: 1 }]}>{r.label}</Text>
                    <Text style={[styles.amount, { color: variance < 0 ? colors.danger : colors.success }]}>{variance >= 0 ? "+" : ""}{formatKes(variance)}</Text>
                  </View>
                  <Text style={styles.rowSub}>Actual {formatKes(r.actual)} of {formatKes(r.budgeted)} budget{r.budgeted ? ` · ${((r.actual / r.budgeted) * 100).toFixed(1)}%` : ""}</Text>
                  <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
                </Card>
              );
            })}
            {budgetByStream.length ? (
              <Card style={styles.totalCard}>
                <View style={styles.lineRow}>
                  <Text style={styles.totalLabel}>Total variance</Text>
                  <Text style={[styles.totalValue, { color: budgetTotals.a - budgetTotals.b < 0 ? colors.danger : colors.success }]}>{formatKes(budgetTotals.a - budgetTotals.b)}</Text>
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        {section === "expenses" ? (
          <>
            <QueryState q={expenses} />
            <Card style={styles.totalCard}>
              <View style={styles.lineRow}>
                <Text style={styles.totalLabel}>{periodExpenses.length} expense{periodExpenses.length === 1 ? "" : "s"}</Text>
                <Text style={styles.totalValue}>{formatKes(periodExpenseTotal)}</Text>
              </View>
            </Card>
            {periodExpenses.length === 0 && !expenses.isLoading ? <EmptyState title="No expenses in this period" /> : null}
            {periodExpenses.slice(0, 100).map((e: any) => (
              <Card key={e.id} style={styles.rowCard}>
                <View style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{e.description}</Text>
                    <Text style={styles.rowSub}>{[formatDate(e.date), e.category ? titleCase(e.category) : null, e.paidTo].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <Text style={styles.amount}>{formatKes(e.amount)}</Text>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {section === "tb" ? (
          <>
            <QueryState q={tb} />
            <Card>
              <View style={[styles.lineRow, styles.tbHead]}>
                <Text style={[styles.tbCell, { flex: 1 }]}>Account</Text>
                <Text style={[styles.tbCell, styles.tbNum]}>Debit</Text>
                <Text style={[styles.tbCell, styles.tbNum]}>Credit</Text>
              </View>
              {(tb.data ?? []).filter((r) => r.totalDebit || r.totalCredit).map((r) => (
                <View key={r.id} style={styles.tbRow}>
                  <Text style={[styles.tbText, { flex: 1 }]} numberOfLines={2}>{r.code} {r.name}</Text>
                  <Text style={[styles.tbText, styles.tbNum]}>{r.balance > 0 ? fmtNum(r.balance) : ""}</Text>
                  <Text style={[styles.tbText, styles.tbNum]}>{r.balance < 0 ? fmtNum(-r.balance) : ""}</Text>
                </View>
              ))}
              {tb.data ? (() => {
                const dr = tb.data.reduce((s, r) => s + (r.balance > 0 ? r.balance : 0), 0);
                const cr = tb.data.reduce((s, r) => s + (r.balance < 0 ? -r.balance : 0), 0);
                return (
                  <>
                    <View style={[styles.tbRow, { borderBottomWidth: 0 }]}>
                      <Text style={[styles.tbText, { flex: 1, fontWeight: "700" }]}>Total</Text>
                      <Text style={[styles.tbText, styles.tbNum, { fontWeight: "700" }]}>{fmtNum(dr)}</Text>
                      <Text style={[styles.tbText, styles.tbNum, { fontWeight: "700" }]}>{fmtNum(cr)}</Text>
                    </View>
                    {Math.abs(dr - cr) > 0.5 ? <Text style={styles.errorText}>Out of balance by {formatKes(dr - cr)}</Text> : <Text style={styles.okText}>Debits equal credits</Text>}
                  </>
                );
              })() : null}
            </Card>
            <Text style={styles.footnote}>Amounts in KES. Accounts with no activity are hidden.</Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function fmtNum(n: number) {
  return n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function Chip({ label, active, onPress, small }: { label: string; active: boolean; onPress: () => void; small?: boolean }) {
  return (
    <Pressable style={[styles.chip, small && styles.chipSmall, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function QueryState({ q }: { q: { isLoading: boolean; isError: boolean; error: unknown } }) {
  if (q.isLoading) return <Text style={styles.loading}>Loading…</Text>;
  if (q.isError) return <Text style={styles.errorText}>{extractApiError(q.error)}</Text>;
  return null;
}

function StatementBlock({ title, lines, total }: { title: string; lines: { key: string | number; label: string; amount: number }[]; total?: number }) {
  const shown = lines.filter((l) => Math.abs(l.amount) > 0.005);
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        {shown.length === 0 ? <Text style={styles.rowSub}>No activity.</Text> : null}
        {shown.map((l) => (
          <View key={l.key} style={styles.stmtRow}>
            <Text style={styles.stmtLabel} numberOfLines={2}>{l.label}</Text>
            <Text style={[styles.stmtAmount, l.amount < 0 && { color: colors.danger }]}>{formatKes(l.amount)}</Text>
          </View>
        ))}
        <View style={[styles.stmtRow, { borderBottomWidth: 0, paddingTop: spacing.sm }]}>
          <Text style={[styles.stmtLabel, { fontWeight: "700" }]}>Total {title.toLowerCase()}</Text>
          <Text style={[styles.stmtAmount, { fontWeight: "700" }]}>{formatKes(total)}</Text>
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  chipRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingRight: spacing.md },
  chip: { paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  chipSmall: { paddingVertical: 6 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.small, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: colors.primaryForeground },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  loading: { ...typography.small, color: colors.textMuted, marginBottom: spacing.sm },
  errorText: { ...typography.small, color: colors.danger, marginVertical: spacing.xs },
  okText: { ...typography.small, color: colors.success, marginTop: spacing.xs },
  rowCard: { marginBottom: spacing.sm },
  totalCard: { marginTop: spacing.md, marginBottom: spacing.sm },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: spacing.sm },
  lineRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowLabel: { ...typography.label, color: colors.primary },
  rowTitle: { ...typography.h3, color: colors.text },
  rowSub: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  amount: { ...typography.body, fontWeight: "700", color: colors.text },
  totalLabel: { ...typography.h3, color: colors.text, flex: 1 },
  totalValue: { ...typography.h2, color: colors.text },
  stmtRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: "center" },
  stmtLabel: { ...typography.small, color: colors.text, flex: 1 },
  stmtAmount: { ...typography.small, color: colors.text, fontWeight: "600" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginTop: spacing.sm, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.primary },
  tbHead: { paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  tbCell: { ...typography.label, color: colors.textMuted },
  tbNum: { width: 92, textAlign: "right" },
  tbRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: "center" },
  tbText: { ...typography.small, color: colors.text },
  footnote: { ...typography.small, color: colors.textMuted, marginTop: spacing.sm },
});
