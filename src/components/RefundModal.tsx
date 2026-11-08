import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { formatAmount } from '../lib/format';
import { computeRefund, recordRefund, remainingQty } from '../lib/refunds';
import type { RefundLine } from '../lib/refunds';
import { Modal } from './Modal';
import type { Sale } from '../lib/db/types';

export function RefundModal({ sale, username, notify, onClose, onDone }: {
  sale: Sale;
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const lines: RefundLine[] = useMemo(
    () => Object.entries(qty).map(([index, value]) => ({ index: Number(index), qty: Number(value) || 0 })),
    [qty],
  );
  const preview = useMemo(() => computeRefund(sale, lines), [sale, lines]);

  async function submit() {
    setBusy(true);
    try {
      const result = await recordRefund(sale.id!, lines, reason, username);
      notify(
        `${result.status === 'FULL' ? 'Full' : 'Partial'} refund of ${formatAmount(result.amount)} on order #${sale.id}.`,
      );
      onClose();
      onDone();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Refund Order #${sale.id}`}
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-gray-600">
            Refund total:{' '}
            <strong className={`tabular-nums ${preview.amount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {formatAmount(preview.amount)}
            </strong>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || preview.amount <= 0 || !reason.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Refund {formatAmount(preview.amount)}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500">
          Original total {formatAmount(sale.total)}
          {!!sale.refundedAmount && ` · already refunded ${formatAmount(sale.refundedAmount)}`}
          {sale.refundStatus && ` (${sale.refundStatus})`}. Refunded quantities go back into stock.
        </p>

        <ul className="space-y-1.5">
          {(sale.items || []).map((line, index) => {
            const left = remainingQty(line);
            return (
              <li
                key={`${line.id}-${index}`}
                className={`flex items-center gap-2 p-2 rounded-lg border ${left === 0 ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-bold truncate ${left === 0 ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {line.name}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {formatAmount(preview.units[index])} each
                    {preview.units[index] !== line.price && ' after discount'} ·{' '}
                    {left === 0 ? 'fully refunded' : `${left} of ${line.qty} refundable`}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={left}
                  value={qty[index] ?? ''}
                  onChange={(e) => setQty((current) => ({ ...current, [index]: e.target.value }))}
                  disabled={left === 0}
                  placeholder="0"
                  aria-label={`Refund quantity for ${line.name}`}
                  className="w-16 p-1.5 text-xs text-right ring-1 ring-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40 tabular-nums"
                />
              </li>
            );
          })}
        </ul>

        <label className="block">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
            Reason (required)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Wrong item delivered"
            aria-label="Refund reason"
            className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
          />
        </label>

        {preview.fullyRefunded && preview.amount > 0 && (
          <p className="text-[11px] font-bold text-red-600">
            This will fully refund the remaining balance of the order.
          </p>
        )}
      </div>
    </Modal>
  );
}
