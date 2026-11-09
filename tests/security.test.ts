import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory store backing the Dexie `db` mock for pure Node Vitest execution
const memUsers: any[] = [];
const memSettings = new Map<string, { key: string; value: any }>();
const memMenu = new Map<string, any>();
const memInventory = new Map<string, any>();
const memRecipes: any[] = [];
const memAuditLogs: any[] = [];
const memSales: any[] = [];
const memCustomers: any[] = [];
const memExpenses: any[] = [];

vi.mock('../src/lib/db', () => {
  return {
    db: {
      users: {
        count: async () => memUsers.length,
        toArray: async () => [...memUsers],
        add: async (row: any) => {
          const id = memUsers.length + 1;
          memUsers.push({ ...row, id });
          return id;
        },
        update: async (id: number, patch: any) => {
          const idx = memUsers.findIndex((u) => u.id === id);
          if (idx >= 0) memUsers[idx] = { ...memUsers[idx], ...patch };
          return 1;
        },
        where: (field: string) => ({
          equals: (val: any) => ({
            first: async () => memUsers.find((u) => u[field] === val),
          }),
        }),
        clear: async () => {
          memUsers.length = 0;
        },
      },
      settings: {
        get: async (key: string) => memSettings.get(key),
        put: async (row: { key: string; value: any }) => {
          memSettings.set(row.key, row);
          return row.key;
        },
        delete: async (key: string) => {
          memSettings.delete(key);
        },
        clear: async () => {
          memSettings.clear();
        },
      },
      menu: {
        get: async (id: string) => memMenu.get(id),
        toArray: async () => Array.from(memMenu.values()),
        bulkPut: async (rows: any[]) => {
          for (const r of rows) memMenu.set(r.id, r);
        },
        clear: async () => {
          memMenu.clear();
        },
      },
      inventory: {
        get: async (id: string) => memInventory.get(id),
        toArray: async () => Array.from(memInventory.values()),
        put: async (row: any) => {
          memInventory.set(row.id, row);
          return row.id;
        },
        clear: async () => {
          memInventory.clear();
        },
      },
      recipes: {
        toArray: async () => [...memRecipes],
        add: async (row: any) => {
          memRecipes.push(row);
          return memRecipes.length;
        },
        where: (field: string) => ({
          equals: (val: any) => ({
            toArray: async () => memRecipes.filter((r) => r[field] === val),
          }),
        }),
        clear: async () => {
          memRecipes.length = 0;
        },
      },
      sales: {
        toArray: async () => [...memSales],
        add: async (row: any) => {
          const id = memSales.length + 1;
          memSales.push({ ...row, id });
          return id;
        },
        clear: async () => {
          memSales.length = 0;
        },
      },
      customers: {
        toArray: async () => [...memCustomers],
        clear: async () => {
          memCustomers.length = 0;
        },
      },
      expenses: {
        toArray: async () => [...memExpenses],
        add: async (row: any) => {
          memExpenses.push(row);
          return memExpenses.length;
        },
        clear: async () => {
          memExpenses.length = 0;
        },
      },
      auditLogs: {
        add: async (row: any) => {
          memAuditLogs.push(row);
          return memAuditLogs.length;
        },
      },
    },
  };
});

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
}

if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', { value: createStorageMock(), writable: true });
}
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: createStorageMock(), writable: true });
}

import { db } from '../src/lib/db';
import { hashPassword, sha256, verifyPassword } from '../src/lib/crypto';
import {
  completeFirstRunOwnerSetup,
  needsFirstRunSetup,
  revalidateSession,
  signIn,
} from '../src/lib/auth';
import { verifyOnlineOrder } from '../src/lib/onlineOrders';
import { configManager } from '../src/lib/config';
import { getAnalytics, getPeriodSummary, getPnl } from '../src/lib/analytics';
import { buildShiftReport, setOpeningCash } from '../src/lib/shift';

describe('security & audit fixes', () => {
  beforeEach(async () => {
    await db.users.clear();
    await db.settings.clear();
    await db.menu.clear();
    await db.inventory.clear();
    await db.recipes.clear();
    await (db.sales as any).clear();
    await (db.customers as any).clear();
    await (db.expenses as any).clear();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('S-01: ships with unconfigured cloud credentials (no hardcoded seller project)', async () => {
    expect(configManager.isConfigured()).toBe(false);
    expect(await configManager.getConfig()).toBeNull();
  });

  it('H-02: hashes passwords with PBKDF2-SHA256 (100k iterations + salt) and auto-flags legacy SHA-256 for rehash', async () => {
    const hashed = await hashPassword('StrongPass!2026');
    expect(hashed.startsWith('pbkdf2:100000:')).toBe(true);

    const checkGood = await verifyPassword('StrongPass!2026', hashed);
    expect(checkGood.valid).toBe(true);
    expect(checkGood.needsRehash).toBe(false);

    const checkBad = await verifyPassword('WrongPass', hashed);
    expect(checkBad.valid).toBe(false);

    // Legacy unsalted SHA-256 hash should verify once and request rehash
    const legacy = await sha256('LegacyPass99');
    const legacyCheck = await verifyPassword('LegacyPass99', legacy);
    expect(legacyCheck.valid).toBe(true);
    expect(legacyCheck.needsRehash).toBe(true);
  });

  it('H-01 & H-04: requires first-run setup (no default 1234 accounts) and locks out after 5 failed login attempts', async () => {
    expect(await needsFirstRunSetup()).toBe(true);

    await completeFirstRunOwnerSetup({
      username: 'owner',
      name: 'Restaurant Owner',
      password: 'OwnerPassword123!',
      pin: '4829',
    });

    expect(await needsFirstRunSetup()).toBe(false);

    // 4 wrong attempts return generic message
    for (let i = 0; i < 4; i++) {
      await expect(signIn('owner', 'wrong-pass')).rejects.toThrow('Invalid username or password.');
    }

    // 5th wrong attempt triggers 5-minute lockout
    await expect(signIn('owner', 'wrong-pass')).rejects.toThrow(/Too many login attempts\. Try again in 5 min\./);

    // Even the right password is blocked while locked out
    await expect(signIn('owner', 'OwnerPassword123!')).rejects.toThrow(/Too many login attempts/);
  });

  it('S-07: detects and invalidates DevTools sessionStorage role tampering', async () => {
    await completeFirstRunOwnerSetup({
      username: 'owner',
      name: 'Restaurant Owner',
      password: 'OwnerPassword123!',
      pin: '4829',
    });

    // Valid session passes revalidation
    const valid = await revalidateSession();
    expect(valid?.username).toBe('owner');
    expect(valid?.role).toBe('OWNER');

    // Tamper with sessionStorage in DevTools
    const raw = JSON.parse(sessionStorage.getItem('loggedUser') || '{}');
    sessionStorage.setItem('loggedUser', JSON.stringify({ ...raw, username: 'attacker', role: 'OWNER' }));

    const afterTamper = await revalidateSession();
    expect(afterTamper).toBeNull();
    expect(sessionStorage.getItem('loggedUser')).toBeNull();
  });

  it('S-04, M-02, M-07: re-prices online orders from POS menu, rejects unavailable/out-of-stock items, and enforces Rs. 500 delivery minimum', async () => {
    await db.menu.bulkPut([
      { id: 'm1', categoryId: 'c1', name: 'Zinger Burger', price: 600, available: true },
      { id: 'm2', categoryId: 'c1', name: 'Sold Out Wings', price: 400, available: false },
    ]);

    // 1. Tampered Rs. 1 price on a Rs. 600 burger is re-priced to Rs. 600 and flagged
    const tamperedCheck = await verifyOnlineOrder({
      createdAt: new Date().toISOString(),
      customer: { name: 'Ali', phone: '03001112233', address: 'Main Blvd' },
      orderType: 'DELIVERY',
      items: [{ id: 'm1', menuItemId: 'm1', name: 'Zinger Burger', price: 1, qty: 1 }],
      total: 1,
      status: 'PENDING',
    });
    expect(tamperedCheck.priceMismatch).toBe(true);
    expect(tamperedCheck.computedSubtotal).toBe(600);
    expect(tamperedCheck.items[0].price).toBe(600);

    // 2. Unavailable item is caught
    const unavailableCheck = await verifyOnlineOrder({
      createdAt: new Date().toISOString(),
      customer: { name: 'Ali', phone: '03001112233', address: 'Main Blvd' },
      orderType: 'TAKEAWAY',
      items: [{ id: 'm2', menuItemId: 'm2', name: 'Sold Out Wings', price: 400, qty: 1 }],
      total: 400,
      status: 'PENDING',
    });
    expect(unavailableCheck.unavailableItems).toEqual(['Sold Out Wings']);

    // 3. Valid website coupon discount does NOT falsely trigger priceMismatch, and enforces post-discount delivery min
    const couponOrderCheck = await verifyOnlineOrder({
      createdAt: new Date().toISOString(),
      customer: { name: 'Sara', phone: '03009998877', address: 'DHA Phase 5' },
      orderType: 'DELIVERY',
      items: [{ id: 'm1', menuItemId: 'm1', name: 'Zinger Burger', price: 600, qty: 1 }],
      subtotal: 600,
      discountAmount: 60,
      couponCode: 'CHEFTECH10',
      total: 540,
      status: 'PENDING',
    });
    expect(couponOrderCheck.priceMismatch).toBe(false);
    expect(couponOrderCheck.belowDeliveryMinimum).toBe(false);
  });

  it('deducts refunds from Analytics, Period Summary, P&L, and Shift Summary, and tracks COGS on modified items', async () => {
    await (db.inventory as any).put({ id: 'inv_patty', name: 'Chicken Patty', unit: 'pcs', stock: 50, cost: 120 });
    await (db.recipes as any).add({ menuItemId: 'm1', inventoryId: 'inv_patty', qtyRequired: 1 });
    await setOpeningCash(1000);

    const nowIso = new Date().toISOString();
    // Sale 1: 2x Zinger Burger (modified id m1::Size:Large, menuItemId m1) @ Rs 800 = Rs 1600, with 1 refunded (Rs 800 refunded)
    await (db.sales as any).add({
      timestamp: nowIso,
      orderType: 'DINE_IN',
      serverUser: 'owner',
      items: [{ id: 'm1::Size:Large', menuItemId: 'm1', name: 'Zinger Burger (Large)', price: 800, qty: 2, refundedQty: 1 }],
      subtotal: 1600,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 1600,
      refundedAmount: 800,
      refundStatus: 'PARTIAL',
      payments: [{ method: 'Cash', amount: 1600, cashGiven: 2000, change: 400 }],
      totalReceived: 2000,
      totalChange: 400,
    });

    await (db.expenses as any).add({
      timestamp: nowIso,
      amount: 200,
      category: 'Supplies',
      description: 'Packaging',
      serverUser: 'owner',
      status: 'APPROVED',
      paymentMethod: 'Cash Drawer',
    });

    const summary = await getPeriodSummary();
    expect(summary.todaySales).toBe(800);
    expect(summary.totalOverallSales).toBe(800);

    const analytics = await getAnalytics('day');
    expect(analytics.topItems[0]?.metric).toBe(1); // 2 sold minus 1 refunded = 1 net sold

    const todayStr = nowIso.slice(0, 10);
    const pnl = await getPnl(todayStr, todayStr);
    expect(pnl.sales).toBe(800);
    expect(pnl.expenses).toBe(200);
    expect(pnl.net).toBe(600);

    const shift = await buildShiftReport();
    expect(shift.totalSales).toBe(800);
    expect(shift.dineIn).toBe(800);
    // Cash collected 2000 - change 400 - cash refunded 800 = netCash 800; + openingCash 1000 = 1800
    expect(shift.netCash).toBe(800);
    expect(shift.expectedDrawerCash).toBe(1800);
    // 1 net unrefunded modified burger consumed 1 patty @ Rs 120 = Rs 120 COGS
    expect(shift.consumedCost).toBe(120);
    expect(shift.grossProfit).toBe(680);
  });
});
