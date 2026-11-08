import { useMemo, useState } from 'react';
import { Download, Pencil, Printer, RotateCcw, Search, Share2, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { logAudit } from '../lib/audit';
import { restoreInventory } from '../lib/sales';
import { deleteSale } from '../lib/sync';
import { formatAmount } from '../lib/format';
import { refundableTotal } from '../lib/refunds';
import { printReceipt, shareReceipt } from '../lib/receipt';
import { downloadCsv, datedFilename } from '../lib/export';
import { Modal } from './Modal';
import { OwnerPinModal } from './OwnerPinModal';
import { RefundModal } from './RefundModal';
import type { Sale, UserRole } from '../lib/db/types';

const VISIBLE = 20;

export function SalesHistoryModal({ role, username, onClose, onReopen, notify }: {
  role: UserRole;
  username: string;
  onClose: () => void;
  onReopen: (sale: Sale) => void;
  notify: (message: string) => void;
}) {
  const sales = useLive(() => db.sales.toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<number | null>(null);
  const [returnStock, setReturnStock] = useState(true);
  const [pinFor, setPinFor] = useState<(() => void) | null>(null);
  const [refundFor, setRefundFor] = useState<Sale | null>(null);

  const canVoid = role === 'OWNER' || role === 'MANAGER';
  const canRefund = canVoid;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/^order\s*#?|^#/, '');
    return sales
      .filter((s) => {
        if (!query) return true;
        return [String(s.id), s.customer?.name, s.customer?.phone, s.deliveryInfo?.phone, (s.items || []).map((i) => i.name).join(' ')]
          .some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, VISIBLE);
  }, [sales, search]);

  const [pendingAction, setPendingAction] = useState('This action needs owner authorization.');

  function withOwnerPin(action: () => void, prompt = 'This action needs owner authorization.') {
    if (role === 'OWNER') action();
    else {
      setPendingAction(prompt);
      setPinFor(() => action);
    }
  }

  async function voidSales(ids: number[]) {
    const voided: Sale[] = [];
    await db.transaction('rw', db.sales, db.inventory, db.recipes, db.deliveries, async () => {
      for (const id of ids) {
        const sale = await db.sales.get(id);
        if (!sale) continue;
        if (returnStock) await restoreInventory(sale.items);
        await db.sales.delete(id);
        await db.deliveries.where('saleId').equals(id).delete();
        voided.push(sale);
      }
    });
    // Outside the transaction: Dexie forbids writing a table the rw scope doesn't include.
    for (const sale of voided) {
      if (sale.cloudId) deleteSale(sale.cloudId);
      await logAudit('SALE_DELETE', `Order #${sale.id} deleted (${formatAmount(sale.total)})`, username, sale.id);
    }
    setSelected(new Set());
    setConfirming(null);
    notify(`${ids.length} order${ids.length === 1 ? '' : 's'} deleted.`);
  }

  function requestVoid(ids: number[]) {
    withOwnerPin(() => void voidSales(ids));
  }

  async function print(sale: Sale) {
    try {
      const how = await printReceipt(sale);
      if (how === 'browser') notify('Printer unavailable — printing from the browser instead.');
    } catch (err) {
      notify((err as Error).message);
    }
  }

  async function share(sale: Sale) {
    await shareReceipt(sale);
    await logAudit('RECEIPT_SHARED', `Receipt for Order #${sale.id} shared`, username, sale.id);
  }

  function exportCsv() {
    const rows = [...sales]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((sale) => [
        sale.id ?? '',
        new Date(sale.timestamp).toLocaleString(),
        sale.serverUser || '',
        sale.orderType,
        (sale.items || []).map((i) => `${i.name} x${i.qty}`).join('; '),
        sale.subtotal.toFixed(2),
        sale.discountPercent || 0,
        sale.discountAmount.toFixed(2),
        sale.deliveryCharge.toFixed(2),
        sale.packingCharge.toFixed(2),
        sale.taxPercent || 0,
        sale.taxAmount.toFixed(2),
        sale.otherCharge.toFixed(2),
        sale.total.toFixed(2),
        (sale.refundedAmount || 0).toFixed(2),
        sale.refundStatus || '',
        (sale.payments || []).map((p) => `${p.method}: ${p.amount.toFixed(2)}`).join('; '),
      ]);
    downloadCsv(
      datedFilename('Sales_Export'),
      ['Order ID', 'Date', 'Server', 'Order Type', 'Items', 'Subtotal', 'Discount %', 'Discount Amount',
        'Delivery Charge', 'Packing Charge', 'Tax %', 'Tax Amount', 'Other Charges', 'Total',
        'Refunded Amount', 'Refund Status', 'Payment Methods'],
      rows,
    );
    notify(`${rows.length} orders exported.`);
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Modal title="Sales History" onClose={onClose} wide>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order #, customer or item..."
                aria-label="Search sales"
                className="w-full pl-10 pr-4 py-2.5 text-sm ring-1 ring-gray-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
              />
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="shrink-0 px-3 py-2.5 text-xs font-bold rounded-2xl bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
              title="Download all orders as a spreadsheet"
            >
              <Download className="w-3.5 h-3.5" aria-hidden /> CSV
            </button>
          </div>

          {canVoid && visible.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 font-bold text-gray-600">
                <input
                  type="checkbox"
                  checked={selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((s) => s.id!)) : new Set())}
                  className="rounded accent-indigo-600"
                />
                Select all
              </label>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => requestVoid([...selected])}
                  className="ml-auto bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-red-700 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden /> Void {selected.size}
                </button>
              )}
            </div>
          )}

          {visible.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-6">No matching sales.</p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
              {visible.map((sale) => (
                <article key={sale.id} className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {canVoid && (
                        <input
                          type="checkbox"
                          checked={selected.has(sale.id!)}
                          onChange={() => toggle(sale.id!)}
                          aria-label={`Select order ${sale.id}`}
                          className="mt-0.5 rounded accent-indigo-600"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-gray-800">
                          Order #{sale.id}
                          <span className="ml-1 text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">
                            {sale.orderType}
                          </span>
                          {!!sale.discountPercent && (
                            <span className="ml-1 text-[10px] text-red-500 font-bold">-{sale.discountPercent}%</span>
                          )}
                          {sale.refundStatus && (
                            <span className="ml-1 text-[10px] text-orange-700 font-bold bg-orange-50 px-1.5 py-0.5 rounded">
                              {sale.refundStatus === 'FULL' ? `Refunded ${formatAmount(sale.refundedAmount ?? 0)}` : 'Part refunded'}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          By: {sale.serverUser || 'Staff'} • {new Date(sale.timestamp).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {sale.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
                        </p>
                      </div>
                    </div>
                    <p className="font-bold text-emerald-700 text-xs shrink-0">{formatAmount(sale.total)}</p>
                  </div>

                  {confirming === sale.id ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-gray-200">
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600 mr-auto">
                        <input
                          type="checkbox"
                          checked={returnStock}
                          onChange={(e) => setReturnStock(e.target.checked)}
                          className="rounded accent-emerald-600"
                        />
                        Return ingredients to stock
                      </label>
                      <button
                        type="button"
                        onClick={() => requestVoid([sale.id!])}
                        className="text-[10px] bg-red-600 text-white font-bold px-2.5 py-1.5 rounded"
                      >
                        Confirm void
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="text-[10px] bg-gray-100 text-gray-700 font-bold px-2.5 py-1.5 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={() => print(sale)}
                        className="text-[10px] bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold px-2 py-1 rounded flex items-center gap-1 mr-auto"
                        title="Print this receipt"
                      >
                        <Printer className="w-3 h-3" aria-hidden /> Print
                      </button>
                      <button
                        type="button"
                        onClick={() => share(sale)}
                        className="text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                        title="Send the receipt on WhatsApp"
                      >
                        <Share2 className="w-3 h-3" aria-hidden /> Share
                      </button>
                      <button
                        type="button"
                        onClick={() => withOwnerPin(() => onReopen(sale))}
                        className="text-[10px] bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                        title="Re-open into the cart for editing"
                      >
                        <Pencil className="w-3 h-3" aria-hidden /> Edit
                      </button>
                      {canRefund && refundableTotal(sale) > 0 && (
                        <button
                          type="button"
                          onClick={() => withOwnerPin(() => setRefundFor(sale), 'Refunding a completed sale needs owner authorization.')}
                          className="text-[10px] bg-orange-50 text-orange-700 hover:bg-orange-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                          title="Refund items from this order"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden /> Refund
                        </button>
                      )}
                      {canVoid && (
                        <button
                          type="button"
                          onClick={() => setConfirming(sale.id!)}
                          className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden /> Void
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {pinFor && (
        <OwnerPinModal
          action={pendingAction}
          onClose={() => setPinFor(null)}
          onAuthorized={() => {
            const action = pinFor;
            setPinFor(null);
            action();
          }}
        />
      )}

      {refundFor && (
        <RefundModal
          sale={refundFor}
          username={username}
          notify={notify}
          onClose={() => setRefundFor(null)}
          onDone={() => { setRefundFor(null); }}
        />
      )}
    </>
  );
}
