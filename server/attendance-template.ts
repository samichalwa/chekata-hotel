// Generates the "Time & Attendance Upload Template" workbook on demand, pre-filled
// with the CURRENT active staff list and CURRENT Status / Shift Code / Leave Type
// option lists — nothing here is a static file, so admin changes to any of those
// lists are reflected in the next template download automatically.
import ExcelJS from "exceljs";
import type { IStorage } from "./storage";

const BRAND = "FFB5502F";
const BRAND_DARK = "FF2A2118";
const MUTED = "FF7A7974";

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  row.height = 20;
}

export async function buildAttendanceTemplateWorkbook(storage: IStorage): Promise<ExcelJS.Workbook> {
  const [staffList, leaveTypes, statusList, shiftList] = await Promise.all([
    storage.listStaff(),
    storage.listLeaveTypes(),
    storage.getDefinitionListByKey("attendance_status"),
    storage.getDefinitionListByKey("shift_code"),
  ]);
  const activeStaff = staffList.filter((s) => s.status === "active").sort((a, b) => a.name.localeCompare(b.name));
  const statusItems = statusList ? await storage.listDefinitionListItems(statusList.id) : [];
  const shiftItems = shiftList ? await storage.listDefinitionListItems(shiftList.id) : [];
  const statusLabels = statusItems.filter((i) => i.active).map((i) => i.label);
  const shiftLabels = shiftItems.filter((i) => i.active).map((i) => i.code === "OFF" ? "OFF" : i.label);
  const leaveTypeNames = leaveTypes.map((lt) => lt.name);

  const wb = new ExcelJS.Workbook();
  wb.creator = "The Chekata";
  wb.created = new Date();

  // ---- Instructions sheet ----
  const info = wb.addWorksheet("Instructions", { properties: { tabColor: { argb: BRAND } } });
  info.getColumn(1).width = 110;
  const lines: [string, boolean][] = [
    ["The Chekata — Time & Attendance Upload Template", true],
    ["", false],
    ["HOW TO USE THIS TEMPLATE", true],
    ["1. Go to the 'Attendance' sheet. It is pre-filled with Employee ID and Employee Name for every active staff member.", false],
    ["2. Add one row per employee per day worked (or absent/on leave) within the pay period. Copy the Employee ID/Name rows down as needed.", false],
    ["3. Employee ID must exactly match the ID shown here (generated from the Staff Register) — this is what the system uses to match records. Employee Name is for your reference only.", false],
    ["4. Status, Shift Code, and Leave Type are dropdown lists — click the cell and choose from the list rather than typing freely.", false],
    ["5. Time In / Time Out are only required when Status = Present. Leave them blank for Absent, Leave, Public Holiday, or Rest Day.", false],
    ["6. Hours Worked is auto-calculated from Time In/Out for clocked staff. For temporary/day-rate staff without clock times, enter Hours Worked directly and leave Time In/Out/Overnight blank.", false],
    ["7. Overtime Hours is optional and entered separately — overtime should already have supervisor approval before you record it here.", false],
    ["8. Leave Type is only needed when Status = Leave. It must match a Leave Type already set up in the Leave module.", false],
    ["9. Do not add duplicate rows for the same Employee ID + Date — the upload will flag these as errors.", false],
    ["10. Save the file and upload it from the Attendance page's Bulk Upload tab. You will see a preview with any errors highlighted before anything is posted.", false],
    ["", false],
    ["COLUMN REFERENCE", true],
    ["Employee ID — Required. Must match the Staff Register (pre-filled on the Attendance sheet).", false],
    ["Employee Name — Optional, display only.", false],
    ["Date — Required. Format YYYY-MM-DD.", false],
    [`Shift Code — Optional. Current options: ${shiftLabels.join(", ") || "(none configured)"}.`, false],
    [`Status — Required. Current options: ${statusLabels.join(", ") || "(none configured)"}.`, false],
    ["Time In / Time Out — Required only if Status = Present. Format HH:MM (24-hour).", false],
    ["Overnight (Y/N) — Required only if Status = Present. Set Y when Time Out is earlier than Time In (shift crosses midnight).", false],
    ["Hours Worked — Auto-calculated if Time In/Out given; enter directly for day-rate staff.", false],
    ["Overtime Hours — Optional. Pre-approved overtime only.", false],
    [`Leave Type — Required only if Status = Leave. Current options: ${leaveTypeNames.join(", ") || "(none configured)"}.`, false],
    ["Department/Location — Optional, for reference only (compared against the Staff Register but never overwrites it).", false],
    ["Remarks — Optional free text.", false],
  ];
  lines.forEach(([text, bold], i) => {
    const cell = info.getCell(i + 1, 1);
    cell.value = text;
    cell.font = bold ? { bold: true, size: text.includes("—") ? 12 : 13, color: { argb: BRAND_DARK } } : { size: 11, color: { argb: MUTED } };
    cell.alignment = { wrapText: true, vertical: "top" };
  });

  // ---- Hidden lookup sheet backing the dropdown lists ----
  const lookup = wb.addWorksheet("Lists", { state: "veryHidden" });
  statusLabels.forEach((v, i) => (lookup.getCell(i + 1, 1).value = v));
  shiftLabels.forEach((v, i) => (lookup.getCell(i + 1, 2).value = v));
  leaveTypeNames.forEach((v, i) => (lookup.getCell(i + 1, 3).value = v));
  lookup.getCell(1, 5).value = "Y";
  lookup.getCell(2, 5).value = "N";

  // ---- Attendance sheet ----
  const ws = wb.addWorksheet("Attendance", { properties: { tabColor: { argb: BRAND } } });
  const headers = [
    "Employee ID", "Employee Name", "Date", "Shift Code", "Status", "Time In", "Time Out",
    "Overnight (Y/N)", "Hours Worked", "Overtime Hours", "Leave Type", "Department/Location", "Remarks",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws.getRow(1));
  ws.columns = [
    { width: 12 }, { width: 22 }, { width: 12 }, { width: 10 }, { width: 14 },
    { width: 9 }, { width: 9 }, { width: 14 }, { width: 12 }, { width: 14 },
    { width: 16 }, { width: 20 }, { width: 28 },
  ];

  const maxDataRows = Math.max(activeStaff.length, 1) + 400; // generous headroom for multi-day entry
  activeStaff.forEach((s, i) => {
    const r = ws.getRow(i + 2);
    r.getCell(1).value = `EMP-${String(s.id).padStart(4, "0")}`;
    r.getCell(2).value = s.name;
    r.getCell(12).value = s.department;
  });

  for (let r = 2; r <= maxDataRows + 1; r++) {
    ws.getCell(`E${r}`).dataValidation = statusLabels.length
      ? { type: "list", allowBlank: true, formulae: [`Lists!$A$1:$A$${statusLabels.length}`] }
      : undefined as any;
    ws.getCell(`D${r}`).dataValidation = shiftLabels.length
      ? { type: "list", allowBlank: true, formulae: [`Lists!$B$1:$B$${shiftLabels.length}`] }
      : undefined as any;
    ws.getCell(`K${r}`).dataValidation = leaveTypeNames.length
      ? { type: "list", allowBlank: true, formulae: [`Lists!$C$1:$C$${leaveTypeNames.length}`] }
      : undefined as any;
    ws.getCell(`H${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ["Lists!$E$1:$E$2"] };
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];

  return wb;
}
