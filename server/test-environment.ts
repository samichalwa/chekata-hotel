import { sql, testSql, isTestDbConfigured } from "./storage";
import { getCurrentEnvironment } from "./db-context";

// Central helpers backing the Test/Live environment split (Phase 6):
//   - message interception logging (see server/email.ts, server/sms.ts)
//   - the 30-day auto-purge of that log
//
// Deliberately does NOT touch the "Copy live to test" job itself — that
// lives in server/copy-live-to-test.ts, since it needs simultaneous direct
// access to both databases rather than the single environment-routed `sql`.

export interface TestMessageLogInput {
  channel: "email" | "sms" | "whatsapp";
  recipient: string;
  subject?: string | null;
  bodyPreview?: string | null;
  attachmentFilename?: string | null;
}

// Records an outbound message that was intercepted (blocked) because the
// current request is running in the Test environment. Always writes to
// whichever database is CURRENTLY active — which, by construction, is only
// ever called from inside a Test-mode request, so this lands in the Test
// database's own test_message_log, never Live's.
export async function logTestMessage(input: TestMessageLogInput): Promise<void> {
  if (getCurrentEnvironment() !== "test") return; // safety net; callers already check this
  const preview = input.bodyPreview ? input.bodyPreview.slice(0, 500) : null;
  await sql`
    INSERT INTO test_message_log (channel, recipient, subject, body_preview, attachment_filename, blocked, created_at)
    VALUES (${input.channel}, ${input.recipient}, ${input.subject ?? null}, ${preview}, ${input.attachmentFilename ?? null}, 1, ${Date.now()})
  `;
}

export async function listTestMessageLog(limit = 200) {
  return sql`SELECT * FROM test_message_log ORDER BY id DESC LIMIT ${limit}`;
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function purgeOldTestMessages() {
  if (!isTestDbConfigured() || !testSql) return;
  try {
    const cutoff = Date.now() - RETENTION_MS;
    await testSql`DELETE FROM test_message_log WHERE created_at < ${cutoff}`;
  } catch (err) {
    console.error("[test-environment] Failed to purge old test_message_log rows:", err);
  }
}

// Runs the 30-day auto-purge once at boot, then hourly. Call once from
// server/index.ts after schemaReady. No-op (logs nothing, throws nothing)
// when Test isn't configured on this server.
export function startTestMessageLogPurgeSchedule() {
  purgeOldTestMessages();
  setInterval(purgeOldTestMessages, PURGE_INTERVAL_MS);
}
