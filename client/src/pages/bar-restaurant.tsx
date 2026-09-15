import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, UtensilsCrossed, Wine, Receipt, X, MessageCircle, CheckCircle2, Lock, Info, Undo2 } from "lucide-react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, todayISO, nowTs, titleCase } from "@/lib/format";
import { buildWhatsAppLink, fetchLatestDocumentPdfUrl } from "@/lib/whatsapp";
import { CreditNoteDialog } from "@/components/credit-note-dialog";
import { Link } from "wouter";
import type { MenuItem, Order, OrderItem, TableRow as TableEntity } from "@shared/schema";

const NO_TABLE_VALUE = "__none__";

const orderFormSchema = z.object({
  outlet: z.string().min(1),
  reference: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  customerEmail: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  customerPhone: z.string().optional().nullable(),
  orderDate: z.string().min(1),
});

function NewOrderDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: tables = [] } = useQuery<TableEntity[]>({ queryKey: ["/api/tables"], enabled: open });
  const form = useForm<z.infer<typeof orderFormSchema>>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: { outlet: "bar", reference: "", customerName: "", customerEmail: "", customerPhone: "", orderDate: todayISO() },
  });

  const outletWatch = form.watch("outlet");
  const availableTables = tables.filter((t) => t.active === 1 && (t.outlet === "both" || t.outlet === outletWatch));

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof orderFormSchema>) => {
      const payload = { ...values, reference: values.reference === NO_TABLE_VALUE ? null : values.reference };
      const res = await apiRequest("POST", "/api/orders", { ...payload, status: "open", paymentMethod: null, totalAmount: 0, notes: null, createdAt: nowTs() });
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
                <FormLabel>Table</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || NO_TABLE_VALUE}>
                  <FormControl><SelectTrigger data-testid="select-order-table"><SelectValue placeholder="Choose a table" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NO_TABLE_VALUE}>No table / walk-in</SelectItem>
                    {availableTables.map((t) => (
                      <SelectItem key={t.id} value={t.name}>{t.name}{t.capacity ? ` (seats ${t.capacity})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
  const { data: currentUser } = useCurrentUser();

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
  const [closePaymentMethod, setClosePaymentMethod] = useState(order.paymentMethod ?? "");
  const [closePaymentReference, setClosePaymentReference] = useState(order.paymentReference ?? "");
  const isOpen = order.status === "open";

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

  const closeOrder = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, { status: "paid", paymentMethod: closePaymentMethod, paymentReference: closePaymentReference || null });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Order closed — receipt generated" });
      const doc = data?._document;
      if (doc?.status === "sent") {
        toast({ title: "Receipt emailed", description: "Sent to the customer's email address." });
      } else if (doc?.status === "failed") {
        toast({ title: "Email not sent", description: doc.errorMessage ?? "Check your Settings.", variant: "destructive" });
      }
    },
    onError: (err: Error) => toast({ title: "Couldn't close order", description: err.message, variant: "destructive" }),
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
                    {isOpen && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem.mutate(it)} data-testid={`button-remove-order-item-${it.id}`}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {!isOpen && (
            <div className="flex items-center gap-2 rounded-md bg-muted/60 border border-border p-2.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              This order is {order.status} — items can no longer be added or removed.
            </div>
          )}

          {isOpen && availableMenu.length > 0 && (
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
                onClick={async () => {
                  const paymentDetail = order.status === "paid" && (order.paymentMethod || order.paymentReference)
                    ? ` Payment: ${[order.paymentMethod, order.paymentReference].filter(Boolean).join(" / ")}.`
                    : "";
                  let message = `Hi ${customerName || "there"}, thank you for your ${titleCase(order.outlet)} order at The Chekata${order.reference ? ` (${order.reference})` : ""}. Total: ${formatKES(order.totalAmount)}${order.status === "paid" ? " — Paid in full." : " — Balance due."}${paymentDetail} We appreciate your visit!`;
                  const pdfUrl = await fetchLatestDocumentPdfUrl(order.outlet === "bar" ? "bar" : "restaurant", order.id);
                  if (pdfUrl) message += `\n\nView/download your receipt: ${pdfUrl}`;
                  const link = buildWhatsAppLink(customerPhone, message, currentUser?.environment);
                  if (link) window.open(link, "_blank");
                }}
                data-testid="button-send-whatsapp-order"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
            </div>
          </div>

          {isOpen ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="text-xs font-medium text-muted-foreground">Payment method (required to close)</label>
              <Select value={closePaymentMethod} onValueChange={setClosePaymentMethod}>
                <SelectTrigger data-testid="select-payment-method"><SelectValue placeholder="Select payment method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="room_charge">Room charge</SelectItem>
                </SelectContent>
              </Select>
              <label className="text-xs font-medium text-muted-foreground">Payment reference (optional)</label>
              <Input
                placeholder="M-Pesa code, slip #, etc."
                value={closePaymentReference}
                onChange={(e) => setClosePaymentReference(e.target.value)}
                data-testid="input-order-payment-reference"
              />
              <Button
                className="w-full"
                disabled={!closePaymentMethod || items.length === 0 || closeOrder.isPending}
                onClick={() => closeOrder.mutate()}
                data-testid="button-close-and-receipt"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> {closeOrder.isPending ? "Closing..." : "Close & Generate Receipt"}
              </Button>
              {items.length === 0 && <p className="text-xs text-muted-foreground">Add at least one item before closing.</p>}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full text-destructive" data-testid="button-cancel-order-inline">Cancel this order instead</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                    <AlertDialogDescription>No receipt will be generated. This marks the order as cancelled.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Back</AlertDialogCancel>
                    <AlertDialogAction onClick={() => updateOrder.mutate({ status: "cancelled" })}>Cancel order</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : (
            <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={statusVariant[order.status]}>{titleCase(order.status)}</Badge>
            </div>
          )}
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

  const deleteOrder = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/orders"] }); toast({ title: "Order removed" }); },
  });

  const barRevenue = orders.filter((o) => o.outlet === "bar" && o.status === "paid").reduce((s, o) => s + o.totalAmount - (o.creditedAmount ?? 0), 0);
  const restaurantRevenue = orders.filter((o) => o.outlet === "restaurant" && o.status === "paid").reduce((s, o) => s + o.totalAmount - (o.creditedAmount ?? 0), 0);
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
                            {o.status === "paid" && o.totalAmount - (o.creditedAmount ?? 0) > 0 && (
                              <CreditNoteDialog
                                endpoint={`/api/orders/${o.id}/credit-note`}
                                invalidateKeys={[["/api/orders"], ["/api/documents"]]}
                                maxAmount={o.totalAmount - (o.creditedAmount ?? 0)}
                                recipientName={o.customerName || "Guest"}
                                recipientPhone={o.customerPhone}
                                trigger={
                                  <Button size="icon" variant="ghost" title="Issue credit note" data-testid={`button-credit-note-${o.id}`}><Undo2 className="h-4 w-4" /></Button>
                                }
                              />
                            )}
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
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            Menu items are managed on the <Link href="/lists" className="font-medium text-foreground underline underline-offset-2">Lists</Link> page. This view is read-only.
          </div>
          {([{ key: "bar", label: "Bar menu", list: barMenu, icon: Wine }, { key: "restaurant", label: "Restaurant menu", list: restaurantMenu, icon: UtensilsCrossed }] as const).map(({ key, label, list, icon: Icon }) => (
            <Card key={key}>
              <div className="flex items-center justify-between p-4 border-b border-card-border">
                <h2 className="text-lg font-semibold flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</h2>
              </div>
              {menuLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading menu…</div>
              ) : list.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No items yet. Add some from the Lists page.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Availability</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.map((m) => (
                        <TableRow key={m.id} data-testid={`row-menu-item-${m.id}`}>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(m.price)}</TableCell>
                          <TableCell><Badge variant={m.active ? "secondary" : "outline"}>{m.active ? "On menu" : "Hidden"}</Badge></TableCell>
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
