import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, RotateCw, FileText, Mail, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES, titleCase } from "@/lib/format";
import type { DocumentRecord } from "@shared/schema";

const statusConfig: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: any; label: string }> = {
  sent: { variant: "default", icon: CheckCircle2, label: "Sent" },
  failed: { variant: "destructive", icon: XCircle, label: "Failed" },
  skipped: { variant: "outline", icon: MinusCircle, label: "Skipped" },
};

const categoryLabel: Record<string, string> = {
  accommodation: "Accommodation",
  facility: "Conference / Movie room",
  bar: "Bar",
  restaurant: "Restaurant",
  movie: "Movie Room (Seat)",
};

function formatDateTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ResendDialog({ doc, trigger }: { doc: DocumentRecord; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(doc.recipientEmail ?? "");
  const { toast } = useToast();

  const resend = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/documents/${doc.id}/resend`, email ? { email } : {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      const status = data?.status;
      if (status === "sent") toast({ title: "Resent", description: "The document was emailed successfully." });
      else if (status === "failed") toast({ title: "Email not sent", description: data?.errorMessage ?? "Check your Settings.", variant: "destructive" });
      else toast({ title: "No email on file", description: "Add an email address to send this document." });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{trigger}</div>
      <DialogContent>
        <DialogHeader><DialogTitle>Resend {doc.docType}</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Recipient email</label>
          <Input type="email" placeholder="guest@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-resend-email" />
        </div>
        <DialogFooter>
          <Button onClick={() => resend.mutate()} disabled={!email || resend.isPending} data-testid="button-confirm-resend">
            {resend.isPending ? "Sending..." : "Resend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Documents() {
  const { data: documents = [], isLoading } = useQuery<DocumentRecord[]>({ queryKey: ["/api/documents"] });

  const sorted = [...documents].sort((a, b) => b.createdAt - a.createdAt);
  const sentCount = documents.filter((d) => d.status === "sent").length;
  const failedCount = documents.filter((d) => d.status === "failed").length;
  const skippedCount = documents.filter((d) => d.status === "skipped").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Invoices & Receipts" description="Every invoice and receipt generated across the hotel, with delivery status." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total documents" value={String(documents.length)} icon={FileText} testId="stat-documents-total" />
        <StatCard label="Emailed" value={String(sentCount)} icon={Mail} accent="success" testId="stat-documents-sent" />
        <StatCard label="Failed" value={String(failedCount)} icon={XCircle} accent="warning" testId="stat-documents-failed" />
        <StatCard label="Skipped" value={String(skippedCount)} icon={MinusCircle} accent="muted" testId="stat-documents-skipped" />
      </div>

      <Card>
        <div className="flex items-center justify-between p-4 border-b border-card-border">
          <h2 className="text-lg font-semibold">Document log</h2>
        </div>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading documents…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No invoices or receipts yet. They'll appear here as bookings and orders are created and paid.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((doc) => {
                  const cfg = statusConfig[doc.status] ?? statusConfig.skipped;
                  const Icon = cfg.icon;
                  return (
                    <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                      <TableCell>{formatDateTime(doc.createdAt)}</TableCell>
                      <TableCell className="font-medium">{titleCase(doc.docType)}</TableCell>
                      <TableCell>{categoryLabel[doc.category] ?? titleCase(doc.category)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{doc.recipientName || "—"}</span>
                          {doc.recipientEmail && <span className="text-xs text-muted-foreground">{doc.recipientEmail}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatKES(doc.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant} className="gap-1">
                          <Icon className="h-3 w-3" /> {cfg.label}
                        </Badge>
                        {doc.status === "failed" && doc.errorMessage && (
                          <div className="text-xs text-destructive mt-1 max-w-[220px] truncate" title={doc.errorMessage}>{doc.errorMessage}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Download PDF" data-testid={`button-download-document-${doc.id}`} asChild>
                            <a href={`/api/documents/${doc.id}/pdf`} target="_blank" rel="noopener noreferrer">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                          <ResendDialog doc={doc} trigger={
                            <Button size="icon" variant="ghost" title="Resend" data-testid={`button-resend-document-${doc.id}`}><RotateCw className="h-4 w-4" /></Button>
                          } />
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
    </div>
  );
}
