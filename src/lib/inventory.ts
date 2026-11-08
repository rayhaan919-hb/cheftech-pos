import { db } from './db';
import { logAudit } from './audit';
import { pushInventory } from './sync';
import type { InventoryItem } from './db/types';

const THRESHOLD_KEY = 'lowStockThreshold';
const DEFAULT_THRESHOLD = 5;

export async function getLowStockThreshold(): Promise<number> {
  const stored = await db.settings.get(THRESHOLD_KEY);
  const value = stored ? Number(stored.value) : DEFAULT_THRESHOLD;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_THRESHOLD;
}

export async function setLowStockThreshold(value: number): Promise<void> {
  await db.settings.put({ key: THRESHOLD_KEY, value: String(value) });
}

export function newInventoryId(): string {
  return `INV_${Date.now()}`;
}

/** Clamps free-typed stock/cost, which come straight from number inputs. */
export function normalizeQuantity(value: string | number): number | null {
  const amount = parseFloat(String(value));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export async function adjustStock(item: InventoryItem, delta: number, user: string): Promise<void> {
  const updated = Math.max(0, (Number(item.stock) || 0) + delta);
  await db.inventory.update(item.id, { stock: updated });
  pushInventory(item.id);
  await logAudit('STOCK_ADJUST', `${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} units of "${item.name}" (now ${updated})`, user);
}
