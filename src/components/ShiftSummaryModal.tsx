import { useEffect, useState } from 'react';
import { buildShiftReport, closeShift } from '../lib/shift';
import type { ShiftReport } from '../lib/shift';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';

export function ShiftSummaryModal({ username, onClose, notify, onClosed }: {
  username: string;
  onClose: () => void;
  notify: (message: string) => void;
  onClosed: () => void;
}) {
  const [report, setReport] = useState<ShiftReport | null>(null);

  useEffect(() => {
    buildShiftReport().then(setReport);
  }, []);

  async function close() {
    if (!window.confirm('End the current shift? Active shift revenue tracking resets and opening cash is cleared.')) return;
    await closeShift(username);
    notify('Shift closed. Set opening cash for the new shift.');
    onClose();
    onClosed();
  }

  return (
    <Modal
      title="Shift Summary"
      onClose={onClose}
      wide
      footer={
        <button type="button" onClick={close} className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-black py-2.5 rounded-xl">
          Close Shift & Start New
        </button>
      }
    >
      <div className="space-y-3">
        <section className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-[11px] text-gray-600 space-y-0.5">
          <Row label="Opened by" value={username} />
          <Row label="Shift start" value={new Date(report?.startedAt ?? Date.now()).toLocaleString()} />
          <Row label="Opening cash" value={formatAmount(report?.openingCash ?? 0)} />
          <Row label="Cash from customers" value={formatAmount(report?.cashCollected ?? 0)} />
          <Row label="Change given back" value={`-${formatAmount(report?.changeGiven ?? 0)}`} />
          <Row label="Net cash received" value={formatAmount(report?.netCash ?? 0)} />
          <Row label="Expected drawer cash" value={formatAmount(report?.expectedDrawerCash ?? 0)} strong />
        </section>

        <section className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
          <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Total shift revenue (after discounts)</p>
          <p className="text-2xl font-black text-emerald-700 tabular-nums">{formatAmount(report?.totalSales ?? 0)}</p>
          <p className="text-[11px] text-emerald-600">
            {report?.orderCount ?? 0} {report?.orderCount === 1 ? 'order' : 'orders'} completed
          </p>
        </section>

        <section>
          <Caption>Revenue breakdown</Caption>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Tile label="Dine in" value={report?.dineIn ?? 0} tone="bg-indigo-50 border-indigo-100 text-indigo-900" />
            <Tile label="Takeaway" value={report?.takeaway ?? 0} tone="bg-amber-50 border-amber-100 text-amber-900" />
            <Tile label="Delivery" value={report?.delivery ?? 0} tone="bg-blue-50 border-blue-100 text-blue-900" />
          </div>
        </section>

        <section className="pt-2 border-t border-gray-100 space-y-0.5 text-[11px] text-gray-600">
          <Caption>Checkout charges collected</Caption>
          <Row label="Packing charges" value={formatAmount(report?.packingCharges ?? 0)} />
          <Row label="Tax" value={formatAmount(report?.tax ?? 0)} />
          <Row label="Other charges" value={formatAmount(report?.otherCharges ?? 0)} />
        </section>

        <section className="pt-2 border-t border-gray-100 space-y-1.5">
          <Caption>Inventory consumed this shift</Caption>
          {!report?.ingredients.length ? (
            <p className="text-[11px] text-gray-400 py-2">No ingredient consumption recorded this shift.</p>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {report.ingredients.map((row) => (
                <li key={row.name} className="p-2 bg-white border border-gray-200 rounded-lg flex justify-between items-center text-[11px]">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-800 truncate">{row.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {row.qtyConsumed.toFixed(2)} {row.unit} • {formatAmount(row.costPerUnit)}/unit
                    </p>
                  </div>
                  <span className={`font-black shrink-0 ${row.costConsumed > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {formatAmount(row.costConsumed)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pt-2 border-t border-gray-100 space-y-1.5 text-[11px] text-gray-600">
          <Row label="Discounted orders" value={String(report?.discountedOrderCount ?? 0)} />
          <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200 space-y-1">
            <p className="font-semibold text-gray-700">Discounts by staff</p>
            {!report?.discountsByStaff.length ? (
              <p className="text-gray-500">No discounts were applied during this shift.</p>
            ) : (
              report.discountsByStaff.map((row) => (
                <div key={row.user} className="flex justify-between">
                  <span>{row.user}</span>
                  <strong className="text-red-600">{formatAmount(row.amount)}</strong>
                </div>
              ))
            )}
          </div>
          <Row label="Total discounts given" value={`- ${formatAmount(report?.totalDiscounts ?? 0)}`} valueClass="text-red-600" />
          <Row label="Raw material cost consumed" value={formatAmount(report?.consumedCost ?? 0)} valueClass="text-red-700" />
          <div className={`flex justify-between text-sm font-bold pt-1 ${(report?.grossProfit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            <span>Gross profit / (loss)</span>
            <strong className="tabular-nums">{formatAmount(report?.grossProfit ?? 0)}</strong>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-wider text-gray-700 mb-1">{children}</p>;
}

function Row({ label, value, strong, valueClass }: {
  label: string;
  value: string;
  strong?: boolean;
  valueClass?: string;
}) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? 'font-bold text-gray-800' : ''}`}>
      <span>{label}:</span>
      <strong className={`tabular-nums ${valueClass ?? ''}`}>{value}</strong>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`border rounded-lg p-2 ${tone}`}>
      <span className="block text-[10px] text-gray-500">{label}</span>
      <strong className="tabular-nums text-xs">{formatAmount(value)}</strong>
    </div>
  );
}
