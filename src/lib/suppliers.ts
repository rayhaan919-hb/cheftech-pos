import { db } from './db';
import type { Expense, StockIn, Supplier, SupplierPayment } from './db/types';

export function newSupplierId(): string {
  return `SUP_${Date.now()}`;
}

/** Only approved expenses count toward what is owed (legacy rows have no status). */
export function isApproved(expense: Expense): boolean {
  return expense.status === 'APPROVED' || !expense.status;
}

export interface SupplierBalance {
  totalSpent: number;
  totalPaid: number;
  balance: number;
}

/** What is owed = approved expenses + stock received − payments made. */
export function supplierBalance(
  supplierId: string,
  expenses: Expense[],
  payments: SupplierPayment[],
  stockIn: StockIn[] = [],
): SupplierBalance {
  const fromExpenses = expenses
    .filter((e) => e.supplierId === supplierId && isApproved(e))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const fromStock = stockIn
    .filter((s) => s.supplierId === supplierId)
    .reduce((sum, s) => sum + (Number(s.totalCost) || 0), 0);
  const totalSpent = fromExpenses + fromStock;
  const totalPaid = payments
    .filter((p) => p.supplierId === supplierId)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return { totalSpent, totalPaid, balance: totalSpent - totalPaid };
}

/** Stock-in raises the inventory level and re-bases its unit cost. */
export async function recordStockIn(
  supplier: Supplier,
  ingredientId: string,
  qty: number,
  unitPrice: number,
): Promise<void> {
  await db.transaction('rw', db.inventory, db.stockIn, async () => {
    // Must stay inside the rw scope — a read issued outside it runs in its own
    // implicit scope and the write below then fails with NotFoundError.
    const item = await db.inventory.get(ingredientId);
    if (!item) throw new Error('Ingredient not found.');

    await db.inventory.update(ingredientId, {
      stock: (Number(item.stock) || 0) + qty,
      cost: unitPrice,
    });
    await db.stockIn.add({
      supplierId: supplier.id,
      ingredient: item.name,
      created: new Date().toISOString(),
      qty,
      unitPrice,
      totalCost: qty * unitPrice,
    });
  });
}

export async function recordSupplierPayment(supplierId: string, amount: number, method: string): Promise<void> {
  await db.supplierPayments.add({ supplierId, amount, method, date: new Date().toISOString() });
}
