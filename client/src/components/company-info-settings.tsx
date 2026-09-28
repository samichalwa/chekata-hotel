// Settings > Company info: one editable place for the company's registration and tax
// identifiers (KRA PIN, VAT, registration, business permit + any extra fields), the bank
// account, and the "How to pay" details printed on invoices. Nothing here is hard-coded.
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Settings } from "@shared/schema";

const MPESA_TYPE: Record<string, string> = { till: "Buy Goods till", paybill: "Paybill", phone: "Send Money to" };
type Extra = { label: string; value: string; showOnInvoice: boolean };

function parseExtras(raw?: string | null): Extra[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map((e: any) => ({ label: String(e?.label ?? ""), value: String(e?.value ?? ""), showOnInvoice: !!e?.showOnInvoice })) : [];
  } catch { return []; }
}

export function CompanyInfoSettingsTab({ onOpenOnlineBooking, onOpenHotel }: { onOpenOnlineBooking?: () => void; onOpenHotel?: () => void }) {
  const { toast } = useToast();
  const { data } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const [f, setF] = useState({
    legal: "", reg: "", permit: "", kra: "", vat: "", showIds: true,
    showBank: true, bank: "", accName: "", accNo: "", branch: "", swift: "", showMpesa: true, note: "",
  });
  const [extras, setExtras] = useState<Extra[]>([]);
  // Load saved values once, so a background refetch never wipes what is being typed.
  const loaded = useRef(false);
  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    setF({
      legal: data.companyLegalName ?? "", reg: data.companyRegistrationNumber ?? "", permit: data.companyBusinessPermitNumber ?? "",
      kra: data.companyKraPin ?? "", vat: data.companyVatNumber ?? "", showIds: data.invoiceShowCompanyIds !== 0,
      showBank: data.invoiceShowBank !== 0, bank: data.invoiceBankName ?? "", accName: data.invoiceBankAccountName ?? "",
      accNo: data.invoiceBankAccountNumber ?? "", branch: data.invoiceBankBranch ?? "", swift: data.invoiceBankSwift ?? "",
      showMpesa: data.invoiceShowMpesa !== 0, note: data.invoicePaymentNote ?? "",
    });
    setExtras(parseExtras(data.companyExtraFields));
  }, [data]);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const setExtra = (i: number, patch: Partial<Extra>) => setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const t = (v: string) => v.trim() || null;
  const badExtra = extras.some((e) => !e.label.trim() && e.value.trim());

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/settings", {
      companyLegalName: t(f.legal), companyRegistrationNumber: t(f.reg), companyBusinessPermitNumber: t(f.permit),
      companyKraPin: t(f.kra), companyVatNumber: t(f.vat), invoiceShowCompanyIds: f.showIds ? 1 : 0,
      companyExtraFields: JSON.stringify(extras.filter((e) => e.label.trim()).map((e) => ({ label: e.label.trim(), value: e.value.trim(), showOnInvoice: e.showOnInvoice }))),
      invoiceShowBank: f.showBank ? 1 : 0, invoiceBankName: t(f.bank), invoiceBankAccountName: t(f.accName),
      invoiceBankAccountNumber: t(f.accNo), invoiceBankBranch: t(f.branch), invoiceBankSwift: t(f.swift),
      invoiceShowMpesa: f.showMpesa ? 1 : 0, invoicePaymentNote: t(f.note),
    })).json(),
    onSuccess: () => { loaded.current = false; queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); toast({ title: "Company info saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const mpesaNo = data?.mpesaNumber?.trim();
  const mpType = data?.mpesaPaymentType || "till";
  const field = (id: string, label: string, k: keyof typeof f, placeholder = "") => (
    <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} value={f[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} data-testid={`input-${id}`} /></div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        The company's official details in one place. They print on invoices, receipts and credit notes, including those sent by email and WhatsApp.
        {onOpenHotel && <> The trading name, address, phone and email are under <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={onOpenHotel} data-testid="button-open-hotel-tab">Hotel &amp; Email</button>.</>}
      </p>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div><h3 className="font-semibold">Registration &amp; tax</h3><p className="text-xs text-muted-foreground">Filled-in numbers print under the hotel's contact details on each document.</p></div>
          <div className="flex items-center gap-2"><Label htmlFor="ci-show-ids" className="text-xs text-muted-foreground whitespace-nowrap">Show on documents</Label><Switch id="ci-show-ids" checked={f.showIds} onCheckedChange={(v) => set("showIds", v)} data-testid="switch-company-ids" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("company-legal-name", "Registered (legal) name", "legal", data?.hotelName ?? "")}
          {field("company-kra-pin", "KRA PIN", "kra")}
          {field("company-vat", "VAT registration number", "vat")}
          {field("company-reg", "Business registration number", "reg")}
          {field("company-permit", "Business permit / licence number", "permit")}
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <div><Label>Other details</Label><p className="text-xs text-muted-foreground">e.g. Tourism licence, Liquor licence, Fire certificate. Tick to print on documents.</p></div>
            <Button type="button" variant="outline" size="sm" onClick={() => setExtras((xs) => [...xs, { label: "", value: "", showOnInvoice: false }])} data-testid="button-add-company-field"><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
          {extras.length === 0 && <p className="text-sm text-muted-foreground">No other details yet.</p>}
          {extras.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center" data-testid={`row-company-field-${i}`}>
              <Input value={e.label} onChange={(ev) => setExtra(i, { label: ev.target.value })} placeholder="Name (e.g. Liquor licence)" aria-label="Detail name" data-testid={`input-company-field-label-${i}`} />
              <Button type="button" variant="ghost" size="icon" className="sm:order-last" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove" data-testid={`button-remove-company-field-${i}`}><Trash2 className="h-4 w-4" /></Button>
              <Input value={e.value} onChange={(ev) => setExtra(i, { value: ev.target.value })} placeholder="Number / value" aria-label="Detail value" data-testid={`input-company-field-value-${i}`} />
              <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap"><Checkbox checked={e.showOnInvoice} onCheckedChange={(v) => setExtra(i, { showOnInvoice: !!v })} data-testid={`check-company-field-invoice-${i}`} /> On documents</label>
            </div>
          ))}
          {badExtra && <p className="text-sm text-destructive">Give each detail a name.</p>}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div><h3 className="font-semibold">Bank account</h3><p className="text-xs text-muted-foreground">Printed in the "How to pay" box on invoices, with the invoice number as the reference. Leave the account number blank to hide it.</p></div>
          <div className="flex items-center gap-2"><Label htmlFor="ci-show-bank" className="text-xs text-muted-foreground whitespace-nowrap">On invoices</Label><Switch id="ci-show-bank" checked={f.showBank} onCheckedChange={(v) => set("showBank", v)} data-testid="switch-invoice-bank" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("invoice-bank-name", "Bank name", "bank", "e.g. National Bank of Kenya")}
          {field("invoice-bank-account-name", "Account name", "accName", data?.hotelName ?? "")}
          {field("invoice-bank-account-number", "Account number", "accNo")}
          {field("invoice-bank-branch", "Branch (optional)", "branch")}
          {field("invoice-bank-swift", "SWIFT / bank code (optional)", "swift")}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div><h3 className="font-semibold">M-Pesa</h3><p className="text-xs text-muted-foreground">Taken from Settings → Online booking → M-Pesa payment details.</p></div>
          <div className="flex items-center gap-2"><Label htmlFor="ci-show-mpesa" className="text-xs text-muted-foreground whitespace-nowrap">On invoices</Label><Switch id="ci-show-mpesa" checked={f.showMpesa} onCheckedChange={(v) => set("showMpesa", v)} data-testid="switch-invoice-mpesa" /></div>
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm" data-testid="text-invoice-mpesa-summary">
          {mpesaNo ? (
            <>
              <div><span className="text-muted-foreground">{MPESA_TYPE[mpType] ?? "M-Pesa"}:</span> <span className="font-medium">{mpesaNo}</span></div>
              {mpType === "paybill" && <div><span className="text-muted-foreground">Account number:</span> <span className="font-medium">{data?.mpesaAccountNumber?.trim() || "the invoice number"}</span></div>}
              <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{data?.mpesaBusinessName?.trim() || data?.hotelName}</span></div>
            </>
          ) : <span className="text-muted-foreground">No M-Pesa number set yet, so no M-Pesa section is printed.</span>}
        </div>
        {onOpenOnlineBooking && <Button variant="outline" size="sm" onClick={onOpenOnlineBooking} data-testid="button-edit-mpesa">Edit M-Pesa details</Button>}
        <div className="space-y-1.5 border-t border-border pt-3">
          <Label htmlFor="ip-note">Payment note on invoices (optional)</Label>
          <Textarea id="ip-note" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. Please send proof of payment to info@thechekata.com" data-testid="input-invoice-payment-note" />
        </div>
      </Card>

      <Button onClick={() => save.mutate()} disabled={save.isPending || !data || badExtra} data-testid="button-save-company-info"><Save className="h-4 w-4 mr-1" /> Save</Button>
    </div>
  );
}
