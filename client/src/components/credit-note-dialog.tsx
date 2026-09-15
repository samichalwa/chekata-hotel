// Shared "Issue Credit Note" dialog used on Accommodation, Facilities, Movie Room,
// and Bar & Restaurant record rows. Credit notes are always tied to an existing
// invoice/receipt (they reduce that document's outstanding balance) — never
// standalone. Each module's own POST /credit-note route enforces this (returns a
// 400 if no billing document exists yet for the record) and is gated purely by
// that record's existing operational module permission (requireModule), matching
// the confirmed design: no separate "Credit Notes" permission checkbox anywhere.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Undo2, MessageCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES } from "@/lib/format";
import { buildWhatsAppLink, buildDocumentPdfUrl } from "@/lib/whatsapp";

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

interface IssuedCreditNote {
  id: number;
  publicToken: string;
  status: string;
  errorMessage?: string | null;
}

interface CreditNoteDialogProps {
  /** e.g. `/api/accommodation-bookings/42/credit-note` */
  endpoint: string;
  /** Query keys to invalidate on success, e.g. [["/api/accommodation-bookings"], ["/api/documents"]] */
  invalidateKeys: string[][];
  /** Remaining creditable balance (totalAmount/ticketPrice minus amountPaid credits already issued) — used to cap and pre-fill the amount field. */
  maxAmount: number;
  recipientName: string;
  recipientPhone?: string | null;
  trigger: React.ReactNode;
}

export function CreditNoteDialog({ endpoint, invalidateKeys, maxAmount, recipientName, recipientPhone, trigger }: CreditNoteDialogProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState("");
  const [issued, setIssued] = useState<IssuedCreditNote | null>(null);
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", endpoint, { amount: Number(amount), reason: reason || undefined });
      return res.json();
    },
    onSuccess: (data: IssuedCreditNote) => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast({ title: "Credit note issued" });
      if (data?.status === "sent") {
        toast({ title: "Credit note emailed", description: "Sent to the customer's email address." });
      } else if (data?.status === "failed") {
        toast({ title: "Email not sent", description: data.errorMessage ?? "Check your Settings.", variant: "destructive" });
      }
      setIssued(data);
    },
    onError: (err: Error) => toast({ title: "Could not issue credit note", description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  const reset = () => {
    setAmount("");
    setReason("");
    setIssued(null);
  };

  const pdfUrl = issued ? buildDocumentPdfUrl(issued.id, issued.publicToken) : null;
  const whatsappLink = pdfUrl
    ? buildWhatsAppLink(
        recipientPhone,
        `Hi ${recipientName}, a credit note has been issued for your account at The Chekata. View/download it here: ${pdfUrl}`,
        currentUser?.environment,
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" /> Credit note issued</DialogTitle>
              <DialogDescription>The record's balance has been reduced. Send the credit note PDF to {recipientName} via WhatsApp, if needed.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={!whatsappLink}
                onClick={() => { if (whatsappLink) window.open(whatsappLink, "_blank"); }}
                data-testid="button-send-whatsapp-credit-note"
              >
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
              <Button onClick={() => setOpen(false)} data-testid="button-close-credit-note">Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Issue credit note</DialogTitle>
              <DialogDescription>
                Reduces {recipientName}'s outstanding balance on the invoice/receipt already issued for this record. Remaining creditable balance: {formatKES(Math.max(0, maxAmount))}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="credit-note-amount">Amount (KES)</Label>
                <Input
                  id="credit-note-amount"
                  type="number"
                  min={0}
                  max={Math.max(0, maxAmount)}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(Math.max(0, maxAmount))}
                  data-testid="input-credit-note-amount"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit-note-reason">Reason (optional)</Label>
                <Textarea
                  id="credit-note-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Service issue, overcharge correction, goodwill adjustment"
                  data-testid="input-credit-note-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !amount || Number(amount) <= 0}
                data-testid="button-confirm-credit-note"
              >
                <Undo2 className="h-4 w-4 mr-1.5" /> {mutation.isPending ? "Issuing..." : "Issue credit note"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
