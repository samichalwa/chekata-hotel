import type { Settings } from "@shared/schema";

export interface SendEmailInput {
  settings: Settings;
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  attachment?: { filename: string; content: Buffer };
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

// Provider-agnostic transactional email sender. Each provider is implemented
// as a plain HTTPS fetch call so no native dependencies are required — this
// keeps the app portable to shared/cPanel hosting.
export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { settings, to, toName, subject, html, attachment } = input;
  const provider = (settings.emailProvider || "").toLowerCase();
  const apiKey = settings.emailApiKey || "";
  const fromEmail = settings.emailFrom || "";
  const fromName = settings.emailFromName || settings.hotelName || "The Chekata";

  if (!provider) return { ok: false, error: "No email provider configured in Settings." };
  if (!apiKey) return { ok: false, error: "No email API key configured in Settings." };
  if (!fromEmail) return { ok: false, error: "No sender (from) email address configured in Settings." };

  const base64Attachment = attachment ? attachment.content.toString("base64") : null;

  try {
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [to],
          subject,
          html,
          ...(attachment ? { attachments: [{ filename: attachment.filename, content: base64Attachment }] } : {}),
        }),
      });
      if (!res.ok) return { ok: false, error: `Resend error ${res.status}: ${await res.text()}` };
      return { ok: true };
    }

    if (provider === "sendgrid") {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to, name: toName || undefined }] }],
          from: { email: fromEmail, name: fromName },
          subject,
          content: [{ type: "text/html", value: html }],
          ...(attachment ? { attachments: [{ content: base64Attachment, filename: attachment.filename, type: "application/pdf", disposition: "attachment" }] } : {}),
        }),
      });
      if (!res.ok) return { ok: false, error: `SendGrid error ${res.status}: ${await res.text()}` };
      return { ok: true };
    }

    if (provider === "postmark") {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "X-Postmark-Server-Token": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          From: `${fromName} <${fromEmail}>`,
          To: to,
          Subject: subject,
          HtmlBody: html,
          ...(attachment ? { Attachments: [{ Name: attachment.filename, Content: base64Attachment, ContentType: "application/pdf" }] } : {}),
        }),
      });
      if (!res.ok) return { ok: false, error: `Postmark error ${res.status}: ${await res.text()}` };
      return { ok: true };
    }

    if (provider === "mailgun") {
      const domain = settings.mailgunDomain || "";
      if (!domain) return { ok: false, error: "Mailgun domain not configured in Settings." };
      const form = new FormData();
      form.append("from", `${fromName} <${fromEmail}>`);
      form.append("to", to);
      form.append("subject", subject);
      form.append("html", html);
      if (attachment) form.append("attachment", new Blob([attachment.content], { type: "application/pdf" }), attachment.filename);
      const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}` },
        body: form,
      });
      if (!res.ok) return { ok: false, error: `Mailgun error ${res.status}: ${await res.text()}` };
      return { ok: true };
    }

    return { ok: false, error: `Unknown email provider: ${provider}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unknown error sending email." };
  }
}
