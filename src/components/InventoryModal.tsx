import { useMemo, useState } from 'react';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { getLowStockThreshold, newInventoryId, normalizeQuantity, setLowStockThreshold } from '../lib/inventory';
import { pushInventory } from '../lib/sync';
import { formatAmount } from '../lib/format';
import { downloadCsv, datedFilename } from '../lib/export';
import { Modal } from './Modal';
import type { InventoryItem } from '../lib/db/types';

const BLANK = { name: '', stock: '', unit: '', cost: '' };

export function InventoryModal({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const items = useLive(() => db.inventory.toArray(), []) ?? [];
  const savedThreshold = useLive(() => getLowStockThreshold(), []) ?? 5;
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(BLANK);
  const [editing, setEditing] = useState<Record<string, Partial<InventoryItem>>>({});
  const [threshold, setThreshold] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((i) => !query || i.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, search]);

  async function add() {
    const stock = normalizeQuantity(draft.stock);
    const cost = draft.cost.trim() ? normalizeQuantity(draft.cost) : 0;
    if (!draft.name.trim() || stock === null) {
      notify('Enter an ingredient name and a valid stock quantity.');
      return;
    }
    if (cost === null) {
      notify('Cost must be a non-negative number.');
      return;
    }
    const id = newInventoryId();
    await db.inventory.put({
      id,
      name: draft.name.trim(),
      stock,
      unit: draft.unit.trim() || 'pcs',
      cost,
    });
    pushInventory(id);
    setDraft(BLANK);
    notify('Ingredient added.');
  }

  async function save(item: InventoryItem) {
    const patch = editing[item.id] || {};
    const name = (patch.name ?? item.name).trim();
    const stock = normalizeQuantity(patch.stock ?? item.stock);
    const cost = normalizeQuantity(patch.cost ?? item.cost) ?? 0;
    if (!name || stock === null) {
      notify('Ingredient name and stock quantity cannot be empty.');
      return;
    }
    await db.inventory.update(item.id, { name, stock, unit: (patch.unit ?? item.unit).trim() || 'pcs', cost });
    pushInventory(item.id);
    setEditing((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    notify(`${name} saved.`);
  }

  async function remove(item: InventoryItem) {
    const used = await db.recipes.where('inventoryId').equals(item.id).count();
    if (used > 0 && !window.confirm(`${used} recipe(s) reference this item. Delete anyway? (Recipes are kept but orphaned.)`)) return;
    await db.inventory.delete(item.id);
    pushInventory(item.id);
    notify(`${item.name} deleted.`);
  }

  async function commitThreshold() {
    const value = normalizeQuantity(threshold ?? '');
    if (value === null) {
      notify('Enter a valid non-negative threshold.');
      return;
    }
    await setLowStockThreshold(value);
    setThreshold(null);
    notify('Low stock threshold updated.');
  }

  function exportCsv() {
    downloadCsv(
      datedFilename('Inventory_Export'),
      ['ID', 'Name', 'Stock', 'Unit', 'Cost Per Unit'],
      items.map((item) => [
        item.id,
        item.name,
        Number(item.stock || 0).toFixed(2),
        item.unit || '',
        Number(item.cost || 0).toFixed(2),
      ]),
    );
    notify(`${items.length} ingredients exported.`);
  }

  return (
    <Modal title="Raw Ingredients & Inventory" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm space-y-2">
          <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">Add New Ingredient</h4>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {(['name', 'stock', 'unit', 'cost'] as const).map((field) => (
              <input
                key={field}
                type={field === 'stock' || field === 'cost' ? 'number' : 'text'}
                min={field === 'stock' || field === 'cost' ? 0 : undefined}
                step={field === 'stock' || field === 'cost' ? '0.01' : undefined}
                value={draft[field]}
                onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder={field === 'name' ? 'Item Name' : field === 'stock' ? 'Stock' : field === 'unit' ? 'Unit' : 'Cost'}
                aria-label={`New ingredient ${field}`}
                className="p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner min-w-0"
              />
            ))}
            <button
              type="button"
              onClick={add}
              className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> Add
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients..."
              aria-label="Search ingredients"
              className="w-full pl-10 pr-4 py-2.5 text-sm ring-1 ring-gray-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600">
            Low-stock at
            <input
              type="number"
              min={0}
              step="1"
              value={threshold ?? String(savedThreshold)}
              onChange={(e) => setThreshold(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitThreshold()}
              onBlur={() => threshold !== null && commitThreshold()}
              aria-label="Low stock threshold"
              className="w-16 p-1.5 text-xs ring-1 ring-gray-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
          <button
            type="button"
            onClick={exportCsv}
            className="px-3 py-2 text-xs font-bold rounded-xl bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
            title="Download all ingredients as a spreadsheet"
          >
            <Download className="w-3.5 h-3.5" aria-hidden /> CSV
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-6">
            {search.trim() ? `No ingredients match "${search.trim()}".` : 'No raw inventory found.'}
          </p>
        ) : (
          <div className="space-y-2 max-h-[48vh] overflow-y-auto custom-scrollbar pr-1">
            {filtered.map((item) => {
              const patch = editing[item.id] || {};
              const low = Number(item.stock) <= savedThreshold;
              const field = (key: keyof InventoryItem, type = 'text', step?: string) => (
                <input
                  type={type}
                  step={step}
                  min={type === 'number' ? 0 : undefined}
                  value={String(patch[key] ?? item[key] ?? '')}
                  onChange={(e) => setEditing((current) => ({ ...current, [item.id]: { ...current[item.id], [key]: e.target.value } }))}
                  onKeyDown={(e) => e.key === 'Enter' && save(item)}
                  aria-label={`${item.name} ${key}`}
                  className="p-1.5 text-xs ring-1 ring-gray-200 rounded-lg bg-white w-full min-w-0 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              );
              return (
                <div key={item.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {field('name')}
                    {field('stock', 'number', '0.01')}
                    {field('unit')}
                    {field('cost', 'number', '0.01')}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-bold ${low ? 'text-red-600' : 'text-gray-400'}`}>
                      {low ? 'LOW' : formatAmount((Number(item.stock) || 0) * (Number(item.cost) || 0))}
                    </span>
                    <button
                      type="button"
                      onClick={() => save(item)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      aria-label={`Delete ${item.name}`}
                      className="bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1.5 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
