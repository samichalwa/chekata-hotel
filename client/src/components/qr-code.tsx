// QR codes drawn locally (no external service) for the "scan to pay your bill" links.
import qrcode from "qrcode-generator";

export function qrSvg(text: string, cellSize = 6, margin = 4): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize, margin, scalable: true } as any);
}

export function QrCode({ text, size = 180, testId }: { text: string; size?: number; testId?: string }) {
  return (
    <div
      className="rounded-md bg-white p-1 [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      role="img"
      aria-label="QR code"
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: qrSvg(text) }}
    />
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Opens a print window with a QR card (table tent card or bill slip). */
export function printQrCard(opts: { title: string; subtitle?: string; lines?: { label: string; amount?: string }[]; total?: string; url: string; hotelName?: string; footer?: string }) {
  const w = window.open("", "_blank", "width=480,height=720");
  if (!w) return false;
  const lines = (opts.lines ?? []).map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${esc(l.amount ?? "")}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>${esc(opts.title)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;text-align:center}
    .card{max-width:360px;margin:0 auto;border:1px solid #bbb;border-radius:12px;padding:20px}
    h1{font-size:20px;margin:0 0 4px} h2{font-size:26px;margin:8px 0} p{margin:4px 0;font-size:13px;color:#444}
    .qr{width:240px;height:240px;margin:12px auto} .qr svg{width:100%;height:100%}
    table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;text-align:left} td{padding:3px 0;border-bottom:1px dotted #ccc} .r{text-align:right}
    .tot{font-size:16px;font-weight:bold;margin-top:6px} .url{font-size:10px;color:#666;word-break:break-all;margin-top:8px}
    @media print{body{padding:0}.card{border:none}}
  </style></head><body><div class="card">
    <h1>${esc(opts.hotelName ?? "The Chekata")}</h1>
    <h2>${esc(opts.title)}</h2>${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ""}
    ${lines ? `<table>${lines}</table>` : ""}${opts.total ? `<div class="tot">Total: ${esc(opts.total)}</div>` : ""}
    <div class="qr">${qrSvg(opts.url, 8, 2)}</div>
    <p><b>Scan with your phone camera to pay by M-Pesa</b></p>
    <p>${esc(opts.footer ?? "Pay by M-Pesa, then paste your M-Pesa SMS on the page. Our staff confirm your payment.")}</p>
    <div class="url">${esc(opts.url)}</div>
  </div><script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
  w.document.close();
  return true;
}
