import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Settings } from "@shared/schema";

interface LogRow { date: string; sentAt: number; result: { emails: { to: string; ok: boolean; error?: string }[]; sms: { to: string; ok: boolean; error?: string }[]; pushed: number } | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const split = (v: string) => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export function DailyReportSettingsTab() {
  const { toast } = useToast();
  const { data } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: log } = useQuery<LogRow[]>({ queryKey: ["/api/director/daily-report/log"] });
  const [form, setForm] = useState({ enabled: false, time: "21:00", emails: "", sms: "", whatsapp: "", push: true });

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: !!data.dailyReportEnabled,
      time: data.dailyReportTime || "21:00",
      emails: data.dailyReportEmails ?? "",
      sms: data.dailyReportSmsPhones ?? "",
      whatsapp: data.dailyReportWhatsappPhone ?? "",
      push: data.dailyReportPush !== 0,
    });
  }, [data]);

  const badEmails = split(form.emails).filter((e) => !EMAIL_RE.test(e));

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/settings", {
        dailyReportEnabled: form.enabled ? 1 : 0,
        dailyReportTime: form.time,
        dailyReportEmails: split(form.emails).join(", ") || null,
        dailyReportSmsPhones: split(form.sms).join(", ") || null,
        dailyReportWhatsappPhone: form.whatsapp.trim() || null,
        dailyReportPush: form.push ? 1 : 0,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Daily close report settings saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  const sendNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/director/daily-report/send", {})).json(),
    onSuccess: (r: LogRow["result"]) => {
      queryClient.invalidateQueries({ queryKey: ["/api/director/daily-report/log"] });
      const okE = r?.emails.filter((x) => x.ok).length ?? 0;
      toast({ title: "Today's report sent", description: `Email ${okE}/${r?.emails.length ?? 0}${r?.sms.length ? ` · SMS ${r.sms.filter((x) => x.ok).length}/${r.sms.length}` : ""}` });
    },
    onError: (e: any) => toast({ title: "Couldn't send", description: e?.message, variant: "destructive" }),
  });

  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(form.time);

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-5" data-testid="card-daily-report">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">Daily close report</h3>
            <p className="text-sm text-muted-foreground">Each evening CHAIMS emails a PDF of the day — income by stream, occupancy, cash position, expenses, approvals and alerts. It can also send an SMS with a secure PDF link and a phone alert to administrators.</p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} aria-label="Send the daily close report automatically" data-testid="switch-daily-report" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dr-time">Send time (Nairobi)</Label>
            <Input id="dr-time" type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} data-testid="input-daily-time" />
            <p className="text-xs text-muted-foreground">Sent once a day at or after this time. Live environment only.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dr-wa">WhatsApp number for sharing</Label>
            <Input id="dr-wa" inputMode="tel" placeholder="e.g. 0722 000 000" value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} data-testid="input-daily-whatsapp" />
            <p className="text-xs text-muted-foreground">Used by the WhatsApp button on the Today briefing. The message always includes the PDF.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dr-emails">Email recipients</Label>
          <Input id="dr-emails" placeholder="director@example.com, owner@example.com" value={form.emails} onChange={(e) => setForm((f) => ({ ...f, emails: e.target.value }))} data-testid="input-daily-emails" />
          {badEmails.length > 0 ? (
            <p className="text-xs text-destructive" data-testid="text-daily-bad-emails">Check: {badEmails.join(", ")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Separate with commas. Uses the email provider set on the Hotel &amp; Email tab.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dr-sms">SMS numbers (optional)</Label>
          <Input id="dr-sms" inputMode="tel" placeholder="0722 000 000, 0733 000 000" value={form.sms} onChange={(e) => setForm((f) => ({ ...f, sms: e.target.value }))} data-testid="input-daily-sms" />
          <p className="text-xs text-muted-foreground">A short summary with a secure PDF link, via Africa's Talking. Only sent when SMS is turned on.</p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium">Alert administrators</p>
            <p className="text-xs text-muted-foreground">Adds an in-app notification and a phone alert (for devices with alerts turned on).</p>
          </div>
          <Switch checked={form.push} onCheckedChange={(v) => setForm((f) => ({ ...f, push: v }))} aria-label="Alert administrators" data-testid="switch-daily-push" />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => sendNow.mutate()} disabled={sendNow.isPending} data-testid="button-daily-send-now">
            <Send className="h-4 w-4 mr-1" />{sendNow.isPending ? "Sending…" : "Send today's report now"}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || badEmails.length > 0 || !validTime} data-testid="button-daily-save">
            <Save className="h-4 w-4 mr-1" />{save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3" data-testid="card-daily-log">
        <h3 className="font-semibold">Recent automatic sends</h3>
        {!log || log.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automatic sends yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {log.map((r) => {
              const e = r.result?.emails ?? [];
              const s = r.result?.sms ?? [];
              const failed = [...e, ...s].filter((x) => !x.ok);
              return (
                <li key={r.date} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium tabular-nums">{r.date}</span>
                  <span className="text-muted-foreground">
                    {r.result ? `Email ${e.filter((x) => x.ok).length}/${e.length} · SMS ${s.filter((x) => x.ok).length}/${s.length} · ${r.result.pushed} alerts` : "Sending…"}
                    {failed.length > 0 && <span className="text-destructive"> · failed: {failed.map((f) => f.to).join(", ")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
