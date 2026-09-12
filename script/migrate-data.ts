// One-time data migration: copies existing demo/starter data from the old
// SQLite database (data.db) into the new Postgres database (DATABASE_URL).
// Safe to run on an empty Postgres database. Re-running is NOT idempotent
// (it will create duplicate rows) — only run this once per Postgres target.
//
// Usage:
//   DATABASE_URL="postgres://..." npx tsx script/migrate-data.ts

import "dotenv/config";
import Database from "better-sqlite3";
import postgres from "postgres";
import path from "node:path";

const SQLITE_PATH = process.env.SQLITE_PATH || path.resolve(process.cwd(), "data.db");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Point it at your Supabase/Postgres connection string.");
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(connectionString, { ssl: "require" });

const TABLES: { name: string; columns: string[] }[] = [
  { name: "rooms", columns: ["id", "name", "type", "rate", "status", "notes"] },
  { name: "accommodation_bookings", columns: ["id", "room_id", "guest_name", "guest_phone", "guest_email", "check_in", "check_out", "rate", "total_amount", "amount_paid", "status", "notes", "created_at"] },
  { name: "facilities", columns: ["id", "name", "rate_type", "rate", "capacity", "active", "notes"] },
  { name: "facility_bookings", columns: ["id", "facility_id", "client_name", "client_phone", "client_email", "event_date", "start_time", "end_time", "rate", "total_amount", "amount_paid", "status", "notes", "created_at"] },
  { name: "menu_items", columns: ["id", "name", "category", "price", "active"] },
  { name: "orders", columns: ["id", "outlet", "reference", "customer_name", "customer_email", "customer_phone", "order_date", "status", "payment_method", "total_amount", "notes", "created_at"] },
  { name: "order_items", columns: ["id", "order_id", "menu_item_id", "item_name", "price", "quantity", "subtotal"] },
  { name: "staff", columns: ["id", "name", "role", "department", "salary", "phone", "status", "hire_date", "notes"] },
  { name: "expenses", columns: ["id", "category", "description", "amount", "date", "paid_to", "notes", "created_at"] },
  { name: "settings", columns: ["id", "hotel_name", "hotel_address", "hotel_phone", "hotel_email", "email_provider", "email_api_key", "email_from", "email_from_name", "mailgun_domain", "invoices_enabled"] },
  { name: "documents", columns: ["id", "doc_type", "category", "source_id", "recipient_name", "recipient_email", "amount", "status", "error_message", "payload_json", "created_at"] },
  { name: "users", columns: ["id", "username", "password_hash", "full_name", "is_admin", "permissions", "active", "created_at"] },
  { name: "taxes", columns: ["id", "name", "rate_percent", "active", "applies_accommodation", "applies_facilities", "applies_bar", "applies_restaurant"] },
];

async function migrateTable(name: string, columns: string[]) {
  const rows = sqlite.prepare(`SELECT * FROM ${name}`).all() as Record<string, any>[];
  if (rows.length === 0) {
    console.log(`[${name}] no rows to migrate`);
    return;
  }
  // Clear any existing rows first so this can be safely re-run against a fresh table.
  await sql.unsafe(`DELETE FROM ${name}`);
  for (const row of rows) {
    const values = columns.map((c) => row[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    await sql.unsafe(
      `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${placeholders})`,
      values as any,
    );
  }
  // Bump the SERIAL sequence past the highest migrated id so future inserts don't collide.
  await sql.unsafe(
    `SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 1))`,
  );
  console.log(`[${name}] migrated ${rows.length} row(s)`);
}

async function main() {
  console.log(`Migrating data from ${SQLITE_PATH} into Postgres...`);
  for (const t of TABLES) {
    await migrateTable(t.name, t.columns);
  }
  await sql.end();
  sqlite.close();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
