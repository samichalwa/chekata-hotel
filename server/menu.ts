// Menu builder (dishes with components, combos and chef-defined choices) and the kitchen screen.
import type { Express, Request } from "express";
import { z } from "zod";
import { sql } from "./storage";
import { requireAnyModule, requireCanManageMenuItemsList } from "./auth";
import type { MenuDish } from "@shared/schema";

const toNum = (v: any) => Number(v ?? 0);
const userName = (req: Request) => { const u = (req as any).user; return u?.displayName || u?.fullName || u?.username || null; };

function mapItem(r: any) {
  return { id: r.id, name: r.name, category: r.category, price: toNum(r.price), active: r.active, section: r.section ?? null, description: r.description ?? null, sendToKitchen: r.send_to_kitchen ?? 0, sortOrder: r.sort_order ?? 0 };
}

export async function loadDishes(ids?: number[]): Promise<MenuDish[]> {
  const items = ids ? await sql`SELECT * FROM menu_items WHERE id IN ${sql(ids.length ? ids : [0])}` : await sql`SELECT * FROM menu_items`;
  const itemIds = (items as any[]).map((i) => i.id);
  if (!itemIds.length) return [];
  const comps = await sql`SELECT * FROM menu_components WHERE menu_item_id IN ${sql(itemIds)} ORDER BY sort_order, id` as any[];
  const groups = await sql`SELECT * FROM menu_option_groups WHERE menu_item_id IN ${sql(itemIds)} ORDER BY sort_order, id` as any[];
  const opts = groups.length ? await sql`SELECT * FROM menu_options WHERE group_id IN ${sql(groups.map((g) => g.id))} ORDER BY sort_order, id` as any[] : [];
  return (items as any[]).map((i) => ({
    ...mapItem(i),
    components: comps.filter((c) => c.menu_item_id === i.id).map((c) => ({ id: c.id, menuItemId: c.menu_item_id, name: c.name, includedMenuItemId: c.included_menu_item_id, portion: c.portion, preparation: c.preparation, serving: c.serving, sortOrder: c.sort_order })),
    groups: groups.filter((g) => g.menu_item_id === i.id).map((g) => ({
      id: g.id, menuItemId: g.menu_item_id, name: g.name, required: g.required, maxChoices: g.max_choices, sortOrder: g.sort_order,
      options: opts.filter((o) => o.group_id === g.id).map((o) => ({ id: o.id, groupId: o.group_id, name: o.name, extraPrice: toNum(o.extra_price), sortOrder: o.sort_order })),
    })),
  })) as MenuDish[];
}

export function componentsText(d: MenuDish): string | null {
  if (!d.components.length) return null;
  return d.components.map((c) => c.includedMenuItemId ? `+ ${[c.portion, c.name].filter(Boolean).join(" ")}` : [c.portion, c.name].filter(Boolean).join(" ") + ` (${c.preparation}, ${c.serving === "mixed" ? "mixed" : "separate"})`).join(" · ");
}

const dishSchema = z.object({
  name: z.string().trim().min(1, "Give the dish a name"),
  category: z.enum(["bar", "restaurant"]),
  price: z.coerce.number().min(0, "Price can't be negative"),
  active: z.coerce.number().int().min(0).max(1).default(1),
  section: z.string().trim().max(60).nullish(),
  description: z.string().trim().max(500).nullish(),
  sendToKitchen: z.coerce.number().int().min(0).max(1).default(0),
  components: z.array(z.object({
    name: z.string().trim().min(1, "Every component needs a name"),
    includedMenuItemId: z.coerce.number().int().positive().nullish(),
    portion: z.string().trim().max(40).nullish(),
    preparation: z.enum(["cooked", "uncooked"]).default("cooked"),
    serving: z.enum(["mixed", "separate"]).default("separate"),
  })).max(40).default([]),
  groups: z.array(z.object({
    name: z.string().trim().min(1, "Every choice group needs a name"),
    required: z.coerce.number().int().min(0).max(1).default(1),
    maxChoices: z.coerce.number().int().min(1).max(20).default(1),
    options: z.array(z.object({ name: z.string().trim().min(1, "Every choice needs a name"), extraPrice: z.coerce.number().min(0).default(0) })).min(1, "Each choice group needs at least one choice").max(30),
  })).max(15).default([]),
});

async function saveDish(id: number | null, body: unknown) {
  const d = dishSchema.parse(body);
  for (const g of d.groups) if (g.maxChoices > g.options.length) g.maxChoices = g.options.length;
  return sql.begin(async (tx: any) => {
    let itemId = id;
    if (itemId) {
      const r = await tx`UPDATE menu_items SET name=${d.name}, category=${d.category}, price=${d.price}, active=${d.active}, section=${d.section || null},
        description=${d.description || null}, send_to_kitchen=${d.sendToKitchen} WHERE id=${itemId} RETURNING id`;
      if (!r.length) throw Object.assign(new Error("Menu item not found"), { status: 404 });
    } else {
      itemId = (await tx`INSERT INTO menu_items (name, category, price, active, section, description, send_to_kitchen)
        VALUES (${d.name}, ${d.category}, ${d.price}, ${d.active}, ${d.section || null}, ${d.description || null}, ${d.sendToKitchen}) RETURNING id`)[0].id;
    }
    for (const c of d.components) if (c.includedMenuItemId === itemId) throw Object.assign(new Error("A dish can't include itself."), { status: 400 });
    await tx`DELETE FROM menu_options WHERE group_id IN (SELECT id FROM menu_option_groups WHERE menu_item_id=${itemId})`;
    await tx`DELETE FROM menu_option_groups WHERE menu_item_id=${itemId}`;
    await tx`DELETE FROM menu_components WHERE menu_item_id=${itemId}`;
    let k = 0;
    for (const c of d.components) {
      await tx`INSERT INTO menu_components (menu_item_id, name, included_menu_item_id, portion, preparation, serving, sort_order)
        VALUES (${itemId}, ${c.name}, ${c.includedMenuItemId ?? null}, ${c.portion || null}, ${c.preparation}, ${c.serving}, ${k++})`;
    }
    k = 0;
    for (const g of d.groups) {
      const gid = (await tx`INSERT INTO menu_option_groups (menu_item_id, name, required, max_choices, sort_order) VALUES (${itemId}, ${g.name}, ${g.required}, ${g.maxChoices}, ${k++}) RETURNING id`)[0].id;
      let j = 0;
      for (const o of g.options) await tx`INSERT INTO menu_options (group_id, name, extra_price, sort_order) VALUES (${gid}, ${o.name}, ${o.extraPrice}, ${j++})`;
    }
    return itemId as number;
  });
}

// Works out the line for an ordered dish: validated choices, unit price, the name printed on
// bills and receipts (dish + choices), and the kitchen snapshot.
export async function priceDish(menuItemId: number, choices: { groupId: number; optionIds: number[] }[] | undefined) {
  const [dish] = await loadDishes([menuItemId]);
  if (!dish) throw Object.assign(new Error("That menu item no longer exists."), { status: 400 });
  if (!dish.active) throw Object.assign(new Error(`${dish.name} is not on the menu right now.`), { status: 400 });
  const picked: { group: string; options: string[] }[] = [];
  let extra = 0;
  for (const g of dish.groups) {
    const ids = Array.from(new Set(choices?.find((c) => Number(c.groupId) === g.id)?.optionIds?.map(Number) ?? []));
    const opts = g.options.filter((o) => ids.includes(o.id));
    if (opts.length !== ids.length) throw Object.assign(new Error(`One of the ${g.name} choices is no longer available.`), { status: 400 });
    if (g.required && opts.length === 0) throw Object.assign(new Error(`Choose ${g.name} for ${dish.name}.`), { status: 400 });
    if (opts.length > g.maxChoices) throw Object.assign(new Error(`Choose at most ${g.maxChoices} for ${g.name}.`), { status: 400 });
    if (opts.length) { picked.push({ group: g.name, options: opts.map((o) => o.name) }); extra += opts.reduce((s, o) => s + o.extraPrice, 0); }
  }
  const label = picked.length ? `${dish.name} — ${picked.map((p) => `${p.group}: ${p.options.join(", ")}`).join("; ")}` : dish.name;
  return { dish, itemName: label, price: Math.round((dish.price + extra) * 100) / 100, choicesJson: picked.length ? JSON.stringify(picked) : null, componentsText: componentsText(dish) };
}

const KITCHEN_FLOW = ["new", "preparing", "ready", "served"] as const;

export function registerMenuRoutes(app: Express) {
  const read = requireAnyModule(["bar-restaurant", "lists", "kitchen"]);
  const write = [requireAnyModule(["bar-restaurant", "lists"]), requireCanManageMenuItemsList];

  app.get("/api/menu/dishes", read, async (_req, res) => {
    const dishes = await loadDishes();
    dishes.sort((a, b) => a.category.localeCompare(b.category) || (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
    res.json(dishes);
  });
  app.post("/api/menu/dishes", ...write, async (req, res) => {
    try { const id = await saveDish(null, req.body); res.status(201).json((await loadDishes([id]))[0]); }
    catch (e: any) { res.status(e?.status ?? 400).json({ error: e?.issues?.[0]?.message ?? e?.message ?? "Couldn't save the dish" }); }
  });
  app.put("/api/menu/dishes/:id", ...write, async (req, res) => {
    try { const id = await saveDish(Number(req.params.id), req.body); res.json((await loadDishes([id]))[0]); }
    catch (e: any) { res.status(e?.status ?? 400).json({ error: e?.issues?.[0]?.message ?? e?.message ?? "Couldn't save the dish" }); }
  });
  app.delete("/api/menu/dishes/:id", ...write, async (req, res) => {
    const id = Number(req.params.id);
    const used = (await sql`SELECT COUNT(*)::int n FROM order_items WHERE menu_item_id=${id}` as any[])[0].n;
    const inCombo = (await sql`SELECT m.name FROM menu_components c JOIN menu_items m ON m.id=c.menu_item_id WHERE c.included_menu_item_id=${id} LIMIT 1` as any[])[0];
    if (inCombo) return res.status(400).json({ error: `It is part of ${inCombo.name}. Remove it from that dish first, or hide it instead.` });
    if (used > 0) return res.status(400).json({ error: "This dish has been ordered before. Switch it off the menu instead of deleting it." });
    await sql.begin(async (tx: any) => {
      await tx`DELETE FROM menu_options WHERE group_id IN (SELECT id FROM menu_option_groups WHERE menu_item_id=${id})`;
      await tx`DELETE FROM menu_option_groups WHERE menu_item_id=${id}`;
      await tx`DELETE FROM menu_components WHERE menu_item_id=${id}`;
      await tx`DELETE FROM menu_items WHERE id=${id}`;
    });
    res.status(204).end();
  });

  // ---------- Kitchen screen ----------
  const kitchen = requireAnyModule(["kitchen", "bar-restaurant"]);
  app.get("/api/kitchen/tickets", kitchen, async (_req, res) => {
    const since = Date.now() - 2 * 3600_000;
    const rows = await sql`
      SELECT i.id, i.order_id, i.item_name, i.quantity, i.notes, i.components_text, i.choices_json, i.kitchen_status,
             i.kitchen_sent_at, i.kitchen_ready_at, i.kitchen_served_at,
             o.order_no, o.outlet, o.reference, o.served_by_name, o.ordered_at, o.created_at, o.status AS order_status,
             c.customer_no, c.table_name, c.name AS customer_name
      FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN pos_customers c ON c.id = o.customer_id
      WHERE i.kitchen_status IS NOT NULL AND o.status <> 'cancelled'
        AND (i.kitchen_status <> 'served' OR i.kitchen_served_at > ${since})
      ORDER BY i.kitchen_sent_at, i.id` as any[];
    const tickets = new Map<number, any>();
    for (const r of rows) {
      let t = tickets.get(r.order_id);
      if (!t) {
        t = { orderId: r.order_id, orderNo: r.order_no ?? `#${r.order_id}`, outlet: r.outlet, table: r.table_name ?? r.reference ?? null, customerNo: r.customer_no, customerName: r.customer_name,
          servedBy: r.served_by_name, orderedAt: Number(r.ordered_at ?? r.created_at), items: [] };
        tickets.set(r.order_id, t);
      }
      let choices: any[] = []; try { choices = r.choices_json ? JSON.parse(r.choices_json) : []; } catch {}
      t.items.push({ id: r.id, name: r.item_name.split(" — ")[0], quantity: r.quantity, notes: r.notes, components: r.components_text, choices, status: r.kitchen_status,
        sentAt: Number(r.kitchen_sent_at), readyAt: r.kitchen_ready_at ? Number(r.kitchen_ready_at) : null, servedAt: r.kitchen_served_at ? Number(r.kitchen_served_at) : null });
    }
    res.json(Array.from(tickets.values()));
  });
  // Move items forward (or one step back) through new → preparing → ready → served.
  app.post("/api/kitchen/items/status", kitchen, async (req, res) => {
    const parsed = z.object({ itemIds: z.array(z.coerce.number().int().positive()).min(1).max(100), status: z.enum(KITCHEN_FLOW) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose the items and the new status." });
    const { itemIds, status } = parsed.data;
    const now = Date.now();
    const isReady = status === "ready" || status === "served";
    const servedAt = status === "served" ? now : null;
    const rows = await sql`UPDATE order_items SET kitchen_status = ${status},
        kitchen_ready_at = CASE WHEN ${isReady}::boolean THEN COALESCE(kitchen_ready_at, ${now}::bigint) ELSE NULL END,
        kitchen_served_at = ${servedAt}::bigint
      WHERE id IN ${sql(itemIds)} AND kitchen_status IS NOT NULL
        AND order_id IN (SELECT id FROM orders WHERE status <> 'cancelled') RETURNING id`;
    if (!rows.length) return res.status(400).json({ error: "Those items are no longer on an active order." });
    res.json({ updated: rows.length, by: userName(req) });
  });
}
