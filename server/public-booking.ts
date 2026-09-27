// Public online booking (no login): guests view scheduled shows, pick movie seats or request a
// restaurant/bar table, pay by M-Pesa and paste the confirmation SMS. Nothing is held until a
// readable, unused, sufficient M-Pesa message is submitted; the office then verifies or rejects.
import type { Express, NextFunction, Request, Response } from "express";
import { sql, storage } from "./storage";
import { parsePermissions, requireModule } from "./auth";
import { MOVIE_SEAT_NUMBERS, type AccommodationBooking, type Room, MOVIE_SEAT_ROWS, TABLE_RESERVATION_STATUSES, type ModuleKey, type OnlinePayment, type TableReservation } from "@shared/schema";
import { parseMpesaMessage, recipientMatches } from "@shared/mpesa";
import { duplicateRefMessage, findReferenceUse, inFlight, normalizeRef } from "./payment-refs";
import { notifyModuleUsers } from "./director";
import { sendSms } from "./sms";
import { issueDocument } from "./documents";

// ---------- helpers ----------
function nairobiNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}
const PHONE_RE = /^(?:\+?254|0)?[17]\d{8}$/;
const cleanPhone = (p: unknown) => (typeof p === "string" ? p.replace(/[\s-]/g, "") : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const genRef = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const todayLabel = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Tiny in-memory rate limiter (per IP) for the public write endpoints.
const hits = new Map<string, number[]>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}|${req.ip}`;
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    list.push(now);
    hits.set(key, list);
    next();
  };
}

function rowToPayment(r: any): OnlinePayment {
  return {
    id: r.id, kind: r.kind, targetRef: r.target_ref, guestName: r.guest_name, guestPhone: r.guest_phone, guestEmail: r.guest_email,
    mpesaCode: r.mpesa_code, amount: Number(r.amount), amountDue: Number(r.amount_due), paidAt: r.paid_at == null ? null : Number(r.paid_at),
    payerName: r.payer_name, recipient: r.recipient, rawMessage: r.raw_message, status: r.status, reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at == null ? null : Number(r.reviewed_at), reviewNote: r.review_note, createdAt: Number(r.created_at), summary: r.summary,
  };
}
function rowToReservation(r: any): TableReservation {
  return {
    id: r.id, reservationRef: r.reservation_ref, outlet: r.outlet, tableId: r.table_id, guestName: r.guest_name, guestPhone: r.guest_phone,
    guestEmail: r.guest_email, reservationDate: r.reservation_date, reservationTime: r.reservation_time, partySize: r.party_size, notes: r.notes,
    status: r.status, source: r.source, depositAmount: Number(r.deposit_amount), depositPaid: Number(r.deposit_paid),
    paymentReference: r.payment_reference, createdAt: Number(r.created_at),
  };
}

type Check = { ok: true; code: string; amount: number; paidAt: number | null; payerName: string | null; recipient: string | null } | { ok: false; error: string };

// Validates a pasted M-Pesa message against the amount due. Authoritative server-side check.
async function checkMpesa(raw: unknown, amountDue: number): Promise<Check> {
  const message = str(raw, 1000);
  if (!message) return { ok: false, error: "Paste the M-Pesa confirmation message you received after paying." };
  const p = parseMpesaMessage(message);
  if (!p.code) return { ok: false, error: "We couldn't find an M-Pesa transaction code in that message. Paste the full SMS from M-PESA." };
  if (p.amount == null) return { ok: false, error: "We couldn't read the amount paid in that message. Paste the full SMS from M-PESA." };
  if (p.direction === "received") return { ok: false, error: "That looks like a message received by the business. Paste the confirmation SMS on the phone that paid." };
  if (p.amount + 0.5 < amountDue) return { ok: false, error: `The message shows ${kes(p.amount)} but ${kes(amountDue)} is due. Please contact reception to settle the balance.` };
  const settings = await storage.getSettings();
  const maxAgeH = Math.max(1, Number(settings.mpesaMessageMaxAgeHours) || 24);
  if (p.paidAt != null) {
    if (Date.now() - p.paidAt > maxAgeH * 3600_000) return { ok: false, error: `That payment is older than ${maxAgeH} hours. Please contact reception.` };
    if (p.paidAt - Date.now() > 2 * 3600_000) return { ok: false, error: "The payment date in that message is in the future. Please paste the original message." };
  }
  const ref = normalizeRef(p.code);
  if (inFlight.has(ref)) return { ok: false, error: duplicateRefMessage(ref, "another booking being submitted right now") };
  const used = await findReferenceUse(ref);
  if (used) return { ok: false, error: `This M-Pesa code (${ref}) has already been used. Each payment can only be used once.` };
  return { ok: true, code: ref, amount: p.amount, paidAt: p.paidAt, payerName: p.counterpartyName, recipient: p.recipient };
}

async function insertPayment(input: {
  kind: "movie" | "table" | "room"; targetRef: string; guestName: string; guestPhone: string; guestEmail: string | null;
  check: Extract<Check, { ok: true }>; amountDue: number; rawMessage: string; summary: string;
}): Promise<OnlinePayment> {
  const rows = await sql`INSERT INTO online_payments (kind, target_ref, guest_name, guest_phone, guest_email, mpesa_code, amount, amount_due, paid_at, payer_name, recipient, raw_message, status, summary, created_at)
    VALUES (${input.kind}, ${input.targetRef}, ${input.guestName}, ${input.guestPhone}, ${input.guestEmail}, ${input.check.code}, ${input.check.amount}, ${input.amountDue},
      ${input.check.paidAt}, ${input.check.payerName}, ${input.check.recipient}, ${input.rawMessage}, 'pending', ${input.summary}, ${Date.now()})
    RETURNING *` as any[];
  return rowToPayment(rows[0]);
}

async function upcomingShows() {
  const { date, time } = nairobiNow();
  const shows = (await storage.listMovieShows())
    .filter((s) => s.status === "scheduled" && (s.showDate > date || (s.showDate === date && (s.endTime || s.startTime) >= time)))
    .sort((a, b) => (a.showDate + a.startTime).localeCompare(b.showDate + b.startTime));
  const bookings = await storage.listMovieSeatBookings();
  return shows.map((s) => {
    const taken = bookings.filter((b) => b.showId === s.id && b.status !== "cancelled").map((b) => `${b.seatRow}${b.seatNumber}`);
    return { id: s.id, name: s.name, showDate: s.showDate, startTime: s.startTime, endTime: s.endTime, ticketPrice: s.ticketPrice, notes: s.notes, takenSeats: taken, totalSeats: MOVIE_SEAT_ROWS.length * MOVIE_SEAT_NUMBERS.length };
  });
}

// ---------- rooms ----------
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nightsOf = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Bookings that block a room: anything not cancelled / checked out (pending online payments hold the room too).
const blocks = (b: AccommodationBooking) => b.status !== "cancelled" && b.status !== "checked_out";
const overlaps = (b: AccommodationBooking, checkIn: string, checkOut: string) => b.checkIn < checkOut && b.checkOut > checkIn;
export const typeLabel = (t: string) => t.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function freeRooms(checkIn: string, checkOut: string): Promise<Room[]> {
  const [rooms, bookings] = await Promise.all([storage.listRooms(), storage.listAccommodationBookings()]);
  return rooms.filter((r) => r.status !== "maintenance" && !bookings.some((b) => b.roomId === r.id && blocks(b) && overlaps(b, checkIn, checkOut)));
}

// Guests choose a room category (type + nightly rate); the office sees the exact room assigned.
async function roomOptions(checkIn: string, checkOut: string) {
  const [all, free] = await Promise.all([storage.listRooms(), freeRooms(checkIn, checkOut)]);
  const groups = new Map<string, { key: string; type: string; label: string; rate: number; total: number; available: number }>();
  for (const r of all.filter((x) => x.status !== "maintenance")) {
    const key = `${r.type}|${r.rate}`;
    const g = groups.get(key) ?? { key, type: r.type, label: typeLabel(r.type), rate: r.rate, total: 0, available: 0 };
    g.total += 1;
    if (free.some((f) => f.id === r.id)) g.available += 1;
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => a.rate - b.rate || a.label.localeCompare(b.label));
}

function validateStay(s: any, checkIn: string, checkOut: string): string | null {
  const { date: today } = nairobiNow();
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) return "Choose check-in and check-out dates.";
  if (checkIn < today) return "Check-in can't be in the past.";
  const nights = nightsOf(checkIn, checkOut);
  if (nights < 1) return "Check-out must be at least one night after check-in.";
  const maxN = s.publicRoomMaxNights || 30;
  if (nights > maxN) return `Online bookings are limited to ${maxN} nights. Please call reception for longer stays.`;
  const adv = s.publicRoomAdvanceDays || 365;
  if (checkIn > addDays(today, adv)) return `Rooms can be booked up to ${adv} days ahead.`;
  return null;
}
const payPercent = (s: any) => Math.min(100, Math.max(1, Number(s.publicRoomPayPercent) || 100));
const payNow = (s: any, total: number) => Math.ceil((total * payPercent(s)) / 100);

function hasModule(user: any, key: ModuleKey) {
  return !!user && (user.isAdmin || parsePermissions(user.permissions).includes(key));
}

// ---------- public routes (register BEFORE requireAuth) ----------
export function registerPublicBookingRoutes(app: Express) {
  app.get("/book", (_req, res) => res.redirect(302, "/#/book"));

  app.get("/api/public/booking-info", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      res.json({
        hotelName: s.hotelName, hotelPhone: s.hotelPhone, hotelEmail: s.hotelEmail,
        movieEnabled: !!s.publicMovieBookingEnabled, tableEnabled: !!s.publicTableBookingEnabled, roomEnabled: !!s.publicRoomBookingEnabled,
        roomPayPercent: payPercent(s), roomMaxNights: s.publicRoomMaxNights || 30, roomAdvanceDays: s.publicRoomAdvanceDays || 365,
        roomCheckInTime: s.publicRoomCheckInTime || "14:00", roomCheckOutTime: s.publicRoomCheckOutTime || "10:00", roomMaxGuests: 2,
        mpesa: { type: s.mpesaPaymentType || "till", number: s.mpesaNumber || null, accountNumber: s.mpesaAccountNumber || null, businessName: s.mpesaBusinessName || s.hotelName },
        tableDeposit: Number(s.publicTableDeposit) || 0, tableMaxParty: s.publicTableMaxParty || 12,
        tableOpenTime: s.publicTableOpenTime || "07:00", tableCloseTime: s.publicTableCloseTime || "22:00",
        movieMaxSeats: s.publicMovieMaxSeats || 6, note: s.publicBookingNote || null,
        seatRows: MOVIE_SEAT_ROWS, seatNumbers: MOVIE_SEAT_NUMBERS, today: nairobiNow().date,
      });
    } catch { res.status(500).json({ error: "Booking is unavailable right now." }); }
  });

  app.get("/api/public/movie-shows", async (_req, res) => {
    try {
      // Scheduled shows are always viewable; seat booking itself is gated by publicMovieBookingEnabled.
      res.json(await upcomingShows());
    } catch { res.status(500).json({ error: "Shows are unavailable right now." }); }
  });

  app.get("/api/public/room-availability", rateLimit(60, 10 * 60_000), async (req, res) => {
    try {
      const s = await storage.getSettings();
      const checkIn = str(req.query.checkIn, 10);
      const checkOut = str(req.query.checkOut, 10);
      const bad = validateStay(s, checkIn, checkOut);
      if (bad) return res.status(400).json({ error: bad });
      const nights = nightsOf(checkIn, checkOut);
      res.json({ checkIn, checkOut, nights, options: (await roomOptions(checkIn, checkOut)).map((o) => ({ ...o, stayTotal: o.rate * nights, payNow: payNow(s, o.rate * nights) })) });
    } catch { res.status(500).json({ error: "Room availability is unavailable right now." }); }
  });

  app.post("/api/public/room-bookings", rateLimit(8, 15 * 60_000), async (req, res) => {
    let lockedCode: string | null = null;
    try {
      const s = await storage.getSettings();
      if (!s.publicRoomBookingEnabled) return res.status(403).json({ error: "Online room booking is currently closed. Please contact reception." });
      const b = req.body ?? {};
      const guestName = str(b.guestName, 80);
      const guestPhone = cleanPhone(b.guestPhone);
      const guestEmail = str(b.guestEmail, 120) || null;
      const checkIn = str(b.checkIn, 10);
      const checkOut = str(b.checkOut, 10);
      const guests = Math.floor(Number(b.guests)) || 1;
      const notes = str(b.notes, 300) || null;
      if (guestName.length < 2) return res.status(400).json({ error: "Enter your name." });
      if (!PHONE_RE.test(guestPhone)) return res.status(400).json({ error: "Enter a valid Kenyan mobile number, e.g. 0712 345 678." });
      if (guestEmail && !EMAIL_RE.test(guestEmail)) return res.status(400).json({ error: "Enter a valid email address or leave it blank." });
      if (guests < 1 || guests > 2) return res.status(400).json({ error: "A room takes up to 2 guests. Book another room for more guests." });
      const bad = validateStay(s, checkIn, checkOut);
      if (bad) return res.status(400).json({ error: bad });
      const [type, rateStr] = str(b.roomOption, 120).split("|");
      const rate = Number(rateStr);
      const pick = () => freeRooms(checkIn, checkOut).then((rs) => rs.filter((r) => r.type === type && r.rate === rate).sort((a, z) => a.name.localeCompare(z.name))[0]);
      if (!(await pick())) return res.status(409).json({ error: "That room type is no longer available for those dates. Please choose another." });
      const nights = nightsOf(checkIn, checkOut);
      const total = rate * nights;
      const due = payNow(s, total);
      const check = await checkMpesa(b.mpesaMessage, due);
      if (!check.ok) return res.status(400).json({ error: check.error });
      lockedCode = check.code;
      inFlight.add(lockedCode);

      const ref = genRef("RMS");
      const label = typeLabel(type);
      const summary = `${label} room — ${nights} night${nights > 1 ? "s" : ""}, ${checkIn} to ${checkOut}, ${guests} guest${guests > 1 ? "s" : ""}`;
      const payment = await insertPayment({ kind: "room", targetRef: ref, guestName, guestPhone, guestEmail, check, amountDue: due, rawMessage: str(b.mpesaMessage, 1000), summary });
      try {
        const room = await pick(); // re-check right before writing
        if (!room) throw Object.assign(new Error("That room type is no longer available for those dates. Please choose another."), { status: 409 });
        await storage.createAccommodationBooking({
          roomId: room.id, guestName, guestPhone, guestEmail, checkIn, checkOut, rate, totalAmount: total, amountPaid: 0,
          paymentMethod: "mpesa", paymentReference: null, status: "pending_payment", numberOfGuests: guests,
          notes: `Online booking ${ref} — M-Pesa ${check.code} (${kes(check.amount)}) awaiting office verification${notes ? ` | Guest note: ${notes}` : ""}`,
          bookingRef: ref, source: "online", createdAt: Date.now(),
        } as any);
      } catch (err: any) {
        await sql`DELETE FROM online_payments WHERE id = ${payment.id}`;
        return res.status(err?.status ?? 500).json({ error: err?.status ? err.message : "Booking failed. Please try again." });
      }
      void notifyModuleUsers("accommodation", { category: "booking", title: `Online room booking — verify M-Pesa ${check.code}`, body: `${guestName}: ${summary}. Paid ${kes(check.amount)} of ${kes(total)}.`, linkPath: "/online-bookings" });
      void sendSms({ settings: s, to: guestPhone, message: `Hi ${guestName}, we received your room booking ${ref}: ${summary}. M-Pesa ${check.code} is being verified; we'll text you once confirmed. - ${s.hotelName}` }).catch(() => {});
      res.status(201).json({ ref, status: "pending", summary, amount: check.amount, mpesaCode: check.code });
    } catch (err: any) {
      if (/duplicate key|unique/i.test(String(err?.message))) return res.status(409).json({ error: "This M-Pesa code has already been used. Each payment can only be used once." });
      console.error("[public-booking] room booking failed:", err);
      res.status(500).json({ error: "Booking failed. Please try again or contact reception." });
    } finally { if (lockedCode) inFlight.delete(lockedCode); }
  });

  app.get("/api/public/booking-status", rateLimit(30, 10 * 60_000), async (req, res) => {
    const ref = str(req.query.ref, 40).toUpperCase();
    const phone = cleanPhone(req.query.phone).slice(-9);
    if (!ref || phone.length < 9) return res.status(400).json({ error: "Enter your booking reference and phone number." });
    const rows = await sql`SELECT * FROM online_payments WHERE UPPER(target_ref) = ${ref} ORDER BY id DESC LIMIT 1` as any[];
    const p = rows[0] ? rowToPayment(rows[0]) : null;
    if (!p || p.guestPhone.slice(-9) !== phone) return res.status(404).json({ error: "No booking found for that reference and phone number." });
    res.json({ ref: p.targetRef, kind: p.kind, status: p.status, summary: p.summary, note: p.status === "rejected" ? p.reviewNote : null });
  });

  app.post("/api/public/movie-bookings", rateLimit(8, 15 * 60_000), async (req, res) => {
    let lockedCode: string | null = null;
    try {
      const s = await storage.getSettings();
      if (!s.publicMovieBookingEnabled) return res.status(403).json({ error: "Online movie booking is currently closed. Please contact reception." });
      const b = req.body ?? {};
      const guestName = str(b.guestName, 80);
      const guestPhone = cleanPhone(b.guestPhone);
      const guestEmail = str(b.guestEmail, 120) || null;
      if (guestName.length < 2) return res.status(400).json({ error: "Enter your name." });
      if (!PHONE_RE.test(guestPhone)) return res.status(400).json({ error: "Enter a valid Kenyan mobile number, e.g. 0712 345 678." });
      if (guestEmail && !EMAIL_RE.test(guestEmail)) return res.status(400).json({ error: "Enter a valid email address or leave it blank." });
      const showId = Number(b.showId);
      const seats: { row: string; number: number }[] = Array.isArray(b.seats) ? b.seats.map((x: any) => ({ row: String(x?.row ?? ""), number: Number(x?.number) })) : [];
      const maxSeats = s.publicMovieMaxSeats || 6;
      if (seats.length === 0) return res.status(400).json({ error: "Select at least one seat." });
      if (seats.length > maxSeats) return res.status(400).json({ error: `You can book up to ${maxSeats} seats online.` });
      const keys = new Set<string>();
      for (const seat of seats) {
        if (!(MOVIE_SEAT_ROWS as readonly string[]).includes(seat.row) || !(MOVIE_SEAT_NUMBERS as readonly number[]).includes(seat.number)) return res.status(400).json({ error: "Invalid seat selected." });
        const k = `${seat.row}${seat.number}`;
        if (keys.has(k)) return res.status(400).json({ error: `Seat ${k} was selected twice.` });
        keys.add(k);
      }
      const show = (await upcomingShows()).find((x) => x.id === showId);
      if (!show) return res.status(400).json({ error: "That show is no longer available for booking." });
      const clash = seats.find((x) => show.takenSeats.includes(`${x.row}${x.number}`));
      if (clash) return res.status(409).json({ error: `Seat ${clash.row}${clash.number} has just been taken. Please choose another seat.` });
      const amountDue = show.ticketPrice * seats.length;
      const check = await checkMpesa(b.mpesaMessage, amountDue);
      if (!check.ok) return res.status(400).json({ error: check.error });
      lockedCode = check.code;
      inFlight.add(lockedCode);

      const bookingRef = genRef("MOV");
      const seatCodes = seats.map((x) => `${x.row}${x.number}`).sort();
      const summary = `${show.name} — Seat${seatCodes.length > 1 ? "s" : ""} ${seatCodes.join(", ")} (${show.showDate} ${show.startTime})`;
      const payment = await insertPayment({ kind: "movie", targetRef: bookingRef, guestName, guestPhone, guestEmail, check, amountDue, rawMessage: str(b.mpesaMessage, 1000), summary });
      const createdIds: number[] = [];
      try {
        // Re-check seats right before writing (another guest may have just booked).
        const live = await storage.listMovieSeatBookings();
        const taken = seats.find((x) => live.some((l) => l.showId === showId && l.status !== "cancelled" && l.seatRow === x.row && l.seatNumber === x.number));
        if (taken) throw Object.assign(new Error(`Seat ${taken.row}${taken.number} has just been taken. Please choose another seat.`), { status: 409 });
        for (const seat of seats) {
          const row = await storage.createMovieSeatBooking({
            showId, seatRow: seat.row, seatNumber: seat.number, guestName, guestPhone, guestEmail, ticketPrice: show.ticketPrice,
            amountPaid: 0, paymentMethod: "mpesa", paymentReference: check.code, status: "booked", bookingRef,
            notes: "Online booking — M-Pesa payment awaiting office verification", createdAt: Date.now(),
          } as any);
          createdIds.push(row.id);
        }
      } catch (err: any) {
        for (const id of createdIds) await storage.updateMovieSeatBooking(id, { status: "cancelled" } as any).catch(() => {});
        await sql`DELETE FROM online_payments WHERE id = ${payment.id}`;
        return res.status(err?.status ?? 500).json({ error: err?.message ?? "Booking failed. Please try again." });
      }

      void notifyModuleUsers("movie-room", { category: "booking", title: `Online movie booking — verify M-Pesa ${check.code}`, body: `${guestName}: ${summary}. Paid ${kes(check.amount)}.`, linkPath: "/online-bookings" });
      void sendSms({ settings: s, to: guestPhone, message: `Hi ${guestName}, we received your Movie Room booking ${bookingRef}: ${summary}. M-Pesa ${check.code} is being verified; we'll text you once confirmed. - ${s.hotelName}` }).catch(() => {});
      res.status(201).json({ ref: bookingRef, status: "pending", summary, amount: check.amount, mpesaCode: check.code });
    } catch (err: any) {
      if (/duplicate key|unique/i.test(String(err?.message))) return res.status(409).json({ error: "This M-Pesa code has already been used. Each payment can only be used once." });
      console.error("[public-booking] movie booking failed:", err);
      res.status(500).json({ error: "Booking failed. Please try again or contact reception." });
    } finally { if (lockedCode) inFlight.delete(lockedCode); }
  });

  app.post("/api/public/table-reservations", rateLimit(8, 15 * 60_000), async (req, res) => {
    let lockedCode: string | null = null;
    try {
      const s = await storage.getSettings();
      if (!s.publicTableBookingEnabled) return res.status(403).json({ error: "Online table reservations are currently closed. Please contact reception." });
      const b = req.body ?? {};
      const guestName = str(b.guestName, 80);
      const guestPhone = cleanPhone(b.guestPhone);
      const guestEmail = str(b.guestEmail, 120) || null;
      const outlet = b.outlet === "bar" ? "bar" : "restaurant";
      const date = str(b.date, 10);
      const time = str(b.time, 5);
      const partySize = Math.floor(Number(b.partySize));
      const notes = str(b.notes, 300) || null;
      const { date: today, time: nowTime } = nairobiNow();
      const maxParty = s.publicTableMaxParty || 12;
      const open = s.publicTableOpenTime || "07:00";
      const close = s.publicTableCloseTime || "22:00";
      if (guestName.length < 2) return res.status(400).json({ error: "Enter your name." });
      if (!PHONE_RE.test(guestPhone)) return res.status(400).json({ error: "Enter a valid Kenyan mobile number, e.g. 0712 345 678." });
      if (guestEmail && !EMAIL_RE.test(guestEmail)) return res.status(400).json({ error: "Enter a valid email address or leave it blank." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return res.status(400).json({ error: "Choose today or a future date." });
      const maxDate = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
      if (date > maxDate) return res.status(400).json({ error: "Reservations can be made up to 90 days ahead." });
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || time < open || time > close) return res.status(400).json({ error: `Choose a time between ${open} and ${close}.` });
      if (date === today && time <= nowTime) return res.status(400).json({ error: "That time has already passed today." });
      if (!(partySize >= 1 && partySize <= maxParty)) return res.status(400).json({ error: `Party size must be between 1 and ${maxParty}. For larger groups please call reception.` });

      const deposit = Math.max(0, Number(s.publicTableDeposit) || 0);
      let check: Extract<Check, { ok: true }> | null = null;
      if (deposit > 0) {
        const c = await checkMpesa(b.mpesaMessage, deposit);
        if (!c.ok) return res.status(400).json({ error: c.error });
        check = c;
        lockedCode = c.code;
        inFlight.add(lockedCode);
      }
      const ref = genRef("TBL");
      const outletLabel = outlet === "bar" ? "Bar" : "Restaurant";
      const summary = `${outletLabel} table for ${partySize} — ${date} ${time}`;
      let payment: OnlinePayment | null = null;
      if (check) payment = await insertPayment({ kind: "table", targetRef: ref, guestName, guestPhone, guestEmail, check, amountDue: deposit, rawMessage: str(b.mpesaMessage, 1000), summary });
      try {
        await sql`INSERT INTO table_reservations (reservation_ref, outlet, guest_name, guest_phone, guest_email, reservation_date, reservation_time, party_size, notes, status, source, deposit_amount, deposit_paid, payment_reference, created_at)
          VALUES (${ref}, ${outlet}, ${guestName}, ${guestPhone}, ${guestEmail}, ${date}, ${time}, ${partySize}, ${notes}, 'awaiting_verification', 'online', ${deposit}, 0, ${check?.code ?? null}, ${Date.now()})`;
      } catch (err) {
        if (payment) await sql`DELETE FROM online_payments WHERE id = ${payment.id}`;
        throw err;
      }
      void notifyModuleUsers("bar-restaurant", { category: "booking", title: check ? `Table reservation — verify M-Pesa ${check.code}` : "New online table reservation", body: `${guestName}: ${summary}.${check ? ` Deposit ${kes(check.amount)}.` : ""}`, linkPath: "/online-bookings" });
      void sendSms({ settings: s, to: guestPhone, message: `Hi ${guestName}, we received your table reservation ${ref}: ${summary}.${check ? ` M-Pesa ${check.code} is being verified;` : ""} we'll text you once confirmed. - ${s.hotelName}` }).catch(() => {});
      res.status(201).json({ ref, status: "pending", summary, amount: check?.amount ?? 0, mpesaCode: check?.code ?? null });
    } catch (err: any) {
      if (/duplicate key|unique/i.test(String(err?.message))) return res.status(409).json({ error: "This M-Pesa code has already been used. Each payment can only be used once." });
      console.error("[public-booking] table reservation failed:", err);
      res.status(500).json({ error: "Reservation failed. Please try again or contact reception." });
    } finally { if (lockedCode) inFlight.delete(lockedCode); }
  });
}

// ---------- staff routes (register AFTER requireAuth) ----------
const KIND_MODULE: Record<OnlinePayment["kind"], ModuleKey> = { movie: "movie-room", table: "bar-restaurant", room: "accommodation" };
function requireAnyBookingModule(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (hasModule(user, "movie-room") || hasModule(user, "bar-restaurant") || hasModule(user, "accommodation")) return next();
  res.status(403).json({ error: "You don't have access to this module" });
}

export function registerOnlineBookingStaffRoutes(app: Express) {
  app.get("/api/online-payments", requireAnyBookingModule, async (req, res) => {
    const user = (req as any).user;
    const kinds = [hasModule(user, "movie-room") ? "movie" : null, hasModule(user, "bar-restaurant") ? "table" : null, hasModule(user, "accommodation") ? "room" : null].filter(Boolean) as string[];
    const rows = await sql`SELECT * FROM online_payments WHERE kind IN ${sql(kinds)} ORDER BY created_at DESC LIMIT 500` as any[];
    const s = await storage.getSettings();
    res.json(rows.map((r) => {
      const p = rowToPayment(r);
      const parsed = parseMpesaMessage(p.rawMessage);
      return { ...p, recipientOk: recipientMatches(parsed, s.mpesaBusinessName || s.hotelName, s.mpesaNumber), amountOk: p.amount + 0.5 >= p.amountDue };
    }));
  });

  app.get("/api/online-payments/pending-count", requireAnyBookingModule, async (req, res) => {
    const user = (req as any).user;
    const kinds = [hasModule(user, "movie-room") ? "movie" : null, hasModule(user, "bar-restaurant") ? "table" : null, hasModule(user, "accommodation") ? "room" : null].filter(Boolean) as string[];
    const rows = await sql`SELECT COUNT(*)::int AS n FROM online_payments WHERE status = 'pending' AND kind IN ${sql(kinds)}` as any[];
    res.json({ count: rows[0]?.n ?? 0 });
  });

  async function loadForReview(req: Request, res: Response): Promise<OnlinePayment | null> {
    const rows = await sql`SELECT * FROM online_payments WHERE id = ${Number(req.params.id)}` as any[];
    const p = rows[0] ? rowToPayment(rows[0]) : null;
    if (!p) { res.status(404).json({ error: "Payment not found" }); return null; }
    if (!hasModule((req as any).user, KIND_MODULE[p.kind])) { res.status(403).json({ error: "You don't have access to this module" }); return null; }
    if (p.status !== "pending") { res.status(409).json({ error: `This payment was already ${p.status}.` }); return null; }
    return p;
  }

  app.post("/api/online-payments/:id/verify", requireAnyBookingModule, async (req, res) => {
    try {
      const p = await loadForReview(req, res);
      if (!p) return;
      const user = (req as any).user;
      const who = user.fullName ?? user.username;
      const note = str(req.body?.note, 300) || null;
      if (p.kind === "room") {
        const bk = (await storage.listAccommodationBookings()).find((x) => x.bookingRef === p.targetRef);
        if (!bk || bk.status === "cancelled") return res.status(409).json({ error: "This room booking was cancelled in Accommodation. Reject the payment instead and refund the guest if needed." });
      }
      // Claim it atomically so two staff can't verify the same payment.
      const claimed = await sql`UPDATE online_payments SET status = 'verified', reviewed_by = ${who}, reviewed_at = ${Date.now()}, review_note = ${note} WHERE id = ${p.id} AND status = 'pending' RETURNING id` as any[];
      if (!claimed.length) return res.status(409).json({ error: "This payment was already reviewed." });
      const s = await storage.getSettings();
      let docResult: any = null;
      if (p.kind === "movie") {
        const seats = (await storage.listMovieSeatBookings()).filter((b) => b.bookingRef === p.targetRef && b.status !== "cancelled");
        let remaining = p.amount;
        for (const seat of seats) {
          const pay = Math.min(remaining, seat.ticketPrice);
          remaining -= pay;
          await storage.updateMovieSeatBooking(seat.id, { amountPaid: pay, paymentMethod: "mpesa", paymentReference: p.mpesaCode, notes: `Online booking — M-Pesa ${p.mpesaCode} verified by ${who}` } as any);
        }
        if (seats.length) {
          const shows = await storage.listMovieShows();
          const total = seats.reduce((a, x) => a + x.ticketPrice, 0);
          const paid = Math.min(p.amount, total);
          const doc = await issueDocument(storage, {
            docType: "invoice", category: "movie", sourceId: seats[0].id, recipientName: p.guestName, recipientEmail: p.guestEmail, issueDate: todayLabel(),
            lineItems: seats.map((x) => { const sh = shows.find((y) => y.id === x.showId); return { label: `${sh?.name ?? "Movie"} — Seat ${x.seatRow}${x.seatNumber}`, detail: sh ? `${sh.showDate} ${sh.startTime}` : undefined, amount: x.ticketPrice }; }),
            totalAmount: total, amountPaid: paid, balance: total - paid, paymentMethod: "mpesa", paymentReference: p.mpesaCode,
          });
          docResult = { status: doc.status, id: doc.id, publicToken: doc.publicToken };
        }
        void sendSms({ settings: s, to: p.guestPhone, message: `Hi ${p.guestName}, your Movie Room booking ${p.targetRef} is CONFIRMED: ${p.summary}. M-Pesa ${p.mpesaCode} received. Enjoy the show! - ${s.hotelName}` }).catch(() => {});
      } else if (p.kind === "room") {
        const bk = (await storage.listAccommodationBookings()).find((x) => x.bookingRef === p.targetRef && x.status !== "cancelled");
        if (bk) {
          const paid = Math.min((bk.amountPaid ?? 0) + p.amount, bk.totalAmount);
          const updated = await storage.updateAccommodationBooking(bk.id, {
            amountPaid: paid, paymentMethod: "mpesa", paymentReference: bk.paymentReference || p.mpesaCode,
            status: bk.status === "pending_payment" ? "confirmed" : bk.status,
            notes: (bk.notes ?? "").replace("awaiting office verification", `verified by ${who}`),
          } as any);
          const room = await storage.getRoom(bk.roomId);
          const nights = nightsOf(bk.checkIn, bk.checkOut);
          const doc = await issueDocument(storage, {
            docType: "invoice", category: "accommodation", sourceId: bk.id, recipientName: bk.guestName, recipientEmail: bk.guestEmail, issueDate: todayLabel(),
            lineItems: [{ label: `${room?.name ?? "Room"} \u2014 ${nights} night(s)`, detail: `${bk.checkIn} to ${bk.checkOut} @ ${kes(bk.rate)}/night`, amount: bk.totalAmount }],
            totalAmount: bk.totalAmount, amountPaid: paid, balance: bk.totalAmount - paid, paymentMethod: "mpesa", paymentReference: p.mpesaCode,
          });
          docResult = { status: doc.status, id: doc.id, publicToken: doc.publicToken, bookingId: updated?.id };
          const bal = bk.totalAmount - paid;
          void sendSms({ settings: s, to: p.guestPhone, message: `Hi ${p.guestName}, your room booking ${p.targetRef} is CONFIRMED: ${p.summary}. M-Pesa ${p.mpesaCode} received.${bal > 0.5 ? ` Balance ${kes(bal)} payable at check-in.` : ""} Check-in from ${s.publicRoomCheckInTime || "14:00"}. - ${s.hotelName}` }).catch(() => {});
        }
      } else {
        await sql`UPDATE table_reservations SET status = 'confirmed', deposit_paid = ${p.amount}, payment_reference = ${p.mpesaCode} WHERE reservation_ref = ${p.targetRef} AND status = 'awaiting_verification'`;
        void sendSms({ settings: s, to: p.guestPhone, message: `Hi ${p.guestName}, your table reservation ${p.targetRef} is CONFIRMED: ${p.summary}. Deposit ${kes(p.amount)} (M-Pesa ${p.mpesaCode}) will be deducted from your bill. - ${s.hotelName}` }).catch(() => {});
      }
      res.json({ ok: true, _document: docResult });
    } catch (err: any) {
      console.error("[online-payments] verify failed:", err);
      res.status(500).json({ error: err?.message ?? "Verification failed" });
    }
  });

  app.post("/api/online-payments/:id/reject", requireAnyBookingModule, async (req, res) => {
    try {
      const p = await loadForReview(req, res);
      if (!p) return;
      const reason = str(req.body?.reason, 300);
      if (!reason) return res.status(400).json({ error: "Give a reason — it is sent to the guest." });
      const user = (req as any).user;
      const claimed = await sql`UPDATE online_payments SET status = 'rejected', reviewed_by = ${user.fullName ?? user.username}, reviewed_at = ${Date.now()}, review_note = ${reason} WHERE id = ${p.id} AND status = 'pending' RETURNING id` as any[];
      if (!claimed.length) return res.status(409).json({ error: "This payment was already reviewed." });
      if (p.kind === "movie") {
        const seats = (await storage.listMovieSeatBookings()).filter((b) => b.bookingRef === p.targetRef && b.status !== "cancelled");
        for (const seat of seats) await storage.updateMovieSeatBooking(seat.id, { status: "cancelled", notes: `Online booking rejected: ${reason}` } as any);
      } else if (p.kind === "room") {
        const bk = (await storage.listAccommodationBookings()).find((x) => x.bookingRef === p.targetRef && x.status === "pending_payment");
        if (bk) await storage.updateAccommodationBooking(bk.id, { status: "cancelled", notes: `${bk.notes ?? ""} | Online booking rejected: ${reason}` } as any);
      } else {
        await sql`UPDATE table_reservations SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || ${`Rejected: ${reason}`} WHERE reservation_ref = ${p.targetRef}`;
      }
      const s = await storage.getSettings();
      void sendSms({ settings: s, to: p.guestPhone, message: `Hi ${p.guestName}, we could not confirm booking ${p.targetRef}: ${reason}. Please contact reception${s.hotelPhone ? ` on ${s.hotelPhone}` : ""}. - ${s.hotelName}` }).catch(() => {});
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[online-payments] reject failed:", err);
      res.status(500).json({ error: err?.message ?? "Rejection failed" });
    }
  });

  // Table reservations (restaurant / bar)
  app.get("/api/table-reservations", requireModule("bar-restaurant"), async (_req, res) => {
    const rows = await sql`SELECT * FROM table_reservations ORDER BY reservation_date DESC, reservation_time DESC LIMIT 1000` as any[];
    res.json(rows.map(rowToReservation));
  });

  app.patch("/api/table-reservations/:id", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await sql`SELECT * FROM table_reservations WHERE id = ${id}` as any[];
      if (!rows[0]) return res.status(404).json({ error: "Reservation not found" });
      const cur = rowToReservation(rows[0]);
      const b = req.body ?? {};
      const status = b.status ?? cur.status;
      if (!(TABLE_RESERVATION_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: "Invalid status" });
      if (cur.status === "awaiting_verification" && status !== cur.status && status !== "cancelled") {
        return res.status(400).json({ error: "Verify the M-Pesa deposit in Online bookings before confirming this reservation." });
      }
      if (cur.status === "cancelled" && status !== "cancelled" && cur.depositAmount > 0 && cur.depositPaid + 0.5 < cur.depositAmount) {
        return res.status(400).json({ error: "This reservation was cancelled without a verified deposit. Ask the guest to book again." });
      }
      const tableId = b.tableId === undefined ? cur.tableId : (b.tableId === null ? null : Number(b.tableId));
      const notes = b.notes === undefined ? cur.notes : (str(b.notes, 300) || null);
      const date = b.reservationDate === undefined ? cur.reservationDate : str(b.reservationDate, 10);
      const time = b.reservationTime === undefined ? cur.reservationTime : str(b.reservationTime, 5);
      const party = b.partySize === undefined ? cur.partySize : Math.max(1, Math.floor(Number(b.partySize)) || cur.partySize);
      const updated = await sql`UPDATE table_reservations SET status = ${status}, table_id = ${tableId}, notes = ${notes}, reservation_date = ${date}, reservation_time = ${time}, party_size = ${party} WHERE id = ${id} RETURNING *` as any[];
      const r = rowToReservation(updated[0]);
      if (status === "cancelled" && cur.status === "awaiting_verification") {
        await sql`UPDATE online_payments SET status = 'rejected', reviewed_by = ${(req as any).user?.fullName ?? "staff"}, reviewed_at = ${Date.now()}, review_note = 'Reservation cancelled by staff' WHERE target_ref = ${cur.reservationRef} AND status = 'pending'`;
      }
      res.json(r);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Update failed" }); }
  });
}
