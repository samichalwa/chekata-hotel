# Configuring SMS via Africa's Talking — Setup & Troubleshooting Guide

**For:** The Chekata Hotel Management System
**Prepared for:** Sami Chalwa
**Last updated:** September 13, 2026

This is a standalone, step-by-step guide to setting up SMS confirmations in The Chekata. It covers creating your Africa's Talking account correctly, generating a working API key, entering it into the app, testing it, and — since this is exactly where things have gone wrong so far — a detailed troubleshooting checklist for the `401 The supplied authentication is invalid` error, plus what to do if it's still not resolved after that.

For the broader system (hosting, backups, other modules), see the separate **"The Chekata — System Architecture & Operations Guide."** This document only covers Africa's Talking / SMS.

---

## 1. What SMS Is Used For, and What It Isn't

- **Automatic SMS confirmations** are sent by the app itself, without any staff action, in two places:
  - The moment a **Movie Room** seat booking is paid for (message includes show, date/time, and seat).
  - When a **Maintenance** issue is logged, and again when it's closed.
- This is powered by **Africa's Talking**, a paid SMS gateway — each message costs a small fee once it's live (see §7).
- **This is separate from the free WhatsApp button** already working throughout the app (Accommodation, Facilities, Bar & Restaurant, Movie Room, Maintenance). That button opens WhatsApp with the same confirmation message pre-filled for a staff member to send manually with one tap — it needs no Africa's Talking account, no API key, and no fee. It already works today regardless of the SMS setup below.

If you only need *a* confirmation to reach a guest right now, the WhatsApp button is the reliable option while SMS is being set up.

---

## 2. Part A — Create (or Verify) Your Africa's Talking Account

If you already have an account and are only missing a working key, skip to Part B.

1. Open [account.africastalking.com/auth/register](https://account.africastalking.com/auth/register) in your browser.
2. Fill in: **First Name**, **Last Name**, **Email Address**, **Password**, **Country** (Kenya).
3. Tick the box agreeing to the Terms of Service, then submit the form.
4. Check your email inbox — you'll receive two emails: a welcome email and an **account verification email**.
5. Open the verification email and click its verification link. **Do this before doing anything else** — an unverified account has limited functionality and this alone can cause authentication failures later.
6. Log in at [account.africastalking.com](https://account.africastalking.com) with your email and password. You should land on the account **Home Page**.

---

## 3. Part B — Create a Live App and Generate a Working API Key

This is the step where the earlier two attempts most likely went wrong. Africa's Talking has **two separate environments** — Sandbox (free, test-only, messages never reach real phones) and Live (real production, real costs, real delivery) — and **each has its own username and its own API key**. Mixing them (e.g. a Sandbox key with a Live username, or vice versa) is one of the most common causes of exactly the error you've been hitting.

1. On the Home Page, find the **"New Team"** option (a button or a large "+" prompt) and click it.
2. Give the team a name (e.g. `TheChekata`) and save it.
3. Open the team you just created, then click **"Create App"** (or the equivalent "New Application" button).
4. Fill in the application name (e.g. `chekata-hotel`), a username for this app, and your country (Kenya), then confirm creation.
5. Click on the application you just created to open **its own dashboard**. Confirm the dashboard is showing **green** — Africa's Talking colors the Sandbox dashboard orange and the Live dashboard green, so this is a quick visual check that you're in the right place.
6. In the left-hand sidebar of that app's dashboard, click **Settings**, then **API Key**.
7. Enter your account password when prompted, then click **Generate** (some accounts instead show a **Request** button that emails you a confirmation link first — if so, open that email and click **"Generate New API Key"**).
8. **Copy the key immediately and paste it somewhere safe** (e.g. a password manager or a private note) — Africa's Talking shows it only once and will not display it again.
9. **Wait 2–3 minutes** before testing it. Newly generated keys are not always active instantly.

Write down, from this same app dashboard, the exact **username** shown for this application (not the word "sandbox" — that word is reserved for the Sandbox environment only). You will need this exact username together with this key in Part C.

---

## 4. Part C — Enter the Credentials Into The Chekata

1. Log in to The Chekata as an admin.
2. In the left sidebar, click **Settings**.
3. Scroll to the card titled **"SMS confirmations"**.
4. Set **Provider** to **Africa's Talking**.
5. In **Africa's Talking username**, paste the exact application username from Part B, step 9 (not "sandbox," unless you are deliberately testing against the Sandbox environment).
6. In **API key**, paste the key you copied in Part B, step 8.
7. Leave **Sender ID (optional)** blank for now — you can add a registered sender ID later (see §6); without one, messages send from Africa's Talking's default shared ID.
8. Turn on the **"Send SMS confirmations automatically"** switch.
9. Click **Save settings**.

---

## 5. Part D — Send a Test SMS

Do this before relying on a real booking to prove it out:

1. Still on the **Settings** page, scroll to the **"Send a test SMS"** field at the bottom of the SMS confirmations card.
2. Enter a real Kenyan phone number you can check (yours is fine), in the format `07xx xxx xxx`.
3. Click **Send test**.
4. If it works, you'll see a "Test SMS sent" confirmation in the app and the message should arrive on that phone within a few seconds.
5. If it fails, the app will show the exact error text returned by Africa's Talking (e.g. the `401` error) — that's the error to work through in §6 below.

---

## 6. Part E — Troubleshooting "401 The Supplied Authentication Is Invalid"

This is the exact error hit twice already with newly generated keys. Africa's Talking's own community help material lists this as a common, usually self-inflicted error — work through this checklist in order before contacting their support, since most cases are resolved by one of these:

1. **Environment mismatch (the most common cause).** Confirm the username and API key you entered in Settings both came from the *same* environment:
   - If testing on **Sandbox**: username must be the literal word `sandbox`, and the key must have been generated from the Sandbox app's own Settings → API Key page.
   - If using **Live**: username must be your actual live application's username (from Part B, step 9), and the key must have been generated from that specific live application's dashboard — not the Sandbox dashboard, and not a different app if you have more than one.
2. **Freshly generated key not yet active.** If you just generated the key, wait a few minutes and try the test SMS again before assuming it's broken.
3. **Wrong app selected.** If your account has more than one live application (or you created a second one by accident while troubleshooting), double check you generated the key from the same app whose username you're using — keys are not interchangeable between applications, even within the same account.
4. **Copy/paste error.** Re-copy the key directly from Africa's Talking and re-paste it into **Settings → API key** — a trailing space, missing character, or accidental line break from copying is a common invisible cause. Re-save and re-test after doing this.
5. **Account not verified.** Confirm you completed Part A, step 5 (clicking the link in the account verification email). An unverified account can behave inconsistently even where a key appears to generate successfully.
6. **Regenerate a fresh key.** If all of the above check out and it still fails, go back to that app's **Settings → API Key** page and generate a brand-new key (this invalidates the old one), then repeat Part C and Part D with the new key.

**If it still returns 401 after all six checks above**, this is genuinely something only Africa's Talking support can resolve on their end (an account or application-level activation issue). Contact them with:

- **Help Center:** [help.africastalking.com/en](https://help.africastalking.com/en/)
- **Email:** [info@africastalking.com](mailto:info@africastalking.com) or [smsussd@africastalking.com](mailto:smsussd@africastalking.com) (SMS-product-specific)

A ready-to-send message, once you've confirmed the checklist above and it's still failing:

> Subject: 401 "Supplied Authentication is Invalid" on a live application — SMS product
>
> Hello,
>
> I'm trying to send SMS via the Messaging API on my live application (account email: [your email], application username: [your app's username], team: [your team name]). I've generated a fresh API key from that application's Settings → API Key page, waited several minutes, and confirmed the username and key both come from the same live application — but every request still returns `401 The supplied authentication is invalid`.
>
> Could you check whether my account or this application has an outstanding verification, activation, or KYC step blocking live API authentication? Happy to provide any additional documentation needed.
>
> Thank you,
> [Your name]
> [Your phone number]

Reopen [this conversation](https://www.perplexity.ai/computer/tasks/5657b37a-4dc2-4066-9c1d-af51df3b81e1) any time and describe what happened — I can re-check the app-side configuration and confirm the request format is correct on our end while you work with their support on the account-side activation.

---

## 7. Costs and Billing

- Africa's Talking SMS is **pay-as-you-go** — you top up a wallet (called "Stash") and each SMS deducts a small per-message fee, typically a few Kenyan cents to under KES 1 depending on the destination network. Rates can change, so check the current per-network rate on your account's **Billing**/**Pricing** page rather than relying on a fixed figure here.
- Top up via M-Pesa or card from your account dashboard: **Billing** → **Debit/Credit Cards** or the M-Pesa top-up option, enter the amount, and submit.
- The Sandbox environment is entirely free but never delivers to a real phone — it's for testing the integration only, not for real guest confirmations.

---

## 8. Optional: Registering a Custom Sender ID

By default, without a registered Sender ID, messages arrive from Africa's Talking's shared/generic sender. If you'd like guests to see "THECHEKATA" (or similar) as the sender instead of a random code, you can register a Sender ID:

1. From your live application's dashboard, look for **SMS → Shortcodes → Alphanumeric** (or a **"Product Request"** menu option — the exact location has moved between Africa's Talking dashboard versions).
2. Provide: your desired ID (max 11 characters, no spaces — hyphens/underscores allowed, must relate to "The Chekata" name, not generic), your company registration certificate, and a short description of the message types you'll send (booking/maintenance confirmations).
3. Africa's Talking submits this to Safaricom and Airtel on your behalf. Cost is roughly **KES 8,700** (one-off, covers both networks) at the time of writing — confirm the current fee on their pricing page, as it can change.
4. Approval typically takes **2–14 business days** depending on the network (Safaricom is usually fastest, submitted Mondays/Thursdays for approval Tuesdays/Fridays; other networks can take longer).
5. Once approved, enter the approved ID into The Chekata's **Settings → SMS confirmations → Sender ID (optional)** field and save.

This step is entirely optional — SMS sending works without a custom Sender ID; this only affects what name/number the guest sees as the sender.

---

## 9. Quick Reference

| What | Where |
|---|---|
| Register / log in | [account.africastalking.com](https://account.africastalking.com) |
| Help Center | [help.africastalking.com/en](https://help.africastalking.com/en/) |
| General support email | [info@africastalking.com](mailto:info@africastalking.com) |
| SMS-specific support email | [smsussd@africastalking.com](mailto:smsussd@africastalking.com) |
| Where to configure in the app | The Chekata → **Settings** → **SMS confirmations** card |
| Where to test | Same card → **"Send a test SMS"** field → **Send test** button |
| Getting help with the app itself | Reopen [this conversation](https://www.perplexity.ai/computer/tasks/5657b37a-4dc2-4066-9c1d-af51df3b81e1) |

Sources consulted while preparing this guide: [Africa's Talking Help Center — account registration](https://help.africastalking.com/en/articles/1036078-how-do-i-register-an-account), [sandbox vs. live environments](https://help.africastalking.com/en/articles/2189460-what-are-the-sandbox-and-the-live-environments), [Sender ID setup in Kenya](https://help.africastalking.com/en/articles/407085-how-do-i-set-up-my-sender-id-in-kenya-or-uganda), the [Africa's Talking developer community FAQ](https://community.africastalking.com/) on the "Supplied Authentication is Invalid" error, and the [Microsoft Connectors documentation for the Africa's Talking SMS connector](https://learn.microsoft.com/en-us/connectors/africastalkingsms/).
