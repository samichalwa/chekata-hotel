// Settings > Online booking: public booking page (#/book) and M-Pesa payment details.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, Copy, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Settings } from "@shared/schema";

export function OnlineBookingSettingsTab() {
  const { toast } = useToast();
  const { data } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const [f, setF] = useState({
    room: true, roomPct: "100", roomNights: "30", roomAdvance: "365", roomIn: "14:00", roomOut: "10:00",
    movie: true, table: true, type: "till", number: "", account: "", business: "", maxAge: "24",
    deposit: "1000", maxParty: "12", open: "07:00", close: "22:00", maxSeats: "6", note: "",
  });
  useEffect(() => {
    if (!data) return;
    setF({
      room: data.publicRoomBookingEnabled !== 0, roomPct: String(data.publicRoomPayPercent ?? 100), roomNights: String(data.publicRoomMaxNights ?? 30),
      roomAdvance: String(data.publicRoomAdvanceDays ?? 365), roomIn: data.publicRoomCheckInTime || "14:00", roomOut: data.publicRoomCheckOutTime || "10:00",
      movie: data.publicMovieBookingEnabled !== 0, table: data.publicTableBookingEnabled !== 0,
      type: data.mpesaPaymentType || "till", number: data.mpesaNumber ?? "", account: data.mpesaAccountNumber ?? "",
      business: data.mpesaBusinessName ?? "", maxAge: String(data.mpesaMessageMaxAgeHours ?? 24),
      deposit: String(data.publicTableDeposit ?? 1000), maxParty: String(data.publicTableMaxParty ?? 12),
      open: data.publicTableOpenTime || "07:00", close: data.publicTableCloseTime || "22:00",
      maxSeats: String(data.publicMovieMaxSeats ?? 6), note: data.publicBookingNote ?? "",
    });
  }, [data]);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : d);
  const invalid = f.open >= f.close || num(f.maxSeats, 0) < 1 || num(f.maxParty, 0) < 1 || num(f.deposit, -1) < 0 || num(f.maxAge, 0) < 1
    || num(f.roomPct, 0) < 10 || num(f.roomPct, 0) > 100 || num(f.roomNights, 0) < 1 || num(f.roomAdvance, 0) < 1 || !f.roomIn || !f.roomOut;

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/settings", {
      publicRoomBookingEnabled: f.room ? 1 : 0, publicRoomPayPercent: num(f.roomPct, 100), publicRoomMaxNights: Math.round(num(f.roomNights, 30)),
      publicRoomAdvanceDays: Math.round(num(f.roomAdvance, 365)), publicRoomCheckInTime: f.roomIn, publicRoomCheckOutTime: f.roomOut,
      publicMovieBookingEnabled: f.movie ? 1 : 0, publicTableBookingEnabled: f.table ? 1 : 0,
      mpesaPaymentType: f.type, mpesaNumber: f.number.trim() || null, mpesaAccountNumber: f.account.trim() || null,
      mpesaBusinessName: f.business.trim() || null, mpesaMessageMaxAgeHours: Math.round(num(f.maxAge, 24)),
      publicTableDeposit: num(f.deposit, 0), publicTableMaxParty: Math.round(num(f.maxParty, 12)),
      publicTableOpenTime: f.open, publicTableCloseTime: f.close, publicMovieMaxSeats: Math.round(num(f.maxSeats, 6)),
      publicBookingNote: f.note.trim() || null,
    })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); toast({ title: "Online booking settings saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const url = `${window.location.origin}/#/book`;

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-4 space-y-2">
        <h3 className="font-semibold">Public booking link</h3>
        <p className="text-sm text-muted-foreground">Share this link (website, WhatsApp, QR code). Guests can book rooms, view scheduled shows, pick movie seats and reserve tables. Nothing is held until they paste a valid M-Pesa message; your office then verifies it under Online bookings.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input readOnly value={url} data-testid="input-public-booking-url" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(url); toast({ title: "Link copied" }); }}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
            <Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open</a></Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold">What guests can book</h3>
        <div className="flex items-center justify-between gap-4"><div><Label>Rooms (accommodation)</Label><p className="text-xs text-muted-foreground">Guests pick dates and a room type; the first free room of that type is held and shows in Accommodation as Pending payment.</p></div><Switch checked={f.room} onCheckedChange={(v) => set("room", v)} data-testid="switch-public-room" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="ob-room-pct">Pay online to hold a room (% of stay, 10–100)</Label><Input id="ob-room-pct" type="number" min={10} max={100} value={f.roomPct} onChange={(e) => set("roomPct", e.target.value)} data-testid="input-public-room-pct" /></div>
          <div className="space-y-1.5"><Label htmlFor="ob-room-nights">Max nights per online booking</Label><Input id="ob-room-nights" type="number" min={1} value={f.roomNights} onChange={(e) => set("roomNights", e.target.value)} data-testid="input-public-room-nights" /></div>
          <div className="space-y-1.5"><Label htmlFor="ob-room-adv">Book up to (days ahead)</Label><Input id="ob-room-adv" type="number" min={1} value={f.roomAdvance} onChange={(e) => set("roomAdvance", e.target.value)} data-testid="input-public-room-advance" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label htmlFor="ob-room-in">Check-in from</Label><Input id="ob-room-in" type="time" value={f.roomIn} onChange={(e) => set("roomIn", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ob-room-out">Check-out by</Label><Input id="ob-room-out" type="time" value={f.roomOut} onChange={(e) => set("roomOut", e.target.value)} /></div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4"><div><Label>Movie room seats</Label><p className="text-xs text-muted-foreground">When off, shows stay visible but seats can't be booked online.</p></div><Switch checked={f.movie} onCheckedChange={(v) => set("movie", v)} data-testid="switch-public-movie" /></div>
        <div className="flex items-center justify-between gap-4"><div><Label>Restaurant &amp; bar tables</Label></div><Switch checked={f.table} onCheckedChange={(v) => set("table", v)} data-testid="switch-public-table" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="ob-seats">Max movie seats per booking</Label><Input id="ob-seats" type="number" min={1} value={f.maxSeats} onChange={(e) => set("maxSeats", e.target.value)} data-testid="input-public-max-seats" /></div>
          <div className="space-y-1.5"><Label htmlFor="ob-deposit">Table deposit (KES, 0 = none)</Label><Input id="ob-deposit" type="number" min={0} value={f.deposit} onChange={(e) => set("deposit", e.target.value)} data-testid="input-public-deposit" /></div>
          <div className="space-y-1.5"><Label htmlFor="ob-party">Max party size online</Label><Input id="ob-party" type="number" min={1} value={f.maxParty} onChange={(e) => set("maxParty", e.target.value)} data-testid="input-public-max-party" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label htmlFor="ob-open">Opens</Label><Input id="ob-open" type="time" value={f.open} onChange={(e) => set("open", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ob-close">Last booking</Label><Input id="ob-close" type="time" value={f.close} onChange={(e) => set("close", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ob-note">Note shown on the booking page (optional)</Label><Textarea id="ob-note" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} data-testid="input-public-note" /></div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold">M-Pesa payment details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Payment type</Label>
            <Select value={f.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger data-testid="select-mpesa-type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="till">Buy Goods (Till)</SelectItem><SelectItem value="paybill">Paybill</SelectItem><SelectItem value="phone">Send Money (phone)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="ob-num">{f.type === "paybill" ? "Business number" : f.type === "till" ? "Till number" : "Phone number"}</Label><Input id="ob-num" value={f.number} onChange={(e) => set("number", e.target.value)} data-testid="input-mpesa-number" /></div>
          {f.type === "paybill" && <div className="space-y-1.5"><Label htmlFor="ob-acc">Account number</Label><Input id="ob-acc" value={f.account} onChange={(e) => set("account", e.target.value)} data-testid="input-mpesa-account" /></div>}
          <div className="space-y-1.5"><Label htmlFor="ob-biz">Name on M-Pesa message</Label><Input id="ob-biz" value={f.business} onChange={(e) => set("business", e.target.value)} placeholder={data?.hotelName ?? ""} data-testid="input-mpesa-business" /></div>
          <div className="space-y-1.5"><Label htmlFor="ob-age">Reject messages older than (hours)</Label><Input id="ob-age" type="number" min={1} value={f.maxAge} onChange={(e) => set("maxAge", e.target.value)} data-testid="input-mpesa-max-age" /></div>
        </div>
        <p className="text-xs text-muted-foreground">Every M-Pesa code and payment reference can be used only once across the whole system.</p>
        {!f.number.trim() && <p className="text-sm text-destructive">Add the M-Pesa number, otherwise guests can't pay online.</p>}
      </Card>
      <Button onClick={() => save.mutate()} disabled={save.isPending || invalid} data-testid="button-save-online-booking"><Save className="h-4 w-4 mr-1" /> Save</Button>
      {invalid && <p className="text-sm text-destructive">Check the numbers (room payment must be 10–100%) and make sure opening time is before the last booking time.</p>}
    </div>
  );
}
