# ChefTech POS — Offline-First Restaurant Point of Sale (Supabase Edition)

**ChefTech POS** is a modern, offline-first Restaurant Point of Sale application built with **React 19, TypeScript, Vite, Tailwind CSS, and Dexie.js (IndexedDB)**, paired with **Supabase (PostgreSQL + Auth + Realtime + Edge Functions)** for cloud synchronization and online ordering integration.

---

## Key Features

- **Offline-First POS Operation**: Works seamlessly without an internet connection using IndexedDB (`Dexie.js`) and automatically syncs queued changes when connectivity returns.
- **First-Run Owner Setup Wizard & One-Click Demo Mode**: No hardcoded default credentials. Launch into the guided Owner Setup Wizard or click **Load Demo Mode** on the login screen to explore with pre-seeded sample categories, menu items, recipes, and inventory.
- **Enterprise-Grade Security**:
  - **PBKDF2-SHA256** (`100,000` iterations, 16-byte random salt) for all local staff passwords and the 4-digit Owner PIN.
  - **HMAC-Signed Sessions** with live role revalidation against IndexedDB and a 10-minute inactivity auto-lock.
  - **5-Attempt / 5-Minute Brute-Force Lockout** on both staff login and Owner PIN verification.
  - **Server-Side Price & Stock Verification** (`verifyOnlineOrder` in POS + `place-order` Supabase Edge Function) to prevent client-side price tampering.
- **Complete Restaurant Workflows**:
  - Dine-In Table Management, Takeaway, Delivery, and Held Orders.
  - Recipe-driven Inventory Deduction with low-stock alerts and atomic stock checks.
  - Menu Item **In Stock / Sold Out** availability toggles synced to the Ordering Website.
  - Partial & Full Refunds with double-refund protection (`refundedSaleIds` + `refunds` table).
  - Staff Management, Shift Cash Drawer Tracking, Expense Ledger, Profit & Loss Statements, Sales Analytics, and 80mm Thermal Receipt Printing.
- **Unified Loyalty System (POS + Website)**:
  - Customers earn **1 loyalty point per Rs. 100** spent and automatically receive a single-use **10% off coupon (`LOYALxxxxxx`) every 10th completed order** via the `issue-loyalty` Edge Function.
  - Loyalty points and order counts are stored in `profiles.loyalty_points` and `profiles.order_count` and synchronized with the POS CRM `customers` table.

---

## Prerequisites

- **Node.js** `>= 20.x` (Node 22 LTS recommended) and `npm >= 10.x`
- A free or Pro **[Supabase](https://supabase.com)** project (optional for pure offline/demo mode; required for cloud sync and online ordering)
- **[Supabase CLI](https://supabase.com/docs/guides/cli)** (for deploying Edge Functions)

---

## Quick Start (Local Development & Demo Mode)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Copy the environment template**:
   ```bash
   cp .env.example .env
   ```
   *(Optional: Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, or configure them later inside the app via **Cloud Setup**.)*

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **First Launch**:
   - **Option A — Setup Wizard**: Create your Owner account (`OWNER` role) and set your 4-digit Owner PIN.
   - **Option B — Demo Mode**: Click **Try Demo Mode (Sample Restaurant Data)** on the login screen. It will generate a temporary random Owner password and PIN and display them once on screen.

---

## Documentation Index

Comprehensive production documentation is located in the [`docs/`](./docs) directory:
- [**Installation & Deployment Guide**](./docs/INSTALLATION.md) — Step-by-step setup for development, staging, and production.
- [**Owner Account & Staff Setup**](./docs/OWNER_SETUP.md) — Secure Owner bootstrap procedure, role hierarchy, and PIN management.
- [**Supabase Configuration Guide**](./docs/SUPABASE_SETUP.md) — Database schema, migrations, RLS policies, and Edge Functions deployment.
- [**Security & Threat Model**](./docs/SECURITY.md) — Authentication architecture, HMAC sessions, anti-escalation triggers, and audit logging.
- [**Backup & Disaster Recovery**](./docs/BACKUP_AND_RECOVERY.md) — Database dumps, IndexedDB exports, point-in-time recovery, and restore procedures.

---

## Supabase Backend Setup (Database, RLS & Edge Functions)

Both `cheftech-pos` and `cheftech-website` share the same Supabase project and ship with identical `supabase/` directories.

### 1. Apply the Database Schema & RLS Policies

1. Open your **Supabase Dashboard** → **SQL Editor**.
2. Run the migrations in sequence:
   - [`supabase/migrations/20261108000000_initial_schema_and_rls.sql`](./supabase/migrations/20261108000000_initial_schema_and_rls.sql)
   - [`supabase/migrations/20261109000000_security_owner_bootstrap_and_checkout.sql`](./supabase/migrations/20261109000000_security_owner_bootstrap_and_checkout.sql)
3. These migrations create:
   - The `user_role` enum (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `CUSTOMER`).
   - All **22 tables** (`profiles`, `categories`, `menu_items`, `inventory`, `recipes`, `coupons`, `online_orders`, `online_order_items`, `sales`, `sale_items`, `refunds`, `customers`, `held_orders`, `table_orders`, `suppliers`, `expenses`, `staff`, `shifts`, `audit_logs`, `settings`, `banners`, `loyalty_rewards`).
   - Strict **Row-Level Security (RLS)** on every table (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`).
   - Anti-escalation triggers preventing non-owners from modifying roles.
   - The atomic checkout stored procedure `public.process_online_order_checkout`.
   - The secure owner bootstrap function `public.bootstrap_initial_owner`.

### 2. Deploy the 4 Supabase Edge Functions

Link your project and deploy the Edge Functions from the repository root:

```bash
supabase login
supabase link --project-ref <your-project-ref>

supabase functions deploy place-order
supabase functions deploy consume-coupon
supabase functions deploy issue-loyalty
supabase functions deploy track-order
```

> **Note**: Supabase automatically injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into the Edge Functions runtime. **Never** put `SUPABASE_SERVICE_ROLE_KEY` in `.env` or any browser file.

### 3. Bootstrap Your First Cloud Owner Account

Public user signups strictly default to the `CUSTOMER` role. To establish the initial Owner account securely:

1. Register your owner account via Supabase Auth or the POS Cloud Setup modal.
2. In the **Supabase Dashboard → SQL Editor**, execute the bootstrap procedure:
   ```sql
   SELECT public.bootstrap_initial_owner('your-owner-email@example.com');
   ```
3. This procedure acquires a global PostgreSQL transaction advisory lock (`pg_advisory_xact_lock`), verifies that no active OWNER exists, elevates the account to `OWNER`, records an entry in `public.audit_logs`, and permanently rejects any subsequent attempts. Execution privileges are restricted to `service_role` and PostgreSQL superusers (normal authenticated clients cannot invoke it).
4. For detailed staff and PIN configuration, see [**Owner Setup Guide**](./docs/OWNER_SETUP.md).

---

## Unified Loyalty Architecture (`M-01`)

ChefTech unifies POS and Website loyalty rewards in `public.profiles` and `public.coupons`:
1. **Points Accrual**: Every completed order awards `FLOOR(total / 100)` points to `profiles.loyalty_points` (and mirrors the balance to `customers.points` by phone number for walk-in POS lookup).
2. **Every-10th-Order Coupon**: When `profiles.order_count` reaches a multiple of `10` (`10, 20, 30, ...`), the `issue-loyalty` Edge Function automatically mints a single-use 10%-off coupon (`LOYALxxxxxx`) assigned to that customer.
3. **Idempotency**: Both `online_orders.loyalty_issued` and `profiles.processed_order_ids` prevent duplicate point or coupon issuance on network retries.

---

## Privacy & Customer Data Deletion (`GDPR / PECA Compliance`)

Customer order records contain personal data (name, phone number, delivery address).
- **Order Tracking Privacy**: Unauthenticated guest order lookup (`track-order` Edge Function) requires both the **Order ID** and matching **Customer Phone Number** (last 7 digits) and returns only order status and timestamps—never customer PII.
- **Customer Data Deletion Procedure**: When a customer requests deletion of their personal data:
  1. Open **Supabase Dashboard → Authentication → Users** and delete the customer's Auth user (which cascades or unlinks `public.profiles`), OR run the anonymization query below in the **SQL Editor**:
     ```sql
     UPDATE public.online_orders
     SET customer_name = 'REDACTED',
         customer_phone = 'REDACTED',
         customer_address = 'REDACTED',
         customer_id = NULL
     WHERE customer_phone = '<customer-phone>';

     DELETE FROM public.customers WHERE phone = '<customer-phone>';
     ```
  2. In the POS terminal, open **Admin Settings → Backup & Restore** or **Customers** to remove cached local records from IndexedDB.

---

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start Vite development server |
| `npm test` | Run Vitest unit & security test suite |
| `npm run build` | Type-check (`tsc -b`) and build production bundle to `dist/` |
| `npm run preview` | Preview production build locally |
