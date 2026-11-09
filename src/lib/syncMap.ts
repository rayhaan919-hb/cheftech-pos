import type { Category, InventoryItem, MenuItem, OnlineOrder, OnlineOrderStatus, Sale } from './db/types';

export function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function stampMs(value: unknown): number {
  const iso = toIso(value);
  return iso ? Date.parse(iso) : 0;
}

const CLOUD_TIMESTAMP: Partial<Record<OnlineOrderStatus, [keyof OnlineOrder, string]>> = {
  ACCEPTED: ['acceptedAt', 'accepted_at'],
  PREPARING: ['preparingAt', 'preparing_at'],
  OUT_FOR_DELIVERY: ['dispatchedAt', 'out_for_delivery_at'],
  COMPLETED: ['completedAt', 'completed_at'],
  REJECTED: ['rejectedAt', 'rejected_at'],
};

const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;

export function cloudOrderToLocal(cloudId: string, data: Record<string, any>): OnlineOrder {
  const rawType = data.order_type || data.orderType;
  const order: OnlineOrder = {
    cloudId,
    createdAt: toIso(data.created_at ?? data.createdAt) ?? new Date().toISOString(),
    customer: {
      name: data.customer?.name || '',
      phone: data.customer?.phone || '',
      address: data.customer?.address || '',
    },
    orderType: ORDER_TYPES.includes(rawType) ? rawType : 'DELIVERY',
    items: (data.items || []).map((line: any, index: number) => {
      const menuItemId = String(line.menu_item_id || line.menuItemId || line.id || '');
      return {
        id: menuItemId || `CUSTOM_${index}`,
        menuItemId,
        name: line.name || 'Item',
        price: Number(line.price) || 0,
        qty: Number(line.qty) || 1,
      };
    }),
    total: Number(data.total) || 0,
    status: (data.status || 'PENDING') as OnlineOrderStatus,
  };
  if (data.subtotal !== undefined && data.subtotal !== null) {
    order.subtotal = Number(data.subtotal) || 0;
  }
  const discountAmount = data.discount_amount ?? data.discountAmount;
  if (discountAmount !== undefined && discountAmount !== null) {
    order.discountAmount = Number(discountAmount) || 0;
  }
  const couponCode = data.coupon_code ?? data.couponCode;
  if (couponCode) {
    order.couponCode = String(couponCode);
  }
  const loyaltyRedeemPoints = data.loyalty_redeem_points ?? data.loyaltyRedeemPoints;
  if (loyaltyRedeemPoints !== undefined && loyaltyRedeemPoints !== null) {
    order.loyaltyRedeemPoints = Number(loyaltyRedeemPoints) || 0;
  }
  const loyaltyDiscount = data.loyalty_discount ?? data.loyaltyDiscount;
  if (loyaltyDiscount !== undefined && loyaltyDiscount !== null) {
    order.loyaltyDiscount = Number(loyaltyDiscount) || 0;
  }
  for (const [local, cloud] of Object.values(CLOUD_TIMESTAMP)) {
    const iso = toIso(data[cloud] ?? data[local]);
    if (iso) (order as any)[local] = iso;
  }
  const rejectReason = data.rejection_reason ?? data.rejectionReason;
  if (rejectReason) order.rejectReason = String(rejectReason);
  if (data.note) order.note = String(data.note);
  const saleId = Number(data.sale_id ?? data.saleId);
  if (saleId) order.saleId = saleId;
  return order;
}

export function localOrderPatch(order: OnlineOrder): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    status: order.status,
    updated_at: new Date().toISOString(),
  };
  const timestamp = CLOUD_TIMESTAMP[order.status];
  if (timestamp) {
    const [localField, cloudField] = timestamp;
    const iso = toIso(order[localField]);
    if (iso) patch[cloudField] = iso;
  }
  if (order.rejectReason) patch.rejection_reason = order.rejectReason;
  if (order.saleId) patch.sale_id = order.saleId;
  return patch;
}

export function cloudMenuToLocal(row: Record<string, any>): {
  item: MenuItem;
  recipes: Array<{ inventoryId: string; qtyRequired: number }>;
} {
  const recipesRaw = Array.isArray(row.recipes) ? row.recipes : [];
  const item: MenuItem = {
    id: String(row.id),
    categoryId: String(row.category_id ?? row.categoryId ?? ''),
    name: String(row.name ?? ''),
    price: Number(row.price) || 0,
    imageUrl: row.image_url ?? row.imageUrl ?? undefined,
    description: row.description ?? undefined,
    available: row.available !== false,
    isAddon: Boolean(row.is_addon ?? row.isAddon),
    modifierGroups: Array.isArray(row.modifier_groups ?? row.modifierGroups)
      ? (row.modifier_groups ?? row.modifierGroups)
      : undefined,
    updatedAt: toIso(row.updated_at ?? row.updatedAt) ?? new Date().toISOString(),
  };
  return {
    item,
    recipes: recipesRaw.map((r: any) => ({
      inventoryId: String(r.inventoryId ?? r.inventory_id ?? ''),
      qtyRequired: Number(r.qtyRequired ?? r.qty_required ?? r.qty) || 0,
    })),
  };
}

export function localMenuToCloud(
  item: MenuItem,
  recipes: Array<{ inventoryId: string; qtyRequired: number }>
): Record<string, unknown> {
  return {
    id: item.id,
    category_id: item.categoryId || null,
    name: item.name,
    price: Number(item.price) || 0,
    image_url: item.imageUrl || '',
    description: item.description || '',
    available: item.available !== false,
    is_addon: Boolean(item.isAddon),
    modifier_groups: item.modifierGroups ?? [],
    recipes,
    updated_at: new Date().toISOString(),
  };
}

export function cloudCategoryToLocal(row: Record<string, any>): Category {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    order: Number(row.sort_order ?? row.order ?? 0),
    updatedAt: toIso(row.updated_at ?? row.updatedAt) ?? new Date().toISOString(),
  };
}

export function localCategoryToCloud(cat: Category): Record<string, unknown> {
  return {
    id: cat.id,
    name: cat.name,
    sort_order: Number(cat.order ?? 0),
    updated_at: new Date().toISOString(),
  };
}

export function cloudInventoryToLocal(row: Record<string, any>): InventoryItem {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    stock: Math.max(0, Number(row.stock) || 0),
    unit: String(row.unit || 'pcs'),
    cost: Math.max(0, Number(row.cost) || 0),
    lowStockThreshold: Number(row.low_stock_threshold ?? row.lowStockThreshold ?? 5),
    updatedAt: toIso(row.updated_at ?? row.updatedAt) ?? new Date().toISOString(),
  };
}

export function localInventoryToCloud(inv: InventoryItem): Record<string, unknown> {
  return {
    id: inv.id,
    name: inv.name,
    stock: Math.max(0, Number(inv.stock) || 0),
    unit: inv.unit || 'pcs',
    cost: Math.max(0, Number(inv.cost) || 0),
    low_stock_threshold: Number(inv.lowStockThreshold ?? 5),
    updated_at: new Date().toISOString(),
  };
}

export function cloudSaleToLocal(cloudId: string, data: Record<string, any>): Sale {
  return {
    id: undefined,
    cloudId,
    localId: Number(data.id ?? data.localId) || undefined,
    timestamp: toIso(data.date ?? data.createdAt ?? data.timestamp) ?? new Date().toISOString(),
    orderType: ORDER_TYPES.includes(data.order_type ?? data.orderType)
      ? (data.order_type ?? data.orderType)
      : 'DINE_IN',
    serverUser: String(data.cashier ?? data.serverUser ?? 'Staff'),
    items: Array.isArray(data.items) ? data.items : [],
    subtotal: Number(data.subtotal) || 0,
    discountPercent: Number(data.discount_val ?? data.discountPercent) || 0,
    discountAmount: Number(data.discount ?? data.discountAmount) || 0,
    deliveryCharge: Number(data.deliveryCharge) || 0,
    packingCharge: Number(data.packingCharge) || 0,
    taxPercent: Number(data.taxPercent) || 0,
    taxAmount: Number(data.taxAmount) || 0,
    otherCharge: Number(data.otherCharge) || 0,
    loyaltyRedeemPoints: Number(data.loyalty_redeem_pts ?? data.loyaltyRedeemPoints) || 0,
    loyaltyDiscount: Number(data.loyalty_redeem_amt ?? data.loyaltyDiscount) || 0,
    total: Number(data.total) || 0,
    payments: [{ method: (data.payment_method as any) || 'Cash', amount: Number(data.total) || 0 }],
    totalReceived: Number(data.total) || 0,
    totalChange: 0,
    customer: data.customer_phone
      ? {
          name: data.customer_name || '',
          phone: data.customer_phone || '',
          address: data.customer_address || '',
        }
      : undefined,
  };
}
