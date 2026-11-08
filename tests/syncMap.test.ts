import { describe, expect, it } from 'vitest';
import {
  cloudMenuToLocal,
  cloudOrderToLocal,
  cloudSaleToLocal,
  localMenuToCloud,
  localOrderPatch,
} from '../src/lib/syncMap';

describe('supabase row mapping', () => {
  it('round-trips menu item and recipe fields between Supabase snake_case and POS camelCase', () => {
    const cloudRow = {
      id: 'MENU_1',
      category_id: 'CAT_1',
      name: 'Chicken Karrahi',
      price: 2100,
      image_url: 'https://example.com/karrahi.jpg',
      description: 'Freshly cooked',
      available: true,
      is_addon: false,
      modifier_groups: [],
      recipes: [{ inventoryId: 'INV_1', qtyRequired: 0.5 }],
      updated_at: '2026-10-18T16:40:57.934Z',
    };

    const { item, recipes } = cloudMenuToLocal(cloudRow);
    expect(item.id).toBe('MENU_1');
    expect(item.categoryId).toBe('CAT_1');
    expect(item.price).toBe(2100);
    expect(item.available).toBe(true);
    expect(recipes).toEqual([{ inventoryId: 'INV_1', qtyRequired: 0.5 }]);

    const backToCloud = localMenuToCloud(item, recipes);
    expect(backToCloud.category_id).toBe('CAT_1');
    expect(backToCloud.available).toBe(true);
    expect(backToCloud.recipes).toEqual([{ inventoryId: 'INV_1', qtyRequired: 0.5 }]);
  });
});

describe('online order mapping', () => {
  const cloud = {
    status: 'OUT_FOR_DELIVERY',
    order_type: 'DELIVERY',
    total: 4200,
    sale_id: 17,
    created_at: '2026-09-18T23:17:49.568Z',
    out_for_delivery_at: '2026-09-18T23:20:00.000Z',
    rejection_reason: 'Kitchen closed',
    customer: { name: 'Ali', phone: '03001234567', address: 'Street 4' },
    items: [{ id: 'MENU_1', menu_item_id: 'MENU_1', name: 'Karrahi', price: 2100, qty: 2 }],
  };

  it('maps the website fields onto the local shape', () => {
    const order = cloudOrderToLocal('ORDER_9', cloud);

    expect(order.cloudId).toBe('ORDER_9');
    expect(order.status).toBe('OUT_FOR_DELIVERY');
    expect(order.orderType).toBe('DELIVERY');
    expect(order.total).toBe(4200);
    expect(order.saleId).toBe(17);
    expect(order.customer).toEqual({ name: 'Ali', phone: '03001234567', address: 'Street 4' });
    expect(order.items[0]).toMatchObject({ menuItemId: 'MENU_1', qty: 2, price: 2100 });
    expect(order.dispatchedAt).toBe('2026-09-18T23:20:00.000Z');
    expect(order.rejectReason).toBe('Kitchen closed');
  });

  it('defaults an unknown order type instead of losing the order', () => {
    expect(cloudOrderToLocal('X', { order_type: 'WHATEVER' }).orderType).toBe('DELIVERY');
  });

  it('patches only lifecycle fields, under their Supabase column names', () => {
    const order = cloudOrderToLocal('ORDER_9', {
      ...cloud,
      status: 'REJECTED',
      rejected_at: '2026-09-18T23:21:00.000Z',
    });
    const patch = localOrderPatch(order);

    expect(patch).toMatchObject({
      status: 'REJECTED',
      rejected_at: '2026-09-18T23:21:00.000Z',
      rejection_reason: 'Kitchen closed',
      sale_id: 17,
    });
    expect(patch).not.toHaveProperty('items');
    expect(patch).not.toHaveProperty('customer');
  });

  it('maps a cloud sale to a local sale with no local id', () => {
    const sale = cloudSaleToLocal('SALE_1', {
      localId: 12,
      total: 500,
      createdAt: '2026-09-02T12:24:39.118Z',
      items: [],
    });
    expect(sale.cloudId).toBe('SALE_1');
    expect(sale.localId).toBe(12);
    expect(sale.id).toBeUndefined();
    expect(sale.timestamp).toBe('2026-09-02T12:24:39.118Z');
  });
});
