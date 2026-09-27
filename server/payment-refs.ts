// One payment reference (M-Pesa code, card slip, bank ref, cheque #) may only ever be used once
// across the whole system — every table that stores a payment reference plus the online M-Pesa
// submissions. Cancelled / rejected records still count: a reference is never recycled.
import type { NextFunction, Request, Response } from "express";
import { sql } from "./storage";

export function normalizeRef(ref: unknown): string {
  return typeof ref === "string" ? ref.toUpperCase().replace(/\s+/g, "") : "";
}

// Placeholders staff type when there is no real reference — never treated as a reference.
const PLACEHOLDERS = new Set(["", "-", "--", "NA", "N/A", "NONE", "NIL", "CASH", "0", "TBA", "TBC"]);
export function isRealRef(ref: string): boolean {
  return ref.length >= 3 && !PLACEHOLDERS.has(ref);
}

export interface RefExclusion {
  table?: string; // record being edited (same row may keep its own reference)
  id?: number;
  movieBookingRef?: string; // all seats of one movie transaction share one payment
  onlinePaymentId?: number; // the online submission that is being verified into a booking
}

const SOURCES: { table: string; label: string }[] = [
  { table: "accommodation_bookings", label: "an accommodation booking" },
  { table: "facility_bookings", label: "a facility/event booking" },
  { table: "movie_seat_bookings", label: "a movie seat booking" },
  { table: "orders", label: "a bar/restaurant order" },
  { table: "payment_vouchers", label: "a payment voucher" },
  { table: "rent_invoice_payments", label: "a rent payment" },
  { table: "water_sales", label: "a water sale" },
  { table: "table_reservations", label: "a table reservation" },
];

/** Returns a human description of where the reference was already used, or null when it is free. */
export async function findReferenceUse(rawRef: unknown, ex: RefExclusion = {}): Promise<string | null> {
  const ref = normalizeRef(rawRef);
  if (!isRealRef(ref)) return null;
  for (const s of SOURCES) {
    const rows = await sql.unsafe(
      `SELECT id${s.table === "movie_seat_bookings" ? ", booking_ref" : ""} FROM ${s.table}
       WHERE UPPER(REPLACE(COALESCE(payment_reference, ''), ' ', '')) = $1 LIMIT 20`,
      [ref],
    ) as any[];
    const hit = rows.find((r) => {
      if (ex.table === s.table && ex.id === Number(r.id)) return false;
      if (s.table === "movie_seat_bookings" && ex.movieBookingRef && r.booking_ref === ex.movieBookingRef) return false;
      return true;
    });
    if (hit) return s.label;
  }
  const online = await sql`SELECT id, status FROM online_payments WHERE mpesa_code = ${ref} LIMIT 5` as any[];
  const onlineHit = online.find((r) => Number(r.id) !== ex.onlinePaymentId);
  if (onlineHit) return onlineHit.status === "rejected" ? "an online payment that was rejected" : "an online booking payment";
  return null;
}

export function duplicateRefMessage(ref: unknown, where: string): string {
  return `Payment reference ${normalizeRef(ref)} has already been used on ${where}. Each payment reference can only be used once.`;
}

// Staff create/update endpoints that carry `paymentReference` in the body, and how to find the
// record being edited so it can keep its own reference.
const GUARDED: { re: RegExp; table?: string; movie?: boolean }[] = [
  { re: /^\/accommodation-bookings\/?$/ },
  { re: /^\/accommodation-bookings\/(\d+)$/, table: "accommodation_bookings" },
  { re: /^\/facility-bookings\/?$/ },
  { re: /^\/facility-bookings\/(\d+)$/, table: "facility_bookings" },
  { re: /^\/movie-seat-bookings\/?$/ },
  { re: /^\/movie-seat-bookings\/(\d+)$/, table: "movie_seat_bookings", movie: true },
  { re: /^\/orders\/?$/ },
  { re: /^\/orders\/(\d+)$/, table: "orders" },
  { re: /^\/finance\/payment-vouchers\/?$/ },
  { re: /^\/finance\/payment-vouchers\/(\d+)$/, table: "payment_vouchers" },
  { re: /^\/rent-invoices\/\d+\/payments$/ },
  { re: /^\/water-sales\/?$/ },
  { re: /^\/table-reservations\/?$/ },
  { re: /^\/table-reservations\/(\d+)$/, table: "table_reservations" },
];

// References being written right now — stops two simultaneous saves of the same code.
export const inFlight = new Set<string>();

/** Mounted on /api (after auth): blocks any staff write that re-uses a payment reference. */
export async function paymentReferenceGuard(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "PUT") return next();
    const ref = normalizeRef((req.body as any)?.paymentReference);
    if (!isRealRef(ref)) return next();
    const path = req.path;
    const rule = GUARDED.find((g) => g.re.test(path));
    if (!rule) return next();
    const m = path.match(rule.re);
    const ex: RefExclusion = {};
    if (rule.table && m?.[1]) {
      ex.table = rule.table;
      ex.id = Number(m[1]);
      const own = await sql.unsafe(`SELECT * FROM ${rule.table} WHERE id = $1`, [ex.id]) as any[];
      // Saving a record again with the reference it already carries is never a re-use.
      if (own[0] && normalizeRef(own[0].payment_reference) === ref) return next();
      if (rule.movie && own[0]?.booking_ref) ex.movieBookingRef = own[0].booking_ref;
    }
    if (inFlight.has(ref)) return res.status(409).json({ error: `Payment reference ${ref} is being recorded right now. Each payment reference can only be used once.` });
    const where = await findReferenceUse(ref, ex);
    if (where) return res.status(409).json({ error: duplicateRefMessage(ref, where) });
    inFlight.add(ref);
    const release = () => inFlight.delete(ref);
    res.once("finish", release);
    res.once("close", release);
    next();
  } catch (err) {
    console.error("[payment-refs] guard failed:", err);
    next();
  }
}
