import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Eye, FileDown, Send, Share2 } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, authedFetch } from "@/lib/queryClient";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import type { AuthedUser } from "@/hooks/use-auth";

// Daily close report actions (Today briefing + the Daily close report screen):
// - View: opens the on-screen report.
// - Share PDF: the phone's share sheet with the actual PDF file attached
//   (WhatsApp, Mail, Messages, AirDrop, Files…). The PDF is fetched ahead of
//   time so the share sheet opens straight from the tap — iPhone Safari
//   refuses to open it if the tap is followed by a slow download first.
//   Falls back to a download on computers that can't share files.
// - PDF: download the signed-in user's own (permission-filtered) report.
// - WhatsApp (admins): wa.me with the summary text + a secure PDF link.
// - Email now (admins): sends to the recipients set in Settings → Daily report.

export function dailyPdfName(date: string) { return `daily-close-${date}.pdf`; }

export function useDailyReportPdf(date: string, enabled = true) {
  return useQuery<Blob>({
    queryKey: ["daily-report-pdf", date],
    queryFn: async () => (await authedFetch(`/api/director/daily-report/pdf?date=${date}`)).blob(),
    enabled: enabled && !!date,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

function canShareFiles(): boolean {
  const nav = navigator as any;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [new File([new Blob(["x"], { type: "application/pdf" })], "t.pdf", { type: "application/pdf" })] });
  } catch { return false; }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function DailyCloseActions({ user, date, showView = false }: { user: AuthedUser | null | undefined; date: string; showView?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"share" | "pdf" | "wa" | "send" | null>(null);
  const isAdmin = !!user?.isAdmin;
  const env = user?.environment ?? "live";
  const pdf = useDailyReportPdf(date, !showView);
  const shareable = typeof navigator !== "undefined" && canShareFiles();

  const getPdf = async (): Promise<Blob> => pdf.data ?? (await pdf.refetch({ throwOnError: true })).data!;

  const sharePdf = async () => {
    setBusy("share");
    try {
      const blob = await getPdf();
      const file = new File([blob], dailyPdfName(date), { type: "application/pdf" });
      const nav = navigator as any;
      if (shareable && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `Daily close report ${date}` });
      } else {
        saveBlob(blob, dailyPdfName(date));
        toast({ title: "PDF downloaded", description: "This device can't open a share sheet, so the PDF was saved instead." });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return; // share sheet closed
      toast({
        title: "Couldn't share the PDF",
        description: e?.name === "NotAllowedError" ? "The PDF was still loading. Please tap Share PDF again." : e?.message,
        variant: "destructive",
      });
    } finally { setBusy(null); }
  };

  const downloadPdf = async () => {
    setBusy("pdf");
    try {
      saveBlob(await getPdf(), dailyPdfName(date));
    } catch (e: any) {
      toast({ title: "Couldn't create the PDF", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const shareWhatsApp = async () => {
    setBusy("wa");
    // Open the window synchronously (before awaits) so pop-up blockers allow it.
    const win = window.open("", "_blank");
    try {
      const share = await (await apiRequest("GET", `/api/director/daily-report/share?date=${date}`)).json() as { text: string; url: string; whatsappPhone: string | null };
      const message = `${share.text}\n\nFull report (PDF): ${share.url}`;
      const link = buildWhatsAppLink(share.whatsappPhone, message, env)
        ?? `https://wa.me/?text=${encodeURIComponent(env === "test" ? `TEST COMPANY — ${message}` : message)}`;
      if (win) win.location.href = link; else window.location.href = link;
    } catch (e: any) {
      win?.close();
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
        toast({ title: "No recipients set", description: "Add email addresses (and SMS numbers) in Settings → Daily report. Admins were notified in the app." });
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

  const pdfLoading = pdf.isFetching && !pdf.data;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="daily-close-actions">
      {showView && (
        <>
          <span className="w-full text-xs font-medium text-muted-foreground sm:w-auto sm:mr-1">Daily close report</span>
          <Link href={`/daily-close/${date}`}>
            <Button size="sm" data-testid="button-daily-view"><Eye className="h-4 w-4 mr-1.5" />View &amp; share</Button>
          </Link>
        </>
      )}
      {!showView && (
        <>
          <Button size="sm" onClick={sharePdf} disabled={busy !== null || pdfLoading} data-testid="button-daily-share">
            <Share2 className="h-4 w-4 mr-1.5" />{busy === "share" ? "Opening…" : pdfLoading ? "Preparing PDF…" : "Share PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={busy !== null} data-testid="button-daily-pdf">
            <FileDown className="h-4 w-4 mr-1.5" />{busy === "pdf" ? "Preparing…" : "Download PDF"}
          </Button>
        </>
      )}
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
