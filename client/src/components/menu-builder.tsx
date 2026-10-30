// Menu builder: chef-defined dishes with components (cooked/uncooked, mixed/separate), combos that
// include other dishes, and optional choice groups the guest picks from when ordering.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Wine, UtensilsCrossed, ChefHat, X, Lock, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES } from "@/lib/format";
import type { MenuDish } from "@shared/schema";

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };
const PLAIN = "__plain__";

type CompDraft = { name: string; includedMenuItemId: number | null; portion: string; preparation: "cooked" | "uncooked"; serving: "mixed" | "separate" };
type GroupDraft = { name: string; required: number; maxChoices: number; options: { name: string; extraPrice: string }[] };
type Draft = { name: string; category: "bar" | "restaurant"; price: string; active: number; section: string; description: string; sendToKitchen: number; components: CompDraft[]; groups: GroupDraft[] };

export function useMenuDishes() {
  return useQuery<MenuDish[]>({ queryKey: ["/api/menu/dishes"] });
}
export function invalidateMenu() {
  queryClient.invalidateQueries({ queryKey: ["/api/menu/dishes"] });
  queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
}

export function describeComponents(d: MenuDish) {
  return d.components.map((c) => [c.portion, c.name].filter(Boolean).join(" ")).join(", ");
}

function toDraft(d?: MenuDish | null): Draft {
  return {
    name: d?.name ?? "", category: (d?.category as any) ?? "restaurant", price: d ? String(d.price) : "", active: d?.active ?? 1,
    section: d?.section ?? "", description: d?.description ?? "", sendToKitchen: d ? d.sendToKitchen : 1,
    components: (d?.components ?? []).map((c) => ({ name: c.name, includedMenuItemId: c.includedMenuItemId, portion: c.portion ?? "", preparation: c.preparation as any, serving: c.serving as any })),
    groups: (d?.groups ?? []).map((g) => ({ name: g.name, required: g.required, maxChoices: g.maxChoices, options: g.options.map((o) => ({ name: o.name, extraPrice: o.extraPrice ? String(o.extraPrice) : "" })) })),
  };
}

function DishDialog({ dish, dishes, onClose }: { dish: MenuDish | null; dishes: MenuDish[]; onClose: () => void }) {
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(() => toDraft(dish));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const sections = useMemo(() => Array.from(new Set(dishes.map((x) => x.section).filter(Boolean) as string[])).sort(), [dishes]);
  const others = dishes.filter((x) => x.id !== dish?.id).sort((a, b) => a.name.localeCompare(b.name));
  const setComp = (i: number, p: Partial<CompDraft>) => set({ components: d.components.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const setGroup = (i: number, p: Partial<GroupDraft>) => set({ groups: d.groups.map((g, k) => (k === i ? { ...g, ...p } : g)) });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...d, price: Number(d.price || 0), section: d.section.trim() || null, description: d.description.trim() || null,
        components: d.components.map((c) => ({ ...c, portion: c.portion.trim() || null })),
        groups: d.groups.map((g) => ({ ...g, options: g.options.map((o) => ({ name: o.name, extraPrice: Number(o.extraPrice || 0) })) })),
      };
      return (await apiRequest(dish ? "PUT" : "POST", dish ? `/api/menu/dishes/${dish.id}` : "/api/menu/dishes", body)).json();
    },
    onSuccess: () => { invalidateMenu(); toast({ title: dish ? "Dish saved" : "Dish added to the menu" }); onClose(); },
    onError: (e) => toast({ title: "Couldn't save the dish", description: errMsg(e), variant: "destructive" }),
  });
  const valid = d.name.trim() && d.price !== "" && Number(d.price) >= 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dish ? `Edit ${dish.name}` : "New dish"}</DialogTitle>
          <DialogDescription>Define what the dish is made of. Add choices only if the guest picks something when ordering.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="dish-name">Name</Label><Input id="dish-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Rice and chicken" data-testid="input-dish-name" /></div>
            <div className="space-y-1.5">
              <Label>Outlet</Label>
              <Select value={d.category} onValueChange={(v) => set({ category: v as any, sendToKitchen: v === "restaurant" ? 1 : d.sendToKitchen })}>
                <SelectTrigger data-testid="select-dish-outlet"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="restaurant">Restaurant</SelectItem><SelectItem value="bar">Bar</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="dish-price">Price (KES)</Label><Input id="dish-price" type="number" min={0} value={d.price} onChange={(e) => set({ price: e.target.value })} data-testid="input-dish-price" /></div>
            <div className="space-y-1.5">
              <Label htmlFor="dish-section">Menu section</Label>
              <Input id="dish-section" list="menu-sections" value={d.section} onChange={(e) => set({ section: e.target.value })} placeholder="e.g. Breakfast, Mains, Hot drinks" data-testid="input-dish-section" />
              <datalist id="menu-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="dish-desc">Description (optional)</Label><Textarea id="dish-desc" rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} data-testid="input-dish-description" /></div>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm">
              <span><span className="block font-medium">Send to kitchen</span><span className="text-xs text-muted-foreground">Shows on the kitchen screen when ordered</span></span>
              <Switch checked={d.sendToKitchen === 1} onCheckedChange={(c) => set({ sendToKitchen: c ? 1 : 0 })} data-testid="switch-dish-kitchen" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm">
              <span><span className="block font-medium">On the menu</span><span className="text-xs text-muted-foreground">Off hides it from ordering</span></span>
              <Switch checked={d.active === 1} onCheckedChange={(c) => set({ active: c ? 1 : 0 })} data-testid="switch-dish-active" />
            </label>
          </div>

          {/* Components */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold">What's in it</h3><p className="text-xs text-muted-foreground">Leave empty for simple items such as a soda.</p></div>
              <Button size="sm" variant="outline" onClick={() => set({ components: [...d.components, { name: "", includedMenuItemId: null, portion: "", preparation: "cooked", serving: "separate" }] })} data-testid="button-add-component"><Plus className="h-4 w-4 mr-1" /> Component</Button>
            </div>
            {d.components.map((c, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-2.5" data-testid={`row-component-${i}`}>
                <div className="flex gap-2">
                  <Select value={c.includedMenuItemId ? String(c.includedMenuItemId) : PLAIN} onValueChange={(v) => {
                    if (v === PLAIN) return setComp(i, { includedMenuItemId: null });
                    const o = others.find((x) => x.id === Number(v));
                    setComp(i, { includedMenuItemId: Number(v), name: o?.name ?? c.name });
                  }}>
                    <SelectTrigger className="w-40 shrink-0" data-testid={`select-component-kind-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PLAIN}>Ingredient / item</SelectItem>
                      {others.map((o) => <SelectItem key={o.id} value={String(o.id)}>Dish: {o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} placeholder="e.g. Pilau rice" disabled={!!c.includedMenuItemId} className="min-w-0 flex-1" data-testid={`input-component-name-${i}`} />
                  <Button size="icon" variant="ghost" onClick={() => set({ components: d.components.filter((_, k) => k !== i) })} title="Remove" data-testid={`button-remove-component-${i}`}><X className="h-4 w-4" /></Button>
                </div>
                <div className={`grid gap-2 ${c.includedMenuItemId ? "grid-cols-1" : "grid-cols-3"}`}>
                  <Input value={c.portion} onChange={(e) => setComp(i, { portion: e.target.value })} placeholder="Portion, e.g. 2 pcs" data-testid={`input-component-portion-${i}`} />
                  {!c.includedMenuItemId && <>
                  <Select value={c.preparation} onValueChange={(v) => setComp(i, { preparation: v as any })}>
                    <SelectTrigger data-testid={`select-component-prep-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="cooked">Cooked</SelectItem><SelectItem value="uncooked">Uncooked</SelectItem></SelectContent>
                  </Select>
                  <Select value={c.serving} onValueChange={(v) => setComp(i, { serving: v as any })}>
                    <SelectTrigger data-testid={`select-component-serving-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="separate">Served separate</SelectItem><SelectItem value="mixed">Mixed in</SelectItem></SelectContent>
                  </Select>
                  </>}
                </div>
              </div>
            ))}
          </div>

          {/* Choice groups */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold">Guest choices</h3><p className="text-xs text-muted-foreground">Optional. Leave empty if the dish is always served as defined.</p></div>
              <Button size="sm" variant="outline" onClick={() => set({ groups: [...d.groups, { name: "", required: 1, maxChoices: 1, options: [{ name: "", extraPrice: "" }, { name: "", extraPrice: "" }] }] })} data-testid="button-add-choice-group"><Plus className="h-4 w-4 mr-1" /> Choice group</Button>
            </div>
            {d.groups.map((g, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-2.5" data-testid={`row-choice-group-${i}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} placeholder="e.g. Eggs, Side, Milk" className="min-w-0 flex-1" data-testid={`input-group-name-${i}`} />
                  <label className="flex items-center gap-1.5 text-xs"><Switch checked={g.required === 1} onCheckedChange={(c) => setGroup(i, { required: c ? 1 : 0 })} data-testid={`switch-group-required-${i}`} /> Required</label>
                  <label className="flex items-center gap-1.5 text-xs">Pick up to
                    <Input type="number" min={1} max={Math.max(1, g.options.length)} value={g.maxChoices} onChange={(e) => setGroup(i, { maxChoices: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-14" data-testid={`input-group-max-${i}`} />
                  </label>
                  <Button size="icon" variant="ghost" onClick={() => set({ groups: d.groups.filter((_, k) => k !== i) })} title="Remove group" data-testid={`button-remove-group-${i}`}><X className="h-4 w-4" /></Button>
                </div>
                {g.options.map((o, j) => (
                  <div key={j} className="flex items-center gap-2 pl-2">
                    <Input value={o.name} onChange={(e) => setGroup(i, { options: g.options.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} placeholder={j === 0 ? "e.g. Fried" : "e.g. Scrambled"} className="min-w-0 flex-1" data-testid={`input-option-name-${i}-${j}`} />
                    <Input type="number" min={0} value={o.extraPrice} onChange={(e) => setGroup(i, { options: g.options.map((x, k) => (k === j ? { ...x, extraPrice: e.target.value } : x)) })} placeholder="+ KES 0" className="w-24" aria-label="Extra charge" data-testid={`input-option-extra-${i}-${j}`} />
                    <Button size="icon" variant="ghost" disabled={g.options.length <= 1} onClick={() => setGroup(i, { options: g.options.filter((_, k) => k !== j) })} title="Remove choice"><X className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="ml-2" onClick={() => setGroup(i, { options: [...g.options, { name: "", extraPrice: "" }] })} data-testid={`button-add-option-${i}`}><Plus className="h-4 w-4 mr-1" /> Choice</Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending} data-testid="button-save-dish">{save.isPending ? "Saving…" : "Save dish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MenuBuilder() {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const canManage = Boolean(me?.isAdmin || (me as any)?.canManageMenuItemsList);
  const { data: dishes = [], isLoading } = useMenuDishes();
  const [editing, setEditing] = useState<MenuDish | null | "new">(null);
  const [deleting, setDeleting] = useState<MenuDish | null>(null);
  const [q, setQ] = useState("");
  const del = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/menu/dishes/${id}`),
    onSuccess: () => { invalidateMenu(); toast({ title: "Dish deleted" }); setDeleting(null); },
    onError: (e) => { toast({ title: "Couldn't delete", description: errMsg(e), variant: "destructive" }); setDeleting(null); },
  });
  const ql = q.trim().toLowerCase();
  const shown = dishes.filter((d) => !ql || [d.name, d.section, d.description, ...d.components.map((c) => c.name)].some((v) => String(v ?? "").toLowerCase().includes(ql)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!canManage ? <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> View only. Ask an administrator for menu edit rights.</p> : <p className="text-sm text-muted-foreground">Build dishes from components. Combos can include other dishes.</p>}
        <div className="flex w-full gap-2 sm:w-auto">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="min-w-0 flex-1 sm:w-56" data-testid="input-search-dishes" />
          {canManage && <Button onClick={() => setEditing("new")} data-testid="button-new-dish"><Plus className="h-4 w-4 mr-1" /> New dish</Button>}
        </div>
      </div>
      {(["restaurant", "bar"] as const).map((outlet) => {
        const list = shown.filter((d) => d.category === outlet);
        const bySection = new Map<string, MenuDish[]>();
        for (const d of list) { const k = d.section || "Other"; bySection.set(k, [...(bySection.get(k) ?? []), d]); }
        const Icon = outlet === "bar" ? Wine : UtensilsCrossed;
        return (
          <Card key={outlet}>
            <div className="flex items-center gap-2 border-b border-card-border p-4"><Icon className="h-4 w-4" /><h2 className="text-lg font-semibold">{outlet === "bar" ? "Bar menu" : "Restaurant menu"}</h2><span className="text-sm text-muted-foreground">({list.length})</span></div>
            {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading menu…</p> : list.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">{ql ? "No dish matches your search." : "No dishes yet."}</p>
            ) : Array.from(bySection.entries()).sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b))).map(([section, items]) => (
              <div key={section} className="border-b border-card-border last:border-b-0">
                <p className="bg-muted/40 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section}</p>
                <div className="divide-y divide-border">
                  {items.map((d) => (
                    <div key={d.id} className="flex items-start justify-between gap-3 px-4 py-3" data-testid={`row-dish-${d.id}`}>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 font-medium">
                          {d.name}
                          {!d.active && <Badge variant="outline">Hidden</Badge>}
                          {d.sendToKitchen === 1 && <Badge variant="secondary" className="gap-1"><ChefHat className="h-3 w-3" /> Kitchen</Badge>}
                          {d.groups.length > 0 && <Badge variant="outline" className="gap-1"><ListChecks className="h-3 w-3" /> Choices</Badge>}
                        </p>
                        {d.components.length > 0 && <p className="text-xs text-muted-foreground">{d.components.map((c) => c.includedMenuItemId ? `+ ${[c.portion, c.name].filter(Boolean).join(" ")}` : `${[c.portion, c.name].filter(Boolean).join(" ")} (${c.preparation}, ${c.serving})`).join(" · ")}</p>}
                        {d.groups.length > 0 && <p className="text-xs text-muted-foreground">{d.groups.map((g) => `${g.name}: ${g.options.map((o) => o.name + (o.extraPrice ? ` +${o.extraPrice}` : "")).join(" / ")}`).join(" · ")}</p>}
                        {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="tabular-nums font-medium">{formatKES(d.price)}</span>
                        {canManage && <>
                          <Button size="icon" variant="ghost" onClick={() => setEditing(d)} title="Edit" data-testid={`button-edit-dish-${d.id}`}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleting(d)} title="Delete" data-testid={`button-delete-dish-${d.id}`}><Trash2 className="h-4 w-4" /></Button>
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
      {editing && <DishDialog dish={editing === "new" ? null : editing} dishes={dishes} onClose={() => setEditing(null)} />}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Dishes that have been ordered can't be deleted. Switch them off the menu instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && del.mutate(deleting.id)} data-testid="button-confirm-delete-dish">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Picking a dish with choices when adding it to an order.
export function ChoiceDialog({ dish, onCancel, onConfirm, pending }: { dish: MenuDish; onCancel: () => void; onConfirm: (choices: { groupId: number; optionIds: number[] }[], notes: string) => void; pending?: boolean }) {
  const [sel, setSel] = useState<Record<number, number[]>>({});
  const [notes, setNotes] = useState("");
  const toggle = (gid: number, oid: number, max: number) => setSel((s) => {
    const cur = s[gid] ?? [];
    if (cur.includes(oid)) return { ...s, [gid]: cur.filter((x) => x !== oid) };
    return { ...s, [gid]: max === 1 ? [oid] : cur.length >= max ? cur : [...cur, oid] };
  });
  const missing = dish.groups.filter((g) => g.required && !(sel[g.id]?.length));
  const extra = dish.groups.reduce((s, g) => s + g.options.filter((o) => sel[g.id]?.includes(o.id)).reduce((a, o) => a + o.extraPrice, 0), 0);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dish.name}</DialogTitle>
          {dish.components.length > 0 && <DialogDescription>{describeComponents(dish)}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          {dish.groups.map((g) => (
            <div key={g.id} className="space-y-1.5" data-testid={`choice-group-${g.id}`}>
              <p className="text-sm font-medium">{g.name} <span className="font-normal text-muted-foreground">{g.required ? "· required" : "· optional"}{g.maxChoices > 1 ? ` · up to ${g.maxChoices}` : ""}</span></p>
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => {
                  const on = sel[g.id]?.includes(o.id);
                  return (
                    <Button key={o.id} type="button" size="sm" variant={on ? "default" : "outline"} onClick={() => toggle(g.id, o.id, g.maxChoices)} data-testid={`button-choice-${o.id}`}>
                      {o.name}{o.extraPrice ? ` +${formatKES(o.extraPrice)}` : ""}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="space-y-1.5"><Label htmlFor="choice-notes">Note for the kitchen (optional)</Label><Input id="choice-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no onions" data-testid="input-item-notes" /></div>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm text-muted-foreground">Price {formatKES(dish.price + extra)}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={() => onConfirm(Object.entries(sel).map(([g, ids]) => ({ groupId: Number(g), optionIds: ids })), notes)} disabled={missing.length > 0 || pending} data-testid="button-confirm-choices">{missing.length ? `Choose ${missing[0].name}` : "Add to order"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
