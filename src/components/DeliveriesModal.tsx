import { useState } from 'react';
import { Phone, MapPin } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';
import type { Delivery, DeliveryStatus } from '../lib/db/types';

const COLUMNS: Array<{ status: DeliveryStatus; label: string }> = [
  { status: 'PENDING', label: 'Pending' },
  { status: 'ACTIVE', label: 'Active' },
  { status: 'COMPLETED', label: 'Completed' },
];

export function DeliveriesModal({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const deliveries = useLive(() => db.deliveries.toArray(), []) ?? [];
  const [rider, setRider] = useState<Record<number, string>>({});
  const [etas, setEtas] = useState<Record<number, string>>({});

  async function start(delivery: Delivery) {
    const id = delivery.id!;
    await db.transaction('rw', db.deliveries, db.sales, async () => {
      await db.deliveries.update(id, {
        status: 'ACTIVE',
        assignedTo: rider[id]?.trim() || undefined,
        eta: etas[id]?.trim() || null,
      });
      if (delivery.saleId) await db.sales.update(delivery.saleId, { deliveryStatus: 'ACTIVE' });
    });
    notify(`Delivery #${id} started.`);
  }

  async function complete(delivery: Delivery) {
    await db.transaction('rw', db.deliveries, db.sales, async () => {
      await db.deliveries.update(delivery.id!, { status: 'COMPLETED', completedAt: new Date().toISOString() });
      if (delivery.saleId) await db.sales.update(delivery.saleId, { deliveryStatus: 'DELIVERED' });
    });
    notify(`Delivery #${delivery.id} completed.`);
  }

  async function cancel(delivery: Delivery) {
    await db.transaction('rw', db.deliveries, db.sales, async () => {
      if (delivery.saleId) await db.sales.update(delivery.saleId, { deliveryStatus: 'CANCELLED' });
      await db.deliveries.delete(delivery.id!);
    });
    notify(`Delivery #${delivery.id} cancelled.`);
  }

  return (
    <Modal title="Delivery Management" onClose={onClose} wide>
      <div className="space-y-6">
        {COLUMNS.map(({ status, label }) => {
          const rows = deliveries.filter((d) => d.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return (
            <section key={status}>
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-600 mb-2">
                {label} <span className="font-normal text-gray-400">({rows.length})</span>
              </h3>
              {rows.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-4">No {label.toLowerCase()} deliveries.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((d) => (
                    <article key={d.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-gray-800">
                            {d.customerName || 'Customer'}
                            {d.saleId && (
                              <span className="ml-2 text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">
                                #{d.saleId}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-gray-500 flex items-center gap-1">
                            <Phone className="w-3 h-3" aria-hidden /> {d.customerPhone || '—'}
                          </p>
                          <p className="text-[11px] text-gray-600 flex items-start gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
                            <span className="line-clamp-2">{d.customerAddress || '—'}</span>
                          </p>
                          {d.assignedTo && <p className="text-[11px] text-gray-500">Rider: {d.assignedTo}</p>}
                          {d.eta && <p className="text-[11px] text-gray-500">ETA: {d.eta}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-indigo-700">
                            {new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="text-[10px] text-gray-500">{formatAmount(d.deliveryCharge)}</p>
                        </div>
                      </div>

                      {status === 'PENDING' && (
                        <div className="space-y-2 pt-1 border-t border-gray-100">
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={rider[d.id!] ?? ''}
                              onChange={(e) => setRider((r) => ({ ...r, [d.id!]: e.target.value }))}
                              placeholder="Rider name"
                              aria-label="Rider name"
                              className="p-2 text-xs ring-1 ring-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <input
                              value={etas[d.id!] ?? ''}
                              onChange={(e) => setEtas((r) => ({ ...r, [d.id!]: e.target.value }))}
                              placeholder="ETA (e.g. 20 mins)"
                              aria-label="ETA"
                              className="p-2 text-xs ring-1 ring-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => start(d)} className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-700">
                              Assign & Start
                            </button>
                            <button type="button" onClick={() => cancel(d)} className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1.5 rounded-lg hover:bg-red-200">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {status === 'ACTIVE' && (
                        <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
                          <button
                            type="button"
                            onClick={() => complete(d)}
                            className="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-700"
                          >
                            Mark delivered
                          </button>
                        </div>
                      )}

                      {status === 'COMPLETED' && (
                        <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
                          <button
                            type="button"
                            onClick={() => db.deliveries.delete(d.id!)}
                            className="bg-red-50 text-red-600 text-xs font-bold px-2 py-1.5 rounded-lg hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
