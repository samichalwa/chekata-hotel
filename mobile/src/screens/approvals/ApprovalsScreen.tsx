import React, { useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, Modal, TextInput, RefreshControl, Pressable, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { hasModule } from "../../api/types";
import {
  usePendingApprovals,
  useDecideApproval,
  useApprovalLines,
  useGlAccounts,
  extractApiError,
  ApprovalItem,
} from "../../api/approvals";
import { Screen, Card, StatusBadge, PrimaryButton, EmptyState, CenteredSpinner } from "../../components/ui";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { formatDate, formatKes } from "../../utils/format";

type Notice = { tone: "success" | "error"; text: string } | null;

export default function ApprovalsScreen() {
  const { user } = useAuth();
  const { items, isLoading, refetchAll, errors, suppliers } = usePendingApprovals(user);
  const decide = useDecideApproval();
  const [rejecting, setRejecting] = useState<ApprovalItem | null>(null);
  const [reason, setReason] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [details, setDetails] = useState<ApprovalItem | null>(null);
  const [prApproving, setPrApproving] = useState<ApprovalItem | null>(null);

  const categories = Array.from(new Set(items.map((item) => item.category)));
  const categoryCounts = categories.map((category) => ({ category, count: items.filter((i) => i.category === category).length }));
  const visibleItems = activeCategory ? items.filter((i) => i.category === activeCategory) : items;
  const reviewCount = items.filter((i) => i.stage === "review").length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setRefreshing(false);
    }
  }, [refetchAll]);

  const runAction = async (item: ApprovalItem, body?: Record<string, unknown>) => {
    setActingKey(item.key);
    setItemErrors((e) => ({ ...e, [item.key]: "" }));
    try {
      await decide.mutateAsync({ url: item.actionUrl, body });
      setNotice({ tone: "success", text: `${item.number}: ${item.stage === "review" ? "reviewed and sent for approval" : item.stage === "post" ? "posted to the ledger" : "approved"}.` });
      return true;
    } catch (err: any) {
      const msg = extractApiError(err);
      setItemErrors((e) => ({ ...e, [item.key]: msg }));
      return msg;
    } finally {
      setActingKey(null);
    }
  };

  const onPrimary = (item: ApprovalItem) => {
    if (item.needsPurchaseDetails) {
      setModalError(null);
      setPrApproving(item);
      return;
    }
    runAction(item);
  };

  const openReject = (item: ApprovalItem) => {
    setReason("");
    setModalError(null);
    setRejecting(item);
  };

  const confirmReject = async () => {
    if (!rejecting?.rejectUrl) return;
    if (!reason.trim()) {
      setModalError("A reason is required.");
      return;
    }
    setActingKey(rejecting.key);
    try {
      await decide.mutateAsync({ url: rejecting.rejectUrl, body: { reason: reason.trim() } });
      setNotice({ tone: "success", text: `${rejecting.number}: ${rejecting.rejectLabel === "Reject" ? "rejected" : "cancelled"}.` });
      setRejecting(null);
    } catch (err: any) {
      setModalError(extractApiError(err));
    } finally {
      setActingKey(null);
    }
  };

  if (isLoading && items.length === 0) return <CenteredSpinner />;

  return (
    <Screen>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Approvals</Text>
            <Text style={styles.headerSubtitle}>
              {items.length} item{items.length === 1 ? "" : "s"} awaiting a decision
              {reviewCount ? ` · ${reviewCount} at review stage` : ""}
            </Text>
            {notice ? (
              <Pressable onPress={() => setNotice(null)} style={[styles.notice, notice.tone === "error" ? styles.noticeError : styles.noticeSuccess]}>
                <Text style={[styles.noticeText, { color: notice.tone === "error" ? colors.danger : colors.success }]}>{notice.text}</Text>
              </Pressable>
            ) : null}
            {errors > 0 ? (
              <Text style={styles.loadWarning}>Some lists couldn't be loaded. Pull down to retry.</Text>
            ) : null}
            {categoryCounts.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryFilterRow}>
                <Chip label={`All · ${items.length}`} active={activeCategory === null} onPress={() => setActiveCategory(null)} />
                {categoryCounts.map(({ category, count }) => (
                  <Chip key={category} label={`${category} · ${count}`} active={activeCategory === category} onPress={() => setActiveCategory(category)} />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={activeCategory ? `No ${activeCategory.toLowerCase()} items` : "All caught up"}
            subtitle={activeCategory ? "Nothing in this category needs a decision right now." : "Nothing is waiting on review, approval or posting right now."}
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <View style={styles.itemHeaderRow}>
              <Text style={styles.moduleLabel} numberOfLines={1}>{item.moduleLabel}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {item.subtitle ? <Text style={styles.itemSubtitle}>{item.subtitle}</Text> : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{item.number}</Text>
              <Text style={styles.metaText}>{formatDate(item.date)}</Text>
              {typeof item.amount === "number" ? <Text style={styles.metaAmount}>{formatKes(item.amount)}</Text> : null}
            </View>
            {item.linesUrl ? (
              <Pressable onPress={() => setDetails(item)} hitSlop={8} style={styles.detailsLink}>
                <Text style={styles.detailsLinkText}>View line items ›</Text>
              </Pressable>
            ) : null}
            {itemErrors[item.key] ? <Text style={styles.itemError}>{itemErrors[item.key]}</Text> : null}
            <View style={styles.actionRow}>
              <View style={styles.actionButtonFlex}>
                <PrimaryButton label={item.actionLabel} onPress={() => onPrimary(item)} loading={actingKey === item.key && decide.isPending && !rejecting} />
              </View>
              {item.rejectUrl ? (
                <View style={styles.actionButtonFlex}>
                  <PrimaryButton label={item.rejectLabel ?? "Reject"} tone="outline" onPress={() => openReject(item)} />
                </View>
              ) : null}
            </View>
          </Card>
        )}
      />

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{rejecting?.rejectLabel ?? "Reject"} {rejecting?.number}</Text>
            <Text style={styles.modalSubtitle}>Give a reason so the requester knows why.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason (required)"
              placeholderTextColor={colors.textMuted}
              value={reason}
              onChangeText={(t) => { setReason(t); setModalError(null); }}
              multiline
            />
            {modalError ? <Text style={styles.itemError}>{modalError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setRejecting(null)}>
                <Text style={styles.modalCancelText}>Back</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <PrimaryButton label={`Confirm ${(rejecting?.rejectLabel ?? "reject").toLowerCase()}`} tone="danger" onPress={confirmReject} loading={decide.isPending} disabled={!reason.trim()} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <LinesModal item={details} onClose={() => setDetails(null)} canInventory={hasModule(user, "inventory") || hasModule(user, "purchasing") || hasModule(user, "internal-requisitions")} canStaff={hasModule(user, "staff")} />

      <PrApproveModal
        item={prApproving}
        suppliers={suppliers}
        canFinance={hasModule(user, "finance")}
        submitting={decide.isPending}
        error={modalError}
        onClose={() => setPrApproving(null)}
        onSubmit={async (body) => {
          if (!prApproving) return;
          const res = await runAction(prApproving, body);
          if (res === true) setPrApproving(null);
          else setModalError(res as string);
        }}
      />
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.categoryFilterChip, active && styles.categoryFilterChipActive]} onPress={onPress}>
      <Text style={[styles.categoryFilterText, active && styles.categoryFilterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function LinesModal({ item, onClose, canInventory, canStaff }: { item: ApprovalItem | null; onClose: () => void; canInventory: boolean; canStaff: boolean }) {
  const lines = useApprovalLines(item?.linesUrl);
  const needItems = item?.kind === "internal_requisition";
  const needStaff = item?.kind === "payroll_run";
  const itemsQuery = useQuery({
    queryKey: ["approvals", "inventory-items"],
    queryFn: async () => (await api.get<any[]>("/api/inventory/items")).data,
    enabled: !!item && needItems && canInventory,
  });
  const staffQuery = useQuery({
    queryKey: ["approvals", "staff"],
    queryFn: async () => (await api.get<any[]>("/api/staff")).data,
    enabled: !!item && needStaff && canStaff,
  });
  const itemName = new Map<number, string>((itemsQuery.data ?? []).map((i: any) => [i.id, i.name]));
  const staffName = new Map<number, string>((staffQuery.data ?? []).map((s: any) => [s.id, s.name]));

  const rows: { title: string; detail: string; amount?: number }[] = (lines.data ?? []).map((l: any) => {
    switch (item?.kind) {
      case "purchase_requisition":
        return { title: l.description, detail: `${l.quantity} ${l.unitOfMeasure ?? ""} × ${formatKes(l.estimatedUnitCost)} (est.)`, amount: (l.quantity ?? 0) * (l.estimatedUnitCost ?? 0) };
      case "purchase_order":
        return { title: l.description, detail: `${l.quantity} ${l.unitOfMeasure ?? ""} × ${formatKes(l.unitCost)}`, amount: l.lineTotal };
      case "internal_requisition":
        return { title: itemName.get(l.itemId) ?? `Item #${l.itemId}`, detail: `Qty requested ${l.quantityRequested}${l.notes ? " · " + l.notes : ""}` };
      case "temporary_labor_requisition":
        return { title: l.role, detail: `${l.headcount} × ${l.durationValue} ${l.durationUnit}${l.dateNeeded ? " · from " + l.dateNeeded : ""}${l.notes ? " · " + l.notes : ""}` };
      case "payroll_run":
        return { title: staffName.get(l.staffId) ?? `Staff #${l.staffId}`, detail: `Gross ${formatKes(l.grossPay)} · Deductions ${formatKes(l.totalDeductions)}`, amount: l.netPay };
      default:
        return { title: String(l.description ?? l.id), detail: "" };
    }
  });
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const hasAmounts = rows.some((r) => typeof r.amount === "number");

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { maxHeight: "85%" }]}>
          <Text style={styles.modalTitle}>{item?.number}</Text>
          <Text style={styles.modalSubtitle}>{item?.title}</Text>
          {lines.isLoading ? (
            <Text style={styles.metaText}>Loading…</Text>
          ) : lines.isError ? (
            <Text style={styles.itemError}>{extractApiError(lines.error)}</Text>
          ) : rows.length === 0 ? (
            <Text style={styles.metaText}>No line items.</Text>
          ) : (
            <ScrollView style={{ marginBottom: spacing.md }}>
              {rows.map((r, idx) => (
                <View key={idx} style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineTitle}>{r.title}</Text>
                    {r.detail ? <Text style={styles.metaText}>{r.detail}</Text> : null}
                  </View>
                  {typeof r.amount === "number" ? <Text style={styles.metaAmount}>{formatKes(r.amount)}</Text> : null}
                </View>
              ))}
              {hasAmounts ? (
                <View style={[styles.lineRow, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.lineTitle, { flex: 1 }]}>{item?.kind === "payroll_run" ? "Total net pay" : "Total"}</Text>
                  <Text style={styles.metaAmount}>{formatKes(total)}</Text>
                </View>
              ) : null}
            </ScrollView>
          )}
          <PrimaryButton label="Close" tone="outline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function OptionList({ label, options, value, onChange }: { label: string; options: { id: number; label: string }[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {options.length === 0 ? (
        <Text style={styles.metaText}>No options available.</Text>
      ) : (
        <ScrollView style={styles.optionBox} nestedScrollEnabled>
          {options.map((o) => (
            <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.optionRow, value === o.id && styles.optionRowActive]}>
              <Text style={[styles.optionText, value === o.id && { color: colors.primaryForeground }]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function PrApproveModal({
  item, suppliers, canFinance, submitting, error, onClose, onSubmit,
}: {
  item: ApprovalItem | null; suppliers: any[]; canFinance: boolean; submitting: boolean; error: string | null;
  onClose: () => void; onSubmit: (body: Record<string, unknown>) => void;
}) {
  const accountsQuery = useGlAccounts(!!item && canFinance);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [payableId, setPayableId] = useState<number | null>(null);
  const [expenseId, setExpenseId] = useState<number | null>(null);
  const isDirect = item?.prType === "direct";
  const accounts = accountsQuery.data ?? [];
  const canSubmit = !!supplierId && !!payableId && (!isDirect || !!expenseId);

  React.useEffect(() => {
    setSupplierId(null); setPayableId(null); setExpenseId(null);
  }, [item?.key]);

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { maxHeight: "90%" }]}>
          <ScrollView>
            <Text style={styles.modalTitle}>Approve {item?.number}</Text>
            <Text style={styles.modalSubtitle}>Approving raises a purchase order. Choose the supplier and accounts it posts to.</Text>
            <OptionList label="Supplier" value={supplierId} onChange={setSupplierId}
              options={suppliers.filter((s: any) => s.active !== 0).map((s: any) => ({ id: s.id, label: s.name }))} />
            {!canFinance ? (
              <Text style={styles.itemError}>Selecting the payable account needs Finance access. Ask an administrator, or approve this one on the web app.</Text>
            ) : accountsQuery.isError ? (
              <Text style={styles.itemError}>{extractApiError(accountsQuery.error)}</Text>
            ) : (
              <>
                <OptionList label="Payable account (liability)" value={payableId} onChange={setPayableId}
                  options={accounts.filter((a: any) => a.type === "liability").map((a: any) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} />
                {isDirect ? (
                  <OptionList label="Expense account" value={expenseId} onChange={setExpenseId}
                    options={accounts.filter((a: any) => a.type === "expense").map((a: any) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} />
                ) : null}
              </>
            )}
            {error ? <Text style={styles.itemError}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>Back</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Approve & raise PO" loading={submitting} disabled={!canSubmit}
                  onPress={() => onSubmit({ supplierId, payableAccountId: payableId, expenseAccountId: isDirect ? expenseId : undefined })} />
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { marginBottom: spacing.md },
  headerTitle: { ...typography.h1, color: colors.text },
  headerSubtitle: { ...typography.body, color: colors.textMuted, marginTop: 2 },
  notice: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  noticeSuccess: { backgroundColor: colors.successBg, borderColor: colors.success },
  noticeError: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  noticeText: { ...typography.small, fontWeight: "600" },
  loadWarning: { ...typography.small, color: colors.warning, marginTop: spacing.sm },
  categoryFilterRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingRight: spacing.md },
  categoryFilterChip: { paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  categoryFilterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryFilterText: { ...typography.small, color: colors.text, fontWeight: "600" },
  categoryFilterTextActive: { color: colors.primaryForeground },
  itemCard: { marginBottom: spacing.md },
  itemHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: spacing.sm },
  moduleLabel: { ...typography.label, color: colors.primary, flexShrink: 1 },
  itemTitle: { ...typography.h3, color: colors.text, marginBottom: 2 },
  itemSubtitle: { ...typography.small, color: colors.textMuted, marginBottom: spacing.sm },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  metaText: { ...typography.small, color: colors.textMuted },
  metaAmount: { ...typography.small, color: colors.text, fontWeight: "700" },
  detailsLink: { alignSelf: "flex-start", marginBottom: spacing.sm },
  detailsLinkText: { ...typography.small, color: colors.primary, fontWeight: "700" },
  itemError: { ...typography.small, color: colors.danger, marginBottom: spacing.sm },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  actionButtonFlex: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.md },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", maxWidth: 520, alignSelf: "center" },
  modalTitle: { ...typography.h3, color: colors.text },
  modalSubtitle: { ...typography.small, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 80, textAlignVertical: "top", color: colors.text, marginBottom: spacing.sm },
  modalActions: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.sm },
  modalCancel: { paddingVertical: 12, paddingHorizontal: spacing.md },
  modalCancelText: { color: colors.textMuted, fontWeight: "600" },
  lineRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: "flex-start" },
  lineTitle: { ...typography.body, color: colors.text, fontWeight: "600" },
  fieldLabel: { ...typography.label, color: colors.text, marginBottom: 6 },
  optionBox: { maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  optionRow: { paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionRowActive: { backgroundColor: colors.primary },
  optionText: { ...typography.small, color: colors.text },
});
