import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Receipt, Wrench, Filter } from "lucide-react";
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
import { formatKES, formatDate, todayISO, nowTs, titleCase } from "@/lib/format";
import type { Expense } from "@shared/schema";

const categories = ["maintenance", "utilities", "supplies", "staff_other", "marketing", "other"];

const expenseFormSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1, "Description is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  date: z.string().min(1, "Date is required"),
  paidTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function ExpenseFormDialog({ expense, trigger }: { expense?: Expense; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof expenseFormSchema>>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: expense
      ? { category: expense.category, description: expense.description, amount: expense.amount, date: expense.date, paidTo: expense.paidTo ?? "", notes: expense.notes ?? "" }
      : { category: "maintenance", description: "", amount: 0, date: todayISO(), paidTo: "", notes: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof expenseFormSchema>) => {
      if (expense) return apiRequest("PATCH", `/api/expenses/${expense.id}`, values);
      return apiRequest("POST", "/api/expenses", { ...values, createdAt: nowTs() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: expense ? "Expense updated" : "Expense recorded" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{expense ? "Edit expense" : "Record expense"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Input placeholder="e.g. Generator servicing" {...field} data-testid="input-expense-description" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-expense-category"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-expense-amount" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-expense-date" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="paidTo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Paid to (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-expense-paid-to" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-expense-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-expense">
                {mutation.isPending ? "Saving..." : "Save expense"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Expenses() {
  const { toast } = useToast();
  const { data: expenses = [], isLoading } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const deleteExpense = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/expenses/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/expenses"] }); toast({ title: "Expense removed" }); },
  });

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      return true;
    });
  }, [expenses, categoryFilter, fromDate, toDate]);

  const totalCosts = filtered.reduce((s, e) => s + e.amount, 0);
  const maintenanceCosts = filtered.filter((e) => e.category === "maintenance").reduce((s, e) => s + e.amount, 0);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Expenses"
        description="Track maintenance, utilities, supplies, and other operating costs."
        action={<ExpenseFormDialog trigger={<Button size="sm" data-testid="button-new-expense"><Plus className="h-4 w-4 mr-1" /> Record expense</Button>} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total costs (filtered)" value={formatKES(totalCosts)} icon={Receipt} accent="warning" testId="stat-total-expenses" />
        <StatCard label="Maintenance costs" value={formatKES(maintenanceCosts)} icon={Wrench} accent="muted" testId="stat-maintenance-costs" />
        <StatCard label="Entries" value={String(filtered.length)} icon={Receipt} testId="stat-expense-count" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-card-border">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40" data-testid="select-filter-category"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" placeholder="From" data-testid="input-filter-from-date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" placeholder="To" data-testid="input-filter-to-date" />
          {(categoryFilter !== "all" || fromDate || toDate) && (
            <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter("all"); setFromDate(""); setToDate(""); }} data-testid="button-clear-filters">
              Clear filters
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading expenses…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No expenses match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Paid to</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((e) => (
                  <TableRow key={e.id} data-testid={`row-expense-${e.id}`}>
                    <TableCell>{formatDate(e.date)}</TableCell>
                    <TableCell className="font-medium">{e.description}</TableCell>
                    <TableCell><Badge variant="outline">{titleCase(e.category)}</Badge></TableCell>
                    <TableCell>{e.paidTo || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKES(e.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <ExpenseFormDialog expense={e} trigger={
                          <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-expense-${e.id}`}><Pencil className="h-4 w-4" /></Button>
                        } />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-expense-${e.id}`}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                              <AlertDialogDescription>This removes the entry for "{e.description}" permanently.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteExpense.mutate(e.id)}>Delete</AlertDialogAction>
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
    </div>
  );
}
