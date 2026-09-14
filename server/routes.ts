import type { Express } from "express";
import { z } from "zod";
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
  insertStoreSchema, insertInventoryItemSchema, insertSupplierSchema,
  insertPurchaseRequisitionSchema, insertPurchaseRequisitionLineSchema,
  insertPurchaseOrderSchema, insertPurchaseOrderLineSchema,
  insertInternalRequisitionSchema, insertInternalRequisitionLineSchema,
  PR_TYPES, IR_TYPES,
  insertGuestIdentityDocumentSchema, ID_DOCUMENT_TYPES,
  insertShopSchema, insertTenantSchema, insertTenancyLeaseSchema, insertMeterReadingSchema,
  insertRecipeSchema, insertRecipeIngredientSchema,
  insertAttendanceRecordSchema, insertLeaveTypeSchema, insertLeaveRequestSchema, insertLeaveBalanceSchema,
  insertStatutoryRateTableSchema, insertPayeBandSchema,
} from "@shared/schema";
import { issueDocument } from "./documents";
import { buildDocumentPdf, buildMaintenanceReportPdf, buildPayslipPdf } from "./pdf";
import { emailPayslipsForRun } from "./payroll-pdf-email";
import { sendTransactionalEmail } from "./email";
import ExcelJS from "exceljs";
import { sendSms } from "./sms";
import { saveBase64Upload, UploadValidationError, UPLOADS_ROOT } from "./uploads";
import { runTenantBillingCycle } from "./billing";
import express from "express";
import { buildReportsWorkbook, REPORT_SHEET_LABELS, type ReportSheetKey } from "./reports-excel";
import {
  requireAuth, requireModule, requireAdmin, requireCanEditMovieBookings,
  requireAnyModule, requireCanManageTablesList, requireCanManageMenuItemsList, requireCanCloseMaintenanceIssues,
  requireAdminUsername, requireTablePermission, requireCanAdjustInventory,
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
  // Serves uploaded ID-document / lease-document files. Mounted before the SPA
  // catch-all (registered later, in server/static.ts) so it always takes
  // priority. Files themselves are gated only by an unguessable random
  // filename — acceptable for the same class of data (guest ID photos) already
  // shown in Phase 1/2 WhatsApp PDF links; the upload/write endpoints below are
  // still permission-gated.
  app.use("/uploads", express.static(UPLOADS_ROOT));

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

  // ---------- Uploads (ID-document photos, lease documents) ----------
  function handleUpload(category: string) {
    return (req: any, res: any) => {
      try {
        const { filename, dataBase64, mimeType } = req.body as { filename?: string; dataBase64?: string; mimeType?: string };
        if (!dataBase64 || !mimeType) return res.status(400).json({ error: "dataBase64 and mimeType are required." });
        const result = saveBase64Upload({ category, filename, dataBase64, mimeType });
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof UploadValidationError) return res.status(400).json({ error: err.message });
        res.status(500).json({ error: (err as any)?.message ?? "Upload failed" });
      }
    };
  }
  app.post("/api/tenants/uploads", requireModule("tenants"), handleUpload("tenants"));
  app.post("/api/accommodation/uploads", requireModule("accommodation"), handleUpload("accommodation"));
  app.post("/api/staff/uploads", requireModule("staff"), handleUpload("staff"));

  // Lets an admin trigger the tenant billing cycle on demand (QA / "I don't want to wait for
  // the hourly tick") instead of only running automatically at boot + hourly (see server/index.ts).
  app.post("/api/tenants/run-billing-cycle", requireModule("tenants"), async (req, res) => {
    try {
      const result = await runTenantBillingCycle(storage, req.session.userId ? String(req.session.userId) : "system");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Billing cycle failed" });
    }
  });

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
      if ((data.numberOfGuests ?? 1) > 2) {
        return res.status(400).json({ error: "A booking cannot have more than 2 guests. Please create a separate booking for additional guests." });
      }
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
      if (data.numberOfGuests !== undefined && data.numberOfGuests > 2) {
        return res.status(400).json({ error: "A booking cannot have more than 2 guests. Please create a separate booking for additional guests." });
      }
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
      const id = Number(req.params.id);
      const before = await storage.getMovieShow(id);
      if (!before) return res.status(404).json({ error: "Show not found" });
      const currentUser = (req as any).user;
      if (before.status === "completed" && !currentUser.isAdmin) {
        return res.status(403).json({ error: "Only an administrator can edit a completed show." });
      }
      const data = insertMovieShowSchema.partial().parse(req.body);
      const updated = await storage.updateMovieShow(id, data);
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


  // ================= Phase 2: Inventory, Purchasing, Internal Requisitions =================

  // ---------- Shared read-only lookups (needed by more than one Phase 2 module) ----------
  app.get("/api/inventory/stores", requireAnyModule(["inventory", "purchasing", "internal-requisitions"]), async (_req, res) => {
    res.json(await storage.listStores());
  });
  app.get("/api/inventory/items", requireAnyModule(["inventory", "purchasing", "internal-requisitions", "fnb-costing"]), async (_req, res) => {
    res.json(await storage.listInventoryItems());
  });
  app.get("/api/inventory/stock-balances", requireAnyModule(["inventory", "purchasing", "internal-requisitions"]), async (_req, res) => {
    res.json(await storage.getStockBalancesByItem());
  });
  app.get("/api/purchasing/gl-accounts", requireAnyModule(["purchasing", "internal-requisitions"]), async (_req, res) => {
    res.json(await storage.listChartOfAccounts());
  });
  // Read-only GL account / bank account lookups for the Tenants module (lease setup, rent
  // payment recording) — kept separate from /api/finance/* so Tenants access never implies
  // Finance module access, mirroring the purchasing/internal-requisitions pattern above.
  app.get("/api/tenants/gl-accounts", requireModule("tenants"), async (_req, res) => {
    res.json(await storage.listChartOfAccounts());
  });
  app.get("/api/tenants/bank-accounts", requireModule("tenants"), async (_req, res) => {
    res.json(await storage.listBankAccounts());
  });
  app.get("/api/definitions/:listKey/items", requireAuth, async (req, res) => {
    const list = await storage.getDefinitionListByKey(String(req.params.listKey));
    if (!list) return res.json([]);
    res.json(await storage.listDefinitionListItems(list.id));
  });

  // ---------- Inventory: Stores (master data) ----------
  app.post("/api/inventory/stores", requireModule("inventory"), async (req, res) => {
    try {
      const data = insertStoreSchema.parse(req.body);
      res.status(201).json(await storage.createStore(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/inventory/stores/:id", requireModule("inventory"), async (req, res) => {
    try {
      const data = insertStoreSchema.partial().parse(req.body);
      const updated = await storage.updateStore(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Store not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/inventory/stores/:id", requireModule("inventory"), requireCanAdjustInventory, async (req, res) => {
    await storage.deleteStore(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Inventory: Items (master data) ----------
  app.post("/api/inventory/items", requireModule("inventory"), async (req, res) => {
    try {
      const data = insertInventoryItemSchema.parse({ ...req.body, createdAt: Date.now() });
      res.status(201).json(await storage.createInventoryItem(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/inventory/items/:id", requireModule("inventory"), async (req, res) => {
    try {
      const data = insertInventoryItemSchema.partial().parse(req.body);
      const updated = await storage.updateInventoryItem(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Inventory item not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/inventory/items/:id", requireModule("inventory"), requireCanAdjustInventory, async (req, res) => {
    await storage.deleteInventoryItem(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Inventory: Stock Ledger & Adjustments ----------
  app.get("/api/inventory/stock-ledger", requireModule("inventory"), async (req, res) => {
    const itemId = req.query.itemId ? Number(req.query.itemId) : undefined;
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    res.json(await storage.listStockLedger({ itemId, storeId }));
  });
  app.post("/api/inventory/stock-adjustments", requireModule("inventory"), requireCanAdjustInventory, async (req, res) => {
    try {
      const user = (req as any).user;
      const { itemId, storeId, direction, quantity, notes } = req.body as {
        itemId: number; storeId: number; direction: "in" | "out"; quantity: number; notes?: string;
      };
      if (!itemId || !storeId || (direction !== "in" && direction !== "out") || !quantity || quantity <= 0) {
        return res.status(400).json({ error: "itemId, storeId, direction (in/out), and a positive quantity are required" });
      }
      const entry = await storage.createStockAdjustment({ itemId, storeId, direction, quantity, notes, createdBy: user.fullName ?? user.username });
      res.status(201).json(entry);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to record stock adjustment" }); }
  });

  // ---------- Purchasing: Suppliers (master data) ----------
  app.get("/api/purchasing/suppliers", requireModule("purchasing"), async (_req, res) => {
    res.json(await storage.listSuppliers());
  });
  app.post("/api/purchasing/suppliers", requireModule("purchasing"), async (req, res) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      res.status(201).json(await storage.createSupplier(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/purchasing/suppliers/:id", requireModule("purchasing"), async (req, res) => {
    try {
      const data = insertSupplierSchema.partial().parse(req.body);
      const updated = await storage.updateSupplier(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Supplier not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/purchasing/suppliers/:id", requireModule("purchasing"), requireCanAdjustInventory, async (req, res) => {
    await storage.deleteSupplier(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Purchasing: Purchase Requisitions ----------
  app.get("/api/purchasing/requisitions", requireModule("purchasing"), async (_req, res) => {
    res.json(await storage.listPurchaseRequisitions());
  });
  app.get("/api/purchasing/requisitions/:id/lines", requireModule("purchasing"), async (req, res) => {
    res.json(await storage.getPurchaseRequisitionLines(Number(req.params.id)));
  });
  app.post("/api/purchasing/requisitions", requireModule("purchasing"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { lines, ...body } = req.body as { lines: any[] } & Record<string, any>;
      if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "At least one requisition line is required" });
      if (body.type && !(PR_TYPES as readonly string[]).includes(body.type)) return res.status(400).json({ error: "Invalid requisition type" });
      const data = insertPurchaseRequisitionSchema.omit({ prNumber: true, requestedBy: true, createdAt: true, status: true, approvedBy: true, approvedAt: true, rejectedReason: true, cancelReason: true }).parse(body);
      const parsedLines = lines.map((l) => insertPurchaseRequisitionLineSchema.omit({ requisitionId: true }).parse(l));
      const created = await storage.createPurchaseRequisition(
        { ...data, requestedBy: user.fullName ?? user.username, createdAt: Date.now(), status: "draft" } as any,
        parsedLines as any,
      );
      res.status(201).json(created);
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/purchasing/requisitions/:id", requireModule("purchasing"), async (req, res) => {
    try {
      const { lines, ...body } = req.body as { lines?: any[] } & Record<string, any>;
      const data = insertPurchaseRequisitionSchema.partial().parse(body);
      const parsedLines = Array.isArray(lines) ? lines.map((l) => insertPurchaseRequisitionLineSchema.omit({ requisitionId: true }).parse(l)) : undefined;
      const updated = await storage.updatePurchaseRequisition(Number(req.params.id), data, parsedLines as any);
      if (!updated) return res.status(404).json({ error: "Purchase requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to update purchase requisition" }); }
  });
  app.post("/api/purchasing/requisitions/:id/submit", requireModule("purchasing"), async (req, res) => {
    try {
      const updated = await storage.submitPurchaseRequisition(Number(req.params.id));
      if (!updated) return res.status(404).json({ error: "Purchase requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to submit purchase requisition" }); }
  });
  app.post("/api/purchasing/requisitions/:id/approve", requireModule("purchasing"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { supplierId, payableAccountId, expenseAccountId } = req.body as { supplierId: number; payableAccountId: number; expenseAccountId?: number };
      if (!supplierId || !payableAccountId) return res.status(400).json({ error: "supplierId and payableAccountId are required" });
      const result = await storage.approvePurchaseRequisition(Number(req.params.id), user.fullName ?? user.username, { supplierId, payableAccountId, expenseAccountId: expenseAccountId ?? null });
      res.json(result);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to approve purchase requisition" }); }
  });
  app.post("/api/purchasing/requisitions/:id/reject", requireModule("purchasing"), async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A rejection reason is required" });
      const updated = await storage.rejectPurchaseRequisition(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Purchase requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to reject purchase requisition" }); }
  });
  app.post("/api/purchasing/requisitions/:id/cancel", requireModule("purchasing"), requireCanAdjustInventory, async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required" });
      const updated = await storage.cancelPurchaseRequisition(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Purchase requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel purchase requisition" }); }
  });

  // ---------- Purchasing: Purchase Orders ----------
  app.get("/api/purchasing/orders", requireModule("purchasing"), async (_req, res) => {
    res.json(await storage.listPurchaseOrders());
  });
  app.get("/api/purchasing/orders/:id/lines", requireModule("purchasing"), async (req, res) => {
    res.json(await storage.getPurchaseOrderLines(Number(req.params.id)));
  });
  app.post("/api/purchasing/orders", requireModule("purchasing"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { lines, ...body } = req.body as { lines: any[] } & Record<string, any>;
      if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "At least one order line is required" });
      const data = insertPurchaseOrderSchema.omit({ poNumber: true, createdBy: true, createdAt: true, status: true, approvedBy: true, approvedAt: true, cancelReason: true, totalAmount: true }).parse(body);
      if (data.type === "direct" && !data.expenseAccountId) return res.status(400).json({ error: "expenseAccountId is required for a direct-type purchase order" });
      const parsedLines = lines.map((l) => insertPurchaseOrderLineSchema.omit({ poId: true, quantityReceived: true }).parse(l));
      const totalAmount = parsedLines.reduce((sum, l: any) => sum + (l.lineTotal ?? l.quantity * l.unitCost), 0);
      const created = await storage.createPurchaseOrder(
        { ...data, createdBy: user.fullName ?? user.username, createdAt: Date.now(), status: "draft", totalAmount } as any,
        parsedLines as any,
      );
      res.status(201).json(created);
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/purchasing/orders/:id", requireModule("purchasing"), async (req, res) => {
    try {
      const { lines, ...body } = req.body as { lines?: any[] } & Record<string, any>;
      const data = insertPurchaseOrderSchema.partial().parse(body);
      const parsedLines = Array.isArray(lines) ? lines.map((l) => insertPurchaseOrderLineSchema.omit({ poId: true, quantityReceived: true }).parse(l)) : undefined;
      const updated = await storage.updatePurchaseOrder(Number(req.params.id), data, parsedLines as any);
      if (!updated) return res.status(404).json({ error: "Purchase order not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to update purchase order" }); }
  });
  app.post("/api/purchasing/orders/:id/approve", requireModule("purchasing"), async (req, res) => {
    try {
      const user = (req as any).user;
      const updated = await storage.approvePurchaseOrder(Number(req.params.id), user.fullName ?? user.username);
      if (!updated) return res.status(404).json({ error: "Purchase order not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to approve purchase order" }); }
  });
  app.post("/api/purchasing/orders/:id/receive", requireModule("purchasing"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { storeId, lines, notes } = req.body as { storeId: number; lines: { poLineId: number; quantityReceived: number; unitCost: number }[]; notes?: string };
      if (!storeId || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "storeId and at least one received line are required" });
      const grn = await storage.receiveGoods(Number(req.params.id), { storeId, receivedBy: user.fullName ?? user.username, lines, notes });
      res.status(201).json(grn);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to receive goods" }); }
  });
  app.post("/api/purchasing/orders/:id/receive-direct", requireModule("purchasing"), async (req, res) => {
    try {
      const user = (req as any).user;
      const updated = await storage.receivePurchaseOrderDirect(Number(req.params.id), user.fullName ?? user.username);
      if (!updated) return res.status(404).json({ error: "Purchase order not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to receive purchase order" }); }
  });
  app.post("/api/purchasing/orders/:id/cancel", requireModule("purchasing"), requireCanAdjustInventory, async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required" });
      const updated = await storage.cancelPurchaseOrder(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Purchase order not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel purchase order" }); }
  });

  // ---------- Purchasing: Goods Receipts (read-only trail) ----------
  app.get("/api/purchasing/goods-receipts", requireModule("purchasing"), async (_req, res) => {
    res.json(await storage.listGoodsReceipts());
  });
  app.get("/api/purchasing/goods-receipts/:id/lines", requireModule("purchasing"), async (req, res) => {
    res.json(await storage.getGoodsReceiptLines(Number(req.params.id)));
  });

  // ---------- Internal Requisitions ----------
  app.get("/api/internal-requisitions", requireModule("internal-requisitions"), async (_req, res) => {
    res.json(await storage.listInternalRequisitions());
  });
  app.get("/api/internal-requisitions/:id/lines", requireModule("internal-requisitions"), async (req, res) => {
    res.json(await storage.getInternalRequisitionLines(Number(req.params.id)));
  });
  app.post("/api/internal-requisitions", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { lines, ...body } = req.body as { lines: any[] } & Record<string, any>;
      if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: "At least one requisition line is required" });
      if (body.type && !(IR_TYPES as readonly string[]).includes(body.type)) return res.status(400).json({ error: "Invalid requisition type" });
      const data = insertInternalRequisitionSchema.omit({ irNumber: true, requestedBy: true, createdAt: true, status: true, approvedBy: true, approvedAt: true, rejectedReason: true, cancelReason: true }).parse(body);
      if (data.type === "permanent" && !data.expenseAccountId) return res.status(400).json({ error: "expenseAccountId is required for a permanent internal requisition" });
      const parsedLines = lines.map((l) => insertInternalRequisitionLineSchema.omit({ requisitionId: true, quantityIssued: true, quantityReturned: true }).parse(l));
      const created = await storage.createInternalRequisition(
        { ...data, requestedBy: user.fullName ?? user.username, createdAt: Date.now(), status: "draft" } as any,
        parsedLines as any,
      );
      res.status(201).json(created);
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/internal-requisitions/:id", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const { lines, ...body } = req.body as { lines?: any[] } & Record<string, any>;
      const data = insertInternalRequisitionSchema.partial().parse(body);
      const parsedLines = Array.isArray(lines) ? lines.map((l) => insertInternalRequisitionLineSchema.omit({ requisitionId: true, quantityIssued: true, quantityReturned: true }).parse(l)) : undefined;
      const updated = await storage.updateInternalRequisition(Number(req.params.id), data, parsedLines as any);
      if (!updated) return res.status(404).json({ error: "Internal requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to update internal requisition" }); }
  });
  app.post("/api/internal-requisitions/:id/submit", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const updated = await storage.submitInternalRequisition(Number(req.params.id));
      if (!updated) return res.status(404).json({ error: "Internal requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to submit internal requisition" }); }
  });
  app.post("/api/internal-requisitions/:id/approve", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const user = (req as any).user;
      const updated = await storage.approveInternalRequisition(Number(req.params.id), user.fullName ?? user.username);
      if (!updated) return res.status(404).json({ error: "Internal requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to approve internal requisition" }); }
  });
  app.post("/api/internal-requisitions/:id/reject", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A rejection reason is required" });
      const updated = await storage.rejectInternalRequisition(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Internal requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to reject internal requisition" }); }
  });
  app.post("/api/internal-requisitions/:id/issue", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const user = (req as any).user;
      const updated = await storage.issueInternalRequisition(Number(req.params.id), user.fullName ?? user.username);
      if (!updated) return res.status(404).json({ error: "Internal requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to issue internal requisition" }); }
  });
  app.post("/api/internal-requisition-lines/:lineId/return", requireModule("internal-requisitions"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { quantityReturned, condition, notes } = req.body as { quantityReturned: number; condition?: string; notes?: string };
      if (!quantityReturned || quantityReturned <= 0) return res.status(400).json({ error: "A positive quantityReturned is required" });
      const result = await storage.returnLoanItem(Number(req.params.lineId), { quantityReturned, returnedBy: user.fullName ?? user.username, condition, notes });
      res.status(201).json(result);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to record loan return" }); }
  });
  app.post("/api/internal-requisitions/:id/cancel", requireModule("internal-requisitions"), requireCanAdjustInventory, async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required" });
      const updated = await storage.cancelInternalRequisition(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Internal requisition not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel internal requisition" }); }
  });


  // ================= Phase 3: Accommodation guest ID capture =================
  app.get("/api/accommodation-bookings/:bookingId/identity-documents", requireModule("accommodation"), async (req, res) => {
    try {
      const docs = await storage.listGuestIdentityDocuments(Number(req.params.bookingId));
      res.json(docs);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to load identity documents" }); }
  });
  app.post("/api/accommodation-bookings/:bookingId/identity-documents", requireModule("accommodation"), async (req, res) => {
    try {
      const bookingId = Number(req.params.bookingId);
      const data = insertGuestIdentityDocumentSchema.omit({ createdAt: true, bookingId: true }).parse(req.body);
      if (!ID_DOCUMENT_TYPES.includes(data.idType as any)) {
        return res.status(400).json({ error: `idType must be one of: ${ID_DOCUMENT_TYPES.join(", ")}` });
      }
      if (data.idType === "national_id" && !data.backImageUrl) {
        return res.status(400).json({ error: "backImageUrl is required for a national ID document." });
      }
      const doc = await storage.createGuestIdentityDocument({ ...data, bookingId });
      res.status(201).json(doc);
    } catch (err) { handleZodError(res, err); }
  });

  // ================= Phase 3: Tenants — Shops =================
  app.get("/api/shops", requireModule("tenants"), async (_req, res) => {
    res.json(await storage.listShops());
  });
  app.post("/api/shops", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertShopSchema.omit({ createdAt: true }).parse(req.body);
      res.status(201).json(await storage.createShop(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/shops/:id", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertShopSchema.omit({ createdAt: true }).partial().parse(req.body);
      const updated = await storage.updateShop(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Shop not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/shops/:id", requireModule("tenants"), async (req, res) => {
    try {
      await storage.deleteShop(Number(req.params.id));
      res.status(204).end();
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to delete shop" }); }
  });

  // ================= Phase 3: Tenants — Tenants =================
  app.get("/api/tenants-list", requireModule("tenants"), async (_req, res) => {
    res.json(await storage.listTenants());
  });
  app.post("/api/tenants-list", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertTenantSchema.omit({ createdAt: true }).parse(req.body);
      res.status(201).json(await storage.createTenant(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/tenants-list/:id", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertTenantSchema.omit({ createdAt: true }).partial().parse(req.body);
      const updated = await storage.updateTenant(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Tenant not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/tenants-list/:id", requireModule("tenants"), async (req, res) => {
    try {
      await storage.deleteTenant(Number(req.params.id));
      res.status(204).end();
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to delete tenant" }); }
  });

  // ================= Phase 3: Tenants — Leases =================
  app.get("/api/tenancy-leases", requireModule("tenants"), async (_req, res) => {
    res.json(await storage.listTenancyLeases());
  });
  app.post("/api/tenancy-leases", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertTenancyLeaseSchema.omit({ createdAt: true }).parse(req.body);
      res.status(201).json(await storage.createTenancyLease(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/tenancy-leases/:id", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertTenancyLeaseSchema.omit({ createdAt: true }).partial().parse(req.body);
      const updated = await storage.updateTenancyLease(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Lease not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.post("/api/tenancy-leases/:id/end", requireModule("tenants"), async (req, res) => {
    try {
      const updated = await storage.endTenancyLease(Number(req.params.id));
      if (!updated) return res.status(404).json({ error: "Lease not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to end lease" }); }
  });

  // ================= Phase 3: Tenants — Meter Readings =================
  app.get("/api/meter-readings", requireModule("tenants"), async (req, res) => {
    const leaseId = req.query.leaseId ? Number(req.query.leaseId) : undefined;
    res.json(await storage.listMeterReadings(leaseId));
  });
  app.post("/api/meter-readings", requireModule("tenants"), async (req, res) => {
    try {
      const data = insertMeterReadingSchema.omit({ createdAt: true, consumption: true, amount: true }).parse(req.body);
      res.status(201).json(await storage.createMeterReading(data));
    } catch (err) { handleZodError(res, err); }
  });

  // ================= Phase 3: Tenants — Rent Invoices =================
  app.get("/api/rent-invoices", requireModule("tenants"), async (req, res) => {
    const leaseId = req.query.leaseId ? Number(req.query.leaseId) : undefined;
    res.json(await storage.listRentInvoices(leaseId));
  });
  app.get("/api/rent-invoices/:id", requireModule("tenants"), async (req, res) => {
    const invoice = await storage.getRentInvoice(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: "Rent invoice not found" });
    res.json(invoice);
  });
  // Ad-hoc single-lease invoice generation (e.g. staff wants this period's invoice right now,
  // instead of waiting for the hourly billing cycle in server/billing.ts to pick it up).
  app.post("/api/rent-invoices/generate", requireModule("tenants"), async (req, res) => {
    try {
      const { leaseId, periodMonth } = req.body as { leaseId?: number; periodMonth?: string };
      if (!leaseId || !periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) {
        return res.status(400).json({ error: "leaseId and periodMonth (YYYY-MM) are required." });
      }
      const user = (req as any).user;
      const invoice = await storage.createRentInvoiceForPeriod(leaseId, periodMonth, user.fullName ?? user.username);
      const lease = await storage.getTenancyLease(leaseId);
      const tenant = lease ? await storage.getTenant(lease.tenantId) : undefined;
      const shop = lease ? await storage.getShop(lease.shopId) : undefined;
      const lineItems = [
        { label: `Shop ${shop?.shopNumber ?? leaseId} rent — ${periodMonth}`, amount: invoice.rentAmount },
        ...(invoice.electricityAmount > 0 ? [{ label: "Electricity", detail: `${periodMonth} consumption`, amount: invoice.electricityAmount }] : []),
      ];
      const doc = await issueDocument(storage, {
        docType: "invoice",
        category: "tenancy",
        sourceId: invoice.id,
        customDocNumber: invoice.invoiceNumber,
        recipientName: tenant?.name ?? "Tenant",
        recipientEmail: tenant?.email ?? null,
        issueDate: formatDate(),
        lineItems,
        totalAmount: invoice.totalAmount,
        amountPaid: 0,
        balance: invoice.totalAmount,
        notes: `Due ${invoice.dueDate}`,
      });
      res.status(201).json({ ...invoice, _document: { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken } });
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to generate rent invoice" }); }
  });
  app.get("/api/rent-invoices/:id/payments", requireModule("tenants"), async (req, res) => {
    res.json(await storage.listRentInvoicePayments(Number(req.params.id)));
  });
  app.post("/api/rent-invoices/:id/payments", requireModule("tenants"), async (req, res) => {
    try {
      const invoiceId = Number(req.params.id);
      const { amount, bankAccountId, paymentMethod, paymentReference } = req.body as { amount?: number; bankAccountId?: number; paymentMethod?: string; paymentReference?: string };
      if (!amount || amount <= 0) return res.status(400).json({ error: "A positive amount is required." });
      if (!bankAccountId) return res.status(400).json({ error: "bankAccountId is required." });
      const user = (req as any).user;
      const payment = await storage.recordRentInvoicePayment(invoiceId, { amount, bankAccountId, paymentMethod, paymentReference, recordedBy: user.fullName ?? user.username });
      const invoice = await storage.getRentInvoice(invoiceId);
      let docResult: any = null;
      if (invoice) {
        const lease = await storage.getTenancyLease(invoice.leaseId);
        const tenant = lease ? await storage.getTenant(lease.tenantId) : undefined;
        const shop = lease ? await storage.getShop(lease.shopId) : undefined;
        const doc = await issueDocument(storage, {
          docType: "receipt",
          category: "tenancy",
          sourceId: invoice.id,
          customDocNumber: invoice.invoiceNumber,
          recipientName: tenant?.name ?? "Tenant",
          recipientEmail: tenant?.email ?? null,
          issueDate: formatDate(),
          lineItems: [{ label: `Shop ${shop?.shopNumber ?? invoice.leaseId} rent — payment received`, amount }],
          totalAmount: invoice.totalAmount,
          amountPaid: invoice.amountPaid,
          balance: invoice.totalAmount - invoice.amountPaid,
          paymentAmount: amount,
          paymentMethod,
          paymentReference,
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken };
      }
      res.status(201).json({ ...payment, _document: docResult });
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to record payment" }); }
  });
  app.post("/api/rent-invoices/:id/cancel", requireModule("tenants"), async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required." });
      const updated = await storage.cancelRentInvoice(Number(req.params.id), reason);
      if (!updated) return res.status(404).json({ error: "Rent invoice not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel rent invoice" }); }
  });
  // Re-sends the current invoice email/PDF on demand (same document trail as creation —
  // shows up as a fresh row in Invoices & Receipts, and refreshes the WhatsApp PDF link).
  app.post("/api/rent-invoices/:id/resend", requireModule("tenants"), async (req, res) => {
    try {
      const invoice = await storage.getRentInvoice(Number(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Rent invoice not found" });
      const lease = await storage.getTenancyLease(invoice.leaseId);
      const tenant = lease ? await storage.getTenant(lease.tenantId) : undefined;
      const shop = lease ? await storage.getShop(lease.shopId) : undefined;
      const lineItems = [
        { label: `Shop ${shop?.shopNumber ?? invoice.leaseId} rent — ${invoice.periodMonth}`, amount: invoice.rentAmount },
        ...(invoice.electricityAmount > 0 ? [{ label: "Electricity", detail: `${invoice.periodMonth} consumption`, amount: invoice.electricityAmount }] : []),
      ];
      const doc = await issueDocument(storage, {
        docType: "invoice",
        category: "tenancy",
        sourceId: invoice.id,
        customDocNumber: invoice.invoiceNumber,
        recipientName: tenant?.name ?? "Tenant",
        recipientEmail: tenant?.email ?? null,
        issueDate: formatDate(),
        lineItems,
        totalAmount: invoice.totalAmount,
        amountPaid: invoice.amountPaid,
        balance: invoice.totalAmount - invoice.amountPaid,
        notes: `Due ${invoice.dueDate}`,
      });
      res.status(201).json({ status: doc.status, errorMessage: doc.errorMessage, id: doc.id, publicToken: doc.publicToken });
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to resend invoice" }); }
  });

  // ================= Phase 3: F&B Costing — Recipes =================
  async function computeRecipeCost(recipe: { otherCostPerServing: number; targetMarginPercent: number }, ingredients: { quantityPerServing: number; inventoryItemId: number }[]) {
    let ingredientCostPerServing = 0;
    for (const ing of ingredients) {
      const item = await storage.getInventoryItem(ing.inventoryItemId);
      ingredientCostPerServing += ing.quantityPerServing * (item?.lastUnitCost ?? 0);
    }
    const costPerServing = recipe.otherCostPerServing + ingredientCostPerServing;
    const marginFraction = Math.min(0.99, Math.max(0, recipe.targetMarginPercent / 100));
    const suggestedPrice = marginFraction > 0 ? costPerServing / (1 - marginFraction) : costPerServing;
    return { costPerServing, suggestedPrice };
  }
  app.get("/api/recipes", requireModule("fnb-costing"), async (_req, res) => {
    const recipeList = await storage.listRecipes();
    const withCost = await Promise.all(recipeList.map(async (r) => {
      const ingredients = await storage.getRecipeIngredients(r.id);
      const cost = await computeRecipeCost(r, ingredients);
      return { ...r, ingredients, ...cost };
    }));
    res.json(withCost);
  });
  app.get("/api/recipes/:id", requireModule("fnb-costing"), async (req, res) => {
    const recipe = await storage.getRecipe(Number(req.params.id));
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    const ingredients = await storage.getRecipeIngredients(recipe.id);
    const cost = await computeRecipeCost(recipe, ingredients);
    res.json({ ...recipe, ingredients, ...cost });
  });
  app.post("/api/recipes", requireModule("fnb-costing"), async (req, res) => {
    try {
      const { ingredients, ...rest } = req.body as any;
      const data = insertRecipeSchema.omit({ createdAt: true }).parse(rest);
      const parsedIngredients = z.array(insertRecipeIngredientSchema.omit({ recipeId: true })).parse(ingredients ?? []);
      const recipe = await storage.createRecipe(data, parsedIngredients);
      res.status(201).json(recipe);
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/recipes/:id", requireModule("fnb-costing"), async (req, res) => {
    try {
      const { ingredients, ...rest } = req.body as any;
      const data = insertRecipeSchema.omit({ createdAt: true }).partial().parse(rest);
      const parsedIngredients = ingredients !== undefined ? z.array(insertRecipeIngredientSchema.omit({ recipeId: true })).parse(ingredients) : undefined;
      const updated = await storage.updateRecipe(Number(req.params.id), data, parsedIngredients);
      if (!updated) return res.status(404).json({ error: "Recipe not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/recipes/:id", requireModule("fnb-costing"), async (req, res) => {
    await storage.deleteRecipe(Number(req.params.id));
    res.status(204).end();
  });


  // ---------- Attendance (Phase 4) ----------
  app.get("/api/attendance", requireModule("attendance"), async (req, res) => {
    const staffId = req.query.staffId ? Number(req.query.staffId) : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    res.json(await storage.listAttendanceRecords({ staffId, from, to }));
  });
  app.post("/api/attendance", requireModule("attendance"), async (req, res) => {
    try {
      const data = insertAttendanceRecordSchema.parse(req.body);
      res.status(201).json(await storage.upsertAttendanceRecord(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/attendance/:id", requireModule("attendance"), async (req, res) => {
    await storage.deleteAttendanceRecord(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Leave (Phase 4) ----------
  app.get("/api/leave-types", requireModule("leave"), async (_req, res) => {
    res.json(await storage.listLeaveTypes());
  });
  app.post("/api/leave-types", requireModule("leave"), async (req, res) => {
    try {
      const data = insertLeaveTypeSchema.parse(req.body);
      res.status(201).json(await storage.createLeaveType(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/leave-types/:id", requireModule("leave"), async (req, res) => {
    try {
      const data = insertLeaveTypeSchema.partial().parse(req.body);
      const updated = await storage.updateLeaveType(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Leave type not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/leave-types/:id", requireModule("leave"), async (req, res) => {
    await storage.deleteLeaveType(Number(req.params.id));
    res.status(204).end();
  });

  app.get("/api/leave-requests", requireModule("leave"), async (req, res) => {
    const staffId = req.query.staffId ? Number(req.query.staffId) : undefined;
    res.json(await storage.listLeaveRequests(staffId));
  });
  app.post("/api/leave-requests", requireModule("leave"), async (req, res) => {
    try {
      const data = insertLeaveRequestSchema.parse(req.body);
      res.status(201).json(await storage.createLeaveRequest(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.post("/api/leave-requests/:id/approve", requireModule("leave"), async (req, res) => {
    try {
      const decidedBy = req.session.userId ? String(req.session.userId) : "system";
      const updated = await storage.decideLeaveRequest(Number(req.params.id), "approved", decidedBy);
      if (!updated) return res.status(404).json({ error: "Leave request not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to approve leave request" }); }
  });
  app.post("/api/leave-requests/:id/reject", requireModule("leave"), async (req, res) => {
    try {
      const decidedBy = req.session.userId ? String(req.session.userId) : "system";
      const updated = await storage.decideLeaveRequest(Number(req.params.id), "rejected", decidedBy);
      if (!updated) return res.status(404).json({ error: "Leave request not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to reject leave request" }); }
  });
  app.post("/api/leave-requests/:id/cancel", requireModule("leave"), async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      const updated = await storage.cancelLeaveRequest(Number(req.params.id), reason ?? "");
      if (!updated) return res.status(404).json({ error: "Leave request not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel leave request" }); }
  });

  app.get("/api/leave-balances", requireModule("leave"), async (req, res) => {
    const staffId = req.query.staffId ? Number(req.query.staffId) : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(await storage.listLeaveBalances(staffId, year));
  });
  app.post("/api/leave-balances", requireModule("leave"), async (req, res) => {
    try {
      const data = insertLeaveBalanceSchema.parse(req.body);
      res.status(201).json(await storage.upsertLeaveBalance(data));
    } catch (err) { handleZodError(res, err); }
  });

  // ---------- Payroll (Phase 4) ----------
  app.get("/api/payroll/statutory-rates", requireModule("payroll"), async (_req, res) => {
    res.json(await storage.listStatutoryRates());
  });
  app.patch("/api/payroll/statutory-rates/:id", requireModule("payroll"), async (req, res) => {
    try {
      const data = insertStatutoryRateTableSchema.partial().parse(req.body);
      const updated = await storage.updateStatutoryRate(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Statutory rate not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });

  app.get("/api/payroll/paye-bands", requireModule("payroll"), async (_req, res) => {
    res.json(await storage.listPayeBands());
  });
  app.post("/api/payroll/paye-bands", requireModule("payroll"), async (req, res) => {
    try {
      const data = insertPayeBandSchema.parse(req.body);
      res.status(201).json(await storage.createPayeBand(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/payroll/paye-bands/:id", requireModule("payroll"), async (req, res) => {
    try {
      const data = insertPayeBandSchema.partial().parse(req.body);
      const updated = await storage.updatePayeBand(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "PAYE band not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/payroll/paye-bands/:id", requireModule("payroll"), async (req, res) => {
    await storage.deletePayeBand(Number(req.params.id));
    res.status(204).end();
  });

  // Personal relief lives on the settings table but is editable from the
  // Payroll screen too (per Phase 4 decision #8), gated only by the payroll
  // module — no separate settings/admin access required.
  app.get("/api/payroll/personal-relief", requireModule("payroll"), async (_req, res) => {
    const settings = await storage.getSettings();
    res.json({ payePersonalRelief: settings.payePersonalRelief ?? 2400 });
  });
  app.patch("/api/payroll/personal-relief", requireModule("payroll"), async (req, res) => {
    const value = Number(req.body?.payePersonalRelief);
    if (!Number.isFinite(value) || value < 0) {
      res.status(400).json({ error: "payePersonalRelief must be a non-negative number." });
      return;
    }
    const updated = await storage.updateSettings({ payePersonalRelief: value });
    res.json({ payePersonalRelief: updated.payePersonalRelief });
  });

  app.get("/api/payroll/runs", requireModule("payroll"), async (_req, res) => {
    res.json(await storage.listPayrollRuns());
  });
  app.post("/api/payroll/runs", requireModule("payroll"), async (req, res) => {
    try {
      const { periodMonth, periodStart, periodEnd } = req.body as { periodMonth?: string; periodStart?: string; periodEnd?: string };
      if (!periodMonth || !periodStart || !periodEnd) return res.status(400).json({ error: "periodMonth, periodStart and periodEnd are required." });
      const createdBy = req.session.userId ? String(req.session.userId) : "system";
      const run = await storage.createPayrollRun(periodMonth, periodStart, periodEnd, createdBy);
      res.status(201).json(run);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to create payroll run" }); }
  });
  app.get("/api/payroll/runs/:id", requireModule("payroll"), async (req, res) => {
    const run = await storage.getPayrollRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: "Payroll run not found" });
    res.json(run);
  });
  app.get("/api/payroll/runs/:id/lines", requireModule("payroll"), async (req, res) => {
    res.json(await storage.listPayrollLines(Number(req.params.id)));
  });
  app.post("/api/payroll/runs/:id/approve", requireModule("payroll"), async (req, res) => {
    try {
      const approvedBy = req.session.userId ? String(req.session.userId) : "system";
      const run = await storage.approvePayrollRun(Number(req.params.id), approvedBy);
      const settings = await storage.getSettings();
      // Fire-and-forget-ish: we await it so the response reflects real send status, but a slow
      // email provider never blocks the ledger posting above, which has already committed.
      const payslipEmailSummary = await emailPayslipsForRun(storage, settings, run);
      res.json({ ...run, payslipEmailSummary });
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to approve payroll run" }); }
  });
  app.post("/api/payroll/runs/:id/cancel", requireModule("payroll"), async (req, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      const updated = await storage.cancelPayrollRun(Number(req.params.id), reason ?? "");
      if (!updated) return res.status(404).json({ error: "Payroll run not found" });
      res.json(updated);
    } catch (err: any) { res.status(400).json({ error: err?.message ?? "Failed to cancel payroll run" }); }
  });

  // Dedicated payslip PDF download — deliberately NOT routed through the generic
  // documents/issueDocument/public-token system (privacy-by-design; gated only by requireModule("payroll")).
  app.get("/api/payroll/lines/:id/payslip-pdf", requireModule("payroll"), async (req, res) => {
    try {
      const lineId = Number(req.params.id);
      const runs = await storage.listPayrollRuns();
      let line: Awaited<ReturnType<typeof storage.listPayrollLines>>[number] | undefined;
      let run: Awaited<ReturnType<typeof storage.getPayrollRun>> | undefined;
      for (const r of runs) {
        const lines = await storage.listPayrollLines(r.id);
        const found = lines.find((l) => l.id === lineId);
        if (found) { line = found; run = r; break; }
      }
      if (!line || !run) return res.status(404).json({ error: "Payslip not found" });
      const staffMember = await storage.getStaff(line.staffId);
      if (!staffMember) return res.status(404).json({ error: "Staff record not found" });
      const settings = await storage.getSettings();
      const [y, m] = run.periodMonth.split("-").map(Number);
      const periodLabel = y && m ? new Date(y, m - 1, 1).toLocaleDateString("en-KE", { month: "long", year: "numeric" }) : run.periodMonth;
      const pdf = await buildPayslipPdf(settings, {
        runNumber: run.runNumber,
        periodLabel,
        staffName: staffMember.name,
        staffRole: staffMember.role,
        staffDepartment: staffMember.department,
        employmentType: line.employmentType,
        daysOrHours: line.daysOrHours,
        nationalId: staffMember.nationalId,
        bankName: line.bankName,
        bankAccountNumber: line.bankAccountNumber,
        grossPay: line.grossPay,
        payeAmount: line.payeAmount,
        nssfEmployeeAmount: line.nssfEmployeeAmount,
        shifAmount: line.shifAmount,
        housingLevyEmployeeAmount: line.housingLevyEmployeeAmount,
        totalDeductions: line.totalDeductions,
        netPay: line.netPay,
        nssfEmployerAmount: line.nssfEmployerAmount,
        housingLevyEmployerAmount: line.housingLevyEmployerAmount,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Payslip-${run.runNumber}-${staffMember.name.replace(/\s+/g, "_")}.pdf"`);
      res.send(pdf);
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to generate payslip" }); }
  });

  // Bank-advice Excel export for a pay run (in scope for Phase 4).
  app.get("/api/payroll/runs/:id/bank-advice", requireModule("payroll"), async (req, res) => {
    try {
      const run = await storage.getPayrollRun(Number(req.params.id));
      if (!run) return res.status(404).json({ error: "Payroll run not found" });
      const lines = await storage.listPayrollLines(run.id);
      const staffList = await storage.listStaff();
      const staffMap = new Map(staffList.map((s) => [s.id, s]));

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Bank Advice");
      sheet.columns = [
        { header: "Employee Name", key: "name", width: 28 },
        { header: "National ID", key: "nationalId", width: 16 },
        { header: "Bank Name", key: "bankName", width: 22 },
        { header: "Account Number", key: "accountNumber", width: 20 },
        { header: "Net Pay (KES)", key: "netPay", width: 16 },
      ];
      sheet.getRow(1).font = { bold: true };
      let totalNet = 0;
      for (const line of lines) {
        const s = staffMap.get(line.staffId);
        sheet.addRow({
          name: s?.name ?? `Staff #${line.staffId}`,
          nationalId: s?.nationalId ?? "",
          bankName: line.bankName ?? "",
          accountNumber: line.bankAccountNumber ?? "",
          netPay: line.netPay,
        });
        totalNet += line.netPay;
      }
      const totalRow = sheet.addRow({ name: "TOTAL", netPay: Math.round(totalNet * 100) / 100 });
      totalRow.font = { bold: true };
      sheet.getColumn("netPay").numFmt = "#,##0.00";

      const filename = `Bank-Advice-${run.runNumber}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err: any) { res.status(500).json({ error: err?.message ?? "Failed to generate bank advice export" }); }
  });

  return httpServer;
}
