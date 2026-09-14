import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Package, Warehouse, ClipboardList, ArrowUpDown, Lock } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import type { Store, InventoryItem, StockLedgerEntry, DefinitionListItem } from "@shared/schema";

type StockBalance = { itemId: number; storeId: number; balance: number };

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

// ================= Stores =================
const storeFormSchema = z.object({
  name: z.string().min(1, "Store name is required"),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  active: z.number(),
});

function StoreFormDialog({ store, trigger }: { store?: Store; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof storeFormSchema>>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: store
      ? { name: store.name, location: store.location ?? "", description: store.description ?? "", active: store.active }
      : { name: "", location: "", description: "", active: 1 },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof storeFormSchema>) => {
      if (store) return apiRequest("PATCH", `/api/inventory/stores/${store.id}`, values);
      return apiRequest("POST", "/api/inventory/stores", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stores"] });
      toast({ title: store ? "Store updated" : "Store created" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{store ? "Edit store" : "New store"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Store name</FormLabel><FormControl><Input placeholder="e.g. Main Store" {...field} data-testid="input-store-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem><FormLabel>Location (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-store-location" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-store-description" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-store-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-store">
                {mutation.isPending ? "Saving..." : "Save store"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function StoresTab({ canAdjust }: { canAdjust: boolean }) {
  const { toast } = useToast();
  const { data: stores = [], isLoading } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const deleteStore = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/inventory/stores/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/inventory/stores"] }); toast({ title: "Store deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete store", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{stores.length} store{stores.length === 1 ? "" : "s"}</div>
        <StoreFormDialog trigger={<Button size="sm" data-testid="button-new-store"><Plus className="h-4 w-4 mr-1" /> Add store</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading stores…</div>
      ) : stores.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No stores yet. Add the first one.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Location</TableHead><TableHead>Description</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((s) => (
                <TableRow key={s.id} data-testid={`row-store-${s.id}`}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.location || "—"}</TableCell>
                  <TableCell>{s.description || "—"}</TableCell>
                  <TableCell><Badge variant={s.active ? "secondary" : "outline"}>{s.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <StoreFormDialog store={s} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-store-${s.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      {canAdjust ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-store-${s.id}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {s.name}?</AlertDialogTitle>
                              <AlertDialogDescription>This removes the store record.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteStore.mutate(s.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Button size="icon" variant="ghost" disabled title="Requires the 'adjust inventory' right" data-testid={`button-delete-store-${s.id}`}><Lock className="h-4 w-4" /></Button>
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

// ================= Items =================
const itemFormSchema = z.object({
  code: z.string().min(1, "Item code is required"),
  name: z.string().min(1, "Item name is required"),
  category: z.string().optional().nullable(),
  unitOfMeasure: z.string().min(1, "Unit of measure is required"),
  reorderLevel: z.number().min(0),
  lastUnitCost: z.number().min(0),
  glAssetAccountId: z.union([z.number().positive(), z.literal("")]).optional().nullable(),
  active: z.number(),
  notes: z.string().optional().nullable(),
});

function ItemFormDialog({ item, categories, units, trigger }: { item?: InventoryItem; categories: DefinitionListItem[]; units: DefinitionListItem[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof itemFormSchema>>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: item
      ? { code: item.code, name: item.name, category: item.category ?? "", unitOfMeasure: item.unitOfMeasure, reorderLevel: item.reorderLevel, lastUnitCost: item.lastUnitCost, glAssetAccountId: item.glAssetAccountId ?? "", active: item.active, notes: item.notes ?? "" }
      : { code: "", name: "", category: "", unitOfMeasure: "", reorderLevel: 0, lastUnitCost: 0, glAssetAccountId: "", active: 1, notes: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof itemFormSchema>) => {
      const payload = { ...values, glAssetAccountId: values.glAssetAccountId === "" ? null : Number(values.glAssetAccountId) };
      if (item) return apiRequest("PATCH", `/api/inventory/items/${item.id}`, payload);
      return apiRequest("POST", "/api/inventory/items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      toast({ title: item ? "Item updated" : "Item created" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{item ? "Edit item" : "New inventory item"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem><FormLabel>Item code (SKU)</FormLabel><FormControl><Input placeholder="e.g. INV-0001" {...field} data-testid="input-item-code" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="unitOfMeasure" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit of measure</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-item-unit"><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {units.filter((u) => u.active).map((u) => <SelectItem key={u.id} value={u.code}>{u.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Item name</FormLabel><FormControl><Input {...field} data-testid="input-item-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl><SelectTrigger data-testid="select-item-category"><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {categories.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.code}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="reorderLevel" render={({ field }) => (
                <FormItem><FormLabel>Reorder level</FormLabel><FormControl><Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber || 0)} data-testid="input-item-reorder-level" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="lastUnitCost" render={({ field }) => (
                <FormItem><FormLabel>Last unit cost (KES)</FormLabel><FormControl><Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber || 0)} data-testid="input-item-unit-cost" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-item-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-item-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-item">
                {mutation.isPending ? "Saving..." : "Save item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ItemsTab({ canAdjust }: { canAdjust: boolean }) {
  const { toast } = useToast();
  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: categories = [] } = useQuery<DefinitionListItem[]>({ queryKey: ["/api/definitions/inventory_category/items"] });
  const { data: units = [] } = useQuery<DefinitionListItem[]>({ queryKey: ["/api/definitions/unit_of_measure/items"] });
  const categoryLabel = (code: string | null) => categories.find((c) => c.code === code)?.label ?? code ?? "—";
  const deleteItem = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/inventory/items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] }); toast({ title: "Item deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete item", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</div>
        <ItemFormDialog categories={categories} units={units} trigger={<Button size="sm" data-testid="button-new-item"><Plus className="h-4 w-4 mr-1" /> Add item</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading items…</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No inventory items yet. Add the first one.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead>
                <TableHead>Unit</TableHead><TableHead className="text-right">Reorder level</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} data-testid={`row-item-${it.id}`}>
                  <TableCell className="font-mono">{it.code}</TableCell>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell>{categoryLabel(it.category)}</TableCell>
                  <TableCell>{it.unitOfMeasure}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.reorderLevel}</TableCell>
                  <TableCell><Badge variant={it.active ? "secondary" : "outline"}>{it.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <ItemFormDialog item={it} categories={categories} units={units} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-item-${it.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      {canAdjust ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-item-${it.id}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {it.name}?</AlertDialogTitle>
                              <AlertDialogDescription>This removes the inventory item record.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteItem.mutate(it.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Button size="icon" variant="ghost" disabled title="Requires the 'adjust inventory' right" data-testid={`button-delete-item-${it.id}`}><Lock className="h-4 w-4" /></Button>
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

// ================= Stock Balances =================
function StockBalancesTab() {
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const { data: balances = [], isLoading } = useQuery<StockBalance[]>({ queryKey: ["/api/inventory/stock-balances"] });
  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `#${id}`;
  const itemCode = (id: number) => items.find((i) => i.id === id)?.code ?? "—";
  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? `#${id}`;
  const nonZero = balances.filter((b) => b.balance !== 0);
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{nonZero.length} balance{nonZero.length === 1 ? "" : "s"} across all stores</div>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading stock balances…</div>
      ) : nonZero.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No stock on hand yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Item</TableHead><TableHead>Store</TableHead><TableHead className="text-right">Balance</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {nonZero.map((b) => (
                <TableRow key={`${b.itemId}-${b.storeId}`} data-testid={`row-balance-${b.itemId}-${b.storeId}`}>
                  <TableCell className="font-medium">{itemCode(b.itemId)} — {itemName(b.itemId)}</TableCell>
                  <TableCell>{storeName(b.storeId)}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.balance}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ================= Stock Ledger =================
function StockLedgerTab() {
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const [itemFilter, setItemFilter] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const params = new URLSearchParams();
  if (itemFilter !== "all") params.set("itemId", itemFilter);
  if (storeFilter !== "all") params.set("storeId", storeFilter);
  const qs = params.toString();
  const { data: entries = [], isLoading } = useQuery<StockLedgerEntry[]>({
    queryKey: ["/api/inventory/stock-ledger", itemFilter, storeFilter],
    queryFn: () => fetch(`/api/inventory/stock-ledger${qs ? `?${qs}` : ""}`, { credentials: "include" }).then((r) => r.json()),
  });
  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `#${id}`;
  const storeName = (id: number) => stores.find((s) => s.id === id)?.name ?? `#${id}`;
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
        <Select value={itemFilter} onValueChange={setItemFilter}>
          <SelectTrigger className="w-56" data-testid="select-ledger-item-filter"><SelectValue placeholder="All items" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            {items.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.code} — {i.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-48" data-testid="select-ledger-store-filter"><SelectValue placeholder="All stores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {stores.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading stock ledger…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No stock movements match these filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Item</TableHead><TableHead>Store</TableHead>
                <TableHead>Type</TableHead><TableHead>Direction</TableHead><TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Balance after</TableHead><TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((e) => (
                <TableRow key={e.id} data-testid={`row-ledger-${e.id}`}>
                  <TableCell>{new Date(e.createdAt).toLocaleString("en-KE")}</TableCell>
                  <TableCell>{itemName(e.itemId)}</TableCell>
                  <TableCell>{storeName(e.storeId)}</TableCell>
                  <TableCell className="capitalize">{e.transactionType.replace(/_/g, " ")}</TableCell>
                  <TableCell>
                    <Badge variant={e.direction === "in" ? "secondary" : "outline"}>{e.direction === "in" ? "In" : "Out"}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.balanceAfter}</TableCell>
                  <TableCell>{e.createdBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ================= Stock Adjustment =================
const adjustmentFormSchema = z.object({
  itemId: z.number().min(1, "Item is required"),
  storeId: z.number().min(1, "Store is required"),
  direction: z.enum(["in", "out"]),
  quantity: z.number().positive("Quantity must be greater than zero"),
  notes: z.string().optional().nullable(),
});

function StockAdjustmentDialog({ items, stores }: { items: InventoryItem[]; stores: Store[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof adjustmentFormSchema>>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: { itemId: items[0]?.id ?? 0, storeId: stores[0]?.id ?? 0, direction: "in", quantity: 0, notes: "" },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof adjustmentFormSchema>) => apiRequest("POST", "/api/inventory/stock-adjustments", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/stock-balances"] });
      toast({ title: "Stock adjustment recorded" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Couldn't record adjustment", description: extractErrorMessage(err.message), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-adjustment"><ArrowUpDown className="h-4 w-4 mr-1" /> New adjustment</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manual stock adjustment</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="itemId" render={({ field }) => (
              <FormItem>
                <FormLabel>Item</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-adjustment-item"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{items.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.code} — {i.name}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="storeId" render={({ field }) => (
              <FormItem>
                <FormLabel>Store</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-adjustment-store"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="direction" render={({ field }) => (
                <FormItem>
                  <FormLabel>Direction</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-adjustment-direction"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="in">Stock in (increase)</SelectItem>
                      <SelectItem value="out">Stock out (decrease)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem><FormLabel>Quantity</FormLabel><FormControl><Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber || 0)} data-testid="input-adjustment-quantity" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-adjustment-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-adjustment">
                {mutation.isPending ? "Saving..." : "Record adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function StockAdjustmentTab({ canAdjust }: { canAdjust: boolean }) {
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  return (
    <Card className="p-6 space-y-4">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Manually correct stock counts (e.g. after a physical count, breakage, or spoilage). Every adjustment is recorded in the stock ledger with your name attached.
      </p>
      {canAdjust ? (
        <StockAdjustmentDialog items={items} stores={stores} />
      ) : (
        <Button size="sm" disabled title="Requires the 'adjust inventory' right" data-testid="button-new-adjustment">
          <Lock className="h-4 w-4 mr-1" /> New adjustment
        </Button>
      )}
    </Card>
  );
}

// ================= Page =================
export default function Inventory() {
  const { data: currentUser } = useCurrentUser();
  const canAdjust = Boolean(currentUser?.isAdmin || currentUser?.canAdjustInventory);
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/inventory/stores"] });
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const { data: balances = [] } = useQuery<StockBalance[]>({ queryKey: ["/api/inventory/stock-balances"] });
  const lowStockCount = items.filter((it) => {
    const total = balances.filter((b) => b.itemId === it.id).reduce((s, b) => s + b.balance, 0);
    return it.reorderLevel > 0 && total <= it.reorderLevel;
  }).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Inventory" description="Stores, item catalogue, stock ledger, and manual adjustments." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Stores" value={String(stores.length)} icon={Warehouse} testId="stat-stores-count" />
        <StatCard label="Inventory items" value={String(items.length)} icon={Package} testId="stat-items-count" />
        <StatCard label="Items at/below reorder level" value={String(lowStockCount)} icon={ClipboardList} accent="warning" testId="stat-low-stock-count" />
      </div>

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances" data-testid="tab-stock-balances">Stock Balances</TabsTrigger>
          <TabsTrigger value="items" data-testid="tab-items">Items</TabsTrigger>
          <TabsTrigger value="stores" data-testid="tab-stores">Stores</TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-stock-ledger">Stock Ledger</TabsTrigger>
          <TabsTrigger value="adjustment" data-testid="tab-stock-adjustment">Stock Adjustment</TabsTrigger>
        </TabsList>
        <TabsContent value="balances" className="mt-4"><StockBalancesTab /></TabsContent>
        <TabsContent value="items" className="mt-4"><ItemsTab canAdjust={canAdjust} /></TabsContent>
        <TabsContent value="stores" className="mt-4"><StoresTab canAdjust={canAdjust} /></TabsContent>
        <TabsContent value="ledger" className="mt-4"><StockLedgerTab /></TabsContent>
        <TabsContent value="adjustment" className="mt-4"><StockAdjustmentTab canAdjust={canAdjust} /></TabsContent>
      </Tabs>
    </div>
  );
}
