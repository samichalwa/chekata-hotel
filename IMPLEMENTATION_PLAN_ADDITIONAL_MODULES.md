# The Chekata Management System — Additional Modules Implementation Plan

**Prepared for:** Sami Chalwa, Kerkebet Mining Share Company / The Chekata Hotel
**Scope:** 10 new modules + system-wide permissions overhaul + Test/Live environment split, as specified in the requirements document
**Status:** Draft for sign-off — nothing has been built yet

---

## 1. Guiding principles (apply to every module below)

- **Full CRUD, nothing hardcoded** — every list (stores, categories, leave types, shop IDs, chart of accounts, etc.) is admin-editable, never baked into code.
- **Additive-only database changes** — every new table/column is added with the same non-destructive `ensureColumn`/`ensureTable` bootstrap pattern already used, so existing data and the current live system are never at risk.
- **Documents are audit-safe** — purchase orders, requisitions, and journal entries can be **cancelled**, never deleted, and serial numbers are system-generated and immutable, per your spec.
- **One permission model, used everywhere** — module access + table-level write restrictions + the approval matrix are built once, as shared infrastructure, then reused by every module rather than rebuilt per module.
- **Everything that touches money posts to Finance** — each revenue/expense-generating module calls one shared "post to ledger" function rather than each module inventing its own accounting logic.
- **Same deployment discipline as today** — build → local smoke test → push to GitHub → you (or I, with your explicit confirmation each time) deploy to the droplet → verify on production before moving to the next phase.

---

## 2. Cross-cutting foundations (built once, used by everything after)

These aren't a "module" the user sees directly, but nearly every phase below depends on them, so they're built first:

| Foundation | What it does |
|---|---|
| **Permission engine v2** | Extends today's per-module checkboxes to also support per-table write restrictions (a user can have module access but be blocked from writing to a specific table within it). |
| **Approval matrix engine** | Generic requester → reviewer → final-approver workflow with configurable limits per employee, reusable across POs, requisitions, payments, and leave — built once, attached to each document type. |
| **Document numbering pattern** | Shared serial-number generator + cancel-not-delete pattern, reused for POs, requisitions, journal entries, invoices. |
| **Finance posting engine** | One internal function every module calls to create a balanced journal entry; modules never write GL rows directly. |
| **File/image upload handling** | Shared upload component for ID/passport images, lease documents, employee photos, asset photos — already have a pattern for this from documents/logos. |
| **Environment banner + test/live switch scaffold** | The plumbing for Phase 6, put in place early so later modules don't need retrofitting. |

---

## 3. Phased roadmap

### Phase 1 — Foundation: System Administration + Finance Core
**Why first:** almost every later module needs somewhere to define its lookup lists and somewhere to post transactions.

**New modules/pages:**
- System Administration: manages all definitions (inventory items, store locations, leave types, shop IDs, price lists, asset categories, etc.), approval matrix configuration, module + table permission grid, collapsible/expandable module list per user
- Settings: company info, accounting periods & financial year, email/SMS/backup connections, global settings — visible only to the literal `admin` account
- Finance: chart of accounts (editable), general ledger, trial balance, P&L, balance sheet, cash flow statement, manual journal entries, accounts payable, accounts receivable, bank/cash reconciliation, payments against invoices or vouchers with configurable payment methods, month-end/year-end close & rollover

**Key new tables:** `chart_of_accounts`, `journal_entries` + `journal_entry_lines`, `accounting_periods`, `approval_matrix_rules`, `permission_table_rules`, `payment_vouchers`, `bank_accounts`, `bank_reconciliations`

**Assumed defaults (flag if wrong):** KES only, no multi-currency; this runs as your primary accounting system going forward rather than alongside another one; other admin-rights users get read-only visibility into Settings (not zero visibility) unless you say otherwise.

**Acceptance checklist:** create/edit chart of accounts; post a manual journal entry and see it reflected in trial balance and P&L; close a month and confirm prior-period entries lock; define an approval rule and confirm a test payment routes to the right approver.

---

### Phase 2 — Inventory chain: Inventory + Purchasing + Internal Requisitions
**Why together:** these three are one connected workflow (requisition → PO if no stock → receipt → issue), splitting them would mean rebuilding the same stock-ledger logic three times.

**New modules/pages:**
- Inventory: configurable stores (name, description, location), stock ledger per item per store, receive-into-stock and issue-from-stock transactions
- Purchasing: purchase requisition → approval → purchase order (auto-serialized), categorized as **direct purchase** or **stock**
- Internal Requisitions: **Permanent** or **Loan** (returnable) requisitions, auto serial number, cancel-not-delete, stock only moves on actual receipt/issue, adjustments/cancellations gated by a specific permission

**Key new tables:** `stores`, `inventory_items`, `stock_ledger`, `purchase_requisitions`, `purchase_orders` + `purchase_order_lines`, `goods_receipts`, `internal_requisitions` + `internal_requisition_lines`, `loan_returns`

**Assumed defaults:** items track unit-of-measure and a configurable reorder level with a low-stock report; suppliers are a simple editable list (name, contact, payment terms) rather than a full vendor-management module unless you want more.

**Acceptance checklist:** raise a requisition with no stock → approve → auto-generates a PO with a sequential number; receive the PO into a store → stock ledger updates; raise a Loan requisition, mark it returned, confirm stock reverses; attempt a cancellation without the adjustment permission and confirm it's blocked.

---

### Phase 3 — Tenants, F&B Costing, Accommodation ID capture
**Why here:** these are largely independent of each other and of the inventory chain, and can build on the Finance core from Phase 1 plus the recurring-invoice pattern already live for accommodation/facilities.

**Permissions note:** "Phase 3" is a build-order label only. Tenants, F&B Costing, and the Accommodation enhancement are — and remain — three fully separate, independently-permissioned modules with their own checkboxes. Facilities Booking and Maintenance are existing modules, untouched by this phase, and stay standalone and independently permissioned exactly as they are today. No module in this plan shares a permission entry with another; grouping below is for scheduling only, never for access control.

**New modules/pages:**
- Tenants: 5 shops (shop number, rent, tenant details, lease start/end, document upload), electricity billed by meter reading, auto rent invoice emailed on the 1st of each month, configurable due date per tenant, SMS+email reminders before due date
- F&B Costing: chef-defined recipes (ingredient + quantity, e.g. grams of rice/beef per serving), auto-calculated cost per serving from ingredient purchase price (from Phase 2 inventory) + other costs, suggested menu pricing
- Accommodation enhancement: ID/passport image capture at check-in (both sides for national ID), enforced 2-guest-per-room maximum

**Key new tables:** `shops`, `tenants`, `tenancy_leases`, `meter_readings`, `rent_invoices`, `recipes` + `recipe_ingredients`, `guest_identity_documents`

**Assumed defaults:** meter readings are entered as start/end per billing cycle and the system calculates consumption × rate (rather than a manually-entered total); recipe ingredient costs pull live from the latest purchase price recorded in Inventory (Phase 2) rather than a fixed standard cost you set separately — tell me if you'd rather fix the cost periodically instead.

**Acceptance checklist:** create a tenant + lease, confirm an invoice auto-generates and emails on the 1st; enter a meter reading and confirm the electricity charge calculates correctly; build a recipe and confirm cost-per-serving updates when an ingredient's purchase price changes; check in a guest with 2 ID images and confirm a 3rd guest is blocked.

---

### Phase 4 — HR: register, attendance, leave, payroll
**Why here:** the largest single module in the request; benefits from Finance (Phase 1) already existing so payroll can post salary journal entries automatically.

**New modules/pages:**
- Employee register (photo, permanent/temporary classification, day/hour-rate for temporary staff)
- Time & attendance
- Leave management (types, balances, approval via the Phase 1 approval matrix)
- Payroll with configurable Kenyan statutory deduction rates (PAYE, NSSF, SHIF, Housing Levy) so rates can be updated without a code change

**Key new tables:** `employees`, `attendance_records`, `leave_types`, `leave_requests`, `leave_balances`, `payroll_runs` + `payroll_lines`, `statutory_rate_tables`

**Assumed defaults:** attendance is entered manually/by roster rather than integrated with a biometric clock-in device (tell me if you have a specific device to integrate with); payroll auto-posts a summarized salary journal entry to Finance each run.

**Acceptance checklist:** register an employee with photo; submit and approve a leave request, confirm balance deducts; run payroll for a pay period and confirm statutory deductions calculate correctly and a journal entry posts to Finance.

---

### Phase 5 — Planning & Reporting: Budgeting, Assets, expanded Reports
**Why here:** these are most useful once real transactional data exists across the other modules to forecast against and report on.

**New modules/pages:**
- Budgeting: daily income/expenditure forecast per month, per income stream (accommodation, bar, restaurant, conference, special events, movie seats, shop rentals, wifi hotspot, water sales, other), with actual-vs-budget variance
- Assets: configurable categories (vehicles, IT equipment, CCTV, furniture), acquisition tracking, linked to the existing maintenance module, optional automatic depreciation posting to Finance
- Reports: expanded to include every new module, with suggested standard formats per module (matching the existing comprehensive-Excel-reports approach)

**Key new tables:** `budget_lines`, `asset_categories`, `assets`, `asset_depreciation_schedules`

**Acceptance checklist:** enter a monthly budget by income stream, confirm variance report pulls actuals automatically; register an asset, confirm it links to a maintenance ticket; export a report from each new module.

---

### Phase 6 — Test/Live environment split
**Why last:** this changes how the whole application connects to data, so it's safest to layer on once everything else is stable rather than build every earlier phase twice.

**What it does:**
- A second, fully separate database as a sandbox
- Login-time Test/Live environment picker, access controlled by permission
- "Copy live to test" button in Settings — one click, overwrites test data with a fresh copy of live data
- A bold, always-visible "TEST DATABASE" banner in test mode
- All test-mode documents/messages prefixed "Test company"

**Assumed default:** in test mode, real email/SMS/WhatsApp sends are blocked and logged only — so testing a transaction never accidentally messages a real guest or tenant. Tell me if you actually want test-mode messages to send for real.

**Acceptance checklist:** switch to test environment, confirm the banner shows everywhere and every printout/message says "Test company"; click "Copy live to test," confirm test data is fully replaced; confirm a user without test access cannot switch into it.

---

## 4. Deployment approach (unchanged from how we've worked so far)

For each phase: build → run `npm run check`/`npm run build` locally → smoke-test the new flows against the preview database → commit and push to GitHub (with your confirmation) → you approve the SSH deploy to the droplet → I verify the live site is healthy → move to the next phase. Nothing skips a phase's sign-off — I won't start Phase *n+1* until Phase *n* is confirmed working on production.

## 5. Open questions before I start Phase 1

1. Settings visibility for non-`admin` admin-rights users: read-only, or none at all?
2. Finance: KES-only confirmed, and this becomes your system of record (not running alongside another accounting package)?
3. Any of the "assumed defaults" above you want changed before I build to them?

If you're happy with the phase order and the defaults listed, tell me to start and I'll begin Phase 1.
