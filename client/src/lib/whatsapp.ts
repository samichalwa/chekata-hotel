// Click-to-send WhatsApp helper. No API key, account, or approval needed —
// wa.me opens WhatsApp (app or web) with the message pre-filled; staff still
// taps Send themselves. Good enough for guests paying by M-Pesa where we
// already have their phone number but may not have an email address.

// Normalizes a locally-entered Kenyan number (e.g. "0712345678" or
// "712345678" or "+254712345678") into the digits-only international format
// wa.me expects (254712345678). Returns null if there's nothing usable.
export function normalizeKenyanPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  else if (digits.startsWith("254")) {
    // already in international form
  } else if (digits.length === 9) digits = "254" + digits; // e.g. "712345678"
  return digits.length >= 10 ? digits : null;
}

export function buildWhatsAppLink(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizeKenyanPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
