import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, LogIn, LogOut, BedDouble, MessageCircle, IdCard, Upload, Undo2 } from "lucide-react";
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
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, formatDate, nightsBetween, nowTs, titleCase } from "@/lib/format";
import { buildWhatsAppLink, fetchLatestDocumentPdfUrl } from "@/lib/whatsapp";
import { CreditNoteDialog } from "@/components/credit-note-dialog";
import type { Room, AccommodationBooking, GuestIdentityDocument } from "@shared/schema";

const roomFormSchema = z.object({
  name: z.string().min(1, "Room name is required"),
  type: z.string().min(1, "Room type is required"),
  rate: z.coerce.number().positive("Rate must be greater than 0"),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const bookingFormSchema = z.object({
  roomId: z.coerce.number().int().positive("Select a room"),
  guestName: z.string().min(1, "Guest name is required"),
  guestPhone: z.string().optional().nullable(),
  guestEmail: z.string().optional().nullable().refine((v) => !v || /\S+@\S+\.\S+/.test(v), { message: "Enter a valid email" }),
  numberOfGuests: z.coerce.number().int().min(1, "At least 1 guest is required").max(2, "A booking cannot have more than 2 guests. Please create a separate booking for additional guests."),
  checkIn: z.string().min(1, "Check-in date is required"),
  checkOut: z.string().min(1, "Check-out date is required"),
  rate: z.coerce.number().nonnegative(),
  amountPaid: z.coerce.number().nonnegative().default(0),
  paymentMethod: z.string().optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  status: z.string().min(1),
  notes: z.string().optional().nullable(),
});

function fileToBase64(file: File): Promise<{ dataBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve({ dataBase64: result.slice(commaIdx + 1), mimeType: file.type });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function RoomFormDialog({ room, rooms, trigger }: { room?: Room; rooms: Room[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof roomFormSchema>>({
    resolver: zodResolver(roomFormSchema),
    defaultValues: room
      ? { name: room.name, type: room.type, rate: room.rate, status: room.status, notes: room.notes ?? "" }
      : { name: "", type: "standard", rate: 4500, status: "available", notes: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof roomFormSchema>) => {
      if (room) {
        return apiRequest("PATCH", `/api/rooms/${room.id}`, values);
      }
      return apiRequest("POST", "/api/rooms", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      toast({ title: room ? "Room updated" : "Room added" });
      setOpen(false);
      form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "Add room"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Room name</FormLabel>
                <FormControl><Input placeholder="e.g. Standard 9" {...field} data-testid="input-room-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Room type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-room-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="executive">Executive</SelectItem>
                      <SelectItem value="suite">Suite</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate per night (KES)</FormLabel>
                  <FormControl><Input type="number" step="1" {...field} data-testid="input-room-rate" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-room-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="occupied">Occupied</SelectItem>
                    <SelectItem value="maintenance">Under maintenance</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-room-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-room">
                {mutation.isPending ? "Saving..." : "Save room"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function BookingFormDialog({ booking, rooms, trigger }: { booking?: AccommodationBooking; rooms: Room[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const form = useForm<z.infer<typeof bookingFormSchema>>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: booking
      ? {
          roomId: booking.roomId, guestName: booking.guestName, guestPhone: booking.guestPhone ?? "",
          guestEmail: booking.guestEmail ?? "", numberOfGuests: booking.numberOfGuests ?? 1,
          checkIn: booking.checkIn, checkOut: booking.checkOut, rate: booking.rate,
          amountPaid: booking.amountPaid, paymentMethod: booking.paymentMethod ?? "", paymentReference: booking.paymentReference ?? "",
          status: booking.status, notes: booking.notes ?? "",
        }
      : {
          roomId: rooms[0]?.id ?? 0, guestName: "", guestPhone: "", guestEmail: "", numberOfGuests: 1, checkIn: "", checkOut: "",
          rate: rooms[0]?.rate ?? 0, amountPaid: 0, paymentMethod: "", paymentReference: "", status: "confirmed", notes: "",
        },
  });

  const selectedRoomId = form.watch("roomId");
  const checkIn = form.watch("checkIn");
  const checkOut = form.watch("checkOut");
  const rate = form.watch("rate");
  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * (rate || 0);
  const guestName = form.watch("guestName");
  const guestPhone = form.watch("guestPhone");
  const status = form.watch("status");
  const amountPaidWatch = form.watch("amountPaid");
  const paymentMethodWatch = form.watch("paymentMethod");
  const paymentReferenceWatch = form.watch("paymentReference");
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof bookingFormSchema>) => {
      const payload = { ...values, totalAmount: nightsBetween(values.checkIn, values.checkOut) * values.rate, createdAt: booking?.createdAt ?? nowTs() };
      const res = booking
        ? await apiRequest("PATCH", `/api/accommodation-bookings/${booking.id}`, payload)
        : await apiRequest("POST", "/api/accommodation-bookings", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accommodation-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: booking ? "Booking updated" : "Booking created" });
      const doc = data?._document;
      if (doc?.status === "skipped" && !booking) {
        toast({ title: "No email on file", description: "Add a guest email to send an invoice automatically." });
      } else if (doc?.status === "sent") {
        toast({ title: booking ? "Receipt emailed" : "Invoice emailed", description: "Sent to the guest's email address." });
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
        <DialogHeader>
          <DialogTitle>{booking ? "Edit booking" : "New accommodation booking"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="roomId" render={({ field }) => (
              <FormItem>
                <FormLabel>Room</FormLabel>
                <Select
                  onValueChange={(v) => {
                    field.onChange(Number(v));
                    const r = rooms.find((rm) => rm.id === Number(v));
                    if (r) form.setValue("rate", r.rate);
                  }}
                  value={String(field.value)}
                >
                  <FormControl><SelectTrigger data-testid="select-booking-room"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {rooms.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name} — {titleCase(r.type)} ({formatKES(r.rate)}/night)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="guestName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Guest name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-guest-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="guestPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-guest-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="guestEmail" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (optional — invoice/receipt is emailed here)</FormLabel>
                  <FormControl><Input type="email" placeholder="guest@example.com" {...field} value={field.value ?? ""} data-testid="input-guest-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="numberOfGuests" render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of guests (max 2)</FormLabel>
                  <FormControl><Input type="number" min={1} max={2} {...field} data-testid="input-number-of-guests" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="checkIn" render={({ field }) => (
                <FormItem>
                  <FormLabel>Check-in</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-check-in" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="checkOut" render={({ field }) => (
                <FormItem>
                  <FormLabel>Check-out</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-check-out" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate per night (KES)</FormLabel>
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
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger data-testid="select-payment-method"><SelectValue placeholder="Select method" /></SelectTrigger></FormControl>
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
                <FormItem>
                  <FormLabel>Payment reference (optional)</FormLabel>
                  <FormControl><Input placeholder="M-Pesa code, slip #, etc." {...field} value={field.value ?? ""} data-testid="input-payment-reference" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">{nights} night{nights === 1 ? "" : "s"}</span>
              <span className="font-semibold tabular-nums">{formatKES(total)}</span>
            </div>
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-booking-status"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="checked_in">Checked in</SelectItem>
                    <SelectItem value="checked_out">Checked out</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-booking-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={!buildWhatsAppLink(guestPhone, "x")}
                onClick={async () => {
                  const paymentDetail = amountPaidWatch > 0 && (paymentMethodWatch || paymentReferenceWatch)
                    ? ` Payment: ${[paymentMethodWatch, paymentReferenceWatch].filter(Boolean).join(" / ")}.`
                    : "";
                  let message = `Hi ${guestName || "there"}, this confirms your stay at The Chekata in ${selectedRoom?.name || "your room"}${nights ? ` for ${nights} night${nights === 1 ? "" : "s"}` : ""}. Total: ${formatKES(total)}${status === "checked_out" ? " — Paid in full." : " — Balance may be due."}${paymentDetail} We look forward to hosting you.`;
                  // Existing booking: a document may already exist (created on save) — embed its PDF link.
                  // New/unsaved booking has no document yet, so we skip the fetch and send text only.
                  if (booking) {
                    const pdfUrl = await fetchLatestDocumentPdfUrl("accommodation", booking.id);
                    if (pdfUrl) message += `\n\nView/download your invoice/receipt: ${pdfUrl}`;
                  }
                  const link = buildWhatsAppLink(guestPhone, message, currentUser?.environment);
                  if (link) window.open(link, "_blank");
                }}
                data-testid="button-send-whatsapp-accommodation"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-booking">
                {mutation.isPending ? "Saving..." : "Save booking"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

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

const idTypeLabel: Record<string, string> = { national_id: "National ID", passport: "Passport" };

function IdentityDocumentsDialog({ booking, trigger }: { booking: AccommodationBooking; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [guestNumber, setGuestNumber] = useState("1");
  const [guestName, setGuestName] = useState(booking.guestName);
  const [idType, setIdType] = useState("national_id");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const { toast } = useToast();

  const { data: docs = [], isLoading } = useQuery<GuestIdentityDocument[]>({
    queryKey: ["/api/accommodation-bookings", booking.id, "identity-documents"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/accommodation-bookings/${booking.id}/identity-documents`);
      return res.json();
    },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!frontFile) throw new Error("A front-of-ID image is required.");
      if (idType === "national_id" && !backFile) throw new Error("A back-of-ID image is required for a national ID.");
      const front = await fileToBase64(frontFile);
      const frontRes = await apiRequest("POST", "/api/accommodation/uploads", { filename: frontFile.name, ...front });
      const { url: frontImageUrl } = await frontRes.json();
      let backImageUrl: string | undefined;
      if (backFile) {
        const back = await fileToBase64(backFile);
        const backRes = await apiRequest("POST", "/api/accommodation/uploads", { filename: backFile.name, ...back });
        backImageUrl = (await backRes.json()).url;
      }
      return apiRequest("POST", `/api/accommodation-bookings/${booking.id}/identity-documents`, {
        guestNumber: Number(guestNumber), guestName, idType, frontImageUrl, backImageUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accommodation-bookings", booking.id, "identity-documents"] });
      toast({ title: "ID document recorded" });
      setFrontFile(null); setBackFile(null);
    },
    onError: (err: Error) => toast({ title: "Could not save ID document", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Guest ID documents — {booking.guestName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Recorded documents (max 2 guests per room)</h3>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ID documents recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border p-2 text-sm" data-testid={`row-identity-doc-${d.id}`}>
                    <span>Guest {d.guestNumber}: {d.guestName} — {idTypeLabel[d.idType] ?? d.idType}</span>
                    <div className="flex gap-2">
                      <a href={d.frontImageUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">Front</a>
                      {d.backImageUrl && <a href={d.backImageUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">Back</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {docs.length < 2 && (
            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">Add a guest ID document</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Guest number</label>
                  <Select onValueChange={setGuestNumber} value={guestNumber}>
                    <SelectTrigger data-testid="select-id-guest-number"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="1">Guest 1</SelectItem><SelectItem value="2">Guest 2</SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">ID type</label>
                  <Select onValueChange={setIdType} value={idType}>
                    <SelectTrigger data-testid="select-id-type"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="national_id">National ID</SelectItem><SelectItem value="passport">Passport</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Guest name</label>
                <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} data-testid="input-id-guest-name" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Front of ID (photo)</label>
                  <Input type="file" accept="image/*" onChange={(e) => setFrontFile(e.target.files?.[0] ?? null)} data-testid="input-id-front-image" />
                </div>
                {idType === "national_id" && (
                  <div>
                    <label className="text-sm font-medium">Back of ID (photo)</label>
                    <Input type="file" accept="image/*" onChange={(e) => setBackFile(e.target.files?.[0] ?? null)} data-testid="input-id-back-image" />
                  </div>
                )}
              </div>
              <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !guestName || !frontFile} data-testid="button-save-identity-document">
                <Upload className="h-4 w-4 mr-1" /> {mutation.isPending ? "Uploading..." : "Save ID document"}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-close-identity-documents">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  confirmed: "secondary",
  checked_in: "default",
  checked_out: "outline",
  cancelled: "destructive",
  available: "secondary",
  occupied: "default",
  maintenance: "destructive",
};

export default function Accommodation() {
  const { toast } = useToast();
  const { data: rooms = [], isLoading: roomsLoading } = useQuery<Room[]>({ queryKey: ["/api/rooms"] });
  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<AccommodationBooking[]>({ queryKey: ["/api/accommodation-bookings"] });

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const deleteRoom = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/rooms/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/rooms"] }); toast({ title: "Room removed" }); },
  });
  const deleteBooking = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/accommodation-bookings/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/accommodation-bookings"] }); toast({ title: "Booking removed" }); },
  });
  const setBookingStatus = useMutation({
    mutationFn: async ({ id, status, roomId }: { id: number; status: string; roomId: number }) => {
      await apiRequest("PATCH", `/api/accommodation-bookings/${id}`, { status });
      if (status === "checked_in") {
        await apiRequest("PATCH", `/api/rooms/${roomId}`, { status: "occupied" });
      } else if (status === "checked_out") {
        await apiRequest("PATCH", `/api/rooms/${roomId}`, { status: "available" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accommodation-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
    },
  });

  const occupied = rooms.filter((r) => r.status === "occupied").length;
  const activeBookings = bookings.filter((b) => b.status === "confirmed" || b.status === "checked_in");
  const outstanding = bookings.reduce((s, b) => s + Math.max(0, b.totalAmount - b.amountPaid - (b.creditedAmount ?? 0)), 0);
  const totalRevenue = bookings.filter((b) => b.status !== "cancelled").reduce((s, b) => s + b.totalAmount - (b.creditedAmount ?? 0), 0);

  const sortedBookings = [...bookings].sort((a, b) => b.createdAt - a.createdAt);
  const sortedRooms = [...rooms].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Accommodation"
        description="Manage rooms and guest bookings for the 8 standard and 2 executive rooms."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total rooms" value={String(rooms.length)} icon={BedDouble} hint={`${occupied} occupied now`} testId="stat-total-rooms" />
        <StatCard label="Active bookings" value={String(activeBookings.length)} icon={LogIn} testId="stat-active-bookings" />
        <StatCard label="Accommodation revenue" value={formatKES(totalRevenue)} icon={BedDouble} accent="success" testId="stat-accommodation-revenue" />
        <StatCard label="Outstanding balance" value={formatKES(outstanding)} icon={LogOut} accent="warning" testId="stat-outstanding-balance" />
      </div>

      <Tabs defaultValue="bookings">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger>
            <TabsTrigger value="rooms" data-testid="tab-rooms">Rooms</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="bookings" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Bookings</h2>
              <BookingFormDialog rooms={rooms} trigger={
                <Button size="sm" data-testid="button-new-booking" disabled={rooms.length === 0}>
                  <Plus className="h-4 w-4 mr-1" /> New booking
                </Button>
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
                      <TableHead>Guest</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBookings.map((b) => {
                      const room = roomById.get(b.roomId);
                      const balance = b.totalAmount - b.amountPaid - (b.creditedAmount ?? 0);
                      return (
                        <TableRow key={b.id} data-testid={`row-booking-${b.id}`}>
                          <TableCell className="font-medium">{b.guestName}{b.numberOfGuests > 1 && <span className="text-xs text-muted-foreground ml-1">({b.numberOfGuests} guests)</span>}</TableCell>
                          <TableCell>{room?.name ?? "—"}</TableCell>
                          <TableCell>{formatDate(b.checkIn)}</TableCell>
                          <TableCell>{formatDate(b.checkOut)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKES(b.totalAmount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{balance > 0 ? formatKES(balance) : "Paid"}</TableCell>
                          <TableCell><Badge variant={statusVariant[b.status]}>{titleCase(b.status)}</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {b.status === "confirmed" && (
                                <Button size="icon" variant="ghost" title="Check in" onClick={() => setBookingStatus.mutate({ id: b.id, status: "checked_in", roomId: b.roomId })} data-testid={`button-checkin-${b.id}`}>
                                  <LogIn className="h-4 w-4" />
                                </Button>
                              )}
                              {b.status === "checked_in" && (
                                <Button size="icon" variant="ghost" title="Check out" onClick={() => setBookingStatus.mutate({ id: b.id, status: "checked_out", roomId: b.roomId })} data-testid={`button-checkout-${b.id}`}>
                                  <LogOut className="h-4 w-4" />
                                </Button>
                              )}
                              <IdentityDocumentsDialog booking={b} trigger={
                                <Button size="icon" variant="ghost" title="Guest ID documents" data-testid={`button-manage-ids-${b.id}`}><IdCard className="h-4 w-4" /></Button>
                              } />
                              <BookingFormDialog booking={b} rooms={rooms} trigger={
                                <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-booking-${b.id}`}><Pencil className="h-4 w-4" /></Button>
                              } />
                              {b.totalAmount - (b.creditedAmount ?? 0) > 0 && (
                                <CreditNoteDialog
                                  endpoint={`/api/accommodation-bookings/${b.id}/credit-note`}
                                  invalidateKeys={[["/api/accommodation-bookings"], ["/api/documents"]]}
                                  maxAmount={b.totalAmount - (b.creditedAmount ?? 0)}
                                  recipientName={b.guestName}
                                  recipientPhone={b.guestPhone}
                                  trigger={
                                    <Button size="icon" variant="ghost" title="Issue credit note" data-testid={`button-credit-note-${b.id}`}><Undo2 className="h-4 w-4" /></Button>
                                  }
                                />
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-booking-${b.id}`}><Trash2 className="h-4 w-4" /></Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
                                    <AlertDialogDescription>This removes {b.guestName}'s booking permanently.</AlertDialogDescription>
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

        <TabsContent value="rooms" className="mt-4">
          <Card>
            <div className="flex items-center justify-between p-4 border-b border-card-border">
              <h2 className="text-lg font-semibold">Rooms</h2>
              <RoomFormDialog rooms={rooms} trigger={
                <Button size="sm" data-testid="button-new-room"><Plus className="h-4 w-4 mr-1" /> Add room</Button>
              } />
            </div>
            {roomsLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading rooms…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Room</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Rate / night</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRooms.map((r) => (
                      <TableRow key={r.id} data-testid={`row-room-${r.id}`}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>{titleCase(r.type)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKES(r.rate)}</TableCell>
                        <TableCell><Badge variant={statusVariant[r.status]}>{titleCase(r.status)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <RoomFormDialog room={r} rooms={rooms} trigger={
                              <Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-room-${r.id}`}><Pencil className="h-4 w-4" /></Button>
                            } />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-room-${r.id}`}><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove {r.name}?</AlertDialogTitle>
                                  <AlertDialogDescription>Existing bookings for this room will keep their history, but it will no longer appear as bookable.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteRoom.mutate(r.id)}>Remove</AlertDialogAction>
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
