import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Linking, Alert, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../../context/AuthContext";
import { hasAnyModule } from "../../api/types";
import { Screen, CenteredSpinner, EmptyState, PrimaryButton } from "../../components/ui";
import { colors, spacing, typography, radius } from "../../theme/theme";
import { formatKes } from "../../utils/format";
import { fetchDailyReportShare, sendDailyReportNow, whatsappDigits } from "../../api/director";
import {
  useDirectorSummary,
  useNotifications,
  useMarkNotificationsRead,
  mobileTarget,
  relativeTime,
  type DirectorAlert,
} from "../../api/director";

const APPROVAL_MODULES = ["purchasing", "internal-requisitions", "hr", "leave", "payroll", "finance"] as const;

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const SEVERITY: Record<DirectorAlert["severity"], { bar: string; bg: string; fg: string; label: string }> = {
  critical: { bar: colors.danger, bg: colors.dangerBg, fg: colors.danger, label: "Urgent" },
  warning: { bar: colors.warning, bg: colors.warningBg, fg: colors.warning, label: "Check" },
  info: { bar: colors.info, bg: colors.infoBg, fg: colors.info, label: "FYI" },
};

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Row({
  label,
  sub,
  value,
  valueColor,
  onPress,
  last,
}: {
  label: string;
  sub?: string | null;
  value?: string;
  valueColor?: string;
  onPress?: (() => void) | null;
  last?: boolean;
}) {
  const content = (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text> : null}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);

  const summaryQ = useDirectorSummary(!!user);
  const notifQ = useNotifications(!!user);
  const markRead = useMarkNotificationsRead();
  const canApprove = hasAnyModule(user, [...APPROVAL_MODULES]);

  // Only navigate to tabs this user actually has; the summary is already
  // permission-filtered but tab visibility uses slightly different rules.
  const go = useCallback(
    (link: string | null | undefined) => {
      const t = mobileTarget(link);
      if (!t) return null;
      const names: string[] = navigation.getState?.()?.routeNames ?? [];
      if (!names.includes(t.name)) return null;
      return () => navigation.navigate(t.name, t.params);
    },
    [navigation],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([summaryQ.refetch(), notifQ.refetch()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (summaryQ.isLoading) return <CenteredSpinner />;

  if (summaryQ.isError || !summaryQ.data) {
    return (
      <Screen>
        <View style={styles.container}>
          <EmptyState title="Couldn't load today's briefing" subtitle="Check your connection and try again." />
          <PrimaryButton label="Try again" onPress={() => summaryQ.refetch()} />
        </View>
      </Screen>
    );
  }

  const s = summaryQ.data;
  const streams = [...s.income.streams].sort((a, b) => b.today - a.today);
  const maxStream = Math.max(1, ...streams.map((x) => x.today));
  const delta = s.income.totalToday - s.income.totalYesterday;
  const notifs = notifQ.data?.items ?? [];
  const unread = notifQ.data?.unread ?? 0;
  const receivablesTotal = s.receivables.reduce((a, r) => a + r.amount, 0);
  const firstName = user?.fullName?.split(" ")[0] ?? "there";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>Hello, {firstName}</Text>
        <Text style={styles.date}>Today · {longDate(s.date)}</Text>
        <Text style={styles.updated}>Updated {clock(s.generatedAt)} · pull down to refresh</Text>

        {/* Headline numbers */}
        <View style={styles.kpis}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Income today</Text>
            <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>{formatKes(s.income.totalToday)}</Text>
            <Text style={[styles.kpiSub, { color: delta >= 0 ? colors.success : colors.danger }]}>
              {delta >= 0 ? "▲" : "▼"} {formatKes(Math.abs(delta))} vs yesterday
            </Text>
          </View>
          {canApprove ? (
            <Pressable style={styles.kpi} onPress={go("/approvals") ?? undefined}>
              <Text style={styles.kpiLabel}>Awaiting approval</Text>
              <Text style={[styles.kpiValue, s.approvals.total > 0 && { color: colors.warning }]}>{s.approvals.total}</Text>
              <Text style={styles.kpiSub}>{s.approvals.total > 0 ? "Tap to review ›" : "All clear"}</Text>
            </Pressable>
          ) : null}
          {s.rooms ? (
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Occupancy</Text>
              <Text style={styles.kpiValue}>{s.rooms.occupancyPct}%</Text>
              <Text style={styles.kpiSub}>{s.rooms.inHouse} of {s.rooms.total} rooms</Text>
            </View>
          ) : null}
          {s.cash ? (
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Cash & bank</Text>
              <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>{formatKes(s.cash.total)}</Text>
              <Text style={styles.kpiSub}>{s.cash.accounts.length} accounts</Text>
            </View>
          ) : null}
        </View>

        {user?.isAdmin ? <DailyClose date={s.date} /> : null}

        {/* Alerts */}
        <Card title="Needs your attention" right={<Text style={styles.countPill}>{s.alerts.length}</Text>}>
          {s.alerts.length === 0 ? (
            <Text style={styles.allClear}>Nothing needs you right now.</Text>
          ) : (
            s.alerts.map((a) => {
              const sev = SEVERITY[a.severity];
              const onPress = go(a.link);
              const body = (
                <View style={[styles.alert, { borderLeftColor: sev.bar }]}>
                  <View style={styles.alertText}>
                    <View style={styles.alertHead}>
                      <Text style={[styles.sevTag, { backgroundColor: sev.bg, color: sev.fg }]}>{sev.label}</Text>
                    </View>
                    <Text style={styles.alertTitle}>{a.title}</Text>
                    {a.detail ? <Text style={styles.alertDetail}>{a.detail}</Text> : null}
                  </View>
                  {onPress ? <Text style={styles.chevron}>›</Text> : null}
                </View>
              );
              return onPress ? <Pressable key={a.id} onPress={onPress}>{body}</Pressable> : <View key={a.id}>{body}</View>;
            })
          )}
        </Card>

        {/* Income by stream */}
        {streams.length > 0 ? (
          <Card title="Income today by stream">
            <Text style={styles.streamTotals}>
              Yesterday <Text style={styles.bold}>{formatKes(s.income.totalYesterday)}</Text>   ·   Month to date <Text style={styles.bold}>{formatKes(s.income.totalMtd)}</Text>
            </Text>
            {streams.map((st, i) => {
              const onPress = go(st.link);
              const inner = (
                <View style={[styles.stream, i === streams.length - 1 && styles.rowLast]}>
                  <View style={styles.streamHead}>
                    <Text style={styles.streamLabel} numberOfLines={1}>
                      {st.label}
                      {st.todayCount > 0 ? <Text style={styles.muted}> · {st.todayCount}</Text> : null}
                    </Text>
                    <Text style={styles.streamAmount}>{formatKes(st.today)}</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round((st.today / maxStream) * 100)}%` }]} />
                  </View>
                  <Text style={styles.streamMtd}>Yesterday {formatKes(st.yesterday)} · MTD {formatKes(st.mtd)}</Text>
                </View>
              );
              return onPress ? <Pressable key={st.key} onPress={onPress}>{inner}</Pressable> : <View key={st.key}>{inner}</View>;
            })}
          </Card>
        ) : null}

        {/* Operations */}
        {s.rooms || s.events.length || s.shows.length || s.people ? (
          <Card title="Operations today">
            {s.rooms ? (
              <View style={styles.tiles}>
                <View style={styles.tile}><Text style={styles.tileNum}>{s.rooms.arrivals}</Text><Text style={styles.tileLbl}>Arrivals</Text></View>
                <View style={styles.tile}><Text style={styles.tileNum}>{s.rooms.departures}</Text><Text style={styles.tileLbl}>Departures</Text></View>
                <View style={styles.tile}><Text style={[styles.tileNum, s.rooms.outOfOrder > 0 && { color: colors.danger }]}>{s.rooms.outOfOrder}</Text><Text style={styles.tileLbl}>Out of order</Text></View>
              </View>
            ) : null}
            {s.arrivals.length > 0 ? <Text style={styles.subhead}>Arriving today</Text> : null}
            {s.arrivals.map((a, i) => (
              <Row
                key={`a${a.id}`}
                label={a.guestName}
                sub={a.roomName}
                value={a.balance > 0 ? `${formatKes(a.balance)} due` : "Paid"}
                valueColor={a.balance > 0 ? colors.warning : colors.success}
                onPress={go("/accommodation")}
                last={i === s.arrivals.length - 1}
              />
            ))}
            {s.events.length > 0 ? <Text style={styles.subhead}>Events today</Text> : null}
            {s.events.map((e, i) => (
              <Row
                key={`e${e.id}`}
                label={e.clientName}
                sub={[e.facilityName, e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime].filter(Boolean).join(" · ")}
                value={formatKes(e.amount)}
                onPress={go("/facilities")}
                last={i === s.events.length - 1}
              />
            ))}
            {s.shows.length > 0 ? <Text style={styles.subhead}>Movie shows today</Text> : null}
            {s.shows.map((m, i) => (
              <Row
                key={`m${m.id}`}
                label={m.title}
                sub={m.time}
                value={`${m.sold}/${m.capacity} seats`}
                onPress={go("/movie-room")}
                last={i === s.shows.length - 1}
              />
            ))}
            {s.people ? (
              <>
                <Text style={styles.subhead}>People</Text>
                <Row
                  label="Staff on duty"
                  sub={s.people.names.length ? `On leave: ${s.people.names.join(", ")}` : null}
                  value={`${s.people.activeStaff - s.people.onLeaveToday} / ${s.people.activeStaff}`}
                  last
                />
              </>
            ) : null}
          </Card>
        ) : null}

        {/* Money position */}
        {s.cash || s.receivables.length || s.expenses || s.budget ? (
          <Card title="Money position">
            {s.cash
              ? s.cash.accounts.map((acc, i) => (
                  <Row key={`c${acc.id}`} label={acc.name} value={formatKes(acc.balance)} onPress={go("/finance")} last={i === s.cash!.accounts.length - 1 && !s.receivables.length} />
                ))
              : null}
            {s.receivables.length > 0 ? (
              <>
                <View style={styles.subheadRow}>
                  <Text style={styles.subhead}>Owed to the hotel</Text>
                  <Text style={styles.subheadValue}>{formatKes(receivablesTotal)}</Text>
                </View>
                {s.receivables.map((r, i) => (
                  <Row key={r.key} label={r.label} sub={`${r.count} open`} value={formatKes(r.amount)} onPress={go(r.link)} last={i === s.receivables.length - 1} />
                ))}
              </>
            ) : null}
            {s.expenses ? (
              <>
                <Text style={styles.subhead}>Expenses</Text>
                <Row label="Today" value={formatKes(s.expenses.today)} onPress={go("/expenses")} />
                <Row label="Month to date" value={formatKes(s.expenses.mtd)} onPress={go("/expenses")} last />
              </>
            ) : null}
            {s.budget && s.budget.budgeted > 0 ? (
              <View style={styles.budget}>
                <View style={styles.streamHead}>
                  <Text style={styles.streamLabel}>Income vs budget ({s.budget.month})</Text>
                  <Text style={styles.streamAmount}>{s.budget.pctOfBudget}%</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.min(100, s.budget.pctOfBudget)}%` }]} />
                  <View style={[styles.marker, { left: `${Math.min(100, Math.round((s.budget.proRataBudget / s.budget.budgeted) * 100))}%` }]} />
                </View>
                <Text style={styles.streamMtd}>
                  {formatKes(s.budget.actual)} posted of {formatKes(s.budget.budgeted)} · target by today {formatKes(s.budget.proRataBudget)}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Activity feed (in-app notifications) */}
        <Card
          title="Recent activity"
          right={
            unread > 0 ? (
              <Pressable onPress={() => markRead.mutate(undefined)} hitSlop={8}>
                <Text style={styles.link}>Mark {unread} read</Text>
              </Pressable>
            ) : null
          }
        >
          {notifs.length === 0 ? (
            <Text style={styles.allClear}>No activity yet. New bookings, approval requests and decisions will appear here.</Text>
          ) : (
            notifs.slice(0, 8).map((n, i) => {
              const nav = go(n.linkPath);
              const onPress = () => {
                if (!n.readAt) markRead.mutate([n.id]);
                nav?.();
              };
              return (
                <Pressable key={n.id} onPress={onPress}>
                  <View style={[styles.row, i === Math.min(notifs.length, 8) - 1 && styles.rowLast]}>
                    {!n.readAt ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, !n.readAt && styles.bold]} numberOfLines={1}>{n.title}</Text>
                      {n.body ? <Text style={styles.rowSub} numberOfLines={2}>{n.body}</Text> : null}
                      <Text style={styles.time}>{relativeTime(n.createdAt)}</Text>
                    </View>
                    {nav ? <Text style={styles.chevron}>›</Text> : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function notify(title: string, msg?: string) {
  if (Platform.OS === "web") (globalThis as any).alert?.(msg ? `${title}\n${msg}` : title);
  else Alert.alert(title, msg);
}

// Daily close report: WhatsApp (summary + PDF link), open the PDF, or email it now.
function DailyClose({ date }: { date: string }) {
  const [busy, setBusy] = useState<null | "wa" | "pdf" | "send">(null);
  const run = (k: "wa" | "pdf" | "send", fn: () => Promise<void>) => async () => {
    setBusy(k);
    try { await fn(); } catch (e: any) { notify("Something went wrong", e?.response?.data?.error ?? e?.message); } finally { setBusy(null); }
  };
  const whatsapp = run("wa", async () => {
    const sh = await fetchDailyReportShare(date);
    const text = encodeURIComponent(`${sh.text}\n\nFull report (PDF): ${sh.url}`);
    const phone = whatsappDigits(sh.whatsappPhone);
    await Linking.openURL(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`);
  });
  const pdf = run("pdf", async () => { await Linking.openURL((await fetchDailyReportShare(date)).url); });
  const send = run("send", async () => {
    const r = await sendDailyReportNow(date);
    if (r.emails.length === 0 && r.sms.length === 0) notify("No recipients set", "Add email addresses in CHAIMS Settings → Daily report. Admins were alerted in the app.");
    else notify("Daily close sent", `Email ${r.emails.filter((x) => x.ok).length}/${r.emails.length}${r.sms.length ? ` · SMS ${r.sms.filter((x) => x.ok).length}/${r.sms.length}` : ""}`);
  });
  const Btn = ({ label, onPress, k }: { label: string; onPress: () => void; k: "wa" | "pdf" | "send" }) => (
    <Pressable onPress={onPress} disabled={busy !== null} style={[styles.dcBtn, busy !== null && { opacity: 0.6 }]} accessibilityRole="button" testID={`daily-${k}`}>
      <Text style={styles.dcBtnText}>{busy === k ? "…" : label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.dcWrap}>
      <Text style={styles.dcTitle}>Daily close report</Text>
      <View style={styles.dcRow}>
        <Btn label="WhatsApp" onPress={whatsapp} k="wa" />
        <Btn label="Open PDF" onPress={pdf} k="pdf" />
        <Btn label="Email now" onPress={send} k="send" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dcWrap: { marginBottom: spacing.md },
  dcTitle: { fontSize: 12, fontWeight: "600", color: colors.textMuted, marginBottom: 6 },
  dcRow: { flexDirection: "row", gap: 8 },
  dcBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dcBtnText: { fontSize: 13, fontWeight: "600", color: colors.primary },
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  greeting: { ...typography.h1, color: colors.text },
  date: { ...typography.h3, color: colors.text, marginTop: 2 },
  updated: { ...typography.small, color: colors.textMuted, marginBottom: spacing.md },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  kpi: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    width: "48.5%",
    flexGrow: 1,
  },
  kpiLabel: { ...typography.small, color: colors.textMuted, marginBottom: 4 },
  kpiValue: { fontSize: 22, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
  kpiSub: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  cardTitle: { ...typography.label, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  countPill: { ...typography.label, color: colors.text, backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  allClear: { ...typography.body, color: colors.textMuted },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  alertText: { flex: 1 },
  alertHead: { flexDirection: "row", marginBottom: 4 },
  sevTag: { ...typography.label, fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, overflow: "hidden" },
  alertTitle: { ...typography.body, fontWeight: "600", color: colors.text },
  alertDetail: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  streamTotals: { ...typography.small, color: colors.textMuted, marginBottom: spacing.sm },
  bold: { fontWeight: "700", color: colors.text },
  muted: { color: colors.textMuted, fontWeight: "400" },
  stream: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  streamHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm, marginBottom: 6 },
  streamLabel: { ...typography.body, color: colors.text, fontWeight: "600", flexShrink: 1 },
  streamAmount: { ...typography.body, color: colors.text, fontWeight: "700", fontVariant: ["tabular-nums"] },
  streamMtd: { ...typography.small, color: colors.textMuted, marginTop: 4 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "visible", position: "relative" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  marker: { position: "absolute", top: -3, width: 2, height: 12, marginLeft: -1, backgroundColor: colors.text },
  tiles: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs },
  tile: { flex: 1, backgroundColor: colors.background, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  tileNum: { fontSize: 20, fontWeight: "700", color: colors.text },
  tileLbl: { ...typography.small, color: colors.textMuted },
  subhead: { ...typography.label, color: colors.textMuted, marginTop: spacing.md, marginBottom: 2 },
  subheadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  subheadValue: { ...typography.label, color: colors.text, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...typography.body, color: colors.text },
  rowSub: { ...typography.small, color: colors.textMuted, marginTop: 1 },
  rowValue: { ...typography.body, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
  chevron: { fontSize: 20, color: colors.textMuted, marginLeft: 2 },
  budget: { marginTop: spacing.md },
  link: { ...typography.small, color: colors.primary, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  dotSpacer: { width: 8 },
  time: { ...typography.small, fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
