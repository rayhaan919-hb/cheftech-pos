import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { hasOwnerPin, isValidPin, setOwnerPin, verifyOwnerPin } from '../lib/ownerPin';
import { readSession } from '../lib/auth';

/** Gate for actions a Manager is not allowed to take unaided (delete/edit/refund sales). */
export function OwnerPinModal({ action, onClose, onAuthorized }: {
  action: string;
  onClose: () => void;
  onAuthorized: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinExists, setPinExists] = useState<boolean | null>(null);
  const isOwner = readSession()?.role === 'OWNER';

  useEffect(() => {
    void hasOwnerPin().then(setPinExists);
  }, []);

  async function submit() {
    setBusy(true);
    try {
      if (!pinExists) {
        if (!isOwner) return setError('The Owner must create an owner PIN first.');
        if (!isValidPin(pin.trim())) return setError('PIN must be 4–8 digits.');
        await setOwnerPin(pin);
        onAuthorized();
      } else if (await verifyOwnerPin(pin)) onAuthorized();
      else setError('Incorrect owner PIN.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify PIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Owner Authorization"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || pinExists === null || !pin.trim()}
            className="flex-1 py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Authorize
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-600 mb-4">{pinExists === false ? 'No owner PIN is set yet. The Owner creates one now (4–8 digits).' : action}</p>
      <label htmlFor="ownerPin" className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
        {pinExists === false ? 'Create owner PIN' : 'Enter owner PIN'}
      </label>
      <input
        id="ownerPin"
        type="password"
        inputMode="numeric"
        autoFocus
        value={pin}
        onChange={(e) => {
          setPin(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-full p-3 text-center tracking-[0.4em] font-black text-lg ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {error && (
        <p role="alert" className="mt-2 text-xs font-bold text-red-600">
          {error}
        </p>
      )}
    </Modal>
  );
}
