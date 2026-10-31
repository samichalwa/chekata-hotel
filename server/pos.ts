// Bar & Restaurant — one customer per visit (C-000001) → separate bar (B-…) and restaurant (R-…)
// orders → one bill. Payments are made against the customer number and settle the oldest order
// first; each order gets its own receipt (so income lands per outlet with the right tax). The visit
// closes automatically when fully paid, can be closed manually with a reason (the unpaid part is not
// income), or its orders can be posted to an accommodation bill.
import type { Express, Request } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, sql, storage } from "./storage";
import { requireModule } from "./auth";
import { issueDocument } from "./documents";
import { sendSms } from "./sms";
import { priceDish } from "./menu";
import { orders, orderItems, posCustomers, type Order, type OrderItem, type PosCustomer } from "@shared/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;
const who = (req: Request) => (req as any).user?.fullName ?? (req as any).user?.username ?? "staff";
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const outletName = (o: string) => (o === "bar" ? "Bar" : "Restaurant");
const issueDateLabel = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const timeLabel = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const nairobiToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export type BillOrder = Order & { items: OrderItem[]; net: number; owed: number };
export interface CustomerBill {
  customer: PosCustomer;
  orders: BillOrder[];
  total: number; // all orders, net of credit notes
  paid: number;
  balance: number; // still payable on this visit (0 once closed or posted to a room)
  unpaidClosed: number; // written off by a manual close
  roomPosted: number;
}

export async function getCustomer(id: number): Promise<PosCustomer | undefined> {
  return (await db.select().from(posCustomers).where(eq(posCustomers.id, id)))[0];
}
export async function customerByToken(token: unknown): Promise<PosCustomer | undefined> {
  const t = typeof token === "string" ? token.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{24}$/.test(t)) return undefined;
  return (await db.select().from(posCustomers).where(eq(posCustomers.payToken, t)))[0];
}
export async function customerByNo(no: string): Promise<PosCustomer | undefined> {
  return (await db.select().from(posCustomers).where(eq(posCustomers.customerNo, no)))[0];
}

export async function customerBill(c: PosCustomer): Promise<CustomerBill> {
  const os = await db.select().from(orders).where(and(eq(orders.customerId, c.id), ne(orders.status, "cancelled"))).orderBy(asc(orders.orderedAt), asc(orders.id));
  const items = os.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, os.map((o) => o.id))).orderBy(asc(orderItems.id)) : [];
  let total = 0, paid = 0, balance = 0, unpaidClosed = 0, roomPosted = 0;
  const list: BillOrder[] = os.map((o) => {
    const net = r2(o.totalAmount - (o.creditedAmount ?? 0));
    const owed = r2(Math.max(0, net - (o.amountPaid ?? 0)));
    total += net; paid += o.amountPaid ?? 0;
    if (o.status === "open" || o.status === "paid") balance += owed;
    else if (o.status === "closed_unpaid") unpaidClosed += owed;
    else if (o.status === "room_posted") roomPosted += net;
    return { ...o, items: items.filter((i) => i.orderId === o.id), net, owed };
  });
  return { customer: c, orders: list, total: r2(total), paid: r2(paid), balance: r2(balance), unpaidClosed: r2(unpaidClosed), roomPosted: r2(roomPosted) };
}

export async function ensureCustomerToken(c: PosCustomer): Promise<string> {
  if (c.payToken) return c.payToken;
  const t = randomBytes(12).toString("hex");
  await sql`UPDATE pos_customers SET pay_token = ${t} WHERE id = ${c.id} AND pay_token IS NULL`;
  return (await getCustomer(c.id))?.payToken ?? t;
}

export async function hasPendingCustomerPayment(c: PosCustomer): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM online_payments WHERE kind = 'bill' AND target_ref = ${c.customerNo} AND status = 'pending' LIMIT 1` as any[];
  return rows.length > 0;
}

/** Order total always follows its items. */
export async function recomputeOrderTotal(orderId: number) {
  await sql`UPDATE orders SET total_amount = COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id = ${orderId}), 0) WHERE id = ${orderId}`;
}

function orderLines(o: BillOrder) {
  return o.items.map((i) => ({ label: `${i.itemName} x${i.quantity}`, amount: i.subtotal }));
}
const orderHeading = (o: Order) =>
  `${o.orderNo ?? `Order #${o.id}`} · ${outletName(o.outlet)} · ${timeLabel(o.orderedAt ?? o.createdAt)}${o.servedByName ? ` · Served by ${o.servedByName}` : ""}`;

/**
 * Applies a payment to the customer's open orders, oldest first. Each order touched gets a receipt
 * for the part paid on it; empty orders are dropped and the visit closes once nothing is owed.
 */
export async function applyCustomerPayment(c: PosCustomer, pay: { amount: number; method: string; reference: string | null; by: string; note?: string }) {
  const bill = await customerBill(c);
  let left = r2(Math.min(pay.amount, bill.balance));
  const allocations: { orderId: number; orderNo: string | null; outlet: string; amount: number }[] = [];
  const receipts: any[] = [];
  for (const o of bill.orders) {
    if (!(left > 0)) break;
    if (o.status !== "open" || !(o.owed > 0)) continue;
    const take = r2(Math.min(o.owed, left));
    left = r2(left - take);
    const newPaid = r2((o.amountPaid ?? 0) + take);
    const full = newPaid + 0.004 >= o.net;
    await sql`UPDATE orders SET amount_paid = ${newPaid}, status = ${full ? "paid" : "open"}, payment_method = ${pay.method} WHERE id = ${o.id}`;
    allocations.push({ orderId: o.id, orderNo: o.orderNo, outlet: o.outlet, amount: take });
    const doc = await issueDocument(storage, {
      docType: "receipt",
      category: o.outlet === "bar" ? "bar" : "restaurant",
      sourceId: o.id,
      customDocNumber: o.orderNo ?? undefined,
      recipientName: c.name || o.customerName || c.customerNo,
      recipientEmail: c.email,
      issueDate: issueDateLabel(),
      lineItems: orderLines(o),
      totalAmount: o.net,
      amountPaid: newPaid,
      balance: r2(o.net - newPaid),
      paymentAmount: take,
      paymentMethod: pay.method,
      paymentReference: pay.reference,
      notes: [`Customer ${c.customerNo}${c.tableName ? ` · ${c.tableName}` : ""}`, orderHeading(o), o.billedBy ? `Billed by ${o.billedBy}` : "", pay.note ?? ""].filter(Boolean).join("\n"),
    });
    receipts.push({ orderNo: o.orderNo, status: doc.status, id: doc.id, publicToken: doc.publicToken, amount: take });
  }
  const paid = r2(allocations.reduce((s, a) => s + a.amount, 0));
  await sql`INSERT INTO pos_payments (customer_id, amount, payment_method, payment_reference, allocations_json, created_by, created_at)
    VALUES (${c.id}, ${paid}, ${pay.method}, ${pay.reference}, ${JSON.stringify(allocations)}, ${pay.by}, ${Date.now()})`;
  const after = await customerBill(c);
  let settled = false;
  if (after.balance <= 0.004 && after.orders.some((o) => o.status === "paid")) {
    await sql`UPDATE orders SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || 'Empty order dropped when the bill was settled'
      WHERE customer_id = ${c.id} AND status = 'open' AND total_amount <= 0`;
    await sql`UPDATE pos_customers SET status = 'settled', closed_at = ${Date.now()}, closed_by = ${pay.by} WHERE id = ${c.id} AND status = 'open'`;
    settled = true;
  }
  return { paid, allocations, receipts, settled, balance: after.balance };
}

export function registerPosRoutes(app: Express, deps: {
  checkRecordPayment: (body: any, due: number, opts?: { targetRef?: string | null }) => Promise<any>;
}) {
  const M = requireModule("bar-restaurant");

  async function billJson(c: PosCustomer) {
    const b = await customerBill(c);
    return { ...b.customer, orders: b.orders, total: b.total, paid: b.paid, balance: b.balance, unpaidClosed: b.unpaidClosed, roomPosted: b.roomPosted, pending: await hasPendingCustomerPayment(c) };
  }

  // Waiters / bartenders come from the HR staff register (active staff only).
  app.get("/api/pos/servers", M, async (_req, res) => {
    const rows = await sql`SELECT id, name, role, department FROM staff WHERE status = 'active' ORDER BY (department IN ('bar','restaurant')) DESC, name` as any[];
    res.json(rows.map((r) => ({ id: Number(r.id), name: r.name, role: r.role, department: r.department })));
  });

  // Accommodation guests a visit can be posted to (confirmed or checked in).
  app.get("/api/pos/room-guests", M, async (_req, res) => {
    const rows = await sql`SELECT b.id, b.guest_name, b.guest_phone, b.status, b.check_in, b.check_out, r.name AS room_name
      FROM accommodation_bookings b LEFT JOIN rooms r ON r.id = b.room_id
      WHERE b.status IN ('confirmed','checked_in') ORDER BY r.name, b.guest_name` as any[];
    res.json(rows.map((r) => ({ id: Number(r.id), guestName: r.guest_name, guestPhone: r.guest_phone, status: r.status, checkIn: r.check_in, checkOut: r.check_out, roomName: r.room_name })));
  });

  // Staff scanned a table QR (…/#/pay/t/<token>) — which table is it?
  app.get("/api/pos/table-by-token/:token", M, async (req, res) => {
    const tk = String(req.params.token ?? "").trim().toLowerCase();
    const t = (await sql`SELECT id, name, outlet FROM tables WHERE pay_token = ${tk} LIMIT 1` as any[])[0];
    if (!t) return res.status(404).json({ error: "That QR code is not a table QR from this system." });
    res.json({ id: Number(t.id), name: String(t.name).trim(), outlet: t.outlet });
  });

  app.get("/api/pos/customers", M, async (req, res) => {
    const scope = String(req.query.scope ?? "open");
    const since = Date.now() - Math.min(366, Math.max(1, Number(req.query.days) || 7)) * 86400_000;
    const list = scope === "open"
      ? await db.select().from(posCustomers).where(eq(posCustomers.status, "open")).orderBy(asc(posCustomers.createdAt))
      : (await db.select().from(posCustomers).orderBy(asc(posCustomers.createdAt))).filter((c) => c.status !== "open" && (c.closedAt ?? c.createdAt) >= since);
    const out = [];
    for (const c of list) out.push(await billJson(c));
    res.json(scope === "open" ? out : out.reverse());
  });

  app.get("/api/pos/customers/:id", M, async (req, res) => {
    const c = await getCustomer(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "Customer not found" });
    res.json(await billJson(c));
  });

  const customerBody = z.object({
    name: z.string().trim().max(100).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(120).optional().nullable(),
    tableId: z.number().int().optional().nullable(),
  });
  async function tableFields(tableId: number | null | undefined) {
    if (!tableId) return { tableId: null, tableName: null };
    const t = (await storage.listTables()).find((x) => x.id === tableId);
    if (!t) throw Object.assign(new Error("That table no longer exists."), { status: 400 });
    return { tableId: t.id, tableName: t.name.trim() };
  }
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  app.post("/api/pos/customers", M, async (req, res) => {
    try {
      const b = customerBody.parse(req.body ?? {});
      if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return res.status(400).json({ error: "That email address doesn't look right." });
      const tf = await tableFields(b.tableId);
      const customerNo = await storage.getNextSequenceNumber("pos_customer");
      const [c] = await db.insert(posCustomers).values({
        customerNo, name: clean(b.name), phone: clean(b.phone), email: clean(b.email), ...tf,
        status: "open", createdBy: who(req), createdAt: Date.now(), payToken: randomBytes(12).toString("hex"),
      }).returning();
      res.status(201).json(await billJson(c));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid details" });
      res.status(err?.status ?? 500).json({ error: err?.message ?? "Couldn't open the customer" });
    }
  });

  app.patch("/api/pos/customers/:id", M, async (req, res) => {
    try {
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      if (c.status !== "open") return res.status(400).json({ error: "This customer's bill is closed." });
      const b = customerBody.partial().parse(req.body ?? {});
      if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) return res.status(400).json({ error: "That email address doesn't look right." });
      const set: any = {};
      if (b.name !== undefined) set.name = clean(b.name);
      if (b.phone !== undefined) set.phone = clean(b.phone);
      if (b.email !== undefined) set.email = clean(b.email);
      if (b.tableId !== undefined) Object.assign(set, await tableFields(b.tableId));
      if (Object.keys(set).length) {
        await db.update(posCustomers).set(set).where(eq(posCustomers.id, c.id));
        const n = { ...c, ...set };
        await sql`UPDATE orders SET customer_name = ${n.name}, customer_phone = ${n.phone}, customer_email = ${n.email}, reference = ${n.tableName}
          WHERE customer_id = ${c.id} AND status = 'open'`;
      }
      res.json(await billJson((await getCustomer(c.id))!));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid details" });
      res.status(err?.status ?? 500).json({ error: err?.message ?? "Couldn't save" });
    }
  });

  // New bar or restaurant order for this customer, with the server from the staff register.
  app.post("/api/pos/customers/:id/orders", M, async (req, res) => {
    try {
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      if (c.status !== "open") return res.status(400).json({ error: "This customer's bill is closed. Open a new customer." });
      const b = z.object({ outlet: z.enum(["bar", "restaurant"]), servedByStaffId: z.number().int(), notes: z.string().max(300).optional().nullable() }).parse(req.body ?? {});
      const st = (await sql`SELECT id, name, status FROM staff WHERE id = ${b.servedByStaffId}` as any[])[0];
      if (!st || st.status !== "active") return res.status(400).json({ error: "Choose who is serving from the staff register." });
      const orderNo = await storage.getNextSequenceNumber(b.outlet === "bar" ? "bar_order" : "restaurant_order");
      const now = Date.now();
      const [o] = await db.insert(orders).values({
        outlet: b.outlet, reference: c.tableName, customerName: c.name, customerEmail: c.email, customerPhone: c.phone,
        orderDate: nairobiToday(), status: "open", totalAmount: 0, notes: b.notes || null, createdAt: now,
        customerId: c.id, orderNo, servedByStaffId: Number(st.id), servedByName: st.name, billedBy: who(req), orderedAt: now, amountPaid: 0,
      }).returning();
      res.status(201).json(o);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Choose the outlet and who is serving." });
      res.status(500).json({ error: err?.message ?? "Couldn't create the order" });
    }
  });

  // Order pad: the waiter sends a whole round in one go. Items are split into a bar order and a
  // restaurant order (one each, as needed); kitchen dishes go straight to the kitchen screen.
  // Everything is priced from the menu and validated before anything is saved.
  const sentRounds = new Map<string, { at: number; body: any }>(); // guards against a double tap sending twice
  app.post("/api/pos/customers/:id/send-order", M, async (req, res) => {
    const roundId = typeof req.body?.roundId === "string" ? req.body.roundId.slice(0, 64) : "";
    try {
      for (const [k, v] of Array.from(sentRounds)) if (Date.now() - v.at > 10 * 60_000) sentRounds.delete(k);
      if (roundId && sentRounds.has(roundId)) {
        const prev = sentRounds.get(roundId)!;
        return prev.body ? res.status(200).json(prev.body) : res.status(409).json({ error: "This order is already being sent." });
      }
      if (roundId) sentRounds.set(roundId, { at: Date.now(), body: null });
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      if (c.status !== "open") return res.status(400).json({ error: "This customer's bill is closed. Open a new customer." });
      const b = z.object({
        servedByStaffId: z.number().int(),
        items: z.array(z.object({
          menuItemId: z.number().int(),
          quantity: z.number().int().min(1).max(99),
          choices: z.array(z.object({ groupId: z.number().int(), optionIds: z.array(z.number().int()) })).optional(),
          notes: z.string().max(300).optional().nullable(),
        })).min(1).max(60),
      }).safeParse(req.body ?? {});
      if (!b.success) return res.status(400).json({ error: "Add at least one item and choose who is serving." });
      const st = (await sql`SELECT id, name, status FROM staff WHERE id = ${b.data.servedByStaffId}` as any[])[0];
      if (!st || st.status !== "active") return res.status(400).json({ error: "Choose who is serving from the staff register." });
      const priced: { outlet: "bar" | "restaurant"; row: Record<string, any> }[] = [];
      const now = Date.now();
      for (const it of b.data.items) {
        let p;
        try { p = await priceDish(it.menuItemId, it.choices); }
        catch (e: any) { return res.status(e?.status ?? 400).json({ error: e?.message ?? "Couldn't add that dish." }); }
        const outlet = p.dish.category === "bar" ? "bar" : "restaurant";
        const notes = it.notes?.trim() ? it.notes.trim().slice(0, 300) : null;
        priced.push({ outlet, row: {
          menuItemId: p.dish.id, itemName: p.itemName, price: p.price, quantity: it.quantity, subtotal: r2(p.price * it.quantity),
          choicesJson: p.choicesJson, componentsText: p.componentsText, notes,
          ...(p.dish.sendToKitchen ? { kitchenStatus: "new", kitchenSentAt: now } : {}),
        } });
      }
      const outlets = (["restaurant", "bar"] as const).filter((o) => priced.some((p) => p.outlet === o));
      const numbers: Record<string, string> = {};
      for (const o of outlets) numbers[o] = await storage.getNextSequenceNumber(o === "bar" ? "bar_order" : "restaurant_order");
      const created = await db.transaction(async (tx) => {
        const out: { id: number; orderNo: string; outlet: string; items: number; kitchen: number; total: number }[] = [];
        for (const o of outlets) {
          const rows = priced.filter((p) => p.outlet === o).map((p) => p.row);
          const total = r2(rows.reduce((s, r) => s + r.subtotal, 0));
          const [ord] = await tx.insert(orders).values({
            outlet: o, reference: c.tableName, customerName: c.name, customerEmail: c.email, customerPhone: c.phone,
            orderDate: nairobiToday(), status: "open", totalAmount: total, notes: null, createdAt: now,
            customerId: c.id, orderNo: numbers[o], servedByStaffId: Number(st.id), servedByName: st.name, billedBy: who(req), orderedAt: now, amountPaid: 0,
          }).returning();
          await tx.insert(orderItems).values(rows.map((r) => ({ ...r, orderId: ord.id })) as any);
          out.push({ id: ord.id, orderNo: ord.orderNo ?? numbers[o], outlet: o, items: rows.reduce((s, r) => s + r.quantity, 0), kitchen: rows.filter((r) => r.kitchenStatus).reduce((s, r) => s + r.quantity, 0), total });
        }
        return out;
      });
      const body = { orders: created };
      if (roundId) sentRounds.set(roundId, { at: Date.now(), body });
      res.status(201).json(body);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Couldn't send the order" });
    } finally {
      if (roundId && !sentRounds.get(roundId)?.body) sentRounds.delete(roundId);
    }
  });

  // Payment against the customer number — part payments allowed, oldest order first.
  app.post("/api/pos/customers/:id/payments", M, async (req, res) => {
    let lock: string | null = null;
    try {
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      if (c.status !== "open") return res.status(400).json({ error: "This customer's bill is already closed." });
      const bill = await customerBill(c);
      const chk = await deps.checkRecordPayment(req.body, bill.balance, { targetRef: c.customerNo });
      if ("error" in chk) return res.status(chk.status).json({ error: chk.error });
      lock = chk.lock;
      const r = await applyCustomerPayment(c, { amount: chk.amount, method: chk.method, reference: chk.reference, by: who(req) });
      if (c.phone) {
        const s = await storage.getSettings();
        void sendSms({ source: "Bar & Restaurant", settings: s, to: c.phone,
          message: `Hi${c.name ? ` ${c.name}` : ""}, payment received for bill ${c.customerNo} at ${s.hotelName}: ${kes(r.paid)}${chk.reference ? ` (${chk.reference})` : ""}. ${r.balance > 0.5 ? `Balance: ${kes(r.balance)}.` : "Paid in full."} Thank you!` }).catch(() => {});
      }
      res.status(201).json({ ...r, customer: await billJson((await getCustomer(c.id))!) });
    } catch (err: any) {
      if (/duplicate key|unique/i.test(String(err?.message))) return res.status(409).json({ error: "That payment reference has already been used. Each payment reference can only be used once." });
      res.status(500).json({ error: err?.message ?? "Couldn't record the payment" });
    } finally { if (lock) (await import("./payment-refs")).inFlight.delete(lock); }
  });

  // Manual close of a bill that was not fully paid — reason required; the unpaid part is not income.
  app.post("/api/pos/customers/:id/close", M, async (req, res) => {
    try {
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      if (c.status !== "open") return res.status(400).json({ error: "This customer's bill is already closed." });
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 3) return res.status(400).json({ error: "Give the reason for closing a bill that is not fully paid." });
      if (await hasPendingCustomerPayment(c)) return res.status(409).json({ error: "The guest has paid this bill by M-Pesa and it is waiting in Online bookings & payments. Verify or reject that payment first." });
      const bill = await customerBill(c);
      const by = who(req);
      await sql`UPDATE orders SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || 'Empty order dropped on close' WHERE customer_id = ${c.id} AND status = 'open' AND total_amount <= 0`;
      for (const o of bill.orders) {
        if (o.status !== "open" || !(o.net > 0)) continue;
        const full = (o.amountPaid ?? 0) + 0.004 >= o.net;
        await sql`UPDATE orders SET status = ${full ? "paid" : "closed_unpaid"},
          notes = COALESCE(notes || ' | ', '') || ${full ? "Closed" : `Closed unpaid (${kes(o.owed)}) by ${by}: ${reason}`} WHERE id = ${o.id}`;
      }
      const status = bill.balance > 0.004 ? "closed_unpaid" : "settled";
      await sql`UPDATE pos_customers SET status = ${status}, close_reason = ${reason}, closed_by = ${by}, closed_at = ${Date.now()} WHERE id = ${c.id}`;
      res.json(await billJson((await getCustomer(c.id))!));
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Couldn't close the bill" }); }
  });

  // Post the unpaid orders to an accommodation guest's room bill.
  app.post("/api/pos/customers/:id/post-to-room", M, async (req, res) => {
    try {
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      if (c.status !== "open") return res.status(400).json({ error: "This customer's bill is already closed." });
      if (await hasPendingCustomerPayment(c)) return res.status(409).json({ error: "The guest has paid this bill by M-Pesa and it is waiting in Online bookings & payments. Verify or reject that payment first." });
      const bookingId = Number(req.body?.bookingId);
      const bk = bookingId ? await storage.getAccommodationBooking(bookingId) : undefined;
      if (!bk || !["confirmed", "checked_in"].includes(bk.status)) return res.status(400).json({ error: "Choose a guest whose room booking is confirmed or checked in." });
      const bill = await customerBill(c);
      const toPost = bill.orders.filter((o) => o.status === "open" && o.owed > 0);
      if (!toPost.length) return res.status(400).json({ error: "There is nothing unpaid to post to the room." });
      const room = await storage.getRoom(bk.roomId);
      const roomLabel = `${room?.name ?? "Room"} — ${bk.guestName}`;
      const by = who(req);
      let posted = 0;
      const docs: any[] = [];
      await sql`UPDATE orders SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || 'Empty order dropped when posted to room' WHERE customer_id = ${c.id} AND status = 'open' AND total_amount <= 0`;
      for (const o of bill.orders) {
        if (o.status !== "open" || !(o.net > 0)) continue;
        if (!(o.owed > 0)) { await sql`UPDATE orders SET status = 'paid' WHERE id = ${o.id}`; continue; }
        // The part already paid stays on this order's receipts; only the unpaid part goes to the room.
        await sql`UPDATE orders SET status = 'room_posted', room_booking_id = ${bk.id}, payment_method = 'room_charge',
          notes = COALESCE(notes || ' | ', '') || ${`Posted to ${roomLabel} by ${by}`} WHERE id = ${o.id}`;
        posted = r2(posted + o.owed);
        // Charged-to-room invoice: records the sale (and its tax) for this outlet; no money received yet.
        const d = await issueDocument(storage, {
          docType: "invoice", category: o.outlet === "bar" ? "bar" : "restaurant", sourceId: o.id, customDocNumber: o.orderNo ?? undefined,
          recipientName: bk.guestName, recipientEmail: bk.guestEmail ?? c.email, issueDate: issueDateLabel(),
          // Only the unpaid part is charged (amountPaid 0 so nothing is counted as money received here).
          lineItems: [...orderLines(o), ...((o.amountPaid ?? 0) > 0 ? [{ label: "Less: paid earlier", amount: -r2(o.amountPaid ?? 0) }] : [])],
          totalAmount: o.owed, amountPaid: 0, balance: o.owed,
          notes: [`Customer ${c.customerNo}${c.tableName ? ` · ${c.tableName}` : ""}`, orderHeading(o), o.billedBy ? `Billed by ${o.billedBy}` : "", `Charged to ${roomLabel}`].filter(Boolean).join("\n"),
        });
        docs.push({ orderNo: o.orderNo, id: d.id, status: d.status });
      }
      const charge = posted;
      await sql`UPDATE accommodation_bookings SET total_amount = total_amount + ${charge}, pos_charges = pos_charges + ${charge} WHERE id = ${bk.id}`;
      await sql`UPDATE pos_customers SET status = 'room_posted', accommodation_booking_id = ${bk.id}, closed_by = ${by}, closed_at = ${Date.now()},
        name = COALESCE(name, ${bk.guestName}) WHERE id = ${c.id}`;
      res.json({ posted: charge, bookingId: bk.id, documents: docs, customer: await billJson((await getCustomer(c.id))!) });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Couldn't post to the room" }); }
  });

  // The customer's bill (all orders, times, servers) as a PDF document — print, email, WhatsApp.
  app.post("/api/pos/customers/:id/bill", M, async (req, res) => {
    try {
      const c = await getCustomer(Number(req.params.id));
      if (!c) return res.status(404).json({ error: "Customer not found" });
      const b = await customerBill(c);
      const withItems = b.orders.filter((o) => o.net > 0);
      if (!withItems.length) return res.status(400).json({ error: "There are no items on this bill yet." });
      const taxSplit: Record<string, number> = {};
      for (const o of withItems) { const k = o.outlet === "bar" ? "bar" : "restaurant"; taxSplit[k] = r2((taxSplit[k] ?? 0) + o.net); }
      const lineItems = withItems.map((o) => ({
        label: orderHeading(o),
        detail: o.items.map((i) => `${i.itemName} x${i.quantity} = ${kes(i.subtotal)}`).join("; ") + (o.billedBy ? ` — billed by ${o.billedBy}` : ""),
        amount: o.net,
      }));
      const statusNote = c.status === "room_posted" ? "Unpaid orders charged to the room bill." : c.status === "closed_unpaid" ? `Closed unpaid: ${c.closeReason ?? ""}` : c.status === "settled" ? "Paid in full." : "";
      const doc = await issueDocument(storage, {
        docType: "invoice", category: "pos_bill", sourceId: c.id, customDocNumber: c.customerNo,
        recipientName: c.name || c.customerNo, recipientEmail: req.body?.email === false ? null : c.email, issueDate: issueDateLabel(),
        lineItems, totalAmount: b.total, amountPaid: b.paid, balance: b.balance, taxSplit,
        serviceLabel: `Bar & Restaurant bill${c.tableName ? ` — ${c.tableName}` : ""}`,
        notes: [`Customer ${c.customerNo}`, `Printed ${timeLabel(Date.now())} by ${who(req)}`, statusNote].filter(Boolean).join("\n"),
      });
      res.status(201).json({ id: doc.id, publicToken: doc.publicToken, status: doc.status, errorMessage: doc.errorMessage });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Couldn't create the bill" }); }
  });

  app.get("/api/pos/customers/:id/payments", M, async (req, res) => {
    const rows = await sql`SELECT * FROM pos_payments WHERE customer_id = ${Number(req.params.id)} ORDER BY created_at` as any[];
    res.json(rows.map((r) => ({ id: Number(r.id), amount: Number(r.amount), paymentMethod: r.payment_method, paymentReference: r.payment_reference,
      allocations: JSON.parse(r.allocations_json || "[]"), createdBy: r.created_by, createdAt: Number(r.created_at) })));
  });

  app.post("/api/pos/customers/:id/pay-link", M, async (req, res) => {
    const c = await getCustomer(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "Customer not found" });
    if (c.status !== "open") return res.status(409).json({ error: "Only open bills can be paid by link." });
    const token = await ensureCustomerToken(c);
    res.json({ token, path: `/#/pay/${token}` });
  });
}
