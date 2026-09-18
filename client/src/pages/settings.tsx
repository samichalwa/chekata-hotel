import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save, Send, Mail, MessageSquare, Building2, Plus, Pencil, Trash2, Percent, ShieldCheck, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import type { Settings, Tax, SafeUser, ModuleKey, Staff } from "@shared/schema";
import { MODULE_KEYS, MODULE_LABELS, MODULE_CATEGORY_GROUPS } from "@shared/schema";

const settingsFormSchema = z.object({
  hotelName: z.string().min(1, "Hotel name is required"),
  hotelAddress: z.string().optional().nullable(),
  hotelPhone: z.string().optional().nullable(),
  hotelEmail: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  emailProvider: z.string(),
  emailApiKey: z.string().optional().nullable(),
  emailFrom: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  emailFromName: z.string().optional().nullable(),
  mailgunDomain: z.string().optional().nullable(),
  invoicesEnabled: z.coerce.number(),
  smsProvider: z.string(),
  smsUsername: z.string().optional().nullable(),
  smsApiKey: z.string().optional().nullable(),
  smsSenderId: z.string().optional().nullable(),
  smsEnabled: z.coerce.number(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;
type SettingsFormInput = z.input<typeof settingsFormSchema>;

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

const NONE_PROVIDER = "none";

const providers = [
  { value: NONE_PROVIDER, label: "Not configured" },
  { value: "resend", label: "Resend" },
  { value: "sendgrid", label: "SendGrid" },
  { value: "postmark", label: "Postmark" },
  { value: "mailgun", label: "Mailgun" },
];

const smsProviders = [
  { value: NONE_PROVIDER, label: "Not configured" },
  { value: "africastalking", label: "Africa's Talking" },
];

function HotelEmailTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");

  const form = useForm<SettingsFormInput, any, SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      hotelName: "The Chekata",
      hotelAddress: "",
      hotelPhone: "",
      hotelEmail: "",
      emailProvider: "",
      emailApiKey: "",
      emailFrom: "",
      emailFromName: "",
      mailgunDomain: "",
      invoicesEnabled: 1,
      smsProvider: "",
      smsUsername: "",
      smsApiKey: "",
      smsSenderId: "",
      smsEnabled: 0,
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        hotelName: data.hotelName ?? "The Chekata",
        hotelAddress: data.hotelAddress ?? "",
        hotelPhone: data.hotelPhone ?? "",
        hotelEmail: data.hotelEmail ?? "",
        emailProvider: data.emailProvider ?? "",
        emailApiKey: data.emailApiKey ?? "",
        emailFrom: data.emailFrom ?? "",
        emailFromName: data.emailFromName ?? "",
        mailgunDomain: data.mailgunDomain ?? "",
        invoicesEnabled: data.invoicesEnabled ?? 1,
        smsProvider: data.smsProvider ?? "",
        smsUsername: data.smsUsername ?? "",
        smsApiKey: data.smsApiKey ?? "",
        smsSenderId: data.smsSenderId ?? "",
        smsEnabled: data.smsEnabled ?? 0,
      });
    }
  }, [data]);

  const provider = form.watch("emailProvider");
  const smsProvider = form.watch("smsProvider");

  const saveMutation = useMutation({
    mutationFn: (values: SettingsFormValues) => apiRequest("PUT", "/api/settings", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/test-email", { email: testEmail });
      return res.json();
    },
    onSuccess: () => toast({ title: "Test email sent", description: `Check ${testEmail} for the message.` }),
    onError: (err: Error) => toast({ title: "Test email failed", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const testSmsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/test-sms", { phone: testPhone });
      return res.json();
    },
    onSuccess: () => toast({ title: "Test SMS sent", description: `Check ${testPhone} for the message.` }),
    onError: (err: Error) => toast({ title: "Test SMS failed", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-6">
        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Hotel details</h2>
          <FormField control={form.control} name="hotelName" render={({ field }) => (
            <FormItem>
              <FormLabel>Hotel name</FormLabel>
              <FormControl><Input {...field} data-testid="input-hotel-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="hotelAddress" render={({ field }) => (
            <FormItem>
              <FormLabel>Address (optional)</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-hotel-address" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="hotelPhone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone (optional)</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-hotel-phone" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="hotelEmail" render={({ field }) => (
              <FormItem>
                <FormLabel>Email (optional)</FormLabel>
                <FormControl><Input type="email" {...field} value={field.value ?? ""} data-testid="input-hotel-email" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> Transactional email service</h2>
          <FormDescription>
            Invoices are emailed on booking/order creation and receipts when a payment is recorded. Get an API key from your chosen provider and paste it below — no SMTP setup required.
          </FormDescription>
          <FormField control={form.control} name="emailProvider" render={({ field }) => (
            <FormItem>
              <FormLabel>Provider</FormLabel>
              <Select
                onValueChange={(v) => field.onChange(v === NONE_PROVIDER ? "" : v)}
                value={field.value || NONE_PROVIDER}
              >
                <FormControl><SelectTrigger data-testid="select-email-provider"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {providers.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="emailApiKey" render={({ field }) => (
            <FormItem>
              <FormLabel>API key</FormLabel>
              <FormControl><Input type="password" placeholder="Paste your provider API key" {...field} value={field.value ?? ""} data-testid="input-email-api-key" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="emailFrom" render={({ field }) => (
              <FormItem>
                <FormLabel>From address</FormLabel>
                <FormControl><Input type="email" placeholder="billing@thechekata.co.ke" {...field} value={field.value ?? ""} data-testid="input-email-from" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="emailFromName" render={({ field }) => (
              <FormItem>
                <FormLabel>From name (optional)</FormLabel>
                <FormControl><Input placeholder="The Chekata" {...field} value={field.value ?? ""} data-testid="input-email-from-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          {provider === "mailgun" && (
            <FormField control={form.control} name="mailgunDomain" render={({ field }) => (
              <FormItem>
                <FormLabel>Mailgun sending domain</FormLabel>
                <FormControl><Input placeholder="mg.thechekata.co.ke" {...field} value={field.value ?? ""} data-testid="input-mailgun-domain" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          )}
          <FormField control={form.control} name="invoicesEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <FormLabel className="mb-0">Send invoices &amp; receipts automatically</FormLabel>
                <FormDescription>Turn off to log documents without emailing them.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value === 1} onCheckedChange={(c) => field.onChange(c ? 1 : 0)} data-testid="switch-invoices-enabled" />
              </FormControl>
            </FormItem>
          )} />

          <div className="flex items-end gap-2 pt-2 border-t border-border">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Send a test email</label>
              <Input type="email" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} data-testid="input-test-email" />
            </div>
            <Button type="button" variant="outline" disabled={!testEmail || testEmailMutation.isPending} onClick={() => testEmailMutation.mutate()} data-testid="button-send-test-email">
              <Send className="h-4 w-4 mr-1" /> {testEmailMutation.isPending ? "Sending..." : "Send test"}
            </Button>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="h-4 w-4" /> SMS confirmations</h2>
          <FormDescription>
            When a movie-room seat booking is paid for, an SMS confirmation (show, date/time, and seat) is sent to the guest's phone. This uses Africa's Talking and costs a small fee per message — the free WhatsApp button still works either way.
          </FormDescription>
          <FormField control={form.control} name="smsProvider" render={({ field }) => (
            <FormItem>
              <FormLabel>Provider</FormLabel>
              <Select
                onValueChange={(v) => field.onChange(v === NONE_PROVIDER ? "" : v)}
                value={field.value || NONE_PROVIDER}
              >
                <FormControl><SelectTrigger data-testid="select-sms-provider"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {smsProviders.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          {smsProvider === "africastalking" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="smsUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Africa's Talking username</FormLabel>
                    <FormControl><Input placeholder="your_at_username" {...field} value={field.value ?? ""} data-testid="input-sms-username" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="smsSenderId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sender ID (optional)</FormLabel>
                    <FormControl><Input placeholder="THECHEKATA" {...field} value={field.value ?? ""} data-testid="input-sms-sender-id" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="smsApiKey" render={({ field }) => (
                <FormItem>
                  <FormLabel>API key</FormLabel>
                  <FormControl><Input type="password" placeholder="Paste your Africa's Talking API key" {...field} value={field.value ?? ""} data-testid="input-sms-api-key" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </>
          )}
          <FormField control={form.control} name="smsEnabled" render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <FormLabel className="mb-0">Send SMS confirmations automatically</FormLabel>
                <FormDescription>Turn off to stop sending SMS while keeping the settings saved.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value === 1} onCheckedChange={(c) => field.onChange(c ? 1 : 0)} data-testid="switch-sms-enabled" />
              </FormControl>
            </FormItem>
          )} />

          <div className="flex items-end gap-2 pt-2 border-t border-border">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Send a test SMS</label>
              <Input type="tel" placeholder="07xx xxx xxx" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} data-testid="input-test-sms" />
            </div>
            <Button type="button" variant="outline" disabled={!testPhone || testSmsMutation.isPending} onClick={() => testSmsMutation.mutate()} data-testid="button-send-test-sms">
              <Send className="h-4 w-4 mr-1" /> {testSmsMutation.isPending ? "Sending..." : "Send test"}
            </Button>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
            <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Taxes tab
// ---------------------------------------------------------------------------

const taxFormSchema = z.object({
  name: z.string().min(1, "Tax name is required"),
  ratePercent: z.coerce.number().min(0, "Rate can't be negative").max(100, "Rate can't exceed 100%"),
  active: z.coerce.number(),
  appliesAccommodation: z.coerce.number(),
  appliesFacilities: z.coerce.number(),
  appliesBar: z.coerce.number(),
  appliesRestaurant: z.coerce.number(),
  appliesTenancy: z.coerce.number(),
  appliesWater: z.coerce.number(),
});

type TaxFormValues = z.infer<typeof taxFormSchema>;
type TaxFormInput = z.input<typeof taxFormSchema>;

function TaxFormDialog({ tax, trigger }: { tax?: Tax; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<TaxFormInput, any, TaxFormValues>({
    resolver: zodResolver(taxFormSchema),
    defaultValues: tax
      ? { name: tax.name, ratePercent: tax.ratePercent, active: tax.active, appliesAccommodation: tax.appliesAccommodation, appliesFacilities: tax.appliesFacilities, appliesBar: tax.appliesBar, appliesRestaurant: tax.appliesRestaurant, appliesTenancy: tax.appliesTenancy, appliesWater: tax.appliesWater }
      : { name: "", ratePercent: 0, active: 1, appliesAccommodation: 0, appliesFacilities: 0, appliesBar: 0, appliesRestaurant: 0, appliesTenancy: 0, appliesWater: 0 },
  });

  const mutation = useMutation({
    mutationFn: async (values: TaxFormValues) => {
      if (tax) return apiRequest("PATCH", `/api/taxes/${tax.id}`, values);
      return apiRequest("POST", "/api/taxes", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes"] });
      toast({ title: tax ? "Tax updated" : "Tax added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const revenueStreams: { key: keyof TaxFormValues; label: string }[] = [
    { key: "appliesAccommodation", label: "Accommodation" },
    { key: "appliesFacilities", label: "Conference & Movie Room" },
    { key: "appliesBar", label: "Bar" },
    { key: "appliesRestaurant", label: "Restaurant" },
    { key: "appliesTenancy", label: "Tenancy" },
    { key: "appliesWater", label: "Water Sales" },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tax ? "Edit tax" : "Add tax"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax name</FormLabel>
                  <FormControl><Input placeholder="e.g. VAT, Catering Levy" {...field} data-testid="input-tax-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ratePercent" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate (%)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} value={field.value as any} data-testid="input-tax-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormItem>
              <FormLabel>Applies to (revenue streams)</FormLabel>
              <FormDescription>Prices are entered tax-inclusive; this tax's share will be back-calculated and shown on invoices for the streams checked below.</FormDescription>
              <div className="grid grid-cols-2 gap-3 pt-1">
                {revenueStreams.map((rs) => (
                  <FormField key={rs.key} control={form.control} name={rs.key} render={({ field }) => (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={field.value === 1} onCheckedChange={(c) => field.onChange(c ? 1 : 0)} data-testid={`checkbox-tax-${rs.key}`} />
                      {rs.label}
                    </label>
                  )} />
                ))}
              </div>
            </FormItem>
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <FormLabel className="mb-0">Active</FormLabel>
                <FormControl>
                  <Switch checked={field.value === 1} onCheckedChange={(c) => field.onChange(c ? 1 : 0)} data-testid="switch-tax-active" />
                </FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-tax">
                {mutation.isPending ? "Saving..." : "Save tax"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function TaxesTab() {
  const { toast } = useToast();
  const { data: taxes = [], isLoading } = useQuery<Tax[]>({ queryKey: ["/api/taxes"] });

  const deleteTax = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/taxes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/taxes"] }); toast({ title: "Tax removed" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Prices entered elsewhere in the system already include tax. Add up to several taxes and tick which revenue streams each one applies to — the amount is back-calculated and shown on invoices without changing the total the guest pays.
        </p>
        <TaxFormDialog trigger={<Button size="sm" data-testid="button-new-tax"><Plus className="h-4 w-4 mr-1" /> Add tax</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading taxes…</div>
        ) : taxes.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No taxes configured yet. Add one when you're ready — invoices work fine without any.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxes.map((t) => {
                  const streams = [
                    t.appliesAccommodation && "Accommodation",
                    t.appliesFacilities && "Conference & Movie Room",
                    t.appliesBar && "Bar",
                    t.appliesRestaurant && "Restaurant",
                    t.appliesTenancy && "Tenancy",
                    t.appliesWater && "Water Sales",
                  ].filter(Boolean) as string[];
                  return (
                    <TableRow key={t.id} data-testid={`row-tax-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.ratePercent}%</TableCell>
                      <TableCell>
                        {streams.length === 0 ? <span className="text-muted-foreground">None</span> : (
                          <div className="flex flex-wrap gap-1">{streams.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}</div>
                        )}
                      </TableCell>
                      <TableCell><Badge variant={t.active ? "secondary" : "outline"}>{t.active ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <TaxFormDialog tax={t} trigger={
                            <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-tax-${t.id}`}><Pencil className="h-4 w-4" /></Button>
                          } />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-tax-${t.id}`}><Trash2 className="h-4 w-4" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove {t.name}?</AlertDialogTitle>
                                <AlertDialogDescription>This tax will no longer apply to future invoices.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteTax.mutate(t.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users & Access tab
// ---------------------------------------------------------------------------

const STAFF_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@thechekata\.com$/i;

const userFormSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  username: z.string().min(1, "Email address is required").regex(/^[a-zA-Z0-9._%+-]+@?[a-zA-Z0-9.-]*$/, "Letters, numbers, dots, dashes and underscores only"),
  password: z.string().optional(),
  isAdmin: z.boolean(),
  active: z.boolean(),
  permissions: z.array(z.string()),
  canEditMovieBookings: z.boolean(),
  canManageTablesList: z.boolean(),
  canManageMenuItemsList: z.boolean(),
  canCloseMaintenanceIssues: z.boolean(),
  canAdjustInventory: z.boolean(),
  canConfirmBookingWithoutPayment: z.boolean(),
  canAccessLive: z.boolean(),
  canAccessTest: z.boolean(),
  staffId: z.number().nullable().optional(),
}).refine((v) => v.isAdmin || STAFF_EMAIL_REGEX.test(v.username), {
  message: "Staff accounts must use a @thechekata.com email address",
  path: ["username"],
});

type UserFormValues = z.infer<typeof userFormSchema>;
type UserFormInput = z.input<typeof userFormSchema>;

function UserFormDialog({ user, trigger }: { user?: SafeUser; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<UserFormInput, any, UserFormValues>({
    resolver: zodResolver(
      userFormSchema.refine((v) => user || (v.password && v.password.length >= 6), {
        message: "Password must be at least 6 characters",
        path: ["password"],
      })
    ),
    defaultValues: user
      ? {
          fullName: user.fullName, username: user.username, password: "", isAdmin: !!user.isAdmin, active: !!user.active,
          permissions: JSON.parse(user.permissions || "[]"), canEditMovieBookings: !!user.canEditMovieBookings,
          canManageTablesList: !!user.canManageTablesList, canManageMenuItemsList: !!user.canManageMenuItemsList,
          canCloseMaintenanceIssues: !!user.canCloseMaintenanceIssues, canAdjustInventory: !!user.canAdjustInventory,
          canConfirmBookingWithoutPayment: !!user.canConfirmBookingWithoutPayment,
          canAccessLive: user.canAccessLive === undefined ? true : !!user.canAccessLive, canAccessTest: !!user.canAccessTest,
          staffId: user.staffId ?? null,
        }
      : { fullName: "", username: "", password: "", isAdmin: false, active: true, permissions: [], canEditMovieBookings: false, canManageTablesList: false, canManageMenuItemsList: false, canCloseMaintenanceIssues: false, canAdjustInventory: false, canConfirmBookingWithoutPayment: false, canAccessLive: true, canAccessTest: false, staffId: null },
  });

  const { data: staffList = [] } = useQuery<Staff[]>({ queryKey: ["/api/staff"] });

  const isAdminWatch = form.watch("isAdmin");
  const permissionsWatch = form.watch("permissions");
  const hasMovieRoomAccess = isAdminWatch || (permissionsWatch as string[]).includes("movie-room");
  const hasListsAccess = isAdminWatch || (permissionsWatch as string[]).includes("lists");
  const hasMaintenanceAccess = isAdminWatch || (permissionsWatch as string[]).includes("maintenance");
  const hasInventoryAccess = isAdminWatch || (permissionsWatch as string[]).includes("inventory");
  const hasPurchasingAccess = isAdminWatch || (permissionsWatch as string[]).includes("purchasing");
  const hasInternalRequisitionsAccess = isAdminWatch || (permissionsWatch as string[]).includes("internal-requisitions");
  const hasBookingOverrideAccess = isAdminWatch || (permissionsWatch as string[]).includes("accommodation") || (permissionsWatch as string[]).includes("facilities");

  const mutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      const payload = { ...values, password: values.password || undefined };
      if (user) return apiRequest("PATCH", `/api/users/${user.id}`, payload);
      return apiRequest("POST", "/api/users", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: user ? "User updated" : "User created" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{user ? "Edit user" : "Add user"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-user-fullname" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem>
                  <FormLabel>{isAdminWatch ? "Username or email" : "Email address"}</FormLabel>
                  <FormControl><Input type={isAdminWatch ? "text" : "email"} placeholder={isAdminWatch ? undefined : "name@thechekata.com"} {...field} data-testid="input-user-username" /></FormControl>
                  {!isAdminWatch && <FormDescription>Staff sign in with their @thechekata.com email address.</FormDescription>}
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>{user ? "New password (leave blank to keep current)" : "Password"}</FormLabel>
                <FormControl><Input type="password" {...field} value={field.value ?? ""} data-testid="input-user-password" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="isAdmin" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <FormLabel className="mb-0">Administrator</FormLabel>
                  <FormDescription>Admins can access every module and manage users &amp; taxes.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-user-admin" />
                </FormControl>
              </FormItem>
            )} />
            {!isAdminWatch && (
              <FormField control={form.control} name="permissions" render={({ field }) => (
                <FormItem>
                  <FormLabel>Module access</FormLabel>
                  <FormDescription>Choose exactly which pages this user can open and use.</FormDescription>
                  <div className="space-y-3 pt-1">
                    {MODULE_CATEGORY_GROUPS.map((group) => (
                      <div key={group.label} className="rounded-md border border-border/60 p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {group.keys.map((key) => {
                            const checked = (field.value as string[]).includes(key);
                            return (
                              <label key={key} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(c) => {
                                    const current = field.value as string[];
                                    field.onChange(c ? [...current, key] : current.filter((k) => k !== key));
                                  }}
                                  data-testid={`checkbox-permission-${key}`}
                                />
                                {MODULE_LABELS[key]}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="staffId" render={({ field }) => (
              <FormItem>
                <FormLabel>Linked HR staff record</FormLabel>
                <FormDescription>Links this login to an HR staff record so position-based approvals (e.g. "Director") can be resolved. Optional.</FormDescription>
                <Select
                  value={field.value != null ? String(field.value) : "none"}
                  onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-user-staff-link"><SelectValue placeholder="Not linked" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name} — {s.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            {hasMovieRoomAccess && (
              <FormField control={form.control} name="canEditMovieBookings" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <FormLabel className="mb-0">Can edit movie room bookings</FormLabel>
                    <FormDescription>Allows editing or cancelling a seat booking that's already been entered. Admins always have this right.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-edit-movie-bookings" />
                  </FormControl>
                </FormItem>
              )} />
            )}
            {hasListsAccess && (
              <FormField control={form.control} name="canManageTablesList" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <FormLabel className="mb-0">Can manage Tables list</FormLabel>
                    <FormDescription>Allows adding, editing, and removing bar/restaurant table numbers. Without this, the Lists page is view-only for tables.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-manage-tables-list" />
                  </FormControl>
                </FormItem>
              )} />
            )}
            {hasListsAccess && (
              <FormField control={form.control} name="canManageMenuItemsList" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <FormLabel className="mb-0">Can manage Menu Items list</FormLabel>
                    <FormDescription>Allows adding, editing, and removing bar/restaurant menu items. Without this, the Lists page is view-only for menu items.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-manage-menu-items-list" />
                  </FormControl>
                </FormItem>
              )} />
            )}
            {hasMaintenanceAccess && (
              <FormField control={form.control} name="canCloseMaintenanceIssues" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <FormLabel className="mb-0">Can close maintenance issues</FormLabel>
                    <FormDescription>Allows marking a resolved issue as closed. Admins always have this right.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-close-maintenance-issues" />
                  </FormControl>
                </FormItem>
              )} />
            )}
            {(hasInventoryAccess || hasPurchasingAccess || hasInternalRequisitionsAccess) && (
              <FormField control={form.control} name="canAdjustInventory" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <FormLabel className="mb-0">Can adjust inventory &amp; cancel documents</FormLabel>
                    <FormDescription>Allows manual stock adjustments and cancelling Purchase Requisitions, Purchase Orders, and Internal Requisitions. Admins always have this right.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-adjust-inventory" />
                  </FormControl>
                </FormItem>
              )} />
            )}
            {hasBookingOverrideAccess && (
              <FormField control={form.control} name="canConfirmBookingWithoutPayment" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <FormLabel className="mb-0">Can confirm bookings without payment</FormLabel>
                    <FormDescription>Director's-discretion override: allows confirming an accommodation or conference room booking before any payment is received. Admins always have this right.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-confirm-booking-without-payment" />
                  </FormControl>
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="canAccessLive" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <FormLabel className="mb-0">Live environment access</FormLabel>
                  <FormDescription>Allows signing in to the Live (production) environment. Admins always have this right.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-access-live" />
                </FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="canAccessTest" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <FormLabel className="mb-0">Test environment access</FormLabel>
                  <FormDescription>Allows signing in to the Test environment. Off by default. Admins always have this right.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={isAdminWatch || field.value} disabled={isAdminWatch} onCheckedChange={field.onChange} data-testid="switch-user-can-access-test" />
                </FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="active" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                <FormLabel className="mb-0">Active</FormLabel>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-user-active" />
                </FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-user">
                {mutation.isPending ? "Saving..." : "Save user"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const { data: users = [], isLoading } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });

  const deleteUser = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/users"] }); toast({ title: "User removed" }); },
    onError: (err: Error) => toast({ title: "Couldn't remove user", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create an account for each employee who needs to sign in — using their @thechekata.com email address as the username — and tick exactly which modules they can access. Administrators always have full access.
        </p>
        <UserFormDialog trigger={<Button size="sm" data-testid="button-new-user"><Plus className="h-4 w-4 mr-1" /> Add user</Button>} />
      </div>
      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No users yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email address</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const perms: ModuleKey[] = u.isAdmin ? MODULE_KEYS : JSON.parse(u.permissions || "[]");
                  return (
                    <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                      <TableCell className="font-medium">{u.fullName}{u.id === currentUser?.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</TableCell>
                      <TableCell>{u.username}</TableCell>
                      <TableCell>
                        {u.isAdmin ? (
                          <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> All modules</Badge>
                        ) : perms.length === 0 ? (
                          <span className="text-muted-foreground">No access granted</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">{perms.map((p) => <Badge key={p} variant="outline">{MODULE_LABELS[p]}</Badge>)}</div>
                        )}
                      </TableCell>
                      <TableCell><Badge variant={u.active ? "secondary" : "outline"}>{u.active ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <UserFormDialog user={u} trigger={
                            <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-user-${u.id}`}><Pencil className="h-4 w-4" /></Button>
                          } />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" title="Delete" disabled={u.id === currentUser?.id} data-testid={`button-delete-user-${u.id}`}><Trash2 className="h-4 w-4" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove {u.fullName}?</AlertDialogTitle>
                                <AlertDialogDescription>They will no longer be able to sign in.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteUser.mutate(u.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const { data: currentUser } = useCurrentUser();

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Settings" description="Hotel details, taxes, email, and user access." />

      <Tabs defaultValue="hotel">
        <TabsList>
          <TabsTrigger value="hotel" data-testid="tab-hotel-email"><Building2 className="h-4 w-4 mr-1" /> Hotel &amp; Email</TabsTrigger>
          <TabsTrigger value="taxes" data-testid="tab-taxes"><Percent className="h-4 w-4 mr-1" /> Taxes</TabsTrigger>
          {currentUser?.isAdmin && <TabsTrigger value="users" data-testid="tab-users"><KeyRound className="h-4 w-4 mr-1" /> Users &amp; Access</TabsTrigger>}
        </TabsList>
        <TabsContent value="hotel" className="pt-4">
          <HotelEmailTab />
        </TabsContent>
        <TabsContent value="taxes" className="pt-4">
          <TaxesTab />
        </TabsContent>
        {currentUser?.isAdmin && (
          <TabsContent value="users" className="pt-4">
            <UsersTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
