import fs from "node:fs";
import path from "node:path";
import { liveSql, testSql, isTestDbConfigured } from "./storage";
import { UPLOADS_ROOT, TEST_UPLOADS_ROOT } from "./uploads";

// Every business-data table that "Copy live to test" clones wholesale from
// Live into Test, replacing whatever was there before. Deliberately
// excludes:
//   - sessions            Test always authenticates through Live's session
//                          store (server/session-store.ts); Test's own
//                          sessions table is never used.
//   - test_message_log    Local bookkeeping for whichever database it
//                          lives in — not cloned data.
//   - test_copy_runs      The audit trail of copy operations, always kept
//                          on Live regardless of which DB is being copied.
//   - password_reset_tokens  Live, time-limited security tokens. Copying
//                          them into Test would be a needless security
//                          surface for zero functional benefit.
export const COPY_TABLES = [
  "accommodation_bookings",
  "accounting_periods",
  "approval_matrix_rules",
  "asset_categories",
  "asset_depreciation_schedules",
  "assets",
  "attendance_records",
  "bank_accounts",
  "bank_reconciliations",
  "budget_lines",
  "chart_of_accounts",
  "definition_list_items",
  "definition_lists",
  "document_sequences",
  "documents",
  "expenses",
  "facilities",
  "facility_bookings",
  "goods_receipt_lines",
  "goods_receipts",
  "guest_identity_documents",
  "internal_requisition_lines",
  "internal_requisitions",
  "inventory_items",
  "journal_entries",
  "journal_entry_lines",
  "leave_balances",
  "leave_requests",
  "leave_types",
  "loan_returns",
  "maintenance_issues",
  "menu_items",
  "meter_readings",
  "movie_seat_bookings",
  "movie_shows",
  "order_items",
  "orders",
  "paye_bands",
  "payment_vouchers",
  "payroll_lines",
  "payroll_runs",
  "permission_table_rules",
  "purchase_order_lines",
  "purchase_orders",
  "purchase_requisition_lines",
  "purchase_requisitions",
  "recipe_ingredients",
  "recipes",
  "rent_invoice_payments",
  "rent_invoices",
  "rooms",
  "settings",
  "shops",
  "staff",
  "statutory_rate_tables",
  "stock_ledger",
  "stores",
  "suppliers",
  "tables",
  "taxes",
  "tenancy_leases",
  "tenants",
  "users",
] as const;

// Columns that hold `/uploads/...` URLs pointing at files on local disk.
// After the row copy, these get rewritten in Test to point at the isolated
// `/test-uploads/...` copy instead of the live files.
const FILE_URL_COLUMNS: { table: string; columns: string[] }[] = [
  { table: "guest_identity_documents", columns: ["front_image_url", "back_image_url"] },
  { table: "staff", columns: ["photo_url"] },
  { table: "tenancy_leases", columns: ["document_url"] },
  { table: "assets", columns: ["photo_url"] },
];

const ROW_BATCH_SIZE = 300;

export interface CopyRunProgress {
  id: number;
  startedByUserId: number | null;
  startedByUsername: string | null;
  status: "running" | "done" | "error";
  currentStep: string | null;
  tablesDone: number;
  tablesTotal: number;
  rowsCopied: number;
  filesCopied: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function rowToProgress(row: any): CopyRunProgress {
  return {
    id: row.id,
    startedByUserId: row.started_by_user_id,
    startedByUsername: row.started_by_username,
    status: row.status,
    currentStep: row.current_step,
    tablesDone: row.tables_done,
    tablesTotal: row.tables_total,
    rowsCopied: row.rows_copied,
    filesCopied: row.files_copied,
    error: row.error,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

// The audit trail always lives on Live, regardless of which environment the
// triggering request happens to be in — hence the direct `liveSql` use
// instead of the environment-routed `sql` proxy elsewhere in the app.
export async function getLatestCopyRun(): Promise<CopyRunProgress | null> {
  const rows = await liveSql`SELECT * FROM test_copy_runs ORDER BY id DESC LIMIT 1`;
  return rows[0] ? rowToProgress(rows[0]) : null;
}

async function isCopyAlreadyRunning(): Promise<boolean> {
  const latest = await getLatestCopyRun();
  return latest?.status === "running";
}

async function createRun(startedByUserId: number, startedByUsername: string): Promise<number> {
  const [row] = await liveSql`
    INSERT INTO test_copy_runs (started_by_user_id, started_by_username, status, current_step, tables_total, started_at)
    VALUES (${startedByUserId}, ${startedByUsername}, 'running', 'Starting…', ${COPY_TABLES.length}, ${Date.now()})
    RETURNING id
  `;
  return row.id;
}

async function updateRun(id: number, patch: Partial<{ currentStep: string; tablesDone: number; rowsCopied: number; filesCopied: number }>) {
  const sets: string[] = [];
  const values: any[] = [];
  if (patch.currentStep !== undefined) { sets.push(`current_step = $${sets.length + 1}`); values.push(patch.currentStep); }
  if (patch.tablesDone !== undefined) { sets.push(`tables_done = $${sets.length + 1}`); values.push(patch.tablesDone); }
  if (patch.rowsCopied !== undefined) { sets.push(`rows_copied = $${sets.length + 1}`); values.push(patch.rowsCopied); }
  if (patch.filesCopied !== undefined) { sets.push(`files_copied = $${sets.length + 1}`); values.push(patch.filesCopied); }
  if (sets.length === 0) return;
  values.push(id);
  await liveSql.unsafe(`UPDATE test_copy_runs SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
}

async function finishRun(id: number, status: "done" | "error", error?: string) {
  await liveSql`
    UPDATE test_copy_runs SET status = ${status}, error = ${error ?? null}, finished_at = ${Date.now()}
    WHERE id = ${id}
  `;
}

async function copyTable(table: string): Promise<number> {
  await testSql!.unsafe(`TRUNCATE TABLE ${table} RESTART IDENTITY`);
  const rows = await liveSql.unsafe(`SELECT * FROM ${table}`);
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += ROW_BATCH_SIZE) {
    const batch = rows.slice(i, i + ROW_BATCH_SIZE);
    await testSql!`INSERT INTO ${testSql!(table)} ${testSql!(batch, ...columns)}`;
  }
  if (columns.includes("id")) {
    await testSql!.unsafe(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`,
    );
  }
  return rows.length;
}

async function rewriteFileUrls() {
  for (const { table, columns } of FILE_URL_COLUMNS) {
    for (const col of columns) {
      await testSql!.unsafe(
        `UPDATE ${table} SET ${col} = regexp_replace(${col}, '^/uploads/', '/test-uploads/') WHERE ${col} LIKE '/uploads/%'`,
      );
    }
  }
}

function countFilesRecursive(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(full);
    else count += 1;
  }
  return count;
}

async function copyUploadedFiles(): Promise<number> {
  if (!fs.existsSync(UPLOADS_ROOT)) return 0;
  await fs.promises.rm(TEST_UPLOADS_ROOT, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(TEST_UPLOADS_ROOT), { recursive: true });
  await fs.promises.cp(UPLOADS_ROOT, TEST_UPLOADS_ROOT, { recursive: true });
  return countFilesRecursive(TEST_UPLOADS_ROOT);
}

// Runs the whole copy in the background and reports progress via the
// `test_copy_runs` table on Live, which the Settings page polls. Rejects
// immediately (before starting anything) if Test isn't configured or a
// copy is already in flight; everything after that point runs detached —
// the caller does not (and should not) await this for the HTTP response.
export async function startCopyLiveToTest(startedByUserId: number, startedByUsername: string): Promise<{ runId: number }> {
  if (!isTestDbConfigured() || !testSql) {
    throw new Error("The Test database is not configured on this server.");
  }
  if (await isCopyAlreadyRunning()) {
    throw new Error("A copy is already in progress. Wait for it to finish before starting another.");
  }

  const runId = await createRun(startedByUserId, startedByUsername);

  (async () => {
    let rowsCopied = 0;
    let tablesDone = 0;
    try {
      for (const table of COPY_TABLES) {
        await updateRun(runId, { currentStep: `Copying ${table}…` });
        const n = await copyTable(table);
        rowsCopied += n;
        tablesDone += 1;
        await updateRun(runId, { tablesDone, rowsCopied });
      }

      await updateRun(runId, { currentStep: "Pointing document/photo links at the isolated Test file copy…" });
      await rewriteFileUrls();

      await updateRun(runId, { currentStep: "Copying uploaded files (guest IDs, leases, staff & asset photos)…" });
      const filesCopied = await copyUploadedFiles();
      await updateRun(runId, { filesCopied, currentStep: "Done" });

      await finishRun(runId, "done");
    } catch (err: any) {
      await finishRun(runId, "error", err?.message ?? "Unknown error during copy.");
    }
  })();

  return { runId };
}
