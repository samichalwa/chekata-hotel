// Finance → Receipts to post: receipts (money received) that are not yet in the ledger, with the reason
// each one is waiting, and a button to post them. The accounts they post to are chosen in Settings.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import type { Settings } from "@shared/schema";
import { RECEIPT_CATEGORIES, RECEIPT_METHODS, parseReceiptPosting } from "@shared/receipt-posting";

type Item = { id: number; docType: string; category: string; recipientName: string | null; createdAt: number; amount: number; method: string; reference: string | null; docNumber: string | null; issue: string | null };
const monthStart = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).slice(0, 8) + "01";
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const catLabel = (k: string) => RECEIPT_CATEGORIES.find((c) => c.key === k)?.label ?? k;
const methodLabel = (k: string) => RECEIPT_METHODS.find((m) => m.key === k)?.label ?? (k || "—");

export function ReceiptsToPostTab() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const cfg = settings ? parseReceiptPosting((settings as any).receiptPosting) : null;
  const [from, setFrom] = useState(monthStart());
  const key = `/api/finance/receipt-posting/pending?from=${from}`;
  const { data, isLoading } = useQuery<{ count: number; total: number; items: Item[] }>({ queryKey: [key] });
  const ready = (data?.items ?? []).filter((i) => !i.issue);
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/finance/receipt-posting/post", { from })).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/finance") || q.queryKey[0] === "/api/director/summary" });
      toast({ title: `Posted ${r.posted} receipt${r.posted === 1 ? "" : "s"} · ${formatKES(r.amount)}`, description: r.failed.length ? `${r.failed.length} not posted: ${r.failed[0].reason}` : undefined, variant: r.failed.length ? "destructive" : undefined });
    },
    onError: (e: any) => toast({ title: "Couldn't post", description: String(e?.message ?? e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="space-y-4" data-testid="receipts-to-post">
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Receipts to post</h3>
          <p className="text-sm text-muted-foreground">Money received (receipts) that is not yet in the cash &amp; bank accounts. Receipts normally post by themselves; any listed here are waiting for the reason shown. Already-posted receipts are never posted twice.</p>
        </div>
        {cfg && !cfg.enabled && <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="text-receipt-posting-off">Receipt posting is switched off. An administrator can turn it on in Settings → Receipts to Finance.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="rtp-from">Receipts from</Label><Input id="rtp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-receipts-to-post-from" /></div>
          <p className="text-sm pb-2" data-testid="text-receipts-to-post-summary">{data ? `${data.count} waiting · ${formatKES(data.total)}${data.count ? ` · ${ready.length} ready to post` : ""}` : "…"}</p>
          <Button className="sm:ml-auto" onClick={() => post.mutate()} disabled={post.isPending || !cfg?.enabled || !ready.length} data-testid="button-post-receipts">
            <Send className="h-4 w-4 mr-1" />{post.isPending ? "Posting…" : `Post ${ready.length || ""} receipt${ready.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </Button>
        </div>
      </Card>
      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Receipt</TableHead><TableHead>From</TableHead><TableHead className="hidden md:table-cell">Revenue stream</TableHead><TableHead className="hidden sm:table-cell">Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            {data && data.items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground" data-testid="text-receipts-to-post-empty">Nothing waiting — every receipt since {from} is posted.</TableCell></TableRow>}
            {data?.items.map((i) => (
              <TableRow key={i.id} data-testid={`row-receipt-to-post-${i.id}`}>
                <TableCell className="text-sm whitespace-nowrap">{when(i.createdAt)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{i.docNumber ?? `#${i.id}`}{i.reference ? <span className="block text-xs text-muted-foreground">{i.reference}</span> : null}</TableCell>
                <TableCell className="text-sm">{i.recipientName ?? "—"}</TableCell>
                <TableCell className="text-sm hidden md:table-cell">{catLabel(i.category)}</TableCell>
                <TableCell className="text-sm hidden sm:table-cell">{methodLabel(i.method)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatKES(i.amount)}</TableCell>
                <TableCell className="text-sm min-w-[12rem]">{i.issue ? <span className="flex items-start gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{i.issue}</span> : <Badge variant="outline">Ready to post</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
