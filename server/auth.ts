import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { PgSessionStore } from "./session-store";
import type { ModuleKey, SafeUser } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

const SESSION_SECRET = process.env.SESSION_SECRET || "chekata-hotel-dev-secret-change-in-production";

// Shared instance so the header-token fallback below can query the same
// backing store that express-session uses for cookie-based sessions.
export const pgSessionStore = new PgSessionStore();

export const sessionMiddleware = session({
  store: pgSessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // shared hosting is commonly proxied http->https; keep false for compatibility
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
  },
});

// Some hosting/preview environments (e.g. sandboxed iframe previews) strip
// Set-Cookie headers entirely, so the normal cookie-based session never
// reaches the browser. As a fallback, the client can send back the raw
// session id it received at login in an `x-session-token` header, and we
// resolve it directly against the session store here — no cookie required.
export async function resolveUserIdFromHeaderToken(req: Request): Promise<number | undefined> {
  const token = req.headers["x-session-token"];
  if (!token || typeof token !== "string") return undefined;
  return new Promise((resolve) => {
    pgSessionStore.get(token, (err, sess) => {
      if (err || !sess) return resolve(undefined);
      resolve((sess as any).userId);
    });
  });
}

export function toSafeUser(user: {
  id: number;
  username: string;
  fullName: string;
  isAdmin: number;
  permissions: string;
  canEditMovieBookings?: number;
  active: number;
  createdAt: number;
}): SafeUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    permissions: user.permissions,
    canEditMovieBookings: user.canEditMovieBookings ?? 0,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export function parsePermissions(json: string): ModuleKey[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Requires a logged-in, active user for any /api route it guards.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId ?? (await resolveUserIdFromHeaderToken(req));
  if (!userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const user = await storage.getUser(userId);
  if (!user || !user.active) {
    req.session.userId = undefined;
    return res.status(401).json({ error: "Not signed in" });
  }
  (req as any).user = user;
  next();
}

// Requires the signed-in user to have access to a given module (admins always pass).
export function requireModule(moduleKey: ModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not signed in" });
    if (user.isAdmin) return next();
    const perms = parsePermissions(user.permissions);
    if (perms.includes(moduleKey)) return next();
    return res.status(403).json({ error: "You don't have access to this module" });
  };
}

// Requires the signed-in user to be an administrator.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!user.isAdmin) return res.status(403).json({ error: "Administrator access required" });
  next();
}

// Requires the signed-in user to be an administrator OR to hold the dedicated
// "edit movie bookings" right — used to gate editing/cancelling an *existing*
// movie seat booking, separate from the "movie-room" module access needed to
// view the page and create new bookings.
export function requireCanEditMovieBookings(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canEditMovieBookings) return next();
  return res.status(403).json({ error: "You don't have rights to edit movie bookings" });
}
