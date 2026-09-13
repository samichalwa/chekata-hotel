import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, LayoutGrid, UtensilsCrossed, Lock } from "lucide-react";
import { PageHeader } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-auth";
import type { MenuItem, TableRow as TableEntity } from "@shared/schema";

// ---------------------------------------------------------------------------
// Tables list
// ---------------------------------------------------------------------------

const tableFormSchema = z.object({
  name: z.string().min(1, "Table name is required"),
  outlet: z.string().min(1),
  capacity: z.coerce.number().int().min(0).optional().nullable(),
  active: z.coerce.number().default(1),
});

function TableFormDialog({ table, trigger }: { table?: TableEntity; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof tableFormSchema>>({
    resolver: zodResolver(tableFormSchema),
    defaultValues: table
      ? { name: table.name, outlet: table.outlet, capacity: table.capacity ?? undefined, active: table.active }
      : { name: "", outlet: "both", capacity: undefined, active: 1 },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof tableFormSchema>) => {
      const payload = { ...values, capacity: values.capacity ?? null };
      if (table) return apiRequest("PATCH", `/api/tables/${table.id}`, payload);
      return apiRequest("POST", "/api/tables", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: table ? "Table updated" : "Table added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{table ? "Edit table" : "Add table"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Table name</FormLabel>
                <FormControl><Input placeholder="e.g. Table 1, Bar Stool 3" {...field} data-testid="input-table-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="outlet" render={({ field }) => (
                <FormItem>
                  <FormLabel>Outlet</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-table-outlet"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="both">Bar &amp; Restaurant</SelectItem>
                      <SelectItem value="bar">Bar only</SelectItem>
                      <SelectItem value="restaurant">Restaurant only</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="capacity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Seats (optional)</FormLabel>
                  <FormControl><Input type="number" min={0} {...field} value={field.value ?? ""} data-testid="input-table-capacity" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <FormLabel className="mb-0">Available for new orders</FormLabel>
                <FormControl>
                  <Switch checked={field.value === 1} onCheckedChange={(c) => field.onChange(c ? 1 : 0)} data-testid="switch-table-active" />
                </FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-table">
                {mutation.isPending ? "Saving..." : "Save table"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function TablesTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { data: tables = [], isLoading } = useQuery<TableEntity[]>({ queryKey: ["/api/tables"] });

  const deleteTable = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tables/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tables"] }); toast({ title: "Table removed" }); },
    onError: (err: Error) => toast({ title: "Couldn't remove table", description: err.message, variant: "destructive" }),
  });

  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-card-border">
        <div>
          <h2 className="text-lg font-semibold">Tables</h2>
          {!canManage && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Lock className="h-3 w-3" /> View-only — ask an administrator for edit rights.</p>}
        </div>
        {canManage && <TableFormDialog trigger={<Button size="sm" data-testid="button-new-table"><Plus className="h-4 w-4 mr-1" /> Add table</Button>} />}
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading tables…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No tables yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => (
                <TableRow key={t.id} data-testid={`row-table-${t.id}`}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.outlet === "both" ? "Bar & Restaurant" : t.outlet === "bar" ? "Bar" : "Restaurant"}</TableCell>
                  <TableCell>{t.capacity ?? "—"}</TableCell>
                  <TableCell><Badge variant={t.active ? "secondary" : "outline"}>{t.active ? "Active" : "Inactive"}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <TableFormDialog table={t} trigger={
                          <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-table-${t.id}`}><Pencil className="h-4 w-4" /></Button>
                        } />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-table-${t.id}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {t.name}?</AlertDialogTitle>
                              <AlertDialogDescription>It will no longer be selectable when starting new orders.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteTable.mutate(t.id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Menu items list
// ---------------------------------------------------------------------------

const menuItemFormSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  category: z.string().min(1),
  price: z.coerce.number().positive("Price must be greater than 0"),
  active: z.coerce.number().default(1),
});

function MenuItemFormDialog({ item, trigger }: { item?: MenuItem; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof menuItemFormSchema>>({
    resolver: zodResolver(menuItemFormSchema),
    defaultValues: item ? { name: item.name, category: item.category, price: item.price, active: item.active } : { name: "", category: "bar", price: 0, active: 1 },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof menuItemFormSchema>) => {
      if (item) return apiRequest("PATCH", `/api/menu-items/${item.id}`, values);
      return apiRequest("POST", "/api/menu-items", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
      toast({ title: item ? "Item updated" : "Item added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? "Edit menu item" : "Add menu item"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Item name</FormLabel>
                <FormControl><Input placeholder="e.g. Tusker Lager" {...field} data-testid="input-menu-item-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Outlet</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-menu-category"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="bar">Bar</SelectItem>
                      <SelectItem value="restaurant">Restaurant</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem>
                  <FormLabel>Price (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-menu-item-price" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <FormLabel className="mb-0">Available on menu</FormLabel>
                <FormControl>
                  <Switch checked={field.value === 1} onCheckedChange={(c) => field.onChange(c ? 1 : 0)} data-testid="switch-menu-item-active" />
                </FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-menu-item">
                {mutation.isPending ? "Saving..." : "Save item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function MenuItemsTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { data: menuItems = [], isLoading } = useQuery<MenuItem[]>({ queryKey: ["/api/menu-items"] });

  const deleteMenuItem = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/menu-items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] }); toast({ title: "Item removed" }); },
    onError: (err: Error) => toast({ title: "Couldn't remove item", description: err.message, variant: "destructive" }),
  });

  const sorted = [...menuItems].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-card-border">
        <div>
          <h2 className="text-lg font-semibold">Menu items</h2>
          {!canManage && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Lock className="h-3 w-3" /> View-only — ask an administrator for edit rights.</p>}
        </div>
        {canManage && <MenuItemFormDialog trigger={<Button size="sm" data-testid="button-new-menu-item"><Plus className="h-4 w-4 mr-1" /> Add item</Button>} />}
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading menu…</div>
      ) : sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No items yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Availability</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m) => (
                <TableRow key={m.id} data-testid={`row-menu-item-${m.id}`}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell><Badge variant="outline">{m.category === "bar" ? "Bar" : "Restaurant"}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(m.price)}</TableCell>
                  <TableCell><Badge variant={m.active ? "secondary" : "outline"}>{m.active ? "On menu" : "Hidden"}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <MenuItemFormDialog item={m} trigger={
                          <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-menu-item-${m.id}`}><Pencil className="h-4 w-4" /></Button>
                        } />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-menu-item-${m.id}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {m.name}?</AlertDialogTitle>
                              <AlertDialogDescription>It will no longer be selectable on new orders.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMenuItem.mutate(m.id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function Lists() {
  const { data: currentUser } = useCurrentUser();
  const canManageTables = Boolean(currentUser?.isAdmin || currentUser?.canManageTablesList);
  const canManageMenuItems = Boolean(currentUser?.isAdmin || currentUser?.canManageMenuItemsList);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Lists" description="Manage the shared reference lists used across Bar & Restaurant — tables and menu items." />

      <Tabs defaultValue="tables">
        <TabsList>
          <TabsTrigger value="tables" data-testid="tab-lists-tables"><LayoutGrid className="h-4 w-4 mr-1.5" /> Tables</TabsTrigger>
          <TabsTrigger value="menu-items" data-testid="tab-lists-menu-items"><UtensilsCrossed className="h-4 w-4 mr-1.5" /> Menu Items</TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="mt-4">
          <TablesTab canManage={canManageTables} />
        </TabsContent>
        <TabsContent value="menu-items" className="mt-4">
          <MenuItemsTab canManage={canManageMenuItems} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
