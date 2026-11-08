import type { CartItem, MenuItem, ModifierSelection, OrderType } from './db/types';
import { normalizeCharge, roundAmount } from './format';

export const LOYALTY_POINT_VALUE = 1;

export interface CartCharges {
  orderType: OrderType;
  tableNumber?: string;
  discountPercent: number;
  deliveryCharge: number;
  packingCharge: number;
  taxPercent: number;
  otherCharge: number;
  loyaltyPoints: number;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  deliveryCharge: number;
  packingCharge: number;
  otherCharge: number;
  taxAmount: number;
  loyaltyDiscount: number;
  grandTotal: number;
}

export function calculateCartTotals(items: CartItem[], charges: CartCharges): CartTotals {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const discountAmount = subtotal * (charges.discountPercent / 100);
  const deliveryCharge = charges.orderType === 'DELIVERY' ? normalizeCharge(charges.deliveryCharge) : 0;
  const packingCharge = normalizeCharge(charges.packingCharge);
  const otherCharge = normalizeCharge(charges.otherCharge);
  const taxableAmount = subtotal - discountAmount + deliveryCharge + packingCharge + otherCharge;
  const taxAmount = taxableAmount * (charges.taxPercent / 100);
  const loyaltyDiscount = Math.min(
    (Number(charges.loyaltyPoints) || 0) * LOYALTY_POINT_VALUE,
    Math.max(0, subtotal - discountAmount),
  );
  const grandTotal = roundAmount(Math.max(0, taxableAmount + taxAmount - loyaltyDiscount));

  return { subtotal, discountAmount, deliveryCharge, packingCharge, otherCharge, taxAmount, loyaltyDiscount, grandTotal };
}

/** Adds a menu item or increments its qty if already in the cart. */
export function addToCart(items: CartItem[], item: CartItem): CartItem[] {
  const existing = items.find((i) => i.id === item.id);
  if (existing) {
    return items.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i));
  }
  return [...items, item];
}

export function setQty(items: CartItem[], id: string, qty: number): CartItem[] {
  if (qty <= 0) return items.filter((i) => i.id !== id);
  return items.map((i) => (i.id === id ? { ...i, qty } : i));
}

/**
 * Builds the cart line for a customized menu item. The id embeds the sorted
 * selection so the same combination merges into one line while a different
 * combination stays separate.
 */
export function composeModifiedItem(item: MenuItem, selections: ModifierSelection[]): CartItem {
  const key = selections.map((m) => `${m.group}:${m.name}`).sort().join('|');
  return {
    id: key ? `${item.id}::${key}` : item.id,
    menuItemId: item.id,
    name: selections.length ? `${item.name} (${selections.map((m) => m.name).join(', ')})` : item.name,
    price: (Number(item.price) || 0) + selections.reduce((sum, m) => sum + (Number(m.price) || 0), 0),
    qty: 1,
    modifiers: selections,
  };
}
