import { useState } from 'react';
import { X } from 'lucide-react';
import { formatAmount } from '../lib/format';
import type { PaymentDetail, PaymentMethod } from '../lib/db/types';

const METHODS: PaymentMethod[] = ['Cash', 'Card', 'Online'];

export function PaymentModal({ total, onCancel, onConfirm }: {
  total: number;
  onCancel: () => void;
  onConfirm: (payments: PaymentDetail[]) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [cashGiven, setCashGiven] = useState<number>(total);
  const change = Math.max(0, cashGiven - total);
  const short = method === 'Cash' && cashGiven < total;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-black text-gray-900">Take Payment</h2>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-red-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-center bg-emerald-50 rounded-2xl py-4">
            <p className="text-xs uppercase tracking-widest text-emerald-700 font-bold">Total Due</p>
            <p className="text-3xl font-black text-emerald-700">{formatAmount(total)}</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`py-2.5 rounded-xl text-sm font-bold border transition ${
                  method === m
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {method === 'Cash' && (
            <div className="space-y-2">
              <label htmlFor="cashGiven" className="block text-xs font-bold text-gray-600 uppercase tracking-wide">
                Cash Received
              </label>
              <input
                id="cashGiven"
                type="number"
                min={0}
                value={cashGiven}
                onChange={(e) => setCashGiven(Math.max(0, Number(e.target.value) || 0))}
                className="w-full p-3 text-right font-black text-lg border-0 ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-between text-sm font-bold">
                <span className="text-gray-500">{short ? 'Still owed:' : 'Change:'}</span>
                <span className={short ? 'text-red-600' : change > 0 ? 'text-emerald-600' : 'text-gray-400'}>
                  {formatAmount(short ? total - cashGiven : change)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={short}
            onClick={() =>
              onConfirm([
                method === 'Cash'
                  ? { method, amount: total, cashGiven, change }
                  : { method, amount: total },
              ])
            }
            className="flex-2 basis-2/3 py-3 rounded-xl font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Complete Sale
          </button>
        </div>
      </div>
    </div>
  );
}
