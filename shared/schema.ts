import { pgTable, text, integer, real, serial, bigint } from "drizzle-orm/pg-core";
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
  "reports",
  "documents",
  "settings",
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
  reports: "Reports",
  documents: "Invoices & Receipts",
  settings: "Settings",
};

// ---------- Users ----------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  isAdmin: integer("is_admin").notNull().default(0),
  permissions: text("permissions").notNull().default("[]"), // JSON array of ModuleKey
  canEditMovieBookings: integer("can_edit_movie_bookings").notNull().default(0), // extra right: edit/cancel an already-entered movie seat booking
  active: integer("active").notNull().default(1),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "passwordHash">;

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
