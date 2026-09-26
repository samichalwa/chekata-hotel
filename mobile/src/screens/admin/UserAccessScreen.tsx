import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Alert } from "react-native";
import { Screen, BackHeader, Card, PrimaryButton, EmptyState, CenteredSpinner, StatusBadge } from "../../components/ui";
import { colors, spacing, radius, typography } from "../../theme/theme";
import { titleCase } from "../../utils/format";
import { MODULE_KEYS, type ModuleKey, type SafeUser } from "../../api/types";
import { useAdminUsers, useUpdateAdminUser } from "../../api/users";
import { useAuth } from "../../context/AuthContext";

// Admin-only screen: grant or revoke per-module access for any user, the
// same checkbox model the web app's Settings > Users screen uses. Nothing
// here is hardcoded — MODULE_KEYS drives the checkbox list, and every
// change is written straight through PATCH /api/users/:id so the two apps
// always agree on a given user's access.

function parsePermissions(user: SafeUser): ModuleKey[] {
  try {
    const arr = JSON.parse(user.permissions);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function UserRow({ user, isSelf }: { user: SafeUser; isSelf: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [permissions, setPermissions] = useState<ModuleKey[]>(() => parsePermissions(user));
  const [isAdmin, setIsAdmin] = useState(!!user.isAdmin);
  const [active, setActive] = useState(!!user.active);
  const update = useUpdateAdminUser();

  const dirty =
    isAdmin !== !!user.isAdmin ||
    active !== !!user.active ||
    JSON.stringify([...permissions].sort()) !== JSON.stringify([...parsePermissions(user)].sort());

  const toggleModule = (key: ModuleKey) => {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const save = async () => {
    try {
      await update.mutateAsync({ id: user.id, payload: { isAdmin, permissions, active } });
      Alert.alert("Saved", `Access updated for ${user.fullName}.`);
    } catch (err: any) {
      Alert.alert("Failed", err?.response?.data?.error ?? "Could not update this user's access.");
    }
  };

  return (
    <Card style={styles.userCard}>
      <Pressable onPress={() => setExpanded((e) => !e)} style={styles.userHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{user.fullName}</Text>
          <Text style={styles.userMeta}>@{user.username}</Text>
        </View>
        <View style={styles.userBadges}>
          {!!user.isAdmin && <StatusBadge status="Admin" />}
          <StatusBadge status={user.active ? "Active" : "Inactive"} />
        </View>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.expandedBody}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Administrator (full access)</Text>
            <Switch
              value={isAdmin}
              onValueChange={setIsAdmin}
              disabled={isSelf}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Account active</Text>
            <Switch
              value={active}
              onValueChange={setActive}
              disabled={isSelf}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          {isSelf && <Text style={styles.selfNote}>You can't change your own admin or active status.</Text>}

          <Text style={styles.sectionLabel}>Module access</Text>
          {isAdmin ? (
            <Text style={styles.adminNote}>Administrators automatically have every module.</Text>
          ) : (
            <View style={styles.moduleGrid}>
              {MODULE_KEYS.map((key) => {
                const granted = permissions.includes(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => toggleModule(key)}
                    style={[styles.moduleChip, granted && styles.moduleChipOn]}
                  >
                    <Text style={[styles.moduleChipText, granted && styles.moduleChipTextOn]}>{titleCase(key)}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.saveRow}>
            <PrimaryButton label="Save access" onPress={save} loading={update.isPending} disabled={!dirty} />
          </View>
        </View>
      )}
    </Card>
  );
}

export default function UserAccessScreen() {
  const usersQuery = useAdminUsers();
  const { user: currentUser } = useAuth();

  if (usersQuery.isLoading) return <CenteredSpinner />;

  if (usersQuery.isError) {
    return (
      <Screen>
        <BackHeader label="Profile" />
        <EmptyState
          title="Couldn't load users"
          subtitle="Only administrators can manage user access. Check your connection and try again."
        />
      </Screen>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <Screen>
      <BackHeader label="Profile" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>User access</Text>
        <Text style={styles.subtitle}>Tap a user to grant or revoke module access.</Text>
        {users.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          users.map((u) => <UserRow key={u.id} user={u} isSelf={u.id === currentUser?.id} />)
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.small, color: colors.textMuted, marginBottom: spacing.md },
  userCard: { marginBottom: spacing.sm, padding: 0, overflow: "hidden" },
  userHeader: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.sm },
  userName: { ...typography.h3, color: colors.text },
  userMeta: { ...typography.small, color: colors.textMuted },
  userBadges: { flexDirection: "row", gap: 6 },
  chevron: { color: colors.textMuted, marginLeft: spacing.xs },
  expandedBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  toggleLabel: { ...typography.body, color: colors.text },
  selfNote: { ...typography.small, color: colors.textMuted, fontStyle: "italic", marginBottom: spacing.xs },
  sectionLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  adminNote: { ...typography.small, color: colors.textMuted },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  moduleChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  moduleChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  moduleChipText: { ...typography.small, color: colors.text, fontWeight: "600" },
  moduleChipTextOn: { color: colors.primaryForeground },
  saveRow: { marginTop: spacing.md },
});
