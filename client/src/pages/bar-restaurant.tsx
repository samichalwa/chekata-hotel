import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, UtensilsCrossed, Wine, Receipt, X, MessageCircle } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
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
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, todayISO, nowTs, titleCase } from "@/lib/format";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { MenuItem, Order, OrderItem } from "@shared/schema";

const menuItemFormSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  category: z.string().min(1),
  price: z.coerce.number().positive("Price must be greater than 0"),
  active: z.coerce.number().default(1),
});

const orderFormSchema = z.object({
  outlet: z.string().min(1),
  reference: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  customerEmail: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  customerPhone: z.string().optional().nullable(),
  orderDate: z.string().min(1),
});

function MenuItemFormDialog({ item, trigger, defaultCategory }: { item?: MenuItem; trigger: React.ReactNode; defaultCategory?: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof menuItemFormSchema>>({
    resolver: zodResolver(menuItemFormSchema),
    defaultValues: item ? { name: item.name, category: item.category, price: item.price, active: item.active } : { name: "", category: defaultCategory ?? "bar", price: 0, active: 1 },
  });

  // Re-sync the outlet field to the section's default whenever the dialog is
  // (re)opened for a new item — otherwise a stale value can linger from a
  // previous open in the same mounted component.
  useEffect(() => {
    if (open && !item) {
      form.reset({ name: "", category: defaultCategory ?? "bar", price: 0, active: 1 });
    }
  }, [open]);

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

function NewOrderDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof orderFormSchema>>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: { outlet: "bar", reference: "", customerName: "", customerEmail: "", customerPhone: "", orderDate: todayISO() },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof orderFormSchema>) => {
      const res = await apiRequest("POST", "/api/orders", { ...values, status: "open", paymentMethod: null, totalAmount: 0, notes: null, createdAt: nowTs() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order started — add items now" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Start a new order</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="outlet" render={({ field }) => (
              <FormItem>
                <FormLabel>Outlet</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-order-outlet"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="restaurant">Restaurant</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="reference" render={({ field }) => (
              <FormItem>
                <FormLabel>Table / room (optional)</FormLabel>
                <FormControl><Input placeholder="e.g. Table 4 or Room 101" {...field} value={field.value ?? ""} data-testid="input-order-reference" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="customerName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer name (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-customer-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="customerEmail" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (receipt sent here)</FormLabel>
                  <FormControl><Input type="email" placeholder="guest@example.com" {...field} value={field.value ?? ""} data-testid="input-customer-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="customerPhone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone (for WhatsApp receipt, optional)</FormLabel>
                <FormControl><Input placeholder="07XXXXXXXX" {...field} value={field.value ?? ""} data-testid="input-customer-phone" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="orderDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-order-date" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-start-order">
                {mutation.isPending ? "Starting..." : "Start order"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function OrderManagerDialog({ order, menuItems, trigger }: { order: Order; menuItems: MenuItem[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const { toast } = useToast();

  const { data: items = [] } = useQuery<OrderItem[]>({
    queryKey: ["/api/orders", order.id, "items"],
    enabled: open,
  });

  const availableMenu = menuItems.filter((m) => m.category === order.outlet && m.active === 1);

  const refreshOrderTotal = async (newTotal: number) => {
    await apiRequest("PATCH", `/api/orders/${order.id}`, { totalAmount: newTotal });
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
  };

  const addItem = useMutation({
    mutationFn: async () => {
      const menuItem = menuItems.find((m) => m.id === Number(selectedMenuItemId));
      if (!menuItem) throw new Error("Select an item first");
      const subtotal = menuItem.price * quantity;
      await apiRequest("POST", "/api/order-items", {
        orderId: order.id, menuItemId: menuItem.id, itemName: menuItem.name, price: menuItem.price, quantity, subtotal,
      });
      await refreshOrderTotal(order.totalAmount + subtotal);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "items"] });
      setSelectedMenuItemId("");
      setQuantity(1);
    },
    onError: (err: Error) => toast({ title: "Couldn't add item", description: err.message, variant: "destructive" }),
  });

  const removeItem = useMutation({
    mutationFn: async (item: OrderItem) => {
      await apiRequest("DELETE", `/api/order-items/${item.id}`);
      await refreshOrderTotal(Math.max(0, order.totalAmount - item.subtotal));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "items"] }),
  });

  const [customerName, setCustomerName] = useState(order.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(order.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(order.customerPhone ?? "");

  const updateOrder = useMutation({
    mutationFn: async (data: Partial<Order>) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Order updated" });
      const doc = data?._document;
      if (doc?.status === "skipped") {
        toast({ title: "No email on file", description: "Add a customer email to send a receipt automatically." });
      } else if (doc?.status === "sent") {
        toast({ title: "Receipt emailed", description: "Sent to the customer's email address." });
      } else if (doc?.status === "failed") {
        toast({ title: "Email not sent", description: doc.errorMessage ?? "Check your Settings.", variant: "destructive" });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {titleCase(order.outlet)} order {order.reference ? `· ${order.reference}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border divide-y divide-border">
            {items.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">No items added yet.</div>
            ) : (
              items.map((it) => (
                <div key={it.id} className="flex items-center justify-between p-2.5 text-sm" data-testid={`row-order-item-${it.id}`}>
                  <div>
                    <span className="font-medium">{it.itemName}</span>
                    <span className="text-muted-foreground"> × {it.quantity}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{formatKES(it.subtotal)}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem.mutate(it)} data-testid={`button-remove-order-item-${it.id}`}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {availableMenu.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select value={selectedMenuItemId} onValueChange={setSelectedMenuItemId}>
                  <SelectTrigger data-testid="select-add-menu-item"><SelectValue placeholder="Choose an item to add" /></SelectTrigger>
                  <SelectContent>
                    {availableMenu.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name} — {formatKES(m.price)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} className="w-16" data-testid="input-order-item-quantity" />
              <Button onClick={() => addItem.mutate()} disabled={!selectedMenuItemId || addItem.isPending} data-testid="button-add-order-item">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Order total</span>
            <span className="font-semibold tabular-nums">{formatKES(order.totalAmount)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Customer name (optional)</label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onBlur={() => { if (customerName !== (order.customerName ?? "")) updateOrder.mutate({ customerName: customerName || null }); }}
                data-testid="input-order-customer-name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email (receipt sent here)</label>
              <Input
                type="email"
                placeholder="guest@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                onBlur={() => { if (customerEmail !== (order.customerEmail ?? "")) updateOrder.mutate({ customerEmail: customerEmail || null }); }}
                data-testid="input-order-customer-email"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Phone (for WhatsApp receipt, optional)</label>
            <div className="flex gap-2">
              <Input
                placeholder="07XXXXXXXX"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                onBlur={() => { if (customerPhone !== (order.customerPhone ?? "")) updateOrder.mutate({ customerPhone: customerPhone || null }); }}
                data-testid="input-order-customer-phone"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!buildWhatsAppLink(customerPhone, "x")}
                onClick={() => {
                  const message = `Hi ${customerName || "there"}, thank you for your ${titleCase(order.outlet)} order at The Chekata${order.reference ? ` (${order.reference})` : ""}. Total: ${formatKES(order.totalAmount)}${order.status === "paid" ? " — Paid in full." : " — Balance due."} We appreciate your visit!`;
                  const link = buildWhatsAppLink(customerPhone, message);
                  if (link) window.open(link, "_blank");
                }}
                data-testid="button-send-whatsapp-order"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={order.status} onValueChange={(v) => updateOrder.mutate({ status: v })}>
                <SelectTrigger data-testid="select-order-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Payment method</label>
              <Select value={order.paymentMethod ?? undefined} onValueChange={(v) => updateOrder.mutate({ paymentMethod: v })}>
                <SelectTrigger data-testid="select-payment-method"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="room_charge">Room charge</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)} data-testid="button-close-order-manager">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "secondary",
  paid: "default",
  cancelled: "destructive",
};

export default function BarRestaurant() {
  const { toast } = useToast();
  const { data: menuItems = [], isLoading: menuLoading } = useQuery<MenuItem[]>({ queryKey: ["/api/menu-items"] });
  const { data: orders = [], isLoading: ordersLoading } = useQuery<Order[]>({ queryKey: ["/api/orders"] });

  const deleteMenuItem = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/menu-items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] }); toast({ title: "Item removed" }); },
  });
  const deleteOrder = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/orders"] }); toast({ title: "Order removed" }); },
  });

  const barRevenue = orders.filter((o) => o.outlet === "bar" && o.status === "paid").reduce((s, o) => s + o.totalAmount, 0);
  const restaurantRevenue = orders.filter((o) => o.outlet === "restaurant" && o.status === "paid").reduce((s, o) => s + o.totalAmount, 0);
  const openOrders = orders.filter((o) => o.status === "open").length;

  const sortedOrders = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  const barMenu = menuItems.filter((m) => m.category === "bar").sort((a, b) => a.name.localeCompare(b.name));
  const restaurantMenu = menuItems.filter((m) => m.category === "restaurant").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Bar & Restaurant" description="Take orders, manage the menu, and track outlet revenue." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Bar revenue" value={formatKES(barRevenue)} icon={Wine} accent="success" testId="stat-bar-revenue" />
        <StatCard label="Restaurant revenue" value={formatKES(restaurantRevenue)} icon={UtensilsCrossed} accent="success" testId="stat-restaurant-revenue" />
        <StatCard label="Open orders" value={String(openOrders)} icon={Receipt} testId="stat-open-orders" />
        <StatCard label="Menu items" value={String(menuItems.length)} icon={UtensilsCrossed} accent="muted" testId="stat-menu-count" />
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders" data-testid="tab-orders">Orders</TabsTrigger>
          <TabsTrigger value="menu" data-testid="tab-menu">Menu</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Orders</h2>
              <NewOrderDialog trigger={<Button size="sm" data-testid="button-new-order"><Plus className="h-4 w-4 mr-1" /> New order</Button>} />
            </div>
            {ordersLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading orders…</div>
            ) : sortedOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No orders yet. Start the first one.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Outlet</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOrders.map((o) => (
                      <TableRow key={o.id} data-testid={`row-order-${o.id}`}>
                        <TableCell className="font-medium">{titleCase(o.outlet)}</TableCell>
                        <TableCell>{o.reference || "—"}</TableCell>
                        <TableCell>{o.orderDate}</TableCell>
                        <TableCell>{o.paymentMethod ? titleCase(o.paymentMethod) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(o.totalAmount)}</TableCell>
                        <TableCell><Badge variant={statusVariant[o.status]}>{titleCase(o.status)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <OrderManagerDialog order={o} menuItems={menuItems} trigger={
                              <Button size="icon" variant="ghost" title="Manage items" data-testid={`button-manage-order-${o.id}`}><Pencil className="h-4 w-4" /></Button>
                            } />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-order-${o.id}`}><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this order?</AlertDialogTitle>
                                  <AlertDialogDescription>This removes the order and all its items permanently.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteOrder.mutate(o.id)}>Delete</AlertDialogAction>
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
        </TabsContent>

        <TabsContent value="menu" className="mt-4 space-y-6">
          {([{ key: "bar", label: "Bar menu", list: barMenu, icon: Wine }, { key: "restaurant", label: "Restaurant menu", list: restaurantMenu, icon: UtensilsCrossed }] as const).map(({ key, label, list, icon: Icon }) => (
            <Card key={key}>
              <div className="flex items-center justify-between p-4 border-b border-card-border">
                <h2 className="text-lg font-semibold flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</h2>
                <MenuItemFormDialog defaultCategory={key} trigger={<Button size="sm" variant="outline" data-testid={`button-new-menu-item-${key}`}><Plus className="h-4 w-4 mr-1" /> Add item</Button>} />
              </div>
              {menuLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading menu…</div>
              ) : list.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No items yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Availability</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.map((m) => (
                        <TableRow key={m.id} data-testid={`row-menu-item-${m.id}`}>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(m.price)}</TableCell>
                          <TableCell><Badge variant={m.active ? "secondary" : "outline"}>{m.active ? "On menu" : "Hidden"}</Badge></TableCell>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
