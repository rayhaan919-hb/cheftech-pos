import { db } from './db';
import { logAudit } from './audit';
import { pushCategory, pushMenu } from './sync';
import type { Category, MenuItem, Recipe } from './db/types';

export function newCategoryId(): string {
  return `CAT_${Date.now()}`;
}

export function newMenuItemId(): string {
  return `MENU_${Date.now()}`;
}

export async function saveCategory(name: string, user: string): Promise<Category> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a category name.');
  const category = { id: newCategoryId(), name: trimmed };
  await db.categories.put(category);
  pushCategory(category.id);
  await logAudit('CATEGORY_ADDED', `Category "${trimmed}" added`, user);
  return category;
}

/** Items fall back to "Uncategorized" rather than being deleted with their category. */
export async function deleteCategory(id: string, user: string): Promise<number> {
  const category = await db.categories.get(id);
  if (!category) return 0;
  const affected = await db.menu.where('categoryId').equals(id).count();
  await db.categories.delete(id);
  pushCategory(id);
  await logAudit('CATEGORY_DELETED', `Category "${category.name}" deleted (${affected} items moved to Uncategorized)`, user);
  return affected;
}

export async function usedInSales(menuItemId: string): Promise<number> {
  const sales = await db.sales.toArray();
  return sales.filter((sale) => (sale.items || []).some((line) => line.menuItemId === menuItemId)).length;
}

export interface MenuItemDraft {
  name: string;
  price: string | number;
  categoryId: string;
  imageUrl?: string;
  description?: string;
  available?: boolean;
}

export interface RecipeDraft {
  inventoryId: string;
  qtyRequired: string | number;
}

/** Writes the item and replaces its recipe rows in one transaction. */
export async function saveMenuItem(
  draft: MenuItemDraft,
  recipeRows: RecipeDraft[],
  user: string,
  existingId?: string,
): Promise<string> {
  const name = draft.name.trim();
  const price = parseFloat(String(draft.price));
  if (!name) throw new Error('Enter a dish name.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be a positive number.');
  if (!draft.categoryId) throw new Error('Choose a category.');

  const id = existingId || newMenuItemId();
  const cleanRecipes = recipeRows
    .map((row) => ({ inventoryId: row.inventoryId, qtyRequired: parseFloat(String(row.qtyRequired)) }))
    .filter((row) => row.inventoryId && Number.isFinite(row.qtyRequired) && row.qtyRequired > 0);

  await db.transaction('rw', db.menu, db.recipes, async () => {
    const existing = existingId ? await db.menu.get(existingId) : undefined;
    const merged: MenuItem = {
      ...(existing ?? {}),
      id,
      name,
      price,
      categoryId: draft.categoryId,
      imageUrl: draft.imageUrl || existing?.imageUrl || '',
      modifierGroups: existing?.modifierGroups,
    };
    if (draft.description !== undefined) merged.description = draft.description.trim();
    merged.available = draft.available ?? existing?.available ?? true;

    await db.menu.put(merged);
    await db.recipes.where('menuItemId').equals(id).delete();
    if (cleanRecipes.length) {
      await db.recipes.bulkAdd(cleanRecipes.map((row) => ({ ...row, menuItemId: id })) as Recipe[]);
    }
  });

  pushMenu(id);
  await logAudit(
    existingId ? 'MENU_ITEM_UPDATED' : 'MENU_ITEM_ADDED',
    `${existingId ? 'Updated' : 'Added'} "${name}" at ${price} with ${cleanRecipes.length} recipe line(s)`,
    user,
  );
  return id;
}

export async function deleteMenuItem(id: string, user: string, force = false): Promise<void> {
  const item = await db.menu.get(id);
  if (!item) return;
  if (!force) {
    const sales = await usedInSales(id);
    if (sales > 0) throw new Error(`${item.name} appears in ${sales} sale(s). Deleting it keeps those sales but breaks reporting by item.`);
  }
  await db.transaction('rw', db.menu, db.recipes, async () => {
    await db.recipes.where('menuItemId').equals(id).delete();
    await db.menu.delete(id);
  });
  pushMenu(id);
  await logAudit('MENU_ITEM_DELETED', `Deleted "${item.name}" and its recipe`, user);
}

/** M-07: Toggles item availability (in-stock / sold-out) and syncs to Supabase. */
export async function toggleMenuItemAvailability(
  id: string,
  available: boolean,
  user: string
): Promise<void> {
  const item = await db.menu.get(id);
  if (!item) return;
  await db.menu.update(id, { available, updatedAt: new Date().toISOString() });
  pushMenu(id);
  await logAudit(
    'MENU_ITEM_UPDATED',
    `Marked "${item.name}" as ${available ? 'Available' : 'Sold Out'}`,
    user
  );
}
