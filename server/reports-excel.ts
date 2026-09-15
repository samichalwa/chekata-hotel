import ExcelJS from "exceljs";
import type { IStorage } from "./storage";
import { computeInclusiveTaxBreakdown } from "./tax";
import type { TaxCategory } from "@shared/schema";
import { getCurrentEnvironment } from "./db-context";

const BRAND = "FFB5502F"; // terracotta, matches invoice/brand accent
const BRAND_DARK = "FF2A2118";
const MUTED = "FF6B6157";
const HIGHLIGHT = "FFFBE7C6"; // soft amber, used to flag maintenance rows
const TOTAL_ROW = "FFF3EEE4";

export type ReportSheetKey =
  | "overview"
  | "accommodation"
  | "facilities"
  | "bar-restaurant"
  | "staff"
  | "expenses"
  | "maintenance"
  | "taxes"
  | "budgeting"
  | "assets";

export const REPORT_SHEET_LABELS: Record<ReportSheetKey, string> = {
  overview: "Revenue & Cost Summary",
  accommodation: "Accommodation",
  facilities: "Conference & Movie Room",
  "bar-restaurant": "Bar & Restaurant",
  staff: "Staff & Payroll",
  expenses: "Expenses",
  maintenance: "Maintenance",
  taxes: "Taxes",
  budgeting: "Budgeting & Variance",
  assets: "Assets & Depreciation",
};

function inRange(date: string, from?: string, to?: string): boolean {
  return (!from || date >= from) && (!to || date <= to);
}

function titleCase(s: string): string {
  return String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function periodLabel(from?: string, to?: string): string {
  if (!from && !to) return "All time";
  return `Period: ${from || "start"} to ${to || "today"}`;
}

function addTitleBlock(ws: ExcelJS.Worksheet, hotelName: string, sheetTitle: string, from?: string, to?: string, lastCol = "H") {
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = `${hotelName} — ${sheetTitle}`;
  titleCell.font = { bold: true, size: 14, color: { argb: BRAND } };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell("A2");
  subCell.value = periodLabel(from, to);
  subCell.font = { italic: true, size: 10, color: { argb: MUTED } };

  ws.addRow([]);
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND_DARK } } };
  });
  row.height = 20;
}

function styleTotalsRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_ROW } };
    cell.border = { top: { style: "thin", color: { argb: BRAND_DARK } } };
  });
}

function autosizeColumns(ws: ExcelJS.Worksheet, minWidths: number[] = []) {
  ws.columns.forEach((col, idx) => {
    let max = minWidths[idx] ?? 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const text = v instanceof Date ? v.toDateString() : String(v ?? "");
      if (text.length > max) max = text.length;
    });
    col.width = Math.min(max + 3, 42);
  });
}

const KES_FMT = "#,##0";

async function buildOverviewSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Overview");
  addTitleBlock(ws, hotelName, "Revenue & Cost Summary", from, to, "B");

  const [bookings, facilities, facilityBookings, orders, staffList, expenses, movieShows, movieSeatBookings] = await Promise.all([
    storage.listAccommodationBookings(),
    storage.listFacilities(),
    storage.listFacilityBookings(),
    storage.listOrders(),
    storage.listStaff(),
    storage.listExpenses(),
    storage.listMovieShows(),
    storage.listMovieSeatBookings(),
  ]);

  const facilityById = new Map(facilities.map((f) => [f.id, f]));
  const movieShowById = new Map(movieShows.map((s) => [s.id, s]));

  const accommodationRevenue = bookings
    .filter((b) => b.status !== "cancelled" && inRange(b.checkIn, from, to))
    .reduce((s, b) => s + b.totalAmount, 0);

  const facilityRevenueByName = new Map<string, number>();
  facilityBookings
    .filter((b) => b.status !== "cancelled" && inRange(b.eventDate, from, to))
    .forEach((b) => {
      const name = facilityById.get(b.facilityId)?.name ?? "Other facility";
      facilityRevenueByName.set(name, (facilityRevenueByName.get(name) ?? 0) + b.totalAmount);
    });
  const facilityRevenue = Array.from(facilityRevenueByName.values()).reduce((s, v) => s + v, 0);

  const barRevenue = orders
    .filter((o) => o.outlet === "bar" && o.status === "paid" && inRange(o.orderDate, from, to))
    .reduce((s, o) => s + o.totalAmount, 0);
  const restaurantRevenue = orders
    .filter((o) => o.outlet === "restaurant" && o.status === "paid" && inRange(o.orderDate, from, to))
    .reduce((s, o) => s + o.totalAmount, 0);

  const movieRevenue = movieSeatBookings
    .filter((b) => b.status !== "cancelled" && inRange(movieShowById.get(b.showId)?.showDate ?? "", from, to))
    .reduce((s, b) => s + b.amountPaid, 0);

  const totalRevenue = accommodationRevenue + facilityRevenue + barRevenue + restaurantRevenue + movieRevenue;

  let periodMonths = 1;
  if (from && to) {
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
    periodMonths = Math.max(1, Math.round(days / 30));
  }
  const monthlyPayroll = staffList.filter((s) => s.status === "active").reduce((s, m) => s + m.salary, 0);
  const proratedPayroll = monthlyPayroll * periodMonths;

  const expensesInRange = expenses.filter((e) => inRange(e.date, from, to));
  const expensesByCategory = new Map<string, number>();
  expensesInRange.forEach((e) => expensesByCategory.set(e.category, (expensesByCategory.get(e.category) ?? 0) + e.amount));
  const otherExpensesTotal = Array.from(expensesByCategory.values()).reduce((s, v) => s + v, 0);

  const totalCosts = proratedPayroll + otherExpensesTotal;
  const netProfit = totalRevenue - totalCosts;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // KPI block
  const kpiHeaderRow = ws.addRow(["Key figures", ""]);
  styleHeaderRow(kpiHeaderRow);
  const kpiRows: [string, number | string][] = [
    ["Total revenue", totalRevenue],
    ["Total costs", totalCosts],
    ["Net profit", netProfit],
    ["Net margin", `${margin.toFixed(1)}%`],
  ];
  kpiRows.forEach(([label, value]) => {
    const r = ws.addRow([label, value]);
    if (typeof value === "number") r.getCell(2).numFmt = KES_FMT;
    r.getCell(2).alignment = { horizontal: "right" };
  });
  ws.addRow([]);

  // Revenue breakdown
  const revHeader = ws.addRow(["Revenue source", "Amount (KES)"]);
  styleHeaderRow(revHeader);
  const revenueRows: [string, number][] = [
    ["Accommodation", accommodationRevenue],
    ...Array.from(facilityRevenueByName.entries()),
    ["Movie Room", movieRevenue],
    ["Bar", barRevenue],
    ["Restaurant", restaurantRevenue],
  ];
  revenueRows.forEach(([label, value]) => {
    const r = ws.addRow([label, value]);
    r.getCell(2).numFmt = KES_FMT;
    r.getCell(2).alignment = { horizontal: "right" };
  });
  const revTotalRow = ws.addRow(["Total revenue", totalRevenue]);
  revTotalRow.getCell(2).numFmt = KES_FMT;
  revTotalRow.getCell(2).alignment = { horizontal: "right" };
  styleTotalsRow(revTotalRow);
  ws.addRow([]);

  // Cost breakdown
  const costHeader = ws.addRow(["Cost category", "Amount (KES)"]);
  styleHeaderRow(costHeader);
  const costRows: [string, number][] = [
    [`Staff payroll (~${periodMonths} month${periodMonths === 1 ? "" : "s"})`, proratedPayroll],
    ...Array.from(expensesByCategory.entries()).map(([cat, v]) => [titleCase(cat), v] as [string, number]),
  ];
  costRows.forEach(([label, value]) => {
    const r = ws.addRow([label, value]);
    r.getCell(2).numFmt = KES_FMT;
    r.getCell(2).alignment = { horizontal: "right" };
  });
  const costTotalRow = ws.addRow(["Total costs", totalCosts]);
  costTotalRow.getCell(2).numFmt = KES_FMT;
  costTotalRow.getCell(2).alignment = { horizontal: "right" };
  styleTotalsRow(costTotalRow);
  ws.addRow([]);

  const netRow = ws.addRow(["Net profit", netProfit]);
  netRow.getCell(2).numFmt = KES_FMT;
  netRow.getCell(2).alignment = { horizontal: "right" };
  netRow.eachCell((c) => { c.font = { bold: true, size: 12 }; });

  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 20;
}

async function buildAccommodationSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Accommodation");
  const cols = ["Booking ID", "Guest", "Email", "Phone", "Room", "Room type", "Check-in", "Check-out", "Nights", "Rate/night (KES)", "Total (KES)", "Paid (KES)", "Balance (KES)", "Payment method", "Payment reference", "Status", "Notes"];
  addTitleBlock(ws, hotelName, "Accommodation Bookings", from, to, "Q");

  const [bookings, rooms] = await Promise.all([storage.listAccommodationBookings(), storage.listRooms()]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const filtered = bookings.filter((b) => inRange(b.checkIn, from, to)).sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const header = ws.addRow(cols);
  styleHeaderRow(header);

  let totalAmount = 0, totalPaid = 0, totalBalance = 0;
  filtered.forEach((b) => {
    const room = roomById.get(b.roomId);
    const nights = Math.max(0, Math.round((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86400000));
    const balance = b.totalAmount - b.amountPaid;
    totalAmount += b.totalAmount; totalPaid += b.amountPaid; totalBalance += balance;
    const row = ws.addRow([
      b.id, b.guestName, b.guestEmail ?? "", b.guestPhone ?? "", room?.name ?? "—", room?.type ? titleCase(room.type) : "—",
      b.checkIn, b.checkOut, nights, b.rate, b.totalAmount, b.amountPaid, balance, b.paymentMethod ? titleCase(b.paymentMethod) : "—", b.paymentReference ?? "—", titleCase(b.status), b.notes ?? "",
    ]);
    [10, 11, 12, 13].forEach((c) => { row.getCell(c).numFmt = KES_FMT; row.getCell(c).alignment = { horizontal: "right" }; });
  });

  if (filtered.length === 0) {
    ws.addRow(["No accommodation bookings in this period."]);
  } else {
    const totalsRow = ws.addRow(["", "", "", "", "", "", "", "", "Totals", "", totalAmount, totalPaid, totalBalance, "", "", "", ""]);
    [11, 12, 13].forEach((c) => { totalsRow.getCell(c).numFmt = KES_FMT; totalsRow.getCell(c).alignment = { horizontal: "right" }; });
    styleTotalsRow(totalsRow);
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [10, 18, 22, 14, 10, 10, 11, 11, 8, 14, 12, 12, 12, 14, 18, 12, 20]);
}

async function buildFacilitiesSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Conference & Movie Room");
  const cols = ["Booking ID", "Client", "Email", "Phone", "Facility", "Event date", "Start", "End", "Rate (KES)", "Total (KES)", "Paid (KES)", "Balance (KES)", "Payment method", "Payment reference", "Status", "Notes"];
  addTitleBlock(ws, hotelName, "Conference Room Bookings", from, to, "P");

  const [facilityBookings, facilities] = await Promise.all([storage.listFacilityBookings(), storage.listFacilities()]);
  const facilityById = new Map(facilities.map((f) => [f.id, f]));
  const filtered = facilityBookings.filter((b) => inRange(b.eventDate, from, to)).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const header = ws.addRow(cols);
  styleHeaderRow(header);

  let totalAmount = 0, totalPaid = 0, totalBalance = 0;
  filtered.forEach((b) => {
    const facility = facilityById.get(b.facilityId);
    const balance = b.totalAmount - b.amountPaid;
    totalAmount += b.totalAmount; totalPaid += b.amountPaid; totalBalance += balance;
    const row = ws.addRow([
      b.id, b.clientName, b.clientEmail ?? "", b.clientPhone ?? "", facility?.name ?? "—", b.eventDate,
      b.startTime ?? "—", b.endTime ?? "—", b.rate, b.totalAmount, b.amountPaid, balance, b.paymentMethod ? titleCase(b.paymentMethod) : "—", b.paymentReference ?? "—", titleCase(b.status), b.notes ?? "",
    ]);
    [9, 10, 11, 12].forEach((c) => { row.getCell(c).numFmt = KES_FMT; row.getCell(c).alignment = { horizontal: "right" }; });
  });

  if (filtered.length === 0) {
    ws.addRow(["No conference/movie room bookings in this period."]);
  } else {
    const totalsRow = ws.addRow(["", "", "", "", "", "", "", "Totals", "", totalAmount, totalPaid, totalBalance, "", "", "", ""]);
    [10, 11, 12].forEach((c) => { totalsRow.getCell(c).numFmt = KES_FMT; totalsRow.getCell(c).alignment = { horizontal: "right" }; });
    styleTotalsRow(totalsRow);
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [10, 18, 22, 14, 16, 11, 8, 8, 11, 12, 12, 12, 14, 18, 12, 20]);

  // Second table on the same sheet: Movie Room seat bookings.
  ws.addRow([]);
  ws.addRow([]);
  const movieTitleRow = ws.addRow(["Movie Room Seat Bookings"]);
  movieTitleRow.getCell(1).font = { bold: true, size: 13, color: { argb: BRAND } };

  const movieCols = ["Booking Ref", "Show", "Show date", "Start", "End", "Seat", "Guest", "Phone", "Ticket price (KES)", "Paid (KES)", "Balance (KES)", "Payment method", "Payment reference", "Status"];
  const movieHeaderRowIndex = ws.rowCount + 1;
  const movieHeader = ws.addRow(movieCols);
  styleHeaderRow(movieHeader);

  const [movieShows, movieSeatBookings] = await Promise.all([storage.listMovieShows(), storage.listMovieSeatBookings()]);
  const movieShowById = new Map(movieShows.map((s) => [s.id, s]));
  const filteredMovie = movieSeatBookings
    .filter((b) => inRange(movieShowById.get(b.showId)?.showDate ?? "", from, to))
    .sort((a, b) => (movieShowById.get(a.showId)?.showDate ?? "").localeCompare(movieShowById.get(b.showId)?.showDate ?? "") || a.seatRow.localeCompare(b.seatRow) || a.seatNumber - b.seatNumber);

  let movieTotalTicket = 0, movieTotalPaid = 0, movieTotalBalance = 0;
  filteredMovie.forEach((b) => {
    const show = movieShowById.get(b.showId);
    const balance = b.ticketPrice - b.amountPaid;
    movieTotalTicket += b.ticketPrice; movieTotalPaid += b.amountPaid; movieTotalBalance += balance;
    const row = ws.addRow([
      b.bookingRef, show?.name ?? "—", show?.showDate ?? "—", show?.startTime ?? "—", show?.endTime ?? "—",
      `${b.seatRow}${b.seatNumber}`, b.guestName, b.guestPhone ?? "", b.ticketPrice, b.amountPaid, balance, b.paymentMethod ? titleCase(b.paymentMethod) : "—", b.paymentReference ?? "—", titleCase(b.status),
    ]);
    [9, 10, 11].forEach((c) => { row.getCell(c).numFmt = KES_FMT; row.getCell(c).alignment = { horizontal: "right" }; });
  });

  if (filteredMovie.length === 0) {
    ws.addRow(["No movie room bookings in this period."]);
  } else {
    const movieTotalsRow = ws.addRow(["", "", "", "", "", "", "", "Totals", movieTotalTicket, movieTotalPaid, movieTotalBalance, "", "", ""]);
    [9, 10, 11].forEach((c) => { movieTotalsRow.getCell(c).numFmt = KES_FMT; movieTotalsRow.getCell(c).alignment = { horizontal: "right" }; });
    styleTotalsRow(movieTotalsRow);
  }

  movieCols.forEach((_, idx) => {
    const col = ws.getColumn(idx + 1);
    let max = col.width ?? 10;
    for (let r = movieHeaderRowIndex; r <= ws.rowCount; r++) {
      const text = String(ws.getCell(r, idx + 1).value ?? "");
      if (text.length + 3 > max) max = text.length + 3;
    }
    col.width = Math.min(max, 42);
  });
}

async function buildBarRestaurantSheets(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ordersWs = wb.addWorksheet("Bar & Restaurant Orders");
  const cols = ["Order ID", "Outlet", "Reference", "Customer", "Email", "Date", "Payment method", "Payment reference", "Status", "Total (KES)"];
  addTitleBlock(ordersWs, hotelName, "Bar & Restaurant Orders", from, to, "J");

  const [orders, allItems] = await Promise.all([storage.listOrders(), Promise.resolve<null>(null)]);
  const filtered = orders.filter((o) => inRange(o.orderDate, from, to)).sort((a, b) => a.orderDate.localeCompare(b.orderDate));

  const header = ordersWs.addRow(cols);
  styleHeaderRow(header);

  let barTotal = 0, restaurantTotal = 0, grandTotal = 0;
  filtered.forEach((o) => {
    if (o.status === "paid") {
      if (o.outlet === "bar") barTotal += o.totalAmount; else if (o.outlet === "restaurant") restaurantTotal += o.totalAmount;
      grandTotal += o.totalAmount;
    }
    const row = ordersWs.addRow([
      o.id, titleCase(o.outlet), o.reference ?? "—", o.customerName ?? "—", o.customerEmail ?? "",
      o.orderDate, o.paymentMethod ? titleCase(o.paymentMethod) : "—", o.paymentReference ?? "—", titleCase(o.status), o.totalAmount,
    ]);
    row.getCell(10).numFmt = KES_FMT;
    row.getCell(10).alignment = { horizontal: "right" };
    if (o.status === "cancelled") row.eachCell((c) => { c.font = { color: { argb: MUTED }, strike: true }; });
  });

  if (filtered.length === 0) {
    ordersWs.addRow(["No bar/restaurant orders in this period."]);
  } else {
    const totalsRow = ordersWs.addRow(["", "", "", "", "", "", "", "", "Paid total", grandTotal]);
    totalsRow.getCell(10).numFmt = KES_FMT;
    totalsRow.getCell(10).alignment = { horizontal: "right" };
    styleTotalsRow(totalsRow);
    ordersWs.addRow(["", "", "", "", "", "", "", "", "Bar (paid)", barTotal]).getCell(10).numFmt = KES_FMT;
    ordersWs.addRow(["", "", "", "", "", "", "", "", "Restaurant (paid)", restaurantTotal]).getCell(10).numFmt = KES_FMT;
  }

  ordersWs.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ordersWs.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ordersWs, [8, 12, 14, 18, 22, 11, 14, 18, 10, 12]);

  // Line-item detail — useful for menu performance analysis
  const itemsWs = wb.addWorksheet("Order Items Detail");
  const itemCols = ["Order ID", "Outlet", "Date", "Item", "Unit price (KES)", "Qty", "Subtotal (KES)"];
  addTitleBlock(itemsWs, hotelName, "Order Items Detail", from, to, "G");
  const itemHeader = itemsWs.addRow(itemCols);
  styleHeaderRow(itemHeader);

  const orderById = new Map(filtered.map((o) => [o.id, o]));
  let itemRowCount = 0;
  const itemTotalsByName = new Map<string, { qty: number; subtotal: number }>();
  for (const o of filtered) {
    const items = await storage.listOrderItems(o.id);
    for (const it of items) {
      itemRowCount++;
      const row = itemsWs.addRow([o.id, titleCase(o.outlet), o.orderDate, it.itemName, it.price, it.quantity, it.subtotal]);
      row.getCell(5).numFmt = KES_FMT; row.getCell(5).alignment = { horizontal: "right" };
      row.getCell(7).numFmt = KES_FMT; row.getCell(7).alignment = { horizontal: "right" };
      const agg = itemTotalsByName.get(it.itemName) ?? { qty: 0, subtotal: 0 };
      agg.qty += it.quantity; agg.subtotal += it.subtotal;
      itemTotalsByName.set(it.itemName, agg);
    }
  }
  if (itemRowCount === 0) {
    itemsWs.addRow(["No order line items in this period."]);
  }
  itemsWs.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: itemCols.length } };
  itemsWs.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(itemsWs, [8, 12, 11, 24, 14, 6, 14]);

  // Best-sellers summary sheet
  const topWs = wb.addWorksheet("Top Selling Items");
  addTitleBlock(topWs, hotelName, "Top Selling Items", from, to, "C");
  const topHeader = topWs.addRow(["Item", "Quantity sold", "Revenue (KES)"]);
  styleHeaderRow(topHeader);
  const sorted = Array.from(itemTotalsByName.entries()).sort((a, b) => b[1].subtotal - a[1].subtotal);
  sorted.forEach(([name, agg]) => {
    const row = topWs.addRow([name, agg.qty, agg.subtotal]);
    row.getCell(3).numFmt = KES_FMT; row.getCell(3).alignment = { horizontal: "right" };
  });
  if (sorted.length === 0) topWs.addRow(["No item sales in this period."]);
  autosizeColumns(topWs, [24, 14, 14]);
}

async function buildStaffSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string) {
  const ws = wb.addWorksheet("Staff & Payroll");
  const cols = ["Staff ID", "Name", "Role", "Department", "Status", "Monthly salary (KES)", "Hire date", "Phone", "Notes"];
  addTitleBlock(ws, hotelName, "Staff & Payroll Roster", undefined, undefined, "I");

  const staffList = await storage.listStaff();
  const header = ws.addRow(cols);
  styleHeaderRow(header);

  let totalActivePayroll = 0;
  const sorted = [...staffList].sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
  sorted.forEach((s) => {
    if (s.status === "active") totalActivePayroll += s.salary;
    const row = ws.addRow([s.id, s.name, s.role, titleCase(s.department), titleCase(s.status), s.salary, s.hireDate ?? "—", s.phone ?? "—", s.notes ?? ""]);
    row.getCell(6).numFmt = KES_FMT; row.getCell(6).alignment = { horizontal: "right" };
    if (s.status !== "active") row.eachCell((c) => { c.font = { color: { argb: MUTED }, italic: true }; });
  });

  if (sorted.length === 0) {
    ws.addRow(["No staff records yet."]);
  } else {
    const totalsRow = ws.addRow(["", "", "", "", "Total active monthly payroll", totalActivePayroll, "", "", ""]);
    totalsRow.getCell(6).numFmt = KES_FMT; totalsRow.getCell(6).alignment = { horizontal: "right" };
    styleTotalsRow(totalsRow);
  }
  ws.addRow([]);

  // Department breakdown
  const deptHeader = ws.addRow(["Department", "Active headcount", "Monthly payroll (KES)"]);
  styleHeaderRow(deptHeader);
  const deptMap = new Map<string, { count: number; payroll: number }>();
  staffList.filter((s) => s.status === "active").forEach((s) => {
    const agg = deptMap.get(s.department) ?? { count: 0, payroll: 0 };
    agg.count += 1; agg.payroll += s.salary;
    deptMap.set(s.department, agg);
  });
  Array.from(deptMap.entries()).sort((a, b) => b[1].payroll - a[1].payroll).forEach(([dept, agg]) => {
    const row = ws.addRow([titleCase(dept), agg.count, agg.payroll]);
    row.getCell(3).numFmt = KES_FMT; row.getCell(3).alignment = { horizontal: "right" };
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [8, 18, 14, 14, 10, 16, 11, 14, 20]);
}

async function buildExpensesSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Expenses & Maintenance");
  const cols = ["Expense ID", "Date", "Category", "Description", "Amount (KES)", "Paid to", "Notes"];
  addTitleBlock(ws, hotelName, "Expenses & Maintenance Costs", from, to, "G");

  const expenses = await storage.listExpenses();
  const filtered = expenses.filter((e) => inRange(e.date, from, to)).sort((a, b) => a.date.localeCompare(b.date));

  const header = ws.addRow(cols);
  styleHeaderRow(header);

  let total = 0;
  const byCategory = new Map<string, number>();
  filtered.forEach((e) => {
    total += e.amount;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    const row = ws.addRow([e.id, e.date, titleCase(e.category), e.description, e.amount, e.paidTo ?? "—", e.notes ?? ""]);
    row.getCell(5).numFmt = KES_FMT; row.getCell(5).alignment = { horizontal: "right" };
    if (e.category === "maintenance") {
      row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT } }; });
    }
  });

  if (filtered.length === 0) {
    ws.addRow(["No expenses recorded in this period."]);
  } else {
    const totalsRow = ws.addRow(["", "", "", "Total", total, "", ""]);
    totalsRow.getCell(5).numFmt = KES_FMT; totalsRow.getCell(5).alignment = { horizontal: "right" };
    styleTotalsRow(totalsRow);
  }
  ws.addRow([]);

  const catHeader = ws.addRow(["Category", "Total (KES)", "Share of costs"]);
  styleHeaderRow(catHeader);
  Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).forEach(([cat, amount]) => {
    const row = ws.addRow([titleCase(cat), amount, total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : "0%"]);
    row.getCell(2).numFmt = KES_FMT; row.getCell(2).alignment = { horizontal: "right" };
    if (cat === "maintenance") row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT } }; });
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [10, 11, 14, 30, 14, 18, 20]);
}

async function buildMaintenanceSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Maintenance");
  const cols = ["Ref", "Reported", "Category", "Title", "Location", "Priority", "Status", "Reported by", "Resolved", "Closed"];
  addTitleBlock(ws, hotelName, "Maintenance Issues", from, to, "J");

  const issues = await storage.listMaintenanceIssues();
  const inWindow = (ts: number) => {
    const d = new Date(ts).toISOString().slice(0, 10);
    return inRange(d, from, to);
  };
  const filtered = issues.filter((i) => inWindow(i.createdAt)).sort((a, b) => b.createdAt - a.createdAt);

  const header = ws.addRow(cols);
  styleHeaderRow(header);

  const byCategory = new Map<string, number>();
  const byStatus = new Map<string, number>();
  filtered.forEach((i) => {
    byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
    byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
    const row = ws.addRow([
      i.id,
      new Date(i.createdAt).toISOString().slice(0, 10),
      titleCase(i.category),
      i.title,
      i.location ?? "—",
      titleCase(i.priority),
      titleCase(i.status),
      i.reportedBy,
      i.resolvedAt ? new Date(i.resolvedAt).toISOString().slice(0, 10) : "—",
      i.closedAt ? new Date(i.closedAt).toISOString().slice(0, 10) : "—",
    ]);
    if (i.status === "open" || i.status === "in_progress") {
      row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT } }; });
    }
  });

  if (filtered.length === 0) {
    ws.addRow(["No maintenance issues reported in this period."]);
  }
  ws.addRow([]);

  const catHeader = ws.addRow(["Category", "Issues"]);
  styleHeaderRow(catHeader);
  Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    ws.addRow([titleCase(cat), count]);
  });
  ws.addRow([]);

  const statusHeader = ws.addRow(["Status", "Issues"]);
  styleHeaderRow(statusHeader);
  Array.from(byStatus.entries()).forEach(([status, count]) => {
    ws.addRow([titleCase(status), count]);
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [8, 12, 14, 30, 18, 10, 14, 20, 12, 12]);
}

async function buildTaxesSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Taxes");
  addTitleBlock(ws, hotelName, "Tax Collected (inclusive pricing)", from, to, "E");

  const [bookings, facilityBookings, orders, allTaxes, movieShows, movieSeatBookings] = await Promise.all([
    storage.listAccommodationBookings(),
    storage.listFacilityBookings(),
    storage.listOrders(),
    storage.listTaxes(),
    storage.listMovieShows(),
    storage.listMovieSeatBookings(),
  ]);
  const movieShowById = new Map(movieShows.map((s) => [s.id, s]));

  const perTax: Record<string, { rate: number; total: number }> = {};
  const bump = (name: string, rate: number, amount: number) => {
    if (!perTax[name]) perTax[name] = { rate, total: 0 };
    perTax[name].total += amount;
  };

  let grandTax = 0;
  let grandTaxedBase = 0;
  let grandAllRevenue = 0;

  const apply = (total: number, category: TaxCategory) => {
    const bd = computeInclusiveTaxBreakdown(total, allTaxes, category);
    grandAllRevenue += total;
    // Only fold this category's pre-tax base into the taxed-revenue total when a
    // tax actually applied to it — otherwise an untaxed category's full amount
    // (e.g. accommodation with no tax mapped) would silently inflate the figure
    // and make it look like a pre-tax base for revenue that was never taxed.
    if (bd.lines.length > 0) {
      grandTax += bd.totalTax;
      grandTaxedBase += bd.preTaxBase;
      for (const line of bd.lines) bump(line.name, line.ratePercent, line.amount);
    }
  };

  bookings.filter((b) => b.status !== "cancelled" && inRange(b.checkIn, from, to)).forEach((b) => apply(b.totalAmount, "accommodation"));
  facilityBookings.filter((b) => b.status !== "cancelled" && inRange(b.eventDate, from, to)).forEach((b) => apply(b.totalAmount, "facilities"));
  orders.filter((o) => o.status === "paid" && inRange(o.orderDate, from, to)).forEach((o) => apply(o.totalAmount, o.outlet === "bar" ? "bar" : "restaurant"));
  // Movie room bookings share the "facilities" tax mapping, matching invoice/receipt generation (see DOC_CATEGORY_TO_TAX_CATEGORY in documents.ts).
  movieSeatBookings
    .filter((b) => b.status !== "cancelled" && b.amountPaid > 0 && inRange(movieShowById.get(b.showId)?.showDate ?? "", from, to))
    .forEach((b) => apply(b.amountPaid, "facilities"));

  const header = ws.addRow(["Tax name", "Rate (%)", "Amount collected (KES)"]);
  styleHeaderRow(header);
  Object.entries(perTax).forEach(([name, v]) => {
    const row = ws.addRow([name, v.rate, Math.round(v.total)]);
    row.getCell(3).numFmt = KES_FMT; row.getCell(3).alignment = { horizontal: "right" };
  });
  if (Object.keys(perTax).length === 0) {
    ws.addRow(["No taxes configured or no tax-applicable revenue in this period.", "", ""]);
  }

  ws.addRow([]);
  const baseRow = ws.addRow(["Pre-tax base of taxed revenue", "", Math.round(grandTaxedBase)]);
  baseRow.getCell(3).numFmt = KES_FMT; baseRow.getCell(3).alignment = { horizontal: "right" };
  styleTotalsRow(baseRow);
  const taxRow = ws.addRow(["Total tax collected", "", Math.round(grandTax)]);
  taxRow.getCell(3).numFmt = KES_FMT; taxRow.getCell(3).alignment = { horizontal: "right" };
  styleTotalsRow(taxRow);
  const allRevRow = ws.addRow(["Total revenue in period (all categories)", "", Math.round(grandAllRevenue)]);
  allRevRow.getCell(3).numFmt = KES_FMT; allRevRow.getCell(3).alignment = { horizontal: "right" };
  styleTotalsRow(allRevRow);

  autosizeColumns(ws, [30, 12, 22]);
}

async function buildBudgetingSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Budgeting & Variance");
  const cols = ["Month", "Income Stream", "Budgeted (KES)", "Actual (KES)", "Variance (KES)", "Variance %"];
  addTitleBlock(ws, hotelName, "Budget vs Actual by Income Stream", from, to, "F");

  // Reports use full dates (YYYY-MM-DD); budgeting works in calendar months, so
  // collapse the range down to YYYY-MM, defaulting to the current month when unset.
  const nowMonth = new Date().toISOString().slice(0, 7);
  const fromMonth = from ? from.slice(0, 7) : nowMonth;
  const toMonth = to ? to.slice(0, 7) : nowMonth;

  const rows = await storage.getBudgetVariance(fromMonth, toMonth);

  const header = ws.addRow(cols);
  styleHeaderRow(header);

  let totalBudget = 0;
  let totalActual = 0;
  rows.forEach((r) => {
    totalBudget += r.budgetedAmount;
    totalActual += r.actualAmount;
    const variancePercent = r.budgetedAmount !== 0 ? (r.variance / r.budgetedAmount) * 100 : 0;
    const row = ws.addRow([r.month, r.incomeStreamLabel, r.budgetedAmount, r.actualAmount, r.variance, `${variancePercent.toFixed(1)}%`]);
    [3, 4, 5].forEach((c) => { row.getCell(c).numFmt = KES_FMT; row.getCell(c).alignment = { horizontal: "right" }; });
    if (r.variance < 0) row.getCell(5).font = { color: { argb: "FFB5502F" } };
  });

  if (rows.length === 0) {
    ws.addRow(["No budget lines entered for this period.", "", "", "", "", ""]);
  } else {
    const totalsRow = ws.addRow(["", "Total", totalBudget, totalActual, totalActual - totalBudget, ""]);
    [3, 4, 5].forEach((c) => { totalsRow.getCell(c).numFmt = KES_FMT; totalsRow.getCell(c).alignment = { horizontal: "right" }; });
    styleTotalsRow(totalsRow);
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [10, 20, 16, 16, 16, 12]);
}

async function buildAssetsSheet(wb: ExcelJS.Workbook, storage: IStorage, hotelName: string, from?: string, to?: string) {
  const ws = wb.addWorksheet("Assets & Depreciation");
  const cols = ["Asset #", "Name", "Category", "Acquisition Date", "Cost (KES)", "Useful Life (months)", "Accum. Depreciation (KES)", "Net Book Value (KES)", "Status", "Location"];
  addTitleBlock(ws, hotelName, "Asset Register & Depreciation", from, to, "J");

  const [assetRows, categories, allSchedules] = await Promise.all([
    storage.listAssets(),
    storage.listAssetCategories(),
    storage.listAssetDepreciationSchedules(),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const latestAccumByAsset = new Map<number, number>();
  allSchedules.forEach((s) => {
    const current = latestAccumByAsset.get(s.assetId) ?? 0;
    if (s.accumulatedDepreciation > current) latestAccumByAsset.set(s.assetId, s.accumulatedDepreciation);
  });

  const filtered = assetRows.filter((a) => inRange(a.acquisitionDate, from, to)).sort((a, b) => a.assetNumber.localeCompare(b.assetNumber));

  const header = ws.addRow(cols);
  styleHeaderRow(header);

  let totalCost = 0;
  let totalAccum = 0;
  filtered.forEach((a) => {
    const accum = latestAccumByAsset.get(a.id) ?? 0;
    const nbv = a.acquisitionCost - accum;
    totalCost += a.acquisitionCost;
    totalAccum += accum;
    const row = ws.addRow([
      a.assetNumber, a.name, categoryById.get(a.categoryId)?.name ?? "—", a.acquisitionDate,
      a.acquisitionCost, a.usefulLifeMonths, accum, nbv, titleCase(a.status), a.location ?? "—",
    ]);
    [5, 7, 8].forEach((c) => { row.getCell(c).numFmt = KES_FMT; row.getCell(c).alignment = { horizontal: "right" }; });
    if (a.status === "disposed") row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT } }; });
  });

  if (filtered.length === 0) {
    ws.addRow(["No assets registered in this period."]);
  } else {
    const totalsRow = ws.addRow(["", "", "", "Total", totalCost, "", totalAccum, totalCost - totalAccum, "", ""]);
    [5, 7, 8].forEach((c) => { totalsRow.getCell(c).numFmt = KES_FMT; totalsRow.getCell(c).alignment = { horizontal: "right" }; });
    styleTotalsRow(totalsRow);
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];
  autosizeColumns(ws, [12, 24, 18, 16, 16, 16, 20, 18, 14, 18]);
}

export async function buildReportsWorkbook(
  storage: IStorage,
  opts: { from?: string; to?: string; sheet: ReportSheetKey | "all" }
): Promise<ExcelJS.Workbook> {
  const settings = await storage.getSettings();
  // "...all printing and messaging from the test database will start with
  // the words 'Test company'" (Phase 6 source requirement) — applies to
  // exported reports too, not just PDFs.
  const rawHotelName = settings.hotelName || "The Chekata";
  const hotelName = getCurrentEnvironment() === "test" ? `TEST COMPANY — ${rawHotelName}` : rawHotelName;
  const { from, to, sheet } = opts;

  const wb = new ExcelJS.Workbook();
  wb.creator = hotelName;
  wb.created = new Date();

  const include = (key: ReportSheetKey) => sheet === "all" || sheet === key;

  if (include("overview")) await buildOverviewSheet(wb, storage, hotelName, from, to);
  if (include("accommodation")) await buildAccommodationSheet(wb, storage, hotelName, from, to);
  if (include("facilities")) await buildFacilitiesSheet(wb, storage, hotelName, from, to);
  if (include("bar-restaurant")) await buildBarRestaurantSheets(wb, storage, hotelName, from, to);
  if (include("staff")) await buildStaffSheet(wb, storage, hotelName);
  if (include("expenses")) await buildExpensesSheet(wb, storage, hotelName, from, to);
  if (include("maintenance")) await buildMaintenanceSheet(wb, storage, hotelName, from, to);
  if (include("taxes")) await buildTaxesSheet(wb, storage, hotelName, from, to);
  if (include("budgeting")) await buildBudgetingSheet(wb, storage, hotelName, from, to);
  if (include("assets")) await buildAssetsSheet(wb, storage, hotelName, from, to);

  return wb;
}
