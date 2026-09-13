import type { Settings } from "@shared/schema";

export interface SendSmsInput {
  settings: Settings;
  to: string; // raw phone number as entered by staff (e.g. 07xx, 01xx, +254xx, 254xx)
  message: string;
}

export interface SendSmsResult {
  ok: boolean;
  error?: string;
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
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const { settings, to, message } = input;
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
      if (!res.ok) return { ok: false, error: `Africa's Talking error ${res.status}: ${text}` };
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const recipients = parsed?.SMSMessageData?.Recipients;
      if (Array.isArray(recipients) && recipients.length > 0) {
        const first = recipients[0];
        // Africa's Talking returns statusCode 101/102 for accepted/sent
        if (first.statusCode !== 101 && first.statusCode !== 102) {
          return { ok: false, error: first.status || `Africa's Talking rejected the message (status ${first.statusCode}).` };
        }
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Failed to reach Africa's Talking." };
    }
  }

  return { ok: false, error: `Unknown SMS provider: ${provider}` };
}
