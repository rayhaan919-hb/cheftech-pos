import { db } from './db';
import { logAudit } from './audit';
import type { Sale } from './db/types';

const SHIFT_START = 'shiftStartTime';
const OPENING_CASH = 'shiftOpeningCash';

export async function getShiftStart(): Promise<string> {
  const stored = await db.settings.get(SHIFT_START);
  if (stored?.value) return String(stored.value);
  const now = new Date().toISOString();
  await db.settings.put({ key: SHIFT_START, value: now });
  return now;
}

export async function getOpeningCash(): Promise<number> {
  const stored = await db.settings.get(OPENING_CASH);
  const value = stored ? Number(stored.value) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function setOpeningCash(amount: number): Promise<number> {
  const value = Math.max(0, Number(amount) || 0);
  await db.settings.put({ key: OPENING_CASH, value: String(value) });
  return value;
}

/** Ends the shift: new start time, opening cash cleared for the next session. */
export async function closeShift(user: string): Promise<string> {
  const now = new Date().toISOString();
  await db.settings.put({ key: SHIFT_START, value: now });
  await db.settings.delete(OPENING_CASH);
  await logAudit('SHIFT_CLOSE', `Shift closed at ${new Date(now).toLocaleString()}`, user);
  return now;
}

export interface IngredientUsage {
  name: string;
  unit: string;
  qtyConsumed: number;
  costPerUnit: number;
  costConsumed: number;
}

export interface ShiftReport {
  startedAt: string;
  openingCash: number;
  totalSales: number;
  orderCount: number;
  packingCharges: number;
  tax: number;
  otherCharges: number;
  dineIn: number;
  takeaway: number;
  delivery: number;
  cashCollected: number;
  changeGiven: number;
  netCash: number;
  expectedDrawerCash: number;
  discountsByStaff: Array<{ user: string; amount: number }>;
  totalDiscounts: number;
  discountedOrderCount: number;
  ingredients: IngredientUsage[];
  consumedCost: number;
  grossProfit: number;
}

export async function buildShiftReport(): Promise<ShiftReport> {
  const [startedAt, openingCash, sales, inventory, recipes] = await Promise.all([
    getShiftStart(),
    getOpeningCash(),
    db.sales.toArray(),
    db.inventory.toArray(),
    db.recipes.toArray(),
  ]);

  const from = new Date(startedAt).getTime();
  const shiftSales = sales.filter((s: Sale) => new Date(s.timestamp).getTime() >= from);
  const sum = (pick: (sale: Sale) => number) => shiftSales.reduce((total, sale) => total + pick(sale), 0);

  const totalSales = sum((s) => Number(s.total) || 0);
  const cashCollected = sum((sale) =>
    (sale.payments || []).reduce((total, payment) => {
      if ((payment.method || 'Cash') !== 'Cash') return total;
      return total + (Number(payment.cashGiven ?? payment.amount ?? 0) || 0);
    }, 0),
  );
  const changeGiven = sum((s) => Number(s.totalChange) || 0);

  const staffDiscounts = new Map<string, number>();
  let totalDiscounts = 0;
  let discountedOrderCount = 0;
  for (const sale of shiftSales) {
    const amount = Number(sale.discountAmount) || ((Number(sale.subtotal) || 0) * (Number(sale.discountPercent) || 0)) / 100;
    totalDiscounts += amount;
    if (amount <= 0) continue;
    discountedOrderCount++;
    const user = sale.serverUser || 'Staff';
    staffDiscounts.set(user, (staffDiscounts.get(user) || 0) + amount);
  }

  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const usage = new Map<string, IngredientUsage>();
  let consumedCost = 0;

  for (const sale of shiftSales) {
    for (const line of sale.items || []) {
      for (const recipe of recipes.filter((r) => r.menuItemId === line.id)) {
        const item = inventoryById.get(recipe.inventoryId);
        const row = usage.get(recipe.inventoryId) || {
          name: item?.name || recipe.inventoryId,
          unit: item?.unit || '',
          qtyConsumed: 0,
          costPerUnit: Number(item?.cost) || 0,
          costConsumed: 0,
        };
        const qty = (Number(recipe.qtyRequired) || 0) * (Number(line.qty) || 0);
        row.qtyConsumed += qty;
        row.costConsumed += qty * row.costPerUnit;
        consumedCost += qty * row.costPerUnit;
        usage.set(recipe.inventoryId, row);
      }
    }
  }

  return {
    startedAt,
    openingCash,
    totalSales,
    orderCount: shiftSales.length,
    packingCharges: sum((s) => Number(s.packingCharge) || 0),
    tax: sum((s) => Number(s.taxAmount) || 0),
    otherCharges: sum((s) => Number(s.otherCharge) || 0),
    dineIn: sum((s) => (s.orderType === 'DINE_IN' ? Number(s.total) || 0 : 0)),
    takeaway: sum((s) => (s.orderType === 'TAKEAWAY' ? Number(s.total) || 0 : 0)),
    delivery: sum((s) => (s.orderType === 'DELIVERY' ? Number(s.total) || 0 : 0)),
    cashCollected,
    changeGiven,
    netCash: cashCollected - changeGiven,
    expectedDrawerCash: openingCash + cashCollected - changeGiven,
    discountsByStaff: [...staffDiscounts].map(([user, amount]) => ({ user, amount })),
    totalDiscounts,
    discountedOrderCount,
    ingredients: [...usage.values()],
    consumedCost,
    grossProfit: totalSales - consumedCost,
  };
}
