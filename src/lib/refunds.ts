import { db } from './db';
import { logAudit } from './audit';
import { roundAmount } from './format';
import type { CartItem, Sale } from './db/types';

export interface RefundLine {
  index: number;
  qty: number;
}

export interface RefundPreview {
  /** Effective quantity of a line that is still refundable, after earlier refunds. */
  remaining: number[];
  /** Per-unit amount actually paid, after any order-level discount. */
  units: number[];
  amount: number;
  fullyRefunded: boolean;
}

export function remainingQty(line: CartItem): number {
  return Math.max(0, (Number(line.qty) || 0) - (Number(line.refundedQty) || 0));
}

/**
 * Share of each line's menu price the customer actually paid. An order-level
 * discount makes the bill smaller than the sum of the lines, so refunding line
 * prices outright would hand back more than was collected.
 */
function paidRatio(sale: Sale): number {
  const gross = (sale.items || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0), 0);
  const total = Number(sale.total) || 0;
  // Extra charges (delivery, tax) push the bill above the lines and are not refunded per item.
  return gross > 0 && total > 0 && total < gross ? total / gross : 1;
}

export function refundableTotal(sale: Sale): number {
  const everything = (sale.items || []).map((line, index) => ({ index, qty: remainingQty(line) }));
  return computeRefund(sale, everything).amount;
}

/**
 * Prices a refund from the sale's own line prices, so a later menu price change
 * cannot alter what a past order refunds for. Quantities are clamped to what
 * is actually left on each line.
 */
export function computeRefund(sale: Sale, lines: RefundLine[]): RefundPreview {
  const items = sale.items || [];
  const remaining = items.map(remainingQty);
  const ratio = paidRatio(sale);
  let amount = 0;
  const taken = new Map<number, number>();

  for (const line of lines) {
    const index = Number(line.index);
    const available = remaining[index];
    if (available === undefined) continue;
    const qty = Math.min(Math.max(0, Number(line.qty) || 0), available, available - (taken.get(index) ?? 0));
    if (qty <= 0) continue;
    taken.set(index, (taken.get(index) ?? 0) + qty);
    amount += qty * (Number(items[index].price) || 0) * ratio;
  }

  const after = remaining.map((qty, index) => qty - (taken.get(index) ?? 0));
  return {
    remaining: after,
    units: items.map((line) => roundAmount((Number(line.price) || 0) * ratio)),
    amount: roundAmount(amount),
    fullyRefunded: after.every((qty) => qty <= 0),
  };
}

/**
 * Records a refund against a sale and puts the ingredients back in stock.
 *
 * `qty` is deliberately left untouched — `refundedQty` is added alongside it so
 * the original bill, the shift report and historical receipts keep reading the
 * same numbers they did before the refund.
 */
export async function recordRefund(
  saleId: number,
  lines: RefundLine[],
  reason: string,
  user: string,
): Promise<{ amount: number; status: 'FULL' | 'PARTIAL' }> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('A refund needs a reason.');

  const preview = await db.transaction('rw', db.sales, db.inventory, db.recipes, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new Error('Sale record not found.');

    const result = computeRefund(sale, lines);
    if (result.amount <= 0) throw new Error('Select at least one item quantity to refund.');

    const items = (sale.items || []).map((line, index) => {
      const taken = remainingQty(line) - result.remaining[index];
      return taken > 0 ? { ...line, refundedQty: (Number(line.refundedQty) || 0) + taken } : line;
    });

    const refundedItems = (sale.items || [])
      .map((line, index) => ({ ...line, refundedQty: undefined, qty: remainingQty(line) - result.remaining[index] }))
      .filter((line) => line.qty > 0);

    const status: 'FULL' | 'PARTIAL' = result.fullyRefunded ? 'FULL' : 'PARTIAL';
    await db.sales.update(saleId, {
      items,
      refundedAmount: Number(sale.refundedAmount || 0) + result.amount,
      refundStatus: status,
      refunds: [
        ...(sale.refunds || []),
        { timestamp: new Date().toISOString(), by: user, reason: trimmedReason, amount: result.amount, items: refundedItems },
      ],
    });

    for (const line of refundedItems) {
      for (const recipe of await db.recipes.where('menuItemId').equals(line.menuItemId || line.id).toArray()) {
        const ingredient = await db.inventory.get(recipe.inventoryId);
        if (!ingredient) continue;
        await db.inventory.update(recipe.inventoryId, {
          stock: (Number(ingredient.stock) || 0) + recipe.qtyRequired * line.qty,
        });
      }
    }

    return { ...result, status };
  });

  await logAudit(
    'REFUND',
    `Refunded ${preview.amount} from Order #${saleId} (${preview.status}): ${trimmedReason}`,
    user,
    saleId,
  );
  return { amount: preview.amount, status: preview.status };
}
