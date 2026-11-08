import { db } from './db';
import type { Customer } from './db/types';

export const LOYALTY_EARN_RATE = 100; // Rs spent per point earned

/** The POS only accepts 5–15 digit phone numbers as customer ids. */
export function normalizePhone(phone: string | undefined): string {
  const str = String(phone || '').trim();
  return /^\d{5,15}$/.test(str) ? str : '';
}

export function getCustomer(phone: string | undefined): Promise<Customer | undefined> {
  const id = normalizePhone(phone);
  return id ? db.customers.get(id) : Promise.resolve(undefined);
}

/** Port of upsertCustomerRecord — earns points on the paid total, minus what was redeemed. */
export async function upsertCustomer(
  customer: { phone?: string; name?: string } | undefined,
  saleTotal: number,
  redeemedPoints = 0,
): Promise<void> {
  const phone = normalizePhone(customer?.phone);
  if (!phone) return;

  const existing = await db.customers.get(phone);
  const earned = Math.floor((Number(saleTotal) || 0) / LOYALTY_EARN_RATE);
  const now = new Date().toISOString();

  await db.customers.put({
    id: phone,
    phone,
    name: customer?.name || existing?.name || '',
    totalOrders: (existing?.totalOrders || 0) + 1,
    totalSpent: (existing?.totalSpent || 0) + (Number(saleTotal) || 0),
    loyaltyPoints: Math.max(0, (existing?.loyaltyPoints || 0) - (Number(redeemedPoints) || 0) + earned),
    lastVisit: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
}
