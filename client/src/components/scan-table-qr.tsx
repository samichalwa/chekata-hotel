// Staff scan a table's QR code (the same "scan to pay" QR printed for the table, …/#/pay/t/<token>)
// with the device camera to assign the customer to that table.
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { ScanLine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";

const errMsg = (e: any) => { const m = String(e?.message ?? e); const body = m.replace(/^\d+:\s*/, ""); try { return JSON.parse(body).error ?? body; } catch { return body; } };

export interface ScannedTable { id: number; name: string; outlet: string }

export function tokenFromQrText(text: string): string | null {
  const m = text.match(/\/pay\/t\/([a-f0-9]{24})/i) ?? text.match(/^([a-f0-9]{24})$/i);
  return m ? m[1].toLowerCase() : null;
}

export function ScanTableButton({ onTable, size = "sm", label = "Scan table" }: { onTable: (t: ScannedTable) => void; size?: "sm" | "default"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)} data-testid="button-scan-table">
        <ScanLine className="h-4 w-4 mr-1.5" /> {label}
      </Button>
      {open && <ScanDialog onClose={() => setOpen(false)} onTable={(t) => { setOpen(false); onTable(t); }} />}
    </>
  );
}

function ScanDialog({ onClose, onTable }: { onClose: () => void; onTable: (t: ScannedTable) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "checking" | "error">("starting");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let busy = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const Detector = (window as any).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

    const handle = async (text: string) => {
      const token = tokenFromQrText(text);
      if (!token) { setMessage("That QR code is not a table QR. Point the camera at the table's QR code."); return; }
      busy = true;
      setStatus("checking");
      try {
        const t = (await (await apiRequest("GET", `/api/pos/table-by-token/${token}`)).json()) as ScannedTable;
        stopped = true;
        onTable(t);
      } catch (e: any) {
        setMessage(errMsg(e) || "Couldn't read that table.");
        setStatus("scanning");
        busy = false;
      }
    };

    const tick = async () => {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busy) {
        try {
          if (detector) {
            const codes = await detector.detect(v);
            if (codes?.[0]?.rawValue) await handle(codes[0].rawValue);
          } else if (ctx && v.videoWidth) {
            const w = Math.min(640, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
            canvas.width = w; canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (code?.data) await handle(code.data);
          }
        } catch { /* keep scanning */ }
      }
      raf = window.setTimeout(() => requestAnimationFrame(tick), 200) as unknown as number;
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera. Pick the table from the list instead.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.setAttribute("playsinline", "true"); await v.play().catch(() => {}); }
        setStatus("scanning");
        tick();
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.name === "NotAllowedError" ? "Camera permission was refused. Allow the camera for this site, or pick the table from the list." : e?.message ?? "Couldn't open the camera.");
      }
    })();
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan the table QR code</DialogTitle>
          <DialogDescription>Point the camera at the QR code on the table.</DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-md bg-black aspect-[4/3]">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" data-testid="video-scan-table" />
          {status !== "scanning" && status !== "error" && (
            <div className="absolute inset-0 flex items-center justify-center text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
          {status === "scanning" && <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80" />}
        </div>
        {message && <p className="text-sm text-destructive" data-testid="text-scan-message">{message}</p>}
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-scan">Cancel</Button>
      </DialogContent>
    </Dialog>
  );
}
