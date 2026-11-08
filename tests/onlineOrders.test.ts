import { describe, expect, it } from 'vitest';
import { isActive, nextStatus } from '../src/lib/onlineOrders';
import type { OnlineOrder, OnlineOrderStatus } from '../src/lib/db/types';

function order(status: OnlineOrderStatus, orderType: OnlineOrder['orderType']): OnlineOrder {
  return {
    createdAt: '2026-10-20T12:00:00.000Z',
    customer: { name: 'Test' },
    orderType,
    items: [],
    total: 0,
    status,
  };
}

describe('online order lifecycle', () => {
  it('runs delivery orders through every stage', () => {
    expect(nextStatus(order('PENDING', 'DELIVERY'))).toBe('ACCEPTED');
    expect(nextStatus(order('ACCEPTED', 'DELIVERY'))).toBe('PREPARING');
    expect(nextStatus(order('PREPARING', 'DELIVERY'))).toBe('OUT_FOR_DELIVERY');
    expect(nextStatus(order('OUT_FOR_DELIVERY', 'DELIVERY'))).toBe('COMPLETED');
    expect(nextStatus(order('COMPLETED', 'DELIVERY'))).toBeNull();
  });

  it('completes takeaway and dine-in straight after preparing', () => {
    expect(nextStatus(order('PREPARING', 'TAKEAWAY'))).toBe('COMPLETED');
    expect(nextStatus(order('PREPARING', 'DINE_IN'))).toBe('COMPLETED');
  });

  it('treats only unfinished orders as active', () => {
    expect(isActive(order('PENDING', 'DELIVERY'))).toBe(true);
    expect(isActive(order('OUT_FOR_DELIVERY', 'DELIVERY'))).toBe(true);
    expect(isActive(order('COMPLETED', 'DELIVERY'))).toBe(false);
    expect(isActive(order('REJECTED', 'DELIVERY'))).toBe(false);
  });
});
