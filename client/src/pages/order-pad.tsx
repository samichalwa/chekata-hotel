// Order pad — a touch-first screen for waiters. Pick the customer (or open one at a table), tap dishes
// to build the round, then send it. Food goes to the kitchen screen at once; bar and restaurant items
// are split into their own orders on the customer's single bill.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Plus, Minus, Trash2, Send, UtensilsCrossed, Wine, Search, CookingPot, ListChecks, MessageSquare, UserRound, Receipt, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChoiceDialog, useMenuDishes } from "@/components/menu-builder";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MenuDish, Order, OrderItem, PosCustomer, TableRow as TableEntity } from "@shared/schema";

type BillOrder = Order & { items: OrderItem[]; net: number; owed: number };
type CustomerView = PosCustomer & { orders: BillOrder[]; total: number; paid: number; balance: number };
interface Server { id: number; name: string; role: string; department: string }
type Choice = { groupId: number; optionIds: number[] };
interface Line { key: string; dish: MenuDish; choices: Choice[]; notes: string; qty: number }

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const SERVER_KEY = "chekata.orderpad.server";
const KITCHEN_LABEL: Record<string, string> = { new: "In kitchen", preparing: "Preparing", ready: "Ready", served: "Served" };

function invalidatePos() {
  for (const k of [["/api/pos/customers"], ["/api/orders"], ["/api/kitchen/tickets"], ["/api/director/summary"]]) queryClient.invalidateQueries({ queryKey: k });
}
const linePrice = (l: Line) => l.dish.price + l.dish.groups.reduce((s, g) => s + g.options.filter((o) => l.choices.find((c) => c.groupId === g.id)?.optionIds.includes(o.id)).reduce((a, o) => a + o.extraPrice, 0), 0);
const choiceText = (l: Line) => l.dish.groups.map((g) => {
  const names = g.options.filter((o) => l.choices.find((c) => c.groupId === g.id)?.optionIds.includes(o.id)).map((o) => o.name);
  return names.length ? `${g.name}: ${names.join(", ")}` : "";
}).filter(Boolean).join(" · ");
function useWide() {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setWide(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return wide;
}
const newRoundId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- Who is serving (remembered on this device) ----------
function ServerDialog({ open, servers, value, onPick, onClose }: { open: boolean; servers: Server[]; value: number | null; onPick: (id: number) => void; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Who is serving?</DialogTitle>
          <DialogDescription>Tap your name. This screen remembers it until you change it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {servers.map((s) => (
            <button key={s.id} type="button" onClick={() => onPick(s.id)} data-testid={`button-server-${s.id}`}
              className={cn("min-h-16 rounded-md border p-3 text-left hover-elevate active-elevate-2", value === s.id ? "border-primary bg-primary/10" : "border-border bg-card")}>
              <p className="font-semibold leading-tight">{s.name}</p>
              <p className="text-xs text-muted-foreground">{[s.role, s.department].filter(Boolean).join(" · ")}</p>
            </button>
          ))}
          {servers.length === 0 && <p className="text-sm text-muted-foreground">No active staff in the staff register yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- New customer: tap a table ----------
function NewCustomerDialog({ open, onClose, onCreated, busyTables }: { open: boolean; onClose: () => void; onCreated: (id: number) => void; busyTables: Set<number> }) {
  const { toast } = useToast();
  const { data: tables = [] } = useQuery<TableEntity[]>({ queryKey: ["/api/tables"] });
  const [tableId, setTableId] = useState<number | null | undefined>(undefined);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pos/customers", { tableId: tableId ?? null, name: name.trim() || null, phone: null, email: null })).json() as Promise<CustomerView>,
    onSuccess: (c) => { invalidatePos(); toast({ title: `Customer ${c.customerNo} opened` }); setTableId(undefined); setName(""); onCreated(c.id); },
    onError: (e) => toast({ title: "Couldn't open the customer", description: errMsg(e), variant: "destructive" }),
  });
  const active = tables.filter((t) => t.active === 1);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setTableId(undefined); setName(""); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Tap the table. The name is optional.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {active.map((t) => (
            <button key={t.id} type="button" onClick={() => setTableId(t.id)} data-testid={`button-pad-table-${t.id}`}
              className={cn("min-h-16 rounded-md border p-3 text-left hover-elevate active-elevate-2", tableId === t.id ? "border-primary bg-primary/10" : "border-border bg-card")}>
              <p className="font-semibold leading-tight">{t.name.trim()}</p>
              <p className="text-xs text-muted-foreground">{busyTables.has(t.id) ? "Has an open bill" : t.capacity ? `${t.capacity} seats` : "Free"}</p>
            </button>
          ))}
          <button type="button" onClick={() => setTableId(null)} data-testid="button-pad-table-none"
            className={cn("min-h-16 rounded-md border p-3 text-left hover-elevate active-elevate-2", tableId === null ? "border-primary bg-primary/10" : "border-border bg-card")}>
            <p className="font-semibold leading-tight">No table</p>
            <p className="text-xs text-muted-foreground">Counter / takeaway</p>
          </button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pad-name">Name (optional)</Label>
          <Input id="pad-name" className="h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-pad-customer-name" />
        </div>
        <DialogFooter>
          <Button size="lg" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="lg" onClick={() => create.mutate()} disabled={tableId === undefined || create.isPending} data-testid="button-pad-create-customer">
            {create.isPending ? "Opening…" : tableId === undefined ? "Tap a table" : "Open customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- The round being built ----------
function CartPanel({ lines, setLines, onSend, sending, canSend, serverName, customer }: {
  lines: Line[]; setLines: (f: (l: Line[]) => Line[]) => void; onSend: () => void; sending: boolean; canSend: boolean; serverName: string | null; customer: CustomerView;
}) {
  const [noteFor, setNoteFor] = useState<Line | null>(null);
  const [note, setNote] = useState("");
  const total = lines.reduce((s, l) => s + linePrice(l) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const bump = (key: string, d: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + d) } : l)).filter((l) => l.qty > 0));
  const sent = customer.orders.filter((o) => o.items.length > 0 && o.status !== "cancelled");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {lines.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="text-cart-empty">
            Tap dishes and drinks to add them to this order.
          </div>
        )}
        {lines.map((l) => (
          <div key={l.key} className="rounded-md border border-border bg-card p-3" data-testid={`cart-line-${l.dish.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold leading-tight">{l.dish.name}</p>
                {choiceText(l) && <p className="text-sm text-muted-foreground">{choiceText(l)}</p>}
                {l.notes && <p className="text-sm font-medium text-destructive">Note: {l.notes}</p>}
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{formatKES(linePrice(l) * l.qty)}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="icon" variant="outline" className="h-11 w-11" onClick={() => bump(l.key, -1)} aria-label="One less" data-testid={`button-cart-minus-${l.dish.id}`}><Minus className="h-5 w-5" /></Button>
              <span className="w-8 text-center text-lg font-semibold tabular-nums" data-testid={`text-cart-qty-${l.dish.id}`}>{l.qty}</span>
              <Button size="icon" variant="outline" className="h-11 w-11" onClick={() => bump(l.key, 1)} aria-label="One more" data-testid={`button-cart-plus-${l.dish.id}`}><Plus className="h-5 w-5" /></Button>
              <Button variant="outline" className="h-11" onClick={() => { setNoteFor(l); setNote(l.notes); }} data-testid={`button-cart-note-${l.dish.id}`}><MessageSquare className="h-4 w-4" />Note</Button>
              <Button size="icon" variant="ghost" className="ml-auto h-11 w-11 text-destructive" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove" data-testid={`button-cart-remove-${l.dish.id}`}><Trash2 className="h-5 w-5" /></Button>
            </div>
          </div>
        ))}
        {sent.length > 0 && (
          <div className="pt-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Already ordered</p>
            <div className="space-y-1.5">
              {sent.map((o) => (
                <div key={o.id} className="rounded-md bg-muted/60 p-2.5 text-sm" data-testid={`sent-order-${o.orderNo}`}>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    {o.outlet === "bar" ? <Wine className="h-3.5 w-3.5" /> : <UtensilsCrossed className="h-3.5 w-3.5" />}{o.orderNo}{o.servedByName ? ` · ${o.servedByName}` : ""}
                  </p>
                  {o.items.map((i) => (
                    <div key={i.id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0">{i.quantity} × {i.itemName}</span>
                      {i.kitchenStatus && <Badge variant={i.kitchenStatus === "ready" ? "default" : "outline"} className="shrink-0">{KITCHEN_LABEL[i.kitchenStatus]}</Badge>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{count} item{count === 1 ? "" : "s"} to send</span>
          <span className="text-xl font-semibold tabular-nums" data-testid="text-cart-total">{formatKES(total)}</span>
        </div>
        <div className="flex items-baseline justify-between text-sm text-muted-foreground">
          <span>Bill so far</span><span className="tabular-nums">{formatKES(customer.total)}</span>
        </div>
        <Button className="h-14 w-full text-lg" onClick={onSend} disabled={!canSend || sending} data-testid="button-send-order">
          <Send className="h-5 w-5" />{sending ? "Sending…" : !serverName ? "Choose who is serving" : "Send order"}
        </Button>
      </div>
      {noteFor && (
        <Dialog open onOpenChange={(o) => { if (!o) setNoteFor(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Note for {noteFor.dish.name}</DialogTitle></DialogHeader>
            <Input className="h-12 text-base" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no onions" maxLength={300} data-testid="input-cart-note" />
            <div className="flex flex-wrap gap-2">
              {["No onions", "Not spicy", "Extra hot", "Well done", "Takeaway"].map((q) => (
                <Button key={q} variant="outline" className="h-11" onClick={() => setNote((n) => (n ? `${n}, ${q.toLowerCase()}` : q))}>{q}</Button>
              ))}
            </div>
            <DialogFooter>
              <Button size="lg" variant="outline" onClick={() => setNoteFor(null)}>Cancel</Button>
              <Button size="lg" onClick={() => { const n = note.trim(); setLines((ls) => ls.map((x) => (x.key === noteFor.key ? { ...x, notes: n } : x))); setNoteFor(null); }} data-testid="button-save-cart-note">Save note</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------- Ordering for one customer ----------
function OrderScreen({ customerId, server, onChooseServer, onBack }: { customerId: number; server: Server | null; onChooseServer: () => void; onBack: () => void }) {
  const { toast } = useToast();
  const { data: dishes = [] } = useMenuDishes();
  const { data: c } = useQuery<CustomerView>({ queryKey: ["/api/pos/customers", customerId], refetchInterval: 15000 });
  const [outlet, setOutlet] = useState<"restaurant" | "bar">("restaurant");
  const [section, setSection] = useState<string>("");
  const [q, setQ] = useState("");
  const [lines, setLinesState] = useState<Line[]>([]);
  const [choosing, setChoosing] = useState<MenuDish | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [roundId, setRoundId] = useState(newRoundId);
  const [flash, setFlash] = useState<number | null>(null);
  const setLines = (f: (l: Line[]) => Line[]) => setLinesState(f);
  const wide = useWide();

  const onMenu = dishes.filter((d) => d.active === 1);
  const inOutlet = onMenu.filter((d) => d.category === outlet);
  const sections = Array.from(new Set(inOutlet.map((d) => d.section?.trim() || "Other"))).sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
  const term = q.trim().toLowerCase();
  const shown = (term ? onMenu.filter((d) => d.name.toLowerCase().includes(term)) : inOutlet.filter((d) => !section || (d.section?.trim() || "Other") === section))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + linePrice(l) * l.qty, 0);
  useEffect(() => { setSection(""); }, [outlet]);

  const add = (dish: MenuDish, choices: Choice[] = [], notes = "") => {
    const key = `${dish.id}|${JSON.stringify([...choices].sort((a, b) => a.groupId - b.groupId).map((c) => [c.groupId, [...c.optionIds].sort()]))}|${notes}`;
    setLinesState((ls) => (ls.some((l) => l.key === key) ? ls.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...ls, { key, dish, choices, notes, qty: 1 }]));
    setFlash(dish.id); setTimeout(() => setFlash((f) => (f === dish.id ? null : f)), 350);
  };
  const tap = (d: MenuDish) => { if (d.groups.length > 0) setChoosing(d); else add(d); };

  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/pos/customers/${customerId}/send-order`, {
      roundId, servedByStaffId: server!.id,
      items: lines.map((l) => ({ menuItemId: l.dish.id, quantity: l.qty, choices: l.choices, notes: l.notes || null })),
    })).json() as Promise<{ orders: { orderNo: string; outlet: string; items: number; kitchen: number }[] }>,
    onSuccess: (r) => {
      invalidatePos(); setLinesState([]); setRoundId(newRoundId()); setCartOpen(false);
      toast({ title: "Order sent", description: r.orders.map((o) => `${o.orderNo}: ${o.items} item${o.items === 1 ? "" : "s"}${o.kitchen ? ` (${o.kitchen} to kitchen)` : ""}`).join(" · ") });
    },
    onError: (e) => toast({ title: "Order not sent", description: errMsg(e), variant: "destructive" }),
  });
  const trySend = () => { if (!server) onChooseServer(); else send.mutate(); };
  const back = () => { if (lines.length) setLeaving(true); else onBack(); };

  if (!c) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const closed = c.status !== "open";
  const cart = <CartPanel lines={lines} setLines={setLines} onSend={trySend} sending={send.isPending} canSend={lines.length > 0 && !closed} serverName={server?.name ?? null} customer={c} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-12" onClick={back} data-testid="button-pad-back"><ArrowLeft className="h-5 w-5" />Customers</Button>
        <div className="order-last min-w-0 basis-full lg:order-none lg:basis-auto lg:flex-1">
          <p className="truncate text-lg font-semibold leading-tight" data-testid="text-pad-customer">{c.tableName || "No table"} · {c.customerNo}</p>
          <p className="truncate text-sm text-muted-foreground">{c.name || "No name"} · bill {formatKES(c.total)}{c.balance > 0 ? ` · ${formatKES(c.balance)} due` : ""}</p>
        </div>
        <Button variant="outline" className="ml-auto h-12 min-w-0 lg:ml-0" onClick={onChooseServer} data-testid="button-pad-server"><UserRound className="h-5 w-5" /><span className="max-w-40 truncate">{server?.name ?? "Who is serving?"}</span></Button>
      </div>
      {closed && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">This bill is closed. Go back and open a new customer.</p>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-1">
              {(["restaurant", "bar"] as const).map((o) => (
                <button key={o} type="button" onClick={() => { setOutlet(o); setQ(""); }} data-testid={`button-pad-outlet-${o}`}
                  className={cn("flex h-11 items-center gap-2 rounded px-4 text-sm font-semibold", outlet === o && !term ? "bg-primary text-primary-foreground" : "text-muted-foreground hover-elevate")}>
                  {o === "bar" ? <Wine className="h-4 w-4" /> : <UtensilsCrossed className="h-4 w-4" />}{o === "bar" ? "Bar" : "Restaurant"}
                </button>
              ))}
            </div>
            <div className="relative min-w-44 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-12 pl-9 text-base" placeholder="Search the menu" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-pad-search" />
            </div>
          </div>
          {!term && sections.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {["", ...sections].map((s) => (
                <button key={s || "all"} type="button" onClick={() => setSection(s)} data-testid={`button-pad-section-${s || "all"}`}
                  className={cn("h-11 shrink-0 rounded-full border px-4 text-sm font-medium", section === s ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover-elevate")}>
                  {s || "All"}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((d) => {
                const inCart = lines.filter((l) => l.dish.id === d.id).reduce((s, l) => s + l.qty, 0);
                return (
                  <button key={d.id} type="button" onClick={() => tap(d)} disabled={closed} data-testid={`tile-dish-${d.id}`}
                    className={cn("relative flex min-h-28 flex-col justify-between rounded-md border bg-card p-3 text-left transition-transform hover-elevate active-elevate-2 disabled:opacity-50",
                      inCart ? "border-primary" : "border-border", flash === d.id && "scale-[0.97]")}>
                    <span className="pr-7 font-semibold leading-snug">{d.name}</span>
                    <span className="mt-2 flex items-end justify-between gap-2">
                      <span className="font-semibold tabular-nums text-primary">{formatKES(d.price)}</span>
                      <span className="flex gap-1 text-muted-foreground">
                        {d.groups.length > 0 && <ListChecks className="h-4 w-4" aria-label="Has choices" />}
                        {d.sendToKitchen === 1 && <CookingPot className="h-4 w-4" aria-label="Goes to the kitchen" />}
                      </span>
                    </span>
                    {inCart > 0 && <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-1.5 text-sm font-semibold text-primary-foreground" data-testid={`badge-tile-qty-${d.id}`}>{inCart}</span>}
                  </button>
                );
              })}
            </div>
            {shown.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{term ? "Nothing on the menu matches that." : "Nothing on this menu yet. Add dishes in Bar & Restaurant → Menu."}</p>}
          </div>
        </div>
        {wide && (
          <div className="flex min-h-0 flex-col rounded-md border border-border bg-background p-3">
            <p className="mb-2 flex items-center gap-2 font-semibold"><ShoppingBasket className="h-5 w-5" />This order</p>
            {cart}
          </div>
        )}
      </div>

      {/* Phones and portrait tablets: the order sits in a bottom sheet */}
      {!wide && <div className="border-t border-border pt-3">
        <Button className="h-14 w-full justify-between text-base" onClick={() => setCartOpen(true)} data-testid="button-open-cart">
          <span className="flex items-center gap-2"><ShoppingBasket className="h-5 w-5" />View order{count ? ` (${count})` : ""}</span>
          <span className="tabular-nums">{formatKES(total)}</span>
        </Button>
      </div>}
      <Sheet open={cartOpen && !wide} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="flex h-[85vh] flex-col">
          <SheetHeader><SheetTitle>This order · {c.tableName || c.customerNo}</SheetTitle></SheetHeader>
          <div className="min-h-0 flex-1">{cart}</div>
        </SheetContent>
      </Sheet>

      {choosing && <ChoiceDialog dish={choosing} onCancel={() => setChoosing(null)} onConfirm={(ch, notes) => { add(choosing, ch.filter((x) => x.optionIds.length), notes.trim()); setChoosing(null); }} />}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without sending?</AlertDialogTitle>
            <AlertDialogDescription>{count} item{count === 1 ? " has" : "s have"} not been sent to the kitchen or bar yet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12">Stay</AlertDialogCancel>
            <AlertDialogAction className="h-12 bg-destructive text-destructive-foreground" onClick={onBack} data-testid="button-discard-cart">Discard items</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Page ----------
export default function OrderPad() {
  const { data: open = [], isLoading } = useQuery<CustomerView[]>({ queryKey: ["/api/pos/customers"], refetchInterval: 15000 });
  const { data: servers = [] } = useQuery<Server[]>({ queryKey: ["/api/pos/servers"] });
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [serverId, setServerId] = useState<number | null>(() => { const v = Number(localStorage.getItem(SERVER_KEY)); return v > 0 ? v : null; });
  const [serverOpen, setServerOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState("");
  const server = servers.find((s) => s.id === serverId) ?? null;
  const pickServer = (id: number) => { setServerId(id); localStorage.setItem(SERVER_KEY, String(id)); setServerOpen(false); };
  const busyTables = useMemo(() => new Set(open.map((c) => c.tableId).filter((x): x is number => !!x)), [open]);
  const term = q.trim().toLowerCase();
  const list = open
    .filter((c) => !term || [c.customerNo, c.tableName, c.name].some((v) => v?.toLowerCase().includes(term)))
    .sort((a, b) => (a.tableName ?? "~").localeCompare(b.tableName ?? "~", undefined, { numeric: true }) || a.createdAt - b.createdAt);

  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] max-w-[1600px] flex-col p-3 sm:p-4">
      {customerId ? (
        <OrderScreen customerId={customerId} server={server} onChooseServer={() => setServerOpen(true)} onBack={() => setCustomerId(null)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <h1 className="text-xl font-semibold" data-testid="text-page-title">Order pad</h1>
              <p className="text-sm text-muted-foreground">Tap a customer to take their order, or open a new one.</p>
            </div>
            <Button variant="outline" className="h-12" onClick={() => setServerOpen(true)} data-testid="button-pad-server"><UserRound className="h-5 w-5" /><span className="max-w-48 truncate">{server?.name ?? "Who is serving?"}</span></Button>
            <Button asChild variant="outline" className="h-12"><Link href="/bar-restaurant" data-testid="link-pad-bills"><Receipt className="h-5 w-5" />Bills & payments</Link></Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-12 pl-9 text-base" placeholder="Find a table, customer number or name" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-pad-customer-search" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <button type="button" onClick={() => setNewOpen(true)} data-testid="button-pad-new-customer"
                className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/60 p-3 text-primary hover-elevate active-elevate-2">
                <Plus className="h-8 w-8" /><span className="font-semibold">New customer</span>
              </button>
              {list.map((c) => {
                const items = c.orders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0), 0);
                const ready = c.orders.some((o) => o.items.some((i) => i.kitchenStatus === "ready"));
                return (
                  <button key={c.id} type="button" onClick={() => setCustomerId(c.id)} data-testid={`tile-customer-${c.customerNo}`}
                    className={cn("relative flex min-h-32 flex-col justify-between rounded-md border bg-card p-3 text-left hover-elevate active-elevate-2", ready ? "border-primary" : "border-border")}>
                    <span>
                      <span className="block text-lg font-semibold leading-tight">{c.tableName || "No table"}</span>
                      <span className="block truncate text-sm text-muted-foreground">{c.customerNo}{c.name ? ` · ${c.name}` : ""}</span>
                    </span>
                    <span className="mt-2 flex items-end justify-between gap-2">
                      {ready ? <Badge data-testid={`badge-food-ready-${c.customerNo}`}>Food ready</Badge> : <span className="text-sm text-muted-foreground">{items ? `${items} item${items === 1 ? "" : "s"}` : "No orders yet"}</span>}
                      <span className="font-semibold tabular-nums">{formatKES(c.total)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {isLoading && <p className="p-6 text-center text-sm text-muted-foreground" data-testid="text-pad-loading">Loading customers…</p>}
            {!isLoading && list.length === 0 && term && <p className="p-6 text-center text-sm text-muted-foreground">No open customer matches that.</p>}
          </div>
        </div>
      )}
      <ServerDialog open={serverOpen} servers={servers} value={serverId} onPick={pickServer} onClose={() => setServerOpen(false)} />
      <NewCustomerDialog open={newOpen} onClose={() => setNewOpen(false)} busyTables={busyTables} onCreated={(id) => { setNewOpen(false); setCustomerId(id); if (!server) setServerOpen(true); }} />
    </div>
  );
}
