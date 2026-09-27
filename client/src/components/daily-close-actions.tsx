import { useState } from "react";
import { FileDown, Send } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, authedFetch } from "@/lib/queryClient";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { AuthedUser } from "@/hooks/use-auth";

// Daily close report actions on the Today briefing:
// - PDF: the signed-in user's own (permission-filtered) close report.
// - WhatsApp (admins): shares the actual PDF file where the phone supports it,
//   otherwise opens wa.me with the summary text + a secure PDF link.
// - Email now (admins): sends to the recipients set in Settings → Daily close report.
export function DailyCloseActions({ user, date }: { user: AuthedUser | null | undefined; date: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"pdf" | "wa" | "send" | null>(null);
  const isAdmin = !!user?.isAdmin;
  const env = user?.environment ?? "live";

  const fetchPdf = async () => {
    const res = await authedFetch(`/api/director/daily-report/pdf?date=${date}`);
    return res.blob();
  };

  const downloadPdf = async () => {
    setBusy("pdf");
    try {
      const blob = await fetchPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-close-${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e: any) {
      toast({ title: "Couldn't create the PDF", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const shareWhatsApp = async () => {
    setBusy("wa");
    // Open the window synchronously (before awaits) so pop-up blockers allow it.
    const nav = navigator as any;
    const canShareFiles = typeof nav.canShare === "function" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    const win = canShareFiles ? null : window.open("", "_blank");
    try {
      const share = await (await apiRequest("GET", `/api/director/daily-report/share?date=${date}`)).json() as { text: string; url: string; whatsappPhone: string | null };
      const message = `${share.text}\n\nFull report (PDF): ${share.url}`;
      if (canShareFiles) {
        const blob = await (await authedFetch(share.url.replace(/^https?:\/\/[^/]+/, ""))).blob();
        const file = new File([blob], `daily-close-${date}.pdf`, { type: "application/pdf" });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], text: env === "test" ? `TEST COMPANY — ${message}` : message, title: `Daily close ${date}` });
          return;
        }
      }
      const link = buildWhatsAppLink(share.whatsappPhone, message, env)
        ?? `https://wa.me/?text=${encodeURIComponent(env === "test" ? `TEST COMPANY — ${message}` : message)}`;
      if (win) win.location.href = link; else window.open(link, "_blank");
    } catch (e: any) {
      win?.close();
      if (e?.name === "AbortError") return; // user closed the share sheet
      toast({ title: "Couldn't prepare the WhatsApp message", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const sendNow = async () => {
    setBusy("send");
    try {
      const r = await (await apiRequest("POST", "/api/director/daily-report/send", { date })).json() as { emails: { ok: boolean }[]; sms: { ok: boolean }[]; pushed: number };
      const okE = r.emails.filter((x) => x.ok).length;
      const okS = r.sms.filter((x) => x.ok).length;
      const failed = r.emails.length - okE + (r.sms.length - okS);
      if (r.emails.length === 0 && r.sms.length === 0) {
        toast({ title: "No recipients set", description: "Add email addresses (and SMS numbers) in Settings → Daily close report. Admins were notified in the app." });
      } else {
        toast({
          title: failed ? "Daily close sent with some failures" : "Daily close sent",
          description: `Email ${okE}/${r.emails.length}${r.sms.length ? ` · SMS ${okS}/${r.sms.length}` : ""}${r.pushed ? ` · ${r.pushed} admin alert${r.pushed === 1 ? "" : "s"}` : ""}`,
          variant: failed ? "destructive" : undefined,
        });
      }
    } catch (e: any) {
      toast({ title: "Couldn't send the report", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="daily-close-actions">
      <span className="w-full text-xs font-medium text-muted-foreground sm:w-auto sm:mr-1">Daily close report</span>
      <Button variant="outline" size="sm" onClick={downloadPdf} disabled={busy !== null} data-testid="button-daily-pdf">
        <FileDown className="h-4 w-4 mr-1.5" />{busy === "pdf" ? "Preparing…" : "PDF"}
      </Button>
      {isAdmin && (
        <>
          <Button variant="outline" size="sm" onClick={shareWhatsApp} disabled={busy !== null} data-testid="button-daily-whatsapp">
            <SiWhatsapp className="h-4 w-4 mr-1.5 text-[#25D366]" />{busy === "wa" ? "Preparing…" : "WhatsApp"}
          </Button>
          <Button variant="outline" size="sm" onClick={sendNow} disabled={busy !== null} data-testid="button-daily-send">
            <Send className="h-4 w-4 mr-1.5" />{busy === "send" ? "Sending…" : "Email now"}
          </Button>
        </>
      )}
    </div>
  );
}
