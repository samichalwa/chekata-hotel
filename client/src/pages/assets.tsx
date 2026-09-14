import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Boxes, Wallet, PackageX, Tags, PlayCircle, Eye } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, titleCase, todayISO } from "@/lib/format";
import { DEPRECIATION_METHODS, ASSET_STATUSES } from "@shared/schema";
import type { Asset, AssetCategory, AssetDepreciationSchedule, ChartOfAccount } from "@shared/schema";

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {
    // not JSON
  }
  return body;
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "secondary",
  under_maintenance: "default",
  disposed: "outline",
};

/* ---------------- Asset Categories ---------------- */

const categoryFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  defaultUsefulLifeMonths: z.coerce.number().min(1, "Must be at least 1 month"),
  defaultDepreciationMethod: z.enum(DEPRECIATION_METHODS),
  depreciationExpenseAccountId: z.coerce.number().optional().nullable(),
  accumulatedDepreciationAccountId: z.coerce.number().optional().nullable(),
  active: z.number(),
});
type CategoryFormValues = z.output<typeof categoryFormSchema>;
type CategoryFormInput = z.input<typeof categoryFormSchema>;

function CategoryFormDialog({ category, accounts, trigger }: { category?: AssetCategory; accounts: ChartOfAccount[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<CategoryFormInput, any, CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: category
      ? {
          name: category.name,
          description: category.description ?? "",
          defaultUsefulLifeMonths: category.defaultUsefulLifeMonths,
          defaultDepreciationMethod: category.defaultDepreciationMethod as CategoryFormValues["defaultDepreciationMethod"],
          depreciationExpenseAccountId: category.depreciationExpenseAccountId ?? undefined,
          accumulatedDepreciationAccountId: category.accumulatedDepreciationAccountId ?? undefined,
          active: category.active,
        }
      : { name: "", description: "", defaultUsefulLifeMonths: 60, defaultDepreciationMethod: "straight_line", depreciationExpenseAccountId: undefined, accumulatedDepreciationAccountId: undefined, active: 1 },
  });

  const mutation = useMutation({
    mutationFn: (values: CategoryFormValues) => {
      const payload = { ...values, depreciationExpenseAccountId: values.depreciationExpenseAccountId || null, accumulatedDepreciationAccountId: values.accumulatedDepreciationAccountId || null };
      if (category) return apiRequest("PATCH", `/api/asset-categories/${category.id}`, payload);
      return apiRequest("POST", "/api/asset-categories", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/asset-categories"] });
      toast({ title: category ? "Category updated" : "Category created" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const expenseAccounts = accounts.filter((a) => a.type === "expense");
  const assetAccounts = accounts.filter((a) => a.type === "asset");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
        <DialogHeader><DialogTitle>{category ? "Edit asset category" : "New asset category"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Category name</FormLabel><FormControl><Input {...field} data-testid="input-category-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-category-description" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="defaultUsefulLifeMonths" render={({ field }) => (
                <FormItem><FormLabel>Default useful life (months)</FormLabel><FormControl><Input type="number" {...field} value={field.value as any} data-testid="input-category-useful-life" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="defaultDepreciationMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Default method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-category-method"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{DEPRECIATION_METHODS.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="depreciationExpenseAccountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Depreciation expense account</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-category-expense-account"><SelectValue placeholder="System default" /></SelectTrigger></FormControl>
                    <SelectContent>{expenseAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="accumulatedDepreciationAccountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Accumulated depreciation account</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-category-accum-account"><SelectValue placeholder="System default" /></SelectTrigger></FormControl>
                    <SelectContent>{assetAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <p className="text-xs text-muted-foreground">Leave GL accounts blank to use the system default Depreciation Expense (6100) and Accumulated Depreciation (1600) accounts when running depreciation.</p>
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-category-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-category">{mutation.isPending ? "Saving..." : "Save category"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Asset Register ---------------- */

const assetFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  categoryId: z.coerce.number().min(1, "Select a category"),
  description: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  acquisitionDate: z.string().min(1, "Acquisition date is required"),
  acquisitionCost: z.coerce.number().min(0, "Cost can't be negative"),
  salvageValue: z.coerce.number().min(0, "Salvage value can't be negative"),
  usefulLifeMonths: z.coerce.number().min(1, "Must be at least 1 month"),
  depreciationMethod: z.enum(DEPRECIATION_METHODS),
  notes: z.string().optional().nullable(),
});
type AssetFormValues = z.output<typeof assetFormSchema>;
type AssetFormInput = z.input<typeof assetFormSchema>;

function AssetFormDialog({ asset, categories, trigger }: { asset?: Asset; categories: AssetCategory[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<AssetFormInput, any, AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: asset
      ? {
          name: asset.name,
          categoryId: asset.categoryId,
          description: asset.description ?? "",
          serialNumber: asset.serialNumber ?? "",
          location: asset.location ?? "",
          supplier: asset.supplier ?? "",
          acquisitionDate: asset.acquisitionDate,
          acquisitionCost: asset.acquisitionCost,
          salvageValue: asset.salvageValue,
          usefulLifeMonths: asset.usefulLifeMonths,
          depreciationMethod: asset.depreciationMethod as AssetFormValues["depreciationMethod"],
          notes: asset.notes ?? "",
        }
      : { name: "", categoryId: 0, description: "", serialNumber: "", location: "", supplier: "", acquisitionDate: todayISO(), acquisitionCost: 0, salvageValue: 0, usefulLifeMonths: 60, depreciationMethod: "straight_line", notes: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: AssetFormValues) => {
      if (asset) return apiRequest("PATCH", `/api/assets/${asset.id}`, values);
      return apiRequest("POST", "/api/assets", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: asset ? "Asset updated" : "Asset registered" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const onCategoryChange = (id: number) => {
    form.setValue("categoryId", id);
    if (!asset) {
      const cat = categories.find((c) => c.id === id);
      if (cat) {
        form.setValue("usefulLifeMonths", cat.defaultUsefulLifeMonths);
        form.setValue("depreciationMethod", cat.defaultDepreciationMethod as AssetFormValues["depreciationMethod"]);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
        <DialogHeader><DialogTitle>{asset ? "Edit asset" : "Register new asset"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Asset name</FormLabel><FormControl><Input {...field} data-testid="input-asset-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="categoryId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={(v) => onCategoryChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger data-testid="select-asset-category"><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                    <SelectContent>{categories.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="serialNumber" render={({ field }) => (
                <FormItem><FormLabel>Serial number (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-asset-serial" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem><FormLabel>Location (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-asset-location" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="supplier" render={({ field }) => (
              <FormItem><FormLabel>Supplier (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-asset-supplier" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="acquisitionDate" render={({ field }) => (
                <FormItem><FormLabel>Acquisition date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-asset-acquisition-date" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="acquisitionCost" render={({ field }) => (
                <FormItem><FormLabel>Acquisition cost (KES)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-asset-cost" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="salvageValue" render={({ field }) => (
                <FormItem><FormLabel>Salvage value (KES)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-asset-salvage" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="usefulLifeMonths" render={({ field }) => (
                <FormItem><FormLabel>Useful life (months)</FormLabel><FormControl><Input type="number" {...field} value={field.value as any} data-testid="input-asset-useful-life" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="depreciationMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Depreciation method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-asset-method"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{DEPRECIATION_METHODS.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-asset-description" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-asset-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-asset">{mutation.isPending ? "Saving..." : "Save asset"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DisposeAssetDialog({ asset, trigger }: { asset: Asset; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const disposeSchema = z.object({ disposalValue: z.coerce.number().min(0, "Can't be negative"), disposalNotes: z.string().optional() });
  type DisposeFormValues = z.output<typeof disposeSchema>;
  type DisposeFormInput = z.input<typeof disposeSchema>;
  const form = useForm<DisposeFormInput, any, DisposeFormValues>({ resolver: zodResolver(disposeSchema), defaultValues: { disposalValue: 0, disposalNotes: "" } });

  const mutation = useMutation({
    mutationFn: (values: DisposeFormValues) => apiRequest("POST", `/api/assets/${asset.id}/dispose`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset disposed" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Could not dispose asset", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Dispose {asset.name}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="disposalValue" render={({ field }) => (
              <FormItem><FormLabel>Disposal value (KES)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-dispose-value" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="disposalNotes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-dispose-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={mutation.isPending} data-testid="button-confirm-dispose">{mutation.isPending ? "Disposing..." : "Confirm disposal"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DepreciationScheduleDialog({ asset, trigger }: { asset: Asset; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data: schedule = [] } = useQuery<AssetDepreciationSchedule[]>({ queryKey: [`/api/assets/${asset.id}/depreciation-schedule`], enabled: open });
  const latestNbv = schedule.length > 0 ? schedule[schedule.length - 1].netBookValue : asset.acquisitionCost;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
        <DialogHeader><DialogTitle>Depreciation schedule — {asset.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Acquisition cost</p><p className="font-medium tabular-nums">{formatKES(asset.acquisitionCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Current net book value</p><p className="font-medium tabular-nums">{formatKES(latestNbv)}</p></div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Depreciation</TableHead>
              <TableHead className="text-right">Accumulated</TableHead>
              <TableHead className="text-right">NBV</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedule.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No depreciation runs yet for this asset.</TableCell></TableRow>
            )}
            {schedule.map((row) => (
              <TableRow key={row.id} data-testid={`row-depreciation-${row.id}`}>
                <TableCell>{row.periodMonth}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKES(row.depreciationAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKES(row.accumulatedDepreciation)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKES(row.netBookValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

function RunDepreciationDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(todayISO().slice(0, 7));
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/assets/run-depreciation", { periodMonth }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/assets") });
      toast({ title: "Depreciation posted", description: `Total depreciation: ${formatKES(data.totalDepreciation)} — journal entry posted to Finance.` });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Could not run depreciation", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Run depreciation for a period</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Period month</label>
            <Input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} data-testid="input-depreciation-period" />
          </div>
          <p className="text-xs text-muted-foreground">
            This computes straight-line depreciation for every active asset for the selected month, posts one summarized journal entry to Finance (debiting Depreciation Expense, crediting Accumulated Depreciation per asset category's GL mapping, or the system defaults), and records a schedule row per asset. A period can only be run once.
          </p>
          <DialogFooter>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-confirm-run-depreciation">
              {mutation.isPending ? "Running..." : "Run depreciation"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Assets() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const isAdmin = Boolean(currentUser?.isAdmin);

  const { data: assets = [], isLoading } = useQuery<Asset[]>({ queryKey: ["/api/assets"] });
  const { data: categories = [] } = useQuery<AssetCategory[]>({ queryKey: ["/api/asset-categories"] });
  const { data: accounts = [] } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/assets/gl-accounts"] });

  const deleteAsset = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/assets/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/assets"] }); toast({ title: "Asset removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove asset", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  const deleteCategory = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/asset-categories/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/asset-categories"] }); toast({ title: "Category removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove category", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? "—";
  const activeCount = assets.filter((a) => a.status === "active").length;
  const disposedCount = assets.filter((a) => a.status === "disposed").length;
  const totalCost = assets.reduce((s, a) => s + a.acquisitionCost, 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Assets"
        description="Fixed asset register with automatic straight-line depreciation, posted to Finance as journal entries each period."
        action={<RunDepreciationDialog trigger={<Button size="sm" variant="default" data-testid="button-run-depreciation"><PlayCircle className="h-4 w-4 mr-1" /> Run depreciation</Button>} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Active assets" value={String(activeCount)} icon={Boxes} accent="muted" testId="stat-assets-active" />
        <StatCard label="Total acquisition cost" value={formatKES(totalCost)} icon={Wallet} accent="success" testId="stat-assets-cost" />
        <StatCard label="Disposed" value={String(disposedCount)} icon={PackageX} accent="warning" testId="stat-assets-disposed" />
        <StatCard label="Categories" value={String(categories.length)} icon={Tags} testId="stat-assets-categories" />
      </div>

      <Tabs defaultValue="register" className="w-full">
        <TabsList>
          <TabsTrigger value="register" data-testid="tab-asset-register">Asset Register</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-asset-categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <AssetFormDialog categories={categories} trigger={<Button size="sm" data-testid="button-new-asset"><Plus className="h-4 w-4 mr-1" /> Register asset</Button>} />
          </div>
          <Card>
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading assets…</div>
            ) : assets.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No assets registered yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset #</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Acquired</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((a) => (
                      <TableRow key={a.id} data-testid={`row-asset-${a.id}`}>
                        <TableCell className="font-mono text-xs">{a.assetNumber}</TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell>{categoryName(a.categoryId)}</TableCell>
                        <TableCell>{a.acquisitionDate}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(a.acquisitionCost)}</TableCell>
                        <TableCell><Badge variant={statusVariant[a.status] ?? "outline"}>{titleCase(a.status)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <DepreciationScheduleDialog asset={a} trigger={<Button size="icon" variant="ghost" data-testid={`button-view-schedule-${a.id}`}><Eye className="h-4 w-4" /></Button>} />
                            {a.status !== "disposed" && (
                              <AssetFormDialog asset={a} categories={categories} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-asset-${a.id}`}><Pencil className="h-4 w-4" /></Button>} />
                            )}
                            {a.status !== "disposed" && (
                              <DisposeAssetDialog asset={a} trigger={<Button size="icon" variant="ghost" data-testid={`button-dispose-asset-${a.id}`}><PackageX className="h-4 w-4" /></Button>} />
                            )}
                            {isAdmin && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-asset-${a.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader><AlertDialogTitle>Delete asset {a.name}?</AlertDialogTitle><AlertDialogDescription>This can't be undone.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteAsset.mutate(a.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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
        </TabsContent>

        <TabsContent value="categories" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <CategoryFormDialog accounts={accounts} trigger={<Button size="sm" data-testid="button-new-category"><Plus className="h-4 w-4 mr-1" /> Add category</Button>} />
          </div>
          <Card>
            {categories.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No asset categories yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Default useful life</TableHead>
                      <TableHead>Default method</TableHead>
                      <TableHead>GL mapping</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((c) => (
                      <TableRow key={c.id} data-testid={`row-category-${c.id}`}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.defaultUsefulLifeMonths} months</TableCell>
                        <TableCell>{titleCase(c.defaultDepreciationMethod)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.depreciationExpenseAccountId || c.accumulatedDepreciationAccountId ? "Custom" : "System default (6100 / 1600)"}
                        </TableCell>
                        <TableCell><Badge variant={c.active ? "secondary" : "outline"}>{c.active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <CategoryFormDialog category={c} accounts={accounts} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-category-${c.id}`}><Pencil className="h-4 w-4" /></Button>} />
                            {isAdmin && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-category-${c.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader><AlertDialogTitle>Delete category {c.name}?</AlertDialogTitle><AlertDialogDescription>This can't be undone. Assets already using this category will keep their reference.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteCategory.mutate(c.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
