import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MpesaPaste } from "@/components/public-booking-parts";
import { parseMpesaMessage } from "@shared/mpesa";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { ReviewDialog, type Row as OnlineRow } from "@/pages/online-bookings";

// Guest M-Pesa submissions still waiting for staff verification, keyed by booking ref.
export function usePendingOnlinePayments(enabled = true) {
  const { data = [] } = useQuery<OnlineRow[]>({ queryKey: ["/api/online-payments"], enabled, refetchInterval: 60000 });
  const map = new Map<string, OnlineRow>();
  for (const r of data) if (r.status === "pending" && r.targetRef && !map.has(r.targetRef)) map.set(r.targetRef, r);
  return map;
}

/** One-tap way to receive money for a booking or reservation — no edit form, no status field.
 * If the guest already pasted an M-Pesa message online, the button opens that submission for
 * verification instead, so the same payment can't be recorded twice. */
export function RecordPaymentButton({ endpoint, due, guestName, summary, invalidate, pending, testId, compact, extraBody }: {
  endpoint: string; extraBody?: Record<string, unknown>; due: number; guestName: string; summary: string; invalidate: string[][];
  pending?: OnlineRow | null; testId: string; compact?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(due)));
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [sms, setSms] = useState("");
  useEffect(() => { if (open) { setAmount(String(Math.round(due))); setMethod(""); setReference(""); setSms(""); } }, [open, due]);
  const amt = Number(amount);
  const valid = amt > 0 && amt <= due + 0.5 && !!method && (method !== "mpesa" || reference.trim().length > 0);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", endpoint, { ...extraBody, amount: amt, paymentMethod: method, paymentReference: reference.trim() || null })).json(),
    onSuccess: (r: any) => {
      for (const k of [...invalidate, ["/api/documents"], ["/api/director/summary"], ["/api/online-payments"]]) queryClient.invalidateQueries({ queryKey: k });
      toast({ title: "Payment recorded — receipt issued", description: r.balance > 0.5 ? `Balance still due: ${formatKES(r.balance)}` : "Paid in full." });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Couldn't record the payment", description: e?.message, variant: "destructive" }),
  });

  if (pending) {
    return (
      <>
        <Button size="sm" variant="outline" className={compact ? "h-8 px-2" : ""} onClick={() => setReview(true)} data-testid={`button-confirm-payment-${testId}`}>
          <ShieldCheck className="h-4 w-4 mr-1" /> Confirm payment
        </Button>
        {review && <ReviewDialog row={pending} onClose={() => setReview(false)} />}
      </>
    );
  }
  if (!(due > 0.5)) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={compact ? "h-8 px-2" : ""} data-testid={`button-record-payment-${testId}`}><Banknote className="h-4 w-4 mr-1" /> Record payment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <div className="rounded-md bg-muted p-3 text-sm space-y-0.5">
          <div className="font-medium">{guestName}</div>
          <div className="text-muted-foreground">{summary}</div>
          <div className="flex justify-between pt-1"><span className="text-muted-foreground">Balance due</span><span className="font-semibold tabular-nums" data-testid="text-record-payment-due">{formatKES(due)}</span></div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rp-amount">Amount received (KES)</Label>
            <Input id="rp-amount" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-record-payment-amount" />
            {amt > due + 0.5 && <p className="text-xs text-destructive">More than the balance due.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Payment method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-record-payment-method"><SelectValue placeholder="How did the guest pay?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="mpesa">M-Pesa</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {method === "mpesa" && <MpesaPaste staff value={sms} onChange={(v) => { const first = !sms; setSms(v); const p = parseMpesaMessage(v); if (p.code) setReference(p.code); if (p.amount && first) setAmount(String(Math.min(p.amount, Math.round(due)))); }} amountDue={amt || due} />}
          <div className="space-y-1.5">
            <Label htmlFor="rp-ref">{method === "mpesa" ? "M-Pesa code" : "Payment reference (optional)"}</Label>
            <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder={method === "mpesa" ? "e.g. SJR7AB12CD" : "Slip #, bank ref…"} data-testid="input-record-payment-reference" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()} data-testid="button-confirm-record-payment">{save.isPending ? "Saving…" : `Confirm payment${amt > 0 ? ` of ${formatKES(amt)}` : ""}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
