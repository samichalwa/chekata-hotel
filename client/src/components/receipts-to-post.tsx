// Finance → Receipts to post: receipts (money received) that are not yet in the ledger, with the reason
// each one is waiting, and a button to post them. The accounts they post to are chosen in Settings.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { RECEIPT_CATEGORIES, RECEIPT_METHODS } from "@shared/receipt-posting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Item = { id: number; docType: string; category: string; recipientName: string | null; createdAt: number; amount: number; method: string; reference: string | null; docNumber: string | null; issue: string | null; defaultBankAccountId: number | null };
type Bank = { id: number; name: string; bankName?: string | null; accountNumber?: string | null; isActive?: number | boolean };
const monthStart = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).slice(0, 8) + "01";
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const catLabel = (k: string) => RECEIPT_CATEGORIES.find((c) => c.key === k)?.label ?? k;
const methodLabel = (k: string) => RECEIPT_METHODS.find((m) => m.key === k)?.label ?? (k || "—");

export function ReceiptsToPostTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(monthStart());
  const key = `/api/finance/receipt-posting/pending?from=${from}`;
  const { data, isLoading } = useQuery<{ enabled: boolean; count: number; total: number; items: Item[] }>({ queryKey: [key] });
  const { data: banks = [] } = useQuery<Bank[]>({ queryKey: ["/api/finance/bank-accounts"] });
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const accountFor = (i: Item) => chosen[i.id] ?? (i.defaultBankAccountId ? String(i.defaultBankAccountId) : "");
  const post = useMutation({
    mutationFn: async (i: Item) => (await apiRequest("POST", "/api/finance/receipt-posting/post-one", { docId: i.id, bankAccountId: Number(accountFor(i)) })).json(),
    onSuccess: (r: any, i) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/finance") || q.queryKey[0] === "/api/director/summary" });
      const b = banks.find((x) => String(x.id) === accountFor(i));
      toast({ title: `Posted ${i.docNumber ?? `#${i.id}`} · ${formatKES(r.amount)}`, description: b ? `Into ${b.name}` : undefined });
    },
    onError: (e: any) => toast({ title: "Couldn't post", description: String(e?.message ?? e).replace(/^\d+:\s*/, "").replace(/^\{"error":"|"\}$/g, ""), variant: "destructive" }),
  });
  return (
    <div className="space-y-4" data-testid="receipts-to-post">
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Receipts to post</h3>
          <p className="text-sm text-muted-foreground">Money received (receipts) that is not yet in the cash &amp; bank accounts. Post each receipt into the account the money actually went into (bank, M-Pesa or petty cash). The account suggested comes from Settings; change it if needed. A receipt can only be posted once.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="rtp-from">Receipts from</Label><Input id="rtp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-receipts-to-post-from" /></div>
          <p className="text-sm pb-2" data-testid="text-receipts-to-post-summary">{data ? `${data.count} waiting · ${formatKES(data.total)}` : "…"}</p>
        </div>
      </Card>
      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Receipt</TableHead><TableHead>From</TableHead><TableHead className="hidden md:table-cell">Revenue stream</TableHead><TableHead className="hidden sm:table-cell">Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Money went into</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            {data && data.items.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground" data-testid="text-receipts-to-post-empty">Nothing waiting — every receipt since {from} is posted.</TableCell></TableRow>}
            {data?.items.map((i) => (
              <TableRow key={i.id} data-testid={`row-receipt-to-post-${i.id}`}>
                <TableCell className="text-sm whitespace-nowrap">{when(i.createdAt)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{i.docNumber ?? `#${i.id}`}{i.reference ? <span className="block text-xs text-muted-foreground">{i.reference}</span> : null}</TableCell>
                <TableCell className="text-sm">{i.recipientName ?? "—"}</TableCell>
                <TableCell className="text-sm hidden md:table-cell">{catLabel(i.category)}</TableCell>
                <TableCell className="text-sm hidden sm:table-cell">{methodLabel(i.method)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatKES(i.amount)}</TableCell>
                <TableCell className="min-w-[14rem]">
                  <Select value={accountFor(i)} onValueChange={(v) => setChosen((c) => ({ ...c, [i.id]: v }))}>
                    <SelectTrigger className="h-9" data-testid={`select-receipt-account-${i.id}`}><SelectValue placeholder="Choose account" /></SelectTrigger>
                    <SelectContent>{banks.filter((b) => b.isActive !== 0 && b.isActive !== false).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                  {i.issue && <span className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`text-receipt-issue-${i.id}`}><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{i.issue}</span>}
                </TableCell>
                <TableCell className="text-right"><Button size="sm" onClick={() => post.mutate(i)} disabled={!accountFor(i) || !!i.issue || (post.isPending && post.variables?.id === i.id)} data-testid={`button-post-receipt-${i.id}`}><Send className="h-3.5 w-3.5 mr-1" />{post.isPending && post.variables?.id === i.id ? "Posting…" : "Post"}</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
