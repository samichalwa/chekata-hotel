import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Modal, TextInput, ScrollView, Pressable } from "react-native";
import { Screen, BackHeader, Card, StatusBadge, PrimaryButton, EmptyState, CenteredSpinner } from "../../components/ui";
import { BookingsTabBar } from "./BookingsTabBar";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { formatDate, formatKes } from "../../utils/format";
import { useMovieShows, useMovieSeatBookings, useCreateMovieSeatBooking } from "../../api/bookings";

const ROWS = ["A", "B", "C", "D", "E", "F", "G"];
const SEATS_PER_ROW = 7;

export default function MovieRoomScreen() {
  const showsQuery = useMovieShows();
  const seatBookingsQuery = useMovieSeatBookings();
  const createBooking = useCreateMovieSeatBooking();

  const [activeShowId, setActiveShowId] = useState<number | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<{ row: string; number: number }[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upcomingShows = useMemo(
    () => [...(showsQuery.data ?? [])].filter((s: any) => s.status === "scheduled").sort((a: any, b: any) => a.showDate.localeCompare(b.showDate)),
    [showsQuery.data]
  );

  const activeShow = useMemo(() => (showsQuery.data ?? []).find((s: any) => s.id === activeShowId), [showsQuery.data, activeShowId]);

  const bookedSeats = useMemo(() => {
    const set = new Set<string>();
    for (const b of seatBookingsQuery.data ?? []) {
      if (b.showId === activeShowId && b.status === "booked") set.add(`${b.seatRow}${b.seatNumber}`);
    }
    return set;
  }, [seatBookingsQuery.data, activeShowId]);

  const toggleSeat = (row: string, number: number) => {
    const key = `${row}${number}`;
    if (bookedSeats.has(key)) return;
    setSelectedSeats((prev) => {
      const exists = prev.find((s) => s.row === row && s.number === number);
      if (exists) return prev.filter((s) => !(s.row === row && s.number === number));
      return [...prev, { row, number }];
    });
  };

  const closeSheet = () => {
    setActiveShowId(null);
    setSelectedSeats([]);
    setGuestName("");
    setGuestPhone("");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!activeShowId) return;
    if (selectedSeats.length === 0) return setError("Select at least one seat.");
    if (!guestName.trim()) return setError("Guest name is required.");
    try {
      await createBooking.mutateAsync({
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        amountPaid: 0,
        legs: [{ showId: activeShowId, seats: selectedSeats }],
      });
      closeSheet();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to book seats.");
    }
  };

  if (showsQuery.isLoading || seatBookingsQuery.isLoading) return <CenteredSpinner />;

  const totalAmount = activeShow ? selectedSeats.length * activeShow.ticketPrice : 0;

  return (
    <Screen>
      <BackHeader />
      <BookingsTabBar />
      <FlatList
        data={upcomingShows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Movie Room</Text>
            <Text style={styles.subtitle}>Pick a show to view or book seats</Text>
          </View>
        }
        ListEmptyComponent={<EmptyState title="No scheduled shows" subtitle="Ask an administrator to schedule a show first." />}
        renderItem={({ item }) => {
          const booked = (seatBookingsQuery.data ?? []).filter((b: any) => b.showId === item.id && b.status === "booked").length;
          return (
            <Pressable onPress={() => setActiveShowId(item.id)}>
              <Card style={styles.itemCard}>
                <View style={styles.itemHeaderRow}>
                  <Text style={styles.showName}>{item.name}</Text>
                  <StatusBadge status={item.status} />
                </View>
                <Text style={styles.metaText}>
                  {formatDate(item.showDate)} · {item.startTime}
                  {item.endTime ? `–${item.endTime}` : ""}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{formatKes(item.ticketPrice)}/seat</Text>
                  <Text style={styles.metaText}>{booked}/{ROWS.length * SEATS_PER_ROW} booked</Text>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      <Modal visible={!!activeShowId} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>{activeShow?.name}</Text>
              <Text style={styles.modalSubtitle}>
                {activeShow ? `${formatDate(activeShow.showDate)} · ${activeShow.startTime}` : ""}
              </Text>

              <View style={styles.seatGrid}>
                {ROWS.map((row) => (
                  <View key={row} style={styles.seatRow}>
                    <Text style={styles.rowLabel}>{row}</Text>
                    {Array.from({ length: SEATS_PER_ROW }, (_, i) => i + 1).map((num) => {
                      const key = `${row}${num}`;
                      const isBooked = bookedSeats.has(key);
                      const isSelected = selectedSeats.some((s) => s.row === row && s.number === num);
                      return (
                        <Pressable
                          key={key}
                          onPress={() => toggleSeat(row, num)}
                          disabled={isBooked}
                          style={[
                            styles.seat,
                            isBooked && styles.seatBooked,
                            isSelected && styles.seatSelected,
                          ]}
                        >
                          <Text style={[styles.seatText, (isBooked || isSelected) && styles.seatTextActive]}>{num}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>

              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} />
                  <Text style={styles.legendText}>Available</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: colors.primary, borderColor: colors.primary }]} />
                  <Text style={styles.legendText}>Selected</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: colors.textMuted, borderColor: colors.textMuted }]} />
                  <Text style={styles.legendText}>Booked</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Guest name</Text>
              <TextInput style={styles.input} value={guestName} onChangeText={setGuestName} placeholder="Full name" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Guest phone</Text>
              <TextInput style={styles.input} value={guestPhone} onChangeText={setGuestPhone} placeholder="07xxxxxxxx" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

              <Text style={styles.totalText}>
                {selectedSeats.length} seat{selectedSeats.length === 1 ? "" : "s"} · {formatKes(totalAmount)}
              </Text>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancel} onPress={closeSheet}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <PrimaryButton label="Book seats" onPress={submit} loading={createBooking.isPending} />
                </View>
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
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  itemCard: { marginBottom: spacing.md },
  itemHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  showName: { ...typography.h3, color: colors.text },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  metaText: { ...typography.small, color: colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "90%" },
  modalTitle: { ...typography.h2, color: colors.text },
  modalSubtitle: { ...typography.small, color: colors.textMuted, marginBottom: spacing.md },
  seatGrid: { marginBottom: spacing.md },
  seatRow: { flexDirection: "row", alignItems: "center", marginBottom: 6, gap: 4 },
  rowLabel: { width: 18, ...typography.small, color: colors.textMuted, fontWeight: "700" },
  seat: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  seatBooked: { backgroundColor: colors.textMuted, borderColor: colors.textMuted },
  seatSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  seatText: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  seatTextActive: { color: colors.primaryForeground },
  legendRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  legendText: { ...typography.small, color: colors.textMuted },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text },
  totalText: { ...typography.h3, color: colors.text, marginTop: spacing.md },
  errorText: { color: colors.danger, marginTop: spacing.sm },
  modalActions: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md },
  modalCancel: { paddingVertical: 12, paddingHorizontal: spacing.md },
  modalCancelText: { color: colors.textMuted, fontWeight: "600" },
});
