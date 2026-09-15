import session from "express-session";
import { liveSql as sql } from "./storage";

// A persistent, Postgres-backed session store using the same database as the
// rest of the app. Unlike the default in-memory express-session store,
// sessions survive process restarts (e.g. when a host idles/restarts the
// Node.js process, or when a new version is deployed). The `sessions` table
// itself is created by storage.ts's schema bootstrap.
//
// Deliberately always Live (`liveSql`, never the environment-routed `sql`
// proxy): a session has to be readable before we know which environment it
// carries, so the session store itself can't be environment-routed without
// a chicken-and-egg problem. Every session — whether the signed-in user is
// currently working in Live or Test — lives in this one table on Live, and
// simply carries an `environment` field (see server/auth.ts) that later
// middleware reads to route the REST of that request's queries.
export class PgSessionStore extends session.Store {
  constructor() {
    super();
    // Opportunistic cleanup of expired sessions on startup and every hour.
    this.pruneExpired();
    setInterval(() => this.pruneExpired(), 60 * 60 * 1000);
  }

  private async pruneExpired() {
    try {
      await sql`DELETE FROM sessions WHERE expire < ${Date.now()}`;
    } catch {
      // non-fatal
    }
  }

  async get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    try {
      const rows = await sql`SELECT sess, expire FROM sessions WHERE sid = ${sid}`;
      const row = rows[0] as { sess: string; expire: number } | undefined;
      if (!row || Number(row.expire) < Date.now()) {
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  async set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 14;
      const expire = Date.now() + maxAge;
      const sessJson = JSON.stringify(sess);
      await sql`
        INSERT INTO sessions (sid, sess, expire) VALUES (${sid}, ${sessJson}, ${expire})
        ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
      `;
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      await sql`DELETE FROM sessions WHERE sid = ${sid}`;
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async touch(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 14;
      const expire = Date.now() + maxAge;
      await sql`UPDATE sessions SET expire = ${expire} WHERE sid = ${sid}`;
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}
