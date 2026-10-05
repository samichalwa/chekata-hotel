// Settings → Receipts to Finance: where each payment method's money lands (cash / bank account)
// and which income account each revenue stream credits. Nothing is hardcoded.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
const formatKES = (v: number) => `KES ${Math.round(v || 0).toLocaleString("en-KE")}`;
import type { BankAccount, ChartOfAccount, Settings } from "@shared/schema";
import { RECEIPT_CATEGORIES, RECEIPT_METHODS, parseReceiptPosting, type ReceiptPostingConfig } from "@shared/receipt-posting";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });

function Pick({ value, onChange, options, placeholder, testId }: { value: number | null | undefined; onChange: (v: number | null) => void; options: { id: number; label: string }[]; placeholder: string; testId: string }) {
  return (
    <Select value={value ? String(value) : "none"} onValueChange={(v) => onChange(v === "none" ? null : Number(v))}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function ReceiptPostingSettingsTab() {
  const { toast } = useToast();
  const { data: settings, isLoading: l1 } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: banks = [], isLoading: l2 } = useQuery<BankAccount[]>({ queryKey: ["/api/finance/bank-accounts"] });
  const { data: coa = [], isLoading: l3 } = useQuery<ChartOfAccount[]>({ queryKey: ["/api/finance/accounts"] });
  const [cfg, setCfg] = useState<ReceiptPostingConfig>({ enabled: false, accounts: {}, income: {}, startDate: today() });
  useEffect(() => { if (settings) { const c = parseReceiptPosting((settings as any).receiptPosting); setCfg({ ...c, startDate: c.startDate || today() }); } }, [settings]);
  const [from, setFrom] = useState(today());
  const pending = useQuery<{ count: number; total: number }>({ queryKey: [`/api/finance/receipt-posting/pending?from=${from}`] });

  const bankOpts = banks.filter((b) => b.active).map((b) => ({ id: b.id, label: `${b.name}${b.bankName ? ` · ${b.bankName}` : ""}${b.accountNumber ? ` · ${b.accountNumber}` : ""}` }));
  const incomeOpts = coa.filter((a) => a.active && a.type === "income").map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));
  const missing = cfg.enabled && (RECEIPT_METHODS.some((m) => !cfg.accounts[m.key]) || (!cfg.income.default && RECEIPT_CATEGORIES.some((c) => !cfg.income[c.key])));

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/settings", { receiptPosting: JSON.stringify(cfg) })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); toast({ title: "Receipt posting saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/finance/receipt-posting/post", { from })).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/finance") || q.queryKey[0] === "/api/director/summary" });
      toast({ title: `Posted ${r.posted} receipt${r.posted === 1 ? "" : "s"} · ${formatKES(r.amount)}`, description: r.failed.length ? `${r.failed.length} not posted: ${r.failed[0].reason}` : undefined, variant: r.failed.length ? "destructive" : undefined });
    },
    onError: (e: any) => toast({ title: "Couldn't post", description: e?.message, variant: "destructive" }),
  });

  if (l1 || l2 || l3 || !settings) {
    return <div className="space-y-4 max-w-3xl" data-testid="receipt-posting-loading">{[0, 1, 2].map((i) => <Card key={i} className="p-4 h-28 animate-pulse bg-muted/40" />)}</div>;
  }
  return (
    <div className="space-y-4 max-w-3xl" data-testid="receipt-posting-settings">
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">Post receipts to Finance automatically</h3>
            <p className="text-sm text-muted-foreground">Each payment receipt posts a journal: debit the account where the money landed, credit the income account for that stream. Finance's Cash &amp; bank balances then show real takings.</p>
          </div>
          <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, enabled: v }))} data-testid="switch-receipt-posting" />
        </div>
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="rp-start">Post receipts issued from</Label>
          <Input id="rp-start" type="date" value={cfg.startDate ?? ""} onChange={(e) => setCfg((c) => ({ ...c, startDate: e.target.value || null }))} data-testid="input-receipt-posting-start" />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Where the money lands</h3>
          <p className="text-sm text-muted-foreground">Choose the cash or bank account (from Finance → Bank accounts) for each payment method. Paybill payments settle to your bank, so pick the bank account for M-Pesa.</p>
        </div>
        {bankOpts.length === 0 && <p className="text-sm text-destructive">No bank or cash accounts yet — add them in Finance → Bank accounts first.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {RECEIPT_METHODS.map((m) => (
            <div key={m.key} className="space-y-1.5">
              <Label>{m.label}</Label>
              <Pick value={cfg.accounts[m.key]} onChange={(v) => setCfg((c) => ({ ...c, accounts: { ...c.accounts, [m.key]: v } }))} options={bankOpts} placeholder="Not posted" testId={`select-receipt-account-${m.key}`} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Income accounts</h3>
          <p className="text-sm text-muted-foreground">The income account each stream credits (income-type accounts from the Chart of accounts). Streams left blank use the default.</p>
        </div>
        <div className="space-y-1.5 sm:max-w-[50%]">
          <Label>Default income account</Label>
          <Pick value={cfg.income.default} onChange={(v) => setCfg((c) => ({ ...c, income: { ...c.income, default: v } }))} options={incomeOpts} placeholder="None" testId="select-receipt-income-default" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {RECEIPT_CATEGORIES.map((k) => (
            <div key={k.key} className="space-y-1.5">
              <Label>{k.label}</Label>
              <Pick value={cfg.income[k.key]} onChange={(v) => setCfg((c) => ({ ...c, income: { ...c.income, [k.key]: v } }))} options={incomeOpts} placeholder="Use default" testId={`select-receipt-income-${k.key}`} />
            </div>
          ))}
        </div>
      </Card>

      {missing && <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="text-receipt-posting-missing">Some methods or streams have no account yet — those receipts won't post until you choose one.</p>}
      <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-receipt-posting"><Save className="h-4 w-4 mr-1" /> {save.isPending ? "Saving…" : "Save"}</Button>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Post earlier receipts</h3>
          <p className="text-sm text-muted-foreground">Post receipts issued before posting was switched on. Receipts already posted are skipped, so this is safe to run again.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rp-from">From date</Label>
            <Input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-receipt-posting-from" />
          </div>
          <p className="text-sm pb-2" data-testid="text-receipt-posting-pending">{pending.data ? `${pending.data.count} not yet posted · ${formatKES(pending.data.total)}` : "…"}</p>
        </div>
        <Button variant="outline" onClick={() => post.mutate()} disabled={post.isPending || !settings || !parseReceiptPosting((settings as any).receiptPosting).enabled || !pending.data?.count} data-testid="button-post-earlier-receipts">
          <Send className="h-4 w-4 mr-1" /> {post.isPending ? "Posting…" : "Post these receipts"}
        </Button>
        {settings && !parseReceiptPosting((settings as any).receiptPosting).enabled && <p className="text-xs text-muted-foreground">Turn posting on and save first.</p>}
      </Card>
    </div>
  );
}
