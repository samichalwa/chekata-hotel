import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, ChefHat, TrendingUp, Percent } from "lucide-react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import type { Recipe, RecipeIngredient, InventoryItem } from "@shared/schema";

type RecipeWithCost = Recipe & { ingredients: RecipeIngredient[]; costPerServing: number; suggestedPrice: number };

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

const ingredientSchema = z.object({
  inventoryItemId: z.coerce.number().min(1, "Ingredient is required"),
  quantityPerServing: z.coerce.number().min(0.0001, "Quantity must be greater than 0"),
  unit: z.string().optional().nullable(),
});

const recipeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  servingsPerBatch: z.coerce.number().min(0.01, "Servings must be greater than 0"),
  otherCostPerServing: z.coerce.number().min(0, "Cost can't be negative"),
  targetMarginPercent: z.coerce.number().min(0, "Margin can't be negative").max(99, "Margin must be below 100%"),
  active: z.number(),
  notes: z.string().optional().nullable(),
  ingredients: z.array(ingredientSchema).min(1, "Add at least one ingredient"),
});

type RecipeFormValues = z.infer<typeof recipeFormSchema>;

function ingredientCostPreview(values: RecipeFormValues, items: InventoryItem[]): { costPerServing: number; suggestedPrice: number } {
  let ingredientCost = 0;
  for (const ing of values.ingredients) {
    const item = items.find((i) => i.id === ing.inventoryItemId);
    ingredientCost += (ing.quantityPerServing || 0) * (item?.lastUnitCost ?? 0);
  }
  const costPerServing = (values.otherCostPerServing || 0) + ingredientCost;
  const marginFraction = Math.min(0.99, Math.max(0, (values.targetMarginPercent || 0) / 100));
  const suggestedPrice = marginFraction > 0 ? costPerServing / (1 - marginFraction) : costPerServing;
  return { costPerServing, suggestedPrice };
}

function RecipeFormDialog({ recipe, trigger }: { recipe?: RecipeWithCost; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const form = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues: recipe
      ? {
          name: recipe.name,
          servingsPerBatch: recipe.servingsPerBatch,
          otherCostPerServing: recipe.otherCostPerServing,
          targetMarginPercent: recipe.targetMarginPercent,
          active: recipe.active,
          notes: recipe.notes ?? "",
          ingredients: recipe.ingredients.map((i) => ({ inventoryItemId: i.inventoryItemId, quantityPerServing: i.quantityPerServing, unit: i.unit ?? "" })),
        }
      : { name: "", servingsPerBatch: 1, otherCostPerServing: 0, targetMarginPercent: 0, active: 1, notes: "", ingredients: [{ inventoryItemId: 0, quantityPerServing: 0, unit: "" }] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "ingredients" });
  const watched = form.watch();
  const preview = ingredientCostPreview(watched, items);
  const activeItems = items.filter((i) => i.active);

  const mutation = useMutation({
    mutationFn: async (values: RecipeFormValues) => {
      const payload = { ...values, ingredients: values.ingredients.map((i) => ({ inventoryItemId: i.inventoryItemId, quantityPerServing: i.quantityPerServing, unit: i.unit || undefined })) };
      if (recipe) return apiRequest("PATCH", `/api/recipes/${recipe.id}`, payload);
      return apiRequest("POST", "/api/recipes", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({ title: recipe ? "Recipe updated" : "Recipe created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-2xl">
        <DialogHeader><DialogTitle>{recipe ? "Edit recipe" : "New recipe"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Recipe / dish name</FormLabel><FormControl><Input {...field} data-testid="input-recipe-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="servingsPerBatch" render={({ field }) => (
                <FormItem><FormLabel>Servings per batch</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-recipe-servings" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Ingredients</FormLabel>
                <Button type="button" size="sm" variant="outline" onClick={() => append({ inventoryItemId: 0, quantityPerServing: 0, unit: "" })} data-testid="button-add-ingredient">
                  <Plus className="h-4 w-4 mr-1" /> Add ingredient
                </Button>
              </div>
              {(form.formState.errors.ingredients as any)?.message && (
                <p className="text-sm text-destructive">{(form.formState.errors.ingredients as any).message}</p>
              )}
              <div className="space-y-3">
                {fields.map((f, idx) => (
                  <div key={f.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-start" data-testid={`row-ingredient-${idx}`}>
                    <FormField control={form.control} name={`ingredients.${idx}.inventoryItemId`} render={({ field }) => (
                      <FormItem>
                        <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                          <FormControl><SelectTrigger data-testid={`select-ingredient-item-${idx}`}><SelectValue placeholder="Select ingredient" /></SelectTrigger></FormControl>
                          <SelectContent>{activeItems.map((it) => <SelectItem key={it.id} value={String(it.id)}>{it.code} — {it.name} ({formatKES(it.lastUnitCost)}/{it.unitOfMeasure})</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`ingredients.${idx}.quantityPerServing`} render={({ field }) => (
                      <FormItem><FormControl><Input type="number" step="0.0001" placeholder="Qty/serving" {...field} data-testid={`input-ingredient-qty-${idx}`} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`ingredients.${idx}.unit`} render={({ field }) => (
                      <FormItem><FormControl><Input placeholder="Unit (opt.)" title="Unit override (optional) — leave blank to use the item's default unit" {...field} value={field.value ?? ""} data-testid={`input-ingredient-unit-${idx}`} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <Button type="button" size="icon" variant="ghost" onClick={() => fields.length > 1 && remove(idx)} disabled={fields.length <= 1} data-testid={`button-remove-ingredient-${idx}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="otherCostPerServing" render={({ field }) => (
                <FormItem><FormLabel>Other cost/serving (labor, overhead)</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-recipe-other-cost" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="targetMarginPercent" render={({ field }) => (
                <FormItem><FormLabel>Target margin (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} data-testid="input-recipe-margin" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <Card className="p-4 bg-muted/40 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Cost per serving (live)</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-live-cost-per-serving">{formatKES(preview.costPerServing)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Suggested price (live)</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-live-suggested-price">{formatKES(preview.suggestedPrice)}</p>
              </div>
            </Card>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-recipe-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-recipe-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-recipe">{mutation.isPending ? "Saving..." : "Save recipe"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function FnbCosting() {
  const { toast } = useToast();
  const { data: recipes = [], isLoading } = useQuery<RecipeWithCost[]>({ queryKey: ["/api/recipes"] });
  const { data: items = [] } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory/items"] });
  const deleteRecipe = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recipes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/recipes"] }); toast({ title: "Recipe removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove recipe", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `#${id}`;
  const avgMargin = recipes.length > 0 ? recipes.reduce((sum, r) => sum + r.targetMarginPercent, 0) / recipes.length : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="F&B Costing" description="Recipe costing for bar and restaurant menu items — ingredient costs update live from inventory pricing." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Recipes" value={String(recipes.length)} icon={ChefHat} testId="stat-recipes-count" />
        <StatCard label="Active recipes" value={String(recipes.filter((r) => r.active).length)} icon={TrendingUp} accent="success" testId="stat-active-recipes" />
        <StatCard label="Avg. target margin" value={`${avgMargin.toFixed(1)}%`} icon={Percent} testId="stat-avg-margin" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">Costs recompute automatically whenever an ingredient's unit cost changes on a goods receipt — nothing needs recalculating manually.</p>
        <RecipeFormDialog trigger={<Button size="sm" data-testid="button-new-recipe"><Plus className="h-4 w-4 mr-1" /> Add recipe</Button>} />
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading recipes…</div>
        ) : recipes.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No recipes added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipe</TableHead>
                  <TableHead>Ingredients</TableHead>
                  <TableHead className="text-right">Servings/batch</TableHead>
                  <TableHead className="text-right">Cost/serving</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Suggested price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipes.map((r) => (
                  <TableRow key={r.id} data-testid={`row-recipe-${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs">
                      {r.ingredients.map((i) => itemName(i.inventoryItemId)).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.servingsPerBatch}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(r.costPerServing)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.targetMarginPercent}%</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatKES(r.suggestedPrice)}</TableCell>
                    <TableCell><Badge variant={r.active ? "secondary" : "outline"}>{r.active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <RecipeFormDialog recipe={r} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-recipe-${r.id}`}><Pencil className="h-4 w-4" /></Button>} />
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-recipe-${r.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Delete recipe {r.name}?</AlertDialogTitle><AlertDialogDescription>This can't be undone.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteRecipe.mutate(r.id)}>Delete</AlertDialogAction></AlertDialogFooter>
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
    </div>
  );
}
