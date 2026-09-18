import { pgTable, text, integer, real, serial, bigint, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

// ---------- Accommodation: Rooms ----------
export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'standard' | 'executive' | custom
  rate: real("rate").notNull(), // KES per night
  status: text("status").notNull().default("available"), // available | occupied | maintenance
  notes: text("notes"),
});

export const insertRoomSchema = createInsertSchema(rooms).omit({ id: true });
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof rooms.$inferSelect;

// ---------- Accommodation: Bookings ----------
export const accommodationBookings = pgTable("accommodation_bookings", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull(),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone"),
  guestEmail: text("guest_email"),
  checkIn: text("check_in").notNull(), // YYYY-MM-DD
  checkOut: text("check_out").notNull(), // YYYY-MM-DD
  rate: real("rate").notNull(),
  totalAmount: real("total_amount").notNull(),
  amountPaid: real("amount_paid").notNull().default(0),
  paymentMethod: text("payment_method"), // cash | mpesa | card | bank_transfer
  paymentReference: text("payment_reference"), // M-Pesa code, card slip #, bank ref, etc.
  status: text("status").notNull().default("confirmed"), // pending_payment | confirmed | checked_in | checked_out | cancelled
  notes: text("notes"),
  numberOfGuests: integer("number_of_guests").notNull().default(1), // enforced max 2 at API level
  creditedAmount: real("credited_amount").notNull().default(0), // total issued against this booking's invoice via credit notes
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  // ---- Payment-gated confirmation (additive-only) ----
  // A booking only reaches "confirmed" once a payment is recorded (amountPaid > 0),
  // unless overridden by someone with canConfirmBookingWithoutPayment (Director's
  // discretion). Override fields are the audit trail for that exception.
  overriddenBy: text("overridden_by"),
  overriddenAt: bigint("overridden_at", { mode: "number" }),
  overrideReason: text("override_reason"),
});

export const insertAccommodationBookingSchema = createInsertSchema(accommodationBookings).omit({ id: true });
export type InsertAccommodationBooking = z.infer<typeof insertAccommodationBookingSchema>;
export type AccommodationBooking = typeof accommodationBookings.$inferSelect;

// ---------- Accommodation: Guest Identity Documents (ID/passport capture at check-in) ----------
export const ID_DOCUMENT_TYPES = ["national_id", "passport"] as const;
export type IdDocumentType = typeof ID_DOCUMENT_TYPES[number];

export const guestIdentityDocuments = pgTable("guest_identity_documents", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  guestNumber: integer("guest_number").notNull().default(1), // 1 or 2 (max 2 guests per room)
  guestName: text("guest_name").notNull(),
  idType: text("id_type").notNull().default("national_id"), // national_id | passport
  frontImageUrl: text("front_image_url").notNull(),
  backImageUrl: text("back_image_url"), // required for national_id, not applicable to passport
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertGuestIdentityDocumentSchema = createInsertSchema(guestIdentityDocuments).omit({ id: true });
export type InsertGuestIdentityDocument = z.infer<typeof insertGuestIdentityDocumentSchema>;
export type GuestIdentityDocument = typeof guestIdentityDocuments.$inferSelect;

// ---------- Facilities: Conference Hall / Movie Room / custom ----------
export const facilities = pgTable("facilities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rateType: text("rate_type").notNull().default("hourly"), // hourly | daily | flat
  rate: real("rate").notNull(),
  capacity: integer("capacity"),
  active: integer("active").notNull().default(1),
  notes: text("notes"),
});

export const insertFacilitySchema = createInsertSchema(facilities).omit({ id: true });
export type InsertFacility = z.infer<typeof insertFacilitySchema>;
export type Facility = typeof facilities.$inferSelect;

// ---------- Facility Bookings ----------
export const facilityBookings = pgTable("facility_bookings", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull(),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  eventDate: text("event_date").notNull(), // YYYY-MM-DD
  startTime: text("start_time"),
  endTime: text("end_time"),
  rate: real("rate").notNull(),
  totalAmount: real("total_amount").notNull(),
  amountPaid: real("amount_paid").notNull().default(0),
  paymentMethod: text("payment_method"), // cash | mpesa | card | bank_transfer
  paymentReference: text("payment_reference"), // M-Pesa code, card slip #, bank ref, etc.
  status: text("status").notNull().default("confirmed"), // pending_payment | confirmed | completed | cancelled
  notes: text("notes"),
  creditedAmount: real("credited_amount").notNull().default(0), // total issued against this booking's invoice via credit notes
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  // ---- Payment-gated confirmation (additive-only, mirrors accommodationBookings) ----
  overriddenBy: text("overridden_by"),
  overriddenAt: bigint("overridden_at", { mode: "number" }),
  overrideReason: text("override_reason"),
});

export const insertFacilityBookingSchema = createInsertSchema(facilityBookings).omit({ id: true });
export type InsertFacilityBooking = z.infer<typeof insertFacilityBookingSchema>;
export type FacilityBooking = typeof facilityBookings.$inferSelect;

// ---------- Movie Room: Seat map constants ----------
export const MOVIE_SEAT_ROWS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export const MOVIE_SEAT_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;
export type MovieSeatRow = typeof MOVIE_SEAT_ROWS[number];

// ---------- Movie Room: Shows ----------
export const movieShows = pgTable("movie_shows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // event/movie name shown on tickets & receipts
  showDate: text("show_date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time"), // HH:MM, optional
  ticketPrice: real("ticket_price").notNull(), // KES per seat
  status: text("status").notNull().default("scheduled"), // scheduled | completed | cancelled
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertMovieShowSchema = createInsertSchema(movieShows).omit({ id: true });
export type InsertMovieShow = z.infer<typeof insertMovieShowSchema>;
export type MovieShow = typeof movieShows.$inferSelect;

// ---------- Movie Room: Per-seat bookings ----------
export const movieSeatBookings = pgTable("movie_seat_bookings", {
  id: serial("id").primaryKey(),
  showId: integer("show_id").notNull(),
  seatRow: text("seat_row").notNull(), // A-G
  seatNumber: integer("seat_number").notNull(), // 1-7
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone"),
  guestEmail: text("guest_email"),
  ticketPrice: real("ticket_price").notNull(), // snapshot of the show's price at booking time
  amountPaid: real("amount_paid").notNull().default(0),
  paymentMethod: text("payment_method"), // cash | mpesa | card | bank_transfer
  paymentReference: text("payment_reference"), // M-Pesa code, card slip #, bank ref, etc.
  status: text("status").notNull().default("booked"), // booked | cancelled
  bookingRef: text("booking_ref").notNull(), // groups seats/shows purchased together into one transaction/receipt
  notes: text("notes"),
  creditedAmount: real("credited_amount").notNull().default(0), // total issued against this seat's invoice via credit notes
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertMovieSeatBookingSchema = createInsertSchema(movieSeatBookings).omit({ id: true });
export type InsertMovieSeatBooking = z.infer<typeof insertMovieSeatBookingSchema>;
export type MovieSeatBooking = typeof movieSeatBookings.$inferSelect;

// ---------- Bar & Restaurant: Menu Items ----------
export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // bar | restaurant
  price: real("price").notNull(),
  active: integer("active").notNull().default(1),
});

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({ id: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItems.$inferSelect;

// ---------- Bar & Restaurant: Orders ----------
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  outlet: text("outlet").notNull(), // bar | restaurant
  reference: text("reference"), // table / room number
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  orderDate: text("order_date").notNull(), // YYYY-MM-DD
  status: text("status").notNull().default("open"), // open | paid | cancelled
  paymentMethod: text("payment_method"), // cash | mpesa | card | room_charge
  paymentReference: text("payment_reference"), // M-Pesa code, card slip #, bank ref, etc.
  totalAmount: real("total_amount").notNull().default(0),
  notes: text("notes"),
  creditedAmount: real("credited_amount").notNull().default(0), // total issued against this order's receipt via credit notes
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  menuItemId: integer("menu_item_id"),
  itemName: text("item_name").notNull(),
  price: real("price").notNull(),
  quantity: integer("quantity").notNull().default(1),
  subtotal: real("subtotal").notNull(),
});

export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItems.$inferSelect;

// ---------- Bar & Restaurant / general: Tables list (editable, admin-managed) ----------
export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "Table 1", "Bar Stool 3"
  outlet: text("outlet").notNull().default("both"), // bar | restaurant | both
  capacity: integer("capacity"),
  active: integer("active").notNull().default(1),
});

export const insertTableSchema = createInsertSchema(tables).omit({ id: true });
export type InsertTableRow = z.infer<typeof insertTableSchema>;
export type TableRow = typeof tables.$inferSelect;

// ---------- Maintenance: issue register ----------
export const MAINTENANCE_CATEGORIES = [
  "electrical", "plumbing", "masonry", "welding", "grounds", "carpentry", "paint", "tiling", "other",
] as const;
export type MaintenanceCategory = typeof MAINTENANCE_CATEGORIES[number];
export const MAINTENANCE_CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  masonry: "Masonry",
  welding: "Welding",
  grounds: "Grounds",
  carpentry: "Carpentry",
  paint: "Paint",
  tiling: "Tiling",
  other: "Others",
};

export const MAINTENANCE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type MaintenanceStatus = typeof MAINTENANCE_STATUSES[number];

export const maintenanceIssues = pgTable("maintenance_issues", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  description: text("description"),
  reportedBy: text("reported_by").notNull(),
  reportedPhone: text("reported_phone"),
  assetId: integer("asset_id"), // optional link to the Assets register (which asset this issue is about)
  priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
  status: text("status").notNull().default("open"), // open | in_progress | resolved | closed
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
  closedAt: bigint("closed_at", { mode: "number" }),
  closedBy: text("closed_by"),
  // Unguessable token letting the reporter view/download a PDF issue report without logging in
  // (embedded in WhatsApp status-update messages). Nullable until bootstrapSchema backfills it.
  publicToken: text("public_token"),
});

export const insertMaintenanceIssueSchema = createInsertSchema(maintenanceIssues).omit({ id: true });
export type InsertMaintenanceIssue = z.infer<typeof insertMaintenanceIssueSchema>;
export type MaintenanceIssue = typeof maintenanceIssues.$inferSelect;

// ---------- Staff (Employee Register — Phase 4 extends this in place) ----------
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  department: text("department").notNull(), // front_desk | housekeeping | bar | restaurant | maintenance | security | management | other
  salary: real("salary").notNull(), // monthly KES — used when employmentType = permanent
  phone: text("phone"),
  status: text("status").notNull().default("active"), // active | inactive
  hireDate: text("hire_date"),
  notes: text("notes"),
  // ---- Phase 4 additions (additive-only) ----
  photoUrl: text("photo_url"),
  employmentType: text("employment_type").notNull().default("permanent"), // permanent | temporary
  dayRate: real("day_rate"), // KES — used when employmentType = temporary and paid by the day
  hourRate: real("hour_rate"), // KES — used when employmentType = temporary and paid by the hour
  nationalId: text("national_id"),
  nextOfKinName: text("next_of_kin_name"),
  nextOfKinPhone: text("next_of_kin_phone"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankBranch: text("bank_branch"),
  email: text("email"),
  // ---- Phase 7 addition (additive-only) ----
  // Set when this staff record was auto-created as a placeholder slot from an
  // approved Temporary Labor Requisition line — lets HR trace which requisition
  // authorized the hire and fill in the real name/rate. Null for normal hires.
  temporaryLaborRequisitionLineId: integer("temporary_labor_requisition_line_id"),
});

export const insertStaffSchema = createInsertSchema(staff).omit({ id: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staff.$inferSelect;

// ---------- Phase 4: Time & Attendance ----------
export const attendanceRecords = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  status: text("status").notNull().default("present"), // present | absent | half_day | on_leave | rest_day
  timeIn: text("time_in"),
  timeOut: text("time_out"),
  hoursWorked: real("hours_worked").notNull().default(0),
  notes: text("notes"),
  recordedBy: text("recorded_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true, createdAt: true });
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

// ---------- Phase 4: Leave Management ----------
export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  entitlementDaysPerYear: real("entitlement_days_per_year").notNull().default(0),
  accrualMethod: text("accrual_method").notNull().default("annual"), // annual | monthly
  isPaid: integer("is_paid").notNull().default(1),
  genderRestriction: text("gender_restriction"), // null | male | female
  active: integer("active").notNull().default(1),
});
export const insertLeaveTypeSchema = createInsertSchema(leaveTypes).omit({ id: true });
export type InsertLeaveType = z.infer<typeof insertLeaveTypeSchema>;
export type LeaveType = typeof leaveTypes.$inferSelect;

export const LEAVE_STATUSES = ["pending_review", "pending_approval", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = typeof LEAVE_STATUSES[number];

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(),
  leaveTypeId: integer("leave_type_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  days: real("days").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending_approval"), // pending_review | pending_approval | approved | rejected | cancelled
  approvalRuleId: integer("approval_rule_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  rejectedReason: text("rejected_reason"),
  cancelReason: text("cancel_reason"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertLeaveRequestSchema = createInsertSchema(leaveRequests).omit({ id: true, createdAt: true, status: true, approvalRuleId: true, reviewedBy: true, reviewedAt: true, approvedBy: true, approvedAt: true, rejectedReason: true, cancelReason: true });
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequests.$inferSelect;

export const leaveBalances = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(),
  leaveTypeId: integer("leave_type_id").notNull(),
  year: integer("year").notNull(),
  entitlement: real("entitlement").notNull().default(0),
  taken: real("taken").notNull().default(0),
});
export const insertLeaveBalanceSchema = createInsertSchema(leaveBalances).omit({ id: true });
export type InsertLeaveBalance = z.infer<typeof insertLeaveBalanceSchema>;
export type LeaveBalance = typeof leaveBalances.$inferSelect;

// ---------- Phase 4: Payroll ----------
// Configurable statutory rates — SHIF, NSSF, Housing Levy. PAYE bands live in
// their own table below since they need band ranges, not a single rate.
export const statutoryRateTables = pgTable("statutory_rate_tables", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // e.g. nssf_employee_tier1, shif_employee, housing_levy_employer
  label: text("label").notNull(),
  ratePercent: real("rate_percent").notNull().default(0),
  lowerLimit: real("lower_limit"), // KES — e.g. NSSF Lower Earnings Limit
  upperLimit: real("upper_limit"), // KES — e.g. NSSF Upper Earnings Limit / pensionable earnings cap
  minAmount: real("min_amount"), // KES — optional floor
  active: integer("active").notNull().default(1),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export const insertStatutoryRateTableSchema = createInsertSchema(statutoryRateTables).omit({ id: true, updatedAt: true });
export type InsertStatutoryRateTable = z.infer<typeof insertStatutoryRateTableSchema>;
export type StatutoryRateTable = typeof statutoryRateTables.$inferSelect;

export const payeBands = pgTable("paye_bands", {
  id: serial("id").primaryKey(),
  bandFrom: real("band_from").notNull(),
  bandTo: real("band_to"), // null = no upper limit
  ratePercent: real("rate_percent").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const insertPayeBandSchema = createInsertSchema(payeBands).omit({ id: true });
export type InsertPayeBand = z.infer<typeof insertPayeBandSchema>;
export type PayeBand = typeof payeBands.$inferSelect;

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  runNumber: text("run_number").notNull().unique(),
  periodMonth: text("period_month").notNull(), // YYYY-MM
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | cancelled
  totalGross: real("total_gross").notNull().default(0),
  totalDeductions: real("total_deductions").notNull().default(0),
  totalNet: real("total_net").notNull().default(0),
  totalEmployerCost: real("total_employer_cost").notNull().default(0),
  journalEntryId: integer("journal_entry_id"),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  cancelReason: text("cancel_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({ id: true, runNumber: true, createdAt: true, status: true, totalGross: true, totalDeductions: true, totalNet: true, totalEmployerCost: true, journalEntryId: true, approvedBy: true, approvedAt: true, cancelReason: true });
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollRun = typeof payrollRuns.$inferSelect;

export const payrollLines = pgTable("payroll_lines", {
  id: serial("id").primaryKey(),
  payrollRunId: integer("payroll_run_id").notNull(),
  staffId: integer("staff_id").notNull(),
  employmentType: text("employment_type").notNull(),
  daysOrHours: real("days_or_hours").notNull().default(0),
  grossPay: real("gross_pay").notNull().default(0),
  payeAmount: real("paye_amount").notNull().default(0),
  nssfEmployeeAmount: real("nssf_employee_amount").notNull().default(0),
  nssfEmployerAmount: real("nssf_employer_amount").notNull().default(0),
  shifAmount: real("shif_amount").notNull().default(0),
  housingLevyEmployeeAmount: real("housing_levy_employee_amount").notNull().default(0),
  housingLevyEmployerAmount: real("housing_levy_employer_amount").notNull().default(0),
  totalDeductions: real("total_deductions").notNull().default(0),
  netPay: real("net_pay").notNull().default(0),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  payslipEmailStatus: text("payslip_email_status"), // sent | failed | skipped
  payslipEmailError: text("payslip_email_error"),
});
export const insertPayrollLineSchema = createInsertSchema(payrollLines).omit({ id: true });
export type InsertPayrollLine = z.infer<typeof insertPayrollLineSchema>;
export type PayrollLine = typeof payrollLines.$inferSelect;

// ---------- Expenses (maintenance, utilities, supplies, other) ----------
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // maintenance | utilities | supplies | staff_other | marketing | other
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  paidTo: text("paid_to"),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

// ---------- Settings (singleton row) ----------
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  hotelName: text("hotel_name").notNull().default("The Chekata"),
  hotelAddress: text("hotel_address"),
  hotelPhone: text("hotel_phone"),
  hotelEmail: text("hotel_email"),
  emailProvider: text("email_provider").notNull().default(""), // '' | resend | sendgrid | postmark | mailgun
  emailApiKey: text("email_api_key"),
  emailFrom: text("email_from"), // From address used to send invoices/receipts
  emailFromName: text("email_from_name"),
  mailgunDomain: text("mailgun_domain"), // only used when provider = mailgun
  invoicesEnabled: integer("invoices_enabled").notNull().default(1),
  smsProvider: text("sms_provider").notNull().default(""), // '' | africastalking
  smsUsername: text("sms_username"), // Africa's Talking username (not secret)
  smsApiKey: text("sms_api_key"),
  smsSenderId: text("sms_sender_id"), // optional AT short code / sender ID
  smsEnabled: integer("sms_enabled").notNull().default(0),
  payePersonalRelief: real("paye_personal_relief").notNull().default(2400), // KES/month — Phase 4 payroll
  waterRatePerLitre: real("water_rate_per_litre").notNull().default(0), // KES/litre, tax-inclusive — used for bulk/metered water sales
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// ---------- Documents (invoice/receipt email log) ----------
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  docType: text("doc_type").notNull(), // invoice | receipt | credit_note
  category: text("category").notNull(), // accommodation | facility | bar | restaurant | movie | tenancy
  sourceId: integer("source_id").notNull(), // id of the booking/order this document belongs to
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  amount: real("amount").notNull(),
  status: text("status").notNull(), // sent | failed | skipped
  errorMessage: text("error_message"),
  payloadJson: text("payload_json").notNull(), // JSON snapshot used to regenerate the PDF
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  // Unguessable token that lets a guest view/download this document's PDF without logging in
  // (used to embed a PDF link in free click-to-send WhatsApp messages). Nullable so existing
  // rows created before this column existed keep working until bootstrapSchema backfills them.
  publicToken: text("public_token"),
  // Credit notes only: the invoice/receipt document being credited, and the reason given.
  // Nullable — irrelevant for docType invoice/receipt and for rows created before this existed.
  relatedDocumentId: integer("related_document_id"),
  reason: text("reason"),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type DocumentRecord = typeof documents.$inferSelect;

// ---------- Access control: modules ----------
export const MODULE_KEYS = [
  "dashboard",
  "accommodation",
  "facilities",
  "movie-room",
  "bar-restaurant",
  "staff",
  "expenses",
  "maintenance",
  "lists",
  "reports",
  "documents",
  "settings",
  "finance",
  "system-admin",
  "inventory",
  "purchasing",
  "internal-requisitions",
  "tenants",
  "fnb-costing",
  "attendance",
  "leave",
  "payroll",
  "budgeting",
  "assets",
  "water-sales",
  "hr",
] as const;
export type ModuleKey = typeof MODULE_KEYS[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Dashboard",
  accommodation: "Accommodation",
  facilities: "Conference & Movie Room",
  "movie-room": "Movie Room (Seat Booking)",
  "bar-restaurant": "Bar & Restaurant",
  staff: "Staff",
  expenses: "Expenses",
  maintenance: "Maintenance",
  lists: "Lists",
  reports: "Reports",
  documents: "Invoices & Receipts",
  settings: "Settings",
  finance: "Finance",
  "system-admin": "System Administration",
  inventory: "Inventory",
  purchasing: "Purchasing",
  "internal-requisitions": "Internal Requisitions",
  tenants: "Tenants",
  "fnb-costing": "F&B Costing",
  attendance: "Time & Attendance",
  leave: "Leave Management",
  payroll: "Payroll",
  budgeting: "Budgeting",
  assets: "Assets",
  "water-sales": "Water Sales",
  hr: "HR: Temporary Labor Requisitions",
};

// Cosmetic grouping used both by the Settings > Users module-access checkboxes
// and by the main sidebar navigation, so the two stay in sync automatically.
// Every module key except "settings" (which is never permission-assignable
// and always sits outside these categories) must appear in exactly one
// group here — all 24 operational modules, covered exactly once.
export const MODULE_CATEGORY_GROUPS: { label: string; keys: ModuleKey[] }[] = [
  { label: "Operations", keys: ["dashboard", "accommodation", "maintenance"] },
  { label: "Facilities", keys: ["facilities", "movie-room", "bar-restaurant", "fnb-costing", "water-sales"] },
  { label: "Finance & Accounting", keys: ["finance", "budgeting", "documents", "expenses"] },
  { label: "HR", keys: ["staff", "attendance", "leave", "payroll", "hr"] },
  { label: "Supply", keys: ["purchasing", "internal-requisitions", "inventory", "assets"] },
  { label: "Administration", keys: ["lists", "reports", "tenants", "system-admin"] },
];

// Tables that can be individually write-restricted per user via the System
// Administration → Table Permissions grid. A user may have module access
// but be blocked from writing to a specific table within it. Admins always
// bypass this check. This list grows as later phases add modules.
export const PERMISSION_TABLE_KEYS = [
  "finance.chart_of_accounts",
  "finance.journal_entries",
  "finance.payment_vouchers",
  "finance.accounting_periods",
  "finance.bank_accounts",
] as const;
export type PermissionTableKey = typeof PERMISSION_TABLE_KEYS[number];
export const PERMISSION_TABLE_LABELS: Record<PermissionTableKey, string> = {
  "finance.chart_of_accounts": "Finance — Chart of Accounts",
  "finance.journal_entries": "Finance — Journal Entries",
  "finance.payment_vouchers": "Finance — Payment Vouchers",
  "finance.accounting_periods": "Finance — Accounting Periods (open/close)",
  "finance.bank_accounts": "Finance — Bank Accounts",
};

// Document types the Approval Matrix can route. Grows in later phases
export const APPROVAL_DOCUMENT_TYPES = ["payment_voucher", "purchase_requisition", "purchase_order", "internal_requisition", "leave_request", "temporary_labor_requisition"] as const;
export type ApprovalDocumentType = typeof APPROVAL_DOCUMENT_TYPES[number];
export const APPROVAL_DOCUMENT_TYPE_LABELS: Record<ApprovalDocumentType, string> = {
  payment_voucher: "Payment Voucher",
  purchase_requisition: "Purchase Requisition",
  purchase_order: "Purchase Order",
  internal_requisition: "Internal Requisition",
  leave_request: "Leave Request",
  temporary_labor_requisition: "Temporary Labor Requisition",
};
// Document types that route by KES amount band (minAmount/maxAmount on the
// rule). internal_requisition is the one exception — it has no monetary
// value and instead routes by the requisitioned item(s)' category, matched
// against a rule's itemCategory (see resolveApprovalRuleByCategory in
// storage.ts). leave_request uses amount-band matching too, but on the
// number of days requested rather than KES — admins can leave a single
// unbounded (0..∞) rule for a flat, non-banded leave approval chain.
export const APPROVAL_CATEGORY_ROUTED_TYPES: ApprovalDocumentType[] = ["internal_requisition"];
// Document types whose amount band is worker-days/hours (headcount × duration)
// rather than KES or a raw day count.
export const APPROVAL_WORKER_DAYS_BANDED_TYPES: ApprovalDocumentType[] = ["temporary_labor_requisition"];

// ---------- Finance: Chart of Accounts ----------
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};
// Which side increases the balance for each account type — used by reports
// (Trial Balance, P&L, Balance Sheet) to decide how to present net movement.
export const ACCOUNT_NORMAL_BALANCE: Record<AccountType, "debit" | "credit"> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
  expense: "debit",
};

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g. 1000, 4000-01 — admin-defined, not hardcoded
  name: text("name").notNull(),
  type: text("type").notNull(), // asset | liability | equity | income | expense
  parentId: integer("parent_id"), // optional, for sub-accounts / groupings
  description: text("description"),
  active: integer("active").notNull().default(1),
  isSystem: integer("is_system").notNull().default(0), // seeded defaults; still editable, never force-deleted by code
  incomeStreamCode: text("income_stream_code"), // optional — tags an income-type account to a Budgeting income stream (definition_list_items.code for listKey "income_stream"), so actual-vs-budget variance can be computed from the ledger
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertChartOfAccountSchema = createInsertSchema(chartOfAccounts).omit({ id: true });
export type InsertChartOfAccount = z.infer<typeof insertChartOfAccountSchema>;
export type ChartOfAccount = typeof chartOfAccounts.$inferSelect;

// ---------- Finance: Accounting Periods ----------
export const accountingPeriods = pgTable("accounting_periods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "September 2026"
  financialYear: text("financial_year").notNull(), // e.g. "FY2026"
  startDate: text("start_date").notNull(), // YYYY-MM-DD
  endDate: text("end_date").notNull(), // YYYY-MM-DD
  status: text("status").notNull().default("open"), // open | closed
  closedAt: bigint("closed_at", { mode: "number" }),
  closedBy: text("closed_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertAccountingPeriodSchema = createInsertSchema(accountingPeriods).omit({ id: true });
export type InsertAccountingPeriod = z.infer<typeof insertAccountingPeriodSchema>;
export type AccountingPeriod = typeof accountingPeriods.$inferSelect;

// ---------- Finance: Journal Entries (General Ledger) ----------
// Journal entries can be CANCELLED but never deleted, per governance spec.
// entryNumber is system-generated and immutable once created.
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  entryNumber: text("entry_number").notNull().unique(), // e.g. JE-000001
  entryDate: text("entry_date").notNull(), // YYYY-MM-DD
  periodId: integer("period_id"),
  description: text("description").notNull(),
  sourceModule: text("source_module").notNull().default("finance"), // finance | accommodation | facilities | bar-restaurant | movie-room | ...
  sourceId: integer("source_id"), // id of the originating record in sourceModule, if system-generated
  status: text("status").notNull().default("posted"), // posted | cancelled
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  cancelledAt: bigint("cancelled_at", { mode: "number" }),
  cancelledBy: text("cancelled_by"),
  cancelReason: text("cancel_reason"),
});
export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true });
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalEntryLines = pgTable("journal_entry_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").notNull(),
  accountId: integer("account_id").notNull(),
  debit: real("debit").notNull().default(0),
  credit: real("credit").notNull().default(0),
  description: text("description"),
});
export const insertJournalEntryLineSchema = createInsertSchema(journalEntryLines).omit({ id: true });
export type InsertJournalEntryLine = z.infer<typeof insertJournalEntryLineSchema>;
export type JournalEntryLine = typeof journalEntryLines.$inferSelect;

// ---------- Finance: Bank Accounts ----------
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "KCB Operating Account"
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  glAccountId: integer("gl_account_id").notNull(), // linked Chart of Accounts asset account
  openingBalance: real("opening_balance").notNull().default(0),
  active: integer("active").notNull().default(1),
  notes: text("notes"),
});
export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true });
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

// ---------- Finance: Bank / Cash Reconciliations ----------
export const bankReconciliations = pgTable("bank_reconciliations", {
  id: serial("id").primaryKey(),
  bankAccountId: integer("bank_account_id").notNull(),
  statementDate: text("statement_date").notNull(), // YYYY-MM-DD
  statementBalance: real("statement_balance").notNull(),
  glBalance: real("gl_balance").notNull(),
  variance: real("variance").notNull(),
  status: text("status").notNull().default("in_progress"), // in_progress | completed
  notes: text("notes"),
  completedAt: bigint("completed_at", { mode: "number" }),
  completedBy: text("completed_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertBankReconciliationSchema = createInsertSchema(bankReconciliations).omit({ id: true });
export type InsertBankReconciliation = z.infer<typeof insertBankReconciliationSchema>;
export type BankReconciliation = typeof bankReconciliations.$inferSelect;

// ---------- Finance: Payment Vouchers (payments against invoices or standalone) ----------
// Cancel-not-delete, system-serialized, routes through the Approval Matrix
// when the amount requires it (checked at the application layer).
export const paymentVouchers = pgTable("payment_vouchers", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").notNull().unique(), // e.g. PV-000001
  voucherDate: text("voucher_date").notNull(), // YYYY-MM-DD
  payeeName: text("payee_name").notNull(),
  amount: real("amount").notNull(),
  paymentMethod: text("payment_method").notNull(), // cash | mpesa | card | bank_transfer | cheque
  paymentReference: text("payment_reference"),
  expenseAccountId: integer("expense_account_id").notNull(), // debit side (expense/payable account)
  bankAccountId: integer("bank_account_id").notNull(), // credit side (cash/bank)
  description: text("description").notNull(),
  status: text("status").notNull().default("draft"), // draft | pending_review | pending_approval | approved | posted | cancelled
  requestedBy: text("requested_by").notNull(),
  approvalRuleId: integer("approval_rule_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  journalEntryId: integer("journal_entry_id"), // set once posted
  cancelReason: text("cancel_reason"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertPaymentVoucherSchema = createInsertSchema(paymentVouchers).omit({ id: true });
export type InsertPaymentVoucher = z.infer<typeof insertPaymentVoucherSchema>;
export type PaymentVoucher = typeof paymentVouchers.$inferSelect;

// ---------- System Administration: Document numbering sequences (generic, reused by every module) ----------
export const documentSequences = pgTable("document_sequences", {
  sequenceKey: text("sequence_key").primaryKey(), // e.g. "journal_entry", "payment_voucher"
  prefix: text("prefix").notNull(), // e.g. "JE", "PV"
  nextNumber: integer("next_number").notNull().default(1),
  padLength: integer("pad_length").notNull().default(6),
});
export const insertDocumentSequenceSchema = createInsertSchema(documentSequences);
export type InsertDocumentSequence = z.infer<typeof insertDocumentSequenceSchema>;
export type DocumentSequence = typeof documentSequences.$inferSelect;

// ---------- System Administration: Approval Matrix ----------
// Generic requester -> reviewer -> final-approver workflow, reusable by
// every document type across the system. minAmount/maxAmount define the
// band a rule applies to (null maxAmount = no upper bound).
export const approvalMatrixRules = pgTable("approval_matrix_rules", {
  id: serial("id").primaryKey(),
  documentType: text("document_type").notNull(), // payment_voucher | (future: purchase_order, internal_requisition, leave_request)
  name: text("name").notNull(), // admin-friendly label, e.g. "Payments up to 50,000"
  minAmount: doublePrecision("min_amount").notNull().default(0),
  maxAmount: doublePrecision("max_amount"), // null = unbounded — doublePrecision (not real) since approval bands for large capex/procurement can exceed float32's ~8.3M safe range
  reviewerUserId: integer("reviewer_user_id"), // optional middle step; ignored if reviewerPosition is set
  // Nullable — a rule may instead authorize by position (approverPosition) rather
  // than a fixed person. Exactly one of approverUserId/approverPosition should be
  // set; enforced by insertApprovalMatrixRuleSchema's refinement below.
  approverUserId: integer("approver_user_id"),
  // Only used for documentType values in APPROVAL_CATEGORY_ROUTED_TYPES (currently
  // internal_requisition). Free-text, matched case-insensitively against
  // inventoryItems.category. Null = a catch-all/wildcard rule for that document
  // type, used when no category-specific rule matches. Ignored (left null) for
  // amount-banded document types, which use minAmount/maxAmount instead.
  itemCategory: text("item_category"),
  active: integer("active").notNull().default(1),
  // ---- Phase 7 additions (additive-only) ----
  // Dynamic, position-based routing: free text matched case-insensitively against
  // staff.role (via the acting user's users.staffId link) instead of a fixed user id.
  // When set, reviewerUserId/approverUserId for that stage are ignored. Any active
  // user whose linked staff record's role matches qualifies — admins always bypass.
  reviewerPosition: text("reviewer_position"),
  approverPosition: text("approver_position"),
});
export const insertApprovalMatrixRuleSchema = createInsertSchema(approvalMatrixRules).omit({ id: true }).refine(
  (v) => v.approverUserId != null || (v.approverPosition != null && v.approverPosition.trim() !== ""),
  { message: "Set either a final approver or an approver position", path: ["approverUserId"] },
);
export type InsertApprovalMatrixRule = z.infer<typeof insertApprovalMatrixRuleSchema>;
export type ApprovalMatrixRule = typeof approvalMatrixRules.$inferSelect;

// ---------- System Administration: Table-level permissions ----------
// A user may have module access but be denied write rights to a specific
// table within that module. Absence of a row = no restriction (full write
// access, subject to normal module permission). Admins always bypass.
export const permissionTableRules = pgTable("permission_table_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tableKey: text("table_key").notNull(), // one of PERMISSION_TABLE_KEYS
  canWrite: integer("can_write").notNull().default(0),
});
export const insertPermissionTableRuleSchema = createInsertSchema(permissionTableRules).omit({ id: true });
export type InsertPermissionTableRule = z.infer<typeof insertPermissionTableRuleSchema>;
export type PermissionTableRule = typeof permissionTableRules.$inferSelect;

// ---------- System Administration: Definitions (generic admin-editable lookup lists) ----------
// Powers every dropdown that should be admin-configurable instead of
// hardcoded — e.g. Time & Attendance Status/Shift Code/Leave Type, and any
// future module's option lists. A list is identified by a stable listKey
// that application code references; items are the admin-editable options.
export const definitionLists = pgTable("definition_lists", {
  id: serial("id").primaryKey(),
  listKey: text("list_key").notNull().unique(), // e.g. "attendance_status", "shift_code", "leave_type"
  label: text("label").notNull(), // e.g. "Attendance Status"
  description: text("description"),
  isSystem: integer("is_system").notNull().default(0), // seeded list; items still fully editable, list itself not deletable via UI
});
export const insertDefinitionListSchema = createInsertSchema(definitionLists).omit({ id: true });
export type InsertDefinitionList = z.infer<typeof insertDefinitionListSchema>;
export type DefinitionList = typeof definitionLists.$inferSelect;

export const definitionListItems = pgTable("definition_list_items", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull(),
  code: text("code").notNull(), // stable value stored in records/uploads, e.g. "present", "night"
  label: text("label").notNull(), // display label, e.g. "Present", "Night Shift"
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
});
export const insertDefinitionListItemSchema = createInsertSchema(definitionListItems).omit({ id: true });
export type InsertDefinitionListItem = z.infer<typeof insertDefinitionListItemSchema>;
export type DefinitionListItem = typeof definitionListItems.$inferSelect;

// ---------- Users ----------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  isAdmin: integer("is_admin").notNull().default(0),
  permissions: text("permissions").notNull().default("[]"), // JSON array of ModuleKey
  canEditMovieBookings: integer("can_edit_movie_bookings").notNull().default(0), // extra right: edit/cancel an already-entered movie seat booking
  canManageTablesList: integer("can_manage_tables_list").notNull().default(0), // Lists module: edit the Tables list
  canManageMenuItemsList: integer("can_manage_menu_items_list").notNull().default(0), // Lists module: edit the Menu Items list
  canCloseMaintenanceIssues: integer("can_close_maintenance_issues").notNull().default(0), // Maintenance module: close a reported issue
  canAdjustInventory: integer("can_adjust_inventory").notNull().default(0), // Inventory/Purchasing/Internal Requisitions: cancel PR/PO/IR and make manual stock adjustments
  canConfirmBookingWithoutPayment: integer("can_confirm_booking_without_payment").notNull().default(0), // Accommodation/Facilities: override — confirm a booking before payment is received (e.g. Director's discretion)
  canAccessLive: integer("can_access_live").notNull().default(1), // Environment access: log in to the Live (production) environment
  canAccessTest: integer("can_access_test").notNull().default(0), // Environment access: log in to the Test environment. Admins always bypass both checks.
  active: integer("active").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  // ---- Phase 7 addition (additive-only) ----
  // Optional link to this login account's HR staff record — used to resolve
  // position-based Approval Matrix rules (e.g. "only the Director may approve"),
  // which match against staff.role rather than a fixed user id.
  staffId: integer("staff_id"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "passwordHash">;

// ---------- Password reset tokens ----------
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true });
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ---------- Taxes ----------
export const taxes = pgTable("taxes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ratePercent: real("rate_percent").notNull(),
  active: integer("active").notNull().default(1),
  appliesAccommodation: integer("applies_accommodation").notNull().default(0),
  appliesFacilities: integer("applies_facilities").notNull().default(0),
  appliesBar: integer("applies_bar").notNull().default(0),
  appliesRestaurant: integer("applies_restaurant").notNull().default(0),
  appliesTenancy: integer("applies_tenancy").notNull().default(0),
  appliesWater: integer("applies_water").notNull().default(0),
});

export const insertTaxSchema = createInsertSchema(taxes).omit({ id: true });
export type InsertTax = z.infer<typeof insertTaxSchema>;
export type Tax = typeof taxes.$inferSelect;
export type TaxCategory = "accommodation" | "facilities" | "bar" | "restaurant" | "tenancy" | "water";

// ============================================================================
// Phase 2: Inventory, Purchasing, Internal Requisitions
// ============================================================================

// ---------- Inventory: Stores ----------
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  description: text("description"),
  active: integer("active").notNull().default(1),
});
export const insertStoreSchema = createInsertSchema(stores).omit({ id: true });
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof stores.$inferSelect;

// ---------- Inventory: Items ----------
// category / unitOfMeasure are free-text codes drawn from admin-editable
// definition lists ("inventory_category", "unit_of_measure") — never hardcoded.
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // SKU
  name: text("name").notNull(),
  category: text("category"),
  unitOfMeasure: text("unit_of_measure").notNull(),
  reorderLevel: real("reorder_level").notNull().default(0),
  lastUnitCost: real("last_unit_cost").notNull().default(0), // updated on every goods receipt; used to value permanent-issue GL postings
  glAssetAccountId: integer("gl_asset_account_id"), // Chart of Accounts asset account this item's stock value posts to (mirrors bankAccounts.glAccountId)
  active: integer("active").notNull().default(1),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ id: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;

// ---------- Inventory: Stock Ledger (perpetual, one row per movement) ----------
export const STOCK_TRANSACTION_TYPES = ["goods_receipt", "internal_issue", "loan_issue", "loan_return", "adjustment"] as const;
export type StockTransactionType = typeof STOCK_TRANSACTION_TYPES[number];

export const stockLedger = pgTable("stock_ledger", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  storeId: integer("store_id").notNull(),
  transactionType: text("transaction_type").notNull(), // one of STOCK_TRANSACTION_TYPES
  quantity: real("quantity").notNull(), // always positive; direction says which way it moved
  direction: text("direction").notNull(), // in | out
  unitCost: real("unit_cost").notNull().default(0),
  referenceType: text("reference_type"), // goods_receipt | internal_requisition | adjustment
  referenceId: integer("reference_id"),
  balanceAfter: real("balance_after").notNull(), // running quantity balance for this item+store after this movement
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertStockLedgerSchema = createInsertSchema(stockLedger).omit({ id: true });
export type InsertStockLedger = z.infer<typeof insertStockLedgerSchema>;
export type StockLedgerEntry = typeof stockLedger.$inferSelect;

// ---------- Purchasing: Suppliers ----------
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  paymentTerms: text("payment_terms"),
  active: integer("active").notNull().default(1),
  notes: text("notes"),
});
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// ---------- Purchasing: Purchase Requisitions ----------
// type "stock" replenishes a store (feeds Goods Receipt); type "direct" is a
// one-off expense purchase that skips stock entirely once its PO is received.
export const PR_TYPES = ["stock", "direct"] as const;
export type PrType = typeof PR_TYPES[number];
export const PR_STATUSES = ["draft", "pending_review", "pending_approval", "approved", "rejected", "cancelled"] as const;
export type PrStatus = typeof PR_STATUSES[number];

export const purchaseRequisitions = pgTable("purchase_requisitions", {
  id: serial("id").primaryKey(),
  prNumber: text("pr_number").notNull().unique(),
  requestedBy: text("requested_by").notNull(),
  department: text("department"),
  purpose: text("purpose").notNull(),
  type: text("type").notNull().default("stock"), // stock | direct
  status: text("status").notNull().default("draft"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  // Approval Matrix rule matched at submit time — drives who may review/approve.
  approvalRuleId: integer("approval_rule_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  rejectedReason: text("rejected_reason"),
  cancelReason: text("cancel_reason"),
});
export const insertPurchaseRequisitionSchema = createInsertSchema(purchaseRequisitions).omit({ id: true });
export type InsertPurchaseRequisition = z.infer<typeof insertPurchaseRequisitionSchema>;
export type PurchaseRequisition = typeof purchaseRequisitions.$inferSelect;

export const purchaseRequisitionLines = pgTable("purchase_requisition_lines", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").notNull(),
  itemId: integer("item_id"), // nullable — a direct-type line may describe a non-catalogued purchase
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unitOfMeasure: text("unit_of_measure"),
  estimatedUnitCost: real("estimated_unit_cost").notNull().default(0),
  notes: text("notes"),
});
export const insertPurchaseRequisitionLineSchema = createInsertSchema(purchaseRequisitionLines).omit({ id: true });
export type InsertPurchaseRequisitionLine = z.infer<typeof insertPurchaseRequisitionLineSchema>;
export type PurchaseRequisitionLine = typeof purchaseRequisitionLines.$inferSelect;

// ---------- Purchasing: Purchase Orders ----------
export const PO_STATUSES = ["draft", "pending_review", "pending_approval", "approved", "rejected", "partially_received", "received", "cancelled"] as const;
export type PoStatus = typeof PO_STATUSES[number];

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  requisitionId: integer("requisition_id"), // nullable — a PO can also be raised directly without a PR
  supplierId: integer("supplier_id").notNull(),
  type: text("type").notNull().default("stock"), // stock | direct
  status: text("status").notNull().default("draft"),
  payableAccountId: integer("payable_account_id").notNull(), // liability account, credit side on receipt
  expenseAccountId: integer("expense_account_id"), // required only for type "direct"; debit side on receipt
  totalAmount: real("total_amount").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  approvalRuleId: integer("approval_rule_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  rejectedReason: text("rejected_reason"),
  cancelReason: text("cancel_reason"),
  notes: text("notes"),
});
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull(),
  itemId: integer("item_id"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unitOfMeasure: text("unit_of_measure"),
  unitCost: real("unit_cost").notNull().default(0),
  lineTotal: real("line_total").notNull().default(0),
  quantityReceived: real("quantity_received").notNull().default(0),
});
export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLines).omit({ id: true });
export type InsertPurchaseOrderLine = z.infer<typeof insertPurchaseOrderLineSchema>;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

// ---------- Purchasing: Goods Receipts (stock-type POs only) ----------
export const goodsReceipts = pgTable("goods_receipts", {
  id: serial("id").primaryKey(),
  grnNumber: text("grn_number").notNull().unique(),
  poId: integer("po_id").notNull(),
  storeId: integer("store_id").notNull(),
  receivedBy: text("received_by").notNull(),
  receivedAt: bigint("received_at", { mode: "number" }).notNull(),
  status: text("status").notNull().default("completed"), // completed | cancelled
  notes: text("notes"),
});
export const insertGoodsReceiptSchema = createInsertSchema(goodsReceipts).omit({ id: true });
export type InsertGoodsReceipt = z.infer<typeof insertGoodsReceiptSchema>;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: serial("id").primaryKey(),
  grnId: integer("grn_id").notNull(),
  poLineId: integer("po_line_id").notNull(),
  itemId: integer("item_id").notNull(),
  quantityReceived: real("quantity_received").notNull(),
  unitCost: real("unit_cost").notNull().default(0),
});
export const insertGoodsReceiptLineSchema = createInsertSchema(goodsReceiptLines).omit({ id: true });
export type InsertGoodsReceiptLine = z.infer<typeof insertGoodsReceiptLineSchema>;
export type GoodsReceiptLine = typeof goodsReceiptLines.$inferSelect;

// ---------- Internal Requisitions ----------
// type "permanent" consumes stock and posts an expense JE; type "loan" only
// relocates stock (goods remain company property) and posts no JE at all.
export const IR_TYPES = ["permanent", "loan"] as const;
export type IrType = typeof IR_TYPES[number];
export const IR_STATUSES = ["draft", "pending_review", "pending_approval", "approved", "rejected", "cancelled", "issued"] as const;
export type IrStatus = typeof IR_STATUSES[number];

export const internalRequisitions = pgTable("internal_requisitions", {
  id: serial("id").primaryKey(),
  irNumber: text("ir_number").notNull().unique(),
  requestedBy: text("requested_by").notNull(),
  department: text("department"),
  storeId: integer("store_id").notNull(),
  type: text("type").notNull().default("permanent"), // permanent | loan
  expenseAccountId: integer("expense_account_id"), // required for type "permanent"
  status: text("status").notNull().default("draft"),
  purpose: text("purpose").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  approvalRuleId: integer("approval_rule_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  rejectedReason: text("rejected_reason"),
  cancelReason: text("cancel_reason"),
});
export const insertInternalRequisitionSchema = createInsertSchema(internalRequisitions).omit({ id: true });
export type InsertInternalRequisition = z.infer<typeof insertInternalRequisitionSchema>;
export type InternalRequisition = typeof internalRequisitions.$inferSelect;

export const internalRequisitionLines = pgTable("internal_requisition_lines", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").notNull(),
  itemId: integer("item_id").notNull(),
  quantityRequested: real("quantity_requested").notNull(),
  quantityIssued: real("quantity_issued").notNull().default(0),
  quantityReturned: real("quantity_returned").notNull().default(0),
  notes: text("notes"),
});
export const insertInternalRequisitionLineSchema = createInsertSchema(internalRequisitionLines).omit({ id: true });
export type InsertInternalRequisitionLine = z.infer<typeof insertInternalRequisitionLineSchema>;
export type InternalRequisitionLine = typeof internalRequisitionLines.$inferSelect;

// ---------- Temporary Labor Requisitions (Phase 7) ----------
// Authorizes hiring temporary workers, per role, before they exist as staff
// records. Goes through the same configurable Approval Matrix as PR/PO/IR/Leave.
// Only users with the "hr" module may create one; the final approver is
// resolved dynamically by position (staff.role), not a fixed user — see
// approvalMatrixRules.approverPosition and assertApprovalActor in storage.ts.
// Approving a TLR auto-creates blank placeholder staff records (one per
// headcount unit per line) for HR to fill in with real names/rates.
export const TLR_DURATION_UNITS = ["days", "hours"] as const;
export type TlrDurationUnit = typeof TLR_DURATION_UNITS[number];
export const TLR_STATUSES = ["draft", "pending_review", "pending_approval", "approved", "rejected", "cancelled"] as const;
export type TlrStatus = typeof TLR_STATUSES[number];

export const temporaryLaborRequisitions = pgTable("temporary_labor_requisitions", {
  id: serial("id").primaryKey(),
  tlrNumber: text("tlr_number").notNull().unique(),
  requestedBy: text("requested_by").notNull(),
  purpose: text("purpose").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  approvalRuleId: integer("approval_rule_id"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
  rejectedReason: text("rejected_reason"),
  cancelReason: text("cancel_reason"),
});
export const insertTemporaryLaborRequisitionSchema = createInsertSchema(temporaryLaborRequisitions).omit({ id: true });
export type InsertTemporaryLaborRequisition = z.infer<typeof insertTemporaryLaborRequisitionSchema>;
export type TemporaryLaborRequisition = typeof temporaryLaborRequisitions.$inferSelect;

export const temporaryLaborRequisitionLines = pgTable("temporary_labor_requisition_lines", {
  id: serial("id").primaryKey(),
  requisitionId: integer("requisition_id").notNull(),
  role: text("role").notNull(), // free text, e.g. "Waiter", "Mason" — not linked to job-role master data
  headcount: integer("headcount").notNull(),
  durationValue: real("duration_value").notNull(),
  durationUnit: text("duration_unit").notNull().default("days"), // days | hours
  dateNeeded: text("date_needed"), // YYYY-MM-DD, when this role is needed from
  notes: text("notes"),
});
export const insertTemporaryLaborRequisitionLineSchema = createInsertSchema(temporaryLaborRequisitionLines).omit({ id: true });
export type InsertTemporaryLaborRequisitionLine = z.infer<typeof insertTemporaryLaborRequisitionLineSchema>;
export type TemporaryLaborRequisitionLine = typeof temporaryLaborRequisitionLines.$inferSelect;

export const loanReturns = pgTable("loan_returns", {
  id: serial("id").primaryKey(),
  requisitionLineId: integer("requisition_line_id").notNull(),
  quantityReturned: real("quantity_returned").notNull(),
  returnedAt: bigint("returned_at", { mode: "number" }).notNull(),
  returnedBy: text("returned_by").notNull(),
  condition: text("condition"),
  notes: text("notes"),
});
export const insertLoanReturnSchema = createInsertSchema(loanReturns).omit({ id: true });
export type InsertLoanReturn = z.infer<typeof insertLoanReturnSchema>;
export type LoanReturn = typeof loanReturns.$inferSelect;

// ============================================================================
// Phase 3: Tenants, F&B Costing
// ============================================================================

// ---------- Tenants: Shops ----------
export const shops = pgTable("shops", {
  id: serial("id").primaryKey(),
  shopNumber: text("shop_number").notNull().unique(),
  description: text("description"),
  location: text("location"),
  sizeSqm: real("size_sqm"),
  active: integer("active").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertShopSchema = createInsertSchema(shops).omit({ id: true });
export type InsertShop = z.infer<typeof insertShopSchema>;
export type Shop = typeof shops.$inferSelect;

// ---------- Tenants: Tenants ----------
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  idNumber: text("id_number"),
  active: integer("active").notNull().default(1),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

// ---------- Tenants: Tenancy Leases ----------
export const LEASE_STATUSES = ["active", "ended"] as const;
export type LeaseStatus = typeof LEASE_STATUSES[number];

export const tenancyLeases = pgTable("tenancy_leases", {
  id: serial("id").primaryKey(),
  shopId: integer("shop_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  monthlyRent: real("monthly_rent").notNull(),
  electricityRatePerUnit: real("electricity_rate_per_unit").notNull().default(0),
  leaseStart: text("lease_start").notNull(), // YYYY-MM-DD
  leaseEnd: text("lease_end"), // YYYY-MM-DD, nullable = open-ended
  dueDayOfMonth: integer("due_day_of_month").notNull().default(5), // configurable, 1-28
  reminderDaysBefore: integer("reminder_days_before").notNull().default(3),
  documentUrl: text("document_url"), // uploaded lease document
  receivableAccountId: integer("receivable_account_id"), // GL asset account — Tenant Rent Receivable
  incomeAccountId: integer("income_account_id"), // GL income account — Rental Income
  status: text("status").notNull().default("active"), // active | ended
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertTenancyLeaseSchema = createInsertSchema(tenancyLeases).omit({ id: true });
export type InsertTenancyLease = z.infer<typeof insertTenancyLeaseSchema>;
export type TenancyLease = typeof tenancyLeases.$inferSelect;

// ---------- Tenants: Meter Readings ----------
export const meterReadings = pgTable("meter_readings", {
  id: serial("id").primaryKey(),
  leaseId: integer("lease_id").notNull(),
  periodMonth: text("period_month").notNull(), // YYYY-MM
  startReading: real("start_reading").notNull(),
  endReading: real("end_reading").notNull(),
  consumption: real("consumption").notNull(), // computed = endReading - startReading
  amount: real("amount").notNull(), // computed = consumption * lease's electricityRatePerUnit at time of entry
  readingDate: text("reading_date").notNull(), // YYYY-MM-DD
  recordedBy: text("recorded_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertMeterReadingSchema = createInsertSchema(meterReadings).omit({ id: true });
export type InsertMeterReading = z.infer<typeof insertMeterReadingSchema>;
export type MeterReading = typeof meterReadings.$inferSelect;

// ---------- Tenants: Rent Invoices ----------
export const RENT_INVOICE_STATUSES = ["unpaid", "partially_paid", "paid", "overdue", "cancelled"] as const;
export type RentInvoiceStatus = typeof RENT_INVOICE_STATUSES[number];

export const rentInvoices = pgTable("rent_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  leaseId: integer("lease_id").notNull(),
  periodMonth: text("period_month").notNull(), // YYYY-MM
  rentAmount: real("rent_amount").notNull(),
  electricityAmount: real("electricity_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull(),
  amountPaid: real("amount_paid").notNull().default(0),
  dueDate: text("due_date").notNull(), // YYYY-MM-DD
  status: text("status").notNull().default("unpaid"),
  reminderSentAt: bigint("reminder_sent_at", { mode: "number" }),
  journalEntryId: integer("journal_entry_id"),
  cancelReason: text("cancel_reason"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertRentInvoiceSchema = createInsertSchema(rentInvoices).omit({ id: true });
export type InsertRentInvoice = z.infer<typeof insertRentInvoiceSchema>;
export type RentInvoice = typeof rentInvoices.$inferSelect;

// ---------- Tenants: Rent Invoice Payments (audit trail) ----------
export const rentInvoicePayments = pgTable("rent_invoice_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  amount: real("amount").notNull(),
  paymentMethod: text("payment_method"), // cash | mpesa | card | bank_transfer
  paymentReference: text("payment_reference"),
  journalEntryId: integer("journal_entry_id"),
  paidAt: bigint("paid_at", { mode: "number" }).notNull(),
  recordedBy: text("recorded_by").notNull(),
});
export const insertRentInvoicePaymentSchema = createInsertSchema(rentInvoicePayments).omit({ id: true });
export type InsertRentInvoicePayment = z.infer<typeof insertRentInvoicePaymentSchema>;
export type RentInvoicePayment = typeof rentInvoicePayments.$inferSelect;

// ---------- F&B Costing: Recipes ----------
export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  menuItemId: integer("menu_item_id"), // optional link to an existing bar/restaurant menu item
  servingsPerBatch: real("servings_per_batch").notNull().default(1),
  laborCostPercent: real("labor_cost_percent").notNull().default(0), // labor/overhead, as a % of ingredient cost per serving
  targetMarginPercent: real("target_margin_percent").notNull().default(0),
  active: integer("active").notNull().default(1),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipes.$inferSelect;

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  quantityPerServing: real("quantity_per_serving").notNull(),
  unit: text("unit"), // optional override of the item's default unit of measure
});
export const insertRecipeIngredientSchema = createInsertSchema(recipeIngredients).omit({ id: true });
export type InsertRecipeIngredient = z.infer<typeof insertRecipeIngredientSchema>;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;

// ---------- Phase 5: Budgeting ----------
// Income streams themselves are NOT a fixed enum — they are an admin-editable
// definition list (listKey "income_stream", managed via System Administration
// → Definitions, same generic mechanism used for attendance status / leave
// type / etc). Seeded with a starter set, but new streams can be added at any
// time without a code change.
export const budgetLines = pgTable("budget_lines", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(), // "YYYY-MM"
  incomeStreamCode: text("income_stream_code").notNull(), // definition_list_items.code for listKey "income_stream"
  budgetedAmount: real("budgeted_amount").notNull().default(0),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export const insertBudgetLineSchema = createInsertSchema(budgetLines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBudgetLine = z.infer<typeof insertBudgetLineSchema>;
export type BudgetLine = typeof budgetLines.$inferSelect;

// ---------- Phase 5: Assets ----------
export const DEPRECIATION_METHODS = ["straight_line", "none"] as const;
export type DepreciationMethod = typeof DEPRECIATION_METHODS[number];

export const assetCategories = pgTable("asset_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // e.g. Vehicles, IT Equipment, CCTV, Furniture
  description: text("description"),
  defaultUsefulLifeMonths: integer("default_useful_life_months").notNull().default(60),
  defaultDepreciationMethod: text("default_depreciation_method").notNull().default("straight_line"),
  depreciationExpenseAccountId: integer("depreciation_expense_account_id"), // Finance chart-of-accounts (expense type)
  accumulatedDepreciationAccountId: integer("accumulated_depreciation_account_id"), // Finance chart-of-accounts (asset/contra type)
  active: integer("active").notNull().default(1),
});
export const insertAssetCategorySchema = createInsertSchema(assetCategories).omit({ id: true });
export type InsertAssetCategory = z.infer<typeof insertAssetCategorySchema>;
export type AssetCategory = typeof assetCategories.$inferSelect;

export const ASSET_STATUSES = ["active", "under_maintenance", "disposed"] as const;
export type AssetStatus = typeof ASSET_STATUSES[number];

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  assetNumber: text("asset_number").notNull().unique(), // auto-serialized, e.g. AST-000001
  name: text("name").notNull(),
  categoryId: integer("category_id").notNull(),
  description: text("description"),
  serialNumber: text("serial_number"),
  location: text("location"),
  supplier: text("supplier"),
  acquisitionDate: text("acquisition_date").notNull(), // YYYY-MM-DD
  acquisitionCost: real("acquisition_cost").notNull().default(0),
  salvageValue: real("salvage_value").notNull().default(0),
  usefulLifeMonths: integer("useful_life_months").notNull().default(60),
  depreciationMethod: text("depreciation_method").notNull().default("straight_line"),
  status: text("status").notNull().default("active"), // active | under_maintenance | disposed
  photoUrl: text("photo_url"),
  notes: text("notes"),
  disposedAt: bigint("disposed_at", { mode: "number" }),
  disposalValue: real("disposal_value"),
  disposalNotes: text("disposal_notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertAssetSchema = createInsertSchema(assets).omit({ id: true, assetNumber: true, createdAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assets.$inferSelect;

// One row per asset per period once a depreciation run has been posted for
// that period — the running record of net book value over time.
export const assetDepreciationSchedules = pgTable("asset_depreciation_schedules", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull(),
  periodMonth: text("period_month").notNull(), // "YYYY-MM"
  depreciationAmount: real("depreciation_amount").notNull().default(0),
  accumulatedDepreciation: real("accumulated_depreciation").notNull().default(0),
  netBookValue: real("net_book_value").notNull().default(0),
  journalEntryId: integer("journal_entry_id"), // the posted Finance journal entry for this run
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertAssetDepreciationScheduleSchema = createInsertSchema(assetDepreciationSchedules).omit({ id: true, createdAt: true });
export type InsertAssetDepreciationSchedule = z.infer<typeof insertAssetDepreciationScheduleSchema>;
export type AssetDepreciationSchedule = typeof assetDepreciationSchedules.$inferSelect;

// ============================================================================
// Water Sales (bulk water — buckets or metered bulk fill)
// ============================================================================

// "bucket": customer's own container of a configured size (e.g. 10L, 20L),
// charged the fixed configured price for that size.
// "bulk": filled based on a water meter reading difference, charged at the
// configured per-litre rate.
export const WATER_SALE_TYPES = ["bucket", "bulk"] as const;
export type WaterSaleType = typeof WATER_SALE_TYPES[number];

export const WATER_SALE_STATUSES = ["completed", "cancelled"] as const;
export type WaterSaleStatus = typeof WATER_SALE_STATUSES[number];

// Admin-configurable catalogue of bucket sizes and their fixed prices —
// nothing hardcoded to exactly "10L"/"20L"; sizes/prices are full CRUD.
export const waterBucketPrices = pgTable("water_bucket_prices", {
  id: serial("id").primaryKey(),
  sizeLitres: real("size_litres").notNull().unique(),
  price: real("price").notNull(), // KES, tax-inclusive
  active: integer("active").notNull().default(1),
});
export const insertWaterBucketPriceSchema = createInsertSchema(waterBucketPrices).omit({ id: true });
export type InsertWaterBucketPrice = z.infer<typeof insertWaterBucketPriceSchema>;
export type WaterBucketPrice = typeof waterBucketPrices.$inferSelect;

export const waterSales = pgTable("water_sales", {
  id: serial("id").primaryKey(),
  saleNumber: text("sale_number").notNull().unique(), // e.g. WS-000001
  saleDate: text("sale_date").notNull(), // YYYY-MM-DD
  saleType: text("sale_type").notNull(), // bucket | bulk
  bucketSizeLitres: real("bucket_size_litres"), // required for saleType "bucket"
  bucketCount: integer("bucket_count"), // required for saleType "bucket"
  meterStart: real("meter_start"), // required for saleType "bulk"
  meterEnd: real("meter_end"), // required for saleType "bulk"
  litresSold: real("litres_sold").notNull(), // bucketSizeLitres*bucketCount, or meterEnd-meterStart
  unitPrice: real("unit_price"), // bucket sales: price per bucket, snapshotted at sale time
  ratePerLitre: real("rate_per_litre"), // bulk sales: rate per litre, snapshotted at sale time
  totalAmount: real("total_amount").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  paymentMethod: text("payment_method"), // cash | mpesa | card
  paymentReference: text("payment_reference"),
  status: text("status").notNull().default("completed"), // completed | cancelled
  notes: text("notes"),
  cancelReason: text("cancel_reason"),
  creditedAmount: real("credited_amount").notNull().default(0), // amount refunded back via credit notes against this sale's receipt
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export const insertWaterSaleSchema = createInsertSchema(waterSales).omit({
  id: true, saleNumber: true, litresSold: true, unitPrice: true, ratePerLitre: true,
  totalAmount: true, status: true, cancelReason: true, creditedAmount: true, createdAt: true,
  createdBy: true, // server-set from the authenticated session — passive audit stamp, never client input
});
export type InsertWaterSale = z.infer<typeof insertWaterSaleSchema>;
export type WaterSale = typeof waterSales.$inferSelect;
