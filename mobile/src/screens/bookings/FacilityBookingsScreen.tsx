import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, Modal, TextInput, ScrollView, Pressable } from "react-native";
import { Screen, BackHeader, Card, StatusBadge, PrimaryButton, EmptyState, CenteredSpinner } from "../../components/ui";
import { BookingsTabBar } from "./BookingsTabBar";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { formatDate, formatKes } from "../../utils/format";
import { useFacilities, useFacilityBookings, useCreateFacilityBooking } from "../../api/bookings";

export default function FacilityBookingsScreen() {
  const facilitiesQuery = useFacilities();
  const bookingsQuery = useFacilityBookings();
  const createBooking = useCreateFacilityBooking();
  const [showForm, setShowForm] = useState(false);

  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeFacilities = useMemo(() => (facilitiesQuery.data ?? []).filter((f: any) => f.active), [facilitiesQuery.data]);
  const selectedFacility = useMemo(() => (facilitiesQuery.data ?? []).find((f: any) => f.id === facilityId), [facilitiesQuery.data, facilityId]);

  const resetForm = () => {
    setFacilityId(null);
    setClientName("");
    setClientPhone("");
    setEventDate("");
    setStartTime("");
    setEndTime("");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!facilityId) return setError("Select a facility.");
    if (!clientName.trim()) return setError("Client name is required.");
    if (!eventDate) return setError("Event date is required (YYYY-MM-DD).");
    try {
      await createBooking.mutateAsync({
        facilityId,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim() || undefined,
        eventDate,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
        rate: selectedFacility?.rate ?? 0,
        totalAmount: selectedFacility?.rate ?? 0,
        amountPaid: 0,
        status: "confirmed",
      });
      setShowForm(false);
      resetForm();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create booking.");
    }
  };

  if (facilitiesQuery.isLoading || bookingsQuery.isLoading) return <CenteredSpinner />;

  const bookings = [...(bookingsQuery.data ?? [])].sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

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
            <Text style={styles.title}>Conference & Facilities</Text>
            <Text style={styles.subtitle}>{activeFacilities.length} facility/facilities available</Text>
          </View>
          <PrimaryButton label="New booking" onPress={() => setShowForm(true)} />
        </View>
      </View>
      <FlatList
        data={bookings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title="No bookings yet" subtitle="Create the first facility booking." />}
        renderItem={({ item }) => {
          const facility = (facilitiesQuery.data ?? []).find((f: any) => f.id === item.facilityId);
          return (
            <Card style={styles.itemCard}>
              <View style={styles.itemHeaderRow}>
                <Text style={styles.roomName}>{facility?.name ?? `Facility #${item.facilityId}`}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.guestName}>{item.clientName}</Text>
              <Text style={styles.metaText}>
                {formatDate(item.eventDate)}
                {item.startTime ? ` · ${item.startTime}${item.endTime ? "–" + item.endTime : ""}` : ""}
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
              <Text style={styles.modalTitle}>New Facility Booking</Text>

              <Text style={styles.fieldLabel}>Facility</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomPicker}>
                {activeFacilities.map((facility: any) => (
                  <Pressable
                    key={facility.id}
                    onPress={() => setFacilityId(facility.id)}
                    style={[styles.roomChip, facilityId === facility.id && styles.roomChipSelected]}
                  >
                    <Text style={[styles.roomChipText, facilityId === facility.id && styles.roomChipTextSelected]}>
                      {facility.name} · {formatKes(facility.rate)}/{facility.rateType}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Client name</Text>
              <TextInput style={styles.input} value={clientName} onChangeText={setClientName} placeholder="Full name / company" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Client phone</Text>
              <TextInput style={styles.input} value={clientPhone} onChangeText={setClientPhone} placeholder="07xxxxxxxx" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

              <Text style={styles.fieldLabel}>Event date (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={eventDate} onChangeText={setEventDate} placeholder="2026-09-20" placeholderTextColor={colors.textMuted} />

              <View style={styles.timeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Start time</Text>
                  <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="09:00" placeholderTextColor={colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>End time</Text>
                  <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="12:00" placeholderTextColor={colors.textMuted} />
                </View>
              </View>

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
  timeRow: { flexDirection: "row", gap: spacing.sm },
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
