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
  status: text("status").notNull().default("confirmed"), // confirmed | checked_in | checked_out | cancelled
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertAccommodationBookingSchema = createInsertSchema(accommodationBookings).omit({ id: true });
export type InsertAccommodationBooking = z.infer<typeof insertAccommodationBookingSchema>;
export type AccommodationBooking = typeof accommodationBookings.$inferSelect;

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
  status: text("status").notNull().default("confirmed"), // confirmed | completed | cancelled
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
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

// ---------- Staff ----------
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  department: text("department").notNull(), // front_desk | housekeeping | bar | restaurant | maintenance | security | management | other
  salary: real("salary").notNull(), // monthly KES
  phone: text("phone"),
  status: text("status").notNull().default("active"), // active | inactive
  hireDate: text("hire_date"),
  notes: text("notes"),
});

export const insertStaffSchema = createInsertSchema(staff).omit({ id: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staff.$inferSelect;

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
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// ---------- Documents (invoice/receipt email log) ----------
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  docType: text("doc_type").notNull(), // invoice | receipt
  category: text("category").notNull(), // accommodation | facility | bar | restaurant
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
};

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
// (purchase_order, internal_requisition, leave_request join once those
// modules exist).
export const APPROVAL_DOCUMENT_TYPES = ["payment_voucher", "purchase_requisition", "purchase_order", "internal_requisition"] as const;
export type ApprovalDocumentType = typeof APPROVAL_DOCUMENT_TYPES[number];
export const APPROVAL_DOCUMENT_TYPE_LABELS: Record<ApprovalDocumentType, string> = {
  payment_voucher: "Payment Voucher",
  purchase_requisition: "Purchase Requisition",
  purchase_order: "Purchase Order",
  internal_requisition: "Internal Requisition",
};

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
  status: text("status").notNull().default("draft"), // draft | pending_approval | approved | posted | cancelled
  requestedBy: text("requested_by").notNull(),
  reviewedBy: text("reviewed_by"),
  approvedBy: text("approved_by"),
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
  reviewerUserId: integer("reviewer_user_id"), // optional middle step
  approverUserId: integer("approver_user_id").notNull(), // final approver; may also act as final if no reviewer set
  active: integer("active").notNull().default(1),
});
export const insertApprovalMatrixRuleSchema = createInsertSchema(approvalMatrixRules).omit({ id: true });
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
  active: integer("active").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
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
});

export const insertTaxSchema = createInsertSchema(taxes).omit({ id: true });
export type InsertTax = z.infer<typeof insertTaxSchema>;
export type Tax = typeof taxes.$inferSelect;
export type TaxCategory = "accommodation" | "facilities" | "bar" | "restaurant";

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
export const PR_STATUSES = ["draft", "pending_approval", "approved", "rejected", "cancelled"] as const;
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
export const PO_STATUSES = ["draft", "approved", "partially_received", "received", "cancelled"] as const;
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
  approvedBy: text("approved_by"),
  approvedAt: bigint("approved_at", { mode: "number" }),
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
export const IR_STATUSES = ["draft", "pending_approval", "approved", "rejected", "cancelled", "issued"] as const;
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
