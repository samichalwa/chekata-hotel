import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Users, Wallet, UserCheck, Upload } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, formatDate, titleCase } from "@/lib/format";
import type { Staff as StaffMember } from "@shared/schema";

const departments = ["front_desk", "housekeeping", "bar", "restaurant", "maintenance", "security", "management", "other"];

function fileToBase64(file: File): Promise<{ dataBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve({ dataBase64: result.slice(commaIdx + 1), mimeType: file.type });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {
    // not JSON, fall through
  }
  return body;
}

const staffFormSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    role: z.string().min(1, "Role is required"),
    department: z.string().min(1),
    employmentType: z.enum(["permanent", "temporary"]),
    salary: z.coerce.number().nonnegative("Salary can't be negative"),
    dayRate: z.coerce.number().nonnegative().optional().nullable(),
    hourRate: z.coerce.number().nonnegative().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
    status: z.string().min(1),
    hireDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    photoUrl: z.string().optional().nullable(),
    nationalId: z.string().optional().nullable(),
    nextOfKinName: z.string().optional().nullable(),
    nextOfKinPhone: z.string().optional().nullable(),
    bankName: z.string().optional().nullable(),
    bankAccountNumber: z.string().optional().nullable(),
    bankBranch: z.string().optional().nullable(),
  })
  .refine((v) => v.employmentType !== "temporary" || (v.dayRate ?? 0) > 0 || (v.hourRate ?? 0) > 0, {
    message: "Set a day rate or an hour rate for a temporary employee.",
    path: ["dayRate"],
  });

type StaffFormValues = z.infer<typeof staffFormSchema>;

function StaffFormDialog({ member, trigger }: { member?: StaffMember; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const { toast } = useToast();
  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: member
      ? {
          name: member.name,
          role: member.role,
          department: member.department,
          employmentType: (member.employmentType as "permanent" | "temporary") ?? "permanent",
          salary: member.salary,
          dayRate: member.dayRate ?? undefined,
          hourRate: member.hourRate ?? undefined,
          phone: member.phone ?? "",
          email: member.email ?? "",
          status: member.status,
          hireDate: member.hireDate ?? "",
          notes: member.notes ?? "",
          photoUrl: member.photoUrl ?? "",
          nationalId: member.nationalId ?? "",
          nextOfKinName: member.nextOfKinName ?? "",
          nextOfKinPhone: member.nextOfKinPhone ?? "",
          bankName: member.bankName ?? "",
          bankAccountNumber: member.bankAccountNumber ?? "",
          bankBranch: member.bankBranch ?? "",
        }
      : {
          name: "", role: "", department: "front_desk", employmentType: "permanent", salary: 0,
          dayRate: undefined, hourRate: undefined, phone: "", email: "", status: "active", hireDate: "", notes: "",
          photoUrl: "", nationalId: "", nextOfKinName: "", nextOfKinPhone: "", bankName: "", bankAccountNumber: "", bankBranch: "",
        },
  });

  const employmentType = form.watch("employmentType");

  const mutation = useMutation({
    mutationFn: async (values: StaffFormValues) => {
      let photoUrl = values.photoUrl ?? undefined;
      if (photoFile) {
        const encoded = await fileToBase64(photoFile);
        const res = await apiRequest("POST", "/api/staff/uploads", { filename: photoFile.name, ...encoded });
        photoUrl = (await res.json()).url;
      }
      const payload = { ...values, photoUrl };
      if (member) return apiRequest("PATCH", `/api/staff/${member.id}`, payload);
      return apiRequest("POST", "/api/staff", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: member ? "Staff record updated" : "Staff member added" });
      setOpen(false);
      setPhotoFile(null);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{member ? "Edit staff member" : "Add staff member"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={photoFile ? URL.createObjectURL(photoFile) : form.watch("photoUrl") || undefined} />
                <AvatarFallback>{(form.watch("name") || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <label className="text-sm font-medium">Photo (optional)</label>
                <Input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} data-testid="input-staff-photo" />
              </div>
            </div>

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
              <FormField control={form.control} name="employmentType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employment type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-staff-employment-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="permanent">Permanent (monthly salary)</SelectItem>
                      <SelectItem value="temporary">Temporary (day/hour rate)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {employmentType === "permanent" ? (
              <FormField control={form.control} name="salary" render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly salary (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-staff-salary" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="dayRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Day rate (KES)</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-staff-day-rate" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="hourRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hour rate (KES)</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-staff-hour-rate" /></FormControl>
                    <FormDescription>Set a day rate or an hour rate — not both.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (optional, for payslips)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="hireDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Hire date (optional)</FormLabel>
                  <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-staff-hire-date" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
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
            </div>

            <div className="border-t pt-4 space-y-4">
              <h3 className="text-sm font-medium">Identity &amp; next of kin</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="nationalId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>National ID (optional)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-national-id" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="nextOfKinName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Next of kin name (optional)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-nok-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="nextOfKinPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Next of kin phone (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-nok-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="border-t pt-4 space-y-4">
              <h3 className="text-sm font-medium">Banking details (for bank-advice export)</h3>
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="bankName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank name (optional)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-bank-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account number (optional)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-bank-account" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bankBranch" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch (optional)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-staff-bank-branch" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-staff-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-staff">
                {mutation.isPending ? (photoFile ? "Uploading..." : "Saving...") : "Save staff member"}
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

function payDisplay(s: StaffMember): string {
  if (s.employmentType === "temporary") {
    if (s.dayRate && s.dayRate > 0) return `${formatKES(s.dayRate)}/day`;
    if (s.hourRate && s.hourRate > 0) return `${formatKES(s.hourRate)}/hr`;
    return "—";
  }
  return `${formatKES(s.salary)}/mo`;
}

export default function Staff() {
  const { toast } = useToast();
  const { data: staff = [], isLoading } = useQuery<StaffMember[]>({ queryKey: ["/api/staff"] });

  const deleteStaff = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/staff"] }); toast({ title: "Staff member removed" }); },
  });

  const activeStaff = staff.filter((s) => s.status === "active");
  const monthlyPayroll = activeStaff.filter((s) => s.employmentType !== "temporary").reduce((sum, s) => sum + s.salary, 0);
  const sorted = [...staff].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Staff"
        description="Manage the team, employment details, and monthly payroll cost."
        action={<StaffFormDialog trigger={<Button size="sm" data-testid="button-new-staff"><Plus className="h-4 w-4 mr-1" /> Add staff</Button>} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total staff" value={String(staff.length)} icon={Users} testId="stat-staff-count" />
        <StatCard label="Active staff" value={String(activeStaff.length)} icon={UserCheck} accent="success" testId="stat-active-staff" />
        <StatCard label="Monthly payroll (permanent)" value={formatKES(monthlyPayroll)} icon={Wallet} accent="warning" testId="stat-monthly-payroll" />
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
                  <TableHead>Employment</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((s) => (
                  <TableRow key={s.id} data-testid={`row-staff-${s.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={s.photoUrl || undefined} />
                          <AvatarFallback className="text-xs">{s.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {s.name}
                      </div>
                    </TableCell>
                    <TableCell>{s.role}</TableCell>
                    <TableCell>{titleCase(s.department)}</TableCell>
                    <TableCell><Badge variant="outline">{titleCase(s.employmentType ?? "permanent")}</Badge></TableCell>
                    <TableCell>{s.phone || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{payDisplay(s)}</TableCell>
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
