import { useState } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { readHeldOrder } from '../lib/held';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';
import type { CartCharges } from '../lib/cart';
import type { CartItem, CustomerInfo } from '../lib/db/types';

export function HeldOrdersModal({ onClose, onRestore }: {
  onClose: () => void;
  onRestore: (order: { items: CartItem[]; charges: CartCharges; customer?: CustomerInfo }) => void;
}) {
  const orders = useLive(() => db.heldOrders.orderBy('id').reverse().toArray(), []) ?? [];
  const [confirming, setConfirming] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);

  async function restore(id: number) {
    const order = await readHeldOrder(id);
    if (!order) return;
    await db.heldOrders.delete(id);
    onRestore(order);
  }

  return (
    <Modal title="Held Orders" onClose={onClose} wide>
      {orders.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-6">No held orders.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-bold text-xs text-gray-800">
                    Held Order #{order.id}
                    <span className="ml-1 text-[10px] text-orange-700 font-bold bg-orange-100 px-1.5 py-0.5 rounded">
                      {order.orderType}
                    </span>
                    {order.tableNumber && (
                      <span className="ml-1 text-[10px] text-indigo-700 font-bold bg-indigo-100 px-1.5 py-0.5 rounded">
                        Table {order.tableNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    By: {order.serverUser} • {new Date(order.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div className="font-bold text-amber-800 text-xs shrink-0">{formatAmount(order.total)}</div>
              </div>

              <div className="text-xs text-gray-600 bg-white p-2 rounded border border-amber-100">
                {order.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                {replacing === order.id ? (
                  <>
                    <span className="text-[10px] text-gray-600 font-bold mr-auto">Replace items in the cart?</span>
                    <button
                      type="button"
                      onClick={() => restore(order.id!)}
                      className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition"
                    >
                      Yes, restore
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplacing(null)}
                      className="text-xs bg-gray-100 text-gray-700 font-bold px-3 py-1.5 rounded-lg"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplacing(order.id!)}
                    className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition"
                  >
                    Restore to Cart
                  </button>
                )}
                {confirming === order.id ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await db.heldOrders.delete(order.id!);
                      setConfirming(null);
                    }}
                    className="text-xs bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg"
                  >
                    Confirm discard
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(order.id!)}
                    className="text-xs bg-red-100 text-red-600 hover:bg-red-200 font-bold px-3 py-1.5 rounded-lg transition"
                  >
                    Discard
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
