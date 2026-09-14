import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, CalendarDays, CheckCircle2, XCircle, Ban, ListChecks } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDate, titleCase, todayISO } from "@/lib/format";
import type { Staff as StaffMember, LeaveType, LeaveRequest, LeaveBalance } from "@shared/schema";

function daysInclusive(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch { /* not JSON */ }
  return body;
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline", approved: "secondary", rejected: "destructive", cancelled: "outline",
};

// ---------------- Leave Types ----------------
const leaveTypeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  entitlementDaysPerYear: z.coerce.number().nonnegative(),
  accrualMethod: z.enum(["annual", "monthly"]),
  isPaid: z.boolean(),
  genderRestriction: z.string().nullable().optional(),
  active: z.boolean(),
});

function LeaveTypeFormDialog({ leaveType, trigger }: { leaveType?: LeaveType; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof leaveTypeFormSchema>>({
    resolver: zodResolver(leaveTypeFormSchema),
    defaultValues: leaveType
      ? { name: leaveType.name, entitlementDaysPerYear: leaveType.entitlementDaysPerYear, accrualMethod: leaveType.accrualMethod as "annual" | "monthly", isPaid: !!leaveType.isPaid, genderRestriction: leaveType.genderRestriction ?? "", active: !!leaveType.active }
      : { name: "", entitlementDaysPerYear: 21, accrualMethod: "annual", isPaid: true, genderRestriction: "", active: true },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof leaveTypeFormSchema>) => {
      const payload = { ...values, isPaid: values.isPaid ? 1 : 0, active: values.active ? 1 : 0, genderRestriction: values.genderRestriction || null };
      if (leaveType) return apiRequest("PATCH", `/api/leave-types/${leaveType.id}`, payload);
      return apiRequest("POST", "/api/leave-types", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave-types"] });
      toast({ title: leaveType ? "Leave type updated" : "Leave type added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{leaveType ? "Edit leave type" : "Add leave type"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} data-testid="input-leavetype-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="entitlementDaysPerYear" render={({ field }) => (
                <FormItem><FormLabel>Entitlement days/year</FormLabel><FormControl><Input type="number" {...field} data-testid="input-leavetype-entitlement" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="accrualMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Accrual method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-leavetype-accrual"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="annual">Annual</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="genderRestriction" render={({ field }) => (
              <FormItem>
                <FormLabel>Gender restriction (optional)</FormLabel>
                <Select onValueChange={(v) => field.onChange(v === "none" ? "" : v)} value={field.value || "none"}>
                  <FormControl><SelectTrigger data-testid="select-leavetype-gender"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="male">Male only</SelectItem>
                    <SelectItem value="female">Female only</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-6">
              <FormField control={form.control} name="isPaid" render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-leavetype-paid" /></FormControl>
                  <FormLabel className="!mt-0">Paid leave</FormLabel>
                </FormItem>
              )} />
              <FormField control={form.control} name="active" render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-leavetype-active" /></FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-leavetype">{mutation.isPending ? "Saving..." : "Save leave type"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTypesTab() {
  const { toast } = useToast();
  const { data: leaveTypes = [], isLoading } = useQuery<LeaveType[]>({ queryKey: ["/api/leave-types"] });
  const deleteType = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/leave-types/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/leave-types"] }); toast({ title: "Leave type removed" }); },
  });

  return (
    <Card>
      <div className="p-4 flex justify-end border-b">
        <LeaveTypeFormDialog trigger={<Button size="sm" data-testid="button-new-leavetype"><Plus className="h-4 w-4 mr-1" /> Add leave type</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : leaveTypes.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No leave types yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Entitlement/yr</TableHead>
                <TableHead>Accrual</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Restriction</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveTypes.map((lt) => (
                <TableRow key={lt.id} data-testid={`row-leavetype-${lt.id}`}>
                  <TableCell className="font-medium">{lt.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{lt.entitlementDaysPerYear}</TableCell>
                  <TableCell>{titleCase(lt.accrualMethod)}</TableCell>
                  <TableCell>{lt.isPaid ? "Yes" : "No"}</TableCell>
                  <TableCell>{lt.genderRestriction ? titleCase(lt.genderRestriction) : "—"}</TableCell>
                  <TableCell><Badge variant={lt.active ? "secondary" : "outline"}>{lt.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <LeaveTypeFormDialog leaveType={lt} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-leavetype-${lt.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-leavetype-${lt.id}`}><Trash2 className="h-4 w-4" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {lt.name}?</AlertDialogTitle><AlertDialogDescription>This removes the leave type permanently.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteType.mutate(lt.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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

// ---------------- Leave Requests ----------------
const leaveRequestFormSchema = z.object({
  staffId: z.coerce.number().int().positive("Select a staff member"),
  leaveTypeId: z.coerce.number().int().positive("Select a leave type"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  reason: z.string().optional().nullable(),
});

function NewLeaveRequestDialog({ staff, leaveTypes }: { staff: StaffMember[]; leaveTypes: LeaveType[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof leaveRequestFormSchema>>({
    resolver: zodResolver(leaveRequestFormSchema),
    defaultValues: { staffId: 0, leaveTypeId: 0, startDate: todayISO(), endDate: todayISO(), reason: "" },
  });
  const startDate = form.watch("startDate");
  const endDate = form.watch("endDate");
  const days = daysInclusive(startDate, endDate);

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof leaveRequestFormSchema>) => {
      return apiRequest("POST", "/api/leave-requests", { ...values, days });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave-requests"] });
      toast({ title: "Leave request submitted" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Could not submit request", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-leaverequest"><Plus className="h-4 w-4 mr-1" /> New leave request</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New leave request</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="staffId" render={({ field }) => (
              <FormItem>
                <FormLabel>Staff member</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                  <FormControl><SelectTrigger data-testid="select-leaverequest-staff"><SelectValue placeholder="Select staff" /></SelectTrigger></FormControl>
                  <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="leaveTypeId" render={({ field }) => (
              <FormItem>
                <FormLabel>Leave type</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                  <FormControl><SelectTrigger data-testid="select-leaverequest-type"><SelectValue placeholder="Select leave type" /></SelectTrigger></FormControl>
                  <SelectContent>{leaveTypes.filter((lt) => lt.active).map((lt) => <SelectItem key={lt.id} value={String(lt.id)}>{lt.name}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem><FormLabel>Start date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-leaverequest-start" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem><FormLabel>End date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-leaverequest-end" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <p className="text-sm text-muted-foreground">Total: <span className="font-medium">{days} day{days === 1 ? "" : "s"}</span> (inclusive of start and end date)</p>
            <FormField control={form.control} name="reason" render={({ field }) => (
              <FormItem><FormLabel>Reason (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-leaverequest-reason" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending || days <= 0} data-testid="button-submit-leaverequest">{mutation.isPending ? "Submitting..." : "Submit request"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveRequestsTab() {
  const { toast } = useToast();
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({ queryKey: ["/api/leave-types"] });
  const { data: requests = [], isLoading } = useQuery<LeaveRequest[]>({ queryKey: ["/api/leave-requests"] });
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const typeMap = useMemo(() => new Map(leaveTypes.map((lt) => [lt.id, lt])), [leaveTypes]);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) => apiRequest("POST", `/api/leave-requests/${id}/${action}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/leave-requests"] }); queryClient.invalidateQueries({ queryKey: ["/api/leave-balances"] }); toast({ title: "Leave request updated" }); },
    onError: (err: Error) => toast({ title: "Could not update request", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiRequest("POST", `/api/leave-requests/${id}/cancel`, { reason }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/leave-requests"] }); queryClient.invalidateQueries({ queryKey: ["/api/leave-balances"] }); toast({ title: "Leave request cancelled" }); setCancelTarget(null); setCancelReason(""); },
    onError: (err: Error) => toast({ title: "Could not cancel request", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const sorted = [...requests].sort((a, b) => b.id - a.id);

  return (
    <Card>
      <div className="p-4 flex justify-end border-b">
        <NewLeaveRequestDialog staff={staff} leaveTypes={leaveTypes} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No leave requests yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Leave type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id} data-testid={`row-leaverequest-${r.id}`}>
                  <TableCell className="font-medium">{staffMap.get(r.staffId)?.name ?? `Staff #${r.staffId}`}</TableCell>
                  <TableCell>{typeMap.get(r.leaveTypeId)?.name ?? `#${r.leaveTypeId}`}</TableCell>
                  <TableCell>{formatDate(r.startDate)} – {formatDate(r.endDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                  <TableCell><Badge variant={statusVariant[r.status]}>{titleCase(r.status)}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.reason ?? ""}>{r.reason || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.status === "pending" && (
                        <>
                          <Button size="icon" variant="ghost" title="Approve" onClick={() => decide.mutate({ id: r.id, action: "approve" })} data-testid={`button-approve-leaverequest-${r.id}`}><CheckCircle2 className="h-4 w-4 text-green-600" /></Button>
                          <Button size="icon" variant="ghost" title="Reject" onClick={() => decide.mutate({ id: r.id, action: "reject" })} data-testid={`button-reject-leaverequest-${r.id}`}><XCircle className="h-4 w-4 text-red-600" /></Button>
                        </>
                      )}
                      {(r.status === "pending" || r.status === "approved") && (
                        <AlertDialog open={cancelTarget?.id === r.id} onOpenChange={(o) => { if (!o) { setCancelTarget(null); setCancelReason(""); } }}>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Cancel" onClick={() => setCancelTarget(r)} data-testid={`button-cancel-leaverequest-${r.id}`}><Ban className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Cancel this leave request?</AlertDialogTitle><AlertDialogDescription>Provide a reason for the cancellation.</AlertDialogDescription></AlertDialogHeader>
                            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancellation" data-testid="input-cancel-leaverequest-reason" />
                            <AlertDialogFooter>
                              <AlertDialogCancel>Back</AlertDialogCancel>
                              <AlertDialogAction onClick={() => cancelTarget && cancel.mutate({ id: cancelTarget.id, reason: cancelReason })}>Confirm cancel</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
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

// ---------------- Leave Balances ----------------
function LeaveBalancesTab() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const { toast } = useToast();
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });
  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({ queryKey: ["/api/leave-types"] });
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const typeMap = useMemo(() => new Map(leaveTypes.map((lt) => [lt.id, lt])), [leaveTypes]);

  const { data: balances = [], isLoading } = useQuery<LeaveBalance[]>({
    queryKey: ["/api/leave-balances", { year }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/leave-balances?year=${year}`);
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ staffId: "", leaveTypeId: "", entitlement: "0", taken: "0" });
  const upsert = useMutation({
    mutationFn: () => apiRequest("POST", "/api/leave-balances", {
      staffId: Number(form.staffId), leaveTypeId: Number(form.leaveTypeId), year: Number(year),
      entitlement: Number(form.entitlement), taken: Number(form.taken),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave-balances"] });
      toast({ title: "Leave balance saved" });
      setOpen(false);
      setForm({ staffId: "", leaveTypeId: "", entitlement: "0", taken: "0" });
    },
    onError: (err: Error) => toast({ title: "Could not save balance", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Card>
      <div className="p-4 flex flex-wrap items-end justify-between gap-4 border-b">
        <div>
          <label className="text-sm font-medium">Year</label>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-28" data-testid="input-balances-year" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" data-testid="button-new-leavebalance"><Plus className="h-4 w-4 mr-1" /> Add / update balance</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add or update a leave balance</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Staff member</label>
                <Select value={form.staffId} onValueChange={(v) => setForm((f) => ({ ...f, staffId: v }))}>
                  <SelectTrigger data-testid="select-balance-staff"><SelectValue placeholder="Select staff" /></SelectTrigger>
                  <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Leave type</label>
                <Select value={form.leaveTypeId} onValueChange={(v) => setForm((f) => ({ ...f, leaveTypeId: v }))}>
                  <SelectTrigger data-testid="select-balance-type"><SelectValue placeholder="Select leave type" /></SelectTrigger>
                  <SelectContent>{leaveTypes.map((lt) => <SelectItem key={lt.id} value={String(lt.id)}>{lt.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Entitlement (days)</label>
                  <Input type="number" value={form.entitlement} onChange={(e) => setForm((f) => ({ ...f, entitlement: e.target.value }))} data-testid="input-balance-entitlement" />
                </div>
                <div>
                  <label className="text-sm font-medium">Taken (days)</label>
                  <Input type="number" value={form.taken} onChange={(e) => setForm((f) => ({ ...f, taken: e.target.value }))} data-testid="input-balance-taken" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => upsert.mutate()} disabled={upsert.isPending || !form.staffId || !form.leaveTypeId} data-testid="button-save-leavebalance">
                {upsert.isPending ? "Saving..." : "Save balance"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : balances.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No leave balances recorded for {year} yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Leave type</TableHead>
                <TableHead className="text-right">Entitlement</TableHead>
                <TableHead className="text-right">Taken</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow key={b.id} data-testid={`row-leavebalance-${b.id}`}>
                  <TableCell className="font-medium">{staffMap.get(b.staffId)?.name ?? `Staff #${b.staffId}`}</TableCell>
                  <TableCell>{typeMap.get(b.leaveTypeId)?.name ?? `#${b.leaveTypeId}`}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.entitlement}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.taken}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{Math.max(0, b.entitlement - b.taken)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function Leave() {
  const { data: requests = [] } = useQuery<LeaveRequest[]>({ queryKey: ["/api/leave-requests"] });
  const pending = requests.filter((r) => r.status === "pending").length;
  const approved = requests.filter((r) => r.status === "approved").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Leave" description="Configure leave types, review requests, and track leave balances." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending requests" value={String(pending)} icon={ListChecks} accent="warning" testId="stat-leave-pending" />
        <StatCard label="Approved requests" value={String(approved)} icon={CheckCircle2} accent="success" testId="stat-leave-approved" />
        <StatCard label="Total requests" value={String(requests.length)} icon={CalendarDays} testId="stat-leave-total" />
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests" data-testid="tab-leave-requests">Leave requests</TabsTrigger>
          <TabsTrigger value="types" data-testid="tab-leave-types">Leave types</TabsTrigger>
          <TabsTrigger value="balances" data-testid="tab-leave-balances">Leave balances</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="mt-4"><LeaveRequestsTab /></TabsContent>
        <TabsContent value="types" className="mt-4"><LeaveTypesTab /></TabsContent>
        <TabsContent value="balances" className="mt-4"><LeaveBalancesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
