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

// Phase 6 (Test/Live split): pass the signed-in session's `environment` so a
// staff member testing the workflow in Test mode can never accidentally send
// a guest/customer a WhatsApp message that looks like a real one — the text
// itself gets a loud "TEST COMPANY" prefix (mirrors the prefix already used
// on Test-mode PDFs, emails, SMS, and Excel reports). Defaults to "live" (no
// prefix) so existing call sites that haven't been updated keep working.
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message: string,
  environment: "live" | "test" = "live",
): string | null {
  const normalized = normalizeKenyanPhone(phone);
  if (!normalized) return null;
  const text = environment === "test" ? `TEST COMPANY — ${message}` : message;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

// Public, no-login link to a billing document's PDF (invoice/receipt) or a maintenance report,
// for embedding in WhatsApp message text — wa.me can only carry text, never a real attachment.
export function buildDocumentPdfUrl(id: number, publicToken: string): string {
  return `${window.location.origin}/api/public/documents/${id}/pdf?token=${publicToken}`;
}

export function buildMaintenancePdfUrl(id: number, publicToken: string): string {
  return `${window.location.origin}/api/public/maintenance/${id}/pdf?token=${publicToken}`;
}

// Fetches the latest document for a source record (used from edit/detail dialogs where the
// WhatsApp button fires against live form/booking state, not a fresh mutation response) and
// returns the PDF link to embed, or null if no document exists yet (e.g. unsaved new booking).
export async function fetchLatestDocumentPdfUrl(category: string, sourceId: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/documents/latest/${category}/${sourceId}`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.id || !data?.publicToken) return null;
    return buildDocumentPdfUrl(data.id, data.publicToken);
  } catch {
    return null;
  }
}
