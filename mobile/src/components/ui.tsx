import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { colors, spacing, radius, typography } from "../theme/theme";

export function Screen({ children, style, edges = ["top"] }: { children: React.ReactNode; style?: any; edges?: Edge[] }) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

// Back navigation row for screens pushed inside a nested stack that has its
// own header hidden (headerShown: false at the Tab/Stack level). Without
// this, users landing on e.g. AccommodationScreen from BookingsHomeScreen
// have no way back to the module picker.
export function BackHeader({ label = "Bookings" }: { label?: string }) {
  const navigation = useNavigation<any>();
  return (
    <Pressable
      onPress={() => navigation.goBack()}
      style={styles.backRow}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.backChevron}>‹</Text>
      <Text style={styles.backLabel}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function KpiCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "warning" | "danger" }) {
  const valueColor = tone === "warning" ? colors.warning : tone === "danger" ? colors.danger : colors.text;
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

type StatusTone = "pending" | "approved" | "rejected" | "neutral";
const statusStyles: Record<StatusTone, { bg: string; fg: string }> = {
  pending: { bg: colors.warningBg, fg: colors.warning },
  approved: { bg: colors.successBg, fg: colors.success },
  rejected: { bg: colors.dangerBg, fg: colors.danger },
  neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
};

function formatStatusLabel(status: string): string {
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  let tone: StatusTone = "neutral";
  if (normalized.includes("pending") || normalized.includes("submit")) tone = "pending";
  else if (normalized.includes("approv")) tone = "approved";
  else if (normalized.includes("reject") || normalized.includes("cancel")) tone = "rejected";
  const style = statusStyles[tone];
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.badgeText, { color: style.fg }]}>{formatStatusLabel(status)}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "primary" | "danger" | "outline";
}) {
  const bg = tone === "danger" ? colors.danger : tone === "outline" ? "transparent" : colors.primary;
  const textColor = tone === "outline" ? colors.primary : colors.primaryForeground;
  return (
    <Pressable
      style={[
        styles.button,
        { backgroundColor: bg, borderWidth: tone === "outline" ? 1 : 0, borderColor: colors.primary },
        (disabled || loading) && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>}
    </Pressable>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function CenteredSpinner() {
  return (
    <View style={styles.spinnerWrap}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  backRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 4 },
  backChevron: { fontSize: 20, color: colors.primary, fontWeight: "700" },
  backLabel: { ...typography.body, color: colors.primary, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.lg },
  kpi: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minWidth: "47%",
    flexGrow: 1,
  },
  kpiLabel: { ...typography.small, color: colors.textMuted, marginBottom: 4 },
  kpiValue: { ...typography.h1, fontSize: 22 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { ...typography.small, fontWeight: "700", textTransform: "capitalize" },
  button: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontWeight: "700", fontSize: 14 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl },
  emptyTitle: { ...typography.h3, color: colors.textMuted },
  emptySubtitle: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs, textAlign: "center" },
  spinnerWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
});
