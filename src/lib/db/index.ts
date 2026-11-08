import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  FloorTable, TableOrder, HeldOrder, Sale, Category, MenuItem,
  Recipe, InventoryItem, Supplier, StockHistory, Customer, Waiter,
  KitchenOrder, User, Setting, Delivery, Expense, AuditLog,
  StaffMember, Attendance, Leave, SalaryPayment, AdvancePayment,
  StockIn, SupplierPayment, SupplierLedger, OnlineOrder,
  LoyaltyReward,
} from './types';

/**
 * ChefTech POS
 * Dexie.js v21 schema - Direct TypeScript port of app.js IndexedDB stores
 * Database Name: ChefTechPOS
 */
export class ChefTechDB extends Dexie {
  // Core POS
  floorTables!: Table<FloorTable, number>;
  tableOrders!: Table<TableOrder, number>;
  heldOrders!: Table<HeldOrder, number>;
  sales!: Table<Sale, number>;
  kitchenOrders!: Table<KitchenOrder, number>;

  // Menu & Inventory
  categories!: Table<Category, string>;
  menu!: Table<MenuItem, string>;
  recipes!: Table<Recipe, number>;
  inventory!: Table<InventoryItem, string>;
  stockHistory!: Table<StockHistory, number>;
  suppliers!: Table<Supplier, string>;
  stockIn!: Table<StockIn, number>;
  supplierPayments!: Table<SupplierPayment, number>;
  supplierLedger!: Table<SupplierLedger, number>;

  // Customers & Users
  customers!: Table<Customer, string>;
  loyaltyRewards!: Table<LoyaltyReward, number>;
  waiters!: Table<Waiter, string>;
  users!: Table<User, number>;
  settings!: Table<Setting, string>;

  // Staff Management
  staff!: Table<StaffMember, number>;
  attendance!: Table<Attendance, number>;
  leaves!: Table<Leave, number>;
  salaryPayments!: Table<SalaryPayment, number>;
  advancePayments!: Table<AdvancePayment, number>;

  // Orders & Delivery
  deliveries!: Table<Delivery, number>;
  onlineOrders!: Table<OnlineOrder, number>;

  // Expenses & Audit
  expenses!: Table<Expense, number>;
  auditLogs!: Table<AuditLog, number>;

  constructor() {
    super('ChefTechPOS');

    // Version 21 — final schema, matches app.js exactly so the existing
    // ChefTechPOS database opens without an unexpected upgrade.
    this.version(21).stores({
      floorTables: '++id, number, status, waiter, currentSale',
      sales: '++id, timestamp, total, orderType, discountPercent, serverUser',
      categories: 'id, name',
      menu: 'id, categoryId, name, price, imageUrl',
      recipes: '++id, menuItemId, inventoryId, qtyRequired',
      inventory: 'id, name, stock, unit, cost',
      suppliers: 'id, name, phone, email, taxId, website',
      stockHistory: '++id, ingredient, created',
      customers: 'id, phone',
      waiters: 'id',
      kitchenOrders: '++id, saleId, tableId, status, createdAt',
      users: '++id, username, role',
      settings: 'key, value',
      tableOrders: '++id, tableId, status, createdAt',
      heldOrders: '++id, timestamp, serverUser, orderType',
      deliveries: '++id, saleId, status, createdAt, assignedTo',
      expenses: '++id, timestamp, amount, category, description, serverUser, status, supplierId, approvedBy, approvedAt',
      auditLogs: '++id, timestamp, action, user, saleId',
      staff: '++id, name, phone, role, status, joinDate',
      attendance: '++id, staffId, date, status',
      leaves: '++id, staffId, startDate, endDate, status',
      salaryPayments: '++id, staffId, month, year, status',
      advancePayments: '++id, staffId, date, status',
      stockIn: '++id, supplierId, ingredient, created',
      supplierPayments: '++id, supplierId, date, amount, method',
      supplierLedger: '++id, supplierId, date, referenceNumber, description, runningBalance',
    });

    // Adds the local online-order inbox without touching the v21 stores the
    // legacy app owns — an existing ChefTechPOS database upgrades in place.
    this.version(22).stores({
      onlineOrders: '++id, createdAt, status, orderType',
    });

    // Cloud row ids are the merge key for the cloud pull; indexed so a poll
    // can look a sale or order up by cloud id without scanning the table.
    this.version(23).stores({
      sales: '++id, timestamp, total, orderType, discountPercent, serverUser, cloudId',
      onlineOrders: '++id, createdAt, status, orderType, cloudId',
    });

    this.version(24).stores({
      loyaltyRewards: '++id, pointsRequired, active',
    });

    // Timestamp hooks (port of app.js lines 302-325)
    // NB: 'creating' hooks must not return a value — Dexie treats the return
    // value as a primary-key override, which throws DataError on auto-increment tables.
    this.users.hook('creating', (_primKey, obj: any) => {
      obj.createdAt = new Date().toISOString();
      obj.updatedAt = new Date().toISOString();
    });

    this.users.hook('updating', (_updates, _keys, _idbCur) => {
      (_updates as any).updatedAt = new Date().toISOString();
    });

    this.inventory.hook('creating', (_primKey, obj: any) => {
      obj.createdAt = new Date().toISOString();
      obj.updatedAt = new Date().toISOString();
    });

    this.inventory.hook('updating', (_updates, _keys, _idbCur) => {
      (_updates as any).updatedAt = new Date().toISOString();
    });

    this.menu.hook('creating', (_primKey, obj: any) => {
      obj.createdAt = new Date().toISOString();
      obj.updatedAt = new Date().toISOString();
    });

    this.menu.hook('updating', (_updates, _keys, _idbCur) => {
      (_updates as any).updatedAt = new Date().toISOString();
    });

    this.categories.hook('updating', (_updates) => {
      (_updates as any).updatedAt = new Date().toISOString();
    });

    this.loyaltyRewards.hook('creating', (_primKey, obj: any) => {
      obj.createdAt = new Date().toISOString();
      obj.updatedAt = new Date().toISOString();
    });

    this.loyaltyRewards.hook('updating', (_updates: any) => {
      _updates.updatedAt = new Date().toISOString();
    });

    this.onlineOrders.hook('updating', (_updates) => {
      (_updates as any).updatedAt = new Date().toISOString();
    });

    // The original app kept a supplierLedger running balance via 'creating' hooks.
    // Nothing reads that table here — `supplierBalance()` derives the same figure
    // from expenses + payments — so the hooks are gone rather than made async-safe.
  }
}

// Singleton instance
export const db = new ChefTechDB();
