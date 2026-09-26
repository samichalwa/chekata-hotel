import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, Modal, TextInput, ScrollView, Pressable } from "react-native";
import { Screen, BackHeader, Card, StatusBadge, PrimaryButton, EmptyState, CenteredSpinner } from "../../components/ui";
import { BookingsTabBar } from "./BookingsTabBar";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { formatDate, formatKes } from "../../utils/format";
import { useRooms, useAccommodationBookings, useCreateAccommodationBooking } from "../../api/bookings";

export default function AccommodationScreen() {
  const roomsQuery = useRooms();
  const bookingsQuery = useAccommodationBookings();
  const createBooking = useCreateAccommodationBooking();
  const [showForm, setShowForm] = useState(false);

  const [roomId, setRoomId] = useState<number | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [error, setError] = useState<string | null>(null);

  const availableRooms = useMemo(() => (roomsQuery.data ?? []).filter((r: any) => r.status === "available"), [roomsQuery.data]);
  const selectedRoom = useMemo(() => (roomsQuery.data ?? []).find((r: any) => r.id === roomId), [roomsQuery.data, roomId]);

  const resetForm = () => {
    setRoomId(null);
    setGuestName("");
    setGuestPhone("");
    setCheckIn("");
    setCheckOut("");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!roomId) return setError("Select a room.");
    if (!guestName.trim()) return setError("Guest name is required.");
    if (!checkIn || !checkOut) return setError("Check-in and check-out dates are required (YYYY-MM-DD).");
    try {
      await createBooking.mutateAsync({
        roomId,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        checkIn,
        checkOut,
        rate: selectedRoom?.rate ?? 0,
        totalAmount: selectedRoom?.rate ?? 0,
        amountPaid: 0,
        numberOfGuests: 1,
        status: "confirmed",
      });
      setShowForm(false);
      resetForm();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create booking.");
    }
  };

  if (roomsQuery.isLoading || bookingsQuery.isLoading) return <CenteredSpinner />;

  const bookings = [...(bookingsQuery.data ?? [])].sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return (
    <Screen>
      <BackHeader />
      <BookingsTabBar />
      {/* Rendered as a plain sibling, not FlatList's ListHeaderComponent — a
          header row hosted inside a virtualized list can have its first tap
          swallowed while the list finishes measuring, which is what made
          this button feel unresponsive. A fixed header above the list has
          no such window. */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Accommodation</Text>
            <Text style={styles.subtitle}>{availableRooms.length} room(s) available now</Text>
          </View>
          <PrimaryButton label="New booking" onPress={() => setShowForm(true)} />
        </View>
      </View>
      <FlatList
        data={bookings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title="No bookings yet" subtitle="Create the first accommodation booking." />}
        renderItem={({ item }) => {
          const room = (roomsQuery.data ?? []).find((r: any) => r.id === item.roomId);
          return (
            <Card style={styles.itemCard}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.roomName}>{room?.name ?? `Room #${item.roomId}`}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.guestName}>{item.guestName}</Text>
              <Text style={styles.metaText}>
                {formatDate(item.checkIn)} → {formatDate(item.checkOut)}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>Paid {formatKes(item.amountPaid)} / {formatKes(item.totalAmount)}</Text>
              </View>
            </Card>
          );
        }}
      />

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>New Accommodation Booking</Text>

              <Text style={styles.fieldLabel}>Room</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomPicker}>
                {availableRooms.map((room: any) => (
                  <Pressable
                    key={room.id}
                    onPress={() => setRoomId(room.id)}
                    style={[styles.roomChip, roomId === room.id && styles.roomChipSelected]}
                  >
                    <Text style={[styles.roomChipText, roomId === room.id && styles.roomChipTextSelected]}>
                      {room.name} · {formatKes(room.rate)}/night
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Guest name</Text>
              <TextInput style={styles.input} value={guestName} onChangeText={setGuestName} placeholder="Full name" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Guest phone</Text>
              <TextInput style={styles.input} value={guestPhone} onChangeText={setGuestPhone} placeholder="07xxxxxxxx" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

              <Text style={styles.fieldLabel}>Check-in (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={checkIn} onChangeText={setCheckIn} placeholder="2026-09-20" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Check-out (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={checkOut} onChangeText={setCheckOut} placeholder="2026-09-22" placeholderTextColor={colors.textMuted} />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancel}
                  onPress={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <PrimaryButton label="Create booking" onPress={submit} loading={createBooking.isPending} />
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
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.small, color: colors.textMuted },
  itemCard: { marginBottom: spacing.md },
  itemHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  roomName: { ...typography.h3, color: colors.text },
  guestName: { ...typography.body, color: colors.text, marginBottom: 2 },
  metaRow: { marginTop: spacing.sm },
  metaText: { ...typography.small, color: colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  modalTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.md },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text },
  roomPicker: { marginBottom: spacing.xs },
  roomChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm, backgroundColor: colors.surfaceAlt },
  roomChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  roomChipText: { ...typography.small, color: colors.text },
  roomChipTextSelected: { color: colors.primaryForeground, fontWeight: "700" },
  errorText: { color: colors.danger, marginTop: spacing.sm },
  modalActions: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md },
  modalCancel: { paddingVertical: 12, paddingHorizontal: spacing.md },
  modalCancelText: { color: colors.textMuted, fontWeight: "600" },
});
