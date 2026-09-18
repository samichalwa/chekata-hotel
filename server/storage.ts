import {
  rooms, accommodationBookings, facilities, facilityBookings,
  movieShows, movieSeatBookings,
  menuItems, orders, orderItems, staff, expenses, settings, documents,
  users, passwordResetTokens, taxes, tables, maintenanceIssues, MODULE_KEYS,
  chartOfAccounts, accountingPeriods, journalEntries, journalEntryLines,
  bankAccounts, bankReconciliations, paymentVouchers, documentSequences,
  approvalMatrixRules, permissionTableRules, definitionLists, definitionListItems,
  stores, inventoryItems, stockLedger, suppliers,
  purchaseRequisitions, purchaseRequisitionLines, purchaseOrders, purchaseOrderLines,
  goodsReceipts, goodsReceiptLines, internalRequisitions, internalRequisitionLines, loanReturns,
  guestIdentityDocuments, shops, tenants, tenancyLeases, meterReadings,
  rentInvoices, rentInvoicePayments, recipes, recipeIngredients,
  attendanceRecords, leaveTypes, leaveRequests, leaveBalances,
  statutoryRateTables, payeBands, payrollRuns, payrollLines,
  budgetLines, assetCategories, assets, assetDepreciationSchedules,
  waterBucketPrices, waterSales,
  temporaryLaborRequisitions, temporaryLaborRequisitionLines,
} from '@shared/schema';
import type {
  Room, InsertRoom,
  AttendanceRecord, InsertAttendanceRecord,
  LeaveType, InsertLeaveType,
  LeaveRequest, InsertLeaveRequest,
  LeaveBalance, InsertLeaveBalance,
  StatutoryRateTable, InsertStatutoryRateTable,
  PayeBand, InsertPayeBand,
  PayrollRun, InsertPayrollRun,
  PayrollLine, InsertPayrollLine,
  AccommodationBooking, InsertAccommodationBooking,
  Facility, InsertFacility,
  FacilityBooking, InsertFacilityBooking,
  MovieShow, InsertMovieShow,
  MovieSeatBooking, InsertMovieSeatBooking,
  MenuItem, InsertMenuItem,
  Order, InsertOrder,
  OrderItem, InsertOrderItem,
  Staff, InsertStaff,
  Expense, InsertExpense,
  Settings, InsertSettings,
  DocumentRecord, InsertDocument,
  User, InsertUser,
  PasswordResetToken, InsertPasswordResetToken,
  Tax, InsertTax,
  TableRow, InsertTableRow,
  MaintenanceIssue, InsertMaintenanceIssue,
  ChartOfAccount, InsertChartOfAccount,
  AccountingPeriod, InsertAccountingPeriod,
  JournalEntry, InsertJournalEntry,
  JournalEntryLine, InsertJournalEntryLine,
  BankAccount, InsertBankAccount,
  BankReconciliation, InsertBankReconciliation,
  PaymentVoucher, InsertPaymentVoucher,
  ApprovalMatrixRule, InsertApprovalMatrixRule,
  PermissionTableRule, InsertPermissionTableRule,
  DefinitionList, InsertDefinitionList,
  DefinitionListItem, InsertDefinitionListItem,
  Store, InsertStore,
  InventoryItem, InsertInventoryItem,
  StockLedgerEntry, InsertStockLedger,
  Supplier, InsertSupplier,
  PurchaseRequisition, InsertPurchaseRequisition,
  PurchaseRequisitionLine, InsertPurchaseRequisitionLine,
  PurchaseOrder, InsertPurchaseOrder,
  PurchaseOrderLine, InsertPurchaseOrderLine,
  GoodsReceipt, InsertGoodsReceipt,
  GoodsReceiptLine, InsertGoodsReceiptLine,
  InternalRequisition, InsertInternalRequisition,
  InternalRequisitionLine, InsertInternalRequisitionLine,
  LoanReturn, InsertLoanReturn,
  GuestIdentityDocument, InsertGuestIdentityDocument,
  Shop, InsertShop,
  Tenant, InsertTenant,
  TenancyLease, InsertTenancyLease,
  MeterReading, InsertMeterReading,
  RentInvoice, InsertRentInvoice,
  RentInvoicePayment, InsertRentInvoicePayment,
  Recipe, InsertRecipe,
  RecipeIngredient, InsertRecipeIngredient,
  BudgetLine, InsertBudgetLine,
  AssetCategory, InsertAssetCategory,
  Asset, InsertAsset,
  AssetDepreciationSchedule, InsertAssetDepreciationSchedule,
  WaterBucketPrice, InsertWaterBucketPrice,
  WaterSale, InsertWaterSale,
  TemporaryLaborRequisition, InsertTemporaryLaborRequisition,
  TemporaryLaborRequisitionLine, InsertTemporaryLaborRequisitionLine,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCurrentEnvironment } from "./db-context";
import { eq, and, ne, desc, gte, lte, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Set it to your Postgres (e.g. Supabase) connection string.",
  );
}

// `prepare: false` is required against Supabase's transaction pooler (port 6543).
// This is the real, production database — every call site in this file
// (and everywhere `storage`/`db`/`sql` is imported from) that runs outside
// of a request/job that opted into the Test environment ends up here.
export const liveSql = postgres(connectionString, { ssl: "require", prepare: false });
export const liveDb = drizzle(liveSql);

// The isolated Test database (Phase 6 — Test/Live environment split). Only
// configured when TEST_DATABASE_URL is set (production, and any local dev
// setup that opts in); local/preview sandboxes without it simply run with
// Test unavailable, which is fine since nothing there depends on it.
const testConnectionString = process.env.TEST_DATABASE_URL;
export const testSql = testConnectionString
  ? postgres(testConnectionString, { ssl: "require", prepare: false })
  : null;
export const testDb = testSql ? drizzle(testSql) : null;

export function isTestDbConfigured(): boolean {
  return testSql !== null;
}

function activeSql() {
  if (getCurrentEnvironment() === "test") {
    if (!testSql) throw new Error("The Test database is not configured on this server (TEST_DATABASE_URL is not set).");
    return testSql;
  }
  return liveSql;
}

function activeDb() {
  if (getCurrentEnvironment() === "test") {
    if (!testDb) throw new Error("The Test database is not configured on this server (TEST_DATABASE_URL is not set).");
    return testDb;
  }
  return liveDb;
}

// `sql` and `db` below are environment-routing proxies, not fixed
// connections. Every one of the ~300 storage methods in this file (and the
// session-agnostic raw-SQL helpers throughout the codebase) calls `db.select(...)`,
// `sql\`...\``, etc. exactly as before — but which physical database that
// hits is now decided per-call by `getCurrentEnvironment()`, which middleware
// sets from the signed-in user's session (see server/auth.ts). This is what
// lets a single running server transparently serve both Live and Test
// traffic without duplicating a single query.
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  get(_target, prop, _receiver) {
    const target = activeSql() as any;
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
  apply(_target, _thisArg, args) {
    return (activeSql() as any)(...args);
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, _receiver) {
    const target = activeDb() as any;
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

// ---- Schema bootstrap (no migrations tooling in this sandbox) ----
// Takes an explicit target connection (Live or Test) rather than going
// through the environment-routing `sql` proxy above: this runs at server
// startup, before any request has established an environment context, and
// needs to deliberately bootstrap BOTH databases with the identical schema
// (see the two `bootstrapSchema(...)` calls in the schemaReady block below).
// Shadowing the module-level `sql`/`db` names with local params means the
// ~1000 lines of `sql\`...\`` calls below need no other changes.
async function bootstrapSchema(targetSql: typeof liveSql) {
  const sql = targetSql;
  await sql.unsafe(`
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  rate REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  notes TEXT
);
CREATE TABLE IF NOT EXISTS accommodation_bookings (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  rate REAL NOT NULL,
  total_amount REAL NOT NULL,
  amount_paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS facilities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rate_type TEXT NOT NULL DEFAULT 'hourly',
  rate REAL NOT NULL,
  capacity INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS facility_bookings (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  client_email TEXT,
  event_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  rate REAL NOT NULL,
  total_amount REAL NOT NULL,
  amount_paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS movie_shows (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  show_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  ticket_price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS movie_seat_bookings (
  id SERIAL PRIMARY KEY,
  show_id INTEGER NOT NULL,
  seat_row TEXT NOT NULL,
  seat_number INTEGER NOT NULL,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  ticket_price REAL NOT NULL,
  amount_paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  booking_ref TEXT NOT NULL,
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  outlet TEXT NOT NULL,
  reference TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  payment_method TEXT,
  payment_reference TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  menu_item_id INTEGER,
  item_name TEXT NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT NOT NULL,
  salary REAL NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  hire_date TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  paid_to TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  hotel_name TEXT NOT NULL DEFAULT 'The Chekata',
  hotel_address TEXT,
  hotel_phone TEXT,
  hotel_email TEXT,
  email_provider TEXT NOT NULL DEFAULT '',
  email_api_key TEXT,
  email_from TEXT,
  email_from_name TEXT,
  mailgun_domain TEXT,
  invoices_enabled INTEGER NOT NULL DEFAULT 1,
  sms_provider TEXT NOT NULL DEFAULT '',
  sms_username TEXT,
  sms_api_key TEXT,
  sms_sender_id TEXT,
  sms_enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  doc_type TEXT NOT NULL,
  category TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  recipient_name TEXT,
  recipient_email TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  payload_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS taxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rate_percent REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  applies_accommodation INTEGER NOT NULL DEFAULT 0,
  applies_facilities INTEGER NOT NULL DEFAULT 0,
  applies_bar INTEGER NOT NULL DEFAULT 0,
  applies_restaurant INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_message_log (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body_preview TEXT,
  attachment_filename TEXT,
  blocked INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_copy_runs (
  id SERIAL PRIMARY KEY,
  started_by_user_id INTEGER,
  started_by_username TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  current_step TEXT,
  tables_done INTEGER NOT NULL DEFAULT 0,
  tables_total INTEGER NOT NULL DEFAULT 0,
  rows_copied INTEGER NOT NULL DEFAULT 0,
  files_copied INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at BIGINT NOT NULL,
  finished_at BIGINT
);
CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  outlet TEXT NOT NULL DEFAULT 'both',
  capacity INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS maintenance_issues (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  description TEXT,
  reported_by TEXT NOT NULL,
  reported_phone TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT,
  closed_at BIGINT,
  closed_by TEXT
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id INTEGER,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounting_periods (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  financial_year TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at BIGINT,
  closed_by TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_number TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  period_id INTEGER,
  description TEXT NOT NULL,
  source_module TEXT NOT NULL DEFAULT 'finance',
  source_id INTEGER,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  cancelled_at BIGINT,
  cancelled_by TEXT,
  cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id SERIAL PRIMARY KEY,
  journal_entry_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  description TEXT
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  gl_account_id INTEGER NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id SERIAL PRIMARY KEY,
  bank_account_id INTEGER NOT NULL,
  statement_date TEXT NOT NULL,
  statement_balance REAL NOT NULL,
  gl_balance REAL NOT NULL,
  variance REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  notes TEXT,
  completed_at BIGINT,
  completed_by TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_vouchers (
  id SERIAL PRIMARY KEY,
  voucher_number TEXT NOT NULL UNIQUE,
  voucher_date TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  payment_reference TEXT,
  expense_account_id INTEGER NOT NULL,
  bank_account_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  approved_by TEXT,
  journal_entry_id INTEGER,
  cancel_reason TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_sequences (
  sequence_key TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  pad_length INTEGER NOT NULL DEFAULT 6
);
CREATE TABLE IF NOT EXISTS approval_matrix_rules (
  id SERIAL PRIMARY KEY,
  document_type TEXT NOT NULL,
  name TEXT NOT NULL,
  min_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_amount DOUBLE PRECISION,
  reviewer_user_id INTEGER,
  approver_user_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS permission_table_rules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  table_key TEXT NOT NULL,
  can_write INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS definition_lists (
  id SERIAL PRIMARY KEY,
  list_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS definition_list_items (
  id SERIAL PRIMARY KEY,
  list_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  unit_of_measure TEXT NOT NULL,
  reorder_level REAL NOT NULL DEFAULT 0,
  last_unit_cost REAL NOT NULL DEFAULT 0,
  gl_asset_account_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_ledger (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  direction TEXT NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id INTEGER,
  balance_after REAL NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  payment_terms TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id SERIAL PRIMARY KEY,
  pr_number TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  department TEXT,
  purpose TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'stock',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at BIGINT NOT NULL,
  approved_by TEXT,
  approved_at BIGINT,
  rejected_reason TEXT,
  cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
  id SERIAL PRIMARY KEY,
  requisition_id INTEGER NOT NULL,
  item_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_of_measure TEXT,
  estimated_unit_cost REAL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  requisition_id INTEGER,
  supplier_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'stock',
  status TEXT NOT NULL DEFAULT 'draft',
  payable_account_id INTEGER NOT NULL,
  expense_account_id INTEGER,
  total_amount REAL NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  approved_by TEXT,
  approved_at BIGINT,
  rejected_reason TEXT,
  cancel_reason TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL,
  item_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_of_measure TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  quantity_received REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goods_receipts (
  id SERIAL PRIMARY KEY,
  grn_number TEXT NOT NULL UNIQUE,
  po_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  received_by TEXT NOT NULL,
  received_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT
);
CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id SERIAL PRIMARY KEY,
  grn_id INTEGER NOT NULL,
  po_line_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity_received REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS internal_requisitions (
  id SERIAL PRIMARY KEY,
  ir_number TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  department TEXT,
  store_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'permanent',
  expense_account_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  purpose TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  approved_by TEXT,
  approved_at BIGINT,
  rejected_reason TEXT,
  cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS internal_requisition_lines (
  id SERIAL PRIMARY KEY,
  requisition_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity_requested REAL NOT NULL,
  quantity_issued REAL NOT NULL DEFAULT 0,
  quantity_returned REAL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS loan_returns (
  id SERIAL PRIMARY KEY,
  requisition_line_id INTEGER NOT NULL,
  quantity_returned REAL NOT NULL,
  returned_at BIGINT NOT NULL,
  returned_by TEXT NOT NULL,
  condition TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS temporary_labor_requisitions (
  id SERIAL PRIMARY KEY,
  tlr_number TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at BIGINT NOT NULL,
  approval_rule_id INTEGER,
  reviewed_by TEXT,
  reviewed_at BIGINT,
  approved_by TEXT,
  approved_at BIGINT,
  rejected_reason TEXT,
  cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS temporary_labor_requisition_lines (
  id SERIAL PRIMARY KEY,
  requisition_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  headcount INTEGER NOT NULL,
  duration_value REAL NOT NULL,
  duration_unit TEXT NOT NULL DEFAULT 'days',
  date_needed TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS guest_identity_documents (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  guest_number INTEGER NOT NULL DEFAULT 1,
  guest_name TEXT NOT NULL,
  id_type TEXT NOT NULL DEFAULT 'national_id',
  front_image_url TEXT NOT NULL,
  back_image_url TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS shops (
  id SERIAL PRIMARY KEY,
  shop_number TEXT NOT NULL UNIQUE,
  description TEXT,
  location TEXT,
  size_sqm REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  id_number TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenancy_leases (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  monthly_rent REAL NOT NULL,
  electricity_rate_per_unit REAL NOT NULL DEFAULT 0,
  lease_start TEXT NOT NULL,
  lease_end TEXT,
  due_day_of_month INTEGER NOT NULL DEFAULT 5,
  reminder_days_before INTEGER NOT NULL DEFAULT 3,
  document_url TEXT,
  receivable_account_id INTEGER,
  income_account_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS meter_readings (
  id SERIAL PRIMARY KEY,
  lease_id INTEGER NOT NULL,
  period_month TEXT NOT NULL,
  start_reading REAL NOT NULL,
  end_reading REAL NOT NULL,
  consumption REAL NOT NULL,
  amount REAL NOT NULL,
  reading_date TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(lease_id, period_month)
);
CREATE TABLE IF NOT EXISTS rent_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  lease_id INTEGER NOT NULL,
  period_month TEXT NOT NULL,
  rent_amount REAL NOT NULL,
  electricity_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  amount_paid REAL NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  reminder_sent_at BIGINT,
  journal_entry_id INTEGER,
  cancel_reason TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(lease_id, period_month)
);
CREATE TABLE IF NOT EXISTS rent_invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT,
  payment_reference TEXT,
  journal_entry_id INTEGER,
  paid_at BIGINT NOT NULL,
  recorded_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  menu_item_id INTEGER,
  servings_per_batch REAL NOT NULL DEFAULT 1,
  labor_cost_percent REAL NOT NULL DEFAULT 0,
  target_margin_percent REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  quantity_per_serving REAL NOT NULL,
  unit TEXT
);
CREATE TABLE IF NOT EXISTS attendance_records (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  time_in TEXT,
  time_out TEXT,
  hours_worked REAL NOT NULL DEFAULT 0,
  notes TEXT,
  recorded_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(staff_id, date)
);
CREATE TABLE IF NOT EXISTS leave_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  entitlement_days_per_year REAL NOT NULL DEFAULT 0,
  accrual_method TEXT NOT NULL DEFAULT 'annual',
  is_paid INTEGER NOT NULL DEFAULT 1,
  gender_restriction TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL,
  leave_type_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at BIGINT,
  cancel_reason TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_balances (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL,
  leave_type_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  entitlement REAL NOT NULL DEFAULT 0,
  taken REAL NOT NULL DEFAULT 0,
  UNIQUE(staff_id, leave_type_id, year)
);
CREATE TABLE IF NOT EXISTS statutory_rate_tables (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  rate_percent REAL NOT NULL DEFAULT 0,
  lower_limit REAL,
  upper_limit REAL,
  min_amount REAL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS paye_bands (
  id SERIAL PRIMARY KEY,
  band_from REAL NOT NULL,
  band_to REAL,
  rate_percent REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  run_number TEXT NOT NULL UNIQUE,
  period_month TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_gross REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  total_net REAL NOT NULL DEFAULT 0,
  total_employer_cost REAL NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,
  approved_by TEXT,
  approved_at BIGINT,
  cancel_reason TEXT,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS payroll_lines (
  id SERIAL PRIMARY KEY,
  payroll_run_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  employment_type TEXT NOT NULL,
  days_or_hours REAL NOT NULL DEFAULT 0,
  gross_pay REAL NOT NULL DEFAULT 0,
  paye_amount REAL NOT NULL DEFAULT 0,
  nssf_employee_amount REAL NOT NULL DEFAULT 0,
  nssf_employer_amount REAL NOT NULL DEFAULT 0,
  shif_amount REAL NOT NULL DEFAULT 0,
  housing_levy_employee_amount REAL NOT NULL DEFAULT 0,
  housing_levy_employer_amount REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  net_pay REAL NOT NULL DEFAULT 0,
  bank_name TEXT,
  bank_account_number TEXT,
  payslip_email_status TEXT,
  payslip_email_error TEXT
);
`);

  // ---- Phase 5: Budgeting + Assets (fresh-install bootstrap) ----
  await sql.unsafe(`
CREATE TABLE IF NOT EXISTS budget_lines (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  income_stream_code TEXT NOT NULL,
  budgeted_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(month, income_stream_code)
);
CREATE TABLE IF NOT EXISTS asset_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_useful_life_months INTEGER NOT NULL DEFAULT 60,
  default_depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  depreciation_expense_account_id INTEGER,
  accumulated_depreciation_account_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  asset_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  description TEXT,
  serial_number TEXT,
  location TEXT,
  supplier TEXT,
  acquisition_date TEXT NOT NULL,
  acquisition_cost REAL NOT NULL DEFAULT 0,
  salvage_value REAL NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL DEFAULT 60,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  status TEXT NOT NULL DEFAULT 'active',
  photo_url TEXT,
  notes TEXT,
  disposed_at BIGINT,
  disposal_value REAL,
  disposal_notes TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_depreciation_schedules (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  period_month TEXT NOT NULL,
  depreciation_amount REAL NOT NULL DEFAULT 0,
  accumulated_depreciation REAL NOT NULL DEFAULT 0,
  net_book_value REAL NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,
  created_at BIGINT NOT NULL,
  UNIQUE(asset_id, period_month)
);
`);
  await ensureColumn("chart_of_accounts", "income_stream_code", "TEXT");
  await ensureColumn("maintenance_issues", "asset_id", "INTEGER");
  // Credit notes (Phase 7): amounts already credited against each booking/order's invoice,
  // and the invoice/reason a credit_note document references.
  await ensureColumn("accommodation_bookings", "credited_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("facility_bookings", "credited_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("movie_seat_bookings", "credited_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("orders", "credited_amount", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("documents", "related_document_id", "INTEGER");
  await ensureColumn("documents", "reason", "TEXT");
  // Older installs created document_sequences (via a pre-PRIMARY-KEY schema revision) without a
  // unique constraint on sequence_key, so the ON CONFLICT (sequence_key) upserts below throw
  // 42P10 "no unique or exclusion constraint matching" until we backfill the constraint here.
  await ensureUniqueConstraint("document_sequences", "sequence_key", "document_sequences_sequence_key_key");
  await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('credit_note', 'CN', 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;

  // ---- Idempotent column additions for installs upgraded from an earlier version ----
  async function ensureColumn(table: string, column: string, ddl: string) {
    try {
      await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (e: any) {
      if (!/already exists/i.test(String(e?.message))) throw e;
    }
  }
  // Idempotent column type widening — safe to re-run every startup (a no-op once the column is already the target type).
  async function ensureColumnType(table: string, column: string, targetType: string) {
    await sql.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${targetType}`);
  }
  // Idempotent single-column UNIQUE constraint backfill for tables whose original
  // CREATE TABLE IF NOT EXISTS predates a PRIMARY KEY/UNIQUE on `column` (so it never
  // applied on already-provisioned databases). Deduplicates any pre-existing duplicate
  // rows first (keeping the lowest ctid) so the ADD CONSTRAINT itself cannot fail on dirty data.
  async function ensureUniqueConstraint(table: string, column: string, constraintName: string) {
    const [{ exists: hasConstraint }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = ${table} AND con.contype IN ('p', 'u')
          AND con.conkey = (
            SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
            WHERE attrelid = rel.oid AND attname = ${column}
          )
      ) AS exists
    `;
    if (hasConstraint) return;
    await sql.unsafe(`
      DELETE FROM ${table} a USING ${table} b
      WHERE a.${column} = b.${column} AND a.ctid < b.ctid
    `);
    try {
      await sql.unsafe(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} UNIQUE (${column})`);
    } catch (e: any) {
      if (!/already exists/i.test(String(e?.message))) throw e;
    }
  }
  // approval_matrix_rules.min_amount/max_amount were briefly created as REAL (float32, ~8.3M safe range) —
  // widen to DOUBLE PRECISION so large capex/procurement approval bands don't get clipped or lose precision.
  await ensureColumnType("approval_matrix_rules", "min_amount", "DOUBLE PRECISION");
  await ensureColumnType("approval_matrix_rules", "max_amount", "DOUBLE PRECISION");
  await ensureColumn("accommodation_bookings", "guest_email", "TEXT");
  await ensureColumn("facility_bookings", "client_email", "TEXT");
  await ensureColumn("orders", "customer_name", "TEXT");
  await ensureColumn("orders", "customer_email", "TEXT");
  await ensureColumn("orders", "customer_phone", "TEXT");
  await ensureColumn("users", "can_edit_movie_bookings", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_manage_tables_list", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_manage_menu_items_list", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_close_maintenance_issues", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_adjust_inventory", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_confirm_booking_without_payment", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_access_live", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn("users", "can_access_test", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("settings", "sms_provider", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("settings", "sms_username", "TEXT");
  await ensureColumn("settings", "sms_api_key", "TEXT");
  await ensureColumn("settings", "sms_sender_id", "TEXT");
  await ensureColumn("settings", "sms_enabled", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("accommodation_bookings", "payment_method", "TEXT");
  await ensureColumn("accommodation_bookings", "payment_reference", "TEXT");
  await ensureColumn("facility_bookings", "payment_method", "TEXT");
  await ensureColumn("facility_bookings", "payment_reference", "TEXT");
  await ensureColumn("movie_seat_bookings", "payment_method", "TEXT");
  await ensureColumn("movie_seat_bookings", "payment_reference", "TEXT");
  await ensureColumn("orders", "payment_reference", "TEXT");
  await ensureColumn("documents", "public_token", "TEXT");
  await ensureColumn("maintenance_issues", "public_token", "TEXT");
  await ensureColumn("accommodation_bookings", "number_of_guests", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn("taxes", "applies_tenancy", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("taxes", "applies_water", "INTEGER NOT NULL DEFAULT 0");

  // ---- Phase 4: additive staff (Employee Register) columns ----
  await ensureColumn("staff", "photo_url", "TEXT");
  await ensureColumn("staff", "employment_type", "TEXT NOT NULL DEFAULT 'permanent'");
  await ensureColumn("staff", "day_rate", "REAL");
  await ensureColumn("staff", "hour_rate", "REAL");
  await ensureColumn("staff", "national_id", "TEXT");
  await ensureColumn("staff", "next_of_kin_name", "TEXT");
  await ensureColumn("staff", "next_of_kin_phone", "TEXT");
  await ensureColumn("staff", "bank_name", "TEXT");
  await ensureColumn("staff", "bank_account_number", "TEXT");
  await ensureColumn("staff", "bank_branch", "TEXT");
  await ensureColumn("staff", "email", "TEXT");
  // PAYE personal relief lives on settings (a single configurable figure), not a table —
  // editable in the Payroll → Statutory Rates screen without a code change.
  await ensureColumn("settings", "paye_personal_relief", "REAL NOT NULL DEFAULT 2400");
  await ensureColumn("settings", "water_rate_per_litre", "REAL NOT NULL DEFAULT 0");

  // ---- Approval matrix wiring (Sept 2026): PR/PO/IR/leave/payment voucher routing ----
  await ensureColumn("approval_matrix_rules", "item_category", "TEXT");
  await ensureColumn("purchase_requisitions", "approval_rule_id", "INTEGER");
  await ensureColumn("purchase_requisitions", "reviewed_by", "TEXT");
  await ensureColumn("purchase_requisitions", "reviewed_at", "BIGINT");
  await ensureColumn("purchase_orders", "approval_rule_id", "INTEGER");
  await ensureColumn("purchase_orders", "reviewed_by", "TEXT");
  await ensureColumn("purchase_orders", "reviewed_at", "BIGINT");
  await ensureColumn("internal_requisitions", "approval_rule_id", "INTEGER");
  await ensureColumn("internal_requisitions", "reviewed_by", "TEXT");
  await ensureColumn("internal_requisitions", "reviewed_at", "BIGINT");
  await ensureColumn("leave_requests", "approval_rule_id", "INTEGER");
  await ensureColumn("leave_requests", "reviewed_by", "TEXT");
  await ensureColumn("leave_requests", "reviewed_at", "BIGINT");
  await ensureColumn("leave_requests", "rejected_reason", "TEXT");
  await ensureColumn("payment_vouchers", "approval_rule_id", "INTEGER");
  await ensureColumn("payment_vouchers", "reviewed_at", "BIGINT");
  await ensureColumn("payment_vouchers", "approved_at", "BIGINT");

  // ---- Phase 7 (Sept 2026): Temporary Labor Requisitions + position-based approval routing ----
  await ensureColumn("users", "staff_id", "INTEGER");
  await ensureColumn("staff", "temporary_labor_requisition_line_id", "INTEGER");
  await ensureColumn("approval_matrix_rules", "reviewer_position", "TEXT");
  await ensureColumn("approval_matrix_rules", "approver_position", "TEXT");
  // Position-based rules have no fixed approver_user_id — relax the original NOT NULL
  // constraint (idempotent: dropping an already-dropped NOT NULL is a no-op, no error).
  await sql.unsafe(`ALTER TABLE approval_matrix_rules ALTER COLUMN approver_user_id DROP NOT NULL`);
  await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('temporary_labor_requisition', 'TLR', 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;

  // ---- Water Sales (Sept 2026) ----
  // NOTE: postgres.js sends each tagged-template query as a single prepared statement,
  // which rejects multiple semicolon-separated commands in one call ("cannot insert
  // multiple commands into a prepared statement") — especially over the pgbouncer
  // transaction-mode pooler used for the Test DB. Each CREATE TABLE must be its own call.
  await sql`
CREATE TABLE IF NOT EXISTS water_bucket_prices (
  id SERIAL PRIMARY KEY,
  size_litres REAL NOT NULL UNIQUE,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
)`;
  await sql`
CREATE TABLE IF NOT EXISTS water_sales (
  id SERIAL PRIMARY KEY,
  sale_number TEXT NOT NULL UNIQUE,
  sale_date TEXT NOT NULL,
  sale_type TEXT NOT NULL,
  bucket_size_litres REAL,
  bucket_count INTEGER,
  meter_start REAL,
  meter_end REAL,
  litres_sold REAL NOT NULL,
  unit_price REAL,
  rate_per_litre REAL,
  total_amount REAL NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  cancel_reason TEXT,
  credited_amount REAL NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
)`;
  await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('water_sale', 'WS', 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;
  // Approval-workflow additions: standalone purchase orders now go through the same
  // draft -> pending_approval -> approved/rejected flow as requisitions.
  await ensureColumn("purchase_orders", "rejected_reason", "TEXT");

  // Payment-gated booking confirmation: pending_payment status + override audit trail.
  await ensureColumn("accommodation_bookings", "overridden_by", "TEXT");
  await ensureColumn("accommodation_bookings", "overridden_at", "BIGINT");
  await ensureColumn("accommodation_bookings", "override_reason", "TEXT");
  await ensureColumn("facility_bookings", "overridden_by", "TEXT");
  await ensureColumn("facility_bookings", "overridden_at", "BIGINT");
  await ensureColumn("facility_bookings", "override_reason", "TEXT");

  // Attendance bulk-upload additions: fields captured by the Excel import that the
  // manual daily-entry screen doesn't need but the template/report expects.
  await ensureColumn("attendance_records", "shift_code", "TEXT");
  await ensureColumn("attendance_records", "overtime_hours", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("attendance_records", "leave_type_id", "INTEGER");

  // ---- Backfill public_token for any pre-existing rows created before that column existed ----
  // (each row needs its OWN random token, so this can't be a single UPDATE ... SET public_token = <one value>).
  async function backfillPublicTokens(table: string) {
    const rows = await sql.unsafe(`SELECT id FROM ${table} WHERE public_token IS NULL`);
    for (const row of rows as unknown as { id: number }[]) {
      const token = randomBytes(16).toString("hex");
      await sql.unsafe(`UPDATE ${table} SET public_token = $1 WHERE id = $2`, [token, row.id]);
    }
  }
  await backfillPublicTokens("documents");
  await backfillPublicTokens("maintenance_issues");

  // ---- Seed a default settings row (idempotent) ----
  async function seedSettings() {
    const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM settings`;
    if (c === 0) {
      await sql`INSERT INTO settings (hotel_name, hotel_address, hotel_phone, email_provider, invoices_enabled) VALUES ('The Chekata', 'Highway Hotel', '', '', 1)`;
    }
  }
  await seedSettings();

  // ---- Seed default Chart of Accounts, document sequences, and definition lists (idempotent) ----
  async function seedFinanceFoundations() {
    const [{ c: coaCount }] = await sql`SELECT COUNT(*)::int as c FROM chart_of_accounts`;
    if (coaCount === 0) {
      const now = Date.now();
      const defaults: { code: string; name: string; type: string }[] = [
        { code: "1000", name: "Cash on Hand", type: "asset" },
        { code: "1010", name: "Bank Account", type: "asset" },
        { code: "1200", name: "Accounts Receivable", type: "asset" },
        { code: "2000", name: "Accounts Payable", type: "liability" },
        { code: "2100", name: "VAT Payable", type: "liability" },
        { code: "3000", name: "Owner's Equity", type: "equity" },
        { code: "3900", name: "Retained Earnings", type: "equity" },
        { code: "4000", name: "Accommodation Revenue", type: "income" },
        { code: "4010", name: "Facilities & Conference Revenue", type: "income" },
        { code: "4020", name: "Movie Room Revenue", type: "income" },
        { code: "4030", name: "Bar & Restaurant Revenue", type: "income" },
        { code: "5000", name: "Staff Salaries & Wages", type: "expense" },
        { code: "5100", name: "Utilities Expense", type: "expense" },
        { code: "5200", name: "Maintenance & Repairs Expense", type: "expense" },
        { code: "5300", name: "General & Administrative Expense", type: "expense" },
        { code: "5400", name: "Bank Charges", type: "expense" },
      ];
      for (const acc of defaults) {
        await sql`INSERT INTO chart_of_accounts (code, name, type, active, is_system, created_at) VALUES (${acc.code}, ${acc.name}, ${acc.type}, 1, 1, ${now})`;
      }
    }

    const [{ c: seqCount }] = await sql`SELECT COUNT(*)::int as c FROM document_sequences`;
    if (seqCount === 0) {
      await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('journal_entry', 'JE', 1, 6)`;
      await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('payment_voucher', 'PV', 1, 6)`;
    }

    const [{ c: listCount }] = await sql`SELECT COUNT(*)::int as c FROM definition_lists`;
    if (listCount === 0) {
      const listDefs: { key: string; label: string; items: { code: string; label: string }[] }[] = [
        {
          key: "attendance_status",
          label: "Attendance Status",
          items: [
            { code: "present", label: "Present" },
            { code: "absent", label: "Absent" },
            { code: "leave", label: "Leave" },
            { code: "public_holiday", label: "Public Holiday" },
            { code: "rest_day", label: "Rest Day" },
          ],
        },
        {
          key: "shift_code",
          label: "Shift Code",
          items: [
            { code: "D", label: "Day" },
            { code: "N", label: "Night" },
            { code: "OFF", label: "Off Day" },
          ],
        },
        {
          key: "leave_type",
          label: "Leave Type",
          items: [
            { code: "annual_leave", label: "Annual Leave" },
            { code: "sick_leave", label: "Sick Leave" },
            { code: "compassionate_leave", label: "Compassionate Leave" },
            { code: "unpaid_leave", label: "Unpaid Leave" },
          ],
        },
      ];
      for (const list of listDefs) {
        const [{ id: listId }] = await sql`INSERT INTO definition_lists (list_key, label, is_system) VALUES (${list.key}, ${list.label}, 1) RETURNING id`;
        let sortOrder = 0;
        for (const item of list.items) {
          await sql`INSERT INTO definition_list_items (list_id, code, label, sort_order, active) VALUES (${listId}, ${item.code}, ${item.label}, ${sortOrder}, 1)`;
          sortOrder += 1;
        }
      }
    }
  }
  await seedFinanceFoundations();

  // ---- Seed Phase 2 (Inventory/Purchasing/Internal Requisitions) foundations ----
  // Per-row ON CONFLICT DO NOTHING rather than a whole-table count===0 gate, since
  // installs that already ran seedFinanceFoundations() must still pick up these new
  // chart-of-accounts/document-sequence/definition-list rows on upgrade.
  async function seedPhase2Foundations() {
    const now = Date.now();
    const coaDefaults: { code: string; name: string; type: string }[] = [
      { code: "1300", name: "Inventory - Stores", type: "asset" },
      { code: "5210", name: "Supplies & Consumables Expense", type: "expense" },
    ];
    for (const acc of coaDefaults) {
      await sql`INSERT INTO chart_of_accounts (code, name, type, active, is_system, created_at) VALUES (${acc.code}, ${acc.name}, ${acc.type}, 1, 1, ${now}) ON CONFLICT (code) DO NOTHING`;
    }

    const seqDefaults: { key: string; prefix: string }[] = [
      { key: "purchase_requisition", prefix: "PR" },
      { key: "purchase_order", prefix: "PO" },
      { key: "internal_requisition", prefix: "IR" },
      { key: "goods_receipt", prefix: "GRN" },
    ];
    for (const seq of seqDefaults) {
      await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES (${seq.key}, ${seq.prefix}, 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;
    }

    const listDefs: { key: string; label: string; items: { code: string; label: string }[] }[] = [
      {
        key: "inventory_category",
        label: "Inventory Category",
        items: [
          { code: "consumables", label: "Consumables" },
          { code: "spare_parts", label: "Spare Parts" },
          { code: "tools_equipment", label: "Tools & Equipment" },
          { code: "stationery", label: "Stationery" },
          { code: "cleaning_supplies", label: "Cleaning Supplies" },
        ],
      },
      {
        key: "unit_of_measure",
        label: "Unit of Measure",
        items: [
          { code: "pcs", label: "Pieces" },
          { code: "kg", label: "Kilograms" },
          { code: "litre", label: "Litres" },
          { code: "box", label: "Box" },
          { code: "carton", label: "Carton" },
          { code: "roll", label: "Roll" },
          { code: "set", label: "Set" },
        ],
      },
    ];
    for (const list of listDefs) {
      const existing = await sql`SELECT id FROM definition_lists WHERE list_key = ${list.key}`;
      let listId: number;
      if (existing.length === 0) {
        const [{ id }] = await sql`INSERT INTO definition_lists (list_key, label, is_system) VALUES (${list.key}, ${list.label}, 1) RETURNING id`;
        listId = id;
      } else {
        listId = (existing[0] as { id: number }).id;
      }
      const [{ c: itemCount }] = await sql`SELECT COUNT(*)::int as c FROM definition_list_items WHERE list_id = ${listId}`;
      if (itemCount === 0) {
        let sortOrder = 0;
        for (const item of list.items) {
          await sql`INSERT INTO definition_list_items (list_id, code, label, sort_order, active) VALUES (${listId}, ${item.code}, ${item.label}, ${sortOrder}, 1)`;
          sortOrder += 1;
        }
      }
    }
  }
  await seedPhase2Foundations();

  // ---- Phase 3: Tenants + F&B Costing foundational data (idempotent) ----
  async function seedPhase3Foundations() {
    const now = Date.now();
    const coaDefaults: { code: string; name: string; type: string }[] = [
      { code: "1210", name: "Tenant Rent Receivable", type: "asset" },
      { code: "4040", name: "Rental Income", type: "income" },
    ];
    for (const acc of coaDefaults) {
      await sql`INSERT INTO chart_of_accounts (code, name, type, active, is_system, created_at) VALUES (${acc.code}, ${acc.name}, ${acc.type}, 1, 1, ${now}) ON CONFLICT (code) DO NOTHING`;
    }
    await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('rent_invoice', 'RENT', 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;
  }
  await seedPhase3Foundations();

  // ---- Phase 4: HR & Payroll foundational data (idempotent) ----
  // Chart-of-accounts codes for payroll postings, the payroll_run document
  // sequence, statutory rate rows (Sept 2026 Kenyan rates — KRA/RSM/SmartHR/PayKenya,
  // see PHASE4_IMPLEMENTATION_PLAN.md for sources), default PAYE bands, and a
  // starter set of leave types. All editable afterwards from the Payroll/Leave screens.
  async function seedPhase4Foundations() {
    const now = Date.now();
    const coaDefaults: { code: string; name: string; type: string }[] = [
      { code: "5010", name: "Employer NSSF Contributions", type: "expense" },
      { code: "5020", name: "Employer Housing Levy Contributions", type: "expense" },
      { code: "2200", name: "PAYE Payable", type: "liability" },
      { code: "2210", name: "NSSF Payable", type: "liability" },
      { code: "2220", name: "SHIF Payable", type: "liability" },
      { code: "2230", name: "Housing Levy Payable", type: "liability" },
      { code: "2240", name: "Net Salaries Payable", type: "liability" },
    ];
    for (const acc of coaDefaults) {
      await sql`INSERT INTO chart_of_accounts (code, name, type, active, is_system, created_at) VALUES (${acc.code}, ${acc.name}, ${acc.type}, 1, 1, ${now}) ON CONFLICT (code) DO NOTHING`;
    }
    await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('payroll_run', 'PAY', 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;

    const [{ c: rateCount }] = await sql`SELECT COUNT(*)::int as c FROM statutory_rate_tables`;
    if (rateCount === 0) {
      const rates: { key: string; label: string; ratePercent: number; lowerLimit?: number; upperLimit?: number }[] = [
        { key: "nssf_employee", label: "NSSF — Employee (6%, capped)", ratePercent: 6, lowerLimit: 9000, upperLimit: 108000 },
        { key: "nssf_employer", label: "NSSF — Employer (6%, capped)", ratePercent: 6, lowerLimit: 9000, upperLimit: 108000 },
        { key: "shif_employee", label: "SHIF — Employee (2.75% of gross, no cap)", ratePercent: 2.75 },
        { key: "housing_levy_employee", label: "Affordable Housing Levy — Employee (1.5%)", ratePercent: 1.5 },
        { key: "housing_levy_employer", label: "Affordable Housing Levy — Employer (1.5%)", ratePercent: 1.5 },
      ];
      for (const r of rates) {
        await sql`INSERT INTO statutory_rate_tables (key, label, rate_percent, lower_limit, upper_limit, active, updated_at) VALUES (${r.key}, ${r.label}, ${r.ratePercent}, ${r.lowerLimit ?? null}, ${r.upperLimit ?? null}, 1, ${now}) ON CONFLICT (key) DO NOTHING`;
      }
    }

    const [{ c: bandCount }] = await sql`SELECT COUNT(*)::int as c FROM paye_bands`;
    if (bandCount === 0) {
      // Kenya PAYE bands per KRA (Finance Act 2023), confirmed current as of Aug 2026.
      const bands: { from: number; to: number | null; rate: number; order: number }[] = [
        { from: 0, to: 24000, rate: 10, order: 0 },
        { from: 24000, to: 32333, rate: 25, order: 1 },
        { from: 32333, to: 500000, rate: 30, order: 2 },
        { from: 500000, to: 800000, rate: 32.5, order: 3 },
        { from: 800000, to: null, rate: 35, order: 4 },
      ];
      for (const b of bands) {
        await sql`INSERT INTO paye_bands (band_from, band_to, rate_percent, sort_order) VALUES (${b.from}, ${b.to}, ${b.rate}, ${b.order})`;
      }
    }

    const [{ c: leaveTypeCount }] = await sql`SELECT COUNT(*)::int as c FROM leave_types`;
    if (leaveTypeCount === 0) {
      const types: { name: string; days: number; paid: number }[] = [
        { name: "Annual Leave", days: 21, paid: 1 },
        { name: "Sick Leave", days: 14, paid: 1 },
        { name: "Compassionate Leave", days: 3, paid: 1 },
        { name: "Unpaid Leave", days: 0, paid: 0 },
      ];
      for (const t of types) {
        await sql`INSERT INTO leave_types (name, entitlement_days_per_year, accrual_method, is_paid, active) VALUES (${t.name}, ${t.days}, 'annual', ${t.paid}, 1) ON CONFLICT (name) DO NOTHING`;
      }
    }
  }
  await seedPhase4Foundations();

  async function seedPhase5Foundations() {
    // Income streams for Budgeting: a fully admin-editable definition list
    // (System Administration → Definitions), not a hardcoded enum. Seeded
    // with a starter set that can be added to, renamed, or deactivated at
    // any time without a code change.
    let [incomeStreamList] = await sql<{ id: number }[]>`SELECT id FROM definition_lists WHERE list_key = 'income_stream'`;
    if (!incomeStreamList) {
      [incomeStreamList] = await sql<{ id: number }[]>`
        INSERT INTO definition_lists (list_key, label, description, is_system)
        VALUES ('income_stream', 'Income Streams', 'Revenue categories used for Budgeting (actual-vs-budget variance)', 1)
        RETURNING id`;
    }
    const [{ c: streamItemCount }] = await sql`SELECT COUNT(*)::int as c FROM definition_list_items WHERE list_id = ${incomeStreamList.id}`;
    if (streamItemCount === 0) {
      const streams: { code: string; label: string }[] = [
        { code: "accommodation", label: "Accommodation" },
        { code: "bar", label: "Bar" },
        { code: "restaurant", label: "Restaurant" },
        { code: "conference", label: "Conference" },
        { code: "special_events", label: "Special Events" },
        { code: "movie_seats", label: "Movie Seats" },
        { code: "shop_rentals", label: "Shop Rentals" },
        { code: "wifi_hotspot", label: "WiFi Hotspot" },
        { code: "water_sales", label: "Water Sales" },
        { code: "other", label: "Other" },
      ];
      for (let i = 0; i < streams.length; i++) {
        const s = streams[i];
        await sql`INSERT INTO definition_list_items (list_id, code, label, sort_order, active) VALUES (${incomeStreamList.id}, ${s.code}, ${s.label}, ${i}, 1)`;
      }
    }

    const [{ c: categoryCount }] = await sql`SELECT COUNT(*)::int as c FROM asset_categories`;
    if (categoryCount === 0) {
      const categories: { name: string; months: number }[] = [
        { name: "Vehicles", months: 60 },
        { name: "IT Equipment", months: 36 },
        { name: "CCTV", months: 60 },
        { name: "Furniture", months: 84 },
      ];
      for (const c of categories) {
        await sql`INSERT INTO asset_categories (name, default_useful_life_months, default_depreciation_method, active) VALUES (${c.name}, ${c.months}, 'straight_line', 1) ON CONFLICT (name) DO NOTHING`;
      }
    }
    await sql`INSERT INTO document_sequences (sequence_key, prefix, next_number, pad_length) VALUES ('asset', 'AST', 1, 6) ON CONFLICT (sequence_key) DO NOTHING`;

    const depreciationCoaDefaults: { code: string; name: string; type: string }[] = [
      { code: "6100", name: "Depreciation Expense", type: "expense" },
      { code: "1600", name: "Accumulated Depreciation", type: "asset" },
    ];
    for (const acc of depreciationCoaDefaults) {
      await sql`INSERT INTO chart_of_accounts (code, name, type, active, is_system, created_at) VALUES (${acc.code}, ${acc.name}, ${acc.type}, 1, 1, ${Date.now()}) ON CONFLICT (code) DO NOTHING`;
    }
  }
  await seedPhase5Foundations();

  // ---- Seed default rooms & facilities to match The Chekata's layout (idempotent) ----
  async function seed() {
    const [{ c: roomCount }] = await sql`SELECT COUNT(*)::int as c FROM rooms`;
    if (roomCount === 0) {
      for (let i = 1; i <= 8; i++) {
        await sql`INSERT INTO rooms (name, type, rate, status) VALUES (${`Standard ${i}`}, 'standard', 4500, 'available')`;
      }
      for (let i = 1; i <= 2; i++) {
        await sql`INSERT INTO rooms (name, type, rate, status) VALUES (${`Executive ${i}`}, 'executive', 9000, 'available')`;
      }
    }
    const [{ c: facilityCount }] = await sql`SELECT COUNT(*)::int as c FROM facilities`;
    if (facilityCount === 0) {
      await sql`INSERT INTO facilities (name, rate_type, rate, capacity, active) VALUES ('Conference Hall', 'daily', 25000, 80, 1)`;
      await sql`INSERT INTO facilities (name, rate_type, rate, capacity, active) VALUES ('Movie Room', 'hourly', 1500, 30, 1)`;
    }
  }
  await seed();

  // ---- Seed a default administrator if the users table is empty (idempotent) ----
  // This guarantees the app is always reachable after a fresh database (e.g. a
  // clean deploy, or a fresh Postgres database) instead of locking everyone out.
  async function seedDefaultAdmin() {
    const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM users`;
    if (c === 0) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
      const hash = bcrypt.hashSync(defaultPassword, 10);
      const allPermissions = JSON.stringify(MODULE_KEYS);
      await sql`INSERT INTO users (username, password_hash, full_name, is_admin, permissions, can_edit_movie_bookings, can_manage_tables_list, can_manage_menu_items_list, can_close_maintenance_issues, can_adjust_inventory, active, created_at) VALUES ('admin', ${hash}, 'Administrator', 1, ${allPermissions}, 1, 1, 1, 1, 1, 1, ${Date.now()})`;
      console.log(
        `[storage] No users found — created default administrator (username: admin, password: ${defaultPassword}). Change this password after first login.`,
      );
    }
  }
  await seedDefaultAdmin();
}

export const schemaReady = (async () => {
  await bootstrapSchema(liveSql);
  if (testSql) {
    try {
      await bootstrapSchema(testSql);
    } catch (err) {
      // Non-fatal: Test is a bonus environment. A broken/unreachable Test
      // database must never take Live down at startup.
      console.error("[storage] Failed to bootstrap the TEST database schema (Test environment may be unavailable):", err);
    }
  }
})().catch((err) => {
  console.error("[storage] Failed to bootstrap schema:", err);
  throw err;
});

// Minimal identity shape the approval-matrix identity guard needs from the acting user.
export interface ApprovalActor { id: number; isAdmin: number; }

export interface IStorage {
  // Rooms
  listRooms(): Promise<Room[]>;
  getRoom(id: number): Promise<Room | undefined>;
  createRoom(data: InsertRoom): Promise<Room>;
  updateRoom(id: number, data: Partial<InsertRoom>): Promise<Room | undefined>;
  deleteRoom(id: number): Promise<{ changes: number }>;

  // Accommodation bookings
  listAccommodationBookings(): Promise<AccommodationBooking[]>;
  getAccommodationBooking(id: number): Promise<AccommodationBooking | undefined>;
  createAccommodationBooking(data: InsertAccommodationBooking): Promise<AccommodationBooking>;
  updateAccommodationBooking(id: number, data: Partial<InsertAccommodationBooking>): Promise<AccommodationBooking | undefined>;
  deleteAccommodationBooking(id: number): Promise<{ changes: number }>;

  // Facilities
  listFacilities(): Promise<Facility[]>;
  getFacility(id: number): Promise<Facility | undefined>;
  createFacility(data: InsertFacility): Promise<Facility>;
  updateFacility(id: number, data: Partial<InsertFacility>): Promise<Facility | undefined>;
  deleteFacility(id: number): Promise<{ changes: number }>;

  // Facility bookings
  listFacilityBookings(): Promise<FacilityBooking[]>;
  getFacilityBooking(id: number): Promise<FacilityBooking | undefined>;
  createFacilityBooking(data: InsertFacilityBooking): Promise<FacilityBooking>;
  updateFacilityBooking(id: number, data: Partial<InsertFacilityBooking>): Promise<FacilityBooking | undefined>;
  deleteFacilityBooking(id: number): Promise<{ changes: number }>;

  // Movie shows
  listMovieShows(): Promise<MovieShow[]>;
  getMovieShow(id: number): Promise<MovieShow | undefined>;
  createMovieShow(data: InsertMovieShow): Promise<MovieShow>;
  updateMovieShow(id: number, data: Partial<InsertMovieShow>): Promise<MovieShow | undefined>;
  deleteMovieShow(id: number): Promise<{ changes: number }>;

  // Movie seat bookings
  listMovieSeatBookings(): Promise<MovieSeatBooking[]>;
  getMovieSeatBooking(id: number): Promise<MovieSeatBooking | undefined>;
  listMovieSeatBookingsByRef(bookingRef: string): Promise<MovieSeatBooking[]>;
  createMovieSeatBooking(data: InsertMovieSeatBooking): Promise<MovieSeatBooking>;
  updateMovieSeatBooking(id: number, data: Partial<InsertMovieSeatBooking>): Promise<MovieSeatBooking | undefined>;
  deleteMovieSeatBooking(id: number): Promise<{ changes: number }>;

  // Menu items
  listMenuItems(): Promise<MenuItem[]>;
  createMenuItem(data: InsertMenuItem): Promise<MenuItem>;
  updateMenuItem(id: number, data: Partial<InsertMenuItem>): Promise<MenuItem | undefined>;
  deleteMenuItem(id: number): Promise<{ changes: number }>;

  // Orders + items
  listOrders(): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  createOrder(data: InsertOrder): Promise<Order>;
  updateOrder(id: number, data: Partial<InsertOrder>): Promise<Order | undefined>;
  deleteOrder(id: number): Promise<{ changes: number }>;
  listOrderItems(orderId: number): Promise<OrderItem[]>;
  getOrderItem(id: number): Promise<OrderItem | undefined>;
  createOrderItem(data: InsertOrderItem): Promise<OrderItem>;
  deleteOrderItem(id: number): Promise<{ changes: number }>;

  // Staff
  listStaff(): Promise<Staff[]>;
  getStaff(id: number): Promise<Staff | undefined>;
  createStaff(data: InsertStaff): Promise<Staff>;
  updateStaff(id: number, data: Partial<InsertStaff>): Promise<Staff | undefined>;
  deleteStaff(id: number): Promise<{ changes: number }>;

  // Attendance (Phase 4)
  listAttendanceRecords(filters?: { staffId?: number; from?: string; to?: string }): Promise<AttendanceRecord[]>;
  upsertAttendanceRecord(data: InsertAttendanceRecord): Promise<AttendanceRecord>;
  deleteAttendanceRecord(id: number): Promise<{ changes: number }>;

  // Leave (Phase 4)
  listLeaveTypes(): Promise<LeaveType[]>;
  createLeaveType(data: InsertLeaveType): Promise<LeaveType>;
  updateLeaveType(id: number, data: Partial<InsertLeaveType>): Promise<LeaveType | undefined>;
  deleteLeaveType(id: number): Promise<{ changes: number }>;
  listLeaveRequests(staffId?: number): Promise<LeaveRequest[]>;
  getLeaveRequest(id: number): Promise<LeaveRequest | undefined>;
  createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest>;
  reviewLeaveRequest(id: number, actor: ApprovalActor, reviewedBy: string): Promise<LeaveRequest | undefined>;
  decideLeaveRequest(id: number, actor: ApprovalActor, status: "approved" | "rejected", decidedBy: string, reason?: string): Promise<LeaveRequest | undefined>;
  cancelLeaveRequest(id: number, reason: string): Promise<LeaveRequest | undefined>;
  listLeaveBalances(staffId?: number, year?: number): Promise<LeaveBalance[]>;
  upsertLeaveBalance(data: InsertLeaveBalance): Promise<LeaveBalance>;

  // Payroll (Phase 4)
  listStatutoryRates(): Promise<StatutoryRateTable[]>;
  updateStatutoryRate(id: number, data: Partial<InsertStatutoryRateTable>): Promise<StatutoryRateTable | undefined>;
  listPayeBands(): Promise<PayeBand[]>;
  createPayeBand(data: InsertPayeBand): Promise<PayeBand>;
  updatePayeBand(id: number, data: Partial<InsertPayeBand>): Promise<PayeBand | undefined>;
  deletePayeBand(id: number): Promise<{ changes: number }>;
  listPayrollRuns(): Promise<PayrollRun[]>;
  getPayrollRun(id: number): Promise<PayrollRun | undefined>;
  listPayrollLines(payrollRunId: number): Promise<PayrollLine[]>;
  createPayrollRun(periodMonth: string, periodStart: string, periodEnd: string, createdBy: string): Promise<PayrollRun>;
  approvePayrollRun(id: number, approvedBy: string): Promise<PayrollRun>;
  cancelPayrollRun(id: number, reason: string): Promise<PayrollRun | undefined>;
  setPayslipEmailStatus(lineId: number, status: string, error?: string): Promise<void>;

  // Expenses
  listExpenses(): Promise<Expense[]>;
  createExpense(data: InsertExpense): Promise<Expense>;
  updateExpense(id: number, data: Partial<InsertExpense>): Promise<Expense | undefined>;
  deleteExpense(id: number): Promise<{ changes: number }>;

  // Settings (singleton)
  getSettings(): Promise<Settings>;
  updateSettings(data: Partial<InsertSettings>): Promise<Settings>;

  // Documents (invoice/receipt log)
  listDocuments(): Promise<DocumentRecord[]>;
  getDocument(id: number): Promise<DocumentRecord | undefined>;
  createDocument(data: InsertDocument): Promise<DocumentRecord>;
  getLatestDocumentBySource(category: string, sourceId: number): Promise<DocumentRecord | undefined>;
  getBillingDocumentBySource(category: string, sourceId: number): Promise<DocumentRecord | undefined>;

  // Users (auth + module access)
  listUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  countUsers(): Promise<number>;
  createUser(data: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<{ changes: number }>;
  createPasswordResetToken(data: InsertPasswordResetToken): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(token: string): Promise<void>;

  // Taxes
  listTaxes(): Promise<Tax[]>;
  getTax(id: number): Promise<Tax | undefined>;
  createTax(data: InsertTax): Promise<Tax>;
  updateTax(id: number, data: Partial<InsertTax>): Promise<Tax | undefined>;
  deleteTax(id: number): Promise<{ changes: number }>;

  // Tables (Lists module)
  listTables(): Promise<TableRow[]>;
  createTable(data: InsertTableRow): Promise<TableRow>;
  updateTable(id: number, data: Partial<InsertTableRow>): Promise<TableRow | undefined>;
  deleteTable(id: number): Promise<{ changes: number }>;

  // Maintenance issues
  listMaintenanceIssues(): Promise<MaintenanceIssue[]>;
  getMaintenanceIssue(id: number): Promise<MaintenanceIssue | undefined>;
  createMaintenanceIssue(data: InsertMaintenanceIssue): Promise<MaintenanceIssue>;
  updateMaintenanceIssue(id: number, data: Partial<InsertMaintenanceIssue>): Promise<MaintenanceIssue | undefined>;
  deleteMaintenanceIssue(id: number): Promise<{ changes: number }>;

  // Finance: Chart of Accounts
  listChartOfAccounts(): Promise<ChartOfAccount[]>;
  getChartOfAccount(id: number): Promise<ChartOfAccount | undefined>;
  createChartOfAccount(data: InsertChartOfAccount): Promise<ChartOfAccount>;
  updateChartOfAccount(id: number, data: Partial<InsertChartOfAccount>): Promise<ChartOfAccount | undefined>;
  deleteChartOfAccount(id: number): Promise<{ changes: number }>;

  // Finance: Accounting Periods
  listAccountingPeriods(): Promise<AccountingPeriod[]>;
  getAccountingPeriod(id: number): Promise<AccountingPeriod | undefined>;
  createAccountingPeriod(data: InsertAccountingPeriod): Promise<AccountingPeriod>;
  updateAccountingPeriod(id: number, data: Partial<InsertAccountingPeriod>): Promise<AccountingPeriod | undefined>;
  deleteAccountingPeriod(id: number): Promise<{ changes: number }>;
  findOpenPeriodForDate(dateStr: string): Promise<AccountingPeriod | undefined>;

  // Finance: Journal Entries
  listJournalEntries(): Promise<JournalEntry[]>;
  getJournalEntry(id: number): Promise<JournalEntry | undefined>;
  listJournalEntryLines(journalEntryId: number): Promise<JournalEntryLine[]>;
  postJournalEntry(entry: Omit<InsertJournalEntry, "entryNumber">, lines: Omit<InsertJournalEntryLine, "journalEntryId">[]): Promise<JournalEntry>;
  cancelJournalEntry(id: number, cancelledBy: string, reason: string): Promise<JournalEntry | undefined>;

  // Finance: Bank Accounts
  listBankAccounts(): Promise<BankAccount[]>;
  getBankAccount(id: number): Promise<BankAccount | undefined>;
  createBankAccount(data: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(id: number, data: Partial<InsertBankAccount>): Promise<BankAccount | undefined>;
  deleteBankAccount(id: number): Promise<{ changes: number }>;

  // Finance: Bank Reconciliations
  listBankReconciliations(): Promise<BankReconciliation[]>;
  createBankReconciliation(data: InsertBankReconciliation): Promise<BankReconciliation>;
  updateBankReconciliation(id: number, data: Partial<InsertBankReconciliation>): Promise<BankReconciliation | undefined>;

  // Finance: Payment Vouchers
  listPaymentVouchers(): Promise<PaymentVoucher[]>;
  getPaymentVoucher(id: number): Promise<PaymentVoucher | undefined>;
  createPaymentVoucher(data: Omit<InsertPaymentVoucher, "voucherNumber">): Promise<PaymentVoucher>;
  updatePaymentVoucher(id: number, data: Partial<InsertPaymentVoucher>): Promise<PaymentVoucher | undefined>;
  postPaymentVoucher(id: number, approvedBy: string): Promise<PaymentVoucher | undefined>;
  cancelPaymentVoucher(id: number, reason: string): Promise<PaymentVoucher | undefined>;

  // System Administration: Approval Matrix
  listApprovalMatrixRules(): Promise<ApprovalMatrixRule[]>;
  getApprovalMatrixRule(id: number): Promise<ApprovalMatrixRule | undefined>;
  createApprovalMatrixRule(data: InsertApprovalMatrixRule): Promise<ApprovalMatrixRule>;
  updateApprovalMatrixRule(id: number, data: Partial<InsertApprovalMatrixRule>): Promise<ApprovalMatrixRule | undefined>;
  deleteApprovalMatrixRule(id: number): Promise<{ changes: number }>;
  resolveApprovalRuleByAmount(documentType: string, amount: number): Promise<ApprovalMatrixRule | undefined>;
  resolveApprovalRuleByCategory(documentType: string, category: string | null): Promise<ApprovalMatrixRule | undefined>;

  // System Administration: Table-level permissions
  listPermissionTableRules(): Promise<PermissionTableRule[]>;
  listPermissionTableRulesForUser(userId: number): Promise<PermissionTableRule[]>;
  setPermissionTableRule(userId: number, tableKey: string, canWrite: boolean): Promise<PermissionTableRule>;

  // System Administration: Definitions
  listDefinitionLists(): Promise<DefinitionList[]>;
  getDefinitionListByKey(listKey: string): Promise<DefinitionList | undefined>;
  createDefinitionList(data: InsertDefinitionList): Promise<DefinitionList>;
  updateDefinitionList(id: number, data: { label?: string; description?: string | null }): Promise<DefinitionList | undefined>;
  deleteDefinitionList(id: number): Promise<{ changes: number }>;
  listDefinitionListItems(listId: number): Promise<DefinitionListItem[]>;
  createDefinitionListItem(data: InsertDefinitionListItem): Promise<DefinitionListItem>;
  updateDefinitionListItem(id: number, data: Partial<InsertDefinitionListItem>): Promise<DefinitionListItem | undefined>;
  deleteDefinitionListItem(id: number): Promise<{ changes: number }>;

  // Generic document sequence numbering (reused across modules)
  getNextSequenceNumber(sequenceKey: string): Promise<string>;

  // Finance reports
  getTrialBalance(asOfDate?: string): Promise<any[]>;
  getProfitAndLoss(from?: string, to?: string): Promise<any>;
  getBalanceSheet(asOfDate?: string): Promise<any>;

  // ---------------- Phase 2: Inventory ----------------
  listStores(): Promise<Store[]>;
  getStore(id: number): Promise<Store | undefined>;
  createStore(data: InsertStore): Promise<Store>;
  updateStore(id: number, data: Partial<InsertStore>): Promise<Store | undefined>;
  deleteStore(id: number): Promise<{ changes: number }>;

  listInventoryItems(): Promise<InventoryItem[]>;
  getInventoryItem(id: number): Promise<InventoryItem | undefined>;
  createInventoryItem(data: InsertInventoryItem): Promise<InventoryItem>;
  updateInventoryItem(id: number, data: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined>;
  deleteInventoryItem(id: number): Promise<{ changes: number }>;

  listStockLedger(filter?: { itemId?: number; storeId?: number }): Promise<StockLedgerEntry[]>;
  getStockBalance(itemId: number, storeId: number): Promise<number>;
  getStockBalancesByItem(): Promise<{ itemId: number; storeId: number; balance: number }[]>;
  createStockAdjustment(data: { itemId: number; storeId: number; direction: "in" | "out"; quantity: number; notes?: string; createdBy: string }): Promise<StockLedgerEntry>;

  // ---------------- Phase 2: Purchasing ----------------
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: number): Promise<Supplier | undefined>;
  createSupplier(data: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, data: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: number): Promise<{ changes: number }>;

  listPurchaseRequisitions(): Promise<PurchaseRequisition[]>;
  getPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined>;
  getPurchaseRequisitionLines(requisitionId: number): Promise<PurchaseRequisitionLine[]>;
  createPurchaseRequisition(data: Omit<InsertPurchaseRequisition, "prNumber">, lines: Omit<InsertPurchaseRequisitionLine, "requisitionId">[]): Promise<PurchaseRequisition>;
  updatePurchaseRequisition(id: number, data: Partial<InsertPurchaseRequisition>, lines?: Omit<InsertPurchaseRequisitionLine, "requisitionId">[]): Promise<PurchaseRequisition | undefined>;
  submitPurchaseRequisition(id: number): Promise<PurchaseRequisition | undefined>;
  reviewPurchaseRequisition(id: number, actor: ApprovalActor, reviewedBy: string): Promise<PurchaseRequisition | undefined>;
  approvePurchaseRequisition(id: number, actor: ApprovalActor, approvedBy: string, poDetails: { supplierId: number; payableAccountId: number; expenseAccountId?: number | null }): Promise<{ requisition: PurchaseRequisition; purchaseOrder: PurchaseOrder }>;
  rejectPurchaseRequisition(id: number, actor: ApprovalActor, reason: string): Promise<PurchaseRequisition | undefined>;
  cancelPurchaseRequisition(id: number, reason: string): Promise<PurchaseRequisition | undefined>;

  listPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined>;
  getPurchaseOrderLines(poId: number): Promise<PurchaseOrderLine[]>;
  createPurchaseOrder(data: Omit<InsertPurchaseOrder, "poNumber">, lines: Omit<InsertPurchaseOrderLine, "poId">[]): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: number, data: Partial<InsertPurchaseOrder>, lines?: Omit<InsertPurchaseOrderLine, "poId">[]): Promise<PurchaseOrder | undefined>;
  submitPurchaseOrder(id: number): Promise<PurchaseOrder | undefined>;
  reviewPurchaseOrder(id: number, actor: ApprovalActor, reviewedBy: string): Promise<PurchaseOrder | undefined>;
  approvePurchaseOrder(id: number, actor: ApprovalActor, approvedBy: string): Promise<PurchaseOrder | undefined>;
  rejectPurchaseOrder(id: number, actor: ApprovalActor, reason: string): Promise<PurchaseOrder | undefined>;
  cancelPurchaseOrder(id: number, reason: string): Promise<PurchaseOrder | undefined>;
  receiveGoods(poId: number, data: { storeId: number; receivedBy: string; lines: { poLineId: number; quantityReceived: number; unitCost: number }[]; notes?: string }): Promise<GoodsReceipt>;
  receivePurchaseOrderDirect(poId: number, receivedBy: string): Promise<PurchaseOrder | undefined>;

  listGoodsReceipts(): Promise<GoodsReceipt[]>;
  getGoodsReceipt(id: number): Promise<GoodsReceipt | undefined>;
  getGoodsReceiptLines(grnId: number): Promise<GoodsReceiptLine[]>;

  // ---------------- Phase 2: Internal Requisitions ----------------
  listInternalRequisitions(): Promise<InternalRequisition[]>;
  getInternalRequisition(id: number): Promise<InternalRequisition | undefined>;
  getInternalRequisitionLines(requisitionId: number): Promise<InternalRequisitionLine[]>;
  createInternalRequisition(data: Omit<InsertInternalRequisition, "irNumber">, lines: Omit<InsertInternalRequisitionLine, "requisitionId">[]): Promise<InternalRequisition>;
  updateInternalRequisition(id: number, data: Partial<InsertInternalRequisition>, lines?: Omit<InsertInternalRequisitionLine, "requisitionId">[]): Promise<InternalRequisition | undefined>;
  submitInternalRequisition(id: number): Promise<InternalRequisition | undefined>;
  reviewInternalRequisition(id: number, actor: ApprovalActor, reviewedBy: string): Promise<InternalRequisition | undefined>;
  approveInternalRequisition(id: number, actor: ApprovalActor, approvedBy: string): Promise<InternalRequisition | undefined>;
  rejectInternalRequisition(id: number, actor: ApprovalActor, reason: string): Promise<InternalRequisition | undefined>;
  issueInternalRequisition(id: number, issuedBy: string): Promise<InternalRequisition | undefined>;
  returnLoanItem(lineId: number, data: { quantityReturned: number; returnedBy: string; condition?: string; notes?: string }): Promise<LoanReturn>;
  cancelInternalRequisition(id: number, reason: string): Promise<InternalRequisition | undefined>;
  listTemporaryLaborRequisitions(): Promise<TemporaryLaborRequisition[]>;
  getTemporaryLaborRequisition(id: number): Promise<TemporaryLaborRequisition | undefined>;
  getTemporaryLaborRequisitionLines(requisitionId: number): Promise<TemporaryLaborRequisitionLine[]>;
  createTemporaryLaborRequisition(data: Omit<InsertTemporaryLaborRequisition, "tlrNumber">, lines: Omit<InsertTemporaryLaborRequisitionLine, "requisitionId">[]): Promise<TemporaryLaborRequisition>;
  updateTemporaryLaborRequisition(id: number, data: Partial<InsertTemporaryLaborRequisition>, lines?: Omit<InsertTemporaryLaborRequisitionLine, "requisitionId">[]): Promise<TemporaryLaborRequisition | undefined>;
  submitTemporaryLaborRequisition(id: number): Promise<TemporaryLaborRequisition | undefined>;
  reviewTemporaryLaborRequisition(id: number, actor: ApprovalActor, reviewedBy: string): Promise<TemporaryLaborRequisition | undefined>;
  approveTemporaryLaborRequisition(id: number, actor: ApprovalActor, approvedBy: string): Promise<{ requisition: TemporaryLaborRequisition; placeholderStaff: Staff[] }>;
  rejectTemporaryLaborRequisition(id: number, actor: ApprovalActor, reason: string): Promise<TemporaryLaborRequisition | undefined>;
  cancelTemporaryLaborRequisition(id: number, reason: string): Promise<TemporaryLaborRequisition | undefined>;

  // ================= Phase 3: Accommodation ID capture =================
  listGuestIdentityDocuments(bookingId: number): Promise<GuestIdentityDocument[]>;
  createGuestIdentityDocument(data: Omit<InsertGuestIdentityDocument, "createdAt">): Promise<GuestIdentityDocument>;

  // ================= Phase 3: Tenants =================
  listShops(): Promise<Shop[]>;
  getShop(id: number): Promise<Shop | undefined>;
  createShop(data: Omit<InsertShop, "createdAt">): Promise<Shop>;
  updateShop(id: number, data: Partial<InsertShop>): Promise<Shop | undefined>;
  deleteShop(id: number): Promise<{ changes: number }>;

  listTenants(): Promise<Tenant[]>;
  getTenant(id: number): Promise<Tenant | undefined>;
  createTenant(data: Omit<InsertTenant, "createdAt">): Promise<Tenant>;
  updateTenant(id: number, data: Partial<InsertTenant>): Promise<Tenant | undefined>;
  deleteTenant(id: number): Promise<{ changes: number }>;

  listTenancyLeases(): Promise<TenancyLease[]>;
  getTenancyLease(id: number): Promise<TenancyLease | undefined>;
  createTenancyLease(data: Omit<InsertTenancyLease, "createdAt">): Promise<TenancyLease>;
  updateTenancyLease(id: number, data: Partial<InsertTenancyLease>): Promise<TenancyLease | undefined>;
  endTenancyLease(id: number): Promise<TenancyLease | undefined>;

  listMeterReadings(leaseId?: number): Promise<MeterReading[]>;
  createMeterReading(data: Omit<InsertMeterReading, "consumption" | "amount" | "createdAt">): Promise<MeterReading>;

  listRentInvoices(leaseId?: number): Promise<RentInvoice[]>;
  getRentInvoice(id: number): Promise<RentInvoice | undefined>;
  getRentInvoiceForPeriod(leaseId: number, periodMonth: string): Promise<RentInvoice | undefined>;
  createRentInvoiceForPeriod(leaseId: number, periodMonth: string, createdBy: string): Promise<RentInvoice>;
  recordRentInvoicePayment(invoiceId: number, data: { amount: number; bankAccountId: number; paymentMethod?: string; paymentReference?: string; recordedBy: string }): Promise<RentInvoicePayment>;
  listRentInvoicePayments(invoiceId: number): Promise<RentInvoicePayment[]>;
  cancelRentInvoice(id: number, reason: string): Promise<RentInvoice | undefined>;
  markRentInvoiceReminderSent(id: number): Promise<void>;
  listUnpaidRentInvoicesDueForReminder(): Promise<(RentInvoice & { tenantEmail: string | null; tenantPhone: string | null; tenantName: string })[]>;

  // ================= Phase 3: F&B Costing =================
  listRecipes(): Promise<Recipe[]>;
  getRecipe(id: number): Promise<Recipe | undefined>;
  getRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]>;
  createRecipe(data: Omit<InsertRecipe, "createdAt">, ingredients: Omit<InsertRecipeIngredient, "recipeId">[]): Promise<Recipe>;
  updateRecipe(id: number, data: Partial<InsertRecipe>, ingredients?: Omit<InsertRecipeIngredient, "recipeId">[]): Promise<Recipe | undefined>;
  deleteRecipe(id: number): Promise<{ changes: number }>;

  // ================= Phase 5: Budgeting =================
  listBudgetLines(filters?: { from?: string; to?: string }): Promise<BudgetLine[]>;
  upsertBudgetLine(data: InsertBudgetLine): Promise<BudgetLine>;
  deleteBudgetLine(id: number): Promise<{ changes: number }>;
  getBudgetVariance(from: string, to: string): Promise<{ month: string; incomeStreamCode: string; incomeStreamLabel: string; budgetedAmount: number; actualAmount: number; variance: number }[]>;

  // ================= Phase 5: Assets =================
  listAssetCategories(): Promise<AssetCategory[]>;
  getAssetCategory(id: number): Promise<AssetCategory | undefined>;
  createAssetCategory(data: InsertAssetCategory): Promise<AssetCategory>;
  updateAssetCategory(id: number, data: Partial<InsertAssetCategory>): Promise<AssetCategory | undefined>;
  deleteAssetCategory(id: number): Promise<{ changes: number }>;

  listAssets(filters?: { status?: string; categoryId?: number }): Promise<Asset[]>;
  getAsset(id: number): Promise<Asset | undefined>;
  createAsset(data: Omit<InsertAsset, "assetNumber" | "createdAt">): Promise<Asset>;
  updateAsset(id: number, data: Partial<InsertAsset>): Promise<Asset | undefined>;
  disposeAsset(id: number, data: { disposalValue: number; disposalNotes?: string }): Promise<Asset | undefined>;
  deleteAsset(id: number): Promise<{ changes: number }>;

  listAssetDepreciationSchedules(assetId?: number): Promise<AssetDepreciationSchedule[]>;
  runDepreciationForPeriod(periodMonth: string, createdBy: string): Promise<{ journalEntryId: number | null; scheduleRows: AssetDepreciationSchedule[]; totalDepreciation: number }>;

  // Water Sales
  listWaterBucketPrices(): Promise<WaterBucketPrice[]>;
  createWaterBucketPrice(data: InsertWaterBucketPrice): Promise<WaterBucketPrice>;
  updateWaterBucketPrice(id: number, data: Partial<InsertWaterBucketPrice>): Promise<WaterBucketPrice | undefined>;
  deleteWaterBucketPrice(id: number): Promise<{ changes: number }>;

  listWaterSales(filters?: { from?: string; to?: string }): Promise<WaterSale[]>;
  getWaterSale(id: number): Promise<WaterSale | undefined>;
  createWaterSale(data: InsertWaterSale, createdBy: string): Promise<WaterSale>;
  cancelWaterSale(id: number, reason: string): Promise<WaterSale | undefined>;
  creditWaterSale(id: number, amount: number): Promise<WaterSale | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Rooms
  async listRooms() {
    return db.select().from(rooms);
  }
  async getRoom(id: number) {
    return (await db.select().from(rooms).where(eq(rooms.id, id)))[0];
  }
  async createRoom(data: InsertRoom) {
    return (await db.insert(rooms).values(data).returning())[0];
  }
  async updateRoom(id: number, data: Partial<InsertRoom>) {
    return (await db.update(rooms).set(data).where(eq(rooms.id, id)).returning())[0];
  }
  async deleteRoom(id: number) {
    const result = await db.delete(rooms).where(eq(rooms.id, id));
    return { changes: result.count ?? 0 };
  }

  // Accommodation bookings
  async listAccommodationBookings() {
    return db.select().from(accommodationBookings);
  }
  async getAccommodationBooking(id: number) {
    return (await db.select().from(accommodationBookings).where(eq(accommodationBookings.id, id)))[0];
  }
  async createAccommodationBooking(data: InsertAccommodationBooking) {
    return (await db.insert(accommodationBookings).values(data).returning())[0];
  }
  async updateAccommodationBooking(id: number, data: Partial<InsertAccommodationBooking>) {
    return (await db.update(accommodationBookings).set(data).where(eq(accommodationBookings.id, id)).returning())[0];
  }
  async deleteAccommodationBooking(id: number) {
    const result = await db.delete(accommodationBookings).where(eq(accommodationBookings.id, id));
    return { changes: result.count ?? 0 };
  }

  // Facilities
  async listFacilities() {
    return db.select().from(facilities);
  }
  async getFacility(id: number) {
    return (await db.select().from(facilities).where(eq(facilities.id, id)))[0];
  }
  async createFacility(data: InsertFacility) {
    return (await db.insert(facilities).values(data).returning())[0];
  }
  async updateFacility(id: number, data: Partial<InsertFacility>) {
    return (await db.update(facilities).set(data).where(eq(facilities.id, id)).returning())[0];
  }
  async deleteFacility(id: number) {
    const result = await db.delete(facilities).where(eq(facilities.id, id));
    return { changes: result.count ?? 0 };
  }

  // Facility bookings
  async listFacilityBookings() {
    return db.select().from(facilityBookings);
  }
  async getFacilityBooking(id: number) {
    return (await db.select().from(facilityBookings).where(eq(facilityBookings.id, id)))[0];
  }
  async createFacilityBooking(data: InsertFacilityBooking) {
    return (await db.insert(facilityBookings).values(data).returning())[0];
  }
  async updateFacilityBooking(id: number, data: Partial<InsertFacilityBooking>) {
    return (await db.update(facilityBookings).set(data).where(eq(facilityBookings.id, id)).returning())[0];
  }
  async deleteFacilityBooking(id: number) {
    const result = await db.delete(facilityBookings).where(eq(facilityBookings.id, id));
    return { changes: result.count ?? 0 };
  }

  // Movie shows
  async listMovieShows() {
    return db.select().from(movieShows);
  }
  async getMovieShow(id: number) {
    return (await db.select().from(movieShows).where(eq(movieShows.id, id)))[0];
  }
  async createMovieShow(data: InsertMovieShow) {
    return (await db.insert(movieShows).values(data).returning())[0];
  }
  async updateMovieShow(id: number, data: Partial<InsertMovieShow>) {
    return (await db.update(movieShows).set(data).where(eq(movieShows.id, id)).returning())[0];
  }
  async deleteMovieShow(id: number) {
    const result = await db.delete(movieShows).where(eq(movieShows.id, id));
    return { changes: result.count ?? 0 };
  }

  // Movie seat bookings
  async listMovieSeatBookings() {
    return db.select().from(movieSeatBookings);
  }
  async getMovieSeatBooking(id: number) {
    return (await db.select().from(movieSeatBookings).where(eq(movieSeatBookings.id, id)))[0];
  }
  async listMovieSeatBookingsByRef(bookingRef: string) {
    return db.select().from(movieSeatBookings).where(eq(movieSeatBookings.bookingRef, bookingRef));
  }
  async createMovieSeatBooking(data: InsertMovieSeatBooking) {
    return (await db.insert(movieSeatBookings).values(data).returning())[0];
  }
  async updateMovieSeatBooking(id: number, data: Partial<InsertMovieSeatBooking>) {
    return (await db.update(movieSeatBookings).set(data).where(eq(movieSeatBookings.id, id)).returning())[0];
  }
  async deleteMovieSeatBooking(id: number) {
    const result = await db.delete(movieSeatBookings).where(eq(movieSeatBookings.id, id));
    return { changes: result.count ?? 0 };
  }

  // Menu items
  async listMenuItems() {
    return db.select().from(menuItems);
  }
  async createMenuItem(data: InsertMenuItem) {
    return (await db.insert(menuItems).values(data).returning())[0];
  }
  async updateMenuItem(id: number, data: Partial<InsertMenuItem>) {
    return (await db.update(menuItems).set(data).where(eq(menuItems.id, id)).returning())[0];
  }
  async deleteMenuItem(id: number) {
    const result = await db.delete(menuItems).where(eq(menuItems.id, id));
    return { changes: result.count ?? 0 };
  }

  // Orders
  async listOrders() {
    return db.select().from(orders);
  }
  async getOrder(id: number) {
    return (await db.select().from(orders).where(eq(orders.id, id)))[0];
  }
  async createOrder(data: InsertOrder) {
    return (await db.insert(orders).values(data).returning())[0];
  }
  async updateOrder(id: number, data: Partial<InsertOrder>) {
    return (await db.update(orders).set(data).where(eq(orders.id, id)).returning())[0];
  }
  async deleteOrder(id: number) {
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    const result = await db.delete(orders).where(eq(orders.id, id));
    return { changes: result.count ?? 0 };
  }
  async listOrderItems(orderId: number) {
    return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  }
  async getOrderItem(id: number) {
    return (await db.select().from(orderItems).where(eq(orderItems.id, id)))[0];
  }
  async createOrderItem(data: InsertOrderItem) {
    return (await db.insert(orderItems).values(data).returning())[0];
  }
  async deleteOrderItem(id: number) {
    const result = await db.delete(orderItems).where(eq(orderItems.id, id));
    return { changes: result.count ?? 0 };
  }

  // Staff
  async listStaff() {
    return db.select().from(staff);
  }
  async getStaff(id: number) {
    return (await db.select().from(staff).where(eq(staff.id, id)))[0];
  }
  async createStaff(data: InsertStaff) {
    return (await db.insert(staff).values(data).returning())[0];
  }
  async updateStaff(id: number, data: Partial<InsertStaff>) {
    return (await db.update(staff).set(data).where(eq(staff.id, id)).returning())[0];
  }
  async deleteStaff(id: number) {
    const result = await db.delete(staff).where(eq(staff.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---- Attendance (Phase 4) ----
  async listAttendanceRecords(filters?: { staffId?: number; from?: string; to?: string }) {
    const conditions = [];
    if (filters?.staffId) conditions.push(eq(attendanceRecords.staffId, filters.staffId));
    if (filters?.from) conditions.push(gte(attendanceRecords.date, filters.from));
    if (filters?.to) conditions.push(lte(attendanceRecords.date, filters.to));
    const query = db.select().from(attendanceRecords);
    if (conditions.length) return query.where(and(...conditions)).orderBy(desc(attendanceRecords.date));
    return query.orderBy(desc(attendanceRecords.date));
  }
  async upsertAttendanceRecord(data: InsertAttendanceRecord) {
    const [existing] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.staffId, data.staffId), eq(attendanceRecords.date, data.date)));
    if (existing) {
      return (await db.update(attendanceRecords).set({ ...data, createdAt: existing.createdAt }).where(eq(attendanceRecords.id, existing.id)).returning())[0];
    }
    return (await db.insert(attendanceRecords).values({ ...data, createdAt: Date.now() } as InsertAttendanceRecord & { createdAt: number }).returning())[0];
  }
  async deleteAttendanceRecord(id: number) {
    const result = await db.delete(attendanceRecords).where(eq(attendanceRecords.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---- Leave (Phase 4) ----
  async listLeaveTypes() {
    return db.select().from(leaveTypes).orderBy(leaveTypes.id);
  }
  async createLeaveType(data: InsertLeaveType) {
    return (await db.insert(leaveTypes).values(data).returning())[0];
  }
  async updateLeaveType(id: number, data: Partial<InsertLeaveType>) {
    return (await db.update(leaveTypes).set(data).where(eq(leaveTypes.id, id)).returning())[0];
  }
  async deleteLeaveType(id: number) {
    const result = await db.delete(leaveTypes).where(eq(leaveTypes.id, id));
    return { changes: result.count ?? 0 };
  }
  async listLeaveRequests(staffId?: number) {
    if (staffId) return db.select().from(leaveRequests).where(eq(leaveRequests.staffId, staffId)).orderBy(desc(leaveRequests.id));
    return db.select().from(leaveRequests).orderBy(desc(leaveRequests.id));
  }
  async getLeaveRequest(id: number) {
    return (await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)))[0];
  }
  async createLeaveRequest(data: InsertLeaveRequest) {
    // Leave has no separate draft/submit step — creation IS the submission, so
    // routing is resolved immediately, banding on days requested (not KES).
    const rule = await this.resolveApprovalRuleByAmount("leave_request", data.days);
    if (!rule) throw new Error("No approval rule is configured for a leave request of this length — ask an administrator to add one in the Approval Matrix before requesting leave");
    const status = rule.reviewerUserId != null ? "pending_review" : "pending_approval";
    return (await db.insert(leaveRequests).values({ ...data, status, approvalRuleId: rule.id, createdAt: Date.now() } as InsertLeaveRequest & { status: string; approvalRuleId: number; createdAt: number }).returning())[0];
  }
  async reviewLeaveRequest(id: number, actor: ApprovalActor, reviewedBy: string) {
    const current = await this.getLeaveRequest(id);
    if (!current) return undefined;
    if (current.status !== "pending_review") throw new Error(`Cannot review a leave request that is ${current.status.replace("_", " ")}`);
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "review", actor);
    return (await db.update(leaveRequests).set({ status: "pending_approval", reviewedBy, reviewedAt: Date.now() }).where(eq(leaveRequests.id, id)).returning())[0];
  }
  async decideLeaveRequest(id: number, actor: ApprovalActor, status: "approved" | "rejected", decidedBy: string, reason?: string) {
    const current = await this.getLeaveRequest(id);
    if (!current) return undefined;
    if (status === "approved") {
      if (current.status !== "pending_approval") throw new Error(`This leave request is ${current.status.replace("_", " ")}, not pending approval`);
    } else {
      if (current.status !== "pending_approval" && current.status !== "pending_review") {
        throw new Error(`This leave request is already ${current.status.replace("_", " ")}`);
      }
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, current.status === "pending_review" ? "review" : "approve", actor);
    const updated = (await db.update(leaveRequests).set(
      status === "approved"
        ? { status, approvedBy: decidedBy, approvedAt: Date.now() }
        : { status, rejectedReason: reason ?? null },
    ).where(eq(leaveRequests.id, id)).returning())[0];
    if (status === "approved") {
      const year = Number(current.startDate.slice(0, 4));
      const [balance] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.staffId, current.staffId), eq(leaveBalances.leaveTypeId, current.leaveTypeId), eq(leaveBalances.year, year)));
      if (balance) {
        await db.update(leaveBalances).set({ taken: balance.taken + current.days }).where(eq(leaveBalances.id, balance.id));
      } else {
        const [leaveType] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, current.leaveTypeId));
        await db.insert(leaveBalances).values({ staffId: current.staffId, leaveTypeId: current.leaveTypeId, year, entitlement: leaveType?.entitlementDaysPerYear ?? 0, taken: current.days } as InsertLeaveBalance);
      }
    }
    return updated;
  }
  async cancelLeaveRequest(id: number, reason: string) {
    const current = await this.getLeaveRequest(id);
    if (!current) return undefined;
    if (current.status === "cancelled") throw new Error("This leave request is already cancelled");
    if (current.status === "approved") {
      const year = Number(current.startDate.slice(0, 4));
      const [balance] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.staffId, current.staffId), eq(leaveBalances.leaveTypeId, current.leaveTypeId), eq(leaveBalances.year, year)));
      if (balance) await db.update(leaveBalances).set({ taken: Math.max(0, balance.taken - current.days) }).where(eq(leaveBalances.id, balance.id));
    }
    return (await db.update(leaveRequests).set({ status: "cancelled", cancelReason: reason }).where(eq(leaveRequests.id, id)).returning())[0];
  }
  async listLeaveBalances(staffId?: number, year?: number) {
    const conditions = [];
    if (staffId) conditions.push(eq(leaveBalances.staffId, staffId));
    if (year) conditions.push(eq(leaveBalances.year, year));
    const query = db.select().from(leaveBalances);
    if (conditions.length) return query.where(and(...conditions));
    return query;
  }
  async upsertLeaveBalance(data: InsertLeaveBalance) {
    const [existing] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.staffId, data.staffId), eq(leaveBalances.leaveTypeId, data.leaveTypeId), eq(leaveBalances.year, data.year)));
    if (existing) return (await db.update(leaveBalances).set(data).where(eq(leaveBalances.id, existing.id)).returning())[0];
    return (await db.insert(leaveBalances).values(data).returning())[0];
  }

  // ---- Payroll (Phase 4) ----
  async listStatutoryRates() {
    return db.select().from(statutoryRateTables).orderBy(statutoryRateTables.id);
  }
  async updateStatutoryRate(id: number, data: Partial<InsertStatutoryRateTable>) {
    return (await db.update(statutoryRateTables).set({ ...data, updatedAt: Date.now() }).where(eq(statutoryRateTables.id, id)).returning())[0];
  }
  async listPayeBands() {
    return db.select().from(payeBands).orderBy(payeBands.sortOrder);
  }
  async createPayeBand(data: InsertPayeBand) {
    return (await db.insert(payeBands).values(data).returning())[0];
  }
  async updatePayeBand(id: number, data: Partial<InsertPayeBand>) {
    return (await db.update(payeBands).set(data).where(eq(payeBands.id, id)).returning())[0];
  }
  async deletePayeBand(id: number) {
    const result = await db.delete(payeBands).where(eq(payeBands.id, id));
    return { changes: result.count ?? 0 };
  }
  async listPayrollRuns() {
    return db.select().from(payrollRuns).orderBy(desc(payrollRuns.id));
  }
  async getPayrollRun(id: number) {
    return (await db.select().from(payrollRuns).where(eq(payrollRuns.id, id)))[0];
  }
  async listPayrollLines(payrollRunId: number) {
    return db.select().from(payrollLines).where(eq(payrollLines.payrollRunId, payrollRunId)).orderBy(payrollLines.id);
  }
  async setPayslipEmailStatus(lineId: number, status: string, error?: string) {
    await db.update(payrollLines).set({ payslipEmailStatus: status, payslipEmailError: error ?? null }).where(eq(payrollLines.id, lineId));
  }
  private async getAccountIdByCode(code: string): Promise<number> {
    const [acc] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.code, code));
    if (!acc) throw new Error(`Chart-of-accounts code ${code} is missing — re-run setup or add it in Finance → Chart of Accounts`);
    return acc.id;
  }
  async createPayrollRun(periodMonth: string, periodStart: string, periodEnd: string, createdBy: string) {
    const existingActive = (await db.select().from(payrollRuns).where(eq(payrollRuns.periodMonth, periodMonth))).find((r) => r.status !== "cancelled");
    if (existingActive) throw new Error(`A payroll run for ${periodMonth} already exists (run ${existingActive.runNumber})`);

    const [settingsRow] = await db.select().from(settings);
    const personalRelief = settingsRow?.payePersonalRelief ?? 2400;
    const rates = await this.listStatutoryRates();
    const rateMap: Record<string, StatutoryRateTable> = {};
    for (const r of rates) rateMap[r.key] = r;
    const bands = await this.listPayeBands();
    const activeStaff = (await db.select().from(staff)).filter((s) => s.status === "active");

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const calcPaye = (taxablePay: number): number => {
      let tax = 0;
      for (const band of bands) {
        if (taxablePay <= band.bandFrom) break;
        const upper = band.bandTo ?? Infinity;
        const taxableInBand = Math.min(taxablePay, upper) - band.bandFrom;
        if (taxableInBand > 0) tax += taxableInBand * (band.ratePercent / 100);
      }
      return round2(Math.max(0, tax - personalRelief));
    };
    const daysOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): number => {
      const s = Math.max(new Date(aStart).getTime(), new Date(bStart).getTime());
      const e = Math.min(new Date(aEnd).getTime(), new Date(bEnd).getTime());
      if (e < s) return 0;
      return Math.round((e - s) / 86400000) + 1;
    };

    const allLeaveRequests = await db.select().from(leaveRequests).where(eq(leaveRequests.status, "approved"));
    const allLeaveTypes = await db.select().from(leaveTypes);
    const unpaidLeaveTypeIds = new Set(allLeaveTypes.filter((t) => t.isPaid === 0).map((t) => t.id));
    const attendanceInPeriod = await db.select().from(attendanceRecords).where(and(gte(attendanceRecords.date, periodStart), lte(attendanceRecords.date, periodEnd)));

    const nssfEmployeeRate = rateMap["nssf_employee"];
    const nssfEmployerRate = rateMap["nssf_employer"];
    const shifRate = rateMap["shif_employee"];
    const ahlEmployeeRate = rateMap["housing_levy_employee"];
    const ahlEmployerRate = rateMap["housing_levy_employer"];

    const lineInputs: (InsertPayrollLine & { payrollRunId: 0 })[] = [];
    for (const s of activeStaff) {
      let gross = 0;
      let daysOrHours = 0;
      if (s.employmentType === "temporary") {
        const myAttendance = attendanceInPeriod.filter((a) => a.staffId === s.id);
        if (s.dayRate && s.dayRate > 0) {
          const daysWorked = myAttendance.reduce((sum, a) => sum + (a.status === "present" ? 1 : a.status === "half_day" ? 0.5 : 0), 0);
          daysOrHours = daysWorked;
          gross = round2(daysWorked * s.dayRate);
        } else if (s.hourRate && s.hourRate > 0) {
          const hoursWorked = myAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
          daysOrHours = hoursWorked;
          gross = round2(hoursWorked * s.hourRate);
        }
      } else {
        gross = s.salary || 0;
        const myUnpaidLeave = allLeaveRequests.filter((lr) => lr.staffId === s.id && unpaidLeaveTypeIds.has(lr.leaveTypeId));
        let unpaidDays = 0;
        for (const lr of myUnpaidLeave) {
          unpaidDays += daysOverlap(lr.startDate, lr.endDate, periodStart, periodEnd);
        }
        if (unpaidDays > 0) gross = round2(Math.max(0, gross - (gross / 30) * unpaidDays));
      }

      const nssfEmployeeAmount = nssfEmployeeRate ? round2(Math.min(gross, nssfEmployeeRate.upperLimit ?? gross) * (nssfEmployeeRate.ratePercent / 100)) : 0;
      const nssfEmployerAmount = nssfEmployerRate ? round2(Math.min(gross, nssfEmployerRate.upperLimit ?? gross) * (nssfEmployerRate.ratePercent / 100)) : 0;
      const shifAmount = shifRate ? round2(Math.max(gross * (shifRate.ratePercent / 100), shifRate.minAmount ?? 0)) : 0;
      const housingLevyEmployeeAmount = ahlEmployeeRate ? round2(gross * (ahlEmployeeRate.ratePercent / 100)) : 0;
      const housingLevyEmployerAmount = ahlEmployerRate ? round2(gross * (ahlEmployerRate.ratePercent / 100)) : 0;
      const taxablePay = Math.max(0, gross - nssfEmployeeAmount - shifAmount - housingLevyEmployeeAmount);
      const payeAmount = calcPaye(taxablePay);
      const totalDeductions = round2(payeAmount + nssfEmployeeAmount + shifAmount + housingLevyEmployeeAmount);
      const netPay = round2(gross - totalDeductions);

      lineInputs.push({
        payrollRunId: 0,
        staffId: s.id,
        employmentType: s.employmentType,
        daysOrHours,
        grossPay: gross,
        payeAmount,
        nssfEmployeeAmount,
        nssfEmployerAmount,
        shifAmount,
        housingLevyEmployeeAmount,
        housingLevyEmployerAmount,
        totalDeductions,
        netPay,
        bankName: s.bankName ?? null,
        bankAccountNumber: s.bankAccountNumber ?? null,
        payslipEmailStatus: null,
        payslipEmailError: null,
      } as any);
    }

    const totalGross = round2(lineInputs.reduce((sum, l) => sum + (l.grossPay ?? 0), 0));
    const totalDeductionsSum = round2(lineInputs.reduce((sum, l) => sum + (l.totalDeductions ?? 0), 0));
    const totalNet = round2(lineInputs.reduce((sum, l) => sum + (l.netPay ?? 0), 0));
    const totalEmployerCost = round2(lineInputs.reduce((sum, l) => sum + (l.nssfEmployerAmount ?? 0) + (l.housingLevyEmployerAmount ?? 0), 0));
    const runNumber = await this.getNextSequenceNumber("payroll_run");

    return db.transaction(async (tx) => {
      const [run] = await tx.insert(payrollRuns).values({
        runNumber, periodMonth, periodStart, periodEnd, status: "draft",
        totalGross, totalDeductions: totalDeductionsSum, totalNet, totalEmployerCost,
        createdBy, createdAt: Date.now(),
      } as InsertPayrollRun & { runNumber: string; status: string; totalGross: number; totalDeductions: number; totalNet: number; totalEmployerCost: number; createdAt: number }).returning();
      for (const line of lineInputs) {
        await tx.insert(payrollLines).values({ ...line, payrollRunId: run.id });
      }
      return run;
    });
  }
  async approvePayrollRun(id: number, approvedBy: string) {
    const run = await this.getPayrollRun(id);
    if (!run) throw new Error("Payroll run not found");
    if (run.status !== "draft") throw new Error(`This payroll run is already ${run.status}`);
    const lines = await this.listPayrollLines(id);
    if (lines.length === 0) throw new Error("This payroll run has no employee lines to post");

    const [salariesExpense, nssfEmployerExpense, ahlEmployerExpense, payePayable, nssfPayable, shifPayable, ahlPayable, netPayable] = await Promise.all([
      this.getAccountIdByCode("5000"), this.getAccountIdByCode("5010"), this.getAccountIdByCode("5020"),
      this.getAccountIdByCode("2200"), this.getAccountIdByCode("2210"), this.getAccountIdByCode("2220"),
      this.getAccountIdByCode("2230"), this.getAccountIdByCode("2240"),
    ]);

    const sum = (f: (l: PayrollLine) => number) => round2ForJournal(lines.reduce((s2, l) => s2 + f(l), 0));
    function round2ForJournal(n: number) { return Math.round(n * 100) / 100; }
    const gross = sum((l) => l.grossPay);
    const nssfEmployer = sum((l) => l.nssfEmployerAmount);
    const ahlEmployer = sum((l) => l.housingLevyEmployerAmount);
    const paye = sum((l) => l.payeAmount);
    const nssfEmployee = sum((l) => l.nssfEmployeeAmount);
    const shif = sum((l) => l.shifAmount);
    const ahlEmployee = sum((l) => l.housingLevyEmployeeAmount);
    const net = sum((l) => l.netPay);

    const debitLines = [
      { accountId: salariesExpense, debit: gross, credit: 0, description: `Payroll ${run.runNumber} — gross pay` },
      { accountId: nssfEmployerExpense, debit: nssfEmployer, credit: 0, description: `Payroll ${run.runNumber} — employer NSSF` },
      { accountId: ahlEmployerExpense, debit: ahlEmployer, credit: 0, description: `Payroll ${run.runNumber} — employer AHL` },
    ].filter((l) => l.debit > 0);
    const creditLines = [
      { accountId: payePayable, debit: 0, credit: paye, description: `Payroll ${run.runNumber} — PAYE payable` },
      { accountId: nssfPayable, debit: 0, credit: round2ForJournal(nssfEmployee + nssfEmployer), description: `Payroll ${run.runNumber} — NSSF payable` },
      { accountId: shifPayable, debit: 0, credit: shif, description: `Payroll ${run.runNumber} — SHIF payable` },
      { accountId: ahlPayable, debit: 0, credit: round2ForJournal(ahlEmployee + ahlEmployer), description: `Payroll ${run.runNumber} — AHL payable` },
      { accountId: netPayable, debit: 0, credit: net, description: `Payroll ${run.runNumber} — net pay payable` },
    ].filter((l) => l.credit > 0);

    const entry = await this.postJournalEntry(
      {
        entryDate: new Date().toISOString().slice(0, 10),
        description: `Payroll run ${run.runNumber} — ${run.periodMonth}`,
        sourceModule: "payroll",
        sourceId: run.id,
        createdBy: approvedBy,
        createdAt: Date.now(),
      } as any,
      [...debitLines, ...creditLines],
    );

    return (await db.update(payrollRuns).set({ status: "approved", approvedBy, approvedAt: Date.now(), journalEntryId: entry.id }).where(eq(payrollRuns.id, id)).returning())[0];
  }
  async cancelPayrollRun(id: number, reason: string) {
    const run = await this.getPayrollRun(id);
    if (!run) return undefined;
    if (run.status === "approved") throw new Error("Cannot cancel an approved payroll run — it has already posted to the general ledger");
    if (run.status === "cancelled") throw new Error("This payroll run is already cancelled");
    return (await db.update(payrollRuns).set({ status: "cancelled", cancelReason: reason }).where(eq(payrollRuns.id, id)).returning())[0];
  }

  // Expenses
  async listExpenses() {
    return db.select().from(expenses);
  }
  async createExpense(data: InsertExpense) {
    return (await db.insert(expenses).values(data).returning())[0];
  }
  async updateExpense(id: number, data: Partial<InsertExpense>) {
    return (await db.update(expenses).set(data).where(eq(expenses.id, id)).returning())[0];
  }
  async deleteExpense(id: number) {
    const result = await db.delete(expenses).where(eq(expenses.id, id));
    return { changes: result.count ?? 0 };
  }

  // Settings
  async getSettings() {
    const rows = await db.select().from(settings).limit(1);
    if (rows[0]) return rows[0];
    return (await db.insert(settings).values({}).returning())[0];
  }
  async updateSettings(data: Partial<InsertSettings>) {
    const current = await this.getSettings();
    return (await db.update(settings).set(data).where(eq(settings.id, current.id)).returning())[0];
  }

  // Documents
  async listDocuments() {
    return db.select().from(documents);
  }
  async getDocument(id: number) {
    return (await db.select().from(documents).where(eq(documents.id, id)))[0];
  }
  async createDocument(data: InsertDocument) {
    return (await db.insert(documents).values(data).returning())[0];
  }
  // Most recent document (invoice or receipt) issued for a given booking/order, used to embed
  // a PDF link in a WhatsApp confirmation sent later (e.g. from an edit/detail dialog) without
  // the caller having to track which document belongs to that record.
  async getLatestDocumentBySource(category: string, sourceId: number) {
    return (
      await db
        .select()
        .from(documents)
        .where(and(eq(documents.category, category), eq(documents.sourceId, sourceId)))
        .orderBy(desc(documents.createdAt))
        .limit(1)
    )[0];
  }
  // The original bill (invoice for accommodation/facility/movie, or receipt for bar/restaurant
  // orders which never get a separate invoice step) for a booking/order. Credit notes require
  // this to exist before they can be issued, and reference its amount + document number.
  // Returns the earliest matching document (there should only ever be one per source record).
  async getBillingDocumentBySource(category: string, sourceId: number) {
    return (
      await db
        .select()
        .from(documents)
        .where(and(eq(documents.category, category), eq(documents.sourceId, sourceId), inArray(documents.docType, ["invoice", "receipt"])))
        .orderBy(documents.createdAt)
        .limit(1)
    )[0];
  }

  // Users
  async listUsers() {
    return db.select().from(users);
  }
  async getUser(id: number) {
    return (await db.select().from(users).where(eq(users.id, id)))[0];
  }
  async getUserByUsername(username: string) {
    return (await db.select().from(users).where(eq(users.username, username)))[0];
  }
  async countUsers() {
    const rows = await db.select().from(users);
    return rows.length;
  }
  async createUser(data: InsertUser) {
    return (await db.insert(users).values(data).returning())[0];
  }
  async updateUser(id: number, data: Partial<InsertUser>) {
    return (await db.update(users).set(data).where(eq(users.id, id)).returning())[0];
  }
  async deleteUser(id: number) {
    const result = await db.delete(users).where(eq(users.id, id));
    return { changes: result.count ?? 0 };
  }

  // Password reset tokens
  async createPasswordResetToken(data: InsertPasswordResetToken) {
    return (await db.insert(passwordResetTokens).values(data).returning())[0];
  }
  async getPasswordResetToken(token: string) {
    return (await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)))[0];
  }
  async markPasswordResetTokenUsed(token: string) {
    await db.update(passwordResetTokens).set({ usedAt: Date.now() }).where(eq(passwordResetTokens.token, token));
  }

  // Taxes
  async listTaxes() {
    return db.select().from(taxes);
  }
  async getTax(id: number) {
    return (await db.select().from(taxes).where(eq(taxes.id, id)))[0];
  }
  async createTax(data: InsertTax) {
    return (await db.insert(taxes).values(data).returning())[0];
  }
  async updateTax(id: number, data: Partial<InsertTax>) {
    return (await db.update(taxes).set(data).where(eq(taxes.id, id)).returning())[0];
  }
  async deleteTax(id: number) {
    const result = await db.delete(taxes).where(eq(taxes.id, id));
    return { changes: result.count ?? 0 };
  }

  // Tables (Lists module)
  async listTables() {
    return db.select().from(tables);
  }
  async createTable(data: InsertTableRow) {
    return (await db.insert(tables).values(data).returning())[0];
  }
  async updateTable(id: number, data: Partial<InsertTableRow>) {
    return (await db.update(tables).set(data).where(eq(tables.id, id)).returning())[0];
  }
  async deleteTable(id: number) {
    const result = await db.delete(tables).where(eq(tables.id, id));
    return { changes: result.count ?? 0 };
  }

  // Maintenance issues
  async listMaintenanceIssues() {
    return db.select().from(maintenanceIssues);
  }
  async getMaintenanceIssue(id: number) {
    return (await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, id)))[0];
  }
  async createMaintenanceIssue(data: InsertMaintenanceIssue) {
    return (await db.insert(maintenanceIssues).values(data).returning())[0];
  }
  async updateMaintenanceIssue(id: number, data: Partial<InsertMaintenanceIssue>) {
    return (await db.update(maintenanceIssues).set(data).where(eq(maintenanceIssues.id, id)).returning())[0];
  }
  async deleteMaintenanceIssue(id: number) {
    const result = await db.delete(maintenanceIssues).where(eq(maintenanceIssues.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---------------- Finance: Chart of Accounts ----------------
  async listChartOfAccounts() {
    return db.select().from(chartOfAccounts);
  }
  async getChartOfAccount(id: number) {
    return (await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, id)))[0];
  }
  async createChartOfAccount(data: InsertChartOfAccount) {
    return (await db.insert(chartOfAccounts).values(data).returning())[0];
  }
  async updateChartOfAccount(id: number, data: Partial<InsertChartOfAccount>) {
    return (await db.update(chartOfAccounts).set(data).where(eq(chartOfAccounts.id, id)).returning())[0];
  }
  async deleteChartOfAccount(id: number) {
    const result = await db.delete(chartOfAccounts).where(eq(chartOfAccounts.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---------------- Finance: Accounting Periods ----------------
  async listAccountingPeriods() {
    return db.select().from(accountingPeriods);
  }
  async getAccountingPeriod(id: number) {
    return (await db.select().from(accountingPeriods).where(eq(accountingPeriods.id, id)))[0];
  }
  async createAccountingPeriod(data: InsertAccountingPeriod) {
    return (await db.insert(accountingPeriods).values(data).returning())[0];
  }
  async updateAccountingPeriod(id: number, data: Partial<InsertAccountingPeriod>) {
    return (await db.update(accountingPeriods).set(data).where(eq(accountingPeriods.id, id)).returning())[0];
  }
  async deleteAccountingPeriod(id: number) {
    const result = await db.delete(accountingPeriods).where(eq(accountingPeriods.id, id));
    return { changes: result.count ?? 0 };
  }
  async findOpenPeriodForDate(dateStr: string) {
    const rows = await sql<AccountingPeriod[]>`SELECT * FROM accounting_periods WHERE ${dateStr} BETWEEN start_date AND end_date ORDER BY id DESC LIMIT 1`;
    return rows[0] as AccountingPeriod | undefined;
  }

  // ---------------- Finance: Journal Entries (General Ledger) ----------------
  async listJournalEntries() {
    return db.select().from(journalEntries);
  }
  async getJournalEntry(id: number) {
    return (await db.select().from(journalEntries).where(eq(journalEntries.id, id)))[0];
  }
  async listJournalEntryLines(journalEntryId: number) {
    return db.select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, journalEntryId));
  }
  async postJournalEntry(entry: Omit<InsertJournalEntry, "entryNumber">, lines: Omit<InsertJournalEntryLine, "journalEntryId">[]) {
    if (!lines || lines.length < 2) {
      throw new Error("A journal entry needs at least two lines");
    }
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal entry is not balanced: total debit ${totalDebit.toFixed(2)} does not equal total credit ${totalCredit.toFixed(2)}`);
    }
    const period = await this.findOpenPeriodForDate(entry.entryDate);
    if (period && period.status === "closed") {
      throw new Error(`Accounting period "${period.name}" covering ${entry.entryDate} is closed. Reopen it before posting, or use a date in an open period.`);
    }
    const entryNumber = await this.getNextSequenceNumber("journal_entry");
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(journalEntries).values({
        ...entry,
        entryNumber,
        periodId: period ? period.id : (entry as any).periodId ?? null,
        status: "posted",
      }).returning();
      for (const line of lines) {
        await tx.insert(journalEntryLines).values({ ...line, journalEntryId: created.id });
      }
      return created;
    });
  }
  async cancelJournalEntry(id: number, cancelledBy: string, reason: string) {
    const entryRow = await this.getJournalEntry(id);
    if (!entryRow) return undefined;
    if (entryRow.status === "cancelled") throw new Error("This journal entry is already cancelled");
    if (entryRow.periodId) {
      const period = await this.getAccountingPeriod(entryRow.periodId);
      if (period && period.status === "closed") {
        throw new Error(`Cannot cancel: accounting period "${period.name}" is closed`);
      }
    }
    return (await db.update(journalEntries).set({
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelledBy,
      cancelReason: reason,
    }).where(eq(journalEntries.id, id)).returning())[0];
  }

  // ---------------- Finance: Bank Accounts ----------------
  async listBankAccounts() {
    return db.select().from(bankAccounts);
  }
  async getBankAccount(id: number) {
    return (await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)))[0];
  }
  async createBankAccount(data: InsertBankAccount) {
    return (await db.insert(bankAccounts).values(data).returning())[0];
  }
  async updateBankAccount(id: number, data: Partial<InsertBankAccount>) {
    return (await db.update(bankAccounts).set(data).where(eq(bankAccounts.id, id)).returning())[0];
  }
  async deleteBankAccount(id: number) {
    const result = await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---------------- Finance: Bank Reconciliations ----------------
  async listBankReconciliations() {
    return db.select().from(bankReconciliations);
  }
  async createBankReconciliation(data: InsertBankReconciliation) {
    return (await db.insert(bankReconciliations).values(data).returning())[0];
  }
  async updateBankReconciliation(id: number, data: Partial<InsertBankReconciliation>) {
    return (await db.update(bankReconciliations).set(data).where(eq(bankReconciliations.id, id)).returning())[0];
  }

  // ---------------- Finance: Payment Vouchers ----------------
  async listPaymentVouchers() {
    return db.select().from(paymentVouchers);
  }
  async getPaymentVoucher(id: number) {
    return (await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, id)))[0];
  }
  async createPaymentVoucher(data: Omit<InsertPaymentVoucher, "voucherNumber">) {
    const voucherNumber = await this.getNextSequenceNumber("payment_voucher");
    return (await db.insert(paymentVouchers).values({ ...data, voucherNumber } as InsertPaymentVoucher).returning())[0];
  }
  async updatePaymentVoucher(id: number, data: Partial<InsertPaymentVoucher>) {
    const current = await this.getPaymentVoucher(id);
    if (current && (current.status === "posted" || current.status === "cancelled")) {
      throw new Error(`Cannot edit a ${current.status} payment voucher`);
    }
    return (await db.update(paymentVouchers).set(data).where(eq(paymentVouchers.id, id)).returning())[0];
  }
  async postPaymentVoucher(id: number, approvedBy: string) {
    const voucher = await this.getPaymentVoucher(id);
    if (!voucher) return undefined;
    if (voucher.status === "posted") throw new Error("This payment voucher is already posted");
    if (voucher.status === "cancelled") throw new Error("Cannot post a cancelled payment voucher");
    const bankAccount = await this.getBankAccount(voucher.bankAccountId);
    if (!bankAccount) throw new Error("The bank account linked to this voucher no longer exists");
    const entry = await this.postJournalEntry(
      {
        entryDate: voucher.voucherDate,
        description: `Payment voucher ${voucher.voucherNumber} — ${voucher.description}`,
        sourceModule: "finance",
        sourceId: voucher.id,
        createdBy: approvedBy,
        createdAt: Date.now(),
      } as any,
      [
        { accountId: voucher.expenseAccountId, debit: voucher.amount, credit: 0, description: voucher.description },
        { accountId: bankAccount.glAccountId, debit: 0, credit: voucher.amount, description: `Payment to ${voucher.payeeName}` },
      ],
    );
    return (await db.update(paymentVouchers).set({
      status: "posted",
      approvedBy,
      journalEntryId: entry.id,
    }).where(eq(paymentVouchers.id, id)).returning())[0];
  }
  async cancelPaymentVoucher(id: number, reason: string) {
    const voucher = await this.getPaymentVoucher(id);
    if (!voucher) return undefined;
    if (voucher.status === "posted") {
      throw new Error("Cannot cancel a posted payment voucher — cancel the linked journal entry instead, or raise a reversing entry");
    }
    return (await db.update(paymentVouchers).set({
      status: "cancelled",
      cancelReason: reason,
    }).where(eq(paymentVouchers.id, id)).returning())[0];
  }

  // ---------------- System Administration: Approval Matrix ----------------
  async listApprovalMatrixRules() {
    return db.select().from(approvalMatrixRules);
  }
  async getApprovalMatrixRule(id: number) {
    return (await db.select().from(approvalMatrixRules).where(eq(approvalMatrixRules.id, id)))[0];
  }
  async createApprovalMatrixRule(data: InsertApprovalMatrixRule) {
    return (await db.insert(approvalMatrixRules).values(data).returning())[0];
  }
  async updateApprovalMatrixRule(id: number, data: Partial<InsertApprovalMatrixRule>) {
    return (await db.update(approvalMatrixRules).set(data).where(eq(approvalMatrixRules.id, id)).returning())[0];
  }
  async deleteApprovalMatrixRule(id: number) {
    const result = await db.delete(approvalMatrixRules).where(eq(approvalMatrixRules.id, id));
    return { changes: result.count ?? 0 };
  }
  // Amount-banded resolution — used by payment_voucher, purchase_requisition,
  // purchase_order (KES) and leave_request (day-count reusing the same band fields).
  // Picks the first active rule whose [minAmount, maxAmount] band contains `amount`;
  // null maxAmount means unbounded. Returns undefined when nothing matches — callers
  // must block submission in that case per the "no-match blocks" policy.
  async resolveApprovalRuleByAmount(documentType: string, amount: number) {
    const rules = await db.select().from(approvalMatrixRules)
      .where(and(eq(approvalMatrixRules.documentType, documentType), eq(approvalMatrixRules.active, 1)));
    return rules.find((r) => amount >= r.minAmount && (r.maxAmount == null || amount <= r.maxAmount));
  }
  // Category-routed resolution — used by internal_requisition. Matches `category`
  // case-insensitively against a rule's itemCategory; falls back to a wildcard rule
  // (itemCategory left null) if no category-specific rule matches. Returns undefined
  // when nothing matches (including when there is no wildcard rule configured).
  async resolveApprovalRuleByCategory(documentType: string, category: string | null) {
    const rules = await db.select().from(approvalMatrixRules)
      .where(and(eq(approvalMatrixRules.documentType, documentType), eq(approvalMatrixRules.active, 1)));
    const normalized = (category ?? "").trim().toLowerCase();
    const exact = rules.find((r) => r.itemCategory && r.itemCategory.trim().toLowerCase() === normalized);
    if (exact) return exact;
    return rules.find((r) => !r.itemCategory || !r.itemCategory.trim());
  }
  // Shared identity guard for the review/approve steps of any approval-matrix-routed
  // document. Admins always pass. Otherwise the acting user's id must match the
  // rule's reviewerUserId (stage "review") or approverUserId (stage "approve") —
  // OR, for position-routed rules (reviewerPosition/approverPosition set), the
  // acting user's linked staff record's role must match that position, case-
  // insensitively (e.g. "only the Director may approve", independent of who
  // currently holds that title).
  private async assertApprovalActor(rule: ApprovalMatrixRule | undefined, stage: "review" | "approve", actor: { id: number; isAdmin: number }) {
    if (actor.isAdmin) return;
    if (!rule) throw new Error("No approval rule is linked to this request — an administrator must reconfigure the Approval Matrix");
    const requiredPosition = stage === "review" ? rule.reviewerPosition : rule.approverPosition;
    if (requiredPosition && requiredPosition.trim()) {
      const [actingUser] = await db.select().from(users).where(eq(users.id, actor.id));
      const staffId = actingUser?.staffId;
      const actingStaff = staffId != null ? (await db.select().from(staff).where(eq(staff.id, staffId)))[0] : undefined;
      const actualRole = (actingStaff?.role ?? "").trim().toLowerCase();
      if (!actingStaff || actualRole !== requiredPosition.trim().toLowerCase()) {
        throw new Error(`Only a staff member in the "${requiredPosition}" position may ${stage} this request`);
      }
      return;
    }
    const requiredUserId = stage === "review" ? rule.reviewerUserId : rule.approverUserId;
    if (requiredUserId != null && actor.id !== requiredUserId) {
      throw new Error(`You are not the designated ${stage === "review" ? "reviewer" : "approver"} for this request`);
    }
  }

  // ---------------- System Administration: Table-level permissions ----------------
  async listPermissionTableRules() {
    return db.select().from(permissionTableRules);
  }
  async listPermissionTableRulesForUser(userId: number) {
    return db.select().from(permissionTableRules).where(eq(permissionTableRules.userId, userId));
  }
  async setPermissionTableRule(userId: number, tableKey: string, canWrite: boolean) {
    const existing = await db.select().from(permissionTableRules).where(and(eq(permissionTableRules.userId, userId), eq(permissionTableRules.tableKey, tableKey)));
    if (existing[0]) {
      return (await db.update(permissionTableRules).set({ canWrite: canWrite ? 1 : 0 }).where(eq(permissionTableRules.id, existing[0].id)).returning())[0];
    }
    return (await db.insert(permissionTableRules).values({ userId, tableKey, canWrite: canWrite ? 1 : 0 }).returning())[0];
  }

  // ---------------- System Administration: Definitions ----------------
  async listDefinitionLists() {
    return db.select().from(definitionLists);
  }
  async getDefinitionListByKey(listKey: string) {
    return (await db.select().from(definitionLists).where(eq(definitionLists.listKey, listKey)))[0];
  }
  async createDefinitionList(data: InsertDefinitionList) {
    return (await db.insert(definitionLists).values(data).returning())[0];
  }
  // Label/description are editable for every list, including seeded ("Built-in")
  // ones — only listKey and isSystem are immutable here, since code elsewhere
  // references listKey directly. Use updateDefinitionListItem for the options.
  async updateDefinitionList(id: number, data: { label?: string; description?: string | null }) {
    return (await db.update(definitionLists).set(data).where(eq(definitionLists.id, id)).returning())[0];
  }
  // Built-in (isSystem) lists cannot be deleted — enforced in the route layer —
  // because their listKey is referenced directly elsewhere in the codebase.
  async deleteDefinitionList(id: number) {
    await db.delete(definitionListItems).where(eq(definitionListItems.listId, id));
    const result = await db.delete(definitionLists).where(eq(definitionLists.id, id));
    return { changes: result.count ?? 0 };
  }
  async listDefinitionListItems(listId: number) {
    return db.select().from(definitionListItems).where(eq(definitionListItems.listId, listId));
  }
  async createDefinitionListItem(data: InsertDefinitionListItem) {
    return (await db.insert(definitionListItems).values(data).returning())[0];
  }
  async updateDefinitionListItem(id: number, data: Partial<InsertDefinitionListItem>) {
    return (await db.update(definitionListItems).set(data).where(eq(definitionListItems.id, id)).returning())[0];
  }
  async deleteDefinitionListItem(id: number) {
    const result = await db.delete(definitionListItems).where(eq(definitionListItems.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---------------- Generic document sequence numbering ----------------
  async getNextSequenceNumber(sequenceKey: string): Promise<string> {
    const rows = await sql<{ prefix: string; next_number: number; pad_length: number }[]>`
      UPDATE document_sequences SET next_number = next_number + 1
      WHERE sequence_key = ${sequenceKey}
      RETURNING prefix, next_number, pad_length
    `;
    if (!rows[0]) {
      throw new Error(`Unknown document sequence "${sequenceKey}" — add it to document_sequences first`);
    }
    const { prefix, next_number, pad_length } = rows[0];
    const used = next_number - 1;
    return `${prefix}-${String(used).padStart(pad_length, "0")}`;
  }

  // ---------------- Finance: Reports (Trial Balance, P&L, Balance Sheet) ----------------
  // All reports only ever consider status = 'posted' journal entries —
  // cancelled entries are excluded, never physically deleted.
  async getTrialBalance(asOfDate?: string) {
    const rows = await sql<{ id: number; code: string; name: string; type: string; total_debit: number; total_credit: number }[]>`
      SELECT a.id, a.code, a.name, a.type,
        COALESCE(SUM(CASE WHEN je.status = 'posted' ${asOfDate ? sql`AND je.entry_date <= ${asOfDate}` : sql``} THEN l.debit ELSE 0 END), 0) AS total_debit,
        COALESCE(SUM(CASE WHEN je.status = 'posted' ${asOfDate ? sql`AND je.entry_date <= ${asOfDate}` : sql``} THEN l.credit ELSE 0 END), 0) AS total_credit
      FROM chart_of_accounts a
      LEFT JOIN journal_entry_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = l.journal_entry_id
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code
    `;
    return rows.map((r) => ({
      accountId: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      totalDebit: Number(r.total_debit) || 0,
      totalCredit: Number(r.total_credit) || 0,
      balance: (Number(r.total_debit) || 0) - (Number(r.total_credit) || 0),
    }));
  }

  async getProfitAndLoss(from?: string, to?: string) {
    const rows = await sql<{ id: number; code: string; name: string; type: string; total_debit: number; total_credit: number }[]>`
      SELECT a.id, a.code, a.name, a.type,
        COALESCE(SUM(l.debit), 0) AS total_debit,
        COALESCE(SUM(l.credit), 0) AS total_credit
      FROM chart_of_accounts a
      JOIN journal_entry_lines l ON l.account_id = a.id
      JOIN journal_entries je ON je.id = l.journal_entry_id AND je.status = 'posted'
      WHERE a.type IN ('income', 'expense')
        ${from ? sql`AND je.entry_date >= ${from}` : sql``}
        ${to ? sql`AND je.entry_date <= ${to}` : sql``}
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.type DESC, a.code
    `;
    const income: any[] = [];
    const expense: any[] = [];
    for (const r of rows) {
      const net = r.type === "income" ? Number(r.total_credit) - Number(r.total_debit) : Number(r.total_debit) - Number(r.total_credit);
      const line = { accountId: r.id, code: r.code, name: r.name, amount: net };
      if (r.type === "income") income.push(line); else expense.push(line);
    }
    const totalIncome = income.reduce((s, l) => s + l.amount, 0);
    const totalExpense = expense.reduce((s, l) => s + l.amount, 0);
    return { income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense };
  }

  async getBalanceSheet(asOfDate?: string) {
    const rows = await sql<{ id: number; code: string; name: string; type: string; total_debit: number; total_credit: number }[]>`
      SELECT a.id, a.code, a.name, a.type,
        COALESCE(SUM(CASE WHEN je.status = 'posted' ${asOfDate ? sql`AND je.entry_date <= ${asOfDate}` : sql``} THEN l.debit ELSE 0 END), 0) AS total_debit,
        COALESCE(SUM(CASE WHEN je.status = 'posted' ${asOfDate ? sql`AND je.entry_date <= ${asOfDate}` : sql``} THEN l.credit ELSE 0 END), 0) AS total_credit
      FROM chart_of_accounts a
      LEFT JOIN journal_entry_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = l.journal_entry_id
      WHERE a.type IN ('asset', 'liability', 'equity')
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code
    `;
    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];
    for (const r of rows) {
      const debit = Number(r.total_debit) || 0;
      const credit = Number(r.total_credit) || 0;
      const balance = r.type === "asset" ? debit - credit : credit - debit;
      const line = { accountId: r.id, code: r.code, name: r.name, balance };
      if (r.type === "asset") assets.push(line);
      else if (r.type === "liability") liabilities.push(line);
      else equity.push(line);
    }
    const pnl = await this.getProfitAndLoss(undefined, asOfDate);
    const totalAssets = assets.reduce((s, l) => s + l.balance, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
    const totalEquityAccounts = equity.reduce((s, l) => s + l.balance, 0);
    const retainedEarnings = pnl.netProfit;
    const totalEquity = totalEquityAccounts + retainedEarnings;
    return {
      assets, liabilities, equity,
      retainedEarnings,
      totalAssets, totalLiabilities, totalEquity,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    };
  }

  // ================= Phase 2: Inventory =================
  async listStores() {
    return db.select().from(stores);
  }
  async getStore(id: number) {
    return (await db.select().from(stores).where(eq(stores.id, id)))[0];
  }
  async createStore(data: InsertStore) {
    return (await db.insert(stores).values(data).returning())[0];
  }
  async updateStore(id: number, data: Partial<InsertStore>) {
    return (await db.update(stores).set(data).where(eq(stores.id, id)).returning())[0];
  }
  async deleteStore(id: number) {
    const result = await db.delete(stores).where(eq(stores.id, id));
    return { changes: result.count ?? 0 };
  }

  async listInventoryItems() {
    return db.select().from(inventoryItems);
  }
  async getInventoryItem(id: number) {
    return (await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)))[0];
  }
  async createInventoryItem(data: InsertInventoryItem) {
    return (await db.insert(inventoryItems).values(data).returning())[0];
  }
  async updateInventoryItem(id: number, data: Partial<InsertInventoryItem>) {
    return (await db.update(inventoryItems).set(data).where(eq(inventoryItems.id, id)).returning())[0];
  }
  async deleteInventoryItem(id: number) {
    const result = await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
    return { changes: result.count ?? 0 };
  }

  async listStockLedger(filter?: { itemId?: number; storeId?: number }) {
    if (filter?.itemId && filter?.storeId) {
      return db.select().from(stockLedger).where(and(eq(stockLedger.itemId, filter.itemId), eq(stockLedger.storeId, filter.storeId))).orderBy(desc(stockLedger.id));
    }
    if (filter?.itemId) {
      return db.select().from(stockLedger).where(eq(stockLedger.itemId, filter.itemId)).orderBy(desc(stockLedger.id));
    }
    if (filter?.storeId) {
      return db.select().from(stockLedger).where(eq(stockLedger.storeId, filter.storeId)).orderBy(desc(stockLedger.id));
    }
    return db.select().from(stockLedger).orderBy(desc(stockLedger.id));
  }
  async getStockBalance(itemId: number, storeId: number) {
    const rows = await sql<{ balance: number }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END), 0) AS balance
      FROM stock_ledger WHERE item_id = ${itemId} AND store_id = ${storeId}
    `;
    return Number(rows[0]?.balance) || 0;
  }
  async getStockBalancesByItem() {
    const rows = await sql<{ item_id: number; store_id: number; balance: number }[]>`
      SELECT item_id, store_id, COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END), 0) AS balance
      FROM stock_ledger GROUP BY item_id, store_id
    `;
    return rows.map((r) => ({ itemId: r.item_id, storeId: r.store_id, balance: Number(r.balance) || 0 }));
  }
  async createStockAdjustment(data: { itemId: number; storeId: number; direction: "in" | "out"; quantity: number; notes?: string; createdBy: string }) {
    const currentBalance = await this.getStockBalance(data.itemId, data.storeId);
    if (data.direction === "out" && data.quantity > currentBalance + 0.0001) {
      throw new Error(`Cannot adjust out ${data.quantity} — only ${currentBalance} in stock`);
    }
    const balanceAfter = data.direction === "in" ? currentBalance + data.quantity : currentBalance - data.quantity;
    return (await db.insert(stockLedger).values({
      itemId: data.itemId,
      storeId: data.storeId,
      transactionType: "adjustment",
      quantity: data.quantity,
      direction: data.direction,
      unitCost: 0,
      referenceType: "adjustment",
      referenceId: null,
      balanceAfter,
      notes: data.notes,
      createdBy: data.createdBy,
      createdAt: Date.now(),
    } as InsertStockLedger).returning())[0];
  }

  // ================= Phase 2: Purchasing =================
  async listSuppliers() {
    return db.select().from(suppliers);
  }
  async getSupplier(id: number) {
    return (await db.select().from(suppliers).where(eq(suppliers.id, id)))[0];
  }
  async createSupplier(data: InsertSupplier) {
    return (await db.insert(suppliers).values(data).returning())[0];
  }
  async updateSupplier(id: number, data: Partial<InsertSupplier>) {
    return (await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning())[0];
  }
  async deleteSupplier(id: number) {
    const result = await db.delete(suppliers).where(eq(suppliers.id, id));
    return { changes: result.count ?? 0 };
  }

  async listPurchaseRequisitions() {
    return db.select().from(purchaseRequisitions).orderBy(desc(purchaseRequisitions.id));
  }
  async getPurchaseRequisition(id: number) {
    return (await db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id)))[0];
  }
  async getPurchaseRequisitionLines(requisitionId: number) {
    return db.select().from(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.requisitionId, requisitionId));
  }
  async createPurchaseRequisition(data: Omit<InsertPurchaseRequisition, "prNumber">, lines: Omit<InsertPurchaseRequisitionLine, "requisitionId">[]) {
    if (!lines || lines.length === 0) throw new Error("A purchase requisition needs at least one line");
    const prNumber = await this.getNextSequenceNumber("purchase_requisition");
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(purchaseRequisitions).values({ ...data, prNumber, status: "draft" } as InsertPurchaseRequisition).returning();
      for (const line of lines) {
        await tx.insert(purchaseRequisitionLines).values({ ...line, requisitionId: created.id });
      }
      return created;
    });
  }
  async updatePurchaseRequisition(id: number, data: Partial<InsertPurchaseRequisition>, lines?: Omit<InsertPurchaseRequisitionLine, "requisitionId">[]) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Cannot edit a purchase requisition that is ${current.status.replace("_", " ")}`);
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(purchaseRequisitions).set(data).where(eq(purchaseRequisitions.id, id)).returning();
      if (lines) {
        await tx.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.requisitionId, id));
        for (const line of lines) {
          await tx.insert(purchaseRequisitionLines).values({ ...line, requisitionId: id });
        }
      }
      return updated;
    });
  }
  async submitPurchaseRequisition(id: number) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Only a draft purchase requisition can be submitted (this one is ${current.status.replace("_", " ")})`);
    const lines = await this.getPurchaseRequisitionLines(id);
    const amount = lines.reduce((s, l) => s + l.quantity * l.estimatedUnitCost, 0);
    const rule = await this.resolveApprovalRuleByAmount("purchase_requisition", amount);
    if (!rule) throw new Error("No approval rule is configured for a purchase requisition of this amount — ask an administrator to add one in the Approval Matrix before submitting");
    const nextStatus = rule.reviewerUserId != null ? "pending_review" : "pending_approval";
    return (await db.update(purchaseRequisitions).set({ status: nextStatus, approvalRuleId: rule.id }).where(eq(purchaseRequisitions.id, id)).returning())[0];
  }
  async reviewPurchaseRequisition(id: number, actor: ApprovalActor, reviewedBy: string) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_review") throw new Error(`Cannot review a purchase requisition that is ${current.status.replace("_", " ")}`);
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "review", actor);
    return (await db.update(purchaseRequisitions).set({ status: "pending_approval", reviewedBy, reviewedAt: Date.now() }).where(eq(purchaseRequisitions.id, id)).returning())[0];
  }
  async approvePurchaseRequisition(id: number, actor: ApprovalActor, approvedBy: string, poDetails: { supplierId: number; payableAccountId: number; expenseAccountId?: number | null }) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) throw new Error("Purchase requisition not found");
    if (current.status !== "pending_approval") {
      throw new Error(`Cannot approve a purchase requisition that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "approve", actor);
    const lines = await this.getPurchaseRequisitionLines(id);
    if (lines.length === 0) throw new Error("Cannot approve a purchase requisition with no lines");
    if (current.type === "direct" && !poDetails.expenseAccountId) {
      throw new Error("A direct-type purchase requisition requires an expense account to raise its purchase order");
    }
    const poNumber = await this.getNextSequenceNumber("purchase_order");
    const totalAmount = lines.reduce((s, l) => s + l.quantity * l.estimatedUnitCost, 0);
    return db.transaction(async (tx) => {
      const [updatedPr] = await tx.update(purchaseRequisitions).set({
        status: "approved", approvedBy, approvedAt: Date.now(),
      }).where(eq(purchaseRequisitions.id, id)).returning();
      const [po] = await tx.insert(purchaseOrders).values({
        poNumber,
        requisitionId: id,
        supplierId: poDetails.supplierId,
        type: current.type,
        status: "approved",
        payableAccountId: poDetails.payableAccountId,
        expenseAccountId: poDetails.expenseAccountId ?? null,
        totalAmount,
        createdBy: approvedBy,
        createdAt: Date.now(),
        approvedBy,
        approvedAt: Date.now(),
      } as InsertPurchaseOrder).returning();
      for (const line of lines) {
        await tx.insert(purchaseOrderLines).values({
          poId: po.id,
          itemId: line.itemId,
          description: line.description,
          quantity: line.quantity,
          unitOfMeasure: line.unitOfMeasure,
          unitCost: line.estimatedUnitCost,
          lineTotal: line.quantity * line.estimatedUnitCost,
          quantityReceived: 0,
        });
      }
      return { requisition: updatedPr, purchaseOrder: po };
    });
  }
  async rejectPurchaseRequisition(id: number, actor: ApprovalActor, reason: string) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "pending_review") {
      throw new Error(`Cannot reject a purchase requisition that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, current.status === "pending_review" ? "review" : "approve", actor);
    return (await db.update(purchaseRequisitions).set({ status: "rejected", rejectedReason: reason }).where(eq(purchaseRequisitions.id, id)).returning())[0];
  }
  async cancelPurchaseRequisition(id: number, reason: string) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) return undefined;
    if (current.status === "approved") throw new Error("Cannot cancel an approved purchase requisition — cancel its linked purchase order instead");
    if (current.status === "cancelled") throw new Error("This purchase requisition is already cancelled");
    return (await db.update(purchaseRequisitions).set({ status: "cancelled", cancelReason: reason }).where(eq(purchaseRequisitions.id, id)).returning())[0];
  }

  async listPurchaseOrders() {
    return db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.id));
  }
  async getPurchaseOrder(id: number) {
    return (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)))[0];
  }
  async getPurchaseOrderLines(poId: number) {
    return db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
  }
  async createPurchaseOrder(data: Omit<InsertPurchaseOrder, "poNumber">, lines: Omit<InsertPurchaseOrderLine, "poId">[]) {
    if (!lines || lines.length === 0) throw new Error("A purchase order needs at least one line");
    if (data.type === "direct" && !data.expenseAccountId) {
      throw new Error("A direct-type purchase order requires an expense account");
    }
    const poNumber = await this.getNextSequenceNumber("purchase_order");
    const totalAmount = lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0);
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(purchaseOrders).values({ ...data, poNumber, status: "draft", totalAmount } as InsertPurchaseOrder).returning();
      for (const line of lines) {
        await tx.insert(purchaseOrderLines).values({ ...line, poId: created.id, lineTotal: line.quantity * (line.unitCost ?? 0), quantityReceived: 0 });
      }
      return created;
    });
  }
  async updatePurchaseOrder(id: number, data: Partial<InsertPurchaseOrder>, lines?: Omit<InsertPurchaseOrderLine, "poId">[]) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Cannot edit a purchase order that is ${current.status.replace("_", " ")}`);
    return db.transaction(async (tx) => {
      let totalAmount: number | undefined = data.totalAmount as number | undefined;
      if (lines) {
        totalAmount = lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0);
        await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id));
        for (const line of lines) {
          await tx.insert(purchaseOrderLines).values({ ...line, poId: id, lineTotal: line.quantity * (line.unitCost ?? 0), quantityReceived: 0 });
        }
      }
      const [updated] = await tx.update(purchaseOrders).set({ ...data, ...(totalAmount !== undefined ? { totalAmount } : {}) }).where(eq(purchaseOrders.id, id)).returning();
      return updated;
    });
  }
  async submitPurchaseOrder(id: number) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Only a draft purchase order can be submitted (this one is ${current.status.replace("_", " ")})`);
    const rule = await this.resolveApprovalRuleByAmount("purchase_order", current.totalAmount);
    if (!rule) throw new Error("No approval rule is configured for a purchase order of this amount — ask an administrator to add one in the Approval Matrix before submitting");
    const nextStatus = rule.reviewerUserId != null ? "pending_review" : "pending_approval";
    return (await db.update(purchaseOrders).set({ status: nextStatus, approvalRuleId: rule.id }).where(eq(purchaseOrders.id, id)).returning())[0];
  }
  async reviewPurchaseOrder(id: number, actor: ApprovalActor, reviewedBy: string) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status !== "pending_review") throw new Error(`Cannot review a purchase order that is ${current.status.replace("_", " ")}`);
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "review", actor);
    return (await db.update(purchaseOrders).set({ status: "pending_approval", reviewedBy, reviewedAt: Date.now() }).where(eq(purchaseOrders.id, id)).returning())[0];
  }
  async approvePurchaseOrder(id: number, actor: ApprovalActor, approvedBy: string) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval") {
      throw new Error(`Cannot approve a purchase order that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "approve", actor);
    return (await db.update(purchaseOrders).set({ status: "approved", approvedBy, approvedAt: Date.now() }).where(eq(purchaseOrders.id, id)).returning())[0];
  }
  async rejectPurchaseOrder(id: number, actor: ApprovalActor, reason: string) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "pending_review") {
      throw new Error(`Cannot reject a purchase order that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, current.status === "pending_review" ? "review" : "approve", actor);
    return (await db.update(purchaseOrders).set({ status: "rejected", rejectedReason: reason }).where(eq(purchaseOrders.id, id)).returning())[0];
  }
  async cancelPurchaseOrder(id: number, reason: string) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status === "received" || current.status === "partially_received") {
      throw new Error("Cannot cancel a purchase order that has already received goods");
    }
    if (current.status === "cancelled") throw new Error("This purchase order is already cancelled");
    return (await db.update(purchaseOrders).set({ status: "cancelled", cancelReason: reason }).where(eq(purchaseOrders.id, id)).returning())[0];
  }
  async receiveGoods(poId: number, data: { storeId: number; receivedBy: string; lines: { poLineId: number; quantityReceived: number; unitCost: number }[]; notes?: string }) {
    const po = await this.getPurchaseOrder(poId);
    if (!po) throw new Error("Purchase order not found");
    if (po.type !== "stock") throw new Error("Only a stock-type purchase order can receive goods into a store — use direct receipt instead");
    if (po.status !== "approved" && po.status !== "partially_received") {
      throw new Error(`Cannot receive goods against a purchase order that is ${po.status.replace("_", " ")}`);
    }
    if (!data.lines || data.lines.length === 0) throw new Error("At least one line must be received");
    const poLines = await this.getPurchaseOrderLines(poId);
    const grnNumber = await this.getNextSequenceNumber("goods_receipt");

    const { grn, jeLines, totalReceivedValue } = await db.transaction(async (tx) => {
      const [grnRow] = await tx.insert(goodsReceipts).values({
        grnNumber, poId, storeId: data.storeId, receivedBy: data.receivedBy, receivedAt: Date.now(), status: "completed", notes: data.notes,
      } as InsertGoodsReceipt).returning();

      const lines: { accountId: number; debit: number; credit: number; description: string }[] = [];
      let totalValue = 0;

      for (const recvLine of data.lines) {
        const poLine = poLines.find((l) => l.id === recvLine.poLineId);
        if (!poLine) throw new Error(`Purchase order line ${recvLine.poLineId} not found on this order`);
        if (!poLine.itemId) throw new Error(`Purchase order line ${recvLine.poLineId} has no catalogued item and cannot be received into stock`);
        const remaining = poLine.quantity - poLine.quantityReceived;
        if (recvLine.quantityReceived > remaining + 0.0001) {
          throw new Error(`Cannot receive ${recvLine.quantityReceived} against line ${recvLine.poLineId} — only ${remaining} remaining`);
        }
        await tx.insert(goodsReceiptLines).values({
          grnId: grnRow.id, poLineId: poLine.id, itemId: poLine.itemId, quantityReceived: recvLine.quantityReceived, unitCost: recvLine.unitCost,
        });
        await tx.update(purchaseOrderLines).set({ quantityReceived: poLine.quantityReceived + recvLine.quantityReceived }).where(eq(purchaseOrderLines.id, poLine.id));

        const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, poLine.itemId));
        if (!item) throw new Error(`Inventory item ${poLine.itemId} not found`);
        if (!item.glAssetAccountId) throw new Error(`Item "${item.name}" has no GL asset account configured — set one before receiving stock`);

        const priorRows = await tx.select().from(stockLedger).where(and(eq(stockLedger.itemId, poLine.itemId), eq(stockLedger.storeId, data.storeId)));
        const currentBalance = priorRows.reduce((s, r) => s + (r.direction === "in" ? r.quantity : -r.quantity), 0);
        const balanceAfter = currentBalance + recvLine.quantityReceived;
        await tx.insert(stockLedger).values({
          itemId: poLine.itemId, storeId: data.storeId, transactionType: "goods_receipt",
          quantity: recvLine.quantityReceived, direction: "in", unitCost: recvLine.unitCost,
          referenceType: "goods_receipt", referenceId: grnRow.id, balanceAfter,
          notes: data.notes, createdBy: data.receivedBy, createdAt: Date.now(),
        } as InsertStockLedger);

        await tx.update(inventoryItems).set({ lastUnitCost: recvLine.unitCost }).where(eq(inventoryItems.id, poLine.itemId));

        const lineValue = recvLine.quantityReceived * recvLine.unitCost;
        totalValue += lineValue;
        const existingAssetLine = lines.find((l) => l.accountId === item.glAssetAccountId);
        if (existingAssetLine) existingAssetLine.debit += lineValue;
        else lines.push({ accountId: item.glAssetAccountId as number, debit: lineValue, credit: 0, description: `Goods receipt ${grnNumber} — ${item.name}` });
      }

      const refreshedLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
      const allReceived = refreshedLines.every((l) => l.quantityReceived >= l.quantity - 0.0001);
      await tx.update(purchaseOrders).set({ status: allReceived ? "received" : "partially_received" }).where(eq(purchaseOrders.id, poId));

      return { grn: grnRow, jeLines: lines, totalReceivedValue: totalValue };
    });

    if (totalReceivedValue > 0) {
      jeLines.push({ accountId: po.payableAccountId, debit: 0, credit: totalReceivedValue, description: `Goods receipt ${grnNumber} — PO ${po.poNumber}` });
      await this.postJournalEntry(
        {
          entryDate: new Date().toISOString().slice(0, 10),
          description: `Goods receipt ${grnNumber} against PO ${po.poNumber}`,
          sourceModule: "inventory",
          sourceId: grn.id,
          createdBy: data.receivedBy,
          createdAt: Date.now(),
        } as any,
        jeLines,
      );
    }

    return grn;
  }
  async receivePurchaseOrderDirect(poId: number, receivedBy: string) {
    const po = await this.getPurchaseOrder(poId);
    if (!po) return undefined;
    if (po.type !== "direct") throw new Error("Only a direct-type purchase order can be received without stock movement — use goods receipt instead");
    if (po.status !== "approved") throw new Error(`Cannot receive a purchase order that is ${po.status.replace("_", " ")}`);
    if (!po.expenseAccountId) throw new Error("This purchase order has no expense account configured");
    await this.postJournalEntry(
      {
        entryDate: new Date().toISOString().slice(0, 10),
        description: `Direct purchase order ${po.poNumber} received`,
        sourceModule: "purchasing",
        sourceId: po.id,
        createdBy: receivedBy,
        createdAt: Date.now(),
      } as any,
      [
        { accountId: po.expenseAccountId, debit: po.totalAmount, credit: 0, description: `Direct PO ${po.poNumber}` },
        { accountId: po.payableAccountId, debit: 0, credit: po.totalAmount, description: `Direct PO ${po.poNumber}` },
      ],
    );
    return (await db.update(purchaseOrders).set({ status: "received" }).where(eq(purchaseOrders.id, poId)).returning())[0];
  }

  async listGoodsReceipts() {
    return db.select().from(goodsReceipts).orderBy(desc(goodsReceipts.id));
  }
  async getGoodsReceipt(id: number) {
    return (await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)))[0];
  }
  async getGoodsReceiptLines(grnId: number) {
    return db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, grnId));
  }

  // ================= Phase 2: Internal Requisitions =================
  async listInternalRequisitions() {
    return db.select().from(internalRequisitions).orderBy(desc(internalRequisitions.id));
  }
  async getInternalRequisition(id: number) {
    return (await db.select().from(internalRequisitions).where(eq(internalRequisitions.id, id)))[0];
  }
  async getInternalRequisitionLines(requisitionId: number) {
    return db.select().from(internalRequisitionLines).where(eq(internalRequisitionLines.requisitionId, requisitionId));
  }
  async createInternalRequisition(data: Omit<InsertInternalRequisition, "irNumber">, lines: Omit<InsertInternalRequisitionLine, "requisitionId">[]) {
    if (!lines || lines.length === 0) throw new Error("An internal requisition needs at least one line");
    if (data.type === "permanent" && !data.expenseAccountId) {
      throw new Error("A permanent-type internal requisition requires an expense account");
    }
    const irNumber = await this.getNextSequenceNumber("internal_requisition");
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(internalRequisitions).values({ ...data, irNumber, status: "draft" } as InsertInternalRequisition).returning();
      for (const line of lines) {
        await tx.insert(internalRequisitionLines).values({ ...line, requisitionId: created.id, quantityIssued: 0, quantityReturned: 0 });
      }
      return created;
    });
  }
  async updateInternalRequisition(id: number, data: Partial<InsertInternalRequisition>, lines?: Omit<InsertInternalRequisitionLine, "requisitionId">[]) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Cannot edit an internal requisition that is ${current.status.replace("_", " ")}`);
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(internalRequisitions).set(data).where(eq(internalRequisitions.id, id)).returning();
      if (lines) {
        await tx.delete(internalRequisitionLines).where(eq(internalRequisitionLines.requisitionId, id));
        for (const line of lines) {
          await tx.insert(internalRequisitionLines).values({ ...line, requisitionId: id, quantityIssued: 0, quantityReturned: 0 });
        }
      }
      return updated;
    });
  }
  // Determines the single item category this requisition's lines route by.
  // Throws if lines span more than one distinct category — category-based
  // routing is ambiguous in that case and the requisition should be split.
  private async resolveInternalRequisitionCategory(lines: InternalRequisitionLine[]): Promise<string | null> {
    const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
    const items = itemIds.length ? await db.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds)) : [];
    const categories = Array.from(new Set(items.map((i) => (i.category || "").trim().toLowerCase()).filter(Boolean)));
    if (categories.length > 1) {
      throw new Error("This internal requisition's items span more than one category, so approval routing is ambiguous — please split it into separate requisitions, one per category");
    }
    return categories[0] ?? null;
  }
  async submitInternalRequisition(id: number) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Only a draft internal requisition can be submitted (this one is ${current.status.replace("_", " ")})`);
    const lines = await this.getInternalRequisitionLines(id);
    const category = await this.resolveInternalRequisitionCategory(lines);
    const rule = await this.resolveApprovalRuleByCategory("internal_requisition", category);
    if (!rule) throw new Error("No approval rule is configured for this item category — ask an administrator to add one (or a catch-all rule) in the Approval Matrix before submitting");
    const nextStatus = rule.reviewerUserId != null ? "pending_review" : "pending_approval";
    return (await db.update(internalRequisitions).set({ status: nextStatus, approvalRuleId: rule.id }).where(eq(internalRequisitions.id, id)).returning())[0];
  }
  async reviewInternalRequisition(id: number, actor: ApprovalActor, reviewedBy: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_review") throw new Error(`Cannot review an internal requisition that is ${current.status.replace("_", " ")}`);
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "review", actor);
    return (await db.update(internalRequisitions).set({ status: "pending_approval", reviewedBy, reviewedAt: Date.now() }).where(eq(internalRequisitions.id, id)).returning())[0];
  }
  async approveInternalRequisition(id: number, actor: ApprovalActor, approvedBy: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval") {
      throw new Error(`Cannot approve an internal requisition that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "approve", actor);
    return (await db.update(internalRequisitions).set({ status: "approved", approvedBy, approvedAt: Date.now() }).where(eq(internalRequisitions.id, id)).returning())[0];
  }
  async rejectInternalRequisition(id: number, actor: ApprovalActor, reason: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "pending_review") {
      throw new Error(`Cannot reject an internal requisition that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, current.status === "pending_review" ? "review" : "approve", actor);
    return (await db.update(internalRequisitions).set({ status: "rejected", rejectedReason: reason }).where(eq(internalRequisitions.id, id)).returning())[0];
  }
  async issueInternalRequisition(id: number, issuedBy: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) throw new Error("Internal requisition not found");
    if (current.status !== "approved") throw new Error(`Cannot issue an internal requisition that is ${current.status.replace("_", " ")}`);
    const lines = await this.getInternalRequisitionLines(id);
    if (lines.length === 0) throw new Error("Cannot issue an internal requisition with no lines");

    const jeLines: { accountId: number; debit: number; credit: number; description: string }[] = [];
    let totalValue = 0;

    await db.transaction(async (tx) => {
      for (const line of lines) {
        const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, line.itemId));
        if (!item) throw new Error(`Inventory item ${line.itemId} not found`);
        const priorRows = await tx.select().from(stockLedger).where(and(eq(stockLedger.itemId, line.itemId), eq(stockLedger.storeId, current.storeId)));
        const currentBalance = priorRows.reduce((s, r) => s + (r.direction === "in" ? r.quantity : -r.quantity), 0);
        if (currentBalance < line.quantityRequested - 0.0001) {
          throw new Error(`Insufficient stock for "${item.name}" — available ${currentBalance}, requested ${line.quantityRequested}`);
        }
        const balanceAfter = currentBalance - line.quantityRequested;
        await tx.insert(stockLedger).values({
          itemId: line.itemId, storeId: current.storeId,
          transactionType: current.type === "loan" ? "loan_issue" : "internal_issue",
          quantity: line.quantityRequested, direction: "out", unitCost: item.lastUnitCost,
          referenceType: "internal_requisition", referenceId: current.id,
          balanceAfter, notes: null, createdBy: issuedBy, createdAt: Date.now(),
        } as InsertStockLedger);
        await tx.update(internalRequisitionLines).set({ quantityIssued: line.quantityRequested }).where(eq(internalRequisitionLines.id, line.id));

        if (current.type === "permanent") {
          const lineValue = line.quantityRequested * item.lastUnitCost;
          totalValue += lineValue;
          if (!item.glAssetAccountId) throw new Error(`Item "${item.name}" has no GL asset account configured`);
          const existing = jeLines.find((l) => l.accountId === item.glAssetAccountId);
          if (existing) existing.credit += lineValue;
          else jeLines.push({ accountId: item.glAssetAccountId as number, debit: 0, credit: lineValue, description: `Internal requisition ${current.irNumber} — ${item.name}` });
        }
      }
      await tx.update(internalRequisitions).set({ status: "issued" }).where(eq(internalRequisitions.id, id));
    });

    if (current.type === "permanent" && totalValue > 0) {
      if (!current.expenseAccountId) throw new Error("This requisition has no expense account configured");
      jeLines.unshift({ accountId: current.expenseAccountId, debit: totalValue, credit: 0, description: `Internal requisition ${current.irNumber}` });
      await this.postJournalEntry(
        {
          entryDate: new Date().toISOString().slice(0, 10),
          description: `Internal requisition ${current.irNumber} issued`,
          sourceModule: "internal-requisitions",
          sourceId: current.id,
          createdBy: issuedBy,
          createdAt: Date.now(),
        } as any,
        jeLines,
      );
    }

    return this.getInternalRequisition(id);
  }
  async returnLoanItem(lineId: number, data: { quantityReturned: number; returnedBy: string; condition?: string; notes?: string }) {
    const [line] = await db.select().from(internalRequisitionLines).where(eq(internalRequisitionLines.id, lineId));
    if (!line) throw new Error("Internal requisition line not found");
    const [requisition] = await db.select().from(internalRequisitions).where(eq(internalRequisitions.id, line.requisitionId));
    if (!requisition) throw new Error("Internal requisition not found");
    if (requisition.type !== "loan") throw new Error("Only loan-type internal requisitions accept returns");
    if (requisition.status !== "issued") throw new Error(`Cannot return items for a requisition that is ${requisition.status.replace("_", " ")}`);
    const outstandingQty = line.quantityIssued - line.quantityReturned;
    if (data.quantityReturned > outstandingQty + 0.0001) {
      throw new Error(`Cannot return ${data.quantityReturned} — only ${outstandingQty} outstanding on loan`);
    }
    return db.transaction(async (tx) => {
      const priorRows = await tx.select().from(stockLedger).where(and(eq(stockLedger.itemId, line.itemId), eq(stockLedger.storeId, requisition.storeId)));
      const currentBalance = priorRows.reduce((s, r) => s + (r.direction === "in" ? r.quantity : -r.quantity), 0);
      const balanceAfter = currentBalance + data.quantityReturned;
      await tx.insert(stockLedger).values({
        itemId: line.itemId, storeId: requisition.storeId, transactionType: "loan_return",
        quantity: data.quantityReturned, direction: "in", unitCost: 0,
        referenceType: "internal_requisition", referenceId: requisition.id,
        balanceAfter, notes: data.notes, createdBy: data.returnedBy, createdAt: Date.now(),
      } as InsertStockLedger);
      await tx.update(internalRequisitionLines).set({ quantityReturned: line.quantityReturned + data.quantityReturned }).where(eq(internalRequisitionLines.id, lineId));
      const [created] = await tx.insert(loanReturns).values({
        requisitionLineId: lineId, quantityReturned: data.quantityReturned, returnedAt: Date.now(),
        returnedBy: data.returnedBy, condition: data.condition, notes: data.notes,
      } as InsertLoanReturn).returning();
      return created;
    });
  }
  async cancelInternalRequisition(id: number, reason: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status === "issued") throw new Error("Cannot cancel an internal requisition that has already been issued");
    if (current.status === "cancelled") throw new Error("This internal requisition is already cancelled");
    return (await db.update(internalRequisitions).set({ status: "cancelled", cancelReason: reason }).where(eq(internalRequisitions.id, id)).returning())[0];
  }

  // ================= Phase 7: Temporary Labor Requisitions =================
  // Authorizes hiring temporary workers, per role, ahead of time. Requester must
  // hold the "hr" module (enforced in routes.ts via requireModule). Routed through
  // the same Approval Matrix as PR/PO/IR/Leave, banded on total worker-days/hours
  // (headcount × duration summed across all lines, hours normalized to a day-
  // equivalent count is NOT performed — days and hours are summed as raw units per
  // the confirmed "total worker-days/hours" metric). The final approver is almost
  // always resolved dynamically by position (e.g. "Director") rather than a fixed
  // user — see assertApprovalActor. Approving auto-creates blank placeholder staff
  // records, one per headcount unit per line, for HR to fill in with real names.
  async listTemporaryLaborRequisitions() {
    return db.select().from(temporaryLaborRequisitions).orderBy(desc(temporaryLaborRequisitions.id));
  }
  async getTemporaryLaborRequisition(id: number) {
    return (await db.select().from(temporaryLaborRequisitions).where(eq(temporaryLaborRequisitions.id, id)))[0];
  }
  async getTemporaryLaborRequisitionLines(requisitionId: number) {
    return db.select().from(temporaryLaborRequisitionLines).where(eq(temporaryLaborRequisitionLines.requisitionId, requisitionId));
  }
  async createTemporaryLaborRequisition(data: Omit<InsertTemporaryLaborRequisition, "tlrNumber">, lines: Omit<InsertTemporaryLaborRequisitionLine, "requisitionId">[]) {
    if (!lines || lines.length === 0) throw new Error("A temporary labor requisition needs at least one role line");
    for (const line of lines) {
      if (!line.role || !line.role.trim()) throw new Error("Every line needs a role");
      if (!line.headcount || line.headcount < 1) throw new Error(`"${line.role}" needs a headcount of at least 1`);
      if (!line.durationValue || line.durationValue <= 0) throw new Error(`"${line.role}" needs a duration greater than 0`);
    }
    const tlrNumber = await this.getNextSequenceNumber("temporary_labor_requisition");
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(temporaryLaborRequisitions).values({ ...data, tlrNumber, status: "draft" } as InsertTemporaryLaborRequisition).returning();
      for (const line of lines) {
        await tx.insert(temporaryLaborRequisitionLines).values({ ...line, requisitionId: created.id });
      }
      return created;
    });
  }
  async updateTemporaryLaborRequisition(id: number, data: Partial<InsertTemporaryLaborRequisition>, lines?: Omit<InsertTemporaryLaborRequisitionLine, "requisitionId">[]) {
    const current = await this.getTemporaryLaborRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Cannot edit a temporary labor requisition that is ${current.status.replace("_", " ")}`);
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(temporaryLaborRequisitions).set(data).where(eq(temporaryLaborRequisitions.id, id)).returning();
      if (lines) {
        await tx.delete(temporaryLaborRequisitionLines).where(eq(temporaryLaborRequisitionLines.requisitionId, id));
        for (const line of lines) {
          await tx.insert(temporaryLaborRequisitionLines).values({ ...line, requisitionId: id });
        }
      }
      return updated;
    });
  }
  async submitTemporaryLaborRequisition(id: number) {
    const current = await this.getTemporaryLaborRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Only a draft temporary labor requisition can be submitted (this one is ${current.status.replace("_", " ")})`);
    const lines = await this.getTemporaryLaborRequisitionLines(id);
    if (lines.length === 0) throw new Error("Cannot submit a temporary labor requisition with no lines");
    const workerUnits = lines.reduce((s, l) => s + l.headcount * l.durationValue, 0);
    const rule = await this.resolveApprovalRuleByAmount("temporary_labor_requisition", workerUnits);
    if (!rule) throw new Error("No approval rule is configured for this many worker-days/hours — ask an administrator to add one in the Approval Matrix before submitting");
    const hasReviewStage = rule.reviewerUserId != null || !!(rule.reviewerPosition && rule.reviewerPosition.trim());
    const nextStatus = hasReviewStage ? "pending_review" : "pending_approval";
    return (await db.update(temporaryLaborRequisitions).set({ status: nextStatus, approvalRuleId: rule.id }).where(eq(temporaryLaborRequisitions.id, id)).returning())[0];
  }
  async reviewTemporaryLaborRequisition(id: number, actor: ApprovalActor, reviewedBy: string) {
    const current = await this.getTemporaryLaborRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_review") throw new Error(`Cannot review a temporary labor requisition that is ${current.status.replace("_", " ")}`);
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "review", actor);
    return (await db.update(temporaryLaborRequisitions).set({ status: "pending_approval", reviewedBy, reviewedAt: Date.now() }).where(eq(temporaryLaborRequisitions.id, id)).returning())[0];
  }
  // Approving creates one blank placeholder staff record per headcount unit per
  // line (e.g. headcount 3 on "Waiter" → "Waiter #1", "Waiter #2", "Waiter #3"),
  // tagged with employmentType "temporary" and the day/hour rate field matching
  // the line's duration unit left blank for HR to fill in alongside the real name.
  async approveTemporaryLaborRequisition(id: number, actor: ApprovalActor, approvedBy: string) {
    const current = await this.getTemporaryLaborRequisition(id);
    if (!current) throw new Error("Temporary labor requisition not found");
    if (current.status !== "pending_approval") {
      throw new Error(`Cannot approve a temporary labor requisition that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, "approve", actor);
    const lines = await this.getTemporaryLaborRequisitionLines(id);
    if (lines.length === 0) throw new Error("Cannot approve a temporary labor requisition with no lines");
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(temporaryLaborRequisitions).set({
        status: "approved", approvedBy, approvedAt: Date.now(),
      }).where(eq(temporaryLaborRequisitions.id, id)).returning();
      const createdStaff: Staff[] = [];
      for (const line of lines) {
        for (let n = 1; n <= line.headcount; n++) {
          const [placeholder] = await tx.insert(staff).values({
            name: `${line.role} #${n}`,
            role: line.role,
            department: "other",
            salary: 0,
            employmentType: "temporary",
            dayRate: line.durationUnit === "days" ? 0 : null,
            hourRate: line.durationUnit === "hours" ? 0 : null,
            status: "active",
            hireDate: line.dateNeeded ?? null,
            notes: `Auto-created placeholder from Temporary Labor Requisition ${current.tlrNumber} — fill in real name, ID and rate.`,
            temporaryLaborRequisitionLineId: line.id,
          } as InsertStaff).returning();
          createdStaff.push(placeholder);
        }
      }
      return { requisition: updated, placeholderStaff: createdStaff };
    });
  }
  async rejectTemporaryLaborRequisition(id: number, actor: ApprovalActor, reason: string) {
    const current = await this.getTemporaryLaborRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "pending_review") {
      throw new Error(`Cannot reject a temporary labor requisition that is ${current.status.replace("_", " ")}`);
    }
    const rule = current.approvalRuleId ? await this.getApprovalMatrixRule(current.approvalRuleId) : undefined;
    await this.assertApprovalActor(rule, current.status === "pending_review" ? "review" : "approve", actor);
    return (await db.update(temporaryLaborRequisitions).set({ status: "rejected", rejectedReason: reason }).where(eq(temporaryLaborRequisitions.id, id)).returning())[0];
  }
  async cancelTemporaryLaborRequisition(id: number, reason: string) {
    const current = await this.getTemporaryLaborRequisition(id);
    if (!current) return undefined;
    if (current.status === "approved") throw new Error("Cannot cancel a temporary labor requisition that has already been approved — the placeholder staff slots it created must be handled on the Staff page instead");
    if (current.status === "cancelled") throw new Error("This temporary labor requisition is already cancelled");
    return (await db.update(temporaryLaborRequisitions).set({ status: "cancelled", cancelReason: reason }).where(eq(temporaryLaborRequisitions.id, id)).returning())[0];
  }

  // ================= Phase 3: Accommodation ID capture =================
  async listGuestIdentityDocuments(bookingId: number) {
    return db.select().from(guestIdentityDocuments).where(eq(guestIdentityDocuments.bookingId, bookingId));
  }
  async createGuestIdentityDocument(data: Omit<InsertGuestIdentityDocument, "createdAt">) {
    const existing = await this.listGuestIdentityDocuments(data.bookingId);
    if (existing.length >= 2) throw new Error("This booking already has identity documents recorded for 2 guests — the maximum allowed per room");
    return (await db.insert(guestIdentityDocuments).values({ ...data, createdAt: Date.now() } as InsertGuestIdentityDocument).returning())[0];
  }

  // ================= Phase 3: Tenants — Shops =================
  async listShops() {
    return db.select().from(shops).orderBy(desc(shops.id));
  }
  async getShop(id: number) {
    return (await db.select().from(shops).where(eq(shops.id, id)))[0];
  }
  async createShop(data: Omit<InsertShop, "createdAt">) {
    return (await db.insert(shops).values({ ...data, createdAt: Date.now() } as InsertShop).returning())[0];
  }
  async updateShop(id: number, data: Partial<InsertShop>) {
    return (await db.update(shops).set(data).where(eq(shops.id, id)).returning())[0];
  }
  async deleteShop(id: number) {
    const leases = await db.select().from(tenancyLeases).where(eq(tenancyLeases.shopId, id));
    if (leases.length > 0) throw new Error("Cannot delete a shop that has tenancy leases on record — deactivate it instead");
    const result = await db.delete(shops).where(eq(shops.id, id));
    return { changes: result.count ?? 0 };
  }

  // ================= Phase 3: Tenants — Tenants =================
  async listTenants() {
    return db.select().from(tenants).orderBy(desc(tenants.id));
  }
  async getTenant(id: number) {
    return (await db.select().from(tenants).where(eq(tenants.id, id)))[0];
  }
  async createTenant(data: Omit<InsertTenant, "createdAt">) {
    return (await db.insert(tenants).values({ ...data, createdAt: Date.now() } as InsertTenant).returning())[0];
  }
  async updateTenant(id: number, data: Partial<InsertTenant>) {
    return (await db.update(tenants).set(data).where(eq(tenants.id, id)).returning())[0];
  }
  async deleteTenant(id: number) {
    const leases = await db.select().from(tenancyLeases).where(eq(tenancyLeases.tenantId, id));
    if (leases.length > 0) throw new Error("Cannot delete a tenant that has tenancy leases on record — deactivate it instead");
    const result = await db.delete(tenants).where(eq(tenants.id, id));
    return { changes: result.count ?? 0 };
  }

  // ================= Phase 3: Tenants — Tenancy Leases =================
  async listTenancyLeases() {
    return db.select().from(tenancyLeases).orderBy(desc(tenancyLeases.id));
  }
  async getTenancyLease(id: number) {
    return (await db.select().from(tenancyLeases).where(eq(tenancyLeases.id, id)))[0];
  }
  async createTenancyLease(data: Omit<InsertTenancyLease, "createdAt">) {
    const activeOnShop = await db.select().from(tenancyLeases).where(and(eq(tenancyLeases.shopId, data.shopId), eq(tenancyLeases.status, "active")));
    if (activeOnShop.length > 0) throw new Error("This shop already has an active lease — end it before starting a new one");
    return (await db.insert(tenancyLeases).values({ ...data, createdAt: Date.now() } as InsertTenancyLease).returning())[0];
  }
  async updateTenancyLease(id: number, data: Partial<InsertTenancyLease>) {
    return (await db.update(tenancyLeases).set(data).where(eq(tenancyLeases.id, id)).returning())[0];
  }
  async endTenancyLease(id: number) {
    return (await db.update(tenancyLeases).set({ status: "ended" }).where(eq(tenancyLeases.id, id)).returning())[0];
  }

  // ================= Phase 3: Tenants — Meter Readings =================
  async listMeterReadings(leaseId?: number) {
    if (leaseId) return db.select().from(meterReadings).where(eq(meterReadings.leaseId, leaseId)).orderBy(desc(meterReadings.id));
    return db.select().from(meterReadings).orderBy(desc(meterReadings.id));
  }
  async createMeterReading(data: Omit<InsertMeterReading, "consumption" | "amount" | "createdAt">) {
    const lease = await this.getTenancyLease(data.leaseId);
    if (!lease) throw new Error("Tenancy lease not found");
    if (data.endReading < data.startReading) throw new Error("End reading cannot be less than start reading");
    const existing = await db.select().from(meterReadings).where(and(eq(meterReadings.leaseId, data.leaseId), eq(meterReadings.periodMonth, data.periodMonth)));
    if (existing.length > 0) throw new Error(`A meter reading for ${data.periodMonth} already exists for this lease`);
    const consumption = data.endReading - data.startReading;
    const amount = consumption * lease.electricityRatePerUnit;
    return (await db.insert(meterReadings).values({ ...data, consumption, amount, createdAt: Date.now() } as InsertMeterReading).returning())[0];
  }

  // ================= Phase 3: Tenants — Rent Invoices =================
  async listRentInvoices(leaseId?: number) {
    if (leaseId) return db.select().from(rentInvoices).where(eq(rentInvoices.leaseId, leaseId)).orderBy(desc(rentInvoices.id));
    return db.select().from(rentInvoices).orderBy(desc(rentInvoices.id));
  }
  async getRentInvoice(id: number) {
    return (await db.select().from(rentInvoices).where(eq(rentInvoices.id, id)))[0];
  }
  async getRentInvoiceForPeriod(leaseId: number, periodMonth: string) {
    return (await db.select().from(rentInvoices).where(and(eq(rentInvoices.leaseId, leaseId), eq(rentInvoices.periodMonth, periodMonth))))[0];
  }
  async createRentInvoiceForPeriod(leaseId: number, periodMonth: string, createdBy: string) {
    const lease = await this.getTenancyLease(leaseId);
    if (!lease) throw new Error("Tenancy lease not found");
    const existing = await this.getRentInvoiceForPeriod(leaseId, periodMonth);
    if (existing) throw new Error(`A rent invoice for ${periodMonth} already exists for this lease`);
    if (!lease.receivableAccountId || !lease.incomeAccountId) {
      throw new Error("This lease has no GL receivable/income account configured — set them before generating invoices");
    }
    const [meterReading] = await db.select().from(meterReadings).where(and(eq(meterReadings.leaseId, leaseId), eq(meterReadings.periodMonth, periodMonth)));
    const electricityAmount = meterReading?.amount ?? 0;
    const rentAmount = lease.monthlyRent;
    const totalAmount = rentAmount + electricityAmount;
    const invoiceNumber = await this.getNextSequenceNumber("rent_invoice");
    const dueDay = Math.min(lease.dueDayOfMonth, 28);
    const dueDate = `${periodMonth}-${String(dueDay).padStart(2, "0")}`;

    const created = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(rentInvoices).values({
        invoiceNumber, leaseId, periodMonth, rentAmount, electricityAmount, totalAmount,
        amountPaid: 0, dueDate, status: "unpaid", createdAt: Date.now(),
      } as InsertRentInvoice).returning();
      return invoice;
    });

    const entry = await this.postJournalEntry(
      {
        entryDate: new Date().toISOString().slice(0, 10),
        description: `Rent invoice ${invoiceNumber} — period ${periodMonth}`,
        sourceModule: "tenants",
        sourceId: created.id,
        createdBy,
        createdAt: Date.now(),
      } as any,
      [
        { accountId: lease.receivableAccountId, debit: totalAmount, credit: 0, description: `Rent invoice ${invoiceNumber}` },
        { accountId: lease.incomeAccountId, debit: 0, credit: totalAmount, description: `Rent invoice ${invoiceNumber}` },
      ],
    );

    const [withJournalEntry] = await db.update(rentInvoices).set({ journalEntryId: entry.id }).where(eq(rentInvoices.id, created.id)).returning();
    return withJournalEntry;
  }
  async recordRentInvoicePayment(invoiceId: number, data: { amount: number; bankAccountId: number; paymentMethod?: string; paymentReference?: string; recordedBy: string }) {
    const invoice = await this.getRentInvoice(invoiceId);
    if (!invoice) throw new Error("Rent invoice not found");
    if (invoice.status === "cancelled") throw new Error("Cannot record a payment against a cancelled invoice");
    const newAmountPaid = invoice.amountPaid + data.amount;
    if (newAmountPaid > invoice.totalAmount + 0.01) throw new Error("Payment exceeds the outstanding balance on this invoice");
    const newStatus = newAmountPaid >= invoice.totalAmount - 0.01 ? "paid" : "partially_paid";

    const lease = await this.getTenancyLease(invoice.leaseId);
    const bankAccount = await this.getBankAccount(data.bankAccountId);
    if (!bankAccount) throw new Error("The selected bank/cash account was not found");

    let journalEntryId: number | undefined;
    if (lease?.receivableAccountId) {
      const entry = await this.postJournalEntry(
        {
          entryDate: new Date().toISOString().slice(0, 10),
          description: `Payment received — rent invoice ${invoice.invoiceNumber}`,
          sourceModule: "tenants",
          sourceId: invoice.id,
          createdBy: data.recordedBy,
          createdAt: Date.now(),
        } as any,
        [
          { accountId: bankAccount.glAccountId, debit: data.amount, credit: 0, description: `Rent payment — ${invoice.invoiceNumber}` },
          { accountId: lease.receivableAccountId, debit: 0, credit: data.amount, description: `Rent payment — ${invoice.invoiceNumber}` },
        ],
      );
      journalEntryId = entry.id;
    }

    const payment = await db.transaction(async (tx) => {
      const [created] = await tx.insert(rentInvoicePayments).values({
        invoiceId, amount: data.amount, paymentMethod: data.paymentMethod, paymentReference: data.paymentReference,
        journalEntryId, paidAt: Date.now(), recordedBy: data.recordedBy,
      } as InsertRentInvoicePayment).returning();
      await tx.update(rentInvoices).set({ amountPaid: newAmountPaid, status: newStatus }).where(eq(rentInvoices.id, invoiceId));
      return created;
    });

    return payment;
  }
  async listRentInvoicePayments(invoiceId: number) {
    return db.select().from(rentInvoicePayments).where(eq(rentInvoicePayments.invoiceId, invoiceId)).orderBy(desc(rentInvoicePayments.id));
  }
  async cancelRentInvoice(id: number, reason: string) {
    const current = await this.getRentInvoice(id);
    if (!current) return undefined;
    if (current.amountPaid > 0) throw new Error("Cannot cancel a rent invoice that already has payments recorded against it");
    return (await db.update(rentInvoices).set({ status: "cancelled", cancelReason: reason }).where(eq(rentInvoices.id, id)).returning())[0];
  }
  async markRentInvoiceReminderSent(id: number) {
    await db.update(rentInvoices).set({ reminderSentAt: Date.now() }).where(eq(rentInvoices.id, id));
  }
  async listUnpaidRentInvoicesDueForReminder() {
    const rows = await db.select({
      invoice: rentInvoices,
      lease: tenancyLeases,
      tenant: tenants,
    }).from(rentInvoices)
      .innerJoin(tenancyLeases, eq(rentInvoices.leaseId, tenancyLeases.id))
      .innerJoin(tenants, eq(tenancyLeases.tenantId, tenants.id))
      .where(and(ne(rentInvoices.status, "paid"), ne(rentInvoices.status, "cancelled")));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due: (RentInvoice & { tenantEmail: string | null; tenantPhone: string | null; tenantName: string })[] = [];
    for (const row of rows) {
      if (row.invoice.reminderSentAt) continue;
      const dueDate = new Date(row.invoice.dueDate + "T00:00:00");
      const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
      if (daysUntilDue <= row.lease.reminderDaysBefore) {
        due.push({ ...row.invoice, tenantEmail: row.tenant.email, tenantPhone: row.tenant.phone, tenantName: row.tenant.name });
      }
    }
    return due;
  }

  // ================= Phase 3: F&B Costing — Recipes =================
  async listRecipes() {
    return db.select().from(recipes).orderBy(desc(recipes.id));
  }
  async getRecipe(id: number) {
    return (await db.select().from(recipes).where(eq(recipes.id, id)))[0];
  }
  async getRecipeIngredients(recipeId: number) {
    return db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  }
  async createRecipe(data: Omit<InsertRecipe, "createdAt">, ingredients: Omit<InsertRecipeIngredient, "recipeId">[]) {
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(recipes).values({ ...data, createdAt: Date.now() } as InsertRecipe).returning();
      for (const ing of ingredients) {
        await tx.insert(recipeIngredients).values({ ...ing, recipeId: created.id });
      }
      return created;
    });
  }
  async updateRecipe(id: number, data: Partial<InsertRecipe>, ingredients?: Omit<InsertRecipeIngredient, "recipeId">[]) {
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(recipes).set(data).where(eq(recipes.id, id)).returning();
      if (ingredients) {
        await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
        for (const ing of ingredients) {
          await tx.insert(recipeIngredients).values({ ...ing, recipeId: id });
        }
      }
      return updated;
    });
  }
  async deleteRecipe(id: number) {
    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    const result = await db.delete(recipes).where(eq(recipes.id, id));
    return { changes: result.count ?? 0 };
  }

  // ---- Budgeting (Phase 5) ----
  async listBudgetLines(filters?: { from?: string; to?: string }) {
    if (filters?.from && filters?.to) {
      return db.select().from(budgetLines).where(and(gte(budgetLines.month, filters.from), lte(budgetLines.month, filters.to))).orderBy(budgetLines.month, budgetLines.incomeStreamCode);
    }
    return db.select().from(budgetLines).orderBy(budgetLines.month, budgetLines.incomeStreamCode);
  }
  async upsertBudgetLine(data: InsertBudgetLine) {
    const [existing] = await db.select().from(budgetLines).where(and(eq(budgetLines.month, data.month), eq(budgetLines.incomeStreamCode, data.incomeStreamCode)));
    if (existing) {
      return (await db.update(budgetLines).set({ ...data, createdAt: existing.createdAt, updatedAt: Date.now() }).where(eq(budgetLines.id, existing.id)).returning())[0];
    }
    return (await db.insert(budgetLines).values({ ...data, createdAt: Date.now(), updatedAt: Date.now() } as InsertBudgetLine & { createdAt: number; updatedAt: number }).returning())[0];
  }
  async deleteBudgetLine(id: number) {
    const result = await db.delete(budgetLines).where(eq(budgetLines.id, id));
    return { changes: result.count ?? 0 };
  }
  async getBudgetVariance(from: string, to: string) {
    // Budgeted side: every budget line in range, one row per (month, stream).
    const budgetRows = await sql<{ month: string; income_stream_code: string; budgeted_amount: number }[]>`
      SELECT month, income_stream_code, budgeted_amount FROM budget_lines
      WHERE month BETWEEN ${from} AND ${to}`;
    // Actual side: posted journal-entry lines against income accounts tagged with an income_stream_code,
    // summed per calendar month (credit - debit, since income normally increases on the credit side).
    const actualRows = await sql<{ month: string; income_stream_code: string; actual_amount: number }[]>`
      SELECT to_char(je.entry_date::date, 'YYYY-MM') AS month, coa.income_stream_code, SUM(jel.credit - jel.debit) AS actual_amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.status = 'posted' AND coa.type = 'income' AND coa.income_stream_code IS NOT NULL
        AND to_char(je.entry_date::date, 'YYYY-MM') BETWEEN ${from} AND ${to}
      GROUP BY 1, 2`;
    const streamListRows = await sql<{ code: string; label: string }[]>`
      SELECT dli.code, dli.label FROM definition_list_items dli
      JOIN definition_lists dl ON dl.id = dli.list_id
      WHERE dl.list_key = 'income_stream'`;
    const labelByCode = new Map(streamListRows.map((r) => [r.code, r.label]));
    const key = (month: string, code: string) => `${month}::${code}`;
    const merged = new Map<string, { month: string; incomeStreamCode: string; budgetedAmount: number; actualAmount: number }>();
    for (const b of budgetRows) {
      merged.set(key(b.month, b.income_stream_code), { month: b.month, incomeStreamCode: b.income_stream_code, budgetedAmount: b.budgeted_amount, actualAmount: 0 });
    }
    for (const a of actualRows) {
      const k = key(a.month, a.income_stream_code);
      const existing = merged.get(k);
      if (existing) existing.actualAmount = a.actual_amount;
      else merged.set(k, { month: a.month, incomeStreamCode: a.income_stream_code, budgetedAmount: 0, actualAmount: a.actual_amount });
    }
    return Array.from(merged.values())
      .map((r) => ({ ...r, incomeStreamLabel: labelByCode.get(r.incomeStreamCode) ?? r.incomeStreamCode, variance: r.actualAmount - r.budgetedAmount }))
      .sort((x, y) => (x.month === y.month ? x.incomeStreamCode.localeCompare(y.incomeStreamCode) : x.month.localeCompare(y.month)));
  }

  // ---- Assets (Phase 5) ----
  async listAssetCategories() {
    return db.select().from(assetCategories).orderBy(assetCategories.name);
  }
  async getAssetCategory(id: number) {
    return (await db.select().from(assetCategories).where(eq(assetCategories.id, id)))[0];
  }
  async createAssetCategory(data: InsertAssetCategory) {
    return (await db.insert(assetCategories).values(data).returning())[0];
  }
  async updateAssetCategory(id: number, data: Partial<InsertAssetCategory>) {
    return (await db.update(assetCategories).set(data).where(eq(assetCategories.id, id)).returning())[0];
  }
  async deleteAssetCategory(id: number) {
    const result = await db.delete(assetCategories).where(eq(assetCategories.id, id));
    return { changes: result.count ?? 0 };
  }

  async listAssets(filters?: { status?: string; categoryId?: number }) {
    const conditions = [];
    if (filters?.status) conditions.push(eq(assets.status, filters.status));
    if (filters?.categoryId) conditions.push(eq(assets.categoryId, filters.categoryId));
    if (conditions.length) return db.select().from(assets).where(and(...conditions)).orderBy(desc(assets.id));
    return db.select().from(assets).orderBy(desc(assets.id));
  }
  async getAsset(id: number) {
    return (await db.select().from(assets).where(eq(assets.id, id)))[0];
  }
  async createAsset(data: Omit<InsertAsset, "assetNumber" | "createdAt">) {
    const assetNumber = await this.getNextSequenceNumber("asset");
    return (await db.insert(assets).values({ ...data, assetNumber, createdAt: Date.now() } as typeof assets.$inferInsert).returning())[0];
  }
  async updateAsset(id: number, data: Partial<InsertAsset>) {
    return (await db.update(assets).set(data).where(eq(assets.id, id)).returning())[0];
  }
  async disposeAsset(id: number, data: { disposalValue: number; disposalNotes?: string }) {
    return (await db.update(assets).set({
      status: "disposed",
      disposedAt: Date.now(),
      disposalValue: data.disposalValue,
      disposalNotes: data.disposalNotes ?? null,
    }).where(eq(assets.id, id)).returning())[0];
  }
  async deleteAsset(id: number) {
    await db.delete(assetDepreciationSchedules).where(eq(assetDepreciationSchedules.assetId, id));
    const result = await db.delete(assets).where(eq(assets.id, id));
    return { changes: result.count ?? 0 };
  }

  async listAssetDepreciationSchedules(assetId?: number) {
    if (assetId) return db.select().from(assetDepreciationSchedules).where(eq(assetDepreciationSchedules.assetId, assetId)).orderBy(assetDepreciationSchedules.periodMonth);
    return db.select().from(assetDepreciationSchedules).orderBy(desc(assetDepreciationSchedules.id));
  }
  async runDepreciationForPeriod(periodMonth: string, createdBy: string) {
    const [{ c: alreadyRun }] = await sql<{ c: number }[]>`SELECT COUNT(*)::int as c FROM asset_depreciation_schedules WHERE period_month = ${periodMonth}`;
    if (alreadyRun > 0) {
      throw new Error(`Depreciation for ${periodMonth} has already been run. Reverse the existing journal entry first if you need to redo it.`);
    }
    const activeAssets = await db.select().from(assets).where(eq(assets.status, "active"));
    const categories = await db.select().from(assetCategories);
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    // Fall back to the system default Depreciation Expense / Accumulated Depreciation accounts
    // (seeded codes 6100/1600) when a category has no specific GL mapping configured.
    const [defaultExpenseAccount] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.code, "6100"));
    const [defaultAccumAccount] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.code, "1600"));

    type Line = { assetId: number; amount: number; expenseAccountId: number; accumAccountId: number };
    const lines: Line[] = [];
    const scheduleInserts: (InsertAssetDepreciationSchedule & { createdAt: number })[] = [];

    for (const asset of activeAssets) {
      if (asset.depreciationMethod === "none") continue;
      const depreciableBase = Math.max(0, asset.acquisitionCost - asset.salvageValue);
      if (depreciableBase <= 0 || asset.usefulLifeMonths <= 0) continue;
      const monthlyAmount = depreciableBase / asset.usefulLifeMonths;
      const [{ accum }] = await sql<{ accum: number | null }[]>`SELECT MAX(accumulated_depreciation) as accum FROM asset_depreciation_schedules WHERE asset_id = ${asset.id}`;
      const priorAccumulated = accum ?? 0;
      const remainingDepreciable = depreciableBase - priorAccumulated;
      if (remainingDepreciable <= 0.01) continue; // fully depreciated
      const amount = Math.min(monthlyAmount, remainingDepreciable);
      const newAccumulated = priorAccumulated + amount;
      const category = categoryById.get(asset.categoryId);
      const expenseAccountId = category?.depreciationExpenseAccountId ?? defaultExpenseAccount?.id;
      const accumAccountId = category?.accumulatedDepreciationAccountId ?? defaultAccumAccount?.id;
      if (!expenseAccountId || !accumAccountId) {
        throw new Error(`No Depreciation Expense / Accumulated Depreciation account configured for asset "${asset.name}" (category "${category?.name ?? "unknown"}") and no system default account found.`);
      }
      lines.push({ assetId: asset.id, amount, expenseAccountId, accumAccountId });
      scheduleInserts.push({
        assetId: asset.id,
        periodMonth,
        depreciationAmount: amount,
        accumulatedDepreciation: newAccumulated,
        netBookValue: asset.acquisitionCost - newAccumulated,
        journalEntryId: null,
        createdAt: Date.now(),
      });
    }

    if (lines.length === 0) {
      return { journalEntryId: null, scheduleRows: [], totalDepreciation: 0 };
    }

    // One summarized journal entry for the whole batch: total debit to each distinct expense
    // account, total credit to each distinct accumulated-depreciation account.
    const byExpenseAccount = new Map<number, number>();
    const byAccumAccount = new Map<number, number>();
    for (const l of lines) {
      byExpenseAccount.set(l.expenseAccountId, (byExpenseAccount.get(l.expenseAccountId) ?? 0) + l.amount);
      byAccumAccount.set(l.accumAccountId, (byAccumAccount.get(l.accumAccountId) ?? 0) + l.amount);
    }
    const journalLines: Omit<InsertJournalEntryLine, "journalEntryId">[] = [];
    for (const [accountId, amount] of Array.from(byExpenseAccount.entries())) journalLines.push({ accountId, debit: amount, credit: 0, description: `Depreciation for ${periodMonth}` });
    for (const [accountId, amount] of Array.from(byAccumAccount.entries())) journalLines.push({ accountId, debit: 0, credit: amount, description: `Depreciation for ${periodMonth}` });
    const totalDepreciation = lines.reduce((sum, l) => sum + l.amount, 0);

    const entryDate = `${periodMonth}-01`;
    const created = await this.postJournalEntry(
      { entryDate, description: `Asset depreciation — ${periodMonth}`, sourceModule: "assets", sourceId: null, createdBy, createdAt: Date.now(), periodId: null } as any,
      journalLines,
    );

    const scheduleRows = await db.insert(assetDepreciationSchedules).values(
      scheduleInserts.map((s) => ({ ...s, journalEntryId: created.id })),
    ).returning();

    return { journalEntryId: created.id, scheduleRows, totalDepreciation };
  }

  // ---- Water Sales ----
  async listWaterBucketPrices() {
    return db.select().from(waterBucketPrices).orderBy(waterBucketPrices.sizeLitres);
  }
  async createWaterBucketPrice(data: InsertWaterBucketPrice) {
    return (await db.insert(waterBucketPrices).values(data).returning())[0];
  }
  async updateWaterBucketPrice(id: number, data: Partial<InsertWaterBucketPrice>) {
    return (await db.update(waterBucketPrices).set(data).where(eq(waterBucketPrices.id, id)).returning())[0];
  }
  async deleteWaterBucketPrice(id: number) {
    const result = await db.delete(waterBucketPrices).where(eq(waterBucketPrices.id, id));
    return { changes: result.count ?? 0 };
  }

  async listWaterSales(filters?: { from?: string; to?: string }) {
    const conditions = [];
    if (filters?.from) conditions.push(gte(waterSales.saleDate, filters.from));
    if (filters?.to) conditions.push(lte(waterSales.saleDate, filters.to));
    const query = db.select().from(waterSales).orderBy(desc(waterSales.id));
    if (conditions.length) return query.where(and(...conditions));
    return query;
  }
  async getWaterSale(id: number) {
    return (await db.select().from(waterSales).where(eq(waterSales.id, id)))[0];
  }
  async createWaterSale(data: InsertWaterSale, createdBy: string) {
    let litresSold = 0;
    let unitPrice: number | null = null;
    let ratePerLitre: number | null = null;
    let totalAmount = 0;

    if (data.saleType === "bucket") {
      if (!data.bucketSizeLitres || !data.bucketCount || data.bucketCount <= 0) {
        throw new Error("Bucket sales require a bucket size and a positive bucket count");
      }
      const [priceRow] = await db.select().from(waterBucketPrices)
        .where(and(eq(waterBucketPrices.sizeLitres, data.bucketSizeLitres), eq(waterBucketPrices.active, 1)));
      if (!priceRow) throw new Error(`No active price is configured for a ${data.bucketSizeLitres}L bucket`);
      unitPrice = priceRow.price;
      litresSold = data.bucketSizeLitres * data.bucketCount;
      totalAmount = unitPrice * data.bucketCount;
    } else if (data.saleType === "bulk") {
      if (data.meterStart == null || data.meterEnd == null) {
        throw new Error("Bulk sales require a meter start and end reading");
      }
      if (data.meterEnd <= data.meterStart) {
        throw new Error("Meter end reading must be greater than the meter start reading");
      }
      const settings = await this.getSettings();
      ratePerLitre = settings.waterRatePerLitre;
      if (!ratePerLitre || ratePerLitre <= 0) {
        throw new Error("Configure a water rate per litre in Settings before recording bulk sales");
      }
      litresSold = data.meterEnd - data.meterStart;
      totalAmount = litresSold * ratePerLitre;
    } else {
      throw new Error(`Unknown water sale type "${data.saleType}"`);
    }

    const saleNumber = await this.getNextSequenceNumber("water_sale");
    const [created] = await db.insert(waterSales).values({
      ...data,
      saleNumber,
      litresSold,
      unitPrice,
      ratePerLitre,
      totalAmount,
      status: "completed",
      creditedAmount: 0,
      createdBy,
      createdAt: Date.now(),
    }).returning();
    return created;
  }
  async cancelWaterSale(id: number, reason: string) {
    return (await db.update(waterSales).set({ status: "cancelled", cancelReason: reason })
      .where(eq(waterSales.id, id)).returning())[0];
  }
  async creditWaterSale(id: number, amount: number) {
    const [sale] = await db.select().from(waterSales).where(eq(waterSales.id, id));
    if (!sale) return undefined;
    return (await db.update(waterSales).set({ creditedAmount: sale.creditedAmount + amount })
      .where(eq(waterSales.id, id)).returning())[0];
  }
}

export const storage = new DatabaseStorage();
