// Online bookings & payments — a shortcut view (NOT a module). Staff verify the M-Pesa messages guests
// pasted on the public page (#/book) and manage table reservations. Movie payments need the
// movie-room module, table payments / reservations need bar-restaurant, room payments need accommodation
// (enforced server-side).
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BedDouble, Check, X, Clapperboard, UtensilsCrossed, Receipt, ExternalLink, Copy, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { OnlinePayment, TableReservation, TableRow as TableEntity } from "@shared/schema";
import { parseMpesaMessage } from "@shared/mpesa";
import { PageHeader } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { useCurrentUser, canAccess } from "@/hooks/use-auth";

export type Row = OnlinePayment & { recipientOk: boolean; amountOk: boolean };
const RES_LABEL: Record<string, string> = { confirmed: "Confirmed", seated: "Seated", completed: "Completed", no_show: "No-show", cancelled: "Cancelled" };
const when = (ms: number | null) => ms ? new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export function ReviewDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const { toast } = useToast();
  const [office, setOffice] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"verify" | "reject">("verify");
  const o = useMemo(() => parseMpesaMessage(office), [office]);
  const officeMatch = office.trim() ? (o.code === row.mpesaCode && o.amount != null && Math.abs(o.amount - row.amount) < 0.5) : null;
  const act = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/online-payments/${row.id}/${mode}`, mode === "verify" ? { note: office.trim() ? `Matched office M-Pesa message ${o.code ?? ""}`.trim() : undefined } : { reason })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/online-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/online-payments/pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/table-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movie-seat-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accommodation-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/director/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: mode === "verify" ? (row.kind === "bill" ? "Payment verified — bill closed and receipt issued" : "Payment verified — booking confirmed") : (row.kind === "bill" ? "Payment rejected — the bill stays open" : "Payment rejected — booking released") });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verify M-Pesa {row.mpesaCode}</DialogTitle>
          <DialogDescription>{row.guestName} · {row.guestPhone} — {row.summary}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">Amount paid</span><span className={`text-right tabular-nums font-medium ${row.amountOk ? "" : "text-destructive"}`}>{formatKES(row.amount)}</span>
          <span className="text-muted-foreground">Amount due</span><span className="text-right tabular-nums">{formatKES(row.amountDue)}</span>
          <span className="text-muted-foreground">Paid to</span><span className={`text-right ${row.recipientOk ? "" : "text-destructive"}`}>{row.recipient ?? "—"}</span>
          <span className="text-muted-foreground">M-Pesa time</span><span className="text-right tabular-nums">{when(row.paidAt)}</span>
          <span className="text-muted-foreground">Submitted</span><span className="text-right tabular-nums">{when(row.createdAt)}</span>
        </div>
        {!row.recipientOk && <p className="text-sm text-destructive flex gap-1"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> The recipient doesn't match the M-Pesa business name in Settings. Check carefully.</p>}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Guest's pasted message</Label>
          <p className="rounded-md border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-words">{row.rawMessage}</p>
        </div>
        <div className="flex gap-2">
          <Button variant={mode === "verify" ? "default" : "outline"} size="sm" onClick={() => setMode("verify")} data-testid="button-mode-verify"><Check className="h-4 w-4 mr-1" /> Verify</Button>
          <Button variant={mode === "reject" ? "destructive" : "outline"} size="sm" onClick={() => setMode("reject")} data-testid="button-mode-reject"><X className="h-4 w-4 mr-1" /> Reject</Button>
        </div>
        {mode === "verify" ? (
          <div className="space-y-2">
            <Label htmlFor="office-msg">Paste the office's M-Pesa "received" message to cross-check (recommended)</Label>
            <Textarea id="office-msg" rows={3} value={office} onChange={(e) => setOffice(e.target.value)} placeholder="SJR7AB12CD Confirmed. You have received Ksh1,000.00 from …" data-testid="input-office-mpesa" />
            {officeMatch === true && <p className="text-sm text-primary flex gap-1" data-testid="text-office-match"><CheckCircle2 className="h-4 w-4 mt-0.5" /> Code and amount match the office message.</p>}
            {officeMatch === false && <p className="text-sm text-destructive flex gap-1" data-testid="text-office-mismatch"><AlertTriangle className="h-4 w-4 mt-0.5" /> Office message shows {o.code ?? "no code"} / {o.amount != null ? formatKES(o.amount) : "no amount"}. It does not match.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (sent to the guest by SMS)</Label>
            <Textarea id="reject-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No matching payment received" data-testid="input-reject-reason" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant={mode === "reject" ? "destructive" : "default"} disabled={act.isPending || (mode === "reject" && !reason.trim()) || officeMatch === false} onClick={() => act.mutate()} data-testid="button-confirm-review">
            {mode === "verify" ? (row.kind === "bill" ? "Confirm payment and close bill" : "Confirm payment received") : (row.kind === "bill" ? "Reject payment" : "Reject and release")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function statusBadge(s: string) {
  if (s === "verified" || s === "confirmed" || s === "completed" || s === "seated") return <Badge variant="default">{s === "verified" ? "Verified" : RES_LABEL[s] ?? s}</Badge>;
  if (s === "rejected" || s === "cancelled" || s === "no_show") return <Badge variant="destructive">{s === "rejected" ? "Rejected" : RES_LABEL[s] ?? s}</Badge>;
  return <Badge variant="secondary">{s === "pending" || s === "awaiting_verification" ? "Awaiting verification" : s}</Badge>;
}

function PaymentsList({ rows, onReview }: { rows: Row[]; onReview: (r: Row) => void }) {
  if (!rows.length) return <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-online-payments">Nothing here.</Card>;
  return (
    <Card>
      <Table>
        <TableHeader><TableRow><TableHead>Guest</TableHead><TableHead>Booking</TableHead><TableHead>M-Pesa</TableHead><TableHead className="text-right">Paid / due</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`row-online-payment-${r.id}`}>
              <TableCell><div><div className="font-medium">{r.guestName}</div><div className="text-xs text-muted-foreground">{r.guestPhone}</div></div></TableCell>
              <TableCell><div><div className="flex items-center gap-1.5">{r.kind === "movie" ? <Clapperboard className="h-4 w-4 shrink-0 text-muted-foreground" /> : r.kind === "room" ? <BedDouble className="h-4 w-4 shrink-0 text-muted-foreground" /> : r.kind === "bill" ? <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" /> : <UtensilsCrossed className="h-4 w-4 shrink-0 text-muted-foreground" />}<span>{r.summary}</span></div><div className="text-xs text-muted-foreground">{r.targetRef}</div></div></TableCell>
              <TableCell><div><div className="font-medium tabular-nums">{r.mpesaCode}</div><div className="text-xs text-muted-foreground">{when(r.paidAt)}</div></div></TableCell>
              <TableCell className="text-right tabular-nums"><div><div className={r.amountOk ? "" : "text-destructive"}>{formatKES(r.amount)}</div><div className="text-xs text-muted-foreground">of {formatKES(r.amountDue)}</div></div></TableCell>
              <TableCell><div>{statusBadge(r.status)}{r.reviewedBy && <div className="text-xs text-muted-foreground">{r.reviewedBy}</div>}</div></TableCell>
              <TableCell>{r.status === "pending" ? <Button size="sm" onClick={() => onReview(r)} data-testid={`button-review-${r.id}`}>Review</Button> : <span className="text-xs text-muted-foreground">{r.reviewNote ?? ""}</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ReservationsList({ pendingByRef, onReview }: { pendingByRef: Map<string, Row>; onReview: (r: Row) => void }) {
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useQuery<TableReservation[]>({ queryKey: ["/api/table-reservations"] });
  const { data: tables = [] } = useQuery<TableEntity[]>({ queryKey: ["/api/tables"] });
  const [scope, setScope] = useState<"upcoming" | "all">("upcoming");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
  const shown = rows.filter((r) => scope === "all" || (r.reservationDate >= today && !["cancelled", "completed", "no_show"].includes(r.status)))
    .sort((a, b) => scope === "all" ? (b.reservationDate + b.reservationTime).localeCompare(a.reservationDate + a.reservationTime) : (a.reservationDate + a.reservationTime).localeCompare(b.reservationDate + b.reservationTime));
  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) => (await apiRequest("PATCH", `/api/table-reservations/${id}`, body)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/table-reservations"] }); queryClient.invalidateQueries({ queryKey: ["/api/online-payments"] }); },
    onError: (e: any) => toast({ title: "Couldn't update", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant={scope === "upcoming" ? "default" : "outline"} onClick={() => setScope("upcoming")}>Upcoming</Button>
        <Button size="sm" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>All</Button>
      </div>
      {isLoading ? <Skeleton className="h-40 w-full" /> : !shown.length ? <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-reservations">No table reservations.</Card> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Guest</TableHead><TableHead>When</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Deposit</TableHead><TableHead>Table</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {shown.map((r) => {
                const opts = tables.filter((t) => t.active && (t.outlet === "both" || t.outlet === r.outlet));
                return (
                  <TableRow key={r.id} data-testid={`row-reservation-${r.id}`}>
                    <TableCell><div><div className="font-medium">{r.guestName}</div><div className="text-xs text-muted-foreground">{r.guestPhone} · {r.reservationRef}</div>{r.notes && <div className="text-xs text-muted-foreground">{r.notes}</div>}</div></TableCell>
                    <TableCell className="tabular-nums"><div><div>{r.reservationDate}</div><div className="text-xs text-muted-foreground capitalize">{r.reservationTime} · {r.outlet}</div></div></TableCell>
                    <TableCell className="tabular-nums">{r.partySize}</TableCell>
                    <TableCell className="text-right tabular-nums"><div><div>{formatKES(r.depositPaid)}</div><div className="text-xs text-muted-foreground">{r.paymentReference ?? ""}</div></div></TableCell>
                    <TableCell>
                      <Select value={r.tableId ? String(r.tableId) : "none"} onValueChange={(v) => patch.mutate({ id: r.id, body: { tableId: v === "none" ? null : Number(v) } })}>
                        <SelectTrigger className="h-8 w-32" aria-label="Assign table" data-testid={`select-table-${r.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="none">Not assigned</SelectItem>{opts.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}{t.capacity ? ` (${t.capacity})` : ""}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {r.status === "awaiting_verification" && pendingByRef.get(r.reservationRef) ? (
                        <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => onReview(pendingByRef.get(r.reservationRef)!)} data-testid={`button-confirm-deposit-${r.id}`}><Check className="h-4 w-4 mr-1" /> Confirm deposit</Button>
                      ) : r.status === "awaiting_verification" || (r.status === "cancelled" && r.depositAmount > 0 && r.depositPaid + 0.5 < r.depositAmount) ? statusBadge(r.status) : (
                        <Select value={r.status} onValueChange={(v) => patch.mutate({ id: r.id, body: { status: v } })}>
                          <SelectTrigger className="h-8 w-36" aria-label="Reservation status" data-testid={`select-reservation-status-${r.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(RES_LABEL).map(([s, l]) => <SelectItem key={s} value={s}>{l}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export default function OnlineBookingsPage() {
  const { toast } = useToast();
  const { data: user } = useCurrentUser();
  const canTables = canAccess(user, "bar-restaurant");
  const { data: rows = [], isLoading } = useQuery<Row[]>({ queryKey: ["/api/online-payments"], refetchInterval: 30000 });
  const [review, setReview] = useState<Row | null>(null);
  const pending = rows.filter((r) => r.status === "pending");
  const publicUrl = `${window.location.origin}/#/book`;
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title="Online bookings & payments" description="Verify M-Pesa payments pasted by guests for rooms, movie seats, tables and bar & restaurant bills, and manage table reservations." />
      <Card className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm"><span className="text-muted-foreground">Public booking link: </span><span className="font-medium break-all" data-testid="text-public-link">{publicUrl}</span></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(publicUrl); toast({ title: "Link copied" }); }} data-testid="button-copy-public-link"><Copy className="h-4 w-4 mr-1" /> Copy</Button>
          <Button size="sm" variant="outline" asChild><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open</a></Button>
        </div>
      </Card>
      <Tabs defaultValue="verify">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="verify" data-testid="tab-verify">To verify{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
          {canTables && <TabsTrigger value="reservations" data-testid="tab-reservations">Table reservations</TabsTrigger>}
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="verify" className="mt-4">{isLoading ? <Skeleton className="h-40 w-full" /> : <PaymentsList rows={pending} onReview={setReview} />}</TabsContent>
        {canTables && <TabsContent value="reservations" className="mt-4"><ReservationsList pendingByRef={new Map(pending.filter((p) => p.kind === "table").map((p) => [p.targetRef, p]))} onReview={setReview} /></TabsContent>}
        <TabsContent value="history" className="mt-4">{isLoading ? <Skeleton className="h-40 w-full" /> : <PaymentsList rows={rows.filter((r) => r.status !== "pending")} onReview={setReview} />}</TabsContent>
      </Tabs>
      {review && <ReviewDialog row={review} onClose={() => setReview(null)} />}
    </div>
  );
}
