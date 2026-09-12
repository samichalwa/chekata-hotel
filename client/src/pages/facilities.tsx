import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, PartyPopper, CalendarCheck, MessageCircle } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, formatDate, hoursBetween, nowTs, titleCase } from "@/lib/format";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { Facility, FacilityBooking } from "@shared/schema";

const facilityFormSchema = z.object({
  name: z.string().min(1, "Facility name is required"),
  rateType: z.string().min(1),
  rate: z.coerce.number().positive("Rate must be greater than 0"),
  capacity: z.coerce.number().int().nonnegative().optional().nullable(),
  active: z.coerce.number().default(1),
  notes: z.string().optional().nullable(),
});

const bookingFormSchema = z.object({
  facilityId: z.coerce.number().int().positive("Select a facility"),
  clientName: z.string().min(1, "Client name is required"),
  clientPhone: z.string().optional().nullable(),
  clientEmail: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  eventDate: z.string().min(1, "Event date is required"),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  rate: z.coerce.number().nonnegative(),
  amountPaid: z.coerce.number().nonnegative().default(0),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

function computeTotal(facility: Facility | undefined, rate: number, startTime?: string | null, endTime?: string | null) {
  if (!facility) return rate;
  if (facility.rateType === "hourly") {
    const hrs = hoursBetween(startTime ?? "", endTime ?? "");
    return hrs > 0 ? Math.round(hrs * rate) : rate;
  }
  return rate;
}

function FacilityFormDialog({ facility, trigger }: { facility?: Facility; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof facilityFormSchema>>({
    resolver: zodResolver(facilityFormSchema),
    defaultValues: facility
      ? { name: facility.name, rateType: facility.rateType, rate: facility.rate, capacity: facility.capacity ?? undefined, active: facility.active, notes: facility.notes ?? "" }
      : { name: "", rateType: "hourly", rate: 1000, capacity: undefined, active: 1, notes: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof facilityFormSchema>) => {
      if (facility) return apiRequest("PATCH", `/api/facilities/${facility.id}`, values);
      return apiRequest("POST", "/api/facilities", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facilities"] });
      toast({ title: facility ? "Facility updated" : "Facility added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{facility ? "Edit facility" : "Add facility"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Facility name</FormLabel>
                <FormControl><Input placeholder="e.g. Conference Hall" {...field} data-testid="input-facility-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="rateType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-rate-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="flat">Flat fee</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-facility-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="capacity" render={({ field }) => (
              <FormItem>
                <FormLabel>Capacity (optional)</FormLabel>
                <FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-facility-capacity" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-facility-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-facility">
                {mutation.isPending ? "Saving..." : "Save facility"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function FacilityBookingFormDialog({ booking, facilities, trigger }: { booking?: FacilityBooking; facilities: Facility[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof bookingFormSchema>>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: booking
      ? { facilityId: booking.facilityId, clientName: booking.clientName, clientPhone: booking.clientPhone ?? "", clientEmail: booking.clientEmail ?? "", eventDate: booking.eventDate, startTime: booking.startTime ?? "", endTime: booking.endTime ?? "", rate: booking.rate, amountPaid: booking.amountPaid, status: booking.status, notes: booking.notes ?? "" }
      : { facilityId: facilities[0]?.id ?? 0, clientName: "", clientPhone: "", clientEmail: "", eventDate: "", startTime: "", endTime: "", rate: facilities[0]?.rate ?? 0, amountPaid: 0, status: "confirmed", notes: "" },
  });

  const facilityId = form.watch("facilityId");
  const rate = form.watch("rate");
  const startTime = form.watch("startTime");
  const endTime = form.watch("endTime");
  const facility = facilities.find((f) => f.id === facilityId);
  const total = computeTotal(facility, rate || 0, startTime, endTime);
  const clientName = form.watch("clientName");
  const clientPhone = form.watch("clientPhone");
  const status = form.watch("status");

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof bookingFormSchema>) => {
      const f = facilities.find((x) => x.id === values.facilityId);
      const payload = { ...values, totalAmount: computeTotal(f, values.rate, values.startTime, values.endTime), createdAt: booking?.createdAt ?? nowTs() };
      const res = booking
        ? await apiRequest("PATCH", `/api/facility-bookings/${booking.id}`, payload)
        : await apiRequest("POST", "/api/facility-bookings", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/facility-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: booking ? "Booking updated" : "Booking created" });
      const doc = data?._document;
      if (doc?.status === "skipped" && !booking) {
        toast({ title: "No email on file", description: "Add a client email to send an invoice automatically." });
      } else if (doc?.status === "sent") {
        toast({ title: booking ? "Receipt emailed" : "Invoice emailed", description: "Sent to the client's email address." });
      } else if (doc?.status === "failed") {
        toast({ title: "Email not sent", description: doc.errorMessage ?? "Check your Settings.", variant: "destructive" });
      }
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{booking ? "Edit booking" : "New facility booking"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="facilityId" render={({ field }) => (
              <FormItem>
                <FormLabel>Facility</FormLabel>
                <Select
                  onValueChange={(v) => {
                    field.onChange(Number(v));
                    const f = facilities.find((x) => x.id === Number(v));
                    if (f) form.setValue("rate", f.rate);
                  }}
                  value={String(field.value)}
                >
                  <FormControl><SelectTrigger data-testid="select-booking-facility"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {facilities.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name} ({formatKES(f.rate)}/{f.rateType === "hourly" ? "hr" : f.rateType})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="clientName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Client name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-client-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="clientPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-client-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="clientEmail" render={({ field }) => (
              <FormItem>
                <FormLabel>Email (optional — invoice/receipt is emailed here)</FormLabel>
                <FormControl><Input type="email" placeholder="client@example.com" {...field} value={field.value ?? ""} data-testid="input-client-email" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="eventDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Event date</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-event-date" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {facility?.rateType === "hourly" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="startTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start time</FormLabel>
                    <FormControl><Input type="time" {...field} value={field.value ?? ""} data-testid="input-start-time" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End time</FormLabel>
                    <FormControl><Input type="time" {...field} value={field.value ?? ""} data-testid="input-end-time" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-booking-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="amountPaid" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount paid (KES)</FormLabel>
                  <FormControl><Input type="number" {...field} data-testid="input-amount-paid" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Estimated total</span>
              <span className="font-semibold tabular-nums">{formatKES(total)}</span>
            </div>
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-facility-booking-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-facility-booking-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={!buildWhatsAppLink(clientPhone, "x")}
                onClick={() => {
                  const message = `Hi ${clientName || "there"}, this confirms your booking for ${facility?.name || "the facility"} at The Chekata. Total: ${formatKES(total)}${status === "completed" ? " — Paid in full." : " — Balance may be due."} We look forward to hosting you.`;
                  const link = buildWhatsAppLink(clientPhone, message);
                  if (link) window.open(link, "_blank");
                }}
                data-testid="button-send-whatsapp-facility"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-facility-booking">
                {mutation.isPending ? "Saving..." : "Save booking"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  confirmed: "secondary",
  completed: "outline",
  cancelled: "destructive",
};

export default function Facilities() {
  const { toast } = useToast();
  const { data: facilities = [], isLoading: facilitiesLoading } = useQuery<Facility[]>({ queryKey: ["/api/facilities"] });
  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<FacilityBooking[]>({ queryKey: ["/api/facility-bookings"] });

  const facilityById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities]);

  const deleteFacility = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/facilities/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/facilities"] }); toast({ title: "Facility removed" }); },
  });
  const deleteBooking = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/facility-bookings/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/facility-bookings"] }); toast({ title: "Booking removed" }); },
  });

  const revenue = bookings.filter((b) => b.status !== "cancelled").reduce((s, b) => s + b.totalAmount, 0);
  const upcoming = bookings.filter((b) => b.status === "confirmed").length;
  const sortedBookings = [...bookings].sort((a, b) => b.createdAt - a.createdAt);
  const sortedFacilities = [...facilities].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Conference & Movie Room" description="Manage the conference hall, movie room, and any other bookable event space." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Facilities" value={String(facilities.length)} icon={PartyPopper} testId="stat-facility-count" />
        <StatCard label="Upcoming bookings" value={String(upcoming)} icon={CalendarCheck} testId="stat-upcoming-bookings" />
        <StatCard label="Facility revenue" value={formatKES(revenue)} icon={PartyPopper} accent="success" testId="stat-facility-revenue" />
      </div>

      <Tabs defaultValue="bookings">
        <TabsList>
          <TabsTrigger value="bookings" data-testid="tab-facility-bookings">Bookings</TabsTrigger>
          <TabsTrigger value="facilities" data-testid="tab-facilities">Facilities</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Bookings</h2>
              <FacilityBookingFormDialog facilities={facilities} trigger={
                <Button size="sm" disabled={facilities.length === 0} data-testid="button-new-facility-booking"><Plus className="h-4 w-4 mr-1" /> New booking</Button>
              } />
            </div>
            {bookingsLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading bookings…</div>
            ) : sortedBookings.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No bookings yet. Create the first one.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Facility</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBookings.map((b) => {
                      const f = facilityById.get(b.facilityId);
                      return (
                        <TableRow key={b.id} data-testid={`row-facility-booking-${b.id}`}>
                          <TableCell className="font-medium">{b.clientName}</TableCell>
                          <TableCell>{f?.name ?? "—"}</TableCell>
                          <TableCell>{formatDate(b.eventDate)}</TableCell>
                          <TableCell>{b.startTime && b.endTime ? `${b.startTime}–${b.endTime}` : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(b.totalAmount)}</TableCell>
                          <TableCell><Badge variant={statusVariant[b.status]}>{titleCase(b.status)}</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <FacilityBookingFormDialog booking={b} facilities={facilities} trigger={
                                <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-facility-booking-${b.id}`}><Pencil className="h-4 w-4" /></Button>
                              } />
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-facility-booking-${b.id}`}><Trash2 className="h-4 w-4" /></Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
                                    <AlertDialogDescription>This removes {b.clientName}'s booking permanently.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteBooking.mutate(b.id)}>Delete</AlertDialogAction>
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
        </TabsContent>

        <TabsContent value="facilities" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Facilities</h2>
              <FacilityFormDialog trigger={<Button size="sm" data-testid="button-new-facility"><Plus className="h-4 w-4 mr-1" /> Add facility</Button>} />
            </div>
            {facilitiesLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading facilities…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Rate type</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedFacilities.map((f) => (
                      <TableRow key={f.id} data-testid={`row-facility-${f.id}`}>
                        <TableCell className="font-medium">{f.name}</TableCell>
                        <TableCell>{titleCase(f.rateType)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(f.rate)}</TableCell>
                        <TableCell>{f.capacity ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <FacilityFormDialog facility={f} trigger={
                              <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-facility-${f.id}`}><Pencil className="h-4 w-4" /></Button>
                            } />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-facility-${f.id}`}><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove {f.name}?</AlertDialogTitle>
                                  <AlertDialogDescription>This facility will no longer be available for new bookings.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteFacility.mutate(f.id)}>Remove</AlertDialogAction>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
