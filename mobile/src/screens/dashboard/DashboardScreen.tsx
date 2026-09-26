import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { hasModule } from "../../api/types";
import { Screen, KpiCard, CenteredSpinner, SectionTitle } from "../../components/ui";
import { colors, spacing, typography, radius } from "../../theme/theme";
import { formatKes } from "../../utils/format";
import { usePendingApprovals } from "../../api/approvals";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await api.get<T>(url);
  return res.data;
}

const STREAM_ROUTES: Record<string, string> = {
  accommodation: "AccommodationBookings",
  facilities: "FacilityBookings",
  "movie-room": "MovieBookings",
  "bar-restaurant": "BarRestaurant",
};

export default function DashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);

  const canAccommodation = hasModule(user, "accommodation");
  const canFacilities = hasModule(user, "facilities");
  const canMovieRoom = hasModule(user, "movie-room");
  const canBarRestaurant = hasModule(user, "bar-restaurant");
  const canStaff = hasModule(user, "staff");
  const canExpenses = hasModule(user, "expenses");
  const canSeeRevenue = canAccommodation || canFacilities || canMovieRoom || canBarRestaurant;

  const roomsQuery = useQuery({ queryKey: ["dash", "rooms"], queryFn: () => fetchJson<any[]>("/api/rooms"), enabled: canAccommodation });
  const bookingsQuery = useQuery({
    queryKey: ["dash", "accommodation-bookings"],
    queryFn: () => fetchJson<any[]>("/api/accommodation-bookings"),
    enabled: canAccommodation,
  });
  const facilityBookingsQuery = useQuery({
    queryKey: ["dash", "facility-bookings"],
    queryFn: () => fetchJson<any[]>("/api/facility-bookings"),
    enabled: canFacilities,
  });
  const movieShowsQuery = useQuery({ queryKey: ["dash", "movie-shows"], queryFn: () => fetchJson<any[]>("/api/movie-shows"), enabled: canMovieRoom });
  const movieSeatBookingsQuery = useQuery({
    queryKey: ["dash", "movie-seat-bookings"],
    queryFn: () => fetchJson<any[]>("/api/movie-seat-bookings"),
    enabled: canMovieRoom,
  });
  const ordersQuery = useQuery({ queryKey: ["dash", "orders"], queryFn: () => fetchJson<any[]>("/api/orders"), enabled: canBarRestaurant });
  const staffQuery = useQuery({ queryKey: ["dash", "staff"], queryFn: () => fetchJson<any[]>("/api/staff"), enabled: canStaff });
  const expensesQuery = useQuery({ queryKey: ["dash", "expenses"], queryFn: () => fetchJson<any[]>("/api/expenses"), enabled: canExpenses });

  const { items: approvalItems, isLoading: approvalsLoading, refetchAll: refetchApprovals } = usePendingApprovals(user);

  const isLoading =
    (canAccommodation && (roomsQuery.isLoading || bookingsQuery.isLoading)) ||
    (canFacilities && facilityBookingsQuery.isLoading) ||
    (canMovieRoom && (movieShowsQuery.isLoading || movieSeatBookingsQuery.isLoading)) ||
    (canBarRestaurant && ordersQuery.isLoading) ||
    (canStaff && staffQuery.isLoading) ||
    (canExpenses && expensesQuery.isLoading) ||
    approvalsLoading;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      canAccommodation && roomsQuery.refetch(),
      canAccommodation && bookingsQuery.refetch(),
      canFacilities && facilityBookingsQuery.refetch(),
      canMovieRoom && movieShowsQuery.refetch(),
      canMovieRoom && movieSeatBookingsQuery.refetch(),
      canBarRestaurant && ordersQuery.refetch(),
      canStaff && staffQuery.refetch(),
      canExpenses && expensesQuery.refetch(),
      Promise.resolve(refetchApprovals()),
    ]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccommodation, canFacilities, canMovieRoom, canBarRestaurant, canStaff, canExpenses]);

  if (isLoading && !refreshing) return <CenteredSpinner />;

  const rooms = roomsQuery.data ?? [];
  const occupied = rooms.filter((r: any) => r.status === "occupied").length;
  const bookingsToday = (bookingsQuery.data ?? []).filter((b: any) => {
    const today = new Date().toISOString().slice(0, 10);
    return b.checkIn <= today && b.checkOut >= today && b.status !== "cancelled";
  }).length;
  const activeFacilityBookings = (facilityBookingsQuery.data ?? []).filter((b: any) => b.status === "confirmed").length;
  const openOrders = (ordersQuery.data ?? []).filter((o: any) => o.status !== "closed" && o.status !== "paid").length;
  const activeStaff = (staffQuery.data ?? []).filter((s: any) => s.active).length;
  const expenseTotal = (expensesQuery.data ?? []).reduce((sum: number, e: any) => sum + (e.amount ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const accommodationRevenueToday = canAccommodation
    ? (bookingsQuery.data ?? []).filter((b: any) => b.status !== "cancelled" && b.checkIn === today).reduce((s: number, b: any) => s + (b.totalAmount ?? 0), 0)
    : 0;
  const facilityRevenueToday = canFacilities
    ? (facilityBookingsQuery.data ?? []).filter((b: any) => b.status !== "cancelled" && b.eventDate === today).reduce((s: number, b: any) => s + (b.totalAmount ?? 0), 0)
    : 0;
  const movieShowsById = new Map((movieShowsQuery.data ?? []).map((s: any) => [s.id, s]));
  const movieRevenueToday = canMovieRoom
    ? (movieSeatBookingsQuery.data ?? [])
        .filter((b: any) => b.status !== "cancelled" && (movieShowsById.get(b.showId) as any)?.showDate === today)
        .reduce((s: number, b: any) => s + (b.ticketPrice ?? 0), 0)
    : 0;
  const barRestaurantRevenueToday = canBarRestaurant
    ? (ordersQuery.data ?? []).filter((o: any) => o.status === "paid" && o.orderDate === today).reduce((s: number, o: any) => s + (o.totalAmount ?? 0), 0)
    : 0;
  const totalRevenueToday = accommodationRevenueToday + facilityRevenueToday + movieRevenueToday + barRestaurantRevenueToday;
  const movieBookingsToday = canMovieRoom
    ? (movieSeatBookingsQuery.data ?? []).filter((b: any) => b.status !== "cancelled" && (movieShowsById.get(b.showId) as any)?.showDate === today).length
    : 0;

  const revenueStreams = [
    canAccommodation ? { key: "accommodation", label: "Accommodation", amount: accommodationRevenueToday } : null,
    canFacilities ? { key: "facilities", label: "Conference & Facilities", amount: facilityRevenueToday } : null,
    canMovieRoom ? { key: "movie-room", label: "Movie Room", amount: movieRevenueToday } : null,
    canBarRestaurant ? { key: "bar-restaurant", label: "Bar & Restaurant", amount: barRestaurantRevenueToday } : null,
  ].filter((s): s is { key: string; label: string; amount: number } => s !== null);

  const approvalsByCategory = new Map<string, number>();
  for (const item of approvalItems) {
    const category = item.category;
    approvalsByCategory.set(category, (approvalsByCategory.get(category) ?? 0) + 1);
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>Hello, {user?.fullName?.split(" ")[0] ?? "there"}</Text>
        <Text style={styles.subGreeting}>Here's what's happening at The Chekata</Text>

        <View style={styles.kpiGrid}>
          {canSeeRevenue ? <KpiCard label="Total revenue today" value={formatKes(totalRevenueToday)} /> : null}
          <KpiCard label="Awaiting your approval" value={approvalItems.length} tone={approvalItems.length > 0 ? "warning" : "default"} />
          {canAccommodation ? <KpiCard label="Rooms occupied" value={`${occupied}/${rooms.length}`} /> : null}
          {canAccommodation ? <KpiCard label="Stays active today" value={bookingsToday} /> : null}
          {canFacilities ? <KpiCard label="Confirmed facility bookings" value={activeFacilityBookings} /> : null}
          {canMovieRoom ? <KpiCard label="Movie Room seats booked today" value={movieBookingsToday} /> : null}
          {canBarRestaurant ? <KpiCard label="Open bar/restaurant orders" value={openOrders} /> : null}
          {canStaff ? <KpiCard label="Active staff" value={activeStaff} /> : null}
          {canExpenses ? <KpiCard label="Recorded expenses" value={formatKes(expenseTotal)} /> : null}
        </View>

        {canSeeRevenue && revenueStreams.length > 0 ? (
          <>
            <SectionTitle>Revenue by stream (today)</SectionTitle>
            <View style={styles.streamCard}>
              {revenueStreams.map((stream, idx) => {
                const targetRoute = STREAM_ROUTES[stream.key];
                const pct = totalRevenueToday > 0 ? stream.amount / totalRevenueToday : 0;
                return (
                  <Pressable
                    key={stream.key}
                    onPress={() => targetRoute && navigation.navigate("Bookings", { screen: targetRoute })}
                    style={[styles.streamRow, idx === revenueStreams.length - 1 && styles.streamRowLast]}
                  >
                    <View style={styles.streamHeaderRow}>
                      <Text style={styles.streamLabel}>{stream.label}</Text>
                      <Text style={styles.streamAmount}>{formatKes(stream.amount)}</Text>
                    </View>
                    <View style={styles.streamBarTrack}>
                      <View style={[styles.streamBarFill, { width: `${Math.round(pct * 100)}%` }]} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {approvalItems.length > 0 ? (
          <>
            <SectionTitle>Needs your attention</SectionTitle>
            <View style={styles.categoryRow}>
              {Array.from(approvalsByCategory.entries()).map(([category, count]) => (
                <Pressable
                  key={category}
                  style={styles.categoryChip}
                  onPress={() => navigation.navigate("Approvals")}
                >
                  <Text style={styles.categoryChipText}>
                    {category} · {count}
                  </Text>
                </Pressable>
              ))}
            </View>
            {approvalItems.slice(0, 3).map((item) => (
              <Pressable
                key={`${item.kind}-${item.id}`}
                style={styles.attentionRow}
                onPress={() => navigation.navigate("Approvals")}
              >
                <Text style={styles.attentionModule}>{item.moduleLabel}</Text>
                <Text style={styles.attentionTitle} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            ))}
            {approvalItems.length > 3 ? (
              <Pressable onPress={() => navigation.navigate("Approvals")}>
                <Text style={styles.seeAllLink}>See all {approvalItems.length} pending approvals →</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  greeting: { ...typography.h1, color: colors.text },
  subGreeting: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  attentionRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  attentionModule: { ...typography.label, color: colors.primary, marginBottom: 2 },
  attentionTitle: { ...typography.body, color: colors.text },
  streamCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  streamRow: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  streamRowLast: { borderBottomWidth: 0 },
  streamHeaderRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  streamLabel: { ...typography.body, color: colors.text, fontWeight: "600" },
  streamAmount: { ...typography.body, color: colors.text, fontWeight: "700" },
  streamBarTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  streamBarFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  categoryChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.warningBg,
  },
  categoryChipText: { ...typography.small, color: colors.warning, fontWeight: "700" },
  seeAllLink: { ...typography.small, color: colors.primary, fontWeight: "700", marginTop: spacing.xs, marginBottom: spacing.md },
});
