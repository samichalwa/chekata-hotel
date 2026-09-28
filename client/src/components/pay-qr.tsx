// Permanent "scan to pay your bill" QR codes — shared by Lists → Tables and the Bar & Restaurant page.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { QrCode as QrIcon, Printer as PrinterIcon, Copy as CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog as QrDialog, DialogContent as QrDialogContent, DialogHeader as QrDialogHeader, DialogTitle as QrDialogTitle, DialogDescription as QrDialogDescription } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QrCode, printQrCard } from "@/components/qr-code";
import type { TableRow as TableEntity } from "@shared/schema";

// Permanent "scan to pay your bill" QR codes: one per table, plus one counter QR each for the bar
// and the restaurant (patrons not seated at a table). Print once; the code never changes.
export function PayQrButton({ endpoint, name, buttonLabel, description, cardSubtitle, testId }: { endpoint: string; name: string; buttonLabel: string; description: string; cardSubtitle: string; testId: string }) {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = async () => {
    setOpen(true);
    if (url) return;
    try {
      const r = await (await apiRequest("POST", endpoint)).json();
      setUrl(`${window.location.origin}${r.path}`);
    } catch (e: any) { toast({ title: "Couldn't create the QR code", description: e?.message, variant: "destructive" }); setOpen(false); }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={load} data-testid={testId}><QrIcon className="h-4 w-4 mr-1" /> {buttonLabel}</Button>
      <QrDialog open={open} onOpenChange={setOpen}>
        <QrDialogContent className="max-w-sm">
          <QrDialogHeader>
            <QrDialogTitle>{name} — scan to pay</QrDialogTitle>
            <QrDialogDescription>{description} Staff then confirm the payment in Online bookings & payments. The code stays the same, so print it once.</QrDialogDescription>
          </QrDialogHeader>
          {url ? (
            <div className="flex flex-col items-center gap-3">
              <QrCode text={url} size={220} testId="img-pay-qr" />
              <p className="text-xs text-muted-foreground break-all text-center">{url}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(url); toast({ title: "Link copied" }); }}><CopyIcon className="h-4 w-4 mr-1" /> Copy</Button>
                <Button size="sm" onClick={() => printQrCard({ title: name, subtitle: cardSubtitle, url, footer: "Scan, pay by M-Pesa, then paste your M-Pesa SMS on the page. Our staff confirm your payment." }) || toast({ title: "Allow pop-ups to print", variant: "destructive" })} data-testid="button-print-pay-qr"><PrinterIcon className="h-4 w-4 mr-1" /> Print card</Button>
              </div>
            </div>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">Creating QR code…</p>}
        </QrDialogContent>
      </QrDialog>
    </>
  );
}

export function TableQrButton({ table }: { table: TableEntity }) {
  return <PayQrButton endpoint={`/api/tables/${table.id}/pay-qr`} name={table.name} buttonLabel="Pay QR" testId={`button-table-qr-${table.id}`}
    cardSubtitle="Scan to view and pay your bill"
    description={`Print this and place it on the table. Patrons scan it to see the open bill for ${table.name}, pay by M-Pesa and paste the SMS.`} />;
}

export function CounterQrButtons() {
  return (
    <>
            <PayQrButton endpoint="/api/outlets/bar/pay-qr" name="Bar" buttonLabel="Bar QR" testId="button-bar-counter-qr" cardSubtitle="Not at a table? Scan to find and pay your bar bill"
              description="Place this at the bar counter. Patrons not seated at a table scan it, pick their open bar bill from today's list (shown by items and time), pay by M-Pesa and paste the SMS." />
            <PayQrButton endpoint="/api/outlets/restaurant/pay-qr" name="Restaurant" buttonLabel="Restaurant QR" testId="button-restaurant-counter-qr" cardSubtitle="Not at a table? Scan to find and pay your restaurant bill"
              description="Place this at the restaurant counter or till. Patrons not seated at a table scan it, pick their open restaurant bill from today's list (shown by items and time), pay by M-Pesa and paste the SMS." />
    </>
  );
}

// Bar & Restaurant page: one place to open and print every pay QR code.
export function PayQrCodesDialog() {
  const [open, setOpen] = useState(false);
  const { data: tables = [], isLoading } = useQuery<TableEntity[]>({ queryKey: ["/api/tables"], enabled: open });
  const active = tables.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-pay-qr-codes"><QrIcon className="h-4 w-4 mr-1.5" /> Pay QR codes</Button>
      <QrDialog open={open} onOpenChange={setOpen}>
        <QrDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <QrDialogHeader>
            <QrDialogTitle>Pay QR codes</QrDialogTitle>
            <QrDialogDescription>Print each code once. Patrons scan it, pick their bill, pay by M-Pesa and paste the SMS; staff confirm the payment in Online bookings & payments.</QrDialogDescription>
          </QrDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Counter (patrons not at a table)</p>
              <div className="flex flex-wrap gap-2"><CounterQrButtons /></div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Tables</p>
              {isLoading ? <p className="text-sm text-muted-foreground">Loading tables…</p> : !active.length ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-tables-for-qr">No tables yet. Add your tables under <Link href="/lists" className="text-primary underline-offset-2 hover:underline" onClick={() => setOpen(false)}>Lists → Tables</Link>, then come back here to print their QR cards.</p>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border">
                  {active.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 p-2.5" data-testid={`row-pay-qr-table-${t.id}`}>
                      <span className="text-sm">{t.name}<span className="text-muted-foreground">{t.outlet === "both" ? "" : ` · ${t.outlet === "bar" ? "Bar" : "Restaurant"}`}</span></span>
                      <TableQrButton table={t} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </QrDialogContent>
      </QrDialog>
    </>
  );
}
