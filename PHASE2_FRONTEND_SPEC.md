# Phase 2 Frontend Build Spec — Inventory, Purchasing, Internal Requisitions

Backend (schema.ts, storage.ts, auth.ts, routes.ts) is DONE and verified (tsc clean vs
baseline, build succeeds). Your job is ONLY the frontend: 3 new pages + routing + sidebar
+ settings permission checkboxes. Do not touch server/ or shared/schema.ts.

## Step 0 — Read these first, in this repo, for exact conventions to copy

- `client/src/pages/finance.tsx` — react-hook-form + zod + react-query mutation patterns,
  dialog forms, status badges, line-item tables (see the Journal Entry section for
  multi-line forms with add/remove line buttons), `formatKES`/`formatDate`/`todayISO`
  from `@/lib/format`, `data-testid` conventions (`button-...`, `input-...`, `select-...`,
  `row-...`).
- `client/src/pages/maintenance.tsx` — simpler status-transition page (open → resolved →
  closed) as a model for approve/reject/cancel status buttons with confirmation dialogs.
- `client/src/pages/system-admin.tsx` — CRUD dialogs for simple master-data tables
  (mirrors what Stores/Suppliers/Inventory Items need) and the existing
  `definitionLists`/`definitionListItems` admin UI for reference (do NOT duplicate that
  admin UI — Phase 2 pages only ever *read* definition list items via the new endpoint
  below, never manage the lists themselves).
- `client/src/components/app-sidebar.tsx` — sidebar entry array shape `{ title, url, icon, key }`.
- `client/src/App.tsx` — route registration pattern `<Route path="/x" component={() => <Guarded moduleKey="x" component={X} />} />`.
- `client/src/pages/settings.tsx` — `UserFormDialog`: `MODULE_KEYS` checkbox loop (~line
  651-666, already auto-renders new module keys, confirm this yourself by reading), the
  `userFormSchema` (~line 554), `defaultValues` branches (~574-579), the
  `hasMovieRoomAccess`/`hasListsAccess`/`hasMaintenanceAccess` watch variables
  (~583-586) and the `canCloseMaintenanceIssues` conditional Switch field (~710-722) as
  the exact template for the new `canAdjustInventory` field.

## Module keys & permissions (already added to schema.ts, DO NOT re-add)

`MODULE_KEYS` already includes `"inventory"`, `"purchasing"`, `"internal-requisitions"` —
three fully independent checkboxes (already auto-rendering in settings.tsx via the
existing loop — just verify). User boolean `canAdjustInventory` already exists on the
`users` table and in `userFormSchema` needs to be ADDED by you (it is NOT yet in
settings.tsx UI) — add it in `client/src/pages/settings.tsx`:
1. `canAdjustInventory: z.boolean()` to `userFormSchema` and both `defaultValues` branches.
2. New watch variables `hasInventoryAccess`, `hasPurchasingAccess`, `hasInternalRequisitionsAccess`
   alongside the existing `hasMovieRoomAccess` etc.
3. A new conditional Switch field for `canAdjustInventory`, gated on
   `hasInventoryAccess || hasPurchasingAccess || hasInternalRequisitionsAccess`, copied
   from the `canCloseMaintenanceIssues` pattern. Label: "Can adjust inventory & cancel
   documents" with helper text explaining it gates manual stock adjustments and
   cancellation of Purchase Requisitions/Orders/Internal Requisitions.
4. Include `canAdjustInventory` in the PATCH body sent to `/api/users/:id` (find the
   existing submit handler and extend it — follow how `canCloseMaintenanceIssues` is sent).

## Sidebar (`client/src/components/app-sidebar.tsx`)

Add 3 entries, each independently gated by its own moduleKey (per binding rule — no
combined "Phase 2" grouping):
- Inventory → `/inventory`, icon `Package`, key `"inventory"`
- Purchasing → `/purchasing`, icon `ShoppingCart`, key `"purchasing"`
- Internal Requisitions → `/internal-requisitions`, icon `ClipboardCheck`, key `"internal-requisitions"`

## Routing (`client/src/App.tsx`)

Add 3 routes following the exact existing `Guarded` wrapper pattern, one per new page,
each with its own `moduleKey`.

## API reference (all already implemented and working in server/routes.ts)

Currency is KES throughout — use `formatKES` for all money display.

### Shared read-only lookups (use across all 3 pages as needed)
- `GET /api/inventory/stores` → `Store[]` `{id,name,location,description,active}`
- `GET /api/inventory/items` → `InventoryItem[]` `{id,code,name,category,unitOfMeasure,reorderLevel,lastUnitCost,glAssetAccountId,active,notes,createdAt}`
- `GET /api/inventory/stock-balances` → `{itemId,storeId,balance}[]`
- `GET /api/purchasing/gl-accounts` → chart of accounts list (same shape as `/api/finance/accounts`: `{id,code,name,type,...}`) — for GL account dropdowns (payable/expense/asset accounts) in Purchasing and Internal Requisitions forms.
- `GET /api/definitions/:listKey/items` → `{id,listId,label,value,sortOrder,active}[]` (or similar shape — check `insertDefinitionListItemSchema` in shared/schema.ts). Use `listKey="inventory_category"` and `listKey="unit_of_measure"` to populate the category and unit-of-measure dropdowns on the Inventory Items form. These lists are pre-seeded (5 categories, 7 units) and admin-editable elsewhere — just consume them here, read-only.

### `/inventory` page — gated `requireModule("inventory")`
Master data CRUD (dialogs, following bankAccounts/rooms precedent — hard delete allowed):
- Stores: `POST /api/inventory/stores`, `PATCH /api/inventory/stores/:id`, `DELETE /api/inventory/stores/:id` (delete requires `canAdjustInventory` — expect a 403 and show its error message if the signed-in user lacks the right).
- Items: `POST /api/inventory/items` (body must include `createdAt` is set server-side — do NOT send it), `PATCH /api/inventory/items/:id`, `DELETE /api/inventory/items/:id` (also gated by `canAdjustInventory`).
- Stock ledger (read-only trail): `GET /api/inventory/stock-ledger?itemId=&storeId=` (both optional filters) → `StockLedgerEntry[]`.
- Manual stock adjustment: `POST /api/inventory/stock-adjustments` gated by `canAdjustInventory` client-side too (hide/disable the button if `!user.isAdmin && !user.canAdjustInventory`) — body `{itemId, storeId, direction: "in"|"out", quantity, notes?}`.
Show current stock balances (join items + stores + stock-balances) in a table, plus tabs/sections for Items, Stores, Stock Ledger, Stock Adjustment.

### `/purchasing` page — gated `requireModule("purchasing")`
- Suppliers CRUD: `GET/POST /api/purchasing/suppliers`, `PATCH /api/purchasing/suppliers/:id`, `DELETE /api/purchasing/suppliers/:id` (delete gated by `canAdjustInventory`).
- Purchase Requisitions: `GET /api/purchasing/requisitions`, `GET /api/purchasing/requisitions/:id/lines`.
  - Create: `POST /api/purchasing/requisitions` body `{department?, purpose, type: "stock"|"direct", lines: [{itemId?, description, quantity, unitOfMeasure?, estimatedUnitCost, notes?}]}` (requestedBy/status/createdAt set server-side).
  - Edit (draft only): `PATCH /api/purchasing/requisitions/:id` body can include `lines` array to fully replace lines.
  - Submit: `POST /api/purchasing/requisitions/:id/submit` (draft → pending_approval, no body).
  - Approve (auto-creates linked PO): `POST /api/purchasing/requisitions/:id/approve` body `{supplierId, payableAccountId, expenseAccountId?}` (expenseAccountId required if PR type is "direct") → returns `{requisition, purchaseOrder}`. Build this as a dialog: pick supplier + payable account (+ expense account if PR.type==="direct").
  - Reject: `POST /api/purchasing/requisitions/:id/reject` body `{reason}` (required).
  - Cancel: `POST /api/purchasing/requisitions/:id/cancel` body `{reason}` (required), gated by `canAdjustInventory` client-side.
  - Statuses: `draft, pending_approval, approved, rejected, cancelled` — badge colors following the existing status-badge convention in finance.tsx/maintenance.tsx.
- Purchase Orders: `GET /api/purchasing/orders`, `GET /api/purchasing/orders/:id/lines`.
  - Create standalone (without a PR): `POST /api/purchasing/orders` body `{supplierId, type:"stock"|"direct", payableAccountId, expenseAccountId?, requisitionId?, notes?, lines:[{itemId?, description, quantity, unitOfMeasure?, unitCost, lineTotal?}]}`. Also allow this — not every PO needs a PR.
  - Edit (draft only): `PATCH /api/purchasing/orders/:id`.
  - Approve: `POST /api/purchasing/orders/:id/approve` (no body).
  - Receive into stock (type="stock" POs only): `POST /api/purchasing/orders/:id/receive` body `{storeId, lines:[{poLineId, quantityReceived, unitCost}], notes?}` → creates GRN. Build a "Receive Goods" dialog listing PO lines with outstanding qty (`quantity - quantityReceived`) and editable received-qty/unit-cost inputs, plus a store picker.
  - Receive direct expense (type="direct" POs only): `POST /api/purchasing/orders/:id/receive-direct` (no body) — posts the expense JE immediately, no store/lines needed.
  - Cancel: `POST /api/purchasing/orders/:id/cancel` body `{reason}`, gated by `canAdjustInventory`.
  - Statuses: `draft, approved, partially_received, received, cancelled`.
- Goods Receipts (read-only trail/tab): `GET /api/purchasing/goods-receipts`, `GET /api/purchasing/goods-receipts/:id/lines`.

### `/internal-requisitions` page — gated `requireModule("internal-requisitions")`
- List/lines: `GET /api/internal-requisitions`, `GET /api/internal-requisitions/:id/lines`.
- Create: `POST /api/internal-requisitions` body `{department?, storeId, type:"permanent"|"loan", expenseAccountId? (required if type="permanent"), purpose, lines:[{itemId, quantityRequested, notes?}]}`.
- Edit (draft only): `PATCH /api/internal-requisitions/:id`.
- Submit: `POST /api/internal-requisitions/:id/submit`.
- Approve: `POST /api/internal-requisitions/:id/approve` (no body).
- Reject: `POST /api/internal-requisitions/:id/reject` body `{reason}`.
- Issue (moves stock out — validates sufficient stock): `POST /api/internal-requisitions/:id/issue` (no body). Show a clear error toast if the server reports insufficient stock for a line.
- Loan return (only for type="loan" lines that were issued): `POST /api/internal-requisition-lines/:lineId/return` body `{quantityReturned, condition?, notes?}`. Show outstanding qty per line = `quantityIssued - quantityReturned`, block if 0 remaining.
- Cancel: `POST /api/internal-requisitions/:id/cancel` body `{reason}`, gated by `canAdjustInventory`.
- Statuses: `draft, pending_approval, approved, rejected, cancelled, issued`.
- No WhatsApp/PDF requirement for these documents (internal-facing per binding rule) — skip that entirely.

## Error handling convention

All mutation endpoints return `{error: "message"}` with 400/403/404 on failure — surface
`err.message` (or the parsed response body's `error` field, whichever pattern
finance.tsx already uses for its `useMutation` `onError`) in a toast, matching the
existing convention exactly.

## Acceptance checklist you must self-verify before finishing (see note on DB access below)

1. Raising a PR with type "stock" and no stock on hand, approving it, auto-generates a
   PO with a sequential PO number.
2. Receiving a stock PO into a store updates the stock ledger and stock balance.
3. Raising a Loan-type internal requisition, issuing it, then marking it returned,
   reverses the stock balance back.
4. A user without `canAdjustInventory` gets blocked (403) attempting to cancel a
   PR/PO/IR — confirm your UI disables/hides the cancel button for such users AND that
   you don't rely on the UI alone (the server enforces it too).

You will NOT have a running preview database in your environment — do not attempt to
start `npm run dev` against Supabase or create real records. Your self-verification is:
(a) `npx tsc --noEmit -p .` from `/home/user/workspace/chekata-hotel` must show ONLY the
pre-existing baseline errors — exactly these files/counts and nothing else:
`finance.tsx(32), settings.tsx(23), facilities.tsx(22), accommodation.tsx(21), movie-room.tsx(19), lists.tsx(12), staff.tsx(10), system-admin.tsx(8), expenses.tsx(8)` — total 155.
Any error outside this exact set (including a *different* count in one of these files)
is a real bug you introduced and must fix. (b) `npm run build` must succeed.

Report back: files created/modified, the final tsc error count/breakdown (must match
baseline exactly), and confirmation the build succeeded. Do not commit or push git —
that is handled separately after this.
