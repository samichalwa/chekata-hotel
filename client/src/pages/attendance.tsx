import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarCheck, Save, Trash2, Users } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatDate, titleCase, todayISO } from "@/lib/format";
import type { Staff as StaffMember, AttendanceRecord } from "@shared/schema";

const statusOptions = ["present", "absent", "half_day", "on_leave", "rest_day"];
const statusLabel: Record<string, string> = { present: "Present", absent: "Absent", half_day: "Half day", on_leave: "On leave", rest_day: "Rest day" };
const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  present: "secondary", absent: "destructive", half_day: "outline", on_leave: "default", rest_day: "outline",
};

function monthStart(): string { return `${todayISO().slice(0, 7)}-01`; }

type RowState = { status: string; timeIn: string; timeOut: string; hoursWorked: string; notes: string };

function DailyEntryTab() {
  const { toast } = useToast();
  const { data: user } = useCurrentUser();
  const [date, setDate] = useState(todayISO());
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const activeStaff = useMemo(() => staff.filter((s) => s.status === "active").sort((a, b) => a.name.localeCompare(b.name)), [staff]);

  const { data: records = [], isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance", { from: date, to: date }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/attendance?from=${date}&to=${date}`);
      return res.json();
    },
  });

  const [rows, setRows] = useState<Record<number, RowState>>({});

  useEffect(() => {
    const next: Record<number, RowState> = {};
    for (const s of activeStaff) {
      const existing = records.find((r) => r.staffId === s.id);
      next[s.id] = existing
        ? { status: existing.status, timeIn: existing.timeIn ?? "", timeOut: existing.timeOut ?? "", hoursWorked: String(existing.hoursWorked ?? 0), notes: existing.notes ?? "" }
        : { status: "present", timeIn: "", timeOut: "", hoursWorked: "0", notes: "" };
    }
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, records.length, activeStaff.length]);

  const setRow = (staffId: number, patch: Partial<RowState>) => setRows((prev) => ({ ...prev, [staffId]: { ...prev[staffId], ...patch } }));

  const saveAll = useMutation({
    mutationFn: async () => {
      const recordedBy = user?.fullName ?? user?.username ?? "system";
      await Promise.all(activeStaff.map((s) => {
        const row = rows[s.id];
        if (!row) return Promise.resolve();
        return apiRequest("POST", "/api/attendance", {
          staffId: s.id, date, status: row.status, timeIn: row.timeIn || null, timeOut: row.timeOut || null,
          hoursWorked: Number(row.hoursWorked) || 0, notes: row.notes || null, recordedBy,
        });
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      toast({ title: `Attendance saved for ${formatDate(date)}` });
    },
    onError: (err: Error) => toast({ title: "Could not save attendance", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <div className="p-4 flex flex-wrap items-end gap-4 border-b">
        <div>
          <label className="text-sm font-medium">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="input-attendance-date" />
        </div>
        <Button onClick={() => saveAll.mutate()} disabled={saveAll.isPending || activeStaff.length === 0} data-testid="button-save-attendance">
          <Save className="h-4 w-4 mr-1" /> {saveAll.isPending ? "Saving..." : "Save all"}
        </Button>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : activeStaff.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No active staff to record attendance for.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time in</TableHead>
                <TableHead>Time out</TableHead>
                <TableHead>Hours worked</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeStaff.map((s) => {
                const row = rows[s.id] ?? { status: "present", timeIn: "", timeOut: "", hoursWorked: "0", notes: "" };
                return (
                  <TableRow key={s.id} data-testid={`row-attendance-${s.id}`}>
                    <TableCell className="font-medium whitespace-nowrap">{s.name}</TableCell>
                    <TableCell>
                      <Select value={row.status} onValueChange={(v) => setRow(s.id, { status: v })}>
                        <SelectTrigger className="w-36" data-testid={`select-attendance-status-${s.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((opt) => <SelectItem key={opt} value={opt}>{statusLabel[opt]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="time" value={row.timeIn} onChange={(e) => setRow(s.id, { timeIn: e.target.value })} className="w-28" data-testid={`input-attendance-timein-${s.id}`} /></TableCell>
                    <TableCell><Input type="time" value={row.timeOut} onChange={(e) => setRow(s.id, { timeOut: e.target.value })} className="w-28" data-testid={`input-attendance-timeout-${s.id}`} /></TableCell>
                    <TableCell><Input type="number" step="0.5" value={row.hoursWorked} onChange={(e) => setRow(s.id, { hoursWorked: e.target.value })} className="w-24" data-testid={`input-attendance-hours-${s.id}`} /></TableCell>
                    <TableCell><Input value={row.notes} onChange={(e) => setRow(s.id, { notes: e.target.value })} className="w-40" data-testid={`input-attendance-notes-${s.id}`} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function RegisterTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const { data: records = [], isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance", { from, to }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/attendance?from=${from}&to=${to}`);
      return res.json();
    },
  });

  const deleteRecord = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/attendance/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/attendance"] }); toast({ title: "Attendance record removed" }); },
  });

  return (
    <Card>
      <div className="p-4 flex flex-wrap items-end gap-4 border-b">
        <div>
          <label className="text-sm font-medium">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" data-testid="input-register-from" />
        </div>
        <div>
          <label className="text-sm font-medium">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" data-testid="input-register-to" />
        </div>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : records.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No attendance records for this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time in</TableHead>
                <TableHead>Time out</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id} data-testid={`row-register-${r.id}`}>
                  <TableCell>{formatDate(r.date)}</TableCell>
                  <TableCell className="font-medium">{staffMap.get(r.staffId)?.name ?? `Staff #${r.staffId}`}</TableCell>
                  <TableCell><Badge variant={statusVariant[r.status]}>{statusLabel[r.status] ?? titleCase(r.status)}</Badge></TableCell>
                  <TableCell>{r.timeIn || "—"}</TableCell>
                  <TableCell>{r.timeOut || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.hoursWorked}</TableCell>
                  <TableCell>{r.recordedBy}</TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-attendance-${r.id}`}><Trash2 className="h-4 w-4" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this attendance record?</AlertDialogTitle>
                          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteRecord.mutate(r.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function Attendance() {
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const activeCount = staff.filter((s) => s.status === "active").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Attendance" description="Record daily attendance and review the attendance register." />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Active staff" value={String(activeCount)} icon={Users} testId="stat-attendance-active-staff" />
        <StatCard label="Today" value={formatDate(todayISO())} icon={CalendarCheck} testId="stat-attendance-today" />
      </div>

      <Tabs defaultValue="entry">
        <TabsList>
          <TabsTrigger value="entry" data-testid="tab-attendance-entry">Daily entry</TabsTrigger>
          <TabsTrigger value="register" data-testid="tab-attendance-register">Register</TabsTrigger>
        </TabsList>
        <TabsContent value="entry" className="mt-4"><DailyEntryTab /></TabsContent>
        <TabsContent value="register" className="mt-4"><RegisterTab /></TabsContent>
      </Tabs>
    </div>
  );
}
