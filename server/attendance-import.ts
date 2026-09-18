// Attendance bulk-upload: parses a filled-in copy of the "Time & Attendance
// Upload Template" workbook and validates every row against live Staff,
// Leave Types, and Shift Code data — nothing about the valid option lists is
// hardcoded here beyond the fixed Attendance Status vocabulary the app's
// daily-entry screen already uses.
import ExcelJS from "exceljs";
import type { Staff, LeaveType, DefinitionListItem } from "@shared/schema";

export interface AttendanceImportRow {
  rowNumber: number;
  employeeIdRaw: string;
  employeeName: string;
  staffId: number | null;
  date: string;
  shiftCode: string | null;
  status: string | null; // canonical: present | absent | on_leave | public_holiday | rest_day | half_day
  statusRaw: string;
  timeIn: string | null;
  timeOut: string | null;
  overnight: boolean | null;
  hoursWorked: number;
  overtimeHours: number;
  leaveTypeId: number | null;
  leaveTypeRaw: string | null;
  department: string | null;
  notes: string | null;
  errors: string[];
  warnings: string[];
}

export interface AttendanceImportResult {
  ok: boolean;
  topLevelError?: string;
  rows: AttendanceImportRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
}

const STATUS_MAP: Record<string, string> = {
  present: "present",
  absent: "absent",
  leave: "on_leave",
  "on leave": "on_leave",
  on_leave: "on_leave",
  "public holiday": "public_holiday",
  public_holiday: "public_holiday",
  "rest day": "rest_day",
  rest_day: "rest_day",
  "half day": "half_day",
  half_day: "half_day",
};

const HEADER_MAP: Record<string, string> = {
  "employee id": "employeeId",
  "employee name": "employeeName",
  date: "date",
  "shift code": "shiftCode",
  status: "status",
  "time in": "timeIn",
  "time out": "timeOut",
  "overnight (y/n)": "overnight",
  overnight: "overnight",
  "hours worked": "hoursWorked",
  "overtime hours": "overtimeHours",
  "leave type": "leaveType",
  "department/location": "department",
  department: "department",
  remarks: "notes",
};

const REQUIRED_HEADER_LABELS: Record<string, string> = {
  employeeId: "Employee ID",
  date: "Date",
  status: "Status",
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase();
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Excel date-formatted cells surface as JS Date objects via ExcelJS.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "object" && v !== null) {
    if ("text" in (v as any)) return String((v as any).text ?? "");
    if ("result" in (v as any)) return String((v as any).result ?? "");
  }
  return String(v).trim();
}

function timeToMinutes(t: string): number | null {
  const m = /^([0-2]?\d):([0-5]\d)$/.exec(t.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h > 23) return null;
  return h * 60 + mm;
}

const EMPTY_RESULT = (topLevelError: string): AttendanceImportResult => ({
  ok: false,
  topLevelError,
  rows: [],
  totalRows: 0,
  validCount: 0,
  errorCount: 0,
});

export async function parseAttendanceWorkbook(
  buffer: Buffer,
  staffList: Staff[],
  leaveTypesList: LeaveType[],
  shiftCodeItems: DefinitionListItem[],
): Promise<AttendanceImportResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    return EMPTY_RESULT("Could not read this file — please upload a valid .xlsx file exported from the Time & Attendance Upload Template.");
  }

  let ws = wb.getWorksheet("Attendance");
  if (!ws) {
    ws = wb.worksheets.find((s) => {
      const headerRow = s.getRow(1);
      let found = false;
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        if (normalizeHeader(cell.value) === "employee id") found = true;
      });
      return found;
    });
  }
  if (!ws) {
    return EMPTY_RESULT("No worksheet named \"Attendance\" (or containing an Employee ID column) was found in this file.");
  }

  const headerRow = ws.getRow(1);
  const colMap: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const field = HEADER_MAP[normalizeHeader(cell.value)];
    if (field && !(field in colMap)) colMap[field] = colNumber;
  });

  const missing = Object.keys(REQUIRED_HEADER_LABELS).filter((f) => !(f in colMap));
  if (missing.length) {
    const labels = missing.map((f) => REQUIRED_HEADER_LABELS[f]).join(", ");
    return EMPTY_RESULT(`The uploaded file is missing required column(s): ${labels}. Please use the Time & Attendance Upload Template without renaming its columns.`);
  }

  const staffById = new Map(staffList.map((s) => [s.id, s]));
  const leaveTypeByName = new Map(leaveTypesList.map((lt) => [lt.name.trim().toLowerCase(), lt]));
  const shiftCodeCanon = new Map<string, string>();
  for (const item of shiftCodeItems) {
    shiftCodeCanon.set(item.code.trim().toLowerCase(), item.code);
    shiftCodeCanon.set(item.label.trim().toLowerCase(), item.code);
  }

  const rows: AttendanceImportRow[] = [];
  const seenKeys = new Set<string>();
  const lastRow = Math.max(ws.actualRowCount || 0, ws.rowCount || 0);

  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (!row || row.cellCount === 0) continue;
    const get = (field: string): string => {
      const col = colMap[field];
      if (!col) return "";
      return cellToString(row.getCell(col).value);
    };

    const employeeIdRaw = get("employeeId");
    const employeeNameCol = get("employeeName");
    const dateRaw = get("date");
    const shiftCodeRaw = get("shiftCode");
    const statusRaw = get("status");
    const timeInRaw = get("timeIn");
    const timeOutRaw = get("timeOut");
    const overnightRaw = get("overnight");
    const hoursWorkedRaw = get("hoursWorked");
    const overtimeHoursRaw = get("overtimeHours");
    const leaveTypeRaw = get("leaveType");
    const departmentRaw = get("department");
    const notesRaw = get("notes");

    if (!employeeIdRaw && !dateRaw && !statusRaw) continue; // fully blank row

    const errors: string[] = [];
    const warnings: string[] = [];

    // ---- Employee ID -> staff match ----
    let staffId: number | null = null;
    let employeeName = employeeNameCol;
    if (!employeeIdRaw) {
      errors.push("Employee ID is required.");
    } else {
      const digits = employeeIdRaw.replace(/[^0-9]/g, "");
      const parsed = digits ? parseInt(digits, 10) : NaN;
      if (Number.isNaN(parsed)) {
        errors.push(`Employee ID "${employeeIdRaw}" is not a recognized format (expected the numeric Staff ID, e.g. "12" or "EMP-0012").`);
      } else {
        const match = staffById.get(parsed);
        if (!match) {
          errors.push(`Employee ID "${employeeIdRaw}" was not found in the Staff Register.`);
        } else {
          staffId = match.id;
          employeeName = match.name;
        }
      }
    }

    // ---- Date ----
    let date = "";
    if (!dateRaw) {
      errors.push("Date is required.");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      errors.push(`Date "${dateRaw}" must be in YYYY-MM-DD format.`);
    } else {
      date = dateRaw;
    }

    // ---- Duplicate within file ----
    if (staffId !== null && date) {
      const key = `${staffId}::${date}`;
      if (seenKeys.has(key)) errors.push("Duplicate row for this Employee ID + Date elsewhere in the uploaded file.");
      else seenKeys.add(key);
    }

    // ---- Status ----
    let status: string | null = null;
    if (!statusRaw) {
      errors.push("Status is required.");
    } else {
      status = STATUS_MAP[statusRaw.trim().toLowerCase()] ?? null;
      if (!status) errors.push(`Status "${statusRaw}" is not recognized. Use Present, Absent, Leave, Public Holiday, Rest Day, or Half Day.`);
    }

    // ---- Shift code (optional, validated against the live Shift Code list) ----
    let shiftCode: string | null = null;
    if (shiftCodeRaw) {
      const canon = shiftCodeCanon.get(shiftCodeRaw.trim().toLowerCase());
      if (!canon) warnings.push(`Shift Code "${shiftCodeRaw}" is not in the Shift Code list — left blank.`);
      else shiftCode = canon;
    }

    // ---- Time in/out, overnight, hours worked ----
    let timeIn: string | null = null;
    let timeOut: string | null = null;
    let overnight = false;
    let hoursWorked = 0;
    const hoursOverride = !!hoursWorkedRaw && !timeInRaw && !timeOutRaw;

    if (status === "present" && !hoursOverride) {
      let timeInMin: number | null = null;
      let timeOutMin: number | null = null;
      if (!timeInRaw) errors.push("Time In is required when Status is Present (or enter Hours Worked directly for day-rate staff without clock times).");
      else {
        timeInMin = timeToMinutes(timeInRaw);
        if (timeInMin === null) errors.push(`Time In "${timeInRaw}" must be in HH:MM (24-hour) format.`);
        else timeIn = timeInRaw.trim();
      }
      if (!timeOutRaw) errors.push("Time Out is required when Status is Present (or enter Hours Worked directly for day-rate staff without clock times).");
      else {
        timeOutMin = timeToMinutes(timeOutRaw);
        if (timeOutMin === null) errors.push(`Time Out "${timeOutRaw}" must be in HH:MM (24-hour) format.`);
        else timeOut = timeOutRaw.trim();
      }
      if (!overnightRaw) {
        errors.push("Overnight (Y/N) is required when Status is Present.");
      } else {
        const v = overnightRaw.trim().toUpperCase();
        if (v !== "Y" && v !== "N") errors.push(`Overnight (Y/N) "${overnightRaw}" must be Y or N.`);
        else overnight = v === "Y";
      }
      if (hoursWorkedRaw) {
        const n = Number(hoursWorkedRaw);
        if (Number.isNaN(n) || n < 0) errors.push(`Hours Worked "${hoursWorkedRaw}" must be a non-negative number.`);
        else hoursWorked = Math.round(n * 100) / 100;
      } else if (timeInMin !== null && timeOutMin !== null) {
        let diff = timeOutMin - timeInMin;
        if (overnight) diff = diff < 0 ? diff + 24 * 60 : diff;
        else if (diff < 0) errors.push("Time Out is earlier than Time In but Overnight (Y/N) was set to N.");
        hoursWorked = Math.round((diff / 60) * 100) / 100;
      }
    } else if (hoursOverride) {
      const n = Number(hoursWorkedRaw);
      if (Number.isNaN(n) || n < 0) errors.push(`Hours Worked "${hoursWorkedRaw}" must be a non-negative number.`);
      else hoursWorked = Math.round(n * 100) / 100;
    } else if (hoursWorkedRaw) {
      // Hours worked supplied for a non-Present status (e.g. a partial paid leave day) — accept as given.
      const n = Number(hoursWorkedRaw);
      if (Number.isNaN(n) || n < 0) errors.push(`Hours Worked "${hoursWorkedRaw}" must be a non-negative number.`);
      else hoursWorked = Math.round(n * 100) / 100;
    }

    // ---- Overtime hours ----
    let overtimeHours = 0;
    if (overtimeHoursRaw) {
      const n = Number(overtimeHoursRaw);
      if (Number.isNaN(n) || n < 0) errors.push(`Overtime Hours "${overtimeHoursRaw}" must be a non-negative number.`);
      else overtimeHours = Math.round(n * 100) / 100;
    }

    // ---- Leave type (required when Status = Leave, matched against the Leave module's register) ----
    let leaveTypeId: number | null = null;
    if (status === "on_leave") {
      if (!leaveTypeRaw) errors.push("Leave Type is required when Status is Leave.");
      else {
        const match = leaveTypeByName.get(leaveTypeRaw.trim().toLowerCase());
        if (!match) errors.push(`Leave Type "${leaveTypeRaw}" was not found in the Leave Types register.`);
        else leaveTypeId = match.id;
      }
    }

    // ---- Department/Location: informational cross-check only, never overwrites Staff data ----
    if (departmentRaw && staffId !== null) {
      const s = staffById.get(staffId);
      if (s?.department && departmentRaw.trim().toLowerCase() !== s.department.trim().toLowerCase()) {
        warnings.push(`Department/Location "${departmentRaw}" does not match this staff member's recorded department ("${s.department}") — shown for reference only, not saved.`);
      }
    }

    rows.push({
      rowNumber: r,
      employeeIdRaw,
      employeeName,
      staffId,
      date,
      shiftCode,
      status,
      statusRaw,
      timeIn,
      timeOut,
      overnight: status === "present" ? overnight : null,
      hoursWorked,
      overtimeHours,
      leaveTypeId,
      leaveTypeRaw: leaveTypeRaw || null,
      department: departmentRaw || null,
      notes: notesRaw || null,
      errors,
      warnings,
    });
  }

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return {
    ok: true,
    rows,
    totalRows: rows.length,
    validCount: rows.length - errorCount,
    errorCount,
  };
}
