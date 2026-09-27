// Web Push (VAPID) — delivers in-app notifications to installed phones /
// browsers even when CHAIMS is closed. No third-party account needed: the
// VAPID key pair is generated once on first use and stored in the database
// (app_keys table), so nothing is hardcoded and each environment (Live/Test)
// gets its own keys and its own device subscriptions.
import type { Express, Request } from "express";
import webpush from "web-push";
import { sql } from "./storage";
import { getCurrentEnvironment } from "./db-context";

interface VapidKeys { publicKey: string; privateKey: string }
const keyCache = new Map<string, VapidKeys>();

async function getVapidKeys(): Promise<VapidKeys> {
  const env = getCurrentEnvironment();
  const cached = keyCache.get(env);
  if (cached) return cached;
  const rows = await sql`SELECT name, value FROM app_keys WHERE name IN ('vapid_public', 'vapid_private')`;
  const map = new Map(rows.map((r: any) => [r.name, r.value]));
  let keys: VapidKeys;
  if (map.get("vapid_public") && map.get("vapid_private")) {
    keys = { publicKey: map.get("vapid_public") as string, privateKey: map.get("vapid_private") as string };
  } else {
    const k = webpush.generateVAPIDKeys();
    // ON CONFLICT DO NOTHING + re-read keeps two concurrent first calls consistent.
    await sql`INSERT INTO app_keys (name, value) VALUES ('vapid_public', ${k.publicKey}) ON CONFLICT (name) DO NOTHING`;
    await sql`INSERT INTO app_keys (name, value) VALUES ('vapid_private', ${k.privateKey}) ON CONFLICT (name) DO NOTHING`;
    const again = await sql`SELECT name, value FROM app_keys WHERE name IN ('vapid_public', 'vapid_private')`;
    const m2 = new Map(again.map((r: any) => [r.name, r.value]));
    keys = { publicKey: m2.get("vapid_public") as string, privateKey: m2.get("vapid_private") as string };
  }
  keyCache.set(env, keys);
  return keys;
}

export interface PushPayload { title: string; body?: string | null; url?: string | null; tag?: string }

// Sends to every registered device of the given users. Dead subscriptions
// (404/410 from the push service) are removed. Never throws.
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  try {
    const ids = Array.from(new Set(userIds.filter((x) => Number.isFinite(x))));
    if (ids.length === 0) return;
    const subs = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN ${sql(ids)}`;
    if (subs.length === 0) return;
    const keys = await getVapidKeys();
    const prefix = getCurrentEnvironment() === "test" ? "TEST — " : "";
    const body = JSON.stringify({
      title: prefix + payload.title,
      body: payload.body ?? "",
      url: payload.url ? `/#${payload.url.startsWith("/") ? payload.url : `/${payload.url}`}` : "/",
      tag: payload.tag,
    });
    await Promise.all(
      subs.map(async (s: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { vapidDetails: { subject: "mailto:info@thechekata.com", publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 * 60 * 12, urgency: "high" },
          );
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`;
          } else {
            console.error("[push] send failed:", err?.statusCode ?? "", err?.body ?? err?.message ?? err);
          }
        }
      }),
    );
  } catch (err) {
    console.error("[push] sendPushToUsers failed:", err);
  }
}

function uid(req: Request): number {
  return Number((req as any).user?.id);
}

// Mounted after app.use("/api", requireAuth), so every route is signed-in only.
export function registerPushRoutes(app: Express) {
  app.get("/api/push/public-key", async (_req, res) => {
    try {
      res.json({ publicKey: (await getVapidKeys()).publicKey });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Push not available" });
    }
  });

  app.get("/api/push/status", async (req, res) => {
    const [{ c }] = await sql`SELECT COUNT(*)::int AS c FROM push_subscriptions WHERE user_id = ${uid(req)}`;
    res.json({ devices: Number(c) || 0 });
  });

  // Body: a PushSubscription JSON ({ endpoint, keys: { p256dh, auth } }).
  app.post("/api/push/subscribe", async (req, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
    const p256dh = typeof req.body?.keys?.p256dh === "string" ? req.body.keys.p256dh : "";
    const auth = typeof req.body?.keys?.auth === "string" ? req.body.keys.auth : "";
    if (!endpoint.startsWith("https://") || !p256dh || !auth) return res.status(400).json({ error: "Invalid subscription" });
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 300);
    await sql`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
      VALUES (${uid(req)}, ${endpoint}, ${p256dh}, ${auth}, ${ua}, ${Date.now()})
      ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`;
    res.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
    if (endpoint) await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${uid(req)}`;
    res.json({ ok: true });
  });

  app.post("/api/push/test", async (req, res) => {
    await sendPushToUsers([uid(req)], { title: "CHAIMS alerts are on", body: "You'll get approvals, bookings and the daily close report here.", url: "/", tag: "push-test" });
    res.json({ ok: true });
  });
}
