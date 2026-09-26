import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useAuth } from "../../context/AuthContext";
import { hasModule } from "../../api/types";
import { colors, spacing, radius, typography } from "../../theme/theme";

// Lets a user jump directly between the 4 booking modules (Accommodation,
// Conference & Facilities, Movie Room, Bar & Restaurant) without dropping
// back to the BookingsHome picker first. Only modules the signed-in user
// has access to are shown, so this never exposes a module a user's
// per-module permissions don't grant.
const TABS: { route: string; moduleKey: Parameters<typeof hasModule>[1]; label: string }[] = [
  { route: "AccommodationBookings", moduleKey: "accommodation", label: "Accommodation" },
  { route: "FacilityBookings", moduleKey: "facilities", label: "Conference & Facilities" },
  { route: "MovieBookings", moduleKey: "movie-room", label: "Movie Room" },
  { route: "BarRestaurant", moduleKey: "bar-restaurant", label: "Bar & Restaurant" },
];

export function BookingsTabBar() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useAuth();

  const visibleTabs = TABS.filter((t) => hasModule(user, t.moduleKey));
  if (visibleTabs.length <= 1) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.container}
    >
      {visibleTabs.map((tab) => {
        const active = route.name === tab.route;
        return (
          <Pressable
            key={tab.route}
            onPress={() => {
              // `navigate` (not `replace`) so switching between booking types
              // pushes/resumes a real stack entry — the hardware/back-header
              // back action can then step through Accommodation → Facilities
              // → Movie Room → Bar & Restaurant → BookingsHome in the order
              // the user actually visited them, instead of `replace` silently
              // swapping the current screen and erasing that history.
              if (!active) navigation.navigate(tab.route);
            }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 0, marginBottom: spacing.sm },
  row: { paddingHorizontal: spacing.md, gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.small, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: colors.primaryForeground },
});
