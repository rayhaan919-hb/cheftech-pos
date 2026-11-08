import { useEffect, useState } from 'react';
import { getPnl } from '../lib/analytics';
import type { PnlReport } from '../lib/analytics';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function ProfitLossModal({ onClose }: { onClose: () => void }) {
  const today = new Date();
  const [start, setStart] = useState(iso(today));
  const [end, setEnd] = useState(iso(today));
  const [report, setReport] = useState<PnlReport | null>(null);

  useEffect(() => {
    let active = true;
    getPnl(start, end).then((next) => {
      if (active) setReport(next);
    });
    return () => {
      active = false;
    };
  }, [start, end]);

  function preset(range: 'today' | 'month') {
    const now = new Date();
    setStart(range === 'today' ? iso(now) : iso(new Date(now.getFullYear(), now.getMonth(), 1)));
    setEnd(iso(now));
  }

  const net = report?.net ?? 0;

  return (
    <Modal title="Profit & Loss" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">From</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-label="Report start date"
              className="p-2 text-xs ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">To</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-label="Report end date"
              className="p-2 text-xs ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </label>
          <button type="button" onClick={() => preset('today')} className="px-3 py-2 text-xs font-bold rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200">
            Today
          </button>
          <button type="button" onClick={() => preset('month')} className="px-3 py-2 text-xs font-bold rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200">
            This month
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800">Sales</p>
            <p className="text-lg font-black text-emerald-900 tabular-nums">{formatAmount(report?.sales ?? 0)}</p>
            <p className="text-[10px] text-emerald-700">{report?.orderCount ?? 0} orders</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">Approved expenses</p>
            <p className="text-lg font-black text-amber-900 tabular-nums">{formatAmount(report?.expenses ?? 0)}</p>
            <p className="text-[10px] text-amber-700">Pending expenses excluded</p>
          </div>
          <div className={`p-3 rounded-xl border ${net < 0 ? 'bg-red-50 border-red-200' : 'bg-teal-50 border-teal-200'}`}>
            <p className={`text-[10px] font-black uppercase tracking-wider ${net < 0 ? 'text-red-800' : 'text-teal-800'}`}>
              Net {net < 0 ? 'loss' : 'profit'}
            </p>
            <p className={`text-lg font-black tabular-nums ${net < 0 ? 'text-red-700' : 'text-teal-900'}`}>
              {formatAmount(net)}
            </p>
            <p className={`text-[10px] ${net < 0 ? 'text-red-600' : 'text-teal-700'}`}>Sales − expenses</p>
          </div>
        </div>

        <p className="text-[11px] text-gray-500">
          Stock received from suppliers is not counted as an expense here — it is captured when recorded in
          Expenses or on the Suppliers ledger.
        </p>
      </div>
    </Modal>
  );
}
