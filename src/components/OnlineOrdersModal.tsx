import { useMemo, useState } from 'react';
import { Check, Inbox, Plus, RefreshCw, X } from 'lucide-react';
import { db } from '../lib/db';
import { syncNow } from '../lib/sync';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import {
  STATUS_LABEL,
  isActive,
  nextStatus,
  rejectOrder,
  setOrderStatus,
  verifyOnlineOrder,
} from '../lib/onlineOrders';
import { MIN_DELIVERY_ORDER } from '../lib/sales';
import { Modal } from './Modal';
import type { CartItem, OnlineOrder, OnlineOrderStatus, OrderType } from '../lib/db/types';

const STATUS_TONE: Record<OnlineOrderStatus, string> = {
  PENDING: 'bg-blue-100 text-blue-800 border-blue-200',
  ACCEPTED: 'bg-amber-100 text-amber-800 border-amber-200',
  PREPARING: 'bg-amber-100 text-amber-800 border-amber-200',
  OUT_FOR_DELIVERY: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-red-100 text-red-700 border-red-200',
};

export function OnlineOrdersModal({ username, notify, onClose, onAccept }: {
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
  onAccept: (items: CartItem[], order: OnlineOrder) => void;
}) {
  const orders = useLive(() => db.onlineOrders.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [showHistory, setShowHistory] = useState(false);
  const [adding, setAdding] = useState(false);

  const { pending, inProgress, closed } = useMemo(() => ({
    pending: orders.filter((o) => o.status === 'PENDING'),
    inProgress: orders.filter((o) => isActive(o) && o.status !== 'PENDING'),
    closed: orders.filter((o) => !isActive(o)),
  }), [orders]);

  async function accept(order: OnlineOrder) {
    if (!order.id) return;

    // S-04, M-02, M-07: Verify authoritative POS menu prices, item availability, stock, and delivery minimum
    const check = await verifyOnlineOrder(order);

    if (check.unavailableItems.length > 0) {
      notify(`Unavailable item(s) in order: ${check.unavailableItems.join(', ')}. Reject or adjust before checkout.`);
      return;
    }

    if (check.stockError) {
      notify(check.stockError);
      return;
    }

    if (check.belowDeliveryMinimum) {
      notify(`Delivery order is below the ${formatAmount(MIN_DELIVERY_ORDER)} minimum after discounts.`);
      return;
    }

    if (check.priceMismatch) {
      await db.onlineOrders.update(order.id, { total: check.computedSubtotal });
      notify(`Order #${order.id} prices re-verified from POS menu (${formatAmount(check.computedSubtotal)}).`);
    } else {
      notify(`Order #${order.id} loaded into the cart.`);
    }

    onAccept(check.items, { ...order, total: check.priceMismatch ? check.computedSubtotal : order.total });
    await setOrderStatus(order.id, 'ACCEPTED', username);
    onClose();
  }

  async function advance(order: OnlineOrder) {
    if (!order.id) return;
    const next = nextStatus(order);
    if (!next) return;
    await setOrderStatus(order.id, next, username);
    notify(`Order #${order.id}: ${STATUS_LABEL[next]}.`);
  }

  async function reject(order: OnlineOrder) {
    if (!order.id) return;
    const reason = window.prompt(`Reject order #${order.id}? Reason (optional):`, '');
    if (reason === null) return;
    await rejectOrder(order.id, reason, username);
    notify(`Order #${order.id} rejected.`);
  }

  return (
    <Modal
      title="Online Orders"
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-2 rounded-xl hover:bg-indigo-100"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> {adding ? 'Hide form' : 'Record website order'}
            </button>
            <button
              type="button"
              onClick={async () => {
                const changed = await syncNow();
                notify(changed ? 'Online order inbox refreshed.' : 'Everything is already up to date.');
              }}
              className="flex items-center gap-1 text-[11px] font-bold text-gray-600 bg-gray-100 px-3 py-2 rounded-xl hover:bg-gray-200"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Sync now
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[11px] font-bold text-gray-600 bg-gray-100 px-3 py-2 rounded-xl hover:bg-gray-200"
          >
            {showHistory ? 'Hide' : 'Show'} history ({closed.length})
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {adding && (
          <NewOrderForm
            onCreate={async (order) => {
              const id = await db.onlineOrders.add(order);
              notify(`Website order #${id} recorded.`);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {pending.length === 0 && inProgress.length === 0 ? (
          <div className="text-center py-8">
            <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-2" aria-hidden />
            <p className="text-gray-400 text-xs">No active online orders.</p>
            <p className="text-[10px] text-gray-400 mt-1 max-w-sm mx-auto">
              Website orders arrive here automatically. Use “Record website order” for one that came
              in by phone.
            </p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <SectionTitle className="text-blue-700">New orders ({pending.length})</SectionTitle>
                {pending.map((order) => (
                  <OrderCard key={order.id} order={order} onAccept={accept} onReject={reject} />
                ))}
              </section>
            )}
            {inProgress.length > 0 && (
              <section className="space-y-2">
                <SectionTitle className="text-amber-700">In progress ({inProgress.length})</SectionTitle>
                {inProgress.map((order) => (
                  <OrderCard key={order.id} order={order} onAdvance={advance} />
                ))}
              </section>
            )}
          </>
        )}

        {showHistory && (
          <section className="space-y-2 pt-2 border-t border-gray-100">
            <SectionTitle>History ({closed.length})</SectionTitle>
            {closed.length === 0 ? (
              <p className="text-[11px] text-gray-400">Nothing completed or rejected yet.</p>
            ) : (
              <ul className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                {closed.map((order) => (
                  <li key={order.id} className="p-2 bg-white border border-gray-200 rounded-lg flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-gray-800 truncate">
                        #{order.id} · {order.customer?.name || 'Website customer'}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {order.items?.length || 0} item(s) · {formatAmount(order.total)}
                        {order.rejectReason ? ` · ${order.rejectReason}` : ''}
                      </p>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 ${STATUS_TONE[order.status]}`}>
                      {STATUS_LABEL[order.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

function OrderCard({ order, onAccept, onAdvance, onReject }: {
  order: OnlineOrder;
  onAccept?: (order: OnlineOrder) => void;
  onAdvance?: (order: OnlineOrder) => void;
  onReject?: (order: OnlineOrder) => void;
}) {
  const next = nextStatus(order);
  const isPending = order.status === 'PENDING';

  return (
    <article className={`p-3 rounded-xl border space-y-2 ${isPending ? 'bg-blue-50/60 border-blue-200' : 'bg-amber-50/60 border-amber-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-gray-800 flex flex-wrap items-center gap-1">
            #{order.id} {order.customer?.name || 'Website customer'}
            <span className="text-[9px] font-bold bg-white/70 border border-gray-200 px-1.5 py-0.5 rounded">
              {order.orderType.replace('_', ' ')}
            </span>
          </p>
          <p className="text-[10px] text-gray-500">
            {order.customer?.phone || 'No phone'} · {new Date(order.createdAt).toLocaleTimeString()}
          </p>
        </div>
        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 ${STATUS_TONE[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <ul className="bg-white border border-gray-200 rounded-lg p-2 space-y-0.5">
        {(order.items || []).map((line, index) => (
          <li key={`${line.id}-${index}`} className="flex justify-between gap-2 text-[11px] text-gray-700">
            <span className="truncate">{line.name}{line.note ? ` — ${line.note}` : ''}</span>
            <span className="tabular-nums shrink-0">×{line.qty}</span>
          </li>
        ))}
      </ul>

      {order.customer?.address && <p className="text-[10px] text-gray-500">{order.customer.address}</p>}
      {order.note && <p className="text-[10px] text-gray-500 italic">{order.note}</p>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs font-black text-blue-800 tabular-nums">{formatAmount(order.total)}</span>
        <div className="flex gap-1.5">
          {isPending && onAccept && (
            <button
              type="button"
              onClick={() => onAccept(order)}
              className="text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1"
            >
              <Check className="w-3 h-3" aria-hidden /> Accept to cart
            </button>
          )}
          {isPending && onReject && (
            <button
              type="button"
              onClick={() => onReject(order)}
              className="text-[11px] font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 px-2.5 py-1.5 rounded-lg"
            >
              Reject
            </button>
          )}
          {!isPending && next && onAdvance && (
            <button
              type="button"
              onClick={() => onAdvance(order)}
              className="text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg"
            >
              {next === 'PREPARING' ? 'Start preparing'
                : next === 'OUT_FOR_DELIVERY' ? 'Assign to rider'
                : 'Mark delivered'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

const INPUT = 'p-2 text-xs ring-1 ring-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-0';

function NewOrderForm({ onCreate, onCancel }: {
  onCreate: (order: OnlineOrder) => Promise<void>;
  onCancel: () => void;
}) {
  const menu = useLive(() => db.menu.toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('DELIVERY');
  const [picked, setPicked] = useState<Array<{ menuItemId: string; qty: string }>>([{ menuItemId: '', qty: '1' }]);

  const lines: CartItem[] = picked
    .map((row) => {
      const item = menu.find((m) => m.id === row.menuItemId);
      const qty = Number(row.qty) || 0;
      if (!item || qty <= 0) return null;
      return { id: item.id, menuItemId: item.id, name: item.name, price: item.price, qty };
    })
    .filter((line): line is CartItem => line !== null);

  const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);

  async function submit() {
    if (!lines.length) return;
    await onCreate({
      createdAt: new Date().toISOString(),
      customer: { name: name.trim(), phone: phone.trim(), address: address.trim() },
      orderType,
      items: lines,
      total,
      status: 'PENDING',
    });
  }

  return (
    <section className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2">
      <SectionTitle className="text-indigo-800">Record a website order</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" aria-label="Customer name" className={INPUT} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" aria-label="Customer phone" className={INPUT} />
        <select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)} aria-label="Order type" className={INPUT}>
          <option value="DELIVERY">Delivery</option>
          <option value="TAKEAWAY">Takeaway</option>
          <option value="DINE_IN">Dine in</option>
        </select>
      </div>
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address (optional)" aria-label="Delivery address" className={`${INPUT} w-full`} />

      {picked.map((row, index) => (
        <div key={index} className="flex gap-1.5">
          <select
            value={row.menuItemId}
            onChange={(e) => setPicked((rows) => rows.map((r, i) => (i === index ? { ...r, menuItemId: e.target.value } : r)))}
            aria-label={`Item ${index + 1}`}
            className={`${INPUT} flex-1`}
          >
            <option value="">Select dish...</option>
            {menu.filter((m) => m.available !== false).map((item) => (
              <option key={item.id} value={item.id}>{item.name} — {formatAmount(item.price)}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={row.qty}
            onChange={(e) => setPicked((rows) => rows.map((r, i) => (i === index ? { ...r, qty: e.target.value } : r)))}
            aria-label={`Item ${index + 1} quantity`}
            className={`${INPUT} w-16`}
          />
          <button
            type="button"
            onClick={() => setPicked((rows) => (rows.length === 1 ? [{ menuItemId: '', qty: '1' }] : rows.filter((_, i) => i !== index)))}
            aria-label={`Remove item ${index + 1}`}
            className="bg-white border border-gray-200 text-gray-500 hover:text-red-600 px-2 rounded-lg"
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => setPicked((rows) => [...rows, { menuItemId: '', qty: '1' }])}
          className="text-[10px] font-black text-indigo-700 hover:underline"
        >
          + Add line
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-indigo-900 tabular-nums">{formatAmount(total)}</span>
          <button type="button" onClick={onCancel} className="text-[11px] font-bold text-gray-600 px-2 py-1.5">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={!lines.length}
            className="text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            Record order
          </button>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ children, className = 'text-gray-700' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-black uppercase tracking-wider ${className}`}>{children}</p>;
}
