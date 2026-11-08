import { useEffect, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { getCustomer, normalizePhone } from '../lib/customers';
import { formatAmount } from '../lib/format';
import { getMinDeliveryOrder } from '../lib/sales';
import type { Customer, CustomerInfo, OrderType } from '../lib/db/types';

export function CustomerPanel({ orderType, customer, loyaltyBalance, loyaltyPoints, onChange, onRedeem }: {
  orderType: OrderType;
  customer: CustomerInfo;
  loyaltyBalance: number;
  loyaltyPoints: number;
  onChange: (customer: CustomerInfo) => void;
  onRedeem: (points: number) => void;
}) {
  const [lookup, setLookup] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);

  const phone = customer.phone ?? '';

  useEffect(() => {
    let active = true;
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setLookup(null);
      setNewCustomer(false);
      return;
    }
    getCustomer(normalized).then((found) => {
      if (!active) return;
      setLookup(found ?? null);
      setNewCustomer(!found);
      if (found && !customer.name) onChange({ ...customer, name: found.name });
    });
    return () => {
      active = false;
    };
    // Only re-look up when the phone changes; name edits must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const isDelivery = orderType === 'DELIVERY';
  const valid = !!normalizePhone(phone);
  // Static class strings — Tailwind cannot see interpolated `bg-${tint}-50`.
  const box = isDelivery ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200';
  const heading = isDelivery ? 'text-blue-900 border-blue-200/50' : 'text-purple-900 border-purple-200/50';
  const clear = isDelivery ? 'text-blue-600' : 'text-purple-600';
  const field = isDelivery ? 'ring-blue-200 focus:ring-blue-500' : 'ring-purple-200 focus:ring-purple-500';
  const info = isDelivery
    ? 'text-blue-800 border-blue-100'
    : 'text-purple-800 border-purple-100';

  return (
    <div className={`mb-4 p-3 sm:p-4 border rounded-2xl space-y-2 text-sm shadow-inner ${box}`}>
      <div className={`flex justify-between items-center font-bold border-b pb-2 text-xs ${heading}`}>
        <span className="flex items-center gap-1.5">
          <UserRound className="w-3.5 h-3.5" aria-hidden />
          {isDelivery ? 'Delivery Info' : 'Customer / Loyalty Program'}
          {isDelivery && (
            <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
              Min Order: {formatAmount(getMinDeliveryOrder())}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange({});
            onRedeem(0);
          }}
          className={`hover:text-red-500 text-[10px] uppercase tracking-wider bg-gray-100 px-3 min-h-11 rounded-lg border border-gray-200 flex items-center gap-1 ${clear}`}
        >
          <X className="w-3 h-3" aria-hidden /> Clear
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => onChange({ ...customer, phone: e.target.value })}
          placeholder="Phone Number"
          aria-label="Customer phone"
          className={`w-full p-2.5 min-h-11 border-0 ring-1 rounded-xl bg-white text-xs sm:text-sm focus:outline-none focus:ring-2 ${field}`}
        />
        <input
          type="text"
          value={customer.name ?? ''}
          onChange={(e) => onChange({ ...customer, name: e.target.value })}
          placeholder="Customer Name"
          aria-label="Customer name"
          className={`w-full p-2.5 min-h-11 border-0 ring-1 rounded-xl bg-white text-xs sm:text-sm focus:outline-none focus:ring-2 ${field}`}
        />
      </div>

      {isDelivery && (
        <input
          type="text"
          value={customer.address ?? ''}
          onChange={(e) => onChange({ ...customer, address: e.target.value })}
          placeholder="Delivery Address / Landmark"
          aria-label="Delivery address"
          className="w-full p-2.5 min-h-11 border-0 ring-1 ring-blue-200 rounded-xl bg-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}

      {valid && lookup && (
        <div className={`text-xs font-bold bg-white/60 border p-2.5 rounded-xl shadow-sm ${info}`}>
          Returning customer: {lookup.totalOrders || 0} orders • Total spent {formatAmount(lookup.totalSpent || 0)} •{' '}
          {lookup.loyaltyPoints || 0} points
        </div>
      )}

      {valid && newCustomer && (
        <div className={`text-xs font-bold bg-white/60 border p-2.5 rounded-xl shadow-sm ${info}`}>
          New customer — will be saved after checkout.
        </div>
      )}

      {valid && loyaltyBalance > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1 bg-amber-50 border border-amber-200 p-2.5 rounded-xl shadow-sm">
          <label htmlFor="loyaltyRedeem" className="text-[10px] sm:text-xs font-black text-amber-800">
            Redeem Points:
          </label>
          <input
            id="loyaltyRedeem"
            type="number"
            min={0}
            max={loyaltyBalance}
            value={loyaltyPoints || ''}
            placeholder="0"
            onChange={(e) => onRedeem(Math.min(loyaltyBalance, Math.max(0, Number(e.target.value) || 0)))}
            className="w-20 sm:w-24 p-2 border-0 ring-1 ring-amber-300 rounded-lg text-xs sm:text-sm font-bold text-right bg-white focus:ring-2 focus:ring-amber-500 shadow-inner text-amber-900"
          />
        </div>
      )}
    </div>
  );
}
