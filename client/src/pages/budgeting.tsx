import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, PiggyBank, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, todayISO } from "@/lib/format";
import type { BudgetLine, DefinitionListItem } from "@shared/schema";

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {
    // not JSON
  }
  return body;
}

function currentMonthISO(): string {
  return todayISO().slice(0, 7);
}

type BudgetVarianceRow = { month: string; incomeStreamCode: string; incomeStreamLabel: string; budgetedAmount: number; actualAmount: number; variance: number };

const budgetLineFormSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  incomeStreamCode: z.string().min(1, "Select an income stream"),
  budgetedAmount: z.coerce.number().min(0, "Amount can't be negative"),
  notes: z.string().optional().nullable(),
});

type BudgetLineFormValues = z.output<typeof budgetLineFormSchema>;
type BudgetLineFormInput = z.input<typeof budgetLineFormSchema>;

function BudgetLineFormDialog({ streams, trigger }: { streams: DefinitionListItem[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<BudgetLineFormInput, any, BudgetLineFormValues>({
    resolver: zodResolver(budgetLineFormSchema),
    defaultValues: { month: currentMonthISO(), incomeStreamCode: "", budgetedAmount: 0, notes: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: BudgetLineFormValues) => apiRequest("POST", "/api/budget-lines", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/budget-lines") });
      toast({ title: "Budget line saved" });
      setOpen(false);
      form.reset({ month: currentMonthISO(), incomeStreamCode: "", budgetedAmount: 0, notes: "" });
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Set / update a budget line</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="month" render={({ field }) => (
                <FormItem>
                  <FormLabel>Month</FormLabel>
                  <FormControl><Input type="month" {...field} data-testid="input-budget-month" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="incomeStreamCode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Income stream</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <FormControl><SelectTrigger data-testid="select-budget-income-stream"><SelectValue placeholder="Select income stream" /></SelectTrigger></FormControl>
                    <SelectContent>{streams.map((s) => <SelectItem key={s.id} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="budgetedAmount" render={({ field }) => (
              <FormItem>
                <FormLabel>Budgeted amount (KES)</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-budget-amount" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-budget-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <p className="text-xs text-muted-foreground">Saving a line for a month and income stream that already has a budget will update it rather than create a duplicate.</p>
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-budget-line">{mutation.isPending ? "Saving..." : "Save budget line"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Budgeting() {
  const { toast } = useToast();
  const [fromMonth, setFromMonth] = useState(currentMonthISO());
  const [toMonth, setToMonth] = useState(currentMonthISO());

  const { data: streams = [] } = useQuery<DefinitionListItem[]>({ queryKey: ["/api/definitions/income_stream/items"] });
  const activeStreams = useMemo(() => streams.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder), [streams]);
  const { data: budgetLines = [] } = useQuery<BudgetLine[]>({ queryKey: [`/api/budget-lines?from=${fromMonth}&to=${toMonth}`] });
  const { data: variance = [], isLoading } = useQuery<BudgetVarianceRow[]>({ queryKey: [`/api/budget-lines/variance?from=${fromMonth}&to=${toMonth}`] });

  const deleteLine = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/budget-lines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/budget-lines") });
      toast({ title: "Budget line removed" });
    },
    onError: (err: Error) => toast({ title: "Could not remove budget line", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const totalBudgeted = variance.reduce((s, r) => s + r.budgetedAmount, 0);
  const totalActual = variance.reduce((s, r) => s + r.actualAmount, 0);
  const totalVariance = totalActual - totalBudgeted;
  const streamLabel = (code: string) => activeStreams.find((s) => s.code === code)?.label ?? streams.find((s) => s.code === code)?.label ?? code;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Budgeting"
        description="Set monthly income-stream budgets and track variance against posted Finance actuals. Income streams are fully configurable in Lists."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">Period</span>
          <Input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="w-40" data-testid="input-budget-from-month" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="w-40" data-testid="input-budget-to-month" />
          <Button variant="ghost" size="sm" onClick={() => { setFromMonth(currentMonthISO()); setToMonth(currentMonthISO()); }} data-testid="button-reset-budget-period">
            This month
          </Button>
          <div className="ml-auto">
            <BudgetLineFormDialog streams={activeStreams} trigger={<Button size="sm" data-testid="button-new-budget-line"><Plus className="h-4 w-4 mr-1" /> Add budget line</Button>} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total budgeted" value={formatKES(totalBudgeted)} icon={PiggyBank} accent="muted" testId="stat-budget-total-budgeted" />
        <StatCard label="Total actual (posted income)" value={formatKES(totalActual)} icon={PiggyBank} accent="success" testId="stat-budget-total-actual" />
        <StatCard
          label="Net variance"
          value={formatKES(totalVariance)}
          icon={totalVariance >= 0 ? TrendingUp : TrendingDown}
          accent={totalVariance >= 0 ? "success" : "warning"}
          testId="stat-budget-net-variance"
        />
      </div>

      <Card>
        <div className="p-4 border-b border-card-border">
          <h2 className="text-lg font-semibold">Budget vs actual by income stream</h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Income Stream</TableHead>
                <TableHead className="text-right">Budgeted</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Variance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              )}
              {!isLoading && variance.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No budget lines entered for this period yet.</TableCell></TableRow>
              )}
              {variance.map((r) => (
                <TableRow key={`${r.month}-${r.incomeStreamCode}`} data-testid={`row-budget-variance-${r.month}-${r.incomeStreamCode}`}>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{streamLabel(r.incomeStreamCode)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(r.budgetedAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(r.actualAmount)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.variance < 0 ? "text-destructive" : "text-success"}`}>{formatKES(r.variance)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.variance < 0 ? "text-destructive" : "text-success"}`}>
                    {r.budgetedAmount > 0 ? `${((r.variance / r.budgetedAmount) * 100).toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card>
        <div className="p-4 border-b border-card-border">
          <h2 className="text-lg font-semibold">Budget lines entered</h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Income Stream</TableHead>
                <TableHead className="text-right">Budgeted</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgetLines.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No budget lines yet — add one above.</TableCell></TableRow>
              )}
              {budgetLines.map((line) => (
                <TableRow key={line.id} data-testid={`row-budget-line-${line.id}`}>
                  <TableCell>{line.month}</TableCell>
                  <TableCell>{streamLabel(line.incomeStreamCode)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(line.budgetedAmount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{line.notes || "—"}</TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-budget-line-${line.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Delete this budget line?</AlertDialogTitle><AlertDialogDescription>This can't be undone.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteLine.mutate(line.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
