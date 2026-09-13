# Email Setup Guide — The Chekata (Sending from info@thechekata.com)

**For:** The Chekata Hotel Management System
**Prepared for:** Sami Chalwa
**Last updated:** September 13, 2026

This configures **automatic outbound email** for The Chekata: invoices sent on booking/order creation, and receipts sent when a payment is recorded — all appearing to guests as coming from `info@thechekata.com`.

**Important scope note:** this sets up *sending* only, through a transactional email service (no SMTP mailbox needed). It does not create a real inbox you can log into to read replies at `info@thechekata.com`. If guests need to be able to reply and have you receive that in an inbox (Gmail-style), that's a separate step (e.g. Google Workspace or Namecheap Private Email) — tell me if you want that set up too and I'll guide you through it separately.

The app already supports four providers (Resend, SendGrid, Postmark, Mailgun) — this guide uses **Resend**, because it needs the fewest DNS records to verify your domain and has a free tier (3,000 emails/month, 100/day) that comfortably covers a single hotel's invoice/receipt volume. If you'd prefer one of the other three instead, let me know and I'll adjust the steps — the app-side entry (§4 below) is nearly identical either way.

Your domain `thechekata.com` is registered and DNS-managed at **Namecheap**, so this guide's DNS steps are written for the Namecheap dashboard.

---

## 1. Create a Resend Account and Add Your Domain

1. Go to [resend.com/signup](https://resend.com/signup) and sign up (email + password, or continue with Google/GitHub).
2. Once logged in, in the left sidebar click **Domains**.
3. Click **Add Domain**.
4. Enter `thechekata.com` (the root domain — not `hms.thechekata.com`, which is your app's own subdomain and unrelated to email) and click **Add**.
5. Resend will generate a set of DNS records for you — typically one **MX** record, one **TXT** record (SPF), and one or more **CNAME** records (DKIM), all placed on a subdomain it creates automatically (usually named `send`). Keep this page open — you'll copy these exact values into Namecheap next.

**Note:** these records live on the `send.thechekata.com` subdomain, not on the root domain — so this will not interfere with any existing email service you may already have pointed at `thechekata.com` itself (e.g. if `info@thechekata.com` currently receives mail elsewhere, that stays untouched by this setup).

---

## 2. Add the DNS Records in Namecheap

1. Log in at [namecheap.com](https://www.namecheap.com) and go to **Domain List** in the left sidebar.
2. Find `thechekata.com` in the list and click **Manage** next to it.
3. Click the **Advanced DNS** tab.
4. For each record Resend showed you in Step 1.5, click **Add New Record** and fill in:
   - **MX record**: Type = `MX Record`, Host = `send` (or whatever host Resend specified), Value/Mail Server = the value Resend gave you, Priority = `10`, TTL = leave as **Automatic**.
   - **TXT record (SPF)**: Type = `TXT Record`, Host = `send`, Value = the exact SPF string Resend gave you (starts with `v=spf1...`), TTL = **Automatic**.
   - **CNAME record(s) (DKIM)**: Type = `CNAME Record`, Host = the exact value Resend gave you (something like `resend._domainkey.send`), Value = the target Resend gave you, TTL = **Automatic**.
5. Click the green checkmark to save each record as you add it.
6. **Copy every value directly from the Resend page — don't retype it.** A single typo is the most common reason verification fails.

---

## 3. Verify the Domain and Generate an API Key

1. Back on the Resend **Domains** page, click on `thechekata.com`, then click **Verify DNS Records** (or **Verify**).
2. This usually completes within 15 minutes, but DNS changes can occasionally take up to a few hours to propagate — if it doesn't verify immediately, wait 15–30 minutes and click **Verify** again.
3. Once the domain shows status **Verified**, go to **API Keys** in the left sidebar.
4. Click **Create API Key**, give it a name (e.g. `chekata-hotel`), leave permission as **Full access** (or restrict to **Sending access** if offered), and click **Add**.
5. **Copy the key immediately** — Resend shows it only once.

---

## 4. Enter the Details Into The Chekata

1. Log in to The Chekata as an admin.
2. In the left sidebar, click **Settings**.
3. Make sure you're on the **Hotel & Email** tab (it should be selected by default).
4. Scroll to the card titled **"Transactional email service"**.
5. Set **Provider** to **Resend**.
6. In **API key**, paste the key you copied in §3, step 5.
7. In **From address**, enter `info@thechekata.com`.
8. In **From name (optional)**, enter `The Chekata`.
9. Make sure the **"Send invoices & receipts automatically"** switch is turned on.
10. Click **Save settings**.

---

## 5. Send a Test Email

1. Still on the **Hotel & Email** tab, scroll to the **"Send a test email"** field near the bottom of the Transactional email service card.
2. Enter an email address you can check (your own is fine).
3. Click **Send test**.
4. You should see a "Test email sent" confirmation in the app, and the message should arrive within a few seconds — check your spam folder the first time, since a brand-new sending domain hasn't built up reputation yet.

Once this test succeeds, the app will automatically email a PDF invoice the moment a booking/order is created, and a PDF receipt the moment a payment is recorded — no further action needed per transaction.

---

## 6. Troubleshooting

**Test email fails with a domain/authentication error:**
- Confirm the domain shows **Verified** (not "Pending" or "Not started") on the Resend Domains page — sending will fail until it is.
- Double-check every DNS record in Namecheap matches Resend's values exactly, including the Host field — a record on the wrong host is the most common cause.
- If you edited any record after first saving it, allow 15–30 minutes and click **Verify** again in Resend.

**Test email sends successfully but the guest doesn't see it:**
- Check spam/junk — this is common for the first few days on a newly verified sending domain until mail providers build up trust.
- Confirm **"Send invoices & receipts automatically"** is switched on in Settings (§4, step 9) — this only affects live bookings, not the test button.

**"No email provider configured" or "No sender (from) email address configured" error:**
- Means Settings wasn't saved after entering the details — repeat §4 and confirm you clicked **Save settings**.

**Still stuck after the above:**
Reopen [this conversation](https://www.perplexity.ai/computer/tasks/5657b37a-4dc2-4066-9c1d-af51df3b81e1) and describe exactly what error you're seeing — I can check the app logs and the Resend account configuration from here.

---

## 7. Costs and Limits

- Resend's free tier covers **3,000 emails/month and 100/day** — for a single hotel's invoice/receipt volume this is typically enough on its own.
- If you outgrow it, Resend's paid plans start at a low monthly fee for higher volume — check current pricing at [resend.com/pricing](https://resend.com/pricing) since rates can change.
- No cost is incurred for domain verification itself — only actual emails sent count against your plan.

---

## 8. Quick Reference

| What | Where |
|---|---|
| Resend account / domains | [resend.com/domains](https://resend.com/domains) |
| Resend API keys | [resend.com/api-keys](https://resend.com/api-keys) |
| Namecheap DNS management | [ap.www.namecheap.com](https://ap.www.namecheap.com) → Domain List → `thechekata.com` → Manage → Advanced DNS |
| Where to configure in the app | The Chekata → **Settings** → **Hotel & Email** tab → **Transactional email service** card |
| Where to test | Same card → **"Send a test email"** field → **Send test** button |
| Getting help with the app itself | Reopen [this conversation](https://www.perplexity.ai/computer/tasks/5657b37a-4dc2-4066-9c1d-af51df3b81e1) |

Sources consulted while preparing this guide: [Resend — Add and verify a domain](https://resend.com/docs/add-a-domain), [Resend — Managing domains](https://resend.com/docs/dashboard/domains/manage-domains), and [Resend's region-mismatch/verification troubleshooting guide](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying).
