import type { Settings } from "@shared/schema";
import { getCurrentEnvironment } from "./db-context";
import { logTestMessage } from "./test-environment";
import { sql } from "./storage";

export interface SendSmsInput {
  settings: Settings;
  to: string; // raw phone number as entered by staff (e.g. 07xx, 01xx, +254xx, 254xx)
  message: string;
  source?: string; // what sent it, shown in Settings → SMS log (e.g. "Water bill")
}

export interface SendSmsResult {
  ok: boolean;
  error?: string;
}
type CoreResult = SendSmsResult & { phone?: string | null; cost?: string | null; messageId?: string | null; providerStatus?: string | null; test?: boolean };

/** Every SMS the system tries to send is recorded in sms_log (Settings → SMS log). Logging never blocks or fails a send. */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  let r: CoreResult;
  try { r = await sendSmsCore(input); } catch (e: any) { r = { ok: false, error: e?.message ?? "SMS failed" }; }
  try {
    await sql`INSERT INTO sms_log (created_at, recipient, phone, message, source, status, error, provider_status, cost, message_id)
      VALUES (${Date.now()}, ${String(input.to ?? "").slice(0, 60)}, ${r.phone ?? normalizeKenyanPhone(String(input.to ?? ""))}, ${String(input.message ?? "").slice(0, 2000)},
        ${input.source ?? "Other"}, ${r.test ? "test" : r.ok ? "sent" : "failed"}, ${r.ok ? null : (r.error ?? "").slice(0, 500)}, ${r.providerStatus ?? null}, ${r.cost ?? null}, ${r.messageId ?? null})`;
  } catch (e: any) { console.warn("[sms_log] could not record SMS:", e?.message ?? e); }
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// Normalizes a Kenyan phone number to E.164 (+254...) as required by
// Africa's Talking. Falls back to a best-effort +<digits> for numbers that
// already look international, so the app stays usable outside Kenya too.
export function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`; // e.g. 7xx xxx xxx without leading 0
  return `+${digits}`;
}

// Provider-agnostic SMS sender. Currently supports Africa's Talking, the
// standard SMS gateway for Kenya. Each provider is a plain HTTPS fetch call
// (form-encoded for Africa's Talking) so no native/SDK dependency is needed.
async function sendSmsCore(input: SendSmsInput): Promise<CoreResult> {
  const { settings, to, message } = input;

  // Test environment: never actually send — log the attempt and report
  // success so calling code's normal flow (and UI "sent" confirmation)
  // continues unchanged, without any real SMS leaving the building.
  if (getCurrentEnvironment() === "test") {
    await logTestMessage({ channel: "sms", recipient: to, bodyPreview: message });
    return { ok: true, test: true, phone: normalizeKenyanPhone(to || "") };
  }

  const provider = (settings.smsProvider || "").toLowerCase();

  if (!settings.smsEnabled) return { ok: false, error: "SMS is turned off in Settings." };
  if (!provider) return { ok: false, error: "No SMS provider configured in Settings." };

  const phone = normalizeKenyanPhone(to);
  if (!phone) return { ok: false, error: "No valid phone number to send the SMS to." };

  if (provider === "africastalking") {
    const username = settings.smsUsername || "";
    const apiKey = settings.smsApiKey || "";
    if (!username) return { ok: false, error: "No Africa's Talking username configured in Settings." };
    if (!apiKey) return { ok: false, error: "No Africa's Talking API key configured in Settings." };

    const isSandbox = username.toLowerCase() === "sandbox";
    const baseUrl = isSandbox
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";

    const body = new URLSearchParams({ username, to: phone, message });
    if (settings.smsSenderId) body.set("from", settings.smsSenderId);

    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, phone, error: `Africa's Talking error ${res.status}: ${text}` };
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const recipients = parsed?.SMSMessageData?.Recipients;
      let first: any = null;
      if (Array.isArray(recipients) && recipients.length > 0) {
        first = recipients[0];
        // Africa's Talking's accepted/success codes: 100 (Processed), 101
        // (Sent), 102 (Queued). Anything else (e.g. 401/406/407) is a real
        // rejection. This previously omitted 100, so a successfully
        // delivered, billed message was still reported to the user as failed.
        if (first.statusCode !== 100 && first.statusCode !== 101 && first.statusCode !== 102) {
          return { ok: false, phone, providerStatus: first.status ?? null, error: first.status || `Africa's Talking rejected the message (status ${first.statusCode}).` };
        }
      } else if (parsed?.SMSMessageData?.Message) {
        return { ok: false, phone, error: String(parsed.SMSMessageData.Message) };
      }
      return { ok: true, phone, providerStatus: first?.status ?? null, cost: first?.cost ?? null, messageId: first?.messageId ?? null };
    } catch (e: any) {
      return { ok: false, phone, error: e?.message ?? "Failed to reach Africa's Talking." };
    }
  }

  return { ok: false, error: `Unknown SMS provider: ${provider}` };
}
