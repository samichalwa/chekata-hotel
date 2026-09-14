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
} from '@shared/schema';
import type {
  Room, InsertRoom,
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
} from '@shared/schema';
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, ne, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Set it to your Postgres (e.g. Supabase) connection string.",
  );
}

// `prepare: false` is required against Supabase's transaction pooler (port 6543).
export const sql = postgres(connectionString, { ssl: "require", prepare: false });

export const db = drizzle(sql);

// ---- Schema bootstrap (no migrations tooling in this sandbox) ----
async function bootstrapSchema() {
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
`);

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

export const schemaReady = bootstrapSchema().catch((err) => {
  console.error("[storage] Failed to bootstrap schema:", err);
  throw err;
});

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
  createStaff(data: InsertStaff): Promise<Staff>;
  updateStaff(id: number, data: Partial<InsertStaff>): Promise<Staff | undefined>;
  deleteStaff(id: number): Promise<{ changes: number }>;

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
  createApprovalMatrixRule(data: InsertApprovalMatrixRule): Promise<ApprovalMatrixRule>;
  updateApprovalMatrixRule(id: number, data: Partial<InsertApprovalMatrixRule>): Promise<ApprovalMatrixRule | undefined>;
  deleteApprovalMatrixRule(id: number): Promise<{ changes: number }>;

  // System Administration: Table-level permissions
  listPermissionTableRules(): Promise<PermissionTableRule[]>;
  listPermissionTableRulesForUser(userId: number): Promise<PermissionTableRule[]>;
  setPermissionTableRule(userId: number, tableKey: string, canWrite: boolean): Promise<PermissionTableRule>;

  // System Administration: Definitions
  listDefinitionLists(): Promise<DefinitionList[]>;
  getDefinitionListByKey(listKey: string): Promise<DefinitionList | undefined>;
  createDefinitionList(data: InsertDefinitionList): Promise<DefinitionList>;
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
  approvePurchaseRequisition(id: number, approvedBy: string, poDetails: { supplierId: number; payableAccountId: number; expenseAccountId?: number | null }): Promise<{ requisition: PurchaseRequisition; purchaseOrder: PurchaseOrder }>;
  rejectPurchaseRequisition(id: number, reason: string): Promise<PurchaseRequisition | undefined>;
  cancelPurchaseRequisition(id: number, reason: string): Promise<PurchaseRequisition | undefined>;

  listPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined>;
  getPurchaseOrderLines(poId: number): Promise<PurchaseOrderLine[]>;
  createPurchaseOrder(data: Omit<InsertPurchaseOrder, "poNumber">, lines: Omit<InsertPurchaseOrderLine, "poId">[]): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: number, data: Partial<InsertPurchaseOrder>, lines?: Omit<InsertPurchaseOrderLine, "poId">[]): Promise<PurchaseOrder | undefined>;
  approvePurchaseOrder(id: number, approvedBy: string): Promise<PurchaseOrder | undefined>;
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
  approveInternalRequisition(id: number, approvedBy: string): Promise<InternalRequisition | undefined>;
  rejectInternalRequisition(id: number, reason: string): Promise<InternalRequisition | undefined>;
  issueInternalRequisition(id: number, issuedBy: string): Promise<InternalRequisition | undefined>;
  returnLoanItem(lineId: number, data: { quantityReturned: number; returnedBy: string; condition?: string; notes?: string }): Promise<LoanReturn>;
  cancelInternalRequisition(id: number, reason: string): Promise<InternalRequisition | undefined>;
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
    return (await db.update(purchaseRequisitions).set({ status: "pending_approval" }).where(eq(purchaseRequisitions.id, id)).returning())[0];
  }
  async approvePurchaseRequisition(id: number, approvedBy: string, poDetails: { supplierId: number; payableAccountId: number; expenseAccountId?: number | null }) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) throw new Error("Purchase requisition not found");
    if (current.status !== "pending_approval" && current.status !== "draft") {
      throw new Error(`Cannot approve a purchase requisition that is ${current.status.replace("_", " ")}`);
    }
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
  async rejectPurchaseRequisition(id: number, reason: string) {
    const current = await this.getPurchaseRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "draft") {
      throw new Error(`Cannot reject a purchase requisition that is ${current.status.replace("_", " ")}`);
    }
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
  async approvePurchaseOrder(id: number, approvedBy: string) {
    const current = await this.getPurchaseOrder(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Cannot approve a purchase order that is ${current.status.replace("_", " ")}`);
    return (await db.update(purchaseOrders).set({ status: "approved", approvedBy, approvedAt: Date.now() }).where(eq(purchaseOrders.id, id)).returning())[0];
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
  async submitInternalRequisition(id: number) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "draft") throw new Error(`Only a draft internal requisition can be submitted (this one is ${current.status.replace("_", " ")})`);
    return (await db.update(internalRequisitions).set({ status: "pending_approval" }).where(eq(internalRequisitions.id, id)).returning())[0];
  }
  async approveInternalRequisition(id: number, approvedBy: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "draft") {
      throw new Error(`Cannot approve an internal requisition that is ${current.status.replace("_", " ")}`);
    }
    return (await db.update(internalRequisitions).set({ status: "approved", approvedBy, approvedAt: Date.now() }).where(eq(internalRequisitions.id, id)).returning())[0];
  }
  async rejectInternalRequisition(id: number, reason: string) {
    const current = await this.getInternalRequisition(id);
    if (!current) return undefined;
    if (current.status !== "pending_approval" && current.status !== "draft") {
      throw new Error(`Cannot reject an internal requisition that is ${current.status.replace("_", " ")}`);
    }
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
}

export const storage = new DatabaseStorage();
