import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Clapperboard, Armchair, MessageCircle, Ticket, CalendarCheck } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, formatDate, todayISO, titleCase } from "@/lib/format";
import { buildWhatsAppLink, buildDocumentPdfUrl, fetchLatestDocumentPdfUrl } from "@/lib/whatsapp";
import { MOVIE_SEAT_ROWS, MOVIE_SEAT_NUMBERS, type MovieShow, type MovieSeatBooking } from "@shared/schema";

// ---------- Shared helpers ----------

function seatKey(row: string, number: number) {
  return `${row}${number}`;
}

function showTimeLabel(show: MovieShow) {
  return `${formatDate(show.showDate)} · ${show.startTime}${show.endTime ? `–${show.endTime}` : ""}`;
}

const showStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  scheduled: "secondary",
  completed: "outline",
  cancelled: "destructive",
};

const bookingStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  booked: "secondary",
  cancelled: "destructive",
};

// ---------- Show management ----------

const showFormSchema = z.object({
  name: z.string().min(1, "Movie / event name is required"),
  showDate: z.string().min(1, "Show date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().optional().nullable(),
  ticketPrice: z.coerce.number().positive("Ticket price must be greater than 0"),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

function ShowFormDialog({ show, trigger }: { show?: MovieShow; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof showFormSchema>>({
    resolver: zodResolver(showFormSchema),
    defaultValues: show
      ? { name: show.name, showDate: show.showDate, startTime: show.startTime, endTime: show.endTime ?? "", ticketPrice: show.ticketPrice, status: show.status, notes: show.notes ?? "" }
      : { name: "", showDate: todayISO(), startTime: "18:00", endTime: "20:00", ticketPrice: 500, status: "scheduled", notes: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof showFormSchema>) => {
      if (show) return apiRequest("PATCH", `/api/movie-shows/${show.id}`, values);
      return apiRequest("POST", "/api/movie-shows", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/movie-shows"] });
      toast({ title: show ? "Show updated" : "Show scheduled" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{show ? "Edit show" : "Schedule a movie / event"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Movie / event name</FormLabel>
                <FormControl><Input placeholder="e.g. Friday Night Screening" {...field} data-testid="input-show-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="showDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Show date</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-show-date" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>Start time</FormLabel>
                  <FormControl><Input type="time" {...field} data-testid="input-show-start" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem>
                  <FormLabel>End time (optional)</FormLabel>
                  <FormControl><Input type="time" {...field} value={field.value ?? ""} data-testid="input-show-end" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="ticketPrice" render={({ field }) => (
              <FormItem>
                <FormLabel>Ticket price per seat (KES)</FormLabel>
                <FormControl><Input type="number" {...field} data-testid="input-show-price" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-show-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
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
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-show-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-show">
                {mutation.isPending ? "Saving..." : "Save show"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Seat grid ----------

function SeatGrid({
  showId,
  bookings,
  selected,
  onToggle,
  disabled,
}: {
  showId: number | null;
  bookings: MovieSeatBooking[];
  selected: Set<string>;
  onToggle: (row: string, number: number) => void;
  disabled?: boolean;
}) {
  const occupied = useMemo(() => {
    const s = new Set<string>();
    for (const b of bookings) {
      if (b.showId === showId && b.status !== "cancelled") s.add(seatKey(b.seatRow, b.seatNumber));
    }
    return s;
  }, [bookings, showId]);

  if (!showId) {
    return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Select a show to view the seat map.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted py-2 text-center text-xs font-medium tracking-wide text-muted-foreground">SCREEN</div>
      <div className="space-y-2">
        {MOVIE_SEAT_ROWS.map((row) => (
          <div key={row} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground">{row}</span>
            <div className="flex flex-1 justify-center gap-1.5">
              {MOVIE_SEAT_NUMBERS.map((num) => {
                const key = seatKey(row, num);
                const isOccupied = occupied.has(key);
                const isSelected = selected.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled || isOccupied}
                    onClick={() => onToggle(row, num)}
                    title={isOccupied ? `${key} — already booked` : key}
                    data-testid={`seat-${key}`}
                    className={`h-8 w-8 rounded-md border text-[11px] font-medium flex items-center justify-center transition-colors ${
                      isOccupied
                        ? "bg-muted text-muted-foreground/50 border-muted cursor-not-allowed"
                        : isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent border-input cursor-pointer"
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-1">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-background border border-input inline-block" /> Available</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-primary inline-block" /> Selected</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-muted inline-block" /> Booked</span>
      </div>
    </div>
  );
}

// ---------- Booking flow (create) ----------

function BookSeatsPanel({ shows, bookings }: { shows: MovieShow[]; bookings: MovieSeatBooking[] }) {
  const { toast } = useToast();
  const bookableShows = useMemo(
    () => [...shows].filter((s) => s.status !== "cancelled" && s.status !== "completed").sort((a, b) => (a.showDate + a.startTime).localeCompare(b.showDate + b.startTime)),
    [shows],
  );

  const [showFilter, setShowFilter] = useState("");
  const filteredShows = useMemo(() => {
    const q = showFilter.trim().toLowerCase();
    if (!q) return bookableShows;
    return bookableShows.filter((s) => s.name.toLowerCase().includes(q) || s.showDate.includes(q));
  }, [bookableShows, showFilter]);

  const [showId1, setShowId1] = useState<number | null>(null);
  const [seats1, setSeats1] = useState<Set<string>>(new Set());
  const [addSecond, setAddSecond] = useState(false);
  const [showId2, setShowId2] = useState<number | null>(null);
  const [seats2, setSeats2] = useState<Set<string>>(new Set());

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [lastConfirmation, setLastConfirmation] = useState<{ message: string; phone: string } | null>(null);

  const show1 = bookableShows.find((s) => s.id === showId1);
  const show2 = bookableShows.find((s) => s.id === showId2);

  const toggleSeat = (which: 1 | 2, row: string, number: number) => {
    const key = seatKey(row, number);
    const setter = which === 1 ? setSeats1 : setSeats2;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const seatCount1 = seats1.size;
  const seatCount2 = addSecond ? seats2.size : 0;
  const total = (show1 ? show1.ticketPrice * seatCount1 : 0) + (show2 && addSecond ? show2.ticketPrice * seatCount2 : 0);

  const resetForm = () => {
    setShowId1(null); setSeats1(new Set()); setAddSecond(false); setShowId2(null); setSeats2(new Set());
    setGuestName(""); setGuestPhone(""); setGuestEmail(""); setAmountPaid(""); setPaymentMethod(""); setPaymentReference(""); setNotes("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const legs = [
        { showId: showId1, seats: Array.from(seats1).map((k) => ({ row: k[0], number: Number(k.slice(1)) })) },
        ...(addSecond && showId2 ? [{ showId: showId2, seats: Array.from(seats2).map((k) => ({ row: k[0], number: Number(k.slice(1)) })) }] : []),
      ];
      const res = await apiRequest("POST", "/api/movie-seat-bookings", {
        guestName, guestPhone: guestPhone || null, guestEmail: guestEmail || null,
        amountPaid: Number(amountPaid) || 0, paymentMethod: paymentMethod || null, paymentReference: paymentReference || null,
        notes: notes || null, legs,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/movie-seat-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Booking confirmed", description: `Booking ref ${data.bookingRef}` });
      const doc = data?._document;
      if (doc?.status === "sent") toast({ title: "Invoice emailed", description: "Sent to the guest's email address." });
      else if (doc?.status === "failed") toast({ title: "Email not sent", description: doc.errorMessage ?? "Check your Settings.", variant: "destructive" });

      const sms = data?._sms;
      if (sms?.status === "sent") toast({ title: "SMS sent", description: "Confirmation texted to the guest's phone." });
      else if (sms?.status === "skipped" && sms.errorMessage) toast({ title: "SMS not sent", description: sms.errorMessage, variant: "destructive" });

      const seatList1 = Array.from(seats1).sort().join(", ");
      const seatList2 = Array.from(seats2).sort().join(", ");
      let message = `Hi ${guestName || "there"}, this confirms your Movie Room booking at The Chekata.\n\n${show1?.name ?? ""} — ${show1 ? showTimeLabel(show1) : ""} — Seat(s): ${seatList1}`;
      if (addSecond && show2) {
        message += `\n${show2.name} — ${showTimeLabel(show2)} — Seat(s): ${seatList2}`;
      }
      message += `\n\nTotal: ${formatKES(total)}.`;
      if (paymentMethod || paymentReference) {
        message += ` Payment: ${[paymentMethod, paymentReference].filter(Boolean).join(" / ")}.`;
      }
      message += " See you there!";
      if (doc?.id && doc?.publicToken) {
        message += `\n\nView/download your invoice/receipt: ${buildDocumentPdfUrl(doc.id, doc.publicToken)}`;
      }
      setLastConfirmation({ message, phone: guestPhone });
      resetForm();
    },
    onError: (err: Error) => toast({ title: "Booking failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = guestName.trim().length > 0 && seatCount1 > 0 && (!addSecond || seatCount2 > 0) && !mutation.isPending;

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Show 1</h3>
        </div>
        <Input
          value={showFilter}
          onChange={(e) => setShowFilter(e.target.value)}
          placeholder="Filter shows by name or date (YYYY-MM-DD)"
          data-testid="input-filter-shows"
        />
        <Select onValueChange={(v) => { setShowId1(Number(v)); setSeats1(new Set()); }} value={showId1 ? String(showId1) : undefined}>
          <SelectTrigger data-testid="select-booking-show-1"><SelectValue placeholder="Choose a movie / event" /></SelectTrigger>
          <SelectContent>
            {filteredShows.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No shows match this filter</div>
            ) : (
              filteredShows.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name} — {showTimeLabel(s)} ({formatKES(s.ticketPrice)}/seat)</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <SeatGrid showId={showId1} bookings={bookings} selected={seats1} onToggle={(r, n) => toggleSeat(1, r, n)} />
        {seatCount1 > 0 && <p className="text-sm text-muted-foreground text-center">Selected: {Array.from(seats1).sort().join(", ")}</p>}
      </Card>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Book a second, back-to-back show</p>
          <p className="text-xs text-muted-foreground">Pay for two events in one transaction and receipt.</p>
        </div>
        <Switch checked={addSecond} onCheckedChange={(v) => { setAddSecond(v); if (!v) { setShowId2(null); setSeats2(new Set()); } }} data-testid="switch-add-second-show" />
      </div>

      {addSecond && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Ticket className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Show 2</h3>
          </div>
          <Select onValueChange={(v) => { setShowId2(Number(v)); setSeats2(new Set()); }} value={showId2 ? String(showId2) : undefined}>
            <SelectTrigger data-testid="select-booking-show-2"><SelectValue placeholder="Choose a second movie / event" /></SelectTrigger>
            <SelectContent>
              {filteredShows.filter((s) => s.id !== showId1).length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No shows match this filter</div>
              ) : (
                filteredShows.filter((s) => s.id !== showId1).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name} — {showTimeLabel(s)} ({formatKES(s.ticketPrice)}/seat)</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <SeatGrid showId={showId2} bookings={bookings} selected={seats2} onToggle={(r, n) => toggleSeat(2, r, n)} />
          {seatCount2 > 0 && <p className="text-sm text-muted-foreground text-center">Selected: {Array.from(seats2).sort().join(", ")}</p>}
        </Card>
      )}

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold">Guest details & payment</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Guest name</Label>
            <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} data-testid="input-guest-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone (optional)</Label>
            <Input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="07XXXXXXXX" data-testid="input-guest-phone" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Email (optional — invoice is emailed here)</Label>
          <Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="guest@example.com" data-testid="input-guest-email" />
        </div>
        <div className="grid grid-cols-2 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Amount paid now (KES)</Label>
            <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} data-testid="input-booking-amount-paid" />
          </div>
          <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between h-10">
            <span className="text-muted-foreground">Total due</span>
            <span className="font-semibold tabular-nums">{formatKES(total)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Payment method</Label>
            <Select onValueChange={setPaymentMethod} value={paymentMethod}>
              <SelectTrigger data-testid="select-booking-payment-method"><SelectValue placeholder="Select method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="mpesa">M-Pesa</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Payment reference (optional)</Label>
            <Input placeholder="M-Pesa code, slip #, etc." value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-booking-payment-reference" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-booking-notes" />
        </div>
        <div className="flex justify-end">
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()} data-testid="button-confirm-booking">
            {mutation.isPending ? "Booking..." : `Confirm booking — ${formatKES(total)}`}
          </Button>
        </div>
      </Card>

      {lastConfirmation && (
        <Card className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">Booking confirmed</p>
            <p className="text-xs text-muted-foreground">Send the guest a WhatsApp confirmation with event, time, and seat number(s).</p>
          </div>
          <Button
            variant="outline"
            disabled={!buildWhatsAppLink(lastConfirmation.phone, "x")}
            onClick={() => { const link = buildWhatsAppLink(lastConfirmation.phone, lastConfirmation.message); if (link) window.open(link, "_blank"); }}
            data-testid="button-send-whatsapp-movie-booking"
          >
            <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp confirmation
          </Button>
        </Card>
      )}
    </div>
  );
}

// ---------- Edit / cancel an existing seat booking ----------

const editBookingSchema = z.object({
  guestName: z.string().min(1, "Guest name is required"),
  guestPhone: z.string().optional().nullable(),
  guestEmail: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  amountPaid: z.coerce.number().nonnegative(),
  paymentMethod: z.string().optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

function EditBookingDialog({ booking, show, trigger }: { booking: MovieSeatBooking; show?: MovieShow; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof editBookingSchema>>({
    resolver: zodResolver(editBookingSchema),
    defaultValues: {
      guestName: booking.guestName, guestPhone: booking.guestPhone ?? "", guestEmail: booking.guestEmail ?? "",
      amountPaid: booking.amountPaid, paymentMethod: booking.paymentMethod ?? "", paymentReference: booking.paymentReference ?? "",
      status: booking.status, notes: booking.notes ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof editBookingSchema>) => {
      const res = await apiRequest("PATCH", `/api/movie-seat-bookings/${booking.id}`, values);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/movie-seat-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Booking updated" });
      const doc = data?._document;
      if (doc?.status === "sent") toast({ title: "Receipt emailed" });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit booking — Seat {booking.seatRow}{booking.seatNumber}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">{show?.name ?? "Movie Room"} · {show ? showTimeLabel(show) : ""}</p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="guestName" render={({ field }) => (
              <FormItem><FormLabel>Guest name</FormLabel><FormControl><Input {...field} data-testid="input-edit-guest-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="guestPhone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-guest-phone" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="amountPaid" render={({ field }) => (
                <FormItem><FormLabel>Amount paid (KES)</FormLabel><FormControl><Input type="number" {...field} data-testid="input-edit-amount-paid" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger data-testid="select-edit-payment-method"><SelectValue placeholder="Select method" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="paymentReference" render={({ field }) => (
                <FormItem><FormLabel>Payment reference</FormLabel><FormControl><Input placeholder="M-Pesa code, slip #, etc." {...field} value={field.value ?? ""} data-testid="input-edit-payment-reference" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="guestEmail" render={({ field }) => (
              <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} value={field.value ?? ""} data-testid="input-edit-guest-email" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-edit-booking-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="booked">Booked</SelectItem>
                    <SelectItem value="cancelled">Cancelled (frees the seat)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-edit-booking-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={!buildWhatsAppLink(form.watch("guestPhone"), "x")}
                onClick={async () => {
                  const pm = form.watch("paymentMethod");
                  const pr = form.watch("paymentReference");
                  const paid = form.watch("amountPaid");
                  const paymentDetail = (pm || pr) ? ` Payment: ${[pm, pr].filter(Boolean).join(" / ")}.` : "";
                  let message = `Hi ${form.watch("guestName") || booking.guestName}, payment received for your Movie Room booking at The Chekata \u2014 Seat ${booking.seatRow}${booking.seatNumber}. Paid KES ${Number(paid || 0).toLocaleString()}.${paymentDetail} Enjoy the show!`;
                  const pdfUrl = await fetchLatestDocumentPdfUrl("movie", booking.id);
                  if (pdfUrl) message += `\n\nView/download your invoice/receipt: ${pdfUrl}`;
                  const link = buildWhatsAppLink(form.watch("guestPhone"), message);
                  if (link) window.open(link, "_blank");
                }}
                data-testid="button-send-whatsapp-edit-booking"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-edit-booking">
                {mutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main page ----------

export default function MovieRoom() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const canEdit = Boolean(currentUser?.isAdmin || currentUser?.canEditMovieBookings);

  const { data: shows = [], isLoading: showsLoading } = useQuery<MovieShow[]>({ queryKey: ["/api/movie-shows"] });
  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<MovieSeatBooking[]>({ queryKey: ["/api/movie-seat-bookings"] });

  const showById = useMemo(() => new Map(shows.map((s) => [s.id, s])), [shows]);

  const deleteShow = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/movie-shows/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/movie-shows"] }); toast({ title: "Show removed" }); },
    onError: (err: Error) => toast({ title: "Couldn't remove show", description: err.message, variant: "destructive" }),
  });
  const deleteBooking = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/movie-seat-bookings/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/movie-seat-bookings"] }); toast({ title: "Booking cancelled" }); },
    onError: (err: Error) => toast({ title: "Couldn't cancel booking", description: err.message, variant: "destructive" }),
  });

  const activeBookings = bookings.filter((b) => b.status !== "cancelled");
  const revenue = activeBookings.reduce((s, b) => s + b.amountPaid, 0);
  const upcomingShows = shows.filter((s) => s.status === "scheduled").length;
  const sortedBookings = [...bookings].sort((a, b) => b.createdAt - a.createdAt);
  const sortedShows = [...shows].sort((a, b) => (b.showDate + b.startTime).localeCompare(a.showDate + a.startTime));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Movie Room (Seat Booking)" description="Book individual seats (rows A–G, seats 1–7) for movie nights and events, front row facing the screen." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Scheduled shows" value={String(upcomingShows)} icon={Clapperboard} testId="stat-upcoming-shows" />
        <StatCard label="Seats booked" value={String(activeBookings.length)} icon={Armchair} testId="stat-seats-booked" />
        <StatCard label="Movie room revenue" value={formatKES(revenue)} icon={Ticket} accent="success" testId="stat-movie-revenue" />
      </div>

      <Tabs defaultValue="book">
        <TabsList>
          <TabsTrigger value="book" data-testid="tab-book-seats">Book Seats</TabsTrigger>
          <TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger>
          <TabsTrigger value="shows" data-testid="tab-shows">Shows</TabsTrigger>
        </TabsList>

        <TabsContent value="book" className="mt-4">
          {showsLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading shows\u2026</div>
          ) : shows.filter((s) => s.status !== "cancelled").length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No shows scheduled yet. Add one in the Shows tab first.</Card>
          ) : (
            <BookSeatsPanel shows={shows} bookings={bookings} />
          )}
        </TabsContent>

        <TabsContent value="bookings" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Seat bookings</h2>
            </div>
            {bookingsLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading bookings\u2026</div>
            ) : sortedBookings.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No seat bookings yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Guest</TableHead>
                      <TableHead>Show</TableHead>
                      <TableHead>Date & time</TableHead>
                      <TableHead>Seat</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBookings.map((b) => {
                      const show = showById.get(b.showId);
                      return (
                        <TableRow key={b.id} data-testid={`row-movie-booking-${b.id}`}>
                          <TableCell className="font-medium">{b.guestName}</TableCell>
                          <TableCell>{show?.name ?? "—"}</TableCell>
                          <TableCell>{show ? showTimeLabel(show) : "—"}</TableCell>
                          <TableCell><Badge variant="outline">{b.seatRow}{b.seatNumber}</Badge></TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(b.ticketPrice)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(b.amountPaid)}</TableCell>
                          <TableCell><Badge variant={bookingStatusVariant[b.status] ?? "secondary"}>{titleCase(b.status)}</Badge></TableCell>
                          <TableCell className="text-right">
                            {canEdit ? (
                              <div className="flex justify-end gap-1">
                                <EditBookingDialog booking={b} show={show} trigger={
                                  <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-movie-booking-${b.id}`}><Pencil className="h-4 w-4" /></Button>
                                } />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-movie-booking-${b.id}`}><Trash2 className="h-4 w-4" /></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
                                      <AlertDialogDescription>This permanently removes {b.guestName}'s booking for seat {b.seatRow}{b.seatNumber} and frees it up.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteBooking.mutate(b.id)}>Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">No edit rights</span>
                            )}
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

        <TabsContent value="shows" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Shows</h2>
              <ShowFormDialog trigger={<Button size="sm" data-testid="button-new-show"><Plus className="h-4 w-4 mr-1" /> Schedule show</Button>} />
            </div>
            {showsLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading shows\u2026</div>
            ) : sortedShows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No shows yet. Schedule the first one.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Ticket price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedShows.map((s) => (
                      <TableRow key={s.id} data-testid={`row-show-${s.id}`}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{formatDate(s.showDate)}</TableCell>
                        <TableCell>{s.startTime}{s.endTime ? `–${s.endTime}` : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(s.ticketPrice)}</TableCell>
                        <TableCell><Badge variant={showStatusVariant[s.status] ?? "secondary"}>{titleCase(s.status)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {s.status === "completed" && !currentUser?.isAdmin ? (
                              <Button size="icon" variant="ghost" disabled title="Only an administrator can edit a completed show" data-testid={`button-edit-show-${s.id}`}><Pencil className="h-4 w-4" /></Button>
                            ) : (
                              <ShowFormDialog show={s} trigger={
                                <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-show-${s.id}`}><Pencil className="h-4 w-4" /></Button>
                              } />
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-show-${s.id}`}><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
                                  <AlertDialogDescription>Shows with active seat bookings can't be removed — cancel those bookings first.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteShow.mutate(s.id)}>Remove</AlertDialogAction>
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
