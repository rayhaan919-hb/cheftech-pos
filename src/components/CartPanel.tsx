import { Minus, Plus, Trash2, Pause, Printer, UtensilsCrossed } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { calculateCartTotals } from '../lib/cart';
import type { CartCharges } from '../lib/cart';
import { formatAmount, currencySymbol } from '../lib/format';
import { CustomerPanel } from './CustomerPanel';
import type { CartItem, CustomerInfo, OrderType, UserRole } from '../lib/db/types';

const ORDER_TYPES: Array<{ value: OrderType; label: string }> = [
  { value: 'DINE_IN', label: 'Dine In' },
  { value: 'TAKEAWAY', label: 'Takeaway' },
  { value: 'DELIVERY', label: 'Delivery' },
];

const TABLES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];

export function CartPanel({
  items, role, charges, customer, loyaltyBalance, onChange, onCustomerChange,
  onQtyChange, onRemove, onCheckout, onHold, notify,
}: {
  items: CartItem[];
  role: UserRole;
  charges: CartCharges;
  customer: CustomerInfo;
  loyaltyBalance: number;
  onChange: (charges: CartCharges) => void;
  onCustomerChange: (customer: CustomerInfo) => void;
  onQtyChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  onHold: () => void;
  notify: (message: string) => void;
}) {
  const totals = calculateCartTotals(items, charges);
  const { orderType, tableNumber, discountPercent, deliveryCharge } = charges;

  const heldOrders = useLive(() => db.heldOrders.toArray(), []) ?? [];
  const occupiedTables = new Set(
    heldOrders
      .filter((h) => h.orderType === 'DINE_IN' && h.tableNumber)
      .map((h) => h.tableNumber as string),
  );

  return (
    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-[#e0edff] flex flex-col lg:max-h-[calc(100vh-5.75rem)]">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-2">
        <h3 className="font-display text-lg font-medium text-[#000000]">Current Order</h3>
        <div className="flex bg-[#eff6ff] p-1 rounded-[10px] border border-[#e0edff] text-xs font-medium gap-1">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() =>
                onChange({
                  ...charges,
                  orderType: t.value,
                  deliveryCharge: t.value === 'DELIVERY' ? deliveryCharge : 0,
                })
              }
              aria-pressed={orderType === t.value}
              className={`px-3 py-1.5 min-h-9 rounded-[8px] whitespace-nowrap transition-all duration-150 ${
                orderType === t.value
                  ? 'bg-[#2941e0] text-white font-medium'
                  : 'text-[#273238] hover:bg-white hover:text-[#2941e0]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {orderType === 'DINE_IN' && (
        <div className="mb-3 p-3 rounded-2xl bg-[#eff6ff]/60 border border-[#e0edff]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[#273238] flex items-center gap-1.5">
              <UtensilsCrossed className="w-3.5 h-3.5 text-[#2941e0]" aria-hidden />
              Table Assignment {tableNumber ? `· ${tableNumber}` : '· Counter'}
            </span>
            {tableNumber && (
              <button
                type="button"
                onClick={() => onChange({ ...charges, tableNumber: undefined })}
                className="text-xs font-medium text-[#2941e0] hover:underline"
              >
                Clear (Counter)
              </button>
            )}
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {TABLES.map((t) => {
              const selected = tableNumber === t;
              const occupied = occupiedTables.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange({ ...charges, tableNumber: selected ? undefined : t })}
                  title={occupied ? `${t} has a held order` : `Assign to ${t}`}
                  className={`relative py-1.5 rounded-[8px] text-xs font-medium border transition ${
                    selected
                      ? 'bg-[#2941e0] text-white border-[#2941e0]'
                      : occupied
                        ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                        : 'bg-white text-[#273238] border-[#b4c4cc] hover:border-[#2941e0]'
                  }`}
                >
                  {t}
                  {occupied && !selected && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#f7ba02]" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <CustomerPanel
        orderType={orderType}
        customer={customer}
        loyaltyBalance={loyaltyBalance}
        loyaltyPoints={charges.loyaltyPoints}
        onChange={onCustomerChange}
        onRedeem={(points) => onChange({ ...charges, loyaltyPoints: points })}
      />

      {orderType === 'DELIVERY' && (
        <div className="mb-3">
          <label htmlFor="deliveryCharge" className="block text-xs font-medium text-[#273238] mb-1">
            Delivery Charge ({currencySymbol()})
          </label>
          <input
            id="deliveryCharge"
            type="number"
            min={0}
            step={0.01}
            value={deliveryCharge || 0}
            onChange={(e) => onChange({ ...charges, deliveryCharge: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full px-3 py-2 h-10 border border-[#b4c4cc] rounded-[10px] bg-white text-sm font-medium text-[#000000] focus:outline-none focus:ring-2 focus:ring-[#2941e0]"
          />
        </div>
      )}

      <div className="space-y-2 mb-3 flex-1 overflow-y-auto custom-scrollbar min-h-[110px]">
        {items.length === 0 ? (
          <p className="text-center text-[#616f75] py-6 text-xs">Cart is empty — click any dish to add</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="border border-[#e0edff] rounded-2xl p-2.5 bg-white flex justify-between items-center gap-2"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-[#000000] truncate">{item.name}</div>
                <div className="text-xs text-[#526066]">{formatAmount(item.price)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onQtyChange(item.id, item.qty - 1)}
                    className="p-1 rounded-[4px] bg-red-500 text-white hover:bg-red-600"
                    aria-label={`Decrease ${item.name}`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-semibold px-1.5 text-sm tabular-nums text-[#000000]">{item.qty}</span>
                  <button
                    type="button"
                    onClick={() => onQtyChange(item.id, item.qty + 1)}
                    className="p-1 rounded-[4px] bg-emerald-600 text-white hover:bg-emerald-700"
                    aria-label={`Increase ${item.name}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="font-semibold text-xs sm:text-sm w-16 sm:w-20 text-right text-[#000000] tabular-nums">
                  {formatAmount(item.price * item.qty)}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="text-[#b4c4cc] hover:text-red-500 transition-colors"
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-[#e0edff] pt-3 space-y-2.5">
        <div className="flex justify-between items-center text-sm text-[#526066]">
          <span>Subtotal:</span>
          <span className="font-semibold text-[#000000]">{formatAmount(totals.subtotal)}</span>
        </div>

        <div className="flex justify-between items-center gap-2 bg-[#eff6ff] border border-[#e0edff] px-3 py-2 rounded-2xl">
          <label htmlFor="discountInput" className="text-xs font-medium text-[#273238]">
            Discount:
          </label>
          <div className="flex items-center gap-1 bg-white rounded-[10px] border border-[#b4c4cc] px-2">
            <input
              id="discountInput"
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(e) =>
                onChange({
                  ...charges,
                  discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                  discountAmountOverride: undefined,
                })
              }
              className="w-14 py-1 min-h-8 text-right font-semibold text-sm border-0 focus:outline-none text-[#000000] bg-transparent"
            />
            <span className="text-xs font-medium text-[#526066]">%</span>
          </div>
        </div>

        {totals.discountAmount > 0 && (
          <div className="flex justify-between items-center text-xs text-red-600 font-medium bg-red-50/70 p-2 rounded-[10px]">
            <span>Saved:</span>
            <span>-{formatAmount(totals.discountAmount)} ({discountPercent}%)</span>
          </div>
        )}

        {totals.deliveryCharge > 0 && (
          <div className="flex justify-between items-center text-xs text-[#2941e0] font-medium bg-[#eff6ff] p-2 rounded-[10px]">
            <span>Delivery:</span>
            <span>{formatAmount(totals.deliveryCharge)}</span>
          </div>
        )}

        {totals.loyaltyDiscount > 0 && (
          <div className="flex justify-between items-center text-xs text-[#742afb] font-medium bg-[#eff6ff] p-2 rounded-[10px]">
            <span>Points ({charges.loyaltyPoints}):</span>
            <span>-{formatAmount(totals.loyaltyDiscount)}</span>
          </div>
        )}

        <div className="flex justify-between items-end font-display font-semibold text-2xl text-[#000000] border-t border-[#d4d4d8] pt-3 pb-0.5">
          <span className="text-sm font-sans font-medium text-[#526066] mb-0.5">Total Due</span>
          <span className="text-[#2941e0]">{formatAmount(totals.grandTotal)}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2.5 mt-4">
        <button
          type="button"
          onClick={onHold}
          disabled={!items.length}
          title="Hold Order (F4)"
          className="col-span-1 h-11 bg-white border border-[#b4c4cc] text-[#000000] rounded-[8px] font-medium hover:bg-[#eff6ff] hover:border-[#2941e0] disabled:opacity-40 transition flex items-center justify-center gap-1 text-xs sm:text-sm"
        >
          <Pause className="w-4 h-4 shrink-0 text-[#2941e0]" /> Hold
        </button>
        <button
          type="button"
          onClick={() => {
            if (role === 'WAITER') {
              notify('Waiters cannot take payments. Ask a cashier or manager.');
              return;
            }
            onCheckout();
          }}
          disabled={!items.length}
          title="Checkout & Print (F2)"
          className="col-span-3 h-11 bg-[#2941e0] text-white rounded-[8px] font-medium tracking-[0.5px] hover:bg-[#1f35c4] disabled:opacity-40 transition flex items-center justify-center gap-2 text-sm"
        >
          <Printer className="w-4 h-4 shrink-0" /> Checkout & Print
        </button>
      </div>
    </div>
  );
}
