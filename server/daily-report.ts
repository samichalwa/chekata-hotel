// Daily close report for the owner/director.
//
// - PDF built from the same data as the Today briefing (buildDirectorSummary).
// - Emailed (PDF attached) to the recipients configured in Settings at the
//   configured Nairobi time; optional SMS with a secure PDF link; optional
//   push/in-app notification to admins.
// - Shareable on WhatsApp: wa.me can only carry text, so the message carries a
//   signed, no-login link to the PDF (and on phones that support it, the
//   client shares the actual PDF file instead).
// Everything is configured in Settings → Daily close report; nothing hardcoded.
import type { Express, Request } from "express";
import crypto from "crypto";
import PDFDocument from "pdfkit";
import type { Settings } from "@shared/schema";
import { sql, storage } from "./storage";
import { buildDirectorSummary, hotelToday, notifyUserIds } from "./director";
import { companyDisplayName, drawCompanyHeaderName, LOGO_EXISTS, LOGO_PATH } from "./pdf";
import { sendTransactionalEmail } from "./email";
import { sendSms } from "./sms";
import { getCurrentEnvironment, runWithEnvironment, type DbEnvironment } from "./db-context";

type Summary = Awaited<ReturnType<typeof buildDirectorSummary>>;

// Full-visibility principal for the scheduled report (it goes to the owner).
const OWNER_VIEW = { id: 0, isAdmin: 1, permissions: "[]" };

const SECRET = process.env.SESSION_SECRET || "chekata-hotel-dev-secret-change-in-production";

export function dailyReportToken(date: string, env: DbEnvironment): string {
  return crypto.createHmac("sha256", SECRET).update(`daily-report:${env}:${date}`).digest("hex").slice(0, 40);
}

function publicBaseUrl(req?: Request): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "https";
    return `${proto}://${req.get("host")}`;
  }
  return "https://hms.thechekata.com";
}

export function dailyReportPublicUrl(date: string, req?: Request): string {
  const env = getCurrentEnvironment();
  const q = `token=${dailyReportToken(date, env)}${env === "test" ? "&env=test" : ""}`;
  return `${publicBaseUrl(req)}/api/public/daily-report/${date}/pdf?${q}`;
}

const kes = (v: number) => `KES ${Math.round(v || 0).toLocaleString("en-KE")}`;

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function nairobiClock(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Short plain-text version used for WhatsApp / SMS / push bodies.
export function dailyReportText(s: Summary, hotelName: string): string {
  const lines: string[] = [];
  lines.push(`${hotelName} — Daily close, ${longDate(s.date)}`);
  lines.push(`Income today: ${kes(s.income.totalToday)} (yesterday ${kes(s.income.totalYesterday)}, MTD ${kes(s.income.totalMtd)})`);
  for (const st of [...s.income.streams].sort((a, b) => b.today - a.today)) {
    if (st.today > 0) lines.push(`• ${st.label}: ${kes(st.today)}`);
  }
  if (s.rooms) lines.push(`Occupancy ${s.rooms.occupancyPct}% (${s.rooms.inHouse}/${s.rooms.total}) · ${s.rooms.arrivals} arrivals · ${s.rooms.departures} departures`);
  if (s.cash) lines.push(`Cash & bank: ${kes(s.cash.total)}`);
  if (s.expenses) lines.push(`Expenses today: ${kes(s.expenses.today)}`);
  if (s.approvals.total > 0) lines.push(`Awaiting approval: ${s.approvals.total}`);
  const urgent = s.alerts.filter((a) => a.severity !== "info").length;
  if (urgent > 0) lines.push(`Alerts needing attention: ${urgent}`);
  return lines.join("\n");
}

export function buildDailyReportPdf(settings: Settings, s: Summary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const accent = "#b5502f";
    const dark = "#2a2118";
    const muted = "#6b6157";
    const rule = "#d9d0c4";
    const L = 50;
    const R = 545;
    const W = R - L;
    const bottom = 780;

    // ---- Header ----
    const logoSize = 46;
    const textX = LOGO_EXISTS ? L + logoSize + 12 : L;
    if (LOGO_EXISTS) {
      try { doc.image(LOGO_PATH, L, 48, { width: logoSize, height: logoSize }); } catch { /* text-only header */ }
    }
    drawCompanyHeaderName(doc, companyDisplayName(settings), textX, 50, 330 - textX - 10, accent);
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    let hy = 78;
    if (settings.hotelAddress) { doc.text(settings.hotelAddress, textX, hy, { width: 330 - textX }); hy += 13; }
    if (settings.hotelPhone) { doc.text(`Tel: ${settings.hotelPhone}`, textX, hy); hy += 13; }
    doc.fillColor(dark).fontSize(16).font("Helvetica-Bold").text("DAILY CLOSE REPORT", 330, 50, { width: 215, align: "right" });
    doc.fillColor(muted).fontSize(9).font("Helvetica");
    doc.text(longDate(s.date), 330, 72, { width: 215, align: "right" });
    doc.text(`Generated ${nairobiClock(s.generatedAt)} (EAT)`, 330, 86, { width: 215, align: "right" });
    let y = Math.max(hy, 104) + 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(rule).lineWidth(1).stroke();
    y += 14;

    const ensure = (h: number) => {
      if (y + h > bottom) { doc.addPage(); y = 50; }
    };
    const heading = (t: string) => {
      ensure(40);
      doc.fillColor(accent).font("Helvetica-Bold").fontSize(11).text(t.toUpperCase(), L, y, { characterSpacing: 0.5 });
      y += 18;
    };
    // cols: [label, width, align]
    const table = (cols: [string, number, "left" | "right"][], rows: string[][], opts: { totalRow?: boolean } = {}) => {
      ensure(22);
      let x = L;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(muted);
      for (const [label, w, align] of cols) { doc.text(label, x + 4, y, { width: w - 8, align }); x += w; }
      y += 14;
      doc.moveTo(L, y - 3).lineTo(R, y - 3).strokeColor(rule).lineWidth(0.7).stroke();
      rows.forEach((r, i) => {
        const isTotal = opts.totalRow && i === rows.length - 1;
        doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
        const h = Math.max(...r.map((cell, ci) => doc.heightOfString(cell, { width: cols[ci][1] - 8 }))) + 6;
        ensure(h);
        if (isTotal) doc.moveTo(L, y - 2).lineTo(R, y - 2).strokeColor(dark).lineWidth(0.8).stroke();
        let cx = L;
        r.forEach((cell, ci) => {
          doc.fillColor(dark).text(cell, cx + 4, y + 1, { width: cols[ci][1] - 8, align: cols[ci][2] });
          cx += cols[ci][1];
        });
        y += h;
      });
      y += 10;
    };
    const kv = (pairs: [string, string][]) => table([["Item", W * 0.62, "left"], ["Value", W * 0.38, "right"]], pairs.map(([a, b]) => [a, b]));

    // ---- Headline figures ----
    const kpis: [string, string][] = [["Income today", kes(s.income.totalToday)]];
    if (s.rooms) kpis.push(["Occupancy", `${s.rooms.occupancyPct}%`]);
    if (s.cash) kpis.push(["Cash & bank", kes(s.cash.total)]);
    kpis.push(["Awaiting approval", String(s.approvals.total)]);
    const bw = (W - (kpis.length - 1) * 8) / kpis.length;
    kpis.forEach(([label, value], i) => {
      const bx = L + i * (bw + 8);
      doc.roundedRect(bx, y, bw, 48, 4).fillAndStroke("#f7f2ea", rule);
      doc.fillColor(muted).font("Helvetica").fontSize(8.5).text(label, bx + 8, y + 8, { width: bw - 16 });
      doc.fillColor(dark).font("Helvetica-Bold").fontSize(14).text(value, bx + 8, y + 22, { width: bw - 16, lineBreak: false, ellipsis: true });
    });
    y += 62;

    // ---- Income ----
    heading("Income today by stream");
    const streams = [...s.income.streams].sort((a, b) => b.today - a.today);
    const incomeRows = streams.map((st) => [st.label, String(st.todayCount || "—"), kes(st.today), kes(st.yesterday), kes(st.mtd)]);
    incomeRows.push(["Total", "", kes(s.income.totalToday), kes(s.income.totalYesterday), kes(s.income.totalMtd)]);
    table(
      [["Stream", W * 0.34, "left"], ["Txns", W * 0.1, "right"], ["Today", W * 0.19, "right"], ["Yesterday", W * 0.18, "right"], ["Month to date", W * 0.19, "right"]],
      incomeRows,
      { totalRow: true },
    );
    doc.fillColor(muted).font("Helvetica").fontSize(8).text("Recognised on check-in, event, show and sale dates; rent on payment date. Net of credit notes.", L, y - 6, { width: W });
    y += 10;

    // ---- Operations ----
    if (s.rooms || s.events.length || s.shows.length || s.people) {
      heading("Operations");
      const ops: [string, string][] = [];
      if (s.rooms) {
        ops.push(["Occupancy", `${s.rooms.occupancyPct}% · ${s.rooms.inHouse} of ${s.rooms.total} rooms`]);
        ops.push(["Arrivals / departures", `${s.rooms.arrivals} / ${s.rooms.departures}`]);
        ops.push(["Rooms out of order", String(s.rooms.outOfOrder)]);
      }
      if (s.people) ops.push(["Staff on duty", `${s.people.activeStaff - s.people.onLeaveToday} of ${s.people.activeStaff}${s.people.onLeaveToday ? ` (on leave: ${s.people.names.join(", ")})` : ""}`]);
      if (ops.length) kv(ops);
      if (s.arrivals.length) {
        table([["Arriving guest", W * 0.45, "left"], ["Room", W * 0.3, "left"], ["Balance", W * 0.25, "right"]], s.arrivals.map((a) => [a.guestName, a.roomName ?? "—", a.balance > 0 ? `${kes(a.balance)} due` : "Paid"]));
      }
      if (s.events.length) {
        table([["Event client", W * 0.36, "left"], ["Venue", W * 0.26, "left"], ["Time", W * 0.18, "left"], ["Amount", W * 0.2, "right"]], s.events.map((e) => [e.clientName, e.facilityName ?? "—", [e.startTime, e.endTime].filter(Boolean).join("–") || "—", kes(e.amount)]));
      }
      if (s.shows.length) {
        table([["Movie show", W * 0.55, "left"], ["Time", W * 0.2, "left"], ["Seats sold", W * 0.25, "right"]], s.shows.map((m) => [m.title, m.time ?? "—", `${m.sold}/${m.capacity}`]));
      }
    }

    // ---- Money position ----
    if (s.cash || s.receivables.length || s.expenses || s.budget) {
      heading("Money position");
      if (s.cash) {
        const rows = s.cash.accounts.map((a) => [a.name, kes(a.balance)]);
        rows.push(["Total cash & bank", kes(s.cash.total)]);
        table([["Account", W * 0.62, "left"], ["Balance", W * 0.38, "right"]], rows, { totalRow: true });
      }
      if (s.receivables.length) {
        const rows = s.receivables.map((r) => [r.label, String(r.count), kes(r.amount)]);
        rows.push(["Total owed to the hotel", "", kes(s.receivables.reduce((a, r) => a + r.amount, 0))]);
        table([["Owed to the hotel", W * 0.52, "left"], ["Open", W * 0.14, "right"], ["Amount", W * 0.34, "right"]], rows, { totalRow: true });
      }
      const m: [string, string][] = [];
      if (s.expenses) { m.push(["Expenses today", kes(s.expenses.today)]); m.push(["Expenses month to date", kes(s.expenses.mtd)]); }
      if (s.budget && s.budget.budgeted > 0) {
        m.push([`Income vs budget (${s.budget.month})`, `${s.budget.pctOfBudget}% · ${kes(s.budget.actual)} of ${kes(s.budget.budgeted)}`]);
        m.push(["Pro-rata target by today", kes(s.budget.proRataBudget)]);
      }
      if (m.length) kv(m);
    }

    // ---- Approvals & alerts ----
    heading("Approvals & alerts");
    const waiting = s.approvals.byType.filter((a) => a.count > 0);
    if (waiting.length) {
      table([["Awaiting approval", W * 0.62, "left"], ["Count", W * 0.38, "right"]], waiting.map((a) => [a.label, String(a.count)]));
    } else {
      doc.fillColor(dark).font("Helvetica").fontSize(9.5).text("No approvals waiting.", L, y); y += 18;
    }
    if (s.alerts.length) {
      const sev = { critical: "Urgent", warning: "Check", info: "FYI" } as const;
      table([["Level", W * 0.12, "left"], ["Alert", W * 0.88, "left"]], s.alerts.map((a) => [sev[a.severity], a.detail ? `${a.title} — ${a.detail}` : a.title]));
    }

    // ---- Footer on every page ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing below the bottom margin would make pdfkit start a new page.
      doc.page.margins.bottom = 0;
      doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(
        `CHAIMS · Daily close report · ${s.date} · Page ${i - range.start + 1} of ${range.count} · Balances and approvals are as at the time generated.`,
        L, 812, { width: W, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}

function splitList(v: string | null | undefined): string[] {
  return (v ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

export interface DailyReportSendResult { date: string; emails: { to: string; ok: boolean; error?: string }[]; sms: { to: string; ok: boolean; error?: string }[]; pushed: number }

// Sends the report through every configured channel. Used by the scheduler and "Send now".
export async function sendDailyReport(date: string, req?: Request): Promise<DailyReportSendResult> {
  const settings = await storage.getSettings();
  const summary = await buildDirectorSummary(OWNER_VIEW, date);
  const hotelName = settings.hotelName || "The Chekata";
  const pdf = await buildDailyReportPdf(settings, summary);
  const link = dailyReportPublicUrl(date, req);
  const text = dailyReportText(summary, hotelName);
  const result: DailyReportSendResult = { date, emails: [], sms: [], pushed: 0 };

  const html = `<div style="font-family:Arial,sans-serif;color:#2a2118;font-size:14px;line-height:1.5">
    <p>Good evening,</p>
    <p>Here is today's close for <strong>${hotelName}</strong>. The full report is attached as a PDF.</p>
    <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;background:#f7f2ea;padding:12px;border-radius:6px">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
    <p style="color:#6b6157;font-size:12px">Sent automatically by CHAIMS. Change recipients or time in Settings → Daily close report.</p></div>`;
  for (const to of splitList(settings.dailyReportEmails)) {
    const r = await sendTransactionalEmail({ settings, to, subject: `${hotelName} — Daily close ${date}`, html, attachment: { filename: `daily-close-${date}.pdf`, content: pdf } });
    result.emails.push({ to, ok: r.ok, error: r.error });
  }
  if (settings.smsEnabled) {
    for (const to of splitList(settings.dailyReportSmsPhones)) {
      const r = await sendSms({ settings, to, message: `${hotelName} close ${date}: income ${kes(summary.income.totalToday)}, occupancy ${summary.rooms?.occupancyPct ?? 0}%, ${summary.approvals.total} approvals pending. PDF: ${link}` });
      result.sms.push({ to, ok: r.ok, error: r.error });
    }
  }
  if (settings.dailyReportPush) {
    const users = await storage.listUsers();
    const admins = users.filter((u: any) => u.active && u.isAdmin).map((u: any) => u.id as number);
    await notifyUserIds(admins, { category: "report", title: `Daily close ${date}: ${kes(summary.income.totalToday)}`, body: `Occupancy ${summary.rooms?.occupancyPct ?? 0}% · ${summary.approvals.total} approvals pending. Tap to open today's briefing.`, linkPath: "/" });
    result.pushed = admins.length;
  }
  return result;
}

function nairobiNowHHMM(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
}

// Checks every 5 minutes; sends once per day (Live only) at/after the configured time.
// The daily_report_log row is claimed before sending, so a restart or a second
// process can never double-send.
export function startDailyReportSchedule(log: (m: string) => void) {
  const tick = () =>
    runWithEnvironment("live", async () => {
      try {
        const settings = await storage.getSettings();
        if (!settings.dailyReportEnabled) return;
        const time = /^\d{2}:\d{2}$/.test(settings.dailyReportTime || "") ? settings.dailyReportTime : "21:00";
        if (nairobiNowHHMM() < time) return;
        const date = hotelToday();
        const claimed = await sql`INSERT INTO daily_report_log (report_date, sent_at) VALUES (${date}, ${Date.now()}) ON CONFLICT (report_date) DO NOTHING RETURNING report_date`;
        if (claimed.length === 0) return;
        const r = await sendDailyReport(date);
        const summary = `emails ${r.emails.filter((e) => e.ok).length}/${r.emails.length}, sms ${r.sms.filter((e) => e.ok).length}/${r.sms.length}, push ${r.pushed}`;
        await sql`UPDATE daily_report_log SET result = ${JSON.stringify(r)} WHERE report_date = ${date}`;
        log(`daily close report ${date} sent: ${summary}`);
      } catch (err: any) {
        log(`daily close report failed: ${err?.message ?? err}`);
      }
    });
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60 * 1000);
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Public (no-login) PDF — must be registered BEFORE app.use("/api", requireAuth).
export function registerPublicDailyReportRoute(app: Express) {
  app.get("/api/public/daily-report/:date/pdf", async (req, res) => {
    const date = req.params.date;
    const env: DbEnvironment = req.query.env === "test" ? "test" : "live";
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const expected = isDate(date) ? dailyReportToken(date, env) : "";
    if (!expected || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      await runWithEnvironment(env, async () => {
        const settings = await storage.getSettings();
        const pdf = await buildDailyReportPdf(settings, await buildDirectorSummary(OWNER_VIEW, date));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="daily-close-${date}.pdf"`);
        res.send(pdf);
      });
    } catch {
      res.status(404).json({ error: "Not found" });
    }
  });
}

// Signed-in routes — registered after requireAuth.
export function registerDailyReportRoutes(app: Express, requireAdmin: (req: any, res: any, next: any) => void) {
  // The signed-in user's own view (permission-filtered), as a PDF download.
  app.get("/api/director/daily-report/pdf", async (req, res) => {
    try {
      const date = isDate(req.query.date) ? req.query.date : hotelToday();
      const settings = await storage.getSettings();
      const pdf = await buildDailyReportPdf(settings, await buildDirectorSummary((req as any).user, date));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="daily-close-${date}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to build report" });
    }
  });

  // Text + signed PDF link for WhatsApp sharing. Admin-only because the link
  // exposes the full (unfiltered) owner report.
  app.get("/api/director/daily-report/share", requireAdmin, async (req, res) => {
    try {
      const date = isDate(req.query.date) ? req.query.date : hotelToday();
      const settings = await storage.getSettings();
      const summary = await buildDirectorSummary(OWNER_VIEW, date);
      res.json({ date, url: dailyReportPublicUrl(date, req), text: dailyReportText(summary, settings.hotelName || "The Chekata"), whatsappPhone: settings.dailyReportWhatsappPhone || null });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to prepare share" });
    }
  });

  // Send through all configured channels right now (does not affect the schedule).
  app.post("/api/director/daily-report/send", requireAdmin, async (req, res) => {
    try {
      const date = isDate(req.body?.date) ? req.body.date : hotelToday();
      res.json(await sendDailyReport(date, req));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to send report" });
    }
  });

  app.get("/api/director/daily-report/log", requireAdmin, async (_req, res) => {
    const rows = await sql`SELECT report_date, sent_at, result FROM daily_report_log ORDER BY report_date DESC LIMIT 14`;
    res.json(rows.map((r: any) => ({ date: r.report_date, sentAt: Number(r.sent_at), result: r.result ? JSON.parse(r.result) : null })));
  });
}
