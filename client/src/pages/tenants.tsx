import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Store, Users, FileSignature, Receipt, Ban, Send, CircleDollarSign } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, todayISO, titleCase } from "@/lib/format";
import { fetchLatestDocumentPdfUrl } from "@/lib/whatsapp";
import type { Shop, Tenant, TenancyLease, MeterReading, RentInvoice, ChartOfAccount, BankAccount } from "@shared/schema";

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

const invoiceStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  unpaid: "outline",
  partially_paid: "default",
  paid: "secondary",
  overdue: "destructive",
  cancelled: "destructive",
};

// ================= Shops =================
const shopFormSchema = z.object({
  shopNumber: z.string().min(1, "Shop number is required"),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  sizeSqm: z.coerce.number().optional().nullable(),
  active: z.number(),
});

function ShopFormDialog({ shop, trigger }: { shop?: Shop; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof shopFormSchema>>({
    resolver: zodResolver(shopFormSchema),
    defaultValues: shop
      ? { shopNumber: shop.shopNumber, description: shop.description ?? "", location: shop.location ?? "", sizeSqm: shop.sizeSqm ?? undefined, active: shop.active }
      : { shopNumber: "", description: "", location: "", sizeSqm: undefined, active: 1 },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof shopFormSchema>) => {
      if (shop) return apiRequest("PATCH", `/api/shops/${shop.id}`, values);
      return apiRequest("POST", "/api/shops", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shops"] });
      toast({ title: shop ? "Shop updated" : "Shop created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{shop ? "Edit shop" : "New shop"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="shopNumber" render={({ field }) => (
                <FormItem><FormLabel>Shop number</FormLabel><FormControl><Input placeholder="e.g. SH-01" {...field} data-testid="input-shop-number" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="sizeSqm" render={({ field }) => (
                <FormItem><FormLabel>Size (sqm, optional)</FormLabel><FormControl><Input type="number" step="0.1" {...field} value={field.value ?? ""} data-testid="input-shop-size" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem><FormLabel>Location (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-shop-location" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-shop-description" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-shop-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-shop">{mutation.isPending ? "Saving..." : "Save shop"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ShopsTab() {
  const { toast } = useToast();
  const { data: shops = [], isLoading } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const deleteShop = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/shops/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/shops"] }); toast({ title: "Shop removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove shop", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">Retail units/kiosks available for lease to tenants.</p>
        <ShopFormDialog trigger={<Button size="sm" data-testid="button-new-shop"><Plus className="h-4 w-4 mr-1" /> Add shop</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading shops…</div>
        ) : shops.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No shops added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop #</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Size (sqm)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shops.map((s) => (
                  <TableRow key={s.id} data-testid={`row-shop-${s.id}`}>
                    <TableCell className="font-medium">{s.shopNumber}</TableCell>
                    <TableCell>{s.location || "—"}</TableCell>
                    <TableCell>{s.description || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.sizeSqm ?? "—"}</TableCell>
                    <TableCell><Badge variant={s.active ? "secondary" : "outline"}>{s.active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <ShopFormDialog shop={s} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-shop-${s.id}`}><Pencil className="h-4 w-4" /></Button>} />
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-shop-${s.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Delete shop {s.shopNumber}?</AlertDialogTitle><AlertDialogDescription>This can't be undone. Shops with existing leases cannot be deleted.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteShop.mutate(s.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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

// ================= Tenants =================
const tenantFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  idNumber: z.string().optional().nullable(),
  active: z.number(),
  notes: z.string().optional().nullable(),
});

function TenantFormDialog({ tenant, trigger }: { tenant?: Tenant; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof tenantFormSchema>>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: tenant
      ? { name: tenant.name, contactPerson: tenant.contactPerson ?? "", phone: tenant.phone ?? "", email: tenant.email ?? "", idNumber: tenant.idNumber ?? "", active: tenant.active, notes: tenant.notes ?? "" }
      : { name: "", contactPerson: "", phone: "", email: "", idNumber: "", active: 1, notes: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof tenantFormSchema>) => {
      if (tenant) return apiRequest("PATCH", `/api/tenants-list/${tenant.id}`, values);
      return apiRequest("POST", "/api/tenants-list", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants-list"] });
      toast({ title: tenant ? "Tenant updated" : "Tenant created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tenant ? "Edit tenant" : "New tenant"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Tenant / business name</FormLabel><FormControl><Input {...field} data-testid="input-tenant-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="contactPerson" render={({ field }) => (
                <FormItem><FormLabel>Contact person (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-tenant-contact" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-tenant-phone" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email (optional)</FormLabel><FormControl><Input type="email" {...field} value={field.value ?? ""} data-testid="input-tenant-email" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="idNumber" render={({ field }) => (
              <FormItem><FormLabel>ID / business registration number (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-tenant-id-number" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-tenant-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-tenant-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-tenant">{mutation.isPending ? "Saving..." : "Save tenant"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function TenantsTab() {
  const { toast } = useToast();
  const { data: tenants = [], isLoading } = useQuery<Tenant[]>({ queryKey: ["/api/tenants-list"] });
  const deleteTenant = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tenants-list/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenants-list"] }); toast({ title: "Tenant removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove tenant", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">Tenants renting shops on this property.</p>
        <TenantFormDialog trigger={<Button size="sm" data-testid="button-new-tenant"><Plus className="h-4 w-4 mr-1" /> Add tenant</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading tenants…</div>
        ) : tenants.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No tenants added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact person</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TableRow key={t.id} data-testid={`row-tenant-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.contactPerson || "—"}</TableCell>
                    <TableCell>{t.phone || "—"}</TableCell>
                    <TableCell>{t.email || "—"}</TableCell>
                    <TableCell><Badge variant={t.active ? "secondary" : "outline"}>{t.active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <TenantFormDialog tenant={t} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-tenant-${t.id}`}><Pencil className="h-4 w-4" /></Button>} />
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-tenant-${t.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Delete tenant {t.name}?</AlertDialogTitle><AlertDialogDescription>This can't be undone. Tenants with existing leases cannot be deleted.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteTenant.mutate(t.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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

// ================= Leases =================
const leaseFormSchema = z.object({
  shopId: z.coerce.number().min(1, "Shop is required"),
  tenantId: z.coerce.number().min(1, "Tenant is required"),
  monthlyRent: z.coerce.number().min(0, "Monthly rent can't be negative"),
  electricityRatePerUnit: z.coerce.number().min(0, "Rate can't be negative"),
  leaseStart: z.string().min(1, "Lease start date is required"),
  leaseEnd: z.string().optional().nullable(),
  dueDayOfMonth: z.coerce.number().min(1).max(28),
  reminderDaysBefore: z.coerce.number().min(0).max(28),
  receivableAccountId: z.coerce.number().min(1, "Receivable account is required"),
  incomeAccountId: z.coerce.number().min(1, "Income account is required"),
  status: z.string(),
  notes: z.string().optional().nullable(),
});

function LeaseFormDialog({ lease, trigger }: { lease?: TenancyLease; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const { data: tenants = [] } = useQuery<Tenant[]>({ queryKey: ["/api/tenants-list"] });
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/tenants/gl-accounts"] });
  const form = useForm<z.infer<typeof leaseFormSchema>>({
    resolver: zodResolver(leaseFormSchema),
    defaultValues: lease
      ? { shopId: lease.shopId, tenantId: lease.tenantId, monthlyRent: lease.monthlyRent, electricityRatePerUnit: lease.electricityRatePerUnit, leaseStart: lease.leaseStart, leaseEnd: lease.leaseEnd ?? "", dueDayOfMonth: lease.dueDayOfMonth, reminderDaysBefore: lease.reminderDaysBefore, receivableAccountId: lease.receivableAccountId ?? 0, incomeAccountId: lease.incomeAccountId ?? 0, status: lease.status, notes: lease.notes ?? "" }
      : { shopId: 0, tenantId: 0, monthlyRent: 0, electricityRatePerUnit: 0, leaseStart: todayISO(), leaseEnd: "", dueDayOfMonth: 5, reminderDaysBefore: 3, receivableAccountId: 0, incomeAccountId: 0, status: "active", notes: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof leaseFormSchema>) => {
      const payload = { ...values, leaseEnd: values.leaseEnd || null };
      if (lease) return apiRequest("PATCH", `/api/tenancy-leases/${lease.id}`, payload);
      return apiRequest("POST", "/api/tenancy-leases", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-leases"] });
      toast({ title: lease ? "Lease updated" : "Lease created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const receivableAccounts = accounts.filter((a) => a.type === "asset");
  const incomeAccounts = accounts.filter((a) => a.type === "income");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
        <DialogHeader><DialogTitle>{lease ? "Edit lease" : "New lease"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="shopId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Shop</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-lease-shop"><SelectValue placeholder="Select shop" /></SelectTrigger></FormControl>
                    <SelectContent>{shops.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.shopNumber}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="tenantId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tenant</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-lease-tenant"><SelectValue placeholder="Select tenant" /></SelectTrigger></FormControl>
                    <SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="monthlyRent" render={({ field }) => (
                <FormItem><FormLabel>Monthly rent (KES)</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-lease-rent" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="electricityRatePerUnit" render={({ field }) => (
                <FormItem><FormLabel>Electricity rate (KES/unit)</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-lease-electricity-rate" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="leaseStart" render={({ field }) => (
                <FormItem><FormLabel>Lease start</FormLabel><FormControl><Input type="date" {...field} data-testid="input-lease-start" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="leaseEnd" render={({ field }) => (
                <FormItem><FormLabel>Lease end (optional)</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-lease-end" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="dueDayOfMonth" render={({ field }) => (
                <FormItem><FormLabel>Rent due day of month</FormLabel><FormControl><Input type="number" min={1} max={28} {...field} data-testid="input-lease-due-day" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="reminderDaysBefore" render={({ field }) => (
                <FormItem><FormLabel>Remind (days before due)</FormLabel><FormControl><Input type="number" min={0} max={28} {...field} data-testid="input-lease-reminder-days" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="receivableAccountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Receivable (GL asset account)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-lease-receivable-account"><SelectValue placeholder="Select account" /></SelectTrigger></FormControl>
                    <SelectContent>{receivableAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="incomeAccountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Income (GL income account)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-lease-income-account"><SelectValue placeholder="Select account" /></SelectTrigger></FormControl>
                    <SelectContent>{incomeAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-lease-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="ended">Ended</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-lease-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-lease">{mutation.isPending ? "Saving..." : "Save lease"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LeasesTab() {
  const { toast } = useToast();
  const { data: leases = [], isLoading } = useQuery<TenancyLease[]>({ queryKey: ["/api/tenancy-leases"] });
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const { data: tenants = [] } = useQuery<Tenant[]>({ queryKey: ["/api/tenants-list"] });
  const endLease = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tenancy-leases/${id}/end`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenancy-leases"] }); toast({ title: "Lease ended" }); },
    onError: (err: Error) => toast({ title: "Could not end lease", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const shopName = (id: number) => shops.find((s) => s.id === id)?.shopNumber ?? `#${id}`;
  const tenantName = (id: number) => tenants.find((t) => t.id === id)?.name ?? `#${id}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">Tenancy leases linking tenants to shops, with rent, electricity rate, and GL account mapping.</p>
        <LeaseFormDialog trigger={<Button size="sm" data-testid="button-new-lease"><Plus className="h-4 w-4 mr-1" /> Add lease</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading leases…</div>
        ) : leases.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No leases yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Rent/mo</TableHead>
                  <TableHead className="text-right">Elec. rate</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Due day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map((l) => (
                  <TableRow key={l.id} data-testid={`row-lease-${l.id}`}>
                    <TableCell className="font-medium">{shopName(l.shopId)}</TableCell>
                    <TableCell>{tenantName(l.tenantId)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.monthlyRent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(l.electricityRatePerUnit)}</TableCell>
                    <TableCell>{l.leaseStart}</TableCell>
                    <TableCell>{l.dueDayOfMonth}</TableCell>
                    <TableCell><Badge variant={l.status === "active" ? "secondary" : "outline"}>{titleCase(l.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <LeaseFormDialog lease={l} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-lease-${l.id}`}><Pencil className="h-4 w-4" /></Button>} />
                        {l.status === "active" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button size="icon" variant="ghost" title="End lease" data-testid={`button-end-lease-${l.id}`}><Ban className="h-4 w-4" /></Button></AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>End this lease?</AlertDialogTitle><AlertDialogDescription>The lease will be marked ended and stop generating new rent invoices. This can't be undone from here.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => endLease.mutate(l.id)}>End lease</AlertDialogAction></AlertDialogFooter>
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
    </div>
  );
}

// ================= Meter Readings =================
const meterReadingFormSchema = z.object({
  leaseId: z.coerce.number().min(1, "Lease is required"),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  startReading: z.coerce.number().min(0),
  endReading: z.coerce.number().min(0),
  readingDate: z.string().min(1, "Reading date is required"),
  recordedBy: z.string().min(1),
}).refine((v) => v.endReading >= v.startReading, { message: "End reading must be greater than or equal to start reading", path: ["endReading"] });

function MeterReadingFormDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: leases = [] } = useQuery<TenancyLease[]>({ queryKey: ["/api/tenancy-leases"] });
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const form = useForm<z.infer<typeof meterReadingFormSchema>>({
    resolver: zodResolver(meterReadingFormSchema),
    defaultValues: { leaseId: 0, periodMonth: todayISO().slice(0, 7), startReading: 0, endReading: 0, readingDate: todayISO(), recordedBy: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof meterReadingFormSchema>) => apiRequest("POST", "/api/meter-readings", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meter-readings"] });
      toast({ title: "Meter reading recorded" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const shopName = (id: number) => shops.find((s) => s.id === id)?.shopNumber ?? `#${id}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Record meter reading</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="leaseId" render={({ field }) => (
              <FormItem>
                <FormLabel>Lease</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                  <FormControl><SelectTrigger data-testid="select-reading-lease"><SelectValue placeholder="Select lease" /></SelectTrigger></FormControl>
                  <SelectContent>{leases.filter((l) => l.status === "active").map((l) => <SelectItem key={l.id} value={String(l.id)}>{shopName(l.shopId)}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="periodMonth" render={({ field }) => (
                <FormItem><FormLabel>Period (YYYY-MM)</FormLabel><FormControl><Input placeholder="2026-09" {...field} data-testid="input-reading-period" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="readingDate" render={({ field }) => (
                <FormItem><FormLabel>Reading date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-reading-date" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startReading" render={({ field }) => (
                <FormItem><FormLabel>Start reading</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-reading-start" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endReading" render={({ field }) => (
                <FormItem><FormLabel>End reading</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-reading-end" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="recordedBy" render={({ field }) => (
              <FormItem><FormLabel>Recorded by</FormLabel><FormControl><Input placeholder="Staff name" {...field} data-testid="input-reading-recorded-by" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-reading">{mutation.isPending ? "Saving..." : "Record reading"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function MeterReadingsTab() {
  const { data: readings = [], isLoading } = useQuery<MeterReading[]>({ queryKey: ["/api/meter-readings"] });
  const { data: leases = [] } = useQuery<TenancyLease[]>({ queryKey: ["/api/tenancy-leases"] });
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const shopForLease = (leaseId: number) => {
    const lease = leases.find((l) => l.id === leaseId);
    return lease ? (shops.find((s) => s.id === lease.shopId)?.shopNumber ?? `Lease #${leaseId}`) : `Lease #${leaseId}`;
  };
  const sorted = [...readings].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">Monthly electricity meter readings per leased shop. Consumption and charge are calculated automatically using the lease's electricity rate.</p>
        <MeterReadingFormDialog trigger={<Button size="sm" data-testid="button-new-reading"><Plus className="h-4 w-4 mr-1" /> Record reading</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading readings…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No meter readings recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Start</TableHead>
                  <TableHead className="text-right">End</TableHead>
                  <TableHead className="text-right">Consumption</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.id} data-testid={`row-reading-${r.id}`}>
                    <TableCell className="font-medium">{shopForLease(r.leaseId)}</TableCell>
                    <TableCell>{r.periodMonth}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.startReading}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.endReading}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.consumption}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(r.amount)}</TableCell>
                    <TableCell>{r.recordedBy}</TableCell>
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

// ================= Rent Invoices =================
function GenerateInvoiceDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [leaseId, setLeaseId] = useState<number | undefined>();
  const [periodMonth, setPeriodMonth] = useState(todayISO().slice(0, 7));
  const { toast } = useToast();
  const { data: leases = [] } = useQuery<TenancyLease[]>({ queryKey: ["/api/tenancy-leases"] });
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const shopName = (id: number) => shops.find((s) => s.id === id)?.shopNumber ?? `#${id}`;
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/rent-invoices/generate", { leaseId, periodMonth }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-invoices"] });
      toast({ title: "Invoice generated" });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Could not generate invoice", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Generate rent invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <FormDescription>Invoices normally generate automatically each hour for the current period. Use this to generate a specific period on demand.</FormDescription>
          <div>
            <label className="text-sm font-medium">Lease</label>
            <Select onValueChange={(v) => setLeaseId(Number(v))} value={leaseId ? String(leaseId) : undefined}>
              <SelectTrigger data-testid="select-generate-invoice-lease"><SelectValue placeholder="Select lease" /></SelectTrigger>
              <SelectContent>{leases.filter((l) => l.status === "active").map((l) => <SelectItem key={l.id} value={String(l.id)}>{shopName(l.shopId)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Period (YYYY-MM)</label>
            <Input value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} placeholder="2026-09" data-testid="input-generate-invoice-period" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!leaseId || mutation.isPending} data-testid="button-confirm-generate-invoice">
            {mutation.isPending ? "Generating..." : "Generate invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({ invoice, trigger }: { invoice: RentInvoice; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(invoice.totalAmount - invoice.amountPaid));
  const [bankAccountId, setBankAccountId] = useState<number | undefined>();
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const { toast } = useToast();
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/tenants/bank-accounts"] });
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rent-invoices/${invoice.id}/payments`, { amount: Number(amount), bankAccountId, paymentMethod, paymentReference: paymentReference || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-invoices"] });
      toast({ title: "Payment recorded" });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Could not record payment", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment — {invoice.invoiceNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Outstanding balance: {formatKES(invoice.totalAmount - invoice.amountPaid)}</p>
          <div>
            <label className="text-sm font-medium">Amount (KES)</label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-payment-amount" />
          </div>
          <div>
            <label className="text-sm font-medium">Bank/cash account</label>
            <Select onValueChange={(v) => setBankAccountId(Number(v))} value={bankAccountId ? String(bankAccountId) : undefined}>
              <SelectTrigger data-testid="select-payment-bank-account"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>{bankAccounts.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Payment method</label>
            <Select onValueChange={setPaymentMethod} value={paymentMethod}>
              <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="mpesa">M-Pesa</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Payment reference (optional)</label>
            <Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-payment-reference" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!amount || Number(amount) <= 0 || !bankAccountId || mutation.isPending} data-testid="button-confirm-payment">
            {mutation.isPending ? "Saving..." : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelInvoiceDialog({ invoice, trigger }: { invoice: RentInvoice; trigger: React.ReactNode }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/rent-invoices/${invoice.id}/cancel`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-invoices"] });
      toast({ title: "Invoice cancelled" });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Could not cancel invoice", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel invoice {invoice.invoiceNumber}?</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reason</label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-cancel-reason" />
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={!reason || mutation.isPending} data-testid="button-confirm-cancel-invoice">
            {mutation.isPending ? "Cancelling..." : "Cancel invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewInvoicePdfButton({ invoiceId }: { invoiceId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    setLoading(true);
    try {
      const url = await fetchLatestDocumentPdfUrl("tenancy", invoiceId);
      if (url) window.open(url, "_blank");
      else toast({ title: "No PDF available yet", description: "Generate or resend the invoice first.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button size="icon" variant="ghost" title="View PDF" onClick={handleClick} disabled={loading} data-testid={`button-view-pdf-invoice-${invoiceId}`}>
      <Receipt className="h-4 w-4" />
    </Button>
  );
}

function RentInvoicesTab() {
  const { toast } = useToast();
  const { data: invoices = [], isLoading } = useQuery<RentInvoice[]>({ queryKey: ["/api/rent-invoices"] });
  const { data: leases = [] } = useQuery<TenancyLease[]>({ queryKey: ["/api/tenancy-leases"] });
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const { data: tenants = [] } = useQuery<Tenant[]>({ queryKey: ["/api/tenants-list"] });
  const resend = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/rent-invoices/${id}/resend`),
    onSuccess: () => toast({ title: "Invoice resent" }),
    onError: (err: Error) => toast({ title: "Could not resend", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const shopTenantForLease = (leaseId: number) => {
    const lease = leases.find((l) => l.id === leaseId);
    if (!lease) return { shop: `Lease #${leaseId}`, tenant: "—" };
    return { shop: shops.find((s) => s.id === lease.shopId)?.shopNumber ?? `#${lease.shopId}`, tenant: tenants.find((t) => t.id === lease.tenantId)?.name ?? `#${lease.tenantId}` };
  };
  const sorted = [...invoices].sort((a, b) => b.createdAt - a.createdAt);
  const totalOutstanding = invoices.filter((i) => i.status !== "cancelled" && i.status !== "paid").reduce((sum, i) => sum + (i.totalAmount - i.amountPaid), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total invoices" value={String(invoices.length)} icon={Receipt} testId="stat-rent-invoices-count" />
        <StatCard label="Outstanding balance" value={formatKES(totalOutstanding)} icon={CircleDollarSign} accent="warning" testId="stat-rent-outstanding" />
        <StatCard label="Paid invoices" value={String(invoices.filter((i) => i.status === "paid").length)} icon={Receipt} accent="success" testId="stat-rent-paid" />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">Rent invoices auto-generate hourly for active leases (with electricity charges from the latest meter reading) and email the tenant a PDF invoice. Record payments and cancellations here.</p>
        <GenerateInvoiceDialog trigger={<Button size="sm" data-testid="button-generate-invoice"><Plus className="h-4 w-4 mr-1" /> Generate invoice</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading invoices…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No rent invoices yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Shop / Tenant</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((inv) => {
                  const { shop, tenant } = shopTenantForLease(inv.leaseId);
                  return (
                    <TableRow key={inv.id} data-testid={`row-rent-invoice-${inv.id}`}>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{shop} — {tenant}</TableCell>
                      <TableCell>{inv.periodMonth}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(inv.totalAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(inv.amountPaid)}</TableCell>
                      <TableCell>{inv.dueDate}</TableCell>
                      <TableCell><Badge variant={invoiceStatusVariant[inv.status] ?? "outline"}>{titleCase(inv.status)}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {inv.status !== "paid" && inv.status !== "cancelled" && (
                            <RecordPaymentDialog invoice={inv} trigger={<Button size="icon" variant="ghost" title="Record payment" data-testid={`button-pay-invoice-${inv.id}`}><CircleDollarSign className="h-4 w-4" /></Button>} />
                          )}
                          <ViewInvoicePdfButton invoiceId={inv.id} />
                          <Button size="icon" variant="ghost" title="Resend invoice email" onClick={() => resend.mutate(inv.id)} data-testid={`button-resend-invoice-${inv.id}`}><Send className="h-4 w-4" /></Button>
                          {inv.status !== "cancelled" && (
                            <CancelInvoiceDialog invoice={inv} trigger={<Button size="icon" variant="ghost" title="Cancel invoice" data-testid={`button-cancel-invoice-${inv.id}`}><Ban className="h-4 w-4" /></Button>} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ================= Page =================
export default function Tenants() {
  const { data: shops = [] } = useQuery<Shop[]>({ queryKey: ["/api/shops"] });
  const { data: tenants = [] } = useQuery<Tenant[]>({ queryKey: ["/api/tenants-list"] });
  const { data: leases = [] } = useQuery<TenancyLease[]>({ queryKey: ["/api/tenancy-leases"] });
  const activeLeases = leases.filter((l) => l.status === "active").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Tenants" description="Shops, tenants, leases, meter readings, and rent invoicing." />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Shops" value={String(shops.length)} icon={Store} testId="stat-shops-count" />
        <StatCard label="Tenants" value={String(tenants.length)} icon={Users} testId="stat-tenants-count" />
        <StatCard label="Active leases" value={String(activeLeases)} icon={FileSignature} accent="success" testId="stat-active-leases" />
        <StatCard label="Total leases" value={String(leases.length)} icon={FileSignature} accent="muted" testId="stat-total-leases" />
      </div>

      <Tabs defaultValue="leases">
        <TabsList>
          <TabsTrigger value="shops" data-testid="tab-shops">Shops</TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-tenants-list">Tenants</TabsTrigger>
          <TabsTrigger value="leases" data-testid="tab-leases">Leases</TabsTrigger>
          <TabsTrigger value="readings" data-testid="tab-meter-readings">Meter Readings</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-rent-invoices">Rent Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="shops" className="mt-4"><ShopsTab /></TabsContent>
        <TabsContent value="tenants" className="mt-4"><TenantsTab /></TabsContent>
        <TabsContent value="leases" className="mt-4"><LeasesTab /></TabsContent>
        <TabsContent value="readings" className="mt-4"><MeterReadingsTab /></TabsContent>
        <TabsContent value="invoices" className="mt-4"><RentInvoicesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
