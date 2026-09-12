import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Users, Wallet, UserCheck } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, formatDate, titleCase } from "@/lib/format";
import type { Staff as StaffMember } from "@shared/schema";

const departments = ["front_desk", "housekeeping", "bar", "restaurant", "maintenance", "security", "management", "other"];

const staffFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.string().min(1, "Role is required"),
  department: z.string().min(1),
  salary: z.coerce.number().nonnegative("Salary can't be negative"),
  phone: z.string().optional().nullable(),
  status: z.string().min(1),
  hireDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function StaffFormDialog({ member, trigger }: { member?: StaffMember; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof staffFormSchema>>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: member
      ? { name: member.name, role: member.role, department: member.department, salary: member.salary, phone: member.phone ?? "", status: member.status, hireDate: member.hireDate ?? "", notes: member.notes ?? "" }
      : { name: "", role: "", department: "front_desk", salary: 0, phone: "", status: "active", hireDate: "", notes: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof staffFormSchema>) => {
      if (member) return apiRequest("PATCH", `/api/staff/${member.id}`, values);
      return apiRequest("POST", "/api/staff", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: member ? "Staff record updated" : "Staff member added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{member ? "Edit staff member" : "Add staff member"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-staff-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Job title</FormLabel>
                  <FormControl><Input placeholder="e.g. Receptionist" {...field} data-testid="input-staff-role" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="department" render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-staff-department"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {departments.map((d) => <SelectItem key={d} value={d}>{titleCase(d)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="salary" render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly salary (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-staff-salary" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="hireDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Hire date (optional)</FormLabel>
                  <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-staff-hire-date" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-staff-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-staff-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-staff">
                {mutation.isPending ? "Saving..." : "Save staff member"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "secondary",
  inactive: "outline",
};

export default function Staff() {
  const { toast } = useToast();
  const { data: staff = [], isLoading } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });

  const deleteStaff = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/staff"] }); toast({ title: "Staff member removed" }); },
  });

  const activeStaff = staff.filter((s) => s.status === "active");
  const monthlyPayroll = activeStaff.reduce((sum, s) => sum + s.salary, 0);
  const sorted = [...staff].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Staff"
        description="Manage the team and track monthly payroll cost."
        action={<StaffFormDialog trigger={<Button size="sm" data-testid="button-new-staff"><Plus className="h-4 w-4 mr-1" /> Add staff</Button>} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total staff" value={String(staff.length)} icon={Users} testId="stat-staff-count" />
        <StatCard label="Active staff" value={String(activeStaff.length)} icon={UserCheck} accent="success" testId="stat-active-staff" />
        <StatCard label="Monthly payroll" value={formatKES(monthlyPayroll)} icon={Wallet} accent="warning" testId="stat-monthly-payroll" />
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading staff…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No staff records yet. Add the first team member.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Monthly salary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((s) => (
                  <TableRow key={s.id} data-testid={`row-staff-${s.id}`}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.role}</TableCell>
                    <TableCell>{titleCase(s.department)}</TableCell>
                    <TableCell>{s.phone || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(s.salary)}</TableCell>
                    <TableCell><Badge variant={statusVariant[s.status]}>{titleCase(s.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <StaffFormDialog member={s} trigger={
                          <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-staff-${s.id}`}><Pencil className="h-4 w-4" /></Button>
                        } />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-staff-${s.id}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
                              <AlertDialogDescription>This deletes their staff record permanently.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteStaff.mutate(s.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
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
    </div>
  );
}
