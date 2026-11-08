import { useMemo, useState } from 'react';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import { normalizeQuantity } from '../lib/inventory';
import { newSupplierId, recordStockIn, recordSupplierPayment, supplierBalance } from '../lib/suppliers';
import { Modal } from './Modal';
import type { Expense, StockIn, Supplier, SupplierPayment } from '../lib/db/types';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Online'];

export function SuppliersModal({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const suppliers = useLive(() => db.suppliers.toArray(), []) ?? [];
  const expenses = useLive(() => db.expenses.toArray(), []) ?? [];
  const payments = useLive(() => db.supplierPayments.toArray(), []) ?? [];
  const allStockIn = useLive(() => db.stockIn.toArray(), []) ?? [];
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);

  return (
    <Modal
      title={selected ? selected.name : editing ? (editing.id ? 'Edit Supplier' : 'New Supplier') : 'Suppliers'}
      onClose={onClose}
      wide
    >
      {selected ? (
        <SupplierDetails
          supplier={selected}
          expenses={expenses}
          payments={payments}
          allStockIn={allStockIn}
          notify={notify}
          onBack={() => setSelected(null)}
        />
      ) : editing ? (
        <SupplierForm
          supplier={editing}
          notify={notify}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setEditing({ id: '', name: '', phone: '', email: '', taxId: '', website: '', address: '', notes: '' })}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> Add Supplier
          </button>

          {suppliers.length === 0 ? (
            <p className="text-gray-400 text-xs text-center py-6">No suppliers added yet.</p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
              {suppliers.map((supplier) => {
                const { totalSpent, totalPaid, balance } = supplierBalance(supplier.id, expenses, payments, allStockIn);
                return (
                  <div key={supplier.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex justify-between items-start gap-2">
                    <button type="button" onClick={() => setSelected(supplier)} className="text-left min-w-0 flex-1">
                      <p className="font-bold text-sm text-gray-800 truncate">{supplier.name}</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {supplier.phone || '—'} • {supplier.address || '—'}
                      </p>
                      {supplier.notes && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{supplier.notes}</p>}
                      <p className="text-[11px] font-bold text-teal-700 mt-1">
                        Spent {formatAmount(totalSpent)} · Paid {formatAmount(totalPaid)} ·{' '}
                        <span className={balance > 0 ? 'text-red-600' : 'text-emerald-700'}>Balance {formatAmount(balance)}</span>
                      </p>
                    </button>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditing(supplier)}
                        className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm('Delete this supplier? Existing expenses keep their record.')) return;
                          await db.suppliers.delete(supplier.id);
                          notify(`${supplier.name} deleted.`);
                        }}
                        aria-label={`Delete ${supplier.name}`}
                        className="bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SupplierForm({ supplier, notify, onDone }: {
  supplier: Supplier;
  notify: (message: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Supplier>(supplier);

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      notify('Supplier name is required.');
      return;
    }
    await db.suppliers.put({ ...draft, id: draft.id || newSupplierId(), name });
    notify(`${name} saved.`);
    onDone();
  }

  const fields: Array<{ key: keyof Supplier; label: string; type?: string }> = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'taxId', label: 'Tax ID' },
    { key: 'website', label: 'Website' },
    { key: 'address', label: 'Address' },
  ];

  return (
    <div className="space-y-3">
      <button type="button" onClick={onDone} className="text-xs text-teal-700 font-bold hover:underline flex items-center gap-1">
        <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Back to suppliers
      </button>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {fields.map(({ key, label, type }) => (
          <label key={key} className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">{label}</span>
            <input
              type={type || 'text'}
              value={String(draft[key] ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              aria-label={`Supplier ${label}`}
              className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Notes</span>
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          aria-label="Supplier Notes"
          rows={2}
          className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="flex-1 py-2.5 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs">
          Cancel
        </button>
        <button type="button" onClick={save} className="flex-1 py-2.5 rounded-xl font-bold bg-teal-600 text-white hover:bg-teal-700 text-xs">
          Save Supplier
        </button>
      </div>
    </div>
  );
}

function SupplierDetails({ supplier, expenses, payments, allStockIn, notify, onBack }: {
  supplier: Supplier;
  expenses: Expense[];
  payments: SupplierPayment[];
  allStockIn: StockIn[];
  notify: (message: string) => void;
  onBack: () => void;
}) {
  const inventory = useLive(() => db.inventory.toArray(), []) ?? [];
  const stockIn = allStockIn.filter((s) => s.supplierId === supplier.id);
  const { totalSpent, totalPaid, balance } = supplierBalance(supplier.id, expenses, payments, allStockIn);

  const [stockDraft, setStockDraft] = useState({ ingredient: '', qty: '', unitPrice: '' });
  const [paymentDraft, setPaymentDraft] = useState({ amount: '', method: PAYMENT_METHODS[0] });

  const ledger = useMemo(() => [...stockIn].sort((a, b) => b.created.localeCompare(a.created)), [stockIn]);

  async function addStock() {
    const qty = normalizeQuantity(stockDraft.qty);
    const unitPrice = normalizeQuantity(stockDraft.unitPrice);
    if (!stockDraft.ingredient || !qty || unitPrice === null) {
      notify('Pick an ingredient and enter a quantity above zero.');
      return;
    }
    await recordStockIn(supplier, stockDraft.ingredient, qty, unitPrice);
    setStockDraft({ ingredient: '', qty: '', unitPrice: '' });
    notify('Stock received.');
  }

  async function addPayment() {
    const amount = normalizeQuantity(paymentDraft.amount);
    if (!amount) {
      notify('Enter a payment amount above zero.');
      return;
    }
    await recordSupplierPayment(supplier.id, amount, paymentDraft.method);
    setPaymentDraft({ amount: '', method: paymentDraft.method });
    notify('Payment recorded.');
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-teal-700 font-bold hover:underline flex items-center gap-1">
        <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Back to suppliers
      </button>

      <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl grid grid-cols-3 gap-2 text-center">
        {[['Spent', totalSpent], ['Paid', totalPaid], ['Balance', balance]].map(([label, value]) => (
          <div key={String(label)}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">{String(label)}</p>
            <p className={`font-black text-sm ${label === 'Balance' && balance > 0 ? 'text-red-600' : 'text-teal-900'}`}>
              {formatAmount(Number(value))}
            </p>
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Receive stock</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select
            value={stockDraft.ingredient}
            onChange={(e) => setStockDraft((d) => ({ ...d, ingredient: e.target.value }))}
            aria-label="Stock-in ingredient"
            className="p-2 text-xs ring-1 ring-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-0"
          >
            <option value="">Ingredient…</option>
            {inventory.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            value={stockDraft.qty}
            onChange={(e) => setStockDraft((d) => ({ ...d, qty: e.target.value }))}
            placeholder="Qty"
            aria-label="Stock-in quantity"
            className="p-2 text-xs ring-1 ring-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-0"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={stockDraft.unitPrice}
            onChange={(e) => setStockDraft((d) => ({ ...d, unitPrice: e.target.value }))}
            placeholder="Unit price"
            aria-label="Stock-in unit price"
            className="p-2 text-xs ring-1 ring-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-0"
          />
          <button type="button" onClick={addStock} className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg py-2">
            Receive
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Record payment</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input
            type="number"
            min={0}
            step="0.01"
            value={paymentDraft.amount}
            onChange={(e) => setPaymentDraft((d) => ({ ...d, amount: e.target.value }))}
            placeholder="Amount"
            aria-label="Payment amount"
            className="p-2 text-xs ring-1 ring-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-0"
          />
          <select
            value={paymentDraft.method}
            onChange={(e) => setPaymentDraft((d) => ({ ...d, method: e.target.value }))}
            aria-label="Payment method"
            className="p-2 text-xs ring-1 ring-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-0"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button type="button" onClick={addPayment} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg py-2">
            Pay
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Stock received</h4>
        {ledger.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-3">No stock received yet.</p>
        ) : (
          <ul className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
            {ledger.map((row) => (
              <li key={row.id} className="p-2 bg-white border border-gray-200 rounded-lg flex justify-between items-center text-xs">
                <div>
                  <p className="font-bold text-gray-800">{row.ingredient}</p>
                  <p className="text-[10px] text-gray-500">{new Date(row.created).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800">{formatAmount(row.totalCost)}</p>
                  <p className="text-[10px] text-gray-500">
                    {row.qty} × {formatAmount(row.unitPrice)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
