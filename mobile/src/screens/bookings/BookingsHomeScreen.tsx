import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../../context/AuthContext";
import { hasModule } from "../../api/types";
import { Screen, Card } from "../../components/ui";
import { colors, spacing, typography, radius } from "../../theme/theme";

const SECTIONS: { key: string; module: any; title: string; subtitle: string; route: string }[] = [
  { key: "accommodation", module: "accommodation", title: "Accommodation", subtitle: "Guest room bookings & availability", route: "AccommodationBookings" },
  { key: "facilities", module: "facilities", title: "Conference & Facilities", subtitle: "Meeting rooms and event space bookings", route: "FacilityBookings" },
  { key: "movie-room", module: "movie-room", title: "Movie Room", subtitle: "Shows and seat bookings", route: "MovieBookings" },
  { key: "bar-restaurant", module: "bar-restaurant", title: "Bar & Restaurant", subtitle: "Tables and open orders", route: "BarRestaurant" },
];

export default function BookingsHomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const visible = SECTIONS.filter((s) => hasModule(user, s.module));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Bookings</Text>
        <Text style={styles.subtitle}>Choose what you'd like to book or review</Text>
        {visible.map((section) => (
          <Pressable key={section.key} onPress={() => navigation.navigate(section.route)}>
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{section.title}</Text>
                  <Text style={styles.cardSubtitle}>{section.subtitle}</Text>
                </View>
                <View style={styles.chevron}>
                  <Text style={styles.chevronText}>›</Text>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}
        {visible.length === 0 ? (
          <Text style={styles.empty}>You don't have access to any booking modules yet. Ask an administrator to grant access.</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  rowBetween: { flexDirection: "row", alignItems: "center" },
  cardTitle: { ...typography.h3, color: colors.text },
  cardSubtitle: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  chevronText: { fontSize: 18, color: colors.primary, fontWeight: "700" },
  empty: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
});
