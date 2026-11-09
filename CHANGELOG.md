# Changelog

All notable changes to **ChefTech POS** are documented in this file.

## [1.1.0] - 2026-11-09

### Security & Architecture Hardening
- **Secure Initial Owner Account Creation**:
  - Replaced metadata-based role assignment in `handle_new_user()` trigger with strict default `CUSTOMER` role, ignoring any client-supplied `role: "OWNER"` in `raw_user_meta_data`.
  - Implemented `public.bootstrap_initial_owner(target_email)` procedure with `FOR UPDATE` lock on `profiles` to elevate only the very first owner and permanently reject any subsequent calls once an Owner exists.
  - Enforced database-level protection in `enforce_profile_security()` preventing deactivation or demotion of the last active owner and automatically logging all role alterations to `public.audit_logs`.
- **Atomic Concurrency-Safe Checkout (`public.process_online_order_checkout`)**:
  - Implemented database stored procedure with deadlock-free inventory row locking (`ORDER BY id FOR UPDATE`) preventing race conditions and inventory overselling.
  - Added atomic coupon validation, clamping (0-100%), and usage incrementing.
  - Added atomic loyalty points balance verification and deduction.
  - Added strict server-side minimum delivery order enforcement.
- **Idempotency Protection**:
  - Added `idempotency_key` (UUID) with `UNIQUE` constraint to `online_orders` to eliminate duplicate charges or double orders on retry.
- **Recipe Double-Deduction Elimination**:
  - Fixed `recordSale` in `src/lib/sales.ts` to skip local recipe inventory deduction when `sale.onlineOrderId` is set, since ingredients were already deducted by PostgreSQL during checkout.
- **Offline Synchronization Hardening**:
  - Added `pushPendingSales()` to `src/lib/sync.ts` ensuring all sales recorded offline in IndexedDB are automatically scanned and synchronized to Supabase when network connectivity returns.
  - Added `getPendingSyncCount()` for UI badge indicators.
  - Integrated Supabase Realtime WebSocket channel for instant online order notifications with graceful fallback to 20-second polling.
- **Edge Function Hardening**:
  - Replaced wildcard CORS headers with explicit configurable `ALLOWED_ORIGINS` validation.
  - Added strict Bearer token authentication returning `401 Unauthorized` on invalid tokens instead of silently falling back to guest mode.
- **Automated Testing & CI/CD**:
  - Added comprehensive test suites: `tests/transactionalCheckout.test.ts` (deadlock locking, stock checks, double-deduction prevention) and `tests/offlineSync.test.ts` (offline queuing and connectivity sync).
  - Added GitHub Actions CI workflow (`.github/workflows/ci.yml`) running lint, type-check, vitest (62 tests), and Vite build.
- **Documentation**:
  - Added enterprise guides: `docs/INSTALLATION.md`, `docs/OWNER_SETUP.md`, `docs/SUPABASE_SETUP.md`, `docs/SECURITY.md`, and `docs/BACKUP_AND_RECOVERY.md`.

## [1.0.0] - 2026-11-08

### Added
- **React 19 + TypeScript + Dexie.js Offline-First POS**: Complete point-of-sale interface with Dine-In Table Management, Takeaway, Delivery, Held Orders, Recipe-based Inventory Deduction, Staff Shifts, Audit Logs, Expense Tracking, Profit & Loss statements, and Thermal Receipt Printing.
- **Supabase Cloud Sync & Realtime Integration**: Two-way synchronization with Supabase PostgreSQL (`menu_items`, `categories`, `inventory`, `sales`, `online_orders`) and Supabase Auth.
- **Supabase SQL Migration & Row-Level Security (RLS)**: Complete 22-table PostgreSQL schema (`supabase/migrations/20261108000000_initial_schema_and_rls.sql`) with strict role-based RLS policies (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `CUSTOMER`) and anti-escalation triggers.
- **Supabase Edge Functions**:
  - `place-order`: Authoritative server-side order pricing, menu availability verification, recipe stock checks, coupon redemption, loyalty points redemption, and Rs. 500 minimum delivery enforcement.
  - `consume-coupon`: Atomic server-side coupon validation and consumption.
  - `issue-loyalty`: Idempotent staff-triggered loyalty point accrual and every-10th-order 10% discount coupon minting.
  - `track-order`: Privacy-preserving guest order status lookup requiring both Order ID and Customer Phone Number.
- **First-Run Owner Setup Wizard & Demo Mode**: Mandatory initial Owner account + 4-digit Owner PIN setup wizard on first launch, plus a one-click Demo Mode seeded with sample menu categories, items, recipes, and inventory.
- **Web Crypto PBKDF2-SHA256 & HMAC Session Integrity**: Passwords and Owner PINs are hashed with 100,000-iteration PBKDF2-SHA256 and 16-byte random salt; active sessions are HMAC-signed, revalidated against IndexedDB, and auto-lock after 10 minutes of inactivity.
- **Sold Out / Availability Toggles**: Real-time item availability toggles in Admin Settings and Menu Grid that sync immediately to the Ordering Website.
