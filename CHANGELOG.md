# Changelog

All notable changes to **ChefTech POS** are documented in this file.

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
