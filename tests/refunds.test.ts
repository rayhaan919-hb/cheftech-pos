import { describe, expect, it } from 'vitest';
import { computeRefund, refundableTotal, remainingQty } from '../src/lib/refunds';
import type { CartItem, Sale } from '../src/lib/db/types';

function line(name: string, price: number, qty: number, refundedQty = 0): CartItem {
  return { id: name, menuItemId: name, name, price, qty, refundedQty };
}

function sale(items: CartItem[]): Sale {
  return {
    timestamp: '2026-10-20T12:00:00.000Z',
    orderType: 'DINE_IN',
    serverUser: 'owner',
    items,
    subtotal: 0, discountPercent: 0, discountAmount: 0, deliveryCharge: 0,
    packingCharge: 0, taxPercent: 0, taxAmount: 0, otherCharge: 0,
    total: 0, payments: [], totalReceived: 0, totalChange: 0,
  };
}

describe('refunds', () => {
  it('prices a partial refund from the sale line price', () => {
    const result = computeRefund(sale([line('Zinger', 650, 2), line('Cola', 150, 3)]), [
      { index: 0, qty: 1 },
      { index: 1, qty: 2 },
    ]);
    expect(result.amount).toBe(650 + 300);
    expect(result.fullyRefunded).toBe(false);
    expect(result.remaining).toEqual([1, 1]);
  });

  it('clamps to what is left after earlier refunds', () => {
    const order = sale([line('Zinger', 650, 2)]);
    const first = computeRefund(order, [{ index: 0, qty: 1 }]);
    expect(first.amount).toBe(650);
    expect(first.remaining).toEqual([1]);

    // A second refund can only take the remaining one.
    const second = computeRefund(sale([line('Zinger', 650, 2, 1)]), [{ index: 0, qty: 5 }]);
    expect(second.amount).toBe(650);
    expect(second.fullyRefunded).toBe(true);
  });

  it('ignores over-refunded and fully refunded lines', () => {
    expect(remainingQty(line('Zinger', 650, 2, 2))).toBe(0);
    expect(refundableTotal(sale([line('Zinger', 650, 2, 2), line('Cola', 150, 1)]))).toBe(150);
    expect(computeRefund(sale([line('Zinger', 650, 2, 2)]), [{ index: 0, qty: 1 }]).amount).toBe(0);
  });

  it('refunds the discounted amount, never more than the customer paid', () => {
    // Rs 700 x 2 with a 10% order discount: the bill was Rs 1,260, not Rs 1,400.
    const discounted = { ...sale([line('Zinger', 700, 2)]), total: 1260 };
    expect(computeRefund(discounted, [{ index: 0, qty: 1 }]).amount).toBe(630);
    expect(computeRefund(discounted, [{ index: 0, qty: 2 }]).amount).toBe(1260);
    expect(refundableTotal(discounted)).toBe(1260);
  });

  it('does not count the same line twice within one refund', () => {
    const result = computeRefund(sale([line('Zinger', 650, 2)]), [
      { index: 0, qty: 2 },
      { index: 0, qty: 2 },
    ]);
    expect(result.amount).toBe(1300);
  });

  it('returns amount: 0 when attempting to re-refund an already fully-refunded order (M-06)', () => {
    const fullyRefundedSale = {
      ...sale([line('Zinger', 650, 2, 2), line('Cola', 150, 1, 1)]),
      total: 1450,
      refundedAmount: 1450,
      refundStatus: 'FULL' as const,
    };
    const retry = computeRefund(fullyRefundedSale, [
      { index: 0, qty: 2 },
      { index: 1, qty: 1 },
    ]);
    expect(retry.amount).toBe(0);
    expect(retry.remaining).toEqual([0, 0]);
    expect(retry.fullyRefunded).toBe(true);
    expect(refundableTotal(fullyRefundedSale)).toBe(0);
  });
});
