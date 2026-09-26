import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Modal, TextInput, ScrollView, Pressable } from "react-native";
import { Screen, BackHeader, Card, StatusBadge, PrimaryButton, EmptyState, CenteredSpinner } from "../../components/ui";
import { BookingsTabBar } from "./BookingsTabBar";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { formatKes } from "../../utils/format";
import { useTables, useOrders, useMenuItems, useOrderItems, useCreateOrder, useAddOrderItem } from "../../api/bookings";

export default function BarRestaurantScreen() {
  const tablesQuery = useTables();
  const ordersQuery = useOrders();
  const menuQuery = useMenuItems();
  const createOrder = useCreateOrder();
  const addItem = useAddOrderItem();

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [outlet, setOutlet] = useState<"bar" | "restaurant">("restaurant");
  const [tableRef, setTableRef] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const orderItemsQuery = useOrderItems(activeOrderId);

  const openOrders = useMemo(() => (ordersQuery.data ?? []).filter((o: any) => o.status === "open"), [ordersQuery.data]);
  const activeMenu = useMemo(() => (menuQuery.data ?? []).filter((m: any) => m.active), [menuQuery.data]);
  const activeOrder = useMemo(() => (ordersQuery.data ?? []).find((o: any) => o.id === activeOrderId), [ordersQuery.data, activeOrderId]);

  const resetNewOrderForm = () => {
    setOutlet("restaurant");
    setTableRef("");
    setCustomerName("");
    setError(null);
  };

  const submitNewOrder = async () => {
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const created = await createOrder.mutateAsync({
        outlet,
        reference: tableRef.trim() || undefined,
        customerName: customerName.trim() || undefined,
        orderDate: today,
        status: "open",
        totalAmount: 0,
      });
      setShowNewOrder(false);
      resetNewOrderForm();
      setActiveOrderId(created.id);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to open order.");
    }
  };

  const addMenuItem = async (menuItem: any) => {
    if (!activeOrderId) return;
    await addItem.mutateAsync({
      orderId: activeOrderId,
      menuItemId: menuItem.id,
      itemName: menuItem.name,
      price: menuItem.price,
      quantity: 1,
      subtotal: menuItem.price,
    });
  };

  if (tablesQuery.isLoading || ordersQuery.isLoading || menuQuery.isLoading) return <CenteredSpinner />;

  const orderTotal = (orderItemsQuery.data ?? []).reduce((sum: number, i: any) => sum + (i.subtotal ?? 0), 0);

  return (
    <Screen>
      <BackHeader />
      <BookingsTabBar />
      {/* Plain sibling header, not FlatList's ListHeaderComponent — a header
          row hosted inside a virtualized list can have its first tap
          swallowed while the list finishes measuring. */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Bar & Restaurant</Text>
            <Text style={styles.subtitle}>{(tablesQuery.data ?? []).length} table(s) · {openOrders.length} open order(s)</Text>
          </View>
          <PrimaryButton label="New order" onPress={() => setShowNewOrder(true)} />
        </View>
      </View>
      <FlatList
        data={openOrders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title="No open orders" subtitle="Start a new order for a table or bar tab." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => setActiveOrderId(item.id)}>
            <Card style={styles.itemCard}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.orderTitle}>{item.reference ? `Table ${item.reference}` : item.outlet === "bar" ? "Bar tab" : "Restaurant order"}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.metaText}>{item.customerName ?? "Walk-in"}</Text>
              <Text style={styles.totalText}>{formatKes(item.totalAmount)}</Text>
            </Card>
          </Pressable>
        )}
      />

      {/* New order sheet */}
      <Modal visible={showNewOrder} transparent animationType="slide" onRequestClose={() => setShowNewOrder(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>New Order</Text>

              <Text style={styles.fieldLabel}>Outlet</Text>
              <View style={styles.outletRow}>
                {(["restaurant", "bar"] as const).map((o) => (
                  <Pressable key={o} onPress={() => setOutlet(o)} style={[styles.outletChip, outlet === o && styles.outletChipSelected]}>
                    <Text style={[styles.outletChipText, outlet === o && styles.outletChipTextSelected]}>{o === "restaurant" ? "Restaurant" : "Bar"}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Table / reference (optional)</Text>
              <TextInput style={styles.input} value={tableRef} onChangeText={setTableRef} placeholder="e.g. Table 4" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Customer name (optional)</Text>
              <TextInput style={styles.input} value={customerName} onChangeText={setCustomerName} placeholder="Walk-in" placeholderTextColor={colors.textMuted} />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancel}
                  onPress={() => {
                    setShowNewOrder(false);
                    resetNewOrderForm();
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <PrimaryButton label="Open order" onPress={submitNewOrder} loading={createOrder.isPending} />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Order detail / add items sheet */}
      <Modal visible={!!activeOrderId} transparent animationType="slide" onRequestClose={() => setActiveOrderId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>
                {activeOrder?.reference ? `Table ${activeOrder.reference}` : "Order"}
              </Text>
              <Text style={styles.modalSubtitle}>{activeOrder?.customerName ?? "Walk-in"}</Text>

              <Text style={styles.sectionLabel}>Items</Text>
              {(orderItemsQuery.data ?? []).length === 0 ? (
                <Text style={styles.metaText}>No items added yet.</Text>
              ) : (
                (orderItemsQuery.data ?? []).map((item: any) => (
                  <View key={item.id} style={styles.orderItemRow}>
                    <Text style={styles.orderItemName}>
                      {item.itemName} x{item.quantity}
                    </Text>
                    <Text style={styles.orderItemAmount}>{formatKes(item.subtotal)}</Text>
                  </View>
                ))
              )}
              <View style={styles.orderTotalRow}>
                <Text style={styles.orderTotalLabel}>Total</Text>
                <Text style={styles.orderTotalValue}>{formatKes(orderTotal)}</Text>
              </View>

              <Text style={styles.sectionLabel}>Add from menu</Text>
              <View style={styles.menuGrid}>
                {activeMenu.map((menuItem: any) => (
                  <Pressable key={menuItem.id} style={styles.menuChip} onPress={() => addMenuItem(menuItem)}>
                    <Text style={styles.menuChipName}>{menuItem.name}</Text>
                    <Text style={styles.menuChipPrice}>{formatKes(menuItem.price)}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancel} onPress={() => setActiveOrderId(null)}>
                  <Text style={styles.modalCancelText}>Close</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { marginBottom: spacing.md, paddingHorizontal: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.small, color: colors.textMuted },
  itemCard: { marginBottom: spacing.md },
  itemHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  orderTitle: { ...typography.h3, color: colors.text },
  metaText: { ...typography.small, color: colors.textMuted },
  totalText: { ...typography.h3, color: colors.text, marginTop: spacing.sm },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "88%" },
  modalTitle: { ...typography.h2, color: colors.text },
  modalSubtitle: { ...typography.small, color: colors.textMuted, marginBottom: spacing.md },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text },
  outletRow: { flexDirection: "row", gap: spacing.sm },
  outletChip: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.surfaceAlt },
  outletChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  outletChipText: { ...typography.small, color: colors.text, fontWeight: "600" },
  outletChipTextSelected: { color: colors.primaryForeground },
  errorText: { color: colors.danger, marginTop: spacing.sm },
  modalActions: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md },
  modalCancel: { paddingVertical: 12, paddingHorizontal: spacing.md },
  modalCancelText: { color: colors.textMuted, fontWeight: "600" },
  sectionLabel: { ...typography.h3, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  orderItemRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  orderItemName: { ...typography.body, color: colors.text },
  orderItemAmount: { ...typography.body, color: colors.text, fontWeight: "600" },
  orderTotalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  orderTotalLabel: { ...typography.h3, color: colors.text },
  orderTotalValue: { ...typography.h3, color: colors.primary },
  menuGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  menuChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, minWidth: "45%", backgroundColor: colors.surfaceAlt },
  menuChipName: { ...typography.small, color: colors.text, fontWeight: "600" },
  menuChipPrice: { ...typography.small, color: colors.textMuted },
});
