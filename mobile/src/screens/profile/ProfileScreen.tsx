import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../../context/AuthContext";
import { Screen, Card, PrimaryButton, StatusBadge } from "../../components/ui";
import { colors, spacing, typography } from "../../theme/theme";
import { MODULE_KEYS, hasModule } from "../../api/types";
import { titleCase } from "../../utils/format";

export default function ProfileScreen() {
  const { user, environment, logout } = useAuth();
  const navigation = useNavigation<any>();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Profile</Text>

        <Card style={styles.card}>
          <Text style={styles.name}>{user?.fullName}</Text>
          <Text style={styles.username}>@{user?.username}</Text>
          <View style={styles.envRow}>
            <StatusBadge status={environment === "live" ? "Live" : "Test"} />
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Module access</Text>
        <Card style={styles.card}>
          {MODULE_KEYS.map((key) => (
            <View key={key} style={styles.moduleRow}>
              <Text style={styles.moduleLabel}>{titleCase(key)}</Text>
              <Text style={[styles.moduleStatus, hasModule(user, key) ? styles.moduleOn : styles.moduleOff]}>
                {hasModule(user, key) ? "Granted" : "—"}
              </Text>
            </View>
          ))}
        </Card>

        {!!user?.isAdmin && (
          <View style={styles.adminWrap}>
            <PrimaryButton label="Manage user access" onPress={() => navigation.navigate("UserAccess")} />
          </View>
        )}

        <View style={styles.logoutWrap}>
          <PrimaryButton label="Sign out" tone="outline" onPress={logout} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  name: { ...typography.h2, color: colors.text },
  username: { ...typography.small, color: colors.textMuted, marginBottom: spacing.sm },
  envRow: { marginTop: spacing.xs },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  moduleRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  moduleLabel: { ...typography.body, color: colors.text },
  moduleStatus: { ...typography.small, fontWeight: "700" },
  moduleOn: { color: colors.success },
  moduleOff: { color: colors.textMuted },
  adminWrap: { marginTop: spacing.lg },
  logoutWrap: { marginTop: spacing.sm },
});
