import { useMemo, useState } from 'react';
import { Check, Download, Pencil, Trash2, X } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { logAudit } from '../lib/audit';
import { formatAmount } from '../lib/format';
import { downloadCsv, datedFilename } from '../lib/export';
import { normalizeQuantity } from '../lib/inventory';
import { Modal } from './Modal';
import type { Expense, ExpenseStatus, UserRole } from '../lib/db/types';

const CATEGORIES = ['Utilities', 'Supplies', 'Maintenance', 'Salary', 'Other'];
const METHODS = ['Cash Drawer', 'Petty Cash', 'Bank Transfer', "Owner's Pocket"];
const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

interface Draft {
  id?: number;
  description: string;
  amount: string;
  category: string;
  paymentMethod: string;
  supplierId: string;
}

const BLANK: Draft = { description: '', amount: '', category: CATEGORIES[0], paymentMethod: METHODS[0], supplierId: '' };

function rangeStart(filter: string): number {
  const now = new Date();
  if (filter === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (filter === 'week') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
  if (filter === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return 0;
}

export function ExpensesModal({ role, username, onClose, notify }: {
  role: UserRole;
  username: string;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const expenses = useLive(() => db.expenses.orderBy('timestamp').reverse().toArray(), []) ?? [];
  const suppliers = useLive(() => db.suppliers.toArray(), []) ?? [];
  const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [confirming, setConfirming] = useState<number | null>(null);

  const isOwner = role === 'OWNER';

  const visible = useMemo(() => {
    const start = rangeStart(filter);
    return expenses.filter((e) => new Date(e.timestamp).getTime() >= start);
  }, [expenses, filter]);

  const totals = useMemo(
    () => ({
      approved: visible.filter((e) => e.status === 'APPROVED').reduce((s, e) => s + (Number(e.amount) || 0), 0),
      pending: visible.filter((e) => e.status === 'PENDING').reduce((s, e) => s + (Number(e.amount) || 0), 0),
    }),
    [visible],
  );

  function exportCsv() {
    downloadCsv(
      datedFilename('Expenses_Export'),
      ['ID', 'Date', 'Description', 'Amount', 'Category', 'Payment Method', 'Supplier', 'Status', 'Recorded By'],
      visible.map((expense) => [
        expense.id ?? '',
        new Date(expense.timestamp).toLocaleString(),
        expense.description || '',
        Number(expense.amount || 0).toFixed(2),
        expense.category || '',
        expense.paymentMethod || '',
        expense.supplierId || '',
        expense.status || 'APPROVED',
        expense.serverUser || '',
      ]),
    );
    notify(`${visible.length} expenses exported.`);
  }

  async function save() {
    const amount = normalizeQuantity(draft.amount);
    if (!draft.description.trim() || !amount) {
      notify('Enter a description and an amount above zero.');
      return;
    }
    const data = {
      description: draft.description.trim(),
      amount,
      category: draft.category,
      paymentMethod: draft.paymentMethod,
      supplierId: draft.supplierId || undefined,
      serverUser: username,
    };

    if (draft.id) {
      if (!isOwner) {
        notify('Only the Owner can edit expenses.');
        return;
      }
      await db.expenses.update(draft.id, data);
      notify('Expense updated.');
    } else {
      await db.expenses.add({
        ...data,
        timestamp: new Date().toISOString(),
        status: isOwner ? 'APPROVED' : 'PENDING',
      });
      notify(isOwner ? 'Expense added.' : 'Expense submitted for Owner approval.');
    }
    setDraft(BLANK);
  }

  async function setStatus(expense: Expense, status: ExpenseStatus) {
    if (!isOwner) return;
    await db.expenses.update(expense.id!, {
      status,
      approvedBy: username,
      approvedAt: new Date().toISOString(),
    });
    await logAudit(`EXPENSE_${status}`, `Expense #${expense.id} marked ${status} by ${username}`, username);
    notify(`Expense #${expense.id} ${status.toLowerCase()}.`);
  }

  async function remove(expense: Expense) {
    if (!isOwner) return;
    await db.expenses.delete(expense.id!);
    await logAudit('EXPENSE_DELETE', `Expense #${expense.id} deleted`, username);
    setConfirming(null);
    notify('Expense deleted.');
  }

  function edit(expense: Expense) {
    if (!isOwner) {
      notify('Only the Owner can edit expenses.');
      return;
    }
    setDraft({
      id: expense.id,
      description: expense.description,
      amount: String(expense.amount),
      category: expense.category,
      paymentMethod: expense.paymentMethod,
      supplierId: expense.supplierId || '',
    });
  }

  return (
    <Modal title="Expenses" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${
                filter === key ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-[11px] font-bold">
            <span className="text-emerald-700">Approved {formatAmount(totals.approved)}</span>
            <span className="text-amber-600">Pending {formatAmount(totals.pending)}</span>
            <button
              type="button"
              onClick={exportCsv}
              className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 flex items-center gap-1"
              title="Download these expenses as a spreadsheet"
            >
              <Download className="w-3 h-3" aria-hidden /> CSV
            </button>
          </div>
        </div>

        <section className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm space-y-2">
          <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">
            {draft.id ? `Edit Expense #${draft.id}` : 'Add New Expense'}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Description"
              aria-label="Expense description"
              className="p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 sm:col-span-2"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              placeholder="Amount"
              aria-label="Expense amount"
              className="p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              aria-label="Expense category"
              className="p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={draft.paymentMethod}
              onChange={(e) => setDraft((d) => ({ ...d, paymentMethod: e.target.value }))}
              aria-label="Payment method"
              className="p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              value={draft.supplierId}
              onChange={(e) => setDraft((d) => ({ ...d, supplierId: e.target.value }))}
              aria-label="Expense supplier"
              className="p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">-- No Supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            {draft.id && (
              <button type="button" onClick={() => setDraft(BLANK)} className="px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
                Cancel
              </button>
            )}
            <button type="button" onClick={save} className="px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700">
              {draft.id ? 'Save Changes' : isOwner ? 'Add Expense' : 'Submit for Approval'}
            </button>
          </div>
        </section>

        {visible.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-6">No expenses in this period.</p>
        ) : (
          <div className="space-y-2 max-h-[42vh] overflow-y-auto custom-scrollbar pr-1">
            {visible.map((expense) => (
              <article key={expense.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm space-y-1.5">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-xs text-gray-800 truncate">
                      {expense.description}
                      <span className="ml-1.5 text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        {expense.category}
                      </span>
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(expense.timestamp).toLocaleString()} • {expense.paymentMethod}
                      {expense.serverUser ? ` • ${expense.serverUser}` : ''}
                    </p>
                    {expense.supplierId && (
                      <p className="text-[10px] text-gray-500">
                        Supplier: {suppliers.find((s) => s.id === expense.supplierId)?.name || expense.supplierId}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-xs text-gray-800">{formatAmount(expense.amount)}</p>
                    <p
                      className={`text-[10px] font-black uppercase ${
                        expense.status === 'APPROVED' ? 'text-emerald-600' : expense.status === 'REJECTED' ? 'text-red-500' : 'text-amber-600'
                      }`}
                    >
                      {expense.status}
                    </p>
                  </div>
                </div>

                {isOwner && (
                  <div className="flex justify-end gap-1.5 pt-1 border-t border-gray-100">
                    {expense.status !== 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => setStatus(expense, 'APPROVED')}
                        className="text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" aria-hidden /> Approve
                      </button>
                    )}
                    {expense.status !== 'REJECTED' && (
                      <button
                        type="button"
                        onClick={() => setStatus(expense, 'REJECTED')}
                        className="text-[10px] bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                      >
                        <X className="w-3 h-3" aria-hidden /> Reject
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => edit(expense)}
                      className="text-[10px] bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold px-2 py-1 rounded flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" aria-hidden /> Edit
                    </button>
                    {confirming === expense.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => remove(expense)}
                          className="text-[10px] bg-red-600 text-white font-bold px-2 py-1 rounded"
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="text-[10px] bg-gray-100 text-gray-700 font-bold px-2 py-1 rounded"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(expense.id!)}
                        aria-label={`Delete expense ${expense.id}`}
                        className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 font-bold px-2 py-1 rounded flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden />
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
  );
}
