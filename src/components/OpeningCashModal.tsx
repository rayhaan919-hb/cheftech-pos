import { useEffect, useState } from 'react';
import { getOpeningCash, setOpeningCash } from '../lib/shift';
import { logAudit } from '../lib/audit';
import { formatAmount } from '../lib/format';
import { Modal } from './Modal';

export function OpeningCashModal({ username, onClose, notify }: {
  username: string;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getOpeningCash().then((value) => {
      setAmount(String(value));
      setLoaded(true);
    });
  }, []);

  async function save() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      notify('Enter a valid non-negative opening cash amount.');
      return;
    }
    const saved = await setOpeningCash(value);
    await logAudit('OPENING_CASH_SET', `Opening cash set to ${saved}`, username);
    notify(`Opening cash set to ${formatAmount(saved)}.`);
    onClose();
  }

  return (
    <Modal title="Opening Cash" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500">
          Cash counted into the drawer at the start of this shift. It is added to the expected drawer
          total in the shift summary.
        </p>
        <label className="block">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Amount in drawer</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            disabled={!loaded}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
            aria-label="Opening cash amount"
            className="w-full p-3 text-lg font-black tabular-nums ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!loaded} className="px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
            Save Opening Cash
          </button>
        </div>
      </div>
    </Modal>
  );
}
