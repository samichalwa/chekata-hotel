import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { PgSessionStore } from "./session-store";
import { runWithEnvironment, type DbEnvironment } from "./db-context";
import type { ModuleKey, SafeUser } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    // Which database this session's user is currently working in. Absent
    // (or "live") for every session created before Phase 6, and for every
    // ordinary login — only an admin who explicitly chose "Test" at sign-in
    // carries "test" here. See requireAuth/environmentMiddleware below for
    // how this routes the rest of the request to the right database.
    environment?: DbEnvironment;
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
  const session = await resolveSessionFromHeaderToken(req);
  return session?.userId;
}

// Same fallback lookup as above, but returns the whole stored session
// object (used by environmentMiddleware, which needs `environment` too,
// not just `userId`).
export async function resolveSessionFromHeaderToken(req: Request): Promise<(session.SessionData & { userId?: number }) | undefined> {
  const token = req.headers["x-session-token"];
  if (!token || typeof token !== "string") return undefined;
  return new Promise((resolve) => {
    pgSessionStore.get(token, (err, sess) => {
      if (err || !sess) return resolve(undefined);
      resolve(sess as any);
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
  canManageTablesList?: number;
  canManageMenuItemsList?: number;
  canCloseMaintenanceIssues?: number;
  canAdjustInventory?: number;
  canConfirmBookingWithoutPayment?: number;
  canCheckInWithoutId?: number;
  canAccessLive?: number;
  canAccessTest?: number;
  active: number;
  createdAt: number;
  staffId?: number | null;
}): SafeUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    permissions: user.permissions,
    canEditMovieBookings: user.canEditMovieBookings ?? 0,
    canManageTablesList: user.canManageTablesList ?? 0,
    canManageMenuItemsList: user.canManageMenuItemsList ?? 0,
    canCloseMaintenanceIssues: user.canCloseMaintenanceIssues ?? 0,
    canAdjustInventory: user.canAdjustInventory ?? 0,
    canConfirmBookingWithoutPayment: user.canConfirmBookingWithoutPayment ?? 0,
    canCheckInWithoutId: user.canCheckInWithoutId ?? 0,
    canAccessLive: user.canAccessLive ?? 1,
    canAccessTest: user.canAccessTest ?? 0,
    active: user.active,
    createdAt: user.createdAt,
    staffId: user.staffId ?? null,
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

// Establishes the Live/Test database context for the WHOLE rest of this
// request (every `storage`/`db`/`sql` call any downstream middleware or
// route handler makes) from the session's `environment` field, before any
// route-level auth check runs. Mounted once, directly after the session
// middleware, in server/index.ts. Requests with no session (not yet signed
// in) simply run in Live, same as before Phase 6 existed.
export async function environmentMiddleware(req: Request, res: Response, next: NextFunction) {
  let env: DbEnvironment = req.session?.environment === "test" ? "test" : "live";
  // Cookie-less fallback (see resolveUserIdFromHeaderToken below): the real
  // session — and its environment — lives under the x-session-token the
  // client sends back, not under req.session, when Set-Cookie got stripped.
  if (env === "live" && !req.session?.userId) {
    const fallback = await resolveSessionFromHeaderToken(req);
    if (fallback?.environment === "test") env = "test";
  }
  runWithEnvironment(env, next);
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
  // Environment access is enforced again here (not just at login) so an
  // account that loses canAccessTest/canAccessLive mid-session is immediately
  // cut off on its very next request, rather than only at its next login.
  // Admins always bypass both checks.
  if (req.session.environment === "test" && !user.isAdmin && !user.canAccessTest) {
    req.session.userId = undefined;
    return res.status(403).json({ error: "You don't have Test environment access. Ask an administrator to grant it." });
  }
  if (req.session.environment !== "test" && !user.isAdmin && !user.canAccessLive) {
    req.session.userId = undefined;
    return res.status(403).json({ error: "You don't have Live environment access. Ask an administrator to grant it." });
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

// Passes if the user has access to ANY of the given modules (admins always
// pass). Used where a resource (e.g. Tables, Menu Items) is read from more
// than one page — e.g. Bar & Restaurant needs to read Tables to populate a
// dropdown, even for a user who wasn't separately granted the Lists module.
export function requireAnyModule(moduleKeys: ModuleKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not signed in" });
    if (user.isAdmin) return next();
    const perms = parsePermissions(user.permissions);
    if (moduleKeys.some((k) => perms.includes(k))) return next();
    return res.status(403).json({ error: "You don't have access to this module" });
  };
}

// Requires the signed-in user to be an administrator OR to hold the dedicated
// "manage tables list" right — used to gate creating/editing/deleting Table
// entries from the Lists module, separate from the "lists" module access
// needed just to view them.
export function requireCanManageTablesList(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canManageTablesList) return next();
  return res.status(403).json({ error: "You don't have rights to manage the Tables list" });
}

// Same pattern as above, for the Menu Items list.
export function requireCanManageMenuItemsList(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canManageMenuItemsList) return next();
  return res.status(403).json({ error: "You don't have rights to manage the Menu Items list" });
}

// Requires the signed-in user to be an administrator OR to hold the dedicated
// "close maintenance issues" right — used to gate the final Close action on
// a reported maintenance issue, separate from the "maintenance" module
// access needed to view/report/progress issues.
export function requireCanCloseMaintenanceIssues(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canCloseMaintenanceIssues) return next();
  return res.status(403).json({ error: "You don't have rights to close maintenance issues" });
}

// Requires the signed-in user to be an administrator OR to hold the dedicated
// "adjust inventory" right — used to gate manual stock adjustments and the
// cancellation of Purchase Requisitions, Purchase Orders, and Internal
// Requisitions, separate from the module access needed to view/create them.
export function requireCanAdjustInventory(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canAdjustInventory) return next();
  return res.status(403).json({ error: "You don't have rights to adjust inventory or cancel this document" });
}

// Requires the signed-in user to be an administrator OR to hold the dedicated
// "confirm booking without payment" right — used to gate the Director's-
// discretion override that confirms an accommodation/facility booking before
// any payment has been recorded.
export function requireCanConfirmBookingWithoutPayment(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canConfirmBookingWithoutPayment) return next();
  return res.status(403).json({ error: "You don't have rights to confirm a booking without payment" });
}

// Requires the signed-in user to be an administrator OR to hold the dedicated
// "check in without ID" right — used to gate the Director's-discretion
// override that checks in a guest before any ID document has been recorded.
export function requireCanCheckInWithoutId(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.isAdmin || user.canCheckInWithoutId) return next();
  return res.status(403).json({ error: "You don't have rights to check in a guest without an ID document" });
}

// Settings is restricted to the literal "admin" account only, per governance
// spec, even for other users who otherwise hold isAdmin rights. This is
// intentionally username-based (not the isAdmin flag) so that Settings stays
// a single-owner area regardless of how many administrator accounts exist.
export function requireAdminUsername(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (user.username === "admin") return next();
  return res.status(403).json({ error: "Settings is restricted to the admin account" });
}

// Generic table-level write permission check, reusable by every module.
// Admins always bypass. A missing permission_table_rules row means no
// restriction has been configured for that user/table, so access is
// allowed by default (module-level access already gated the route).
// Only a row with can_write = 0 explicitly blocks the write.
export function requireTablePermission(tableKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not signed in" });
    if (user.isAdmin) return next();
    const rules = await storage.listPermissionTableRulesForUser(user.id);
    const rule = rules.find((r) => r.tableKey === tableKey);
    if (rule && !rule.canWrite) {
      return res.status(403).json({ error: "You don't have write rights for this table" });
    }
    return next();
  };
}
