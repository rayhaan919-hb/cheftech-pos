import { db } from './db';
import { logAudit } from './audit';
import { upsertCustomer } from './customers';
import { deleteSale, pushSale, pushStock } from './sync';
import type { CartItem, OrderType, PaymentDetail, Sale, CustomerInfo } from './db/types';

export const MIN_DELIVERY_ORDER = 500;
const MIN_DELIVERY_KEY = 'cheftech_min_delivery';

export function getMinDeliveryOrder(): number {
  if (typeof localStorage !== 'undefined') {
    try {
      const val = localStorage.getItem(MIN_DELIVERY_KEY);
      if (val != null) {
        const num = Number(val);
        if (Number.isFinite(num) && num >= 0) return num;
      }
    } catch {
      // ignore
    }
  }
  return MIN_DELIVERY_ORDER;
}

export function setMinDeliveryOrder(value: number): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MIN_DELIVERY_KEY, String(Math.max(0, value)));
    } catch {
      // ignore
    }
  }
}

export async function verifyStock(items: CartItem[]): Promise<string | null> {
  for (const cartItem of items) {
    const recipes = await db.recipes.where('menuItemId').equals(cartItem.menuItemId || cartItem.id).toArray();
    for (const recipe of recipes) {
      const ingredient = await db.inventory.get(recipe.inventoryId);
      if (!ingredient) continue;
      if ((Number(ingredient.stock) || 0) < recipe.qtyRequired * cartItem.qty) {
        return `${ingredient.name} is out of stock or insufficient quantity.`;
      }
    }
  }
  return null;
}

export interface SaleInput {
  items: CartItem[];
  orderType: OrderType;
  tableNumber?: string;
  serverUser: string;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  deliveryCharge: number;
  packingCharge: number;
  taxPercent: number;
  taxAmount: number;
  otherCharge: number;
  loyaltyRedeemPoints?: number;
  loyaltyDiscount?: number;
  total: number;
  payments: PaymentDetail[];
  customer?: CustomerInfo;
  deliveryInfo?: CustomerInfo;
  onlineOrderId?: string | null;
}

/** Commits a sale, deducts recipe-linked stock, opens a delivery row and updates the CRM record. */
export async function recordSale(input: SaleInput): Promise<number> {
  const payments = input.payments.map((p) => ({
    ...p,
    amount: Number(p.amount) || 0,
    change: p.method === 'Cash' && p.cashGiven != null ? Math.max(0, p.cashGiven - p.amount) : 0,
  }));

  let saleId = 0;
  const touchedStock = new Set<string>();
  await db.transaction('rw', db.sales, db.inventory, db.recipes, db.deliveries, db.customers, async () => {
    const sale: Sale = {
      ...input,
      payments,
      totalReceived: payments.reduce(
        (sum, p) => sum + (p.method === 'Cash' && p.cashGiven != null ? p.cashGiven : p.amount),
        0,
      ),
      totalChange: payments.reduce((sum, p) => sum + (p.change || 0), 0),
      timestamp: new Date().toISOString(),
    };
    saleId = (await db.sales.add(sale)) as number;

    for (const cartItem of sale.items) {
      const recipes = await db.recipes
        .where('menuItemId')
        .equals(cartItem.menuItemId || cartItem.id)
        .toArray();
      for (const recipe of recipes) {
        const ingredient = await db.inventory.get(recipe.inventoryId);
        if (!ingredient) continue;
        await db.inventory.update(recipe.inventoryId, {
          stock: Math.max(0, (Number(ingredient.stock) || 0) - recipe.qtyRequired * cartItem.qty),
        });
        touchedStock.add(recipe.inventoryId);
      }
    }

    if (sale.orderType === 'DELIVERY' && sale.deliveryInfo?.phone) {
      await db.deliveries.add({
        saleId,
        status: 'PENDING',
        createdAt: sale.timestamp,
        customerName: sale.deliveryInfo.name || '',
        customerPhone: sale.deliveryInfo.phone || '',
        customerAddress: sale.deliveryInfo.address || '',
        deliveryCharge: sale.deliveryCharge,
      });
    }

    const crm = sale.customer?.phone
      ? sale.customer
      : sale.orderType === 'DELIVERY' && sale.deliveryInfo?.phone
        ? sale.deliveryInfo
        : undefined;
    await upsertCustomer(crm, sale.total, sale.loyaltyRedeemPoints || 0);
  });

  // Fire-and-forget after the local commit, exactly like the legacy app.
  pushSale(saleId);
  pushStock(touchedStock);
  return saleId;
}

/** Returns recipe-linked stock for items being voided or re-opened into the cart. */
export async function restoreInventory(items: CartItem[]): Promise<void> {
  for (const cartItem of items) {
    const recipes = await db.recipes
      .where('menuItemId')
      .equals(cartItem.menuItemId || cartItem.id)
      .toArray();
    for (const recipe of recipes) {
      const ingredient = await db.inventory.get(recipe.inventoryId);
      if (!ingredient) continue;
      await db.inventory.update(recipe.inventoryId, {
        stock: (Number(ingredient.stock) || 0) + recipe.qtyRequired * cartItem.qty,
      });
    }
  }
}

/** Pulls a completed sale back into the counter cart: restocks it, deletes it, audits it. */
export async function reopenSale(sale: Sale, user: string) {
  await db.transaction('rw', db.sales, db.inventory, db.recipes, db.deliveries, async () => {
    await restoreInventory(sale.items);
    await db.sales.delete(sale.id!);
    await db.deliveries.where('saleId').equals(sale.id!).delete();
  });
  if (sale.cloudId) deleteSale(sale.cloudId);
  await logAudit('SALE_EDIT', `Order #${sale.id} re-opened into cart for editing`, user, sale.id);
}
