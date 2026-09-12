import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
import {
  insertRoomSchema, insertAccommodationBookingSchema,
  insertFacilitySchema, insertFacilityBookingSchema,
  insertMenuItemSchema, insertOrderSchema, insertOrderItemSchema,
  insertStaffSchema, insertExpenseSchema, insertSettingsSchema,
  insertUserSchema, insertTaxSchema, MODULE_KEYS, type ModuleKey,
} from "@shared/schema";
import { issueDocument } from "./documents";
import { buildDocumentPdf } from "./pdf";
import { sendTransactionalEmail } from "./email";
import { buildReportsWorkbook, REPORT_SHEET_LABELS, type ReportSheetKey } from "./reports-excel";
import { requireAuth, requireModule, requireAdmin, hashPassword, verifyPassword, toSafeUser, parsePermissions, resolveUserIdFromHeaderToken } from "./auth";

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

  // ---------- Everything below requires a signed-in, active user ----------
  app.use("/api", requireAuth);

  // ---------- Users (admin only) ----------
  app.get("/api/users", requireAdmin, async (_req, res) => {
    const list = await storage.listUsers();
    res.json(list.map(toSafeUser));
  });
  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, fullName, isAdmin, permissions, active } = req.body as {
        username?: string; password?: string; fullName?: string; isAdmin?: boolean; permissions?: ModuleKey[]; active?: boolean;
      };
      if (!username || !password || !fullName) return res.status(400).json({ error: "Username, password and full name are required." });
      if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
      const passwordHash = await hashPassword(password);
      const validPerms = Array.isArray(permissions) ? permissions.filter((p) => (MODULE_KEYS as readonly string[]).includes(p)) : [];
      const user = await storage.createUser({
        username: username.trim().toLowerCase(),
        passwordHash,
        fullName: fullName.trim(),
        isAdmin: isAdmin ? 1 : 0,
        permissions: JSON.stringify(validPerms),
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
      const { username, password, fullName, isAdmin, permissions, active } = req.body as {
        username?: string; password?: string; fullName?: string; isAdmin?: boolean; permissions?: ModuleKey[]; active?: boolean;
      };
      const currentUserId = (req as any).user.id;
      if (currentUserId === id && isAdmin === false) {
        return res.status(400).json({ error: "You can't remove your own administrator access." });
      }
      if (currentUserId === id && active === false) {
        return res.status(400).json({ error: "You can't deactivate your own account." });
      }
      const patch: Record<string, any> = {};
      if (username) patch.username = username.trim().toLowerCase();
      if (fullName) patch.fullName = fullName.trim();
      if (typeof isAdmin === "boolean") patch.isAdmin = isAdmin ? 1 : 0;
      if (Array.isArray(permissions)) patch.permissions = JSON.stringify(permissions.filter((p) => (MODULE_KEYS as readonly string[]).includes(p)));
      if (typeof active === "boolean") patch.active = active ? 1 : 0;
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
      });
      res.status(201).json({ ...booking, _document: { status: doc.status, errorMessage: doc.errorMessage } });
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
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage };
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
      });
      res.status(201).json({ ...booking, _document: { status: doc.status, errorMessage: doc.errorMessage } });
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
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage };
      }
      res.json({ ...updated, _document: docResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/facility-bookings/:id", requireModule("facilities"), async (req, res) => {
    await storage.deleteFacilityBooking(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Menu Items ----------
  app.get("/api/menu-items", requireModule("bar-restaurant"), async (_req, res) => {
    res.json(await storage.listMenuItems());
  });
  app.post("/api/menu-items", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const data = insertMenuItemSchema.parse(req.body);
      res.status(201).json(await storage.createMenuItem(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.patch("/api/menu-items/:id", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const data = insertMenuItemSchema.partial().parse(req.body);
      const updated = await storage.updateMenuItem(Number(req.params.id), data);
      if (!updated) return res.status(404).json({ error: "Menu item not found" });
      res.json(updated);
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/menu-items/:id", requireModule("bar-restaurant"), async (req, res) => {
    await storage.deleteMenuItem(Number(req.params.id));
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
        });
        docResult = { status: doc.status, errorMessage: doc.errorMessage };
      }
      res.json({ ...updated, _document: docResult });
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/orders/:id", requireModule("bar-restaurant"), async (req, res) => {
    await storage.deleteOrder(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Order Items ----------
  app.get("/api/orders/:orderId/items", requireModule("bar-restaurant"), async (req, res) => {
    res.json(await storage.listOrderItems(Number(req.params.orderId)));
  });
  app.post("/api/order-items", requireModule("bar-restaurant"), async (req, res) => {
    try {
      const data = insertOrderItemSchema.parse(req.body);
      res.status(201).json(await storage.createOrderItem(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.delete("/api/order-items/:id", requireModule("bar-restaurant"), async (req, res) => {
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

  // ---------- Settings ----------
  app.get("/api/settings", requireModule("settings"), async (_req, res) => {
    res.json(await storage.getSettings());
  });
  app.put("/api/settings", requireModule("settings"), async (req, res) => {
    try {
      const data = insertSettingsSchema.partial().parse(req.body);
      res.json(await storage.updateSettings(data));
    } catch (err) { handleZodError(res, err); }
  });
  app.post("/api/settings/test-email", requireModule("settings"), async (req, res) => {
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
      const validSheets: (ReportSheetKey | "all")[] = ["all", "overview", "accommodation", "facilities", "bar-restaurant", "staff", "expenses", "taxes"];
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

  return httpServer;
}
