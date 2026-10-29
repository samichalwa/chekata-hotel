// Bar & Restaurant — customer per visit (C-000001) with separate bar (B-…) and restaurant (R-…)
// orders, one bill, payments against the customer number (oldest order first), automatic close on
// full payment, manual close with a reason, and posting to an accommodation guest's room bill.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, UtensilsCrossed, Wine, Receipt, X, MessageCircle, Info, Undo2, Users, Printer, BedDouble, Lock, QrCode as QrIcon, Clock, ExternalLink, Copy } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, titleCase } from "@/lib/format";
import { buildWhatsAppLink, buildDocumentPdfUrl } from "@/lib/whatsapp";
import { CreditNoteDialog } from "@/components/credit-note-dialog";
import { PayQrCodesDialog } from "@/components/pay-qr";
import { QrCode, printQrCard } from "@/components/qr-code";
import { RecordPaymentButton, usePendingOnlinePayments } from "@/components/record-payment-button";
import { ScanTableButton } from "@/components/scan-table-qr";
import { orderRevenue } from "@shared/pos";
import { Link } from "wouter";
import type { MenuItem, Order, OrderItem, PosCustomer, TableRow as TableEntity } from "@shared/schema";

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const NO_TABLE = "__none__";
const time = (ms?: number | null) => ms ? new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const outletLabel = (o: string) => (o === "bar" ? "Bar" : "Restaurant");

type BillOrder = Order & { items: OrderItem[]; net: number; owed: number };
type CustomerView = PosCustomer & { orders: BillOrder[]; total: number; paid: number; balance: number; unpaidClosed: number; roomPosted: number; pending: boolean };
interface Server { id: number; name: string; role: string; department: string }
interface RoomGuest { id: number; guestName: string; guestPhone: string | null; status: string; checkIn: string; checkOut: string; roomName: string | null }

const CUSTOMER_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "Open", variant: "secondary" },
  settled: { label: "Paid", variant: "default" },
  closed_unpaid: { label: "Closed unpaid", variant: "destructive" },
  room_posted: { label: "Posted to room", variant: "outline" },
};
const ORDER_STATUS: Record<string, string> = { open: "Open", paid: "Paid", cancelled: "Cancelled", closed_unpaid: "Closed unpaid", room_posted: "Posted to room" };

function invalidatePos() {
  for (const k of [["/api/pos/customers"], ["/api/orders"], ["/api/documents"], ["/api/online-payments"], ["/api/accommodation-bookings"], ["/api/director/summary"]]) queryClient.invalidateQueries({ queryKey: k });
}

// ---------- Table picker: scan the table QR, or choose from the list ----------
function TablePicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { data: tables = [] } = useQuery<TableEntity[]>({ queryKey: ["/api/tables"] });
  const { toast } = useToast();
  return (
    <div className="flex gap-2">
      <Select value={value ? String(value) : NO_TABLE} onValueChange={(v) => onChange(v === NO_TABLE ? null : Number(v))}>
        <SelectTrigger className="flex-1" data-testid="select-customer-table"><SelectValue placeholder="No table" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TABLE}>No table (counter / takeaway)</SelectItem>
          {tables.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name.trim()}</SelectItem>)}
        </SelectContent>
      </Select>
      <ScanTableButton size="default" onTable={(t) => { onChange(t.id); toast({ title: `Table ${t.name} assigned` }); }} />
    </div>
  );
}

// ---------- New customer ----------
function NewCustomerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [tableId, setTableId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const reset = () => { setTableId(null); setName(""); setPhone(""); setEmail(""); };
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pos/customers", { tableId, name: name || null, phone: phone || null, email: email || null })).json() as Promise<CustomerView>,
    onSuccess: (c) => { invalidatePos(); toast({ title: `Customer ${c.customerNo} opened` }); reset(); onOpenChange(false); onCreated(c.id); },
    onError: (e) => toast({ title: "Couldn't open the customer", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>The system gives the customer a number for this visit. Name and phone are optional.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Table</Label><TablePicker value={tableId} onChange={setTableId} /></div>
          <div className="space-y-1.5"><Label htmlFor="nc-name">Name (optional)</Label><Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-new-customer-name" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="nc-phone">Phone (optional)</Label><Input id="nc-phone" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-new-customer-phone" /></div>
            <div className="space-y-1.5"><Label htmlFor="nc-email">Email (optional)</Label><Input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-new-customer-email" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="button-create-customer">{create.isPending ? "Opening…" : "Open customer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- One order inside the customer's bill ----------
function OrderBlock({ order, menuItems, editable }: { order: BillOrder; menuItems: MenuItem[]; editable: boolean }) {
  const { toast } = useToast();
  const [menuId, setMenuId] = useState("");
  const [qty, setQty] = useState(1);
  const canEdit = editable && order.status === "open" && (order.amountPaid ?? 0) <= 0;
  const menu = menuItems.filter((m) => m.category === order.outlet && m.active === 1).sort((a, b) => a.name.localeCompare(b.name));
  const add = useMutation({
    mutationFn: async () => {
      const m = menuItems.find((x) => x.id === Number(menuId));
      if (!m) throw new Error("Choose an item first");
      await apiRequest("POST", "/api/order-items", { orderId: order.id, menuItemId: m.id, itemName: m.name, price: m.price, quantity: qty, subtotal: m.price * qty });
    },
    onSuccess: () => { setMenuId(""); setQty(1); invalidatePos(); },
    onError: (e) => toast({ title: "Couldn't add the item", description: errMsg(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/order-items/${id}`),
    onSuccess: () => invalidatePos(),
    onError: (e) => toast({ title: "Couldn't remove the item", description: errMsg(e), variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/orders/${order.id}`, { status: "cancelled" }),
    onSuccess: () => { invalidatePos(); toast({ title: `${order.orderNo} cancelled` }); },
    onError: (e) => toast({ title: "Couldn't cancel the order", description: errMsg(e), variant: "destructive" }),
  });
  const Icon = order.outlet === "bar" ? Wine : UtensilsCrossed;
  return (
    <div className="rounded-md border border-border" data-testid={`order-block-${order.orderNo ?? order.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/40 p-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium"><Icon className="h-4 w-4 shrink-0" /> {order.orderNo ?? `Order #${order.id}`} · {outletLabel(order.outlet)}</p>
          <p className="text-xs text-muted-foreground">{time(order.orderedAt ?? order.createdAt)} · Served by {order.servedByName ?? "—"}{order.billedBy ? ` · Billed by ${order.billedBy}` : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          {order.status !== "open" && <Badge variant="outline">{ORDER_STATUS[order.status] ?? titleCase(order.status)}</Badge>}
          {editable && order.status === "open" && (order.amountPaid ?? 0) <= 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid={`button-cancel-order-${order.id}`}>Cancel order</Button>
          )}
          {(order.amountPaid ?? 0) - (order.creditedAmount ?? 0) > 0 && (
            <CreditNoteDialog endpoint={`/api/orders/${order.id}/credit-note`} invalidateKeys={[["/api/pos/customers"], ["/api/orders"], ["/api/documents"]]}
              maxAmount={(order.amountPaid ?? 0) - (order.creditedAmount ?? 0)} recipientName={order.customerName || "Guest"} recipientPhone={order.customerPhone}
              trigger={<Button size="icon" variant="ghost" className="h-7 w-7" title="Issue credit note" data-testid={`button-credit-note-${order.id}`}><Undo2 className="h-4 w-4" /></Button>} />
          )}
        </div>
      </div>
      <div className="divide-y divide-border text-sm">
        {order.items.length === 0 ? <p className="p-2.5 text-center text-muted-foreground">No items yet.</p> : order.items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-2 px-2.5 py-2" data-testid={`row-order-item-${it.id}`}>
            <span className="min-w-0">{it.itemName} <span className="text-muted-foreground">× {it.quantity}</span></span>
            <span className="flex items-center gap-1">
              <span className="tabular-nums">{formatKES(it.subtotal)}</span>
              {canEdit && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove.mutate(it.id)} title="Remove" data-testid={`button-remove-order-item-${it.id}`}><X className="h-3.5 w-3.5" /></Button>}
            </span>
          </div>
        ))}
      </div>
      {canEdit && (
        menu.length === 0 ? <p className="border-t border-border p-2.5 text-xs text-muted-foreground">No {outletLabel(order.outlet).toLowerCase()} menu items. Add them on the Lists page.</p> : (
          <div className="flex items-center gap-2 border-t border-border p-2.5">
            <Select value={menuId} onValueChange={setMenuId}>
              <SelectTrigger className="min-w-0 flex-1" data-testid={`select-add-item-${order.id}`}><SelectValue placeholder="Add an item" /></SelectTrigger>
              <SelectContent>{menu.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name} — {formatKES(m.price)}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-16" aria-label="Quantity" data-testid={`input-item-qty-${order.id}`} />
            <Button size="icon" onClick={() => add.mutate()} disabled={!menuId || add.isPending} title="Add item" data-testid={`button-add-item-${order.id}`}><Plus className="h-4 w-4" /></Button>
          </div>
        )
      )}
      {editable && order.status === "open" && (order.amountPaid ?? 0) > 0 && (
        <p className="flex items-center gap-1.5 border-t border-border p-2.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Part paid — start a new order for more items.</p>
      )}
      <div className="flex justify-between gap-2 border-t border-border p-2.5 text-sm">
        <span className="text-muted-foreground">Order total{(order.amountPaid ?? 0) > 0 ? ` · paid ${formatKES(order.amountPaid ?? 0)}` : ""}</span>
        <span className="font-semibold tabular-nums">{formatKES(order.net)}</span>
      </div>
    </div>
  );
}

// ---------- The customer's bill ----------
function CustomerDialog({ customerId, onClose, menuItems }: { customerId: number; onClose: () => void; menuItems: MenuItem[] }) {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const { data: c } = useQuery<CustomerView>({ queryKey: ["/api/pos/customers", customerId], refetchInterval: 30000 });
  const { data: servers = [] } = useQuery<Server[]>({ queryKey: ["/api/pos/servers"] });
  const pendingMap = usePendingOnlinePayments();
  const [outlet, setOutlet] = useState<string>("");
  const [serverId, setServerId] = useState<string>("");
  const [details, setDetails] = useState<{ name: string; phone: string; email: string } | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const isOpen = c?.status === "open";
  const d = details ?? { name: c?.name ?? "", phone: c?.phone ?? "", email: c?.email ?? "" };
  const dirty = !!c && !!details && (details.name !== (c.name ?? "") || details.phone !== (c.phone ?? "") || details.email !== (c.email ?? ""));
  const pending = c ? pendingMap.get(c.customerNo) ?? null : null;
  const hasItems = !!c && c.orders.some((o) => o.net > 0);

  const save = useMutation({
    mutationFn: async (body: any) => (await apiRequest("PATCH", `/api/pos/customers/${customerId}`, body)).json(),
    onSuccess: () => { setDetails(null); invalidatePos(); toast({ title: "Saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const newOrder = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/pos/customers/${customerId}/orders`, { outlet, servedByStaffId: Number(serverId) })).json() as Promise<Order>,
    onSuccess: (o) => { invalidatePos(); toast({ title: `Order ${o.orderNo} started` }); setOutlet(""); },
    onError: (e) => toast({ title: "Couldn't start the order", description: errMsg(e), variant: "destructive" }),
  });
  const bill = useMutation({
    mutationFn: async (sendEmail: boolean) => (await apiRequest("POST", `/api/pos/customers/${customerId}/bill`, { email: sendEmail })).json() as Promise<{ id: number; publicToken: string; status: string; errorMessage?: string }>,
    onError: (e) => toast({ title: "Couldn't create the bill", description: errMsg(e), variant: "destructive" }),
  });
  const printBill = async () => {
    const w = window.open("", "_blank");
    try {
      const r = await bill.mutateAsync(false);
      const url = buildDocumentPdfUrl(r.id, r.publicToken);
      if (w) w.location.href = url; else window.open(url, "_blank");
      invalidatePos();
    } catch { w?.close(); }
  };
  const emailBill = async () => {
    const r = await bill.mutateAsync(true).catch(() => null);
    if (!r) return;
    invalidatePos();
    toast(r.status === "sent" ? { title: "Bill emailed" } : { title: "Bill not emailed", description: r.errorMessage ?? "Check the email address.", variant: "destructive" });
  };
  const whatsappBill = async () => {
    if (!c) return;
    const r = await bill.mutateAsync(false).catch(() => null);
    if (!r) return;
    const pdf = buildDocumentPdfUrl(r.id, r.publicToken);
    const payPart = isOpen && c.payToken && c.balance > 0 ? `\n\nPay by M-Pesa here: ${window.location.origin}/#/pay/${c.payToken}` : "";
    const msg = `Hi ${c.name || "there"}, here is your bill ${c.customerNo}${c.tableName ? ` (${c.tableName})` : ""}: total ${formatKES(c.total)}, paid ${formatKES(c.paid)}, balance ${formatKES(c.balance)}.\n\nBill (PDF): ${pdf}${payPart}`;
    const link = buildWhatsAppLink(c.phone, msg, me?.environment);
    if (link) window.open(link, "_blank");
  };
  const showQr = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/pos/customers/${customerId}/pay-link`)).json() as Promise<{ path: string }>,
    onSuccess: (r) => setQrUrl(`${window.location.origin}${r.path}`),
    onError: (e) => toast({ title: "Couldn't create the QR code", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {!c ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2" data-testid="text-customer-title">
                Customer {c.customerNo}
                <Badge variant={CUSTOMER_STATUS[c.status]?.variant ?? "outline"}>{CUSTOMER_STATUS[c.status]?.label ?? c.status}</Badge>
              </DialogTitle>
              <DialogDescription>Opened {time(c.createdAt)}{c.createdBy ? ` by ${c.createdBy}` : ""}{c.closedAt && c.status !== "open" ? ` · closed ${time(c.closedAt)}${c.closedBy ? ` by ${c.closedBy}` : ""}` : ""}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Table and details */}
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-1.5">
                  <Label>Table</Label>
                  {isOpen ? <TablePicker value={c.tableId} onChange={(id) => save.mutate({ tableId: id })} /> : <p className="text-sm">{c.tableName ?? "No table"}</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="cd-name">Name</Label><Input id="cd-name" disabled={!isOpen} value={d.name} onChange={(e) => setDetails({ ...d, name: e.target.value })} data-testid="input-customer-name" /></div>
                  <div className="space-y-1.5"><Label htmlFor="cd-phone">Phone</Label><Input id="cd-phone" disabled={!isOpen} inputMode="tel" placeholder="07XXXXXXXX" value={d.phone} onChange={(e) => setDetails({ ...d, phone: e.target.value })} data-testid="input-customer-phone" /></div>
                  <div className="space-y-1.5"><Label htmlFor="cd-email">Email</Label><Input id="cd-email" disabled={!isOpen} type="email" value={d.email} onChange={(e) => setDetails({ ...d, email: e.target.value })} data-testid="input-customer-email" /></div>
                </div>
                {dirty && <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setDetails(null)}>Undo</Button><Button size="sm" onClick={() => save.mutate({ name: d.name, phone: d.phone, email: d.email })} disabled={save.isPending} data-testid="button-save-customer">Save details</Button></div>}
              </div>

              {/* Orders */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Orders</h3>
                {c.orders.length === 0 && <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No orders yet. Start a bar or restaurant order below.</p>}
                {c.orders.map((o) => <OrderBlock key={o.id} order={o} menuItems={menuItems} editable={isOpen} />)}
                {isOpen && (
                  <div className="flex flex-col gap-2 rounded-md border border-border p-2.5 sm:flex-row sm:items-center">
                    <Select value={outlet} onValueChange={setOutlet}>
                      <SelectTrigger className="sm:w-40" data-testid="select-new-order-outlet"><SelectValue placeholder="Bar or restaurant" /></SelectTrigger>
                      <SelectContent><SelectItem value="bar">Bar</SelectItem><SelectItem value="restaurant">Restaurant</SelectItem></SelectContent>
                    </Select>
                    <Select value={serverId} onValueChange={setServerId}>
                      <SelectTrigger className="min-w-0 flex-1" data-testid="select-new-order-server"><SelectValue placeholder={servers.length ? "Served by (staff)" : "No active staff in the register"} /></SelectTrigger>
                      <SelectContent>{servers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name} · {s.role}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button onClick={() => newOrder.mutate()} disabled={!outlet || !serverId || newOrder.isPending} data-testid="button-start-order"><Plus className="h-4 w-4 mr-1" /> New order</Button>
                  </div>
                )}
              </div>

              {/* Bill totals */}
              <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Bill total</span><span className="tabular-nums" data-testid="text-bill-total">{formatKES(c.total)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums" data-testid="text-bill-paid">{formatKES(c.paid)}</span></div>
                {c.roomPosted > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Posted to room bill</span><span className="tabular-nums">{formatKES(c.roomPosted - c.orders.filter((o) => o.status === "room_posted").reduce((s, o) => s + (o.amountPaid ?? 0), 0))}</span></div>}
                {c.unpaidClosed > 0 && <div className="flex justify-between text-destructive"><span>Closed unpaid</span><span className="tabular-nums">{formatKES(c.unpaidClosed)}</span></div>}
                <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Balance</span><span className="tabular-nums" data-testid="text-bill-balance">{formatKES(c.balance)}</span></div>
                {c.closeReason && <p className="pt-1 text-xs text-muted-foreground">Close reason: {c.closeReason}</p>}
              </div>

              {pending && (
                <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="box-bill-pending-payment">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <p className="font-medium">Guest paid by M-Pesa — waiting for confirmation</p>
                    <p className="text-muted-foreground">{pending.guestName} · M-Pesa <span className="font-medium text-foreground tabular-nums">{pending.mpesaCode}</span> · {formatKES(pending.amount)}</p>
                    <Link href="/online-bookings" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Open Online bookings & payments</Link>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {isOpen && (c.balance > 0.5 || pending) && (
                  <RecordPaymentButton endpoint={`/api/pos/customers/${c.id}/payments`} due={c.balance} guestName={c.name || c.customerNo}
                    summary={`Bill ${c.customerNo}${c.tableName ? ` · ${c.tableName}` : ""}`} invalidate={[["/api/pos/customers"], ["/api/orders"]]} pending={pending} testId={`customer-${c.id}`} />
                )}
                <Button size="sm" variant="outline" onClick={printBill} disabled={!hasItems || bill.isPending} data-testid="button-print-bill"><Printer className="h-4 w-4 mr-1" /> Print bill</Button>
                <Button size="sm" variant="outline" onClick={emailBill} disabled={!hasItems || !c.email || bill.isPending} title={c.email ? "" : "Add an email first"} data-testid="button-email-bill">Email bill</Button>
                <Button size="sm" variant="outline" onClick={whatsappBill} disabled={!hasItems || !buildWhatsAppLink(c.phone, "x") || bill.isPending} title={c.phone ? "" : "Add a phone number first"} data-testid="button-whatsapp-bill"><MessageCircle className="h-4 w-4 mr-1" /> WhatsApp</Button>
                {isOpen && c.balance > 0 && <Button size="sm" variant="outline" onClick={() => showQr.mutate()} disabled={showQr.isPending} data-testid="button-show-pay-qr"><QrIcon className="h-4 w-4 mr-1" /> Guest pays by QR</Button>}
                {isOpen && c.balance > 0 && !pending && <Button size="sm" variant="outline" onClick={() => setRoomOpen(true)} data-testid="button-post-to-room"><BedDouble className="h-4 w-4 mr-1" /> Post to room</Button>}
                {isOpen && !pending && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCloseOpen(true)} data-testid="button-close-bill">Close bill</Button>}
              </div>
              {isOpen && <p className="text-xs text-muted-foreground">Payments settle the oldest order first. Each order gets a receipt; the bill closes automatically when fully paid.</p>}

              {qrUrl && c && (
                <div className="space-y-2 rounded-md border border-border p-3" data-testid="box-bill-pay-link">
                  <div className="flex flex-col items-center gap-1">
                    <QrCode text={qrUrl} size={176} testId="img-bill-qr" />
                    <p className="text-xs text-muted-foreground">The guest scans this, pays {formatKES(c.balance)} by M-Pesa and pastes the SMS. You then confirm it.</p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(qrUrl); toast({ title: "Link copied" }); }}><Copy className="h-4 w-4 mr-1" /> Copy link</Button>
                    <Button size="sm" variant="outline" onClick={() => printQrCard({
                      title: `Bill ${c.customerNo}${c.tableName ? ` · ${c.tableName}` : ""}`,
                      subtitle: time(Date.now()),
                      lines: c.orders.filter((o) => o.net > 0).flatMap((o) => [{ label: `${o.orderNo} · ${time(o.orderedAt)} · ${o.servedByName ?? ""}` }, ...o.items.map((i) => ({ label: `  ${i.itemName} × ${i.quantity}`, amount: formatKES(i.subtotal) }))]),
                      total: formatKES(c.balance), url: qrUrl,
                    }) || toast({ title: "Allow pop-ups to print", variant: "destructive" })}><Printer className="h-4 w-4 mr-1" /> Print bill with QR</Button>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter><Button onClick={onClose} data-testid="button-close-customer">Done</Button></DialogFooter>
            {closeOpen && <CloseBillDialog c={c} onClose={() => setCloseOpen(false)} />}
            {roomOpen && <PostToRoomDialog c={c} onClose={() => setRoomOpen(false)} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloseBillDialog({ c, onClose }: { c: CustomerView; onClose: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const close = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/pos/customers/${c.id}/close`, { reason })).json(),
    onSuccess: () => { invalidatePos(); toast({ title: `Bill ${c.customerNo} closed` }); onClose(); },
    onError: (e) => toast({ title: "Couldn't close the bill", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close bill {c.customerNo}</DialogTitle>
          <DialogDescription>
            {c.balance > 0.5 ? `${formatKES(c.balance)} is still unpaid. It will be recorded as closed unpaid and is not counted as income.` : "Nothing is owed. Empty orders are removed."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="close-reason">Reason</Label>
          <Textarea id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest left without paying; manager approved" data-testid="input-close-reason" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button variant="destructive" onClick={() => close.mutate()} disabled={reason.trim().length < 3 || close.isPending} data-testid="button-confirm-close-bill">{close.isPending ? "Closing…" : "Close bill"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostToRoomDialog({ c, onClose }: { c: CustomerView; onClose: () => void }) {
  const { toast } = useToast();
  const { data: guests = [], isLoading } = useQuery<RoomGuest[]>({ queryKey: ["/api/pos/room-guests"], staleTime: 0 });
  const [bookingId, setBookingId] = useState("");
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/pos/customers/${c.id}/post-to-room`, { bookingId: Number(bookingId) })).json(),
    onSuccess: (r: any) => { invalidatePos(); toast({ title: `${formatKES(r.posted)} posted to the room bill` }); onClose(); },
    onError: (e) => toast({ title: "Couldn't post to the room", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Post to room bill</DialogTitle>
          <DialogDescription>{formatKES(c.balance)} unpaid on {c.customerNo} is added to the guest's accommodation bill and paid with the room.</DialogDescription>
        </DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading guests…</p> : guests.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-room-guests">No guest has a confirmed or checked-in room booking right now.</p>
        ) : (
          <div className="space-y-1.5">
            <Label>Guest</Label>
            <Select value={bookingId} onValueChange={setBookingId}>
              <SelectTrigger data-testid="select-room-guest"><SelectValue placeholder="Choose the guest" /></SelectTrigger>
              <SelectContent>{guests.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.roomName ?? "Room"} · {g.guestName} ({titleCase(g.status)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button onClick={() => post.mutate()} disabled={!bookingId || post.isPending} data-testid="button-confirm-post-to-room">{post.isPending ? "Posting…" : "Post to room"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerCard({ c, onOpen }: { c: CustomerView; onOpen: () => void }) {
  const orders = c.orders.filter((o) => o.net > 0 || o.status === "open");
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-md border border-border bg-card p-3 text-left hover-elevate" data-testid={`card-customer-${c.customerNo}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{c.customerNo}{c.tableName ? <span className="font-normal text-muted-foreground"> · {c.tableName}</span> : null}</p>
          <p className="truncate text-xs text-muted-foreground">{c.name || "No name"} · opened {time(c.createdAt)}</p>
        </div>
        <Badge variant={CUSTOMER_STATUS[c.status]?.variant ?? "outline"} className="shrink-0">{c.pending ? "Payment waiting" : CUSTOMER_STATUS[c.status]?.label}</Badge>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">{orders.length ? orders.map((o) => o.orderNo).join(", ") : "No orders yet"}</p>
      <div className="mt-1 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">Total <span className="tabular-nums text-foreground">{formatKES(c.total)}</span></span>
        {c.status === "open" ? <span className="font-medium tabular-nums">{formatKES(c.balance)} due</span> : <span className="tabular-nums text-muted-foreground">Paid {formatKES(c.paid)}</span>}
      </div>
    </button>
  );
}

export default function BarRestaurant() {
  const { data: menuItems = [], isLoading: menuLoading } = useQuery<MenuItem[]>({ queryKey: ["/api/menu-items"] });
  const { data: orders = [] } = useQuery<Order[]>({ queryKey: ["/api/orders"] });
  const { data: open = [], isLoading: openLoading } = useQuery<CustomerView[]>({ queryKey: ["/api/pos/customers"], refetchInterval: 30000 });
  const [closedDays, setClosedDays] = useState("7");
  const { data: closed = [], isLoading: closedLoading } = useQuery<CustomerView[]>({
    queryKey: ["/api/pos/customers", "closed", closedDays],
    queryFn: async () => (await apiRequest("GET", `/api/pos/customers?scope=closed&days=${closedDays}`)).json(),
  });
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const barRevenue = orders.filter((o) => o.outlet === "bar").reduce((s, o) => s + orderRevenue(o), 0);
  const restaurantRevenue = orders.filter((o) => o.outlet === "restaurant").reduce((s, o) => s + orderRevenue(o), 0);
  const openDue = open.reduce((s, c) => s + c.balance, 0);
  const q = search.trim().toLowerCase();
  const match = (c: CustomerView) => !q || [c.customerNo, c.name, c.phone, c.tableName, ...c.orders.map((o) => o.orderNo)].some((v) => String(v ?? "").toLowerCase().includes(q));
  const openShown = useMemo(() => open.filter(match), [open, q]);
  const closedShown = useMemo(() => closed.filter(match), [closed, q]);
  const barMenu = menuItems.filter((m) => m.category === "bar").sort((a, b) => a.name.localeCompare(b.name));
  const restaurantMenu = menuItems.filter((m) => m.category === "restaurant").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Bar & Restaurant" description="Open a customer, assign a table, take bar and restaurant orders, and settle one bill." action={<PayQrCodesDialog />} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Bar sales" value={formatKES(barRevenue)} icon={Wine} accent="success" testId="stat-bar-revenue" />
        <StatCard label="Restaurant sales" value={formatKES(restaurantRevenue)} icon={UtensilsCrossed} accent="success" testId="stat-restaurant-revenue" />
        <StatCard label="Open customers" value={String(open.length)} icon={Users} testId="stat-open-customers" />
        <StatCard label="Open bills due" value={formatKES(openDue)} icon={Receipt} accent="muted" testId="stat-open-due" />
      </div>

      <Tabs defaultValue="open">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="open" data-testid="tab-open-customers">Open ({open.length})</TabsTrigger>
            <TabsTrigger value="closed" data-testid="tab-closed-customers">Closed</TabsTrigger>
            <TabsTrigger value="menu" data-testid="tab-menu">Menu</TabsTrigger>
          </TabsList>
          <div className="flex w-full gap-2 sm:w-auto">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search C-/B-/R- number, name, table" className="min-w-0 flex-1 sm:w-64" data-testid="input-search-customers" />
            <Button onClick={() => setNewOpen(true)} data-testid="button-new-customer"><Plus className="h-4 w-4 mr-1" /> New customer</Button>
          </div>
        </div>

        <TabsContent value="open" className="mt-4">
          {openLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : openShown.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-open-customers">{q ? "No open customer matches your search." : "No open customers. Tap New customer to start."}</Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{openShown.map((c) => <CustomerCard key={c.id} c={c} onOpen={() => setOpenId(c.id)} />)}</div>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border p-4">
              <h2 className="text-lg font-semibold">Closed bills</h2>
              <Select value={closedDays} onValueChange={setClosedDays}>
                <SelectTrigger className="w-40" data-testid="select-closed-days"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">Last 24 hours</SelectItem><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="31">Last 31 days</SelectItem><SelectItem value="366">Last 12 months</SelectItem></SelectContent>
              </Select>
            </div>
            {closedLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : closedShown.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No closed bills in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead>Orders</TableHead>
                      <TableHead>Closed</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedShown.map((c) => (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)} data-testid={`row-closed-${c.customerNo}`}>
                        <TableCell className="font-medium">{c.customerNo}<span className="block text-xs font-normal text-muted-foreground">{c.name ?? ""}</span></TableCell>
                        <TableCell>{c.tableName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.orders.filter((o) => o.net > 0).map((o) => o.orderNo).join(", ") || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{time(c.closedAt)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(c.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(c.paid)}</TableCell>
                        <TableCell><Badge variant={CUSTOMER_STATUS[c.status]?.variant ?? "outline"}>{CUSTOMER_STATUS[c.status]?.label ?? c.status}</Badge></TableCell>
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
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-card-border">
                <h2 className="text-lg font-semibold flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</h2>
              </div>
              {menuLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading menu…</div>
              ) : list.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No items yet. Add some from the Lists page.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Availability</TableHead></TableRow></TableHeader>
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

      <NewCustomerDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setOpenId(id)} />
      {openId != null && <CustomerDialog customerId={openId} menuItems={menuItems} onClose={() => setOpenId(null)} />}
    </div>
  );
}
