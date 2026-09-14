import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { storage } from "./storage";
import {
  insertRoomSchema, insertAccommodationBookingSchema,
  insertFacilitySchema, insertFacilityBookingSchema,
  insertMovieShowSchema, insertMovieSeatBookingSchema, MOVIE_SEAT_ROWS, MOVIE_SEAT_NUMBERS,
  insertMenuItemSchema, insertOrderSchema, insertOrderItemSchema,
  insertStaffSchema, insertExpenseSchema, insertSettingsSchema,
  insertUserSchema, insertTaxSchema, MODULE_KEYS, type ModuleKey,
  insertTableSchema, insertMaintenanceIssueSchema, MAINTENANCE_CATEGORIES,
  insertChartOfAccountSchema, insertAccountingPeriodSchema,
  insertJournalEntrySchema, insertJournalEntryLineSchema,
  insertBankAccountSchema, insertBankReconciliationSchema,
  insertPaymentVoucherSchema, insertApprovalMatrixRuleSchema,
  insertDefinitionListSchema, insertDefinitionListItemSchema,
  PERMISSION_TABLE_KEYS, type PermissionTableKey,
} from "@shared/schema";
import { issueDocument } from "./documents";
import { buildDocumentPdf, buildMaintenanceReportPdf } from "./pdf";
import { sendTransactionalEmail } from "./email";
import { sendSms } from "./sms";
import { buildReportsWorkbook, REPORT_SHEET_LABELS, type ReportSheetKey } from "./reports-excel";
import {
  requireAuth, requireModule, requireAdmin, requireCanEditMovieBookings,
  requireAnyModule, requireCanManageTablesList, requireCanManageMenuItemsList, requireCanCloseMaintenanceIssues,
  requireAdminUsername, requireTablePermission,
  hashPassword, verifyPassword, toSafeUser, parsePermissions, resolveUserIdFromHeaderToken,
} from "./auth";

const STAFF_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@thechekata\.com$/i;

function handleZodError(res: any, err: any) {
  res.status(400).json({ error: err?.message ?? "Invalid request" });
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ---------- Auth (unprotected: setup, login, logout, current user) ----------
  app.get("/api/auth/setup-status", async (_req, res) => {
    const count = await storage.countUsers();
    res.json({ needsSetup: count === 0 });
  });

  app.post("/api/auth/setup", async (req, res) => {
    try {
      const count = await storage.countUsers();
      if (count > 0) return res.status(403).json({ error: "Setup has already been completed." });
      const { username, password, fullName } = req.body as { username?: string; password?: string; fullName?: string };
      if (!username || !password || !fullName) return res.status(400).json({ error: "Username, password and full name are required." });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        username: username.trim().toLowerCase(),
        passwordHash,
        fullName: fullName.trim(),
        isAdmin: 1,
        permissions: JSON.stringify(MODULE_KEYS),
        active: 1,
        createdAt: Date.now(),
      });
      req.session.userId = user.id;
      res.status(201).json({ ...toSafeUser(user), sessionToken: req.sessionID });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to complete setup" }); }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) return res.status(400).json({ error: "Username and password are required." });
      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user || !user.active) return res.status(401).json({ error: "Invalid username or password." });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Invalid username or password." });
      req.session.userId = user.id;
      res.json({ ...toSafeUser(user), sessionToken: req.sessionID });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to sign in" }); }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.status(204).end());
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = req.session.userId ?? (await resolveUserIdFromHeaderToken(req));
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    const user = await storage.getUser(userId);
    if (!user || !user.active) return res.status(401).json({ error: "Not signed in" });
    res.json(toSafeUser(user));
  });

  const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
  const GENERIC_RESET_RESPONSE = { message: "If that account has an email on file, a password reset link has been sent to it." };

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { username } = req.body as { username?: string };
      if (!username) return res.json(GENERIC_RESET_RESPONSE);
      const uname = username.trim().toLowerCase();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uname);
      const user = await storage.getUserByUsername(uname);
      // Only accounts whose username IS an email address can receive a reset link this way
      // (e.g. the initial administrator account created during setup may not have one).
      if (user && user.active && isEmail) {
        const token = randomBytes(32).toString("hex");
        await storage.createPasswordResetToken({
          userId: user.id,
          token,
          expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
          usedAt: null,
          createdAt: Date.now(),
        });
        const settings = await storage.getSettings();
        const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol;
        const origin = `${proto}://${req.get("host")}`;
        const resetLink = `${origin}/#/reset-password?token=${token}`;
        const hotelName = settings.hotelName || "The Chekata";
        const html = `
          <p>Hello ${user.fullName || ""},</p>
          <p>We received a request to reset the password for your ${hotelName} account.</p>
          <p><a href="${resetLink}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Reset your password</a></p>
          <p>Or copy and paste this link into your browser:<br/>${resetLink}</p>
          <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        `;
        const result = await sendTransactionalEmail({
          settings,
          to: uname,
          toName: user.fullName,
          subject: `Reset your password — ${hotelName}`,
          html,
        });
        if (!result.ok) console.error("Failed to send password reset email:", result.error);
      }
      // Always return the same generic response so we never reveal whether an account exists.
      res.json(GENERIC_RESET_RESPONSE);
    } catch (err: any) {
      console.error("forgot-password error:", err);
      res.json(GENERIC_RESET_RESPONSE);
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body as { token?: string; password?: string };
      if (!token || !password) return res.status(400).json({ error: "Token and new password are required." });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
      const record = await storage.getPasswordResetToken(token);
      if (!record || record.usedAt || record.expiresAt < Date.now()) {
        return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
      }
      const passwordHash = await hashPassword(password);
      await storage.updateUser(record.userId, { passwordHash });
      await storage.markPasswordResetTokenUsed(token);
      res.json({ message: "Your password has been updated. You can now sign in." });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to reset password" });
    }
  });

  // ---------- Public, tokenized PDF links (no login) — embedded in free WhatsApp click-to-send
  // messages, which can only carry text, never a real file attachment. Each token is an
  // unguessable random string; a mismatch or missing document returns a generic 404 so we never
  // reveal whether a given id exists. ----------
  app.get("/api/public/documents/:id/pdf", async (req, res) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc || !doc.publicToken || !token || doc.publicToken !== token) {
        return res.status(404).json({ error: "Not found" });
      }
      const settings = await storage.getSettings();
      const payload = JSON.parse(doc.payloadJson);
      const pdf = await buildDocumentPdf(settings, { docNumber: doc.sourceId, ...payload });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${doc.docType}-${doc.sourceId}.pdf"`);
      res.send(pdf);
    } catch {
      res.status(404).json({ error: "Not found" });
    }
  });
  app.get("/api/public/maintenance/:id/pdf", async (req, res) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const issue = await storage.getMaintenanceIssue(Number(req.params.id));
      if (!issue || !issue.publicToken || !token || issue.publicToken !== token) {
        return res.status(404).json({ error: "Not found" });
      }
      const settings = await storage.getSettings();
      const pdf = await buildMaintenanceReportPdf(settings, issue);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="maintenance-${issue.id}.pdf"`);
      res.send(pdf);
    } catch {
      res.status(404).json({ error: "Not found" });
    }
  });

  // ---------- Everything below requires a signed-in, active user ----------
  app.use("/api", requireAuth);

  // Cross-module utility: lets a WhatsApp button in an edit/detail dialog fetch the CURRENT
  // latest document for a given source record at click time (live form/booking state is not
  // tied to any fresh mutation response). Any signed-in user may call this — it is not gated by
  // a specific module permission since the calling page has already authorized the user.
  app.get("/api/documents/latest/:category/:sourceId", async (req, res) => {
    try {
      const doc = await storage.getLatestDocumentBySource(req.params.category, Number(req.params.sourceId));
      if (!doc || !doc.publicToken) return res.status(404).json({ error: "No document found" });
      res.json({ id: doc.id, publicToken: doc.publicToken, docType: doc.docType });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to look up document" }); }
  });

  // ---------- Users (admin only) ----------
  app.get("/api/users", requireAdmin, async (_req, res) => {
    const list = await storage.listUsers();
    res.json(list.map(toSafeUser));
  });
  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, fullName, isAdmin, permissions, active, canEditMovieBookings, canManageTablesList, canManageMenuItemsList, canCloseMaintenanceIssues } = req.body as {
        username?: string; password?: string; fullName?: string; isAdmin?: boolean; permissions?: ModuleKey[]; active?: boolean;
        canEditMovieBookings?: boolean; canManageTablesList?: boolean; canManageMenuItemsList?: boolean; canCloseMaintenanceIssues?: boolean;
      };
      if (!username || !password || !fullName) return res.status(400).json({ error: "Username, password and full name are required." });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
      if (!isAdmin && !STAFF_EMAIL_REGEX.test(username.trim())) {
        return res.status(400).json({ error: "Staff accounts must use a @thechekata.com email address as their username." });
      }
      const passwordHash = await hashPassword(password);
      const validPerms = Array.isArray(permissions) ? permissions.filter((p) => (MODULE_KEYS as readonly string[]).includes(p)) : [];
      const user = await storage.createUser({
        username: username.trim().toLowerCase(),
        passwordHash,
        fullName: fullName.trim(),
        isAdmin: isAdmin ? 1 : 0,
        permissions: JSON.stringify(validPerms),
        canEditMovieBookings: canEditMovieBookings ? 1 : 0,
        canManageTablesList: canManageTablesList ? 1 : 0,
        canManageMenuItemsList: canManageMenuItemsList ? 1 : 0,
        canCloseMaintenanceIssues: canCloseMaintenanceIssues ? 1 : 0,
        active: active === false ? 0 : 1,
        createdAt: Date.now(),
      });
      res.status(201).json(toSafeUser(user));
    } catch (err: any) {
      if (/unique/i.test(String(err?.message))) return res.status(400).json({ error: "That username is already taken." });
      res.status(500).json({ error: err?.message ?? "Failed to create user" });
    }
  });
  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const target = await storage.getUser(id);
      if (!target) return res.status(404).json({ error: "User not found" });
      const { username, password, fullName, isAdmin, permissions, active, canEditMovieBookings, canManageTablesList, canManageMenuItemsList, canCloseMaintenanceIssues } = req.body as {
        username?: string; password?: string; fullName?: string; isAdmin?: boolean; permissions?: ModuleKey[]; active?: boolean;
        canEditMovieBookings?: boolean; canManageTablesList?: boolean; canManageMenuItemsList?: boolean; canCloseMaintenanceIssues?: boolean;
      };
      const currentUserId = (req as any).user.id;
      if (currentUserId === id && isAdmin === false) {
        return res.status(400).json({ error: "You can't remove your own administrator access." });
      }
      if (currentUserId === id && active === false) {
        return res.status(400).json({ error: "You can't deactivate your own account." });
      }
      const willBeAdmin = typeof isAdmin === "boolean" ? isAdmin : !!target.isAdmin;
      if (username && !willBeAdmin && !STAFF_EMAIL_REGEX.test(username.trim())) {
        return res.status(400).json({ error: "Staff accounts must use a @thechekata.com email address as their username." });
      }
      const patch: Record<string, any> = {};
      if (username) patch.username = username.trim().toLowerCase();
      if (fullName) patch.fullName = fullName.trim();
      if (typeof isAdmin === "boolean") patch.isAdmin = isAdmin ? 1 : 0;
      if (Array.isArray(permissions)) patch.permissions = JSON.stringify(permissions.filter((p) => (MODULE_KEYS as readonly string[]).includes(p)));
      if (typeof active === "boolean") patch.active = active ? 1 : 0;
      if (typeof canEditMovieBookings === "boolean") patch.canEditMovieBookings = canEditMovieBookings ? 1 : 0;
      if (typeof canManageTablesList === "boolean") patch.canManageTablesList = canManageTablesList ? 1 : 0;
      if (typeof canManageMenuItemsList === "boolean") patch.canManageMenuItemsList = canManageMenuItemsList ? 1 : 0;
      if (typeof canCloseMaintenanceIssues === "boolean") patch.canCloseMaintenanceIssues = canCloseMaintenanceIssues ? 1 : 0;
      if (password) {
        if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
        patch.passwordHash = await hashPassword(password);
      }
      const updated = await storage.updateUser(id, patch);
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json(toSafeUser(updated));
    } catch (err: any) {
      if (/unique/i.test(String(err?.message))) return res.status(400).json({ error: "That username is already taken." });
      res.status(500).json({ error: err?.message ?? "Failed to update user" });
    }
  });
  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const currentUserId = (req as any).user.id;
    if (currentUserId === id) return res.status(400).json({ error: "You can't delete your own account while signed in." });
    await storage.deleteUser(id);
    res.status(204).end();
  });

  // ---------- Taxes (Settings module) ----------
  app.get("/api/taxes", requireModule("settings"), async (_req, res) => {
    res.json(await storage.listTaxes());
  });
  app.post("/api/taxes", requireModule("settings"), async (req, res) => {
    try {
      const data = insertTaxSchema.parse(req.body);
      res.status(201).json(await storage.createTax(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/taxes/:id", requireModule("settings"), async (req, res) => {
    try {
      const data = insertTaxSchema.partial().parse(req.body);
      const updated = await storage.updateTax(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Tax not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/taxes/:id", requireModule("settings"), async (req, res) => {
    await storage.deleteTax(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Rooms ----------
  app.get("/api/rooms", async (_req, res) => {
    res.json(await storage.listRooms());
  });
  app.post("/api/rooms", requireModule("accommodation"), async (req, res) => {
    try {
      const data = insertRoomSchema.parse(req.body);
      res.status(201).json(await storage.createRoom(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/rooms/:id", requireModule("accommodation"), async (req, res) => {
    try {
      const data = insertRoomSchema.partial().parse(req.body);
      const updated = await storage.updateRoom(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Room not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/rooms/:id", requireModule("accommodation"), async (req, res) => {
    await storage.deleteRoom(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Accommodation Bookings ----------
  app.get("/api/accommodation-bookings", requireModule("accommodation"), async (_req, res) => {
    res.json(await storage.listAccommodationBookings());
  });
  app.post("/api/accommodation-bookings", requireModule("accommodation"), async (req, res) => {
    try {
      const data = insertAccommodationBookingSchema.parse(req.body);
      const booking = await storage.createAccommodationBooking(data);
      const room = await storage.getRoom(booking.roomId);
      const nights = nightsBetween(booking.checkIn, booking.checkOut);
      const doc = await issueDocument(storage, {
        docType: "invoice",
        category: "accommodation",
        sourceId: booking.id,
        recipientName: booking.guestName,
        recipientEmail: booking.guestEmail,
        issueDate: formatDate(),
        lineItems: [{
          label: `${room?.name ?? "Room"} \u2014 ${nights} night(s)`,
          detail: `${booking.checkIn} to ${booking.checkOut} @ KES ${booking.rate.toLocaleString("en-KE")}/night`,
          amount: booking.totalAmount,
        }],
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountPaid,
        balance: booking.totalAmount - booking.amountPaid,
        paymentMethod: booking.paymentMethod,
        paymentReference: booking.paymentReference,
      });
      res.status(201).json({ ...booking, _document: { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken } });
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/accommodation-bookings/:id", requireModule("accommodation"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const before = await storage.getAccommodationBooking(id);
      if (!before) return res.status(404).json({ error: "Booking not found" });
      const data = insertAccommodationBookingSchema.partial().parse(req.body);
      const updated = await storage.updateAccommodationBooking(id, data);
      if (!updated) return res.status(404).json({ error: "Booking not found" });
      let docResult: any = null;
      const paymentDelta = (updated.amountPaid ?? 0) - (before.amountPaid ?? 0);
      if (paymentDelta > 0) {
        const room = await storage.getRoom(updated.roomId);
        const doc = await issueDocument(storage, {
          docType: "receipt",
          category: "accommodation",
          sourceId: updated.id,
          recipientName: updated.guestName,
          recipientEmail: updated.guestEmail,
          issueDate: formatDate(),
          lineItems: [{ label: `${room?.name ?? "Room"} \u2014 payment received`, amount: paymentDelta }],
          totalAmount: updated.totalAmount,
          amountPaid: updated.amountPaid,
          balance: updated.totalAmount - updated.amountPaid,
          paymentAmount: paymentDelta,
          paymentMethod: updated.paymentMethod,
          paymentReference: updated.paymentReference,
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken };
      }
      res.json({ ...updated, _document: docResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/accommodation-bookings/:id", requireModule("accommodation"), async (req, res) => {
    await storage.deleteAccommodationBooking(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Facilities ----------
  app.get("/api/facilities", requireModule("facilities"), async (_req, res) => {
    res.json(await storage.listFacilities());
  });
  app.post("/api/facilities", requireModule("facilities"), async (req, res) => {
    try {
      const data = insertFacilitySchema.parse(req.body);
      res.status(201).json(await storage.createFacility(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/facilities/:id", requireModule("facilities"), async (req, res) => {
    try {
      const data = insertFacilitySchema.partial().parse(req.body);
      const updated = await storage.updateFacility(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Facility not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/facilities/:id", requireModule("facilities"), async (req, res) => {
    await storage.deleteFacility(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Facility Bookings ----------
  app.get("/api/facility-bookings", requireModule("facilities"), async (_req, res) => {
    res.json(await storage.listFacilityBookings());
  });
  app.post("/api/facility-bookings", requireModule("facilities"), async (req, res) => {
    try {
      const data = insertFacilityBookingSchema.parse(req.body);
      const booking = await storage.createFacilityBooking(data);
      const facility = await storage.getFacility(booking.facilityId);
      const doc = await issueDocument(storage, {
        docType: "invoice",
        category: "facility",
        sourceId: booking.id,
        recipientName: booking.clientName,
        recipientEmail: booking.clientEmail,
        issueDate: formatDate(),
        lineItems: [{
          label: `${facility?.name ?? "Facility"} booking`,
          detail: `${booking.eventDate}${booking.startTime ? ` ${booking.startTime}-${booking.endTime ?? ""}` : ""}`,
          amount: booking.totalAmount,
        }],
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountPaid,
        balance: booking.totalAmount - booking.amountPaid,
        paymentMethod: booking.paymentMethod,
        paymentReference: booking.paymentReference,
      });
      res.status(201).json({ ...booking, _document: { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken } });
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/facility-bookings/:id", requireModule("facilities"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const before = await storage.getFacilityBooking(id);
      if (!before) return res.status(404).json({ error: "Booking not found" });
      const data = insertFacilityBookingSchema.partial().parse(req.body);
      const updated = await storage.updateFacilityBooking(id, data);
      if (!updated) return res.status(404).json({ error: "Booking not found" });
      let docResult: any = null;
      const paymentDelta = (updated.amountPaid ?? 0) - (before.amountPaid ?? 0);
      if (paymentDelta > 0) {
        const facility = await storage.getFacility(updated.facilityId);
        const doc = await issueDocument(storage, {
          docType: "receipt",
          category: "facility",
          sourceId: updated.id,
          recipientName: updated.clientName,
          recipientEmail: updated.clientEmail,
          issueDate: formatDate(),
          lineItems: [{ label: `${facility?.name ?? "Facility"} \u2014 payment received`, amount: paymentDelta }],
          totalAmount: updated.totalAmount,
          amountPaid: updated.amountPaid,
          balance: updated.totalAmount - updated.amountPaid,
          paymentAmount: paymentDelta,
          paymentMethod: updated.paymentMethod,
          paymentReference: updated.paymentReference,
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken };
      }
      res.json({ ...updated, _document: docResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/facility-bookings/:id", requireModule("facilities"), async (req, res) => {
    await storage.deleteFacilityBooking(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Movie Room: Shows ----------
  app.get("/api/movie-shows", requireModule("movie-room"), async (_req, res) => {
    res.json(await storage.listMovieShows());
  });
  app.post("/api/movie-shows", requireModule("movie-room"), async (req, res) => {
    try {
      const data = insertMovieShowSchema.parse({ ...req.body, createdAt: Date.now() });
      res.status(201).json(await storage.createMovieShow(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/movie-shows/:id", requireModule("movie-room"), async (req, res) => {
    try {
      const data = insertMovieShowSchema.partial().parse(req.body);
      const updated = await storage.updateMovieShow(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Show not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/movie-shows/:id", requireModule("movie-room"), async (req, res) => {
    const showId = Number(req.params.id);
    const linkedSeats = (await storage.listMovieSeatBookings()).filter((b) => b.showId === showId && b.status !== "cancelled");
    if (linkedSeats.length > 0) {
      return res.status(400).json({ error: "This show has active seat bookings. Cancel those bookings first." });
    }
    await storage.deleteMovieShow(showId);
    res.status(204).end();
  });

  // ---------- Movie Room: Seat bookings ----------
  app.get("/api/movie-seat-bookings", requireModule("movie-room"), async (_req, res) => {
    res.json(await storage.listMovieSeatBookings());
  });

  // Books one or more seats across one or two consecutive shows in a single
  // transaction/receipt ("booking_ref" groups the rows). Body:
  // { guestName, guestPhone?, guestEmail?, amountPaid, notes?,
  //   legs: [{ showId, seats: [{ row: "B", number: 4 }, ...] }, ...] }
  app.post("/api/movie-seat-bookings", requireModule("movie-room"), async (req, res) => {
    try {
      const body = req.body as {
        guestName?: string; guestPhone?: string; guestEmail?: string;
        amountPaid?: number; notes?: string; paymentMethod?: string; paymentReference?: string;
        legs?: { showId: number; seats: { row: string; number: number }[] }[];
      };
      const guestName = (body.guestName ?? "").trim();
      if (!guestName) return res.status(400).json({ error: "Guest name is required." });
      const legs = Array.isArray(body.legs) ? body.legs : [];
      if (legs.length === 0) return res.status(400).json({ error: "Select at least one seat." });
      if (legs.length > 2) return res.status(400).json({ error: "You can book at most two shows in one transaction." });

      // Validate legs, shows, and seat coordinates up front.
      const shows: Record<number, Awaited<ReturnType<typeof storage.getMovieShow>>> = {};
      for (const leg of legs) {
        const show = await storage.getMovieShow(leg.showId);
        if (!show) return res.status(400).json({ error: `Show #${leg.showId} was not found.` });
        if (show.status === "cancelled") return res.status(400).json({ error: `"${show.name}" has been cancelled.` });
        shows[leg.showId] = show;
        if (!Array.isArray(leg.seats) || leg.seats.length === 0) {
          return res.status(400).json({ error: `Select at least one seat for "${show.name}".` });
        }
        for (const seat of leg.seats) {
          if (!(MOVIE_SEAT_ROWS as readonly string[]).includes(seat.row)) {
            return res.status(400).json({ error: `Invalid seat row "${seat.row}".` });
          }
          if (!(MOVIE_SEAT_NUMBERS as readonly number[]).includes(seat.number)) {
            return res.status(400).json({ error: `Invalid seat number "${seat.number}".` });
          }
        }
      }

      // Check for seat conflicts against existing active bookings.
      const existing = await storage.listMovieSeatBookings();
      for (const leg of legs) {
        for (const seat of leg.seats) {
          const conflict = existing.find(
            (b) => b.showId === leg.showId && b.status !== "cancelled" && b.seatRow === seat.row && b.seatNumber === seat.number,
          );
          if (conflict) {
            return res.status(409).json({ error: `Seat ${seat.row}${seat.number} is already booked for "${shows[leg.showId]!.name}".` });
          }
        }
      }

      const bookingRef = `MOV-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const createdAt = Date.now();
      let remainingPaid = Math.max(0, Number(body.amountPaid) || 0);
      const created: Awaited<ReturnType<typeof storage.createMovieSeatBooking>>[] = [];
      const lineItems: { label: string; detail?: string; amount: number }[] = [];
      const smsLegLines: string[] = [];

      for (const leg of legs) {
        const show = shows[leg.showId]!;
        const seatCodes = leg.seats.map((s) => `${s.row}${s.number}`).sort();
        smsLegLines.push(`${show.name} \u2014 ${show.showDate} ${show.startTime}${show.endTime ? `-${show.endTime}` : ""} \u2014 Seat(s): ${seatCodes.join(", ")}`);
        for (const seat of leg.seats) {
          const pay = Math.min(remainingPaid, show.ticketPrice);
          remainingPaid -= pay;
          const row = await storage.createMovieSeatBooking({
            showId: leg.showId,
            seatRow: seat.row,
            seatNumber: seat.number,
            guestName,
            guestPhone: body.guestPhone || null,
            guestEmail: body.guestEmail || null,
            ticketPrice: show.ticketPrice,
            amountPaid: pay,
            paymentMethod: body.paymentMethod || null,
            paymentReference: body.paymentReference || null,
            status: "booked",
            bookingRef,
            notes: body.notes || null,
            createdAt,
          });
          created.push(row);
          lineItems.push({
            label: `${show.name} \u2014 Seat ${seat.row}${seat.number}`,
            detail: `${show.showDate} ${show.startTime}${show.endTime ? `-${show.endTime}` : ""}`,
            amount: show.ticketPrice,
          });
        }
      }

      const totalAmount = created.reduce((sum, r) => sum + r.ticketPrice, 0);
      const amountPaid = created.reduce((sum, r) => sum + r.amountPaid, 0);
      const doc = await issueDocument(storage, {
        docType: "invoice",
        category: "movie",
        sourceId: created[0]!.id,
        recipientName: guestName,
        recipientEmail: body.guestEmail || null,
        issueDate: formatDate(),
        lineItems,
        totalAmount,
        amountPaid,
        balance: totalAmount - amountPaid,
        paymentMethod: body.paymentMethod || null,
        paymentReference: body.paymentReference || null,
      });

      let smsResult: { status: "sent" | "skipped"; errorMessage?: string } | null = null;
      if (amountPaid > 0 && body.guestPhone) {
        const paymentDetailLine = (body.paymentMethod || body.paymentReference)
          ? `\nPayment: ${[body.paymentMethod, body.paymentReference].filter(Boolean).join(" / ")}`
          : "";
        const message = `Hi ${guestName}, your Movie Room booking at The Chekata is confirmed:\n${smsLegLines.join("\n")}\nTotal paid: KES ${amountPaid.toLocaleString()}.${paymentDetailLine}\nEnjoy the show!`;
        const sms = await sendSms({ settings: await storage.getSettings(), to: body.guestPhone, message });
        smsResult = sms.ok ? { status: "sent" } : { status: "skipped", errorMessage: sms.error };
      }

      res.status(201).json({ bookingRef, bookings: created, _document: { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken }, _sms: smsResult });
    } catch (err) { handleZodError(res, err); }
  });

  app.patch("/api/movie-seat-bookings/:id", requireModule("movie-room"), requireCanEditMovieBookings, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const before = await storage.getMovieSeatBooking(id);
      if (!before) return res.status(404).json({ error: "Booking not found" });
      const data = insertMovieSeatBookingSchema.partial().parse(req.body);
      if (data.seatRow || typeof data.seatNumber === "number") {
        const newRow = data.seatRow ?? before.seatRow;
        const newNumber = data.seatNumber ?? before.seatNumber;
        const showId = data.showId ?? before.showId;
        const conflict = (await storage.listMovieSeatBookings()).find(
          (b) => b.id !== id && b.showId === showId && b.status !== "cancelled" && b.seatRow === newRow && b.seatNumber === newNumber,
        );
        if (conflict) return res.status(409).json({ error: `Seat ${newRow}${newNumber} is already booked for that show.` });
      }
      const updated = await storage.updateMovieSeatBooking(id, data);
      if (!updated) return res.status(404).json({ error: "Booking not found" });
      let docResult: any = null;
      const paymentDelta = (updated.amountPaid ?? 0) - (before.amountPaid ?? 0);
      if (paymentDelta > 0) {
        const show = await storage.getMovieShow(updated.showId);
        const doc = await issueDocument(storage, {
          docType: "receipt",
          category: "movie",
          sourceId: updated.id,
          recipientName: updated.guestName,
          recipientEmail: updated.guestEmail,
          issueDate: formatDate(),
          lineItems: [{
            label: `${show?.name ?? "Movie Room"} \u2014 Seat ${updated.seatRow}${updated.seatNumber} \u2014 payment received`,
            detail: show ? `${show.showDate} ${show.startTime}${show.endTime ? `-${show.endTime}` : ""}` : undefined,
            amount: paymentDelta,
          }],
          totalAmount: updated.ticketPrice,
          amountPaid: updated.amountPaid,
          balance: updated.ticketPrice - updated.amountPaid,
          paymentAmount: paymentDelta,
          paymentMethod: updated.paymentMethod,
          paymentReference: updated.paymentReference,
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken };
        if (updated.guestPhone) {
          const balance = updated.ticketPrice - updated.amountPaid;
          const paymentDetailLine = (updated.paymentMethod || updated.paymentReference)
            ? ` Payment: ${[updated.paymentMethod, updated.paymentReference].filter(Boolean).join(" / ")}.`
            : "";
          const message = `Hi ${updated.guestName}, payment received for your Movie Room booking at The Chekata: ${show?.name ?? "Movie Room"} \u2014 Seat ${updated.seatRow}${updated.seatNumber}. Paid KES ${paymentDelta.toLocaleString()}${balance > 0 ? `, balance KES ${balance.toLocaleString()}` : ""}.${paymentDetailLine} Enjoy the show!`;
          await sendSms({ settings: await storage.getSettings(), to: updated.guestPhone, message });
        }
      }
      res.json({ ...updated, _document: docResult });
    } catch (err) { handleZodError(res, err); }
  });

  app.delete("/api/movie-seat-bookings/:id", requireModule("movie-room"), requireCanEditMovieBookings, async (req, res) => {
    await storage.deleteMovieSeatBooking(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Menu Items (managed from the Lists module; read from Bar & Restaurant too) ----------
  app.get("/api/menu-items", requireAnyModule(["bar-restaurant", "lists"]), async (_req, res) => {
    res.json(await storage.listMenuItems());
  });
  app.post("/api/menu-items", requireModule("lists"), requireCanManageMenuItemsList, async (req, res) => {
    try {
      const data = insertMenuItemSchema.parse(req.body);
      res.status(201).json(await storage.createMenuItem(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/menu-items/:id", requireModule("lists"), requireCanManageMenuItemsList, async (req, res) => {
    try {
      const data = insertMenuItemSchema.partial().parse(req.body);
      const updated = await storage.updateMenuItem(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Menu item not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/menu-items/:id", requireModule("lists"), requireCanManageMenuItemsList, async (req, res) => {
    await storage.deleteMenuItem(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Tables (Lists module; read from Bar & Restaurant too) ----------
  app.get("/api/tables", requireAnyModule(["bar-restaurant", "lists"]), async (_req, res) => {
    res.json(await storage.listTables());
  });
  app.post("/api/tables", requireModule("lists"), requireCanManageTablesList, async (req, res) => {
    try {
      const data = insertTableSchema.parse(req.body);
      res.status(201).json(await storage.createTable(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/tables/:id", requireModule("lists"), requireCanManageTablesList, async (req, res) => {
    try {
      const data = insertTableSchema.partial().parse(req.body);
      const updated = await storage.updateTable(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Table not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/tables/:id", requireModule("lists"), requireCanManageTablesList, async (req, res) => {
    await storage.deleteTable(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Orders ----------
  app.get("/api/orders", requireModule("bar-restaurant"), async (_req, res) => {
    res.json(await storage.listOrders());
  });
  app.post("/api/orders", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const data = insertOrderSchema.parse(req.body);
      res.status(201).json(await storage.createOrder(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/orders/:id", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const before = await storage.getOrder(id);
      if (!before) return res.status(404).json({ error: "Order not found" });
      const data = insertOrderSchema.partial().parse(req.body);
      const updated = await storage.updateOrder(id, data);
      if (!updated) return res.status(404).json({ error: "Order not found" });
      let docResult: any = null;
      if (updated.status === "paid" && before.status !== "paid") {
        const items = await storage.listOrderItems(updated.id);
        const doc = await issueDocument(storage, {
          docType: "receipt",
          category: updated.outlet === "bar" ? "bar" : "restaurant",
          sourceId: updated.id,
          recipientName: updated.customerName || "Guest",
          recipientEmail: updated.customerEmail,
          issueDate: formatDate(),
          lineItems: items.map((i) => ({ label: `${i.itemName} x${i.quantity}`, amount: i.subtotal })),
          totalAmount: updated.totalAmount,
          amountPaid: updated.totalAmount,
          balance: 0,
          paymentAmount: updated.totalAmount,
          paymentMethod: updated.paymentMethod,
          paymentReference: updated.paymentReference,
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken };
      }
      res.json({ ...updated, _document: docResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/orders/:id", requireModule("bar-restaurant"), async (req, res) => {
    await storage.deleteOrder(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Order Items ----------
  // Items may only be added/removed while the order is still "open" — once an
  // order is closed (status becomes "paid") or cancelled its receipt has
  // already been generated from a fixed snapshot, so the line items are locked.
  app.get("/api/orders/:orderId/items", requireModule("bar-restaurant"), async (req, res) => {
    res.json(await storage.listOrderItems(Number(req.params.orderId)));
  });
  app.post("/api/order-items", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const data = insertOrderItemSchema.parse(req.body);
      const order = await storage.getOrder(data.orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.status !== "open") return res.status(400).json({ error: "This order is closed — items can no longer be added." });
      res.status(201).json(await storage.createOrderItem(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/order-items/:id", requireModule("bar-restaurant"), async (req, res) => {
    const item = await storage.getOrderItem(Number(req.params.id));
    if (item) {
      const order = await storage.getOrder(item.orderId);
      if (order && order.status !== "open") return res.status(400).json({ error: "This order is closed — items can no longer be removed." });
    }
    await storage.deleteOrderItem(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Staff ----------
  app.get("/api/staff", requireModule("staff"), async (_req, res) => {
    res.json(await storage.listStaff());
  });
  app.post("/api/staff", requireModule("staff"), async (req, res) => {
    try {
      const data = insertStaffSchema.parse(req.body);
      res.status(201).json(await storage.createStaff(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/staff/:id", requireModule("staff"), async (req, res) => {
    try {
      const data = insertStaffSchema.partial().parse(req.body);
      const updated = await storage.updateStaff(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Staff not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/staff/:id", requireModule("staff"), async (req, res) => {
    await storage.deleteStaff(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Expenses ----------
  app.get("/api/expenses", requireModule("expenses"), async (_req, res) => {
    res.json(await storage.listExpenses());
  });
  app.post("/api/expenses", requireModule("expenses"), async (req, res) => {
    try {
      const data = insertExpenseSchema.parse(req.body);
      res.status(201).json(await storage.createExpense(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/expenses/:id", requireModule("expenses"), async (req, res) => {
    try {
      const data = insertExpenseSchema.partial().parse(req.body);
      const updated = await storage.updateExpense(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Expense not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/expenses/:id", requireModule("expenses"), async (req, res) => {
    await storage.deleteExpense(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Maintenance (issue register — tracked separately from Expenses) ----------
  app.get("/api/maintenance-issues", requireModule("maintenance"), async (_req, res) => {
    res.json(await storage.listMaintenanceIssues());
  });
  app.post("/api/maintenance-issues", requireModule("maintenance"), async (req, res) => {
    try {
      const data = insertMaintenanceIssueSchema.parse({
        ...req.body,
        status: "open",
        createdAt: Date.now(),
        resolvedAt: null,
        closedAt: null,
        closedBy: null,
        // Generated inline for immediate availability (the startup backfill would otherwise leave
        // a brief null-token window for issues created between deploys).
        publicToken: randomBytes(16).toString("hex"),
      });
      if (!(MAINTENANCE_CATEGORIES as readonly string[]).includes(data.category)) {
        return res.status(400).json({ error: "Invalid maintenance category." });
      }
      const created = await storage.createMaintenanceIssue(data);
      let smsResult: { status: "sent" | "skipped"; errorMessage?: string } | null = null;
      if (created.reportedPhone) {
        const message = `The Chekata Maintenance: your report "${created.title}" has been logged (ref #${created.id}). We'll notify you once it's resolved.`;
        const sms = await sendSms({ settings: await storage.getSettings(), to: created.reportedPhone, message });
        smsResult = sms.ok ? { status: "sent" } : { status: "skipped", errorMessage: sms.error };
      }
      res.status(201).json({ ...created, _sms: smsResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/maintenance-issues/:id", requireModule("maintenance"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const before = await storage.getMaintenanceIssue(id);
      if (!before) return res.status(404).json({ error: "Maintenance issue not found" });
      const data = insertMaintenanceIssueSchema.partial().parse(req.body);
      if (data.category && !(MAINTENANCE_CATEGORIES as readonly string[]).includes(data.category)) {
        return res.status(400).json({ error: "Invalid maintenance category." });
      }
      const currentUser = (req as any).user;
      const closingNow = data.status === "closed" && before.status !== "closed";
      if (closingNow && !(currentUser.isAdmin || currentUser.canCloseMaintenanceIssues)) {
        return res.status(403).json({ error: "You don't have rights to close maintenance issues" });
      }
      const patch: Partial<typeof data> & Record<string, any> = { ...data };
      if (data.status === "resolved" && before.status !== "resolved") patch.resolvedAt = Date.now();
      if (closingNow) { patch.closedAt = Date.now(); patch.closedBy = currentUser.fullName; }
      const updated = await storage.updateMaintenanceIssue(id, patch);
      if (!updated) return res.status(404).json({ error: "Maintenance issue not found" });
      let smsResult: { status: "sent" | "skipped"; errorMessage?: string } | null = null;
      if (closingNow && updated.reportedPhone) {
        const message = `The Chekata Maintenance: your report "${updated.title}" (ref #${updated.id}) has been resolved and closed. Thank you for reporting it.`;
        const sms = await sendSms({ settings: await storage.getSettings(), to: updated.reportedPhone, message });
        smsResult = sms.ok ? { status: "sent" } : { status: "skipped", errorMessage: sms.error };
      }
      res.json({ ...updated, _sms: smsResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/maintenance-issues/:id", requireAdmin, async (req, res) => {
    await storage.deleteMaintenanceIssue(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Settings ----------
  app.get("/api/settings", requireModule("settings"), requireAdminUsername, async (_req, res) => {
    res.json(await storage.getSettings());
  });
  app.put("/api/settings", requireModule("settings"), requireAdminUsername, async (req, res) => {
    try {
      const data = insertSettingsSchema.partial().parse(req.body);
      res.json(await storage.updateSettings(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.post("/api/settings/test-email", requireModule("settings"), requireAdminUsername, async (req, res) => {
    try {
      const { email } = req.body as { email?: string };
      if (!email) return res.status(400).json({ error: "Provide an email address to test." });
      const settings = await storage.getSettings();
      const result = await sendTransactionalEmail({
        settings,
        to: email,
        subject: `Test email from ${settings.hotelName || "The Chekata"}`,
        html: `<p>This is a test email from your ${settings.hotelName || "The Chekata"} management system. If you received this, your email settings are working.</p>`,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to send test email" }); }
  });
  app.post("/api/settings/test-sms", requireModule("settings"), requireAdminUsername, async (req, res) => {
    try {
      const { phone } = req.body as { phone?: string };
      if (!phone) return res.status(400).json({ error: "Provide a phone number to test." });
      const settings = await storage.getSettings();
      const result = await sendSms({
        settings,
        to: phone,
        message: `This is a test SMS from your ${settings.hotelName || "The Chekata"} management system. If you received this, your SMS settings are working.`,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to send test SMS" }); }
  });

  // ---------- Documents (Invoices & Receipts) ----------
  app.get("/api/documents", requireModule("documents"), async (_req, res) => {
    const docs = await storage.listDocuments();
    res.json(docs.slice().sort((a, b) => b.createdAt - a.createdAt));
  });
  app.get("/api/documents/:id/pdf", requireModule("documents"), async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const settings = await storage.getSettings();
      const payload = JSON.parse(doc.payloadJson);
      const pdf = await buildDocumentPdf(settings, { docNumber: doc.sourceId, ...payload });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${doc.docType}-${doc.sourceId}.pdf"`);
      res.send(pdf);
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to generate PDF" }); }
  });
  app.post("/api/documents/:id/resend", requireModule("documents"), async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const payload = JSON.parse(doc.payloadJson);
      const overrideEmail = (req.body as { email?: string })?.email;
      const newDoc = await issueDocument(storage, {
        ...payload,
        recipientEmail: overrideEmail || payload.recipientEmail || doc.recipientEmail,
      });
      res.status(201).json(newDoc);
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to resend document" }); }
  });

  app.get("/api/reports/export", requireModule("reports"), async (req, res) => {
    try {
      const from = typeof req.query.from === "string" && req.query.from ? req.query.from : undefined;
      const to = typeof req.query.to === "string" && req.query.to ? req.query.to : undefined;
      const sheetParam = typeof req.query.sheet === "string" ? req.query.sheet : "all";
      const validSheets: (ReportSheetKey | "all")[] = ["all", "overview", "accommodation", "facilities", "bar-restaurant", "staff", "expenses", "maintenance", "taxes"];
      const sheet = (validSheets as string[]).includes(sheetParam) ? (sheetParam as ReportSheetKey | "all") : "all";

      const workbook = await buildReportsWorkbook(storage, { from, to, sheet });
      const label = sheet === "all" ? "Full-Report" : REPORT_SHEET_LABELS[sheet].replace(/[^a-zA-Z0-9]+/g, "-");
      const rangeLabel = from || to ? `_${from ?? "start"}_to_${to ?? "today"}` : "";
      const filename = `Chekata-${label}${rangeLabel}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to generate report export" });
    }
  });

  // ================= Finance =================
  // ---------- Chart of Accounts ----------
  app.get("/api/finance/accounts", requireModule("finance"), async (_req, res) => {
    res.json(await storage.listChartOfAccounts());
  });
  app.post("/api/finance/accounts", requireModule("finance"), requireTablePermission("finance.chart_of_accounts"), async (req, res) => {
    try {
      const data = insertChartOfAccountSchema.parse({ ...req.body, createdAt: Date.now() });
      res.status(201).json(await storage.createChartOfAccount(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/finance/accounts/:id", requireModule("finance"), requireTablePermission("finance.chart_of_accounts"), async (req, res) => {
    try {
      const data = insertChartOfAccountSchema.partial().parse(req.body);
      const updated = await storage.updateChartOfAccount(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Account not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/finance/accounts/:id", requireModule("finance"), requireTablePermission("finance.chart_of_accounts"), async (req, res) => {
    try {
      await storage.deleteChartOfAccount(Number(req.params.id));
      res.status(204).end();
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to delete account" }); }
  });

  // ---------- Accounting Periods ----------
  app.get("/api/finance/periods", requireModule("finance"), async (_req, res) => {
    res.json(await storage.listAccountingPeriods());
  });
  app.post("/api/finance/periods", requireModule("finance"), requireTablePermission("finance.accounting_periods"), async (req, res) => {
    try {
      const data = insertAccountingPeriodSchema.parse({ ...req.body, createdAt: Date.now() });
      res.status(201).json(await storage.createAccountingPeriod(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/finance/periods/:id", requireModule("finance"), requireTablePermission("finance.accounting_periods"), async (req, res) => {
    try {
      const data = insertAccountingPeriodSchema.partial().parse(req.body);
      const user = (req as any).user;
      if (data.status === "closed") { (data as any).closedAt = Date.now(); (data as any).closedBy = user?.username; }
      const updated = await storage.updateAccountingPeriod(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Period not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/finance/periods/:id", requireModule("finance"), requireTablePermission("finance.accounting_periods"), async (req, res) => {
    await storage.deleteAccountingPeriod(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Journal Entries (General Ledger) ----------
  app.get("/api/finance/journal-entries", requireModule("finance"), async (_req, res) => {
    const entries = await storage.listJournalEntries();
    res.json(entries.slice().sort((a, b) => b.id - a.id));
  });
  app.get("/api/finance/journal-entries/:id/lines", requireModule("finance"), async (req, res) => {
    res.json(await storage.listJournalEntryLines(Number(req.params.id)));
  });
  app.post("/api/finance/journal-entries", requireModule("finance"), requireTablePermission("finance.journal_entries"), async (req, res) => {
    try {
      const user = (req as any).user;
      const body = req.body as { entryDate: string; description: string; sourceModule?: string; sourceId?: number; lines: { accountId: number; debit?: number; credit?: number; description?: string }[] };
      const entry = insertJournalEntrySchema.omit({ entryNumber: true, status: true, createdBy: true, createdAt: true }).parse({
        entryDate: body.entryDate,
        description: body.description,
        sourceModule: body.sourceModule ?? "finance",
        sourceId: body.sourceId,
      });
      const lines = (body.lines || []).map((l) => insertJournalEntryLineSchema.omit({ journalEntryId: true }).parse({
        accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, description: l.description,
      }));
      const created = await storage.postJournalEntry(
        { ...entry, createdBy: user.username, createdAt: Date.now() } as any,
        lines as any,
      );
      res.status(201).json(created);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to post journal entry" }); }
  });
  app.post("/api/finance/journal-entries/:id/cancel", requireModule("finance"), requireTablePermission("finance.journal_entries"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required" });
      const updated = await storage.cancelJournalEntry(Number(req.params.id), user.username, reason);
      if (!updated) return res.status(404).json({ error: "Journal entry not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel journal entry" }); }
  });

  // ---------- Bank Accounts ----------
  app.get("/api/finance/bank-accounts", requireModule("finance"), async (_req, res) => {
    res.json(await storage.listBankAccounts());
  });
  app.post("/api/finance/bank-accounts", requireModule("finance"), requireTablePermission("finance.bank_accounts"), async (req, res) => {
    try {
      const data = insertBankAccountSchema.parse(req.body);
      res.status(201).json(await storage.createBankAccount(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/finance/bank-accounts/:id", requireModule("finance"), requireTablePermission("finance.bank_accounts"), async (req, res) => {
    try {
      const data = insertBankAccountSchema.partial().parse(req.body);
      const updated = await storage.updateBankAccount(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Bank account not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/finance/bank-accounts/:id", requireModule("finance"), requireTablePermission("finance.bank_accounts"), async (req, res) => {
    await storage.deleteBankAccount(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Bank / Cash Reconciliations ----------
  app.get("/api/finance/bank-reconciliations", requireModule("finance"), async (_req, res) => {
    res.json(await storage.listBankReconciliations());
  });
  app.post("/api/finance/bank-reconciliations", requireModule("finance"), requireTablePermission("finance.bank_accounts"), async (req, res) => {
    try {
      const data = insertBankReconciliationSchema.parse({ ...req.body, createdAt: Date.now() });
      res.status(201).json(await storage.createBankReconciliation(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/finance/bank-reconciliations/:id", requireModule("finance"), requireTablePermission("finance.bank_accounts"), async (req, res) => {
    try {
      const data = insertBankReconciliationSchema.partial().parse(req.body);
      const user = (req as any).user;
      if (data.status === "completed") { (data as any).completedAt = Date.now(); (data as any).completedBy = user?.username; }
      const updated = await storage.updateBankReconciliation(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Reconciliation not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });

  // ---------- Payment Vouchers ----------
  app.get("/api/finance/payment-vouchers", requireModule("finance"), async (_req, res) => {
    const vouchers = await storage.listPaymentVouchers();
    res.json(vouchers.slice().sort((a, b) => b.id - a.id));
  });
  app.post("/api/finance/payment-vouchers", requireModule("finance"), requireTablePermission("finance.payment_vouchers"), async (req, res) => {
    try {
      const user = (req as any).user;
      const data = insertPaymentVoucherSchema.omit({ voucherNumber: true, requestedBy: true, createdAt: true, status: true }).parse(req.body);
      const created = await storage.createPaymentVoucher({
        ...data, requestedBy: user.username, createdAt: Date.now(), status: "draft",
      } as any);
      res.status(201).json(created);
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/finance/payment-vouchers/:id", requireModule("finance"), requireTablePermission("finance.payment_vouchers"), async (req, res) => {
    try {
      const data = insertPaymentVoucherSchema.partial().parse(req.body);
      const updated = await storage.updatePaymentVoucher(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Payment voucher not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to update payment voucher" }); }
  });
  app.post("/api/finance/payment-vouchers/:id/post", requireModule("finance"), requireTablePermission("finance.payment_vouchers"), async (req, res) => {
    try {
      const user = (req as any).user;
      const updated = await storage.postPaymentVoucher(Number(req.params.id), user.username);
      if (!updated) return res.status(404).json({ error: "Payment voucher not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to post payment voucher" }); }
  });
  app.post("/api/finance/payment-vouchers/:id/cancel", requireModule("finance"), requireTablePermission("finance.payment_vouchers"), async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required" });
      const updated = await storage.cancelPaymentVoucher(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Payment voucher not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel payment voucher" }); }
  });

  // ---------- Reports ----------
  app.get("/api/finance/reports/trial-balance", requireModule("finance"), async (req, res) => {
    const asOf = typeof req.query.asOf === "string" && req.query.asOf ? req.query.asOf : undefined;
    res.json(await storage.getTrialBalance(asOf));
  });
  app.get("/api/finance/reports/profit-loss", requireModule("finance"), async (req, res) => {
    const from = typeof req.query.from === "string" && req.query.from ? req.query.from : undefined;
    const to = typeof req.query.to === "string" && req.query.to ? req.query.to : undefined;
    res.json(await storage.getProfitAndLoss(from, to));
  });
  app.get("/api/finance/reports/balance-sheet", requireModule("finance"), async (req, res) => {
    const asOf = typeof req.query.asOf === "string" && req.query.asOf ? req.query.asOf : undefined;
    res.json(await storage.getBalanceSheet(asOf));
  });

  // ================= System Administration =================
  // ---------- Approval Matrix ----------
  app.get("/api/admin/approval-matrix", requireModule("system-admin"), async (_req, res) => {
    res.json(await storage.listApprovalMatrixRules());
  });
  app.post("/api/admin/approval-matrix", requireModule("system-admin"), async (req, res) => {
    try {
      const data = insertApprovalMatrixRuleSchema.parse(req.body);
      res.status(201).json(await storage.createApprovalMatrixRule(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/admin/approval-matrix/:id", requireModule("system-admin"), async (req, res) => {
    try {
      const data = insertApprovalMatrixRuleSchema.partial().parse(req.body);
      const updated = await storage.updateApprovalMatrixRule(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Approval rule not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/admin/approval-matrix/:id", requireModule("system-admin"), async (req, res) => {
    await storage.deleteApprovalMatrixRule(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Table-level permissions ----------
  app.get("/api/admin/table-permissions", requireModule("system-admin"), async (_req, res) => {
    res.json({ tableKeys: PERMISSION_TABLE_KEYS, rules: await storage.listPermissionTableRules() });
  });
  app.put("/api/admin/table-permissions", requireModule("system-admin"), async (req, res) => {
    try {
      const { userId, tableKey, canWrite } = req.body as { userId: number; tableKey: PermissionTableKey; canWrite: boolean };
      if (!userId || !tableKey) return res.status(400).json({ error: "userId and tableKey are required" });
      if (!(PERMISSION_TABLE_KEYS as readonly string[]).includes(tableKey)) return res.status(400).json({ error: "Unknown table key" });
      const rule = await storage.setPermissionTableRule(userId, tableKey, !!canWrite);
      res.json(rule);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to save table permission" }); }
  });

  // ---------- Definitions (admin-editable dropdown option lists) ----------
  app.get("/api/admin/definitions", requireModule("system-admin"), async (_req, res) => {
    res.json(await storage.listDefinitionLists());
  });
  app.post("/api/admin/definitions", requireModule("system-admin"), async (req, res) => {
    try {
      const data = insertDefinitionListSchema.parse(req.body);
      res.status(201).json(await storage.createDefinitionList(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.get("/api/admin/definitions/:listKey/items", requireModule("system-admin"), async (req, res) => {
    const list = await storage.getDefinitionListByKey(String(req.params.listKey));
    if (!list) return res.status(404).json({ error: "Definition list not found" });
    res.json(await storage.listDefinitionListItems(list.id));
  });
  app.post("/api/admin/definitions/:listKey/items", requireModule("system-admin"), async (req, res) => {
    try {
      const list = await storage.getDefinitionListByKey(String(req.params.listKey));
      if (!list) return res.status(404).json({ error: "Definition list not found" });
      const data = insertDefinitionListItemSchema.omit({ listId: true }).parse(req.body);
      res.status(201).json(await storage.createDefinitionListItem({ ...data, listId: list.id }));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/admin/definitions/items/:id", requireModule("system-admin"), async (req, res) => {
    try {
      const data = insertDefinitionListItemSchema.partial().parse(req.body);
      const updated = await storage.updateDefinitionListItem(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Definition item not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/admin/definitions/items/:id", requireModule("system-admin"), async (req, res) => {
    await storage.deleteDefinitionListItem(Number(req.params.id));
    res.status(204).end();
  });

  return httpServer;
}
