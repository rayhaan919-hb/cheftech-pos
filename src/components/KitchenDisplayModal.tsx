import { useEffect, useState } from 'react';
import { CheckCircle2, ChefHat, Clock, Flame, Printer } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { EscPosEncoder } from '../lib/escpos';
import { printRaw } from '../lib/printer';
import { Modal } from './Modal';
import type { CartItem, HeldOrder, KitchenStatus, Sale } from '../lib/db/types';

interface KitchenTicket {
  key: string;
  source: 'held' | 'sale';
  id: number;
  orderType: string;
  tableNumber?: string;
  serverUser: string;
  timestamp: string;
  status: KitchenStatus;
  items: CartItem[];
}

export function KitchenDisplayModal({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [filter, setFilter] = useState<'ACTIVE' | 'SERVED'>('ACTIVE');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const heldOrders = useLive(() => db.heldOrders.toArray(), []) ?? [];
  const recentSales = useLive(() => {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    return db.sales.where('timestamp').above(cutoff).reverse().toArray();
  }, []) ?? [];

  const tickets: KitchenTicket[] = [
    ...heldOrders
      .filter((h): h is HeldOrder & { id: number } => h.id != null)
      .map((h) => ({
        key: `held-${h.id}`,
        source: 'held' as const,
        id: h.id,
        orderType: h.orderType,
        tableNumber: h.tableNumber,
        serverUser: h.serverUser || 'Staff',
        timestamp: h.timestamp,
        status: h.kitchenStatus || 'PREPARING',
        items: h.items || [],
      })),
    ...recentSales
      .filter((s): s is Sale & { id: number } => s.id != null && !s.refundStatus)
      .map((s) => ({
        key: `sale-${s.id}`,
        source: 'sale' as const,
        id: s.id,
        orderType: s.orderType,
        tableNumber: s.tableNumber,
        serverUser: s.serverUser || 'Staff',
        timestamp: s.timestamp,
        status: s.kitchenStatus || 'PREPARING',
        items: s.items || [],
      })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const visible = tickets.filter((t) =>
    filter === 'ACTIVE' ? t.status !== 'SERVED' : t.status === 'SERVED',
  );

  async function updateStatus(ticket: KitchenTicket, status: KitchenStatus) {
    if (ticket.source === 'held') {
      await db.heldOrders.update(ticket.id, { kitchenStatus: status });
    } else {
      await db.sales.update(ticket.id, { kitchenStatus: status });
    }
    notify(`Order #${ticket.id} marked ${status.toLowerCase()}.`);
  }

  async function printKot(ticket: KitchenTicket) {
    try {
      const encoder = new EscPosEncoder();
      encoder.initialize();
      encoder.align('center');
      encoder.bold(true);
      encoder.setSize(1, 1);
      encoder.text('KITCHEN ORDER');
      encoder.setSize(0, 0);
      encoder.bold(false);
      encoder.text(`Order: #${ticket.id} (${ticket.source === 'held' ? 'HELD' : 'PAID'})`);
      encoder.text(
        `Type: ${ticket.orderType}${ticket.tableNumber ? ` · Table ${ticket.tableNumber}` : ''}`,
      );
      encoder.text(`By: ${ticket.serverUser} · ${new Date(ticket.timestamp).toLocaleTimeString()}`);
      encoder.text('--------------------------------');
      encoder.align('left');
      for (const item of ticket.items) {
        const mods = (item.modifiers || []).map((m) => m.name).join(', ');
        const name = mods ? `${item.name} (${mods})` : item.name;
        encoder.text(`${item.qty}x ${name}${item.note ? ` - ${item.note}` : ''}`);
      }
      encoder.text('--------------------------------');
      encoder.feed(4);
      encoder.cut();
      await printRaw(encoder.build());
      notify(`Kitchen ticket #${ticket.id} sent to printer.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not print KOT to thermal printer.');
    }
  }

  return (
    <Modal title="Kitchen Display System (KDS)" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 p-2.5 rounded-2xl border border-gray-200">
          <div className="flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-indigo-600" aria-hidden />
            <span className="text-xs font-bold text-gray-800">
              {tickets.filter((t) => t.status !== 'SERVED').length} active kitchen tickets
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                filter === 'ACTIVE'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              Active ({tickets.filter((t) => t.status !== 'SERVED').length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('SERVED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                filter === 'SERVED'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              Completed ({tickets.filter((t) => t.status === 'SERVED').length})
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-xs">
            No {filter === 'ACTIVE' ? 'active' : 'completed'} kitchen tickets right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar">
            {visible.map((ticket) => {
              const elapsedMin = Math.max(0, Math.floor((now - new Date(ticket.timestamp).getTime()) / 60000));
              const urgent = elapsedMin >= 15 && ticket.status !== 'SERVED';
              const ready = ticket.status === 'READY';

              return (
                <div
                  key={ticket.key}
                  className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-3 shadow-sm ${
                    ready
                      ? 'bg-emerald-50/70 border-emerald-300'
                      : urgent
                        ? 'bg-red-50/70 border-red-300'
                        : 'bg-white border-gray-200'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 border-b border-gray-200/80 pb-2 mb-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-black text-sm text-gray-900">#{ticket.id}</span>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-blue-100 text-blue-800">
                            {ticket.orderType.replace('_', ' ')}
                          </span>
                          {ticket.tableNumber && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-800">
                              Table {ticket.tableNumber}
                            </span>
                          )}
                          {ticket.source === 'held' && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">
                              Running Tab
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          Server: {ticket.serverUser} · {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${
                          urgent
                            ? 'bg-red-600 text-white'
                            : elapsedMin >= 8
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        <Clock className="w-3 h-3" aria-hidden />
                        {elapsedMin}m
                      </span>
                    </div>

                    <ul className="space-y-1.5 text-xs">
                      {ticket.items.map((item, idx) => (
                        <li key={`${item.id}-${idx}`} className="flex items-start gap-2 font-semibold text-gray-800">
                          <span className="inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded bg-gray-900 text-white text-[11px] font-black tabular-nums">
                            {item.qty}×
                          </span>
                          <div className="min-w-0">
                            <div>{item.name}</div>
                            {item.note && <div className="text-[10px] italic text-red-600">Note: {item.note}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-200/70">
                    <button
                      type="button"
                      onClick={() => printKot(ticket)}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 inline-flex items-center gap-1"
                    >
                      <Printer className="w-3.5 h-3.5" aria-hidden /> KOT
                    </button>

                    <div className="flex gap-1.5">
                      {ticket.status !== 'READY' && ticket.status !== 'SERVED' && (
                        <button
                          type="button"
                          onClick={() => updateStatus(ticket, 'READY')}
                          className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white inline-flex items-center gap-1"
                        >
                          <Flame className="w-3.5 h-3.5" aria-hidden /> Mark Ready
                        </button>
                      )}
                      {ticket.status !== 'SERVED' ? (
                        <button
                          type="button"
                          onClick={() => updateStatus(ticket, 'SERVED')}
                          className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Bump / Served
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateStatus(ticket, 'PREPARING')}
                          className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-gray-200 hover:bg-gray-300 text-gray-700"
                        >
                          Recall
                        </button>
                      )}
                    </div>
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
