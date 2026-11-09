import { beforeEach, describe, expect, it, vi } from 'vitest';

const memMenu = new Map<string, any>();
const memInventory = new Map<string, any>();
const memRecipes: any[] = [];
const memSales: any[] = [];
const memDeliveries: any[] = [];
const memCustomers: any[] = [];
const memOnlineOrders: any[] = [];
const memAuditLogs: any[] = [];

vi.mock('../src/lib/db', () => {
  return {
    db: {
      menu: {
        get: async (id: string) => memMenu.get(id),
        toArray: async () => Array.from(memMenu.values()),
        bulkPut: async (rows: any[]) => {
          for (const r of rows) memMenu.set(r.id, r);
        },
        clear: async () => memMenu.clear(),
      },
      inventory: {
        get: async (id: string) => memInventory.get(id),
        toArray: async () => Array.from(memInventory.values()),
        put: async (row: any) => {
          memInventory.set(row.id, row);
          return row.id;
        },
        update: async (id: string, patch: any) => {
          const existing = memInventory.get(id);
          if (existing) memInventory.set(id, { ...existing, ...patch });
          return 1;
        },
        clear: async () => memInventory.clear(),
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
        get: async (id: number) => memSales.find((s) => s.id === id),
        add: async (row: any) => {
          const id = memSales.length + 1;
          memSales.push({ ...row, id });
          return id;
        },
        toArray: async () => [...memSales],
        clear: async () => {
          memSales.length = 0;
        },
      },
      deliveries: {
        add: async (row: any) => {
          memDeliveries.push(row);
          return memDeliveries.length;
        },
      },
      customers: {
        get: async () => null,
        put: async () => 1,
        where: () => ({ equals: () => ({ first: async () => null }) }),
        toArray: async () => [...memCustomers],
      },
      onlineOrders: {
        get: async (id: number) => memOnlineOrders.find((o) => o.id === id),
        add: async (row: any) => {
          const id = memOnlineOrders.length + 1;
          memOnlineOrders.push({ ...row, id });
          return id;
        },
        update: async (id: number, patch: any) => {
          const idx = memOnlineOrders.findIndex((o) => o.id === id);
          if (idx >= 0) memOnlineOrders[idx] = { ...memOnlineOrders[idx], ...patch };
          return 1;
        },
        toArray: async () => [...memOnlineOrders],
        clear: async () => {
          memOnlineOrders.length = 0;
        },
      },
      auditLogs: {
        add: async (row: any) => {
          memAuditLogs.push(row);
          return memAuditLogs.length;
        },
      },
      transaction: async (_mode: string, ...tablesAndFn: any[]) => {
        const fn = tablesAndFn[tablesAndFn.length - 1];
        return await fn();
      },
    },
  };
});

import { db } from '../src/lib/db';
import { recordSale, verifyStock } from '../src/lib/sales';
import { verifyOnlineOrder } from '../src/lib/onlineOrders';

describe('Transactional Checkout & Inventory Integrity', () => {
  beforeEach(async () => {
    await db.menu.clear();
    await db.inventory.clear();
    await db.recipes.clear();
    await (db.sales as any).clear();
    await (db.onlineOrders as any).clear();
  });

  it('rejects order when required recipe ingredient stock is insufficient', async () => {
    await db.menu.bulkPut([
      { id: 'm_burger', name: 'Zinger Burger', price: 650, available: true },
    ]);
    await (db.inventory as any).put({
      id: 'inv_patty',
      name: 'Chicken Patty',
      stock: 1, // Only 1 in stock
      unit: 'pcs',
    });
    await (db.recipes as any).add({
      menuItemId: 'm_burger',
      inventoryId: 'inv_patty',
      qtyRequired: 1,
    });

    // Requesting 2 burgers requires 2 patties, but only 1 is in stock
    const stockErr = await verifyStock([
      { id: 'm_burger', menuItemId: 'm_burger', name: 'Zinger Burger', price: 650, qty: 2 },
    ]);

    expect(stockErr).toContain('Chicken Patty is out of stock or insufficient quantity');
  });

  it('prevents double inventory deduction when online orders are converted to POS sales', async () => {
    await db.menu.bulkPut([
      { id: 'm_burger', name: 'Zinger Burger', price: 650, available: true },
    ]);
    await (db.inventory as any).put({
      id: 'inv_patty',
      name: 'Chicken Patty',
      stock: 10,
      unit: 'pcs',
    });
    await (db.recipes as any).add({
      menuItemId: 'm_burger',
      inventoryId: 'inv_patty',
      qtyRequired: 1,
    });

    // 1. Regular walk-in POS sale (onlineOrderId is null) -> deducts recipe stock
    await recordSale({
      items: [{ id: 'm_burger', menuItemId: 'm_burger', name: 'Zinger Burger', price: 650, qty: 2 }],
      orderType: 'DINE_IN',
      serverUser: 'cashier',
      subtotal: 1300,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 0,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 1300,
      payments: [{ method: 'Cash', amount: 1300 }],
      onlineOrderId: null,
    });

    const pattyAfterWalkin = await db.inventory.get('inv_patty');
    expect(pattyAfterWalkin?.stock).toBe(8); // 10 - 2 = 8

    // 2. Online order checkout (onlineOrderId is present, ingredients already deducted at website checkout)
    await recordSale({
      items: [{ id: 'm_burger', menuItemId: 'm_burger', name: 'Zinger Burger', price: 650, qty: 3 }],
      orderType: 'DELIVERY',
      serverUser: 'staff',
      subtotal: 1950,
      discountPercent: 0,
      discountAmount: 0,
      deliveryCharge: 100,
      packingCharge: 0,
      taxPercent: 0,
      taxAmount: 0,
      otherCharge: 0,
      total: 2050,
      payments: [{ method: 'Cash', amount: 2050 }],
      customer: { name: 'Customer A', phone: '03001234567', address: 'Model Town' },
      onlineOrderId: 'ORD-CLOUD-12345',
    });

    const pattyAfterOnline = await db.inventory.get('inv_patty');
    // Stock remains 8 because online order ingredients were already accounted for in cloud inventory
    expect(pattyAfterOnline?.stock).toBe(8);
  });

  it('rejects tampered client prices and verifies authoritative menu prices', async () => {
    await db.menu.bulkPut([
      { id: 'm_pizza', name: 'Fajita Pizza', price: 1200, available: true },
    ]);

    const result = await verifyOnlineOrder({
      createdAt: new Date().toISOString(),
      customer: { name: 'Bob', phone: '03211112233' },
      orderType: 'TAKEAWAY',
      items: [{ id: 'm_pizza', menuItemId: 'm_pizza', name: 'Fajita Pizza', price: 10, qty: 1 }],
      total: 10, // Tampered Rs. 10 price
      status: 'PENDING',
    });

    expect(result.priceMismatch).toBe(true);
    expect(result.computedSubtotal).toBe(1200);
    expect(result.items[0].price).toBe(1200);
  });
});
