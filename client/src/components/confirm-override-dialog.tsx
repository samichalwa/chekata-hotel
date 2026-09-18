// Shared "Confirm without payment" dialog used on Accommodation and Facilities
// booking rows. Gated purely by canConfirmBookingWithoutPayment (or isAdmin) on
// the server — the button is still shown to everyone so a user without the
// right sees the same clear rejection message rather than a mysteriously
// missing action; the server is the actual gate.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

interface ConfirmOverrideDialogProps {
  /** e.g. `/api/accommodation-bookings/42/confirm-override` */
  endpoint: string;
  /** Query keys to invalidate on success, e.g. [["/api/accommodation-bookings"]] */
  invalidateKeys: string[][];
  recipientName: string;
  trigger: React.ReactNode;
  /** Dialog title. Defaults to "Confirm without payment". */
  title?: string;
  /** Description shown above the reason field. `{recipientName}` is interpolated in. */
  description?: string;
  /** Placeholder text for the reason textarea. */
  placeholder?: string;
  /** Label on the submit button. */
  actionLabel?: string;
  /** Label on the submit button while the request is pending. */
  pendingLabel?: string;
  /** Toast title shown on success. */
  successTitle?: string;
  /** Toast description shown on success. */
  successDescription?: string;
  /** Toast title shown on failure. */
  errorTitle?: string;
  /** Extra side effect to run after the override succeeds (e.g. updating a related record). Receives the server response. */
  onOverrideSuccess?: (result: any) => void;
}

export function ConfirmOverrideDialog({
  endpoint,
  invalidateKeys,
  recipientName,
  trigger,
  title = "Confirm without payment",
  description,
  placeholder = "e.g. Repeat corporate client, payment to follow on invoice terms",
  actionLabel = "Confirm without payment",
  pendingLabel = "Confirming...",
  successTitle = "Booking confirmed without payment",
  successDescription = "This override has been recorded against your name.",
  errorTitle = "Could not confirm booking",
  onOverrideSuccess,
}: ConfirmOverrideDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", endpoint, { reason });
      return res.json();
    },
    onSuccess: (result) => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast({ title: successTitle, description: successDescription });
      setOpen(false);
      setReason("");
      onOverrideSuccess?.(result);
    },
    onError: (err: Error) => toast({ title: errorTitle, description: extractErrorMessage(err.message), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setReason(""); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? `Director's-discretion override: confirms ${recipientName}'s booking even though no payment has been recorded yet. This action and your reason are logged against the booking.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="override-reason">Reason</Label>
          <Textarea
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            data-testid="input-override-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !reason.trim()}
            data-testid="button-confirm-override"
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" /> {mutation.isPending ? pendingLabel : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
