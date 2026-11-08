import { describe, it, expect } from 'vitest';
import { addToCart, calculateCartTotals, setQty } from '../src/lib/cart';
import type { CartItem } from '../src/lib/db/types';

const item = (id: string, price: number, qty = 1): CartItem => ({
  id, menuItemId: id, name: id, price, qty,
});

const charges = {
  orderType: 'DINE_IN' as const,
  discountPercent: 0,
  deliveryCharge: 0,
  packingCharge: 0,
  taxPercent: 0,
  otherCharge: 0,
  loyaltyPoints: 0,
};

describe('calculateCartTotals', () => {
  it('sums line items', () => {
    expect(calculateCartTotals([item('a', 650, 2), item('b', 1450)], charges).subtotal).toBe(2750);
  });

  it('applies discount, charges and tax in the app.js order', () => {
    const totals = calculateCartTotals([item('a', 1000)], {
      ...charges, discountPercent: 10, deliveryCharge: 100, packingCharge: 50, taxPercent: 5,
    });
    // (1000 - 100 + 0 + 50) * 1.05 — delivery only counts for DELIVERY orders
    expect(totals.taxAmount).toBeCloseTo(950 * 0.05);
    expect(totals.grandTotal).toBeCloseTo(997.5);
  });

  it('counts delivery charge only for DELIVERY orders', () => {
    expect(calculateCartTotals([item('a', 1000)], { ...charges, deliveryCharge: 200 }).deliveryCharge).toBe(0);
    expect(
      calculateCartTotals([item('a', 1000)], { ...charges, orderType: 'DELIVERY', deliveryCharge: 200 }).grandTotal,
    ).toBe(1200);
  });

  it('caps loyalty redemption at the discounted subtotal', () => {
    const totals = calculateCartTotals([item('a', 100)], { ...charges, loyaltyPoints: 500 });
    expect(totals.loyaltyDiscount).toBe(100);
    expect(totals.grandTotal).toBe(0);
  });

  it('never returns a negative total', () => {
    expect(calculateCartTotals([], charges).grandTotal).toBe(0);
  });
});

describe('cart mutations', () => {
  it('increments qty for a duplicate line', () => {
    expect(addToCart([item('a', 100)], item('a', 100))).toEqual([{ ...item('a', 100), qty: 2 }]);
  });

  it('removes a line when qty drops to zero', () => {
    expect(setQty([item('a', 100), item('b', 200)], 'a', 0)).toEqual([item('b', 200)]);
  });
});
