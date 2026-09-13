import {
  rooms, accommodationBookings, facilities, facilityBookings,
  movieShows, movieSeatBookings,
  menuItems, orders, orderItems, staff, expenses, settings, documents,
  users, passwordResetTokens, taxes, tables, maintenanceIssues, MODULE_KEYS,
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
} from '@shared/schema';
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

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
`);

  // ---- Idempotent column additions for installs upgraded from an earlier version ----
  async function ensureColumn(table: string, column: string, ddl: string) {
    try {
      await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (e: any) {
      if (!/already exists/i.test(String(e?.message))) throw e;
    }
  }
  await ensureColumn("accommodation_bookings", "guest_email", "TEXT");
  await ensureColumn("facility_bookings", "client_email", "TEXT");
  await ensureColumn("orders", "customer_name", "TEXT");
  await ensureColumn("orders", "customer_email", "TEXT");
  await ensureColumn("orders", "customer_phone", "TEXT");
  await ensureColumn("users", "can_edit_movie_bookings", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_manage_tables_list", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_manage_menu_items_list", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "can_close_maintenance_issues", "INTEGER NOT NULL DEFAULT 0");
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

  // ---- Seed a default settings row (idempotent) ----
  async function seedSettings() {
    const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM settings`;
    if (c === 0) {
      await sql`INSERT INTO settings (hotel_name, hotel_address, hotel_phone, email_provider, invoices_enabled) VALUES ('The Chekata', 'Highway Hotel', '', '', 1)`;
    }
  }
  await seedSettings();

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
      await sql`INSERT INTO users (username, password_hash, full_name, is_admin, permissions, can_edit_movie_bookings, can_manage_tables_list, can_manage_menu_items_list, can_close_maintenance_issues, active, created_at) VALUES ('admin', ${hash}, 'Administrator', 1, ${allPermissions}, 1, 1, 1, 1, 1, ${Date.now()})`;
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
}

export const storage = new DatabaseStorage();
