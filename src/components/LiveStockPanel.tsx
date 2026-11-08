import { useState } from 'react';
import { AlertTriangle, Boxes, Lock, Plus, Minus } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { adjustStock, getLowStockThreshold } from '../lib/inventory';
import { normalizeCharge, currencySymbol } from '../lib/format';
import { OwnerPinModal } from './OwnerPinModal';
import type { InventoryItem } from '../lib/db/types';

/**
 * Mirrors the old "Live Stock" card: hidden behind the owner PIN until unlocked.
 * ponytail: unlock lives in component state, so a page reload re-locks — that is
 * safer than persisting it, and matches "authenticate to view".
 */
export function LiveStockPanel({ canManage, username, onManage }: {
  canManage: boolean;
  username: string;
  onManage: () => void;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const items = useLive(() => db.inventory.toArray(), []);
  const threshold = useLive(() => getLowStockThreshold(), []) ?? 5;

  const lowStock = (items ?? []).filter((i) => Number(i.stock) <= threshold);

  async function bump(item: InventoryItem, delta: number) {
    await adjustStock(item, delta, username);
  }

  return (
    <>
      <section className="bg-white p-4 rounded-2xl border border-[#e0edff]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-display text-sm font-medium text-[#273238] flex items-center gap-1.5">
            <Boxes className="w-4 h-4 text-[#2941e0]" aria-hidden /> Live Stock
          </h3>
          <div className="flex items-center gap-1.5">
            {unlocked && (
              <button
                type="button"
                onClick={() => setUnlocked(false)}
                className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-[8px] font-medium border border-red-200 hover:bg-red-100"
              >
                Lock
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={onManage}
                className="text-xs text-[#2941e0] bg-[#eff6ff] hover:bg-[#e0edff] px-3 py-1 rounded-[8px] font-medium"
              >
                Manage
              </button>
            )}
          </div>
        </div>

        {!unlocked ? (
          <div className="text-center py-6 border border-[#e0edff] rounded-2xl bg-[#eff6ff]/40 space-y-2">
            <Lock className="w-6 h-6 mx-auto text-[#526066]" aria-hidden />
            <p className="text-xs font-medium text-[#526066]">Stock Protected</p>
            <button
              type="button"
              onClick={() => setPrompting(true)}
              className="bg-[#2941e0] text-white px-4 h-9 rounded-[8px] text-xs font-medium hover:bg-[#1f35c4] transition"
            >
              Authenticate to View
            </button>
          </div>
        ) : (
          <div className="space-y-1.5 text-xs max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {!items?.length ? (
              <p className="text-gray-400 text-center py-2">No raw inventory found.</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="p-2 bg-gray-50 rounded border border-gray-200">
                  <div className="flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 truncate">{item.name}</p>
                      <p className="text-[11px] text-gray-500">
                        Cost/unit: {currencySymbol()} {normalizeCharge(item.cost || 0).toFixed(2)} • Unit: {item.unit}
                      </p>
                    </div>
                    <span className={`font-extrabold text-xs shrink-0 ${Number(item.stock) <= threshold ? 'text-red-600' : 'text-emerald-700'}`}>
                      {Number(item.stock).toFixed(2)} {item.unit}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <button
                      type="button"
                      onClick={() => bump(item, 1)}
                      className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-3 min-h-11 rounded hover:bg-emerald-200 flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" aria-hidden />1
                    </button>
                    <button
                      type="button"
                      onClick={() => bump(item, -1)}
                      className="bg-red-100 text-red-800 text-[10px] font-bold px-3 min-h-11 rounded hover:bg-red-200 flex items-center gap-0.5"
                    >
                      <Minus className="w-3 h-3" aria-hidden />1
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {unlocked && lowStock.length > 0 && (
          <p className="mt-2 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
            {lowStock.length} item{lowStock.length === 1 ? '' : 's'} low on stock: {lowStock.slice(0, 3).map((i) => i.name).join(', ')}
            {lowStock.length > 3 ? ` +${lowStock.length - 3} more` : ''}
          </p>
        )}
      </section>

      {prompting && (
        <OwnerPinModal
          action="Enter the owner PIN to view live stock levels."
          onClose={() => setPrompting(false)}
          onAuthorized={() => {
            setPrompting(false);
            setUnlocked(true);
          }}
        />
      )}
    </>
  );
}
