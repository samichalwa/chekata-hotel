import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Droplets, Wallet, Ban, MessageCircle, Receipt } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, todayISO } from "@/lib/format";
import { buildWhatsAppLink, fetchLatestDocumentPdfUrl } from "@/lib/whatsapp";
import { WATER_SALE_TYPES } from "@shared/schema";
import type { WaterBucketPrice, WaterSale } from "@shared/schema";

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

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

/* ---------------- Bulk Rate ---------------- */

function BulkRateCard() {
  const { toast } = useToast();
  const { data } = useQuery<{ waterRatePerLitre: number }>({ queryKey: ["/api/water-sales/rate"] });
  const [rate, setRate] = useState<string>("");
  const [editing, setEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: (waterRatePerLitre: number) => apiRequest("PATCH", "/api/water-sales/rate", { waterRatePerLitre }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/water-sales/rate"] });
      toast({ title: "Bulk rate updated" });
      setEditing(false);
    },
    onError: (err: Error) => toast({ title: "Could not update rate", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const currentRate = data?.waterRatePerLitre ?? 0;

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Bulk rate (per litre)</p>
        <p className="text-xs text-muted-foreground">Used for bulk sales, computed from meter readings. Tax-inclusive.</p>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input type="number" step="0.01" className="w-28" value={rate} onChange={(e) => setRate(e.target.value)} data-testid="input-bulk-rate" />
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(Number(rate))} data-testid="button-save-bulk-rate">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="font-medium tabular-nums" data-testid="text-bulk-rate">{formatKES(currentRate)} / litre</span>
          <Button size="sm" variant="outline" onClick={() => { setRate(String(currentRate)); setEditing(true); }} data-testid="button-edit-bulk-rate">Edit</Button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Bucket Pricing ---------------- */

const bucketPriceFormSchema = z.object({
  sizeLitres: z.coerce.number().min(0.1, "Enter a bucket size in litres"),
  price: z.coerce.number().min(0, "Price can't be negative"),
  active: z.number(),
});
type BucketPriceFormValues = z.output<typeof bucketPriceFormSchema>;
type BucketPriceFormInput = z.input<typeof bucketPriceFormSchema>;

function BucketPriceFormDialog({ price, trigger }: { price?: WaterBucketPrice; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<BucketPriceFormInput, any, BucketPriceFormValues>({
    resolver: zodResolver(bucketPriceFormSchema),
    defaultValues: price
      ? { sizeLitres: price.sizeLitres, price: price.price, active: price.active }
      : { sizeLitres: 20, price: 0, active: 1 },
  });

  const mutation = useMutation({
    mutationFn: (values: BucketPriceFormValues) => {
      if (price) return apiRequest("PATCH", `/api/water-sales/bucket-prices/${price.id}`, values);
      return apiRequest("POST", "/api/water-sales/bucket-prices", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/water-sales/bucket-prices"] });
      toast({ title: price ? "Bucket price updated" : "Bucket price added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{price ? "Edit bucket price" : "Add bucket size & price"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="sizeLitres" render={({ field }) => (
                <FormItem><FormLabel>Bucket size (litres)</FormLabel><FormControl><Input type="number" step="0.1" {...field} value={field.value as any} data-testid="input-bucket-size" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem><FormLabel>Price (KES)</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-bucket-price" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger data-testid="select-bucket-active"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-bucket-price">{mutation.isPending ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- New Sale ---------------- */

const saleFormSchema = z.object({
  saleType: z.enum(WATER_SALE_TYPES),
  saleDate: z.string().min(1, "Sale date is required"),
  bucketSizeLitres: z.coerce.number().optional().nullable(),
  bucketCount: z.coerce.number().optional().nullable(),
  meterStart: z.coerce.number().optional().nullable(),
  meterEnd: z.coerce.number().optional().nullable(),
  customerName: z.string().min(1, "Customer name is required"),
  customerPhone: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().or(z.literal("")).nullable(),
  paymentMethod: z.string().optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
type SaleFormValues = z.output<typeof saleFormSchema>;
type SaleFormInput = z.input<typeof saleFormSchema>;

function NewSaleDialog({ bucketPrices }: { bucketPrices: WaterBucketPrice[] }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const form = useForm<SaleFormInput, any, SaleFormValues>({
    resolver: zodResolver(saleFormSchema),
    defaultValues: {
      saleType: "bucket", saleDate: todayISO(), bucketSizeLitres: bucketPrices[0]?.sizeLitres ?? undefined, bucketCount: 1,
      meterStart: undefined, meterEnd: undefined, customerName: "", customerPhone: "", customerEmail: "",
      paymentMethod: "cash", paymentReference: "", notes: "",
    },
  });

  const saleType = form.watch("saleType");
  const bucketSizeLitres = form.watch("bucketSizeLitres");
  const bucketCount = form.watch("bucketCount");
  const meterStart = form.watch("meterStart");
  const meterEnd = form.watch("meterEnd");
  const customerPhone = form.watch("customerPhone");
  const customerName = form.watch("customerName");

  const activeBuckets = bucketPrices.filter((b) => b.active);
  const selectedBucket = activeBuckets.find((b) => b.sizeLitres === Number(bucketSizeLitres));
  const previewTotal = saleType === "bucket"
    ? (selectedBucket ? selectedBucket.price * (Number(bucketCount) || 0) : 0)
    : 0; // bulk total depends on server-side settings rate; shown after save

  const mutation = useMutation({
    mutationFn: (values: SaleFormValues) => apiRequest("POST", "/api/water-sales", {
      ...values,
      bucketSizeLitres: values.saleType === "bucket" ? values.bucketSizeLitres : null,
      bucketCount: values.saleType === "bucket" ? values.bucketCount : null,
      meterStart: values.saleType === "bulk" ? values.meterStart : null,
      meterEnd: values.saleType === "bulk" ? values.meterEnd : null,
      customerEmail: values.customerEmail || null,
    }),
    onSuccess: async (res) => {
      const sale: WaterSale = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/water-sales"] });
      toast({ title: "Water sale recorded", description: `${sale.saleNumber} — ${formatKES(sale.totalAmount)}` });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Could not record sale", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-new-water-sale"><Plus className="h-4 w-4 mr-1" /> New sale</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
        <DialogHeader><DialogTitle>New water sale</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="saleType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sale type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-sale-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="bucket">Bucket (10L/20L etc.)</SelectItem>
                      <SelectItem value="bulk">Bulk (meter reading)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="saleDate" render={({ field }) => (
                <FormItem><FormLabel>Sale date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-sale-date" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            {saleType === "bucket" ? (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="bucketSizeLitres" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bucket size</FormLabel>
                    <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger data-testid="select-bucket-size"><SelectValue placeholder="Select size" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {activeBuckets.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No bucket prices configured yet</div>}
                        {activeBuckets.map((b) => <SelectItem key={b.id} value={String(b.sizeLitres)}>{b.sizeLitres}L — {formatKES(b.price)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bucketCount" render={({ field }) => (
                  <FormItem><FormLabel>Number of buckets</FormLabel><FormControl><Input type="number" min={1} {...field} value={field.value as any} data-testid="input-bucket-count" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="meterStart" render={({ field }) => (
                  <FormItem><FormLabel>Meter start reading</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-meter-start" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="meterEnd" render={({ field }) => (
                  <FormItem><FormLabel>Meter end reading</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-meter-end" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            )}

            {saleType === "bucket" && (
              <p className="text-sm text-muted-foreground">Estimated total: <span className="font-medium tabular-nums text-foreground">{formatKES(previewTotal)}</span></p>
            )}
            {saleType === "bulk" && Number(meterEnd) > Number(meterStart) && (
              <p className="text-sm text-muted-foreground">Litres sold: <span className="font-medium tabular-nums text-foreground">{(Number(meterEnd) - Number(meterStart)).toFixed(1)}L</span> — total is computed from the configured rate per litre in Settings.</p>
            )}

            <FormField control={form.control} name="customerName" render={({ field }) => (
              <FormItem><FormLabel>Customer name</FormLabel><FormControl><Input {...field} data-testid="input-customer-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="customerPhone" render={({ field }) => (
                <FormItem><FormLabel>Phone (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-customer-phone" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="customerEmail" render={({ field }) => (
                <FormItem><FormLabel>Email (optional)</FormLabel><FormControl><Input type="email" {...field} value={field.value ?? ""} data-testid="input-customer-email" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <FormControl><SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                      <SelectItem value="bank">Bank transfer</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="paymentReference" render={({ field }) => (
                <FormItem><FormLabel>Reference (optional)</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-payment-reference" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (optional)</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-sale-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={!buildWhatsAppLink(customerPhone, "x")}
                onClick={() => {
                  const message = `Hi ${customerName || "there"}, thank you for your water purchase at The Chekata. We'll send your receipt once the sale is saved.`;
                  const link = buildWhatsAppLink(customerPhone, message, currentUser?.environment);
                  if (link) window.open(link, "_blank");
                }}
                data-testid="button-whatsapp-preview"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-water-sale">
                {mutation.isPending ? "Saving..." : "Record sale"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Cancel ---------------- */

function CancelSaleDialog({ sale, trigger }: { sale: WaterSale; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/water-sales/${sale.id}/cancel`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/water-sales"] });
      toast({ title: "Sale cancelled" });
      setOpen(false);
      setReason("");
    },
    onError: (err: Error) => toast({ title: "Could not cancel sale", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel sale {sale.saleNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Textarea placeholder="Reason for cancellation" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-cancel-reason" />
          <DialogFooter>
            <Button variant="destructive" disabled={!reason || mutation.isPending} onClick={() => mutation.mutate()} data-testid="button-confirm-cancel-sale">
              {mutation.isPending ? "Cancelling..." : "Confirm cancellation"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const saleTypeLabel: Record<string, string> = { bucket: "Bucket", bulk: "Bulk" };
const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  completed: "secondary",
  cancelled: "outline",
};

export default function WaterSales() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const isAdmin = Boolean(currentUser?.isAdmin);

  const { data: sales = [], isLoading } = useQuery<WaterSale[]>({ queryKey: ["/api/water-sales"] });
  const { data: bucketPrices = [] } = useQuery<WaterBucketPrice[]>({ queryKey: ["/api/water-sales/bucket-prices"] });

  const deleteBucketPrice = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/water-sales/bucket-prices/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/water-sales/bucket-prices"] }); toast({ title: "Bucket price removed" }); },
    onError: (err: Error) => toast({ title: "Could not remove", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const completedSales = sales.filter((s) => s.status === "completed");
  const totalRevenue = completedSales.reduce((s, r) => s + r.totalAmount, 0);
  const totalLitres = completedSales.reduce((s, r) => s + r.litresSold, 0);
  const bucketSalesCount = completedSales.filter((s) => s.saleType === "bucket").length;
  const bulkSalesCount = completedSales.filter((s) => s.saleType === "bulk").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Water Sales"
        description="Standalone bulk and bucket water sales, recorded as paid transactions with a receipt on every sale."
        action={<NewSaleDialog bucketPrices={bucketPrices} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard label="Total revenue" value={formatKES(totalRevenue)} icon={Wallet} accent="success" testId="stat-water-revenue" />
        <StatCard label="Litres sold" value={`${totalLitres.toFixed(1)}L`} icon={Droplets} testId="stat-water-litres" />
        <StatCard label="Bucket sales" value={String(bucketSalesCount)} icon={Receipt} accent="muted" testId="stat-water-bucket-count" />
        <StatCard label="Bulk sales" value={String(bulkSalesCount)} icon={Receipt} accent="muted" testId="stat-water-bulk-count" />
      </div>

      <Tabs defaultValue="history" className="w-full">
        <TabsList>
          <TabsTrigger value="history" data-testid="tab-water-history">Sales History</TabsTrigger>
          <TabsTrigger value="pricing" data-testid="tab-water-pricing">Bucket Pricing</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading sales…</div>
            ) : sales.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No water sales recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sale #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Recorded by</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((s) => (
                      <TableRow key={s.id} data-testid={`row-water-sale-${s.id}`}>
                        <TableCell className="font-mono text-xs">{s.saleNumber}</TableCell>
                        <TableCell>{s.saleDate}</TableCell>
                        <TableCell className="font-medium">{s.customerName}</TableCell>
                        <TableCell>{saleTypeLabel[s.saleType]}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.saleType === "bucket" ? `${s.bucketCount} x ${s.bucketSizeLitres}L (${s.litresSold.toFixed(1)}L)` : `${s.meterStart} → ${s.meterEnd} (${s.litresSold.toFixed(1)}L)`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(s.totalAmount)}</TableCell>
                        <TableCell><Badge variant={statusVariant[s.status] ?? "outline"}>{s.status === "completed" ? "Completed" : "Cancelled"}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground" title={formatDateTime(s.createdAt)}>
                          {s.createdBy}<br /><span className="opacity-70">{formatDateTime(s.createdAt)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={!buildWhatsAppLink(s.customerPhone, "x")}
                              onClick={async () => {
                                let message = `Hi ${s.customerName}, thank you for your water purchase at The Chekata. Sale ${s.saleNumber} — ${formatKES(s.totalAmount)}, paid in full.`;
                                const pdfUrl = await fetchLatestDocumentPdfUrl("water", s.id);
                                if (pdfUrl) message += `\n\nView/download your receipt: ${pdfUrl}`;
                                const link = buildWhatsAppLink(s.customerPhone, message, currentUser?.environment);
                                if (link) window.open(link, "_blank");
                              }}
                              data-testid={`button-whatsapp-sale-${s.id}`}
                            >
                              <MessageCircle className="h-4 w-4" />
                            </Button>
                            {s.status === "completed" && (
                              <CancelSaleDialog sale={s} trigger={<Button size="icon" variant="ghost" data-testid={`button-cancel-sale-${s.id}`}><Ban className="h-4 w-4" /></Button>} />
                            )}
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

        <TabsContent value="pricing" className="space-y-4 mt-4">
          <BulkRateCard />
          <div className="flex justify-end">
            <BucketPriceFormDialog trigger={<Button size="sm" data-testid="button-new-bucket-price"><Plus className="h-4 w-4 mr-1" /> Add bucket size</Button>} />
          </div>
          <Card>
            {bucketPrices.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No bucket sizes configured yet. Bulk water sales use the rate per litre set in Settings → Water.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bucket size</TableHead>
                      <TableHead className="text-right">Price (KES)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bucketPrices.map((b) => (
                      <TableRow key={b.id} data-testid={`row-bucket-price-${b.id}`}>
                        <TableCell className="font-medium">{b.sizeLitres}L</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(b.price)}</TableCell>
                        <TableCell><Badge variant={b.active ? "secondary" : "outline"}>{b.active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <BucketPriceFormDialog price={b} trigger={<Button size="icon" variant="ghost" data-testid={`button-edit-bucket-${b.id}`}><Pencil className="h-4 w-4" /></Button>} />
                            {isAdmin && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild><Button size="icon" variant="ghost" data-testid={`button-delete-bucket-${b.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader><AlertDialogTitle>Delete {b.sizeLitres}L bucket price?</AlertDialogTitle><AlertDialogDescription>This can't be undone.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteBucketPrice.mutate(b.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
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
      </Tabs>
    </div>
  );
}
