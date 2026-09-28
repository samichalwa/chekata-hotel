// Bar & Restaurant: let the guest pay an open bill by M-Pesa from their own phone.
// Staff share a secret link (#/pay/<token>); the guest pastes the M-Pesa SMS there, and the
// bill stays open until staff verify the payment under Online bookings.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link2, Copy, MessageCircle, Clock, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-auth";
import { formatKES, titleCase } from "@/lib/format";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { OnlinePayment, Order } from "@shared/schema";

/** The guest's M-Pesa payment for this bill that is waiting for staff, if any. */
export function usePendingBillPayment(orderId: number) {
  const { data = [] } = useQuery<OnlinePayment[]>({ queryKey: ["/api/online-payments"], refetchInterval: 30000 });
  return data.find((p) => p.kind === "bill" && p.targetRef === `ORD-${orderId}` && p.status === "pending") ?? null;
}

export function BillPayLink({ order, phone, name }: { order: Order; phone: string; name: string }) {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const [url, setUrl] = useState<string | null>(order.payToken ? `${window.location.origin}/#/pay/${order.payToken}` : null);
  const pending = usePendingBillPayment(order.id);
  const make = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/orders/${order.id}/pay-link`)).json() as Promise<{ token: string; path: string }>,
    onSuccess: (r) => setUrl(`${window.location.origin}${r.path}`),
    onError: (e: any) => toast({ title: "Couldn't create the link", description: e?.message, variant: "destructive" }),
  });
  const waText = url
    ? `Hi ${name || "there"}, here is your ${titleCase(order.outlet)} bill at The Chekata${order.reference ? ` (${order.reference})` : ""}: ${formatKES(order.totalAmount)}.\n\nView the bill and pay by M-Pesa, then paste your M-Pesa SMS here:\n${url}`
    : "";
  const wa = url ? buildWhatsAppLink(phone, waText, currentUser?.environment) : null;

  if (pending) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="box-bill-pending-payment">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">Guest paid by M-Pesa — waiting for verification</p>
          <p className="text-muted-foreground">{pending.guestName} · M-Pesa <span className="font-medium text-foreground tabular-nums">{pending.mpesaCode}</span> · {formatKES(pending.amount)}</p>
          <Link href="/online-bookings" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" data-testid="link-verify-bill-payment"><ExternalLink className="h-3.5 w-3.5" /> Verify in Online bookings</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="box-bill-pay-link">
      <div>
        <p className="text-sm font-medium">Guest pays by M-Pesa on their phone</p>
        <p className="text-xs text-muted-foreground">Send the guest a link to this bill. They pay by M-Pesa and paste the SMS; you then verify it in Online bookings, which closes the bill and issues the receipt.</p>
      </div>
      {!url ? (
        <Button type="button" variant="outline" size="sm" onClick={() => make.mutate()} disabled={make.isPending || order.totalAmount <= 0} data-testid="button-create-pay-link">
          <Link2 className="h-4 w-4 mr-1.5" /> {make.isPending ? "Creating…" : "Create payment link"}
        </Button>
      ) : (
        <div className="space-y-2">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="input-pay-link" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(url); toast({ title: "Link copied" }); }} data-testid="button-copy-pay-link"><Copy className="h-4 w-4 mr-1.5" /> Copy</Button>
            <Button type="button" variant="outline" size="sm" disabled={!wa} onClick={() => wa && window.open(wa, "_blank")} data-testid="button-whatsapp-pay-link"><MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp</Button>
          </div>
          {!wa && <p className="text-xs text-muted-foreground">Add the guest's phone above to send it by WhatsApp.</p>}
        </div>
      )}
      {order.totalAmount <= 0 && <p className="text-xs text-muted-foreground">Add items first.</p>}
    </div>
  );
}
