import { db } from './db';
import { logAudit } from './audit';
import { pushOrder } from './sync';
import { MIN_DELIVERY_ORDER, verifyStock } from './sales';
import type { CartItem, OnlineOrder, OnlineOrderStatus } from './db/types';

/** Lifecycle for delivery orders; takeaway/dine-in stop at COMPLETED. */
export const NEXT_STATUS: Partial<Record<OnlineOrderStatus, OnlineOrderStatus>> = {
  ACCEPTED: 'PREPARING',
  PREPARING: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'COMPLETED',
};

export const STATUS_LABEL: Record<OnlineOrderStatus, string> = {
  PENDING: 'Awaiting acceptance',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};

const ACTIVE: OnlineOrderStatus[] = ['PENDING', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'];

export function isActive(order: OnlineOrder): boolean {
  return ACTIVE.includes(order.status);
}

/**
 * Next state for an order. Delivery runs the full chain; anything else is
 * accepted straight to PREPARING and completed by the cashier.
 */
export function nextStatus(order: OnlineOrder): OnlineOrderStatus | null {
  if (order.status === 'PENDING') return 'ACCEPTED';
  if (order.status === 'PREPARING' && order.orderType !== 'DELIVERY') return 'COMPLETED';
  return NEXT_STATUS[order.status] ?? null;
}

const TIMESTAMP_FIELD: Partial<Record<OnlineOrderStatus, keyof OnlineOrder>> = {
  ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  OUT_FOR_DELIVERY: 'dispatchedAt',
  COMPLETED: 'completedAt',
  REJECTED: 'rejectedAt',
};

/** Syncs online order status to local Dexie and Supabase Cloud. */
export async function setOrderStatus(
  id: number,
  status: OnlineOrderStatus,
  user: string,
  extra: { rejectReason?: string } = {},
): Promise<void> {
  const field = TIMESTAMP_FIELD[status];
  await db.onlineOrders.update(id, {
    status,
    ...(field ? { [field]: new Date().toISOString() } : {}),
    ...extra,
  });
  const order = await db.onlineOrders.get(id);
  if (order) pushOrder(order);
  const who = order?.customer?.name ? ` for ${order.customer.name}` : '';
  const why = extra.rejectReason ? ` — ${extra.rejectReason}` : '';
  await logAudit(`ONLINE_ORDER_${status}`, `Website order #${id}${who} → ${STATUS_LABEL[status]}${why}`, user);
}

export async function rejectOrder(id: number, reason: string, user: string): Promise<void> {
  await setOrderStatus(id, 'REJECTED', user, { rejectReason: reason.trim() || 'Rejected by staff' });
}

/**
 * S-04: Resolves website lines against the local menu and ALWAYS re-prices
 * every matched item from `db.menu` (never trusting client-supplied prices).
 */
export async function resolveOrderToCart(order: OnlineOrder): Promise<CartItem[]> {
  const resolved: CartItem[] = [];
  const allMenu = await db.menu.toArray();
  const byName = new Map(allMenu.map((m) => [m.name.trim().toLowerCase(), m]));

  for (const line of order.items || []) {
    const canonicalId = line.menuItemId || line.id;
    let menuItem = canonicalId ? await db.menu.get(canonicalId) : undefined;
    if (!menuItem && line.name) {
      menuItem = byName.get(line.name.trim().toLowerCase());
    }
    const authoritativePrice = menuItem ? Number(menuItem.price) : Math.max(0, Number(line.price) || 0);
    const qty = Math.max(1, Math.floor(Number(line.qty) || 1));

    resolved.push({
      ...line,
      id: menuItem ? menuItem.id : line.id || `CUSTOM_${Date.now()}_${resolved.length}`,
      menuItemId: menuItem ? menuItem.id : '',
      name: menuItem?.name || line.name,
      price: authoritativePrice,
      qty,
    });
  }
  return resolved;
}

export interface OnlineOrderVerification {
  items: CartItem[];
  computedSubtotal: number;
  priceMismatch: boolean;
  unavailableItems: string[];
  stockError: string | null;
  belowDeliveryMinimum: boolean;
}

/**
 * S-04, M-02, M-07: Re-prices items from local menu, checks `available` flag,
 * verifies ingredient stock via `verifyStock()`, and validates `MIN_DELIVERY_ORDER`.
 */
export async function verifyOnlineOrder(order: OnlineOrder): Promise<OnlineOrderVerification> {
  const items = await resolveOrderToCart(order);
  const unavailableItems: string[] = [];

  for (const item of items) {
    if (item.menuItemId) {
      const menuRow = await db.menu.get(item.menuItemId);
      if (menuRow && menuRow.available === false) {
        unavailableItems.push(menuRow.name);
      }
    }
  }

  const computedSubtotal = items.reduce((sum, line) => sum + line.price * line.qty, 0);
  const reportedItemsTotal = (order.items || []).reduce(
    (sum, line) => sum + (Number(line.price) || 0) * (Number(line.qty) || 1),
    0
  );
  const expectedSubtotal = Number(order.subtotal) > 0 ? Number(order.subtotal) : reportedItemsTotal;
  const priceMismatch = Math.abs(computedSubtotal - expectedSubtotal) > 0.01;
  const stockError = await verifyStock(items);
  const couponDisc = Math.max(0, Number(order.discountAmount) || 0);
  const loyaltyDisc = Math.max(0, Number(order.loyaltyDiscount ?? order.loyaltyRedeemPoints) || 0);
  const computedNetTotal = Math.max(0, computedSubtotal - couponDisc - loyaltyDisc);
  const effectiveTotal = Number(order.total) > 0 ? Math.min(computedNetTotal, Number(order.total)) : computedNetTotal;
  const belowDeliveryMinimum =
    order.orderType === 'DELIVERY' && effectiveTotal < MIN_DELIVERY_ORDER;

  return {
    items,
    computedSubtotal,
    priceMismatch,
    unavailableItems,
    stockError,
    belowDeliveryMinimum,
  };
}
