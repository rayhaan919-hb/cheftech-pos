import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount, currencySymbol } from '../lib/format';
import { logAudit } from '../lib/audit';
import type { LoyaltyReward } from '../lib/db/types';

export function LoyaltyRewardsSection({ username, notify }: {
  username: string;
  notify: (message: string) => void;
}) {
  const rewards = useLive(() => db.loyaltyRewards.toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointsRequired, setPointsRequired] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editingId === null) {
      setName('');
      setDescription('');
      setPointsRequired('');
      setDiscountType('amount');
      setDiscountValue('');
    }
  }, [editingId]);

  async function save() {
    const points = Math.max(1, parseInt(pointsRequired) || 0);
    const discount = parseFloat(discountValue) || 0;
    if (!name.trim()) {
      notify('Enter a reward name.');
      return;
    }
    if (points < 1) {
      notify('Points required must be at least 1.');
      return;
    }

    setBusy(true);
    try {
      if (editingId !== null) {
        await db.loyaltyRewards.update(editingId, {
          name: name.trim(),
          description: description.trim(),
          pointsRequired: points,
          discountAmount: discountType === 'amount' ? discount : undefined,
          discountPercent: discountType === 'percent' ? discount : undefined,
          updatedAt: new Date().toISOString(),
        });
        await logAudit('LOYALTY_REWARD_UPDATED', `Updated "${name.trim()}"`, username);
        notify(`Reward "${name.trim()}" updated.`);
      } else {
        await db.loyaltyRewards.add({
          name: name.trim(),
          description: description.trim(),
          pointsRequired: points,
          discountAmount: discountType === 'amount' ? discount : undefined,
          discountPercent: discountType === 'percent' ? discount : undefined,
          active: true,
        });
        await logAudit('LOYALTY_REWARD_CREATED', `Created "${name.trim()}" (${points} pts)`, username);
        notify(`Reward "${name.trim()}" created.`);
      }
      setEditingId(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(reward: LoyaltyReward) {
    if (reward.id === undefined) return;
    await db.loyaltyRewards.update(reward.id, { active: !reward.active });
    await logAudit(
      reward.active ? 'LOYALTY_REWARD_DISABLED' : 'LOYALTY_REWARD_ENABLED',
      `${reward.active ? 'Disabled' : 'Enabled'} "${reward.name}"`,
      username,
    );
    notify(`${reward.name} ${reward.active ? 'disabled' : 'enabled'}.`);
  }

  async function remove(reward: LoyaltyReward) {
    if (!confirm(`Delete "${reward.name}"? This cannot be undone.`)) return;
    if (reward.id === undefined) return;
    await db.loyaltyRewards.delete(reward.id);
    await logAudit('LOYALTY_REWARD_DELETED', `Deleted "${reward.name}"`, username);
    notify(`"${reward.name}" deleted.`);
    if (editingId === reward.id) setEditingId(null);
  }

  const editing = editingId !== null ? rewards.find((r) => r.id === editingId) : null;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-black uppercase tracking-wider text-gray-700">Loyalty Rewards</h4>
      <p className="text-[11px] text-gray-500">
        Define redeemable rewards. Staff select one at checkout when the customer has enough points.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Reward name (e.g. Free Dessert)"
            value={editingId === null ? name : (editing?.name ?? '')}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2.5 text-sm border-0 ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-h-11"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={editingId === null ? description : (editing?.description ?? '')}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2.5 text-sm border-0 ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-h-11"
          />
          <input
            type="number"
            min={1}
            placeholder="Points required"
            value={editingId === null ? pointsRequired : (editing?.pointsRequired ?? '')}
            onChange={(e) => setPointsRequired(e.target.value)}
            className="w-32 p-2.5 text-sm border-0 ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-h-11"
          />

          <div className="flex gap-2 items-center">
            <select
              value={editingId === null ? discountType : (editing?.discountAmount !== undefined ? 'amount' : 'percent')}
              onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
              className="px-2 py-1.5 text-xs border-0 ring-1 ring-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-11"
            >
              <option value="amount">{currencySymbol()} off</option>
              <option value="percent">% off</option>
            </select>
            <input
              type="number"
              min={0}
              step={discountType === 'percent' ? 1 : 0.01}
              placeholder="Value"
              value={editingId === null ? discountValue : (editing ? (discountType === 'amount' ? (editing.discountAmount ?? '') : (editing.discountPercent ?? '')) : '')}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="w-24 p-2.5 text-sm border-0 ring-1 ring-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-h-11"
            />
          </div>
        </div>

        <div className="flex flex-col justify-end">
          {editingId !== null && (
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-xs font-bold text-gray-600 hover:text-gray-800 mb-2 min-h-11 px-2"
            >
              Cancel edit
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm min-h-11 disabled:opacity-60"
          >
            {busy ? 'Saving…' : editingId !== null ? 'Update reward' : 'Add reward'}
          </button>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-gray-100">
        {rewards.length === 0 ? (
          <p className="text-xs text-gray-400">No rewards defined yet. Add one above.</p>
        ) : (
          rewards.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-black px-1.5 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                    {r.active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-sm font-bold text-gray-800 truncate">{r.name}</span>
                  <span className="text-xs text-gray-500 shrink-0">({r.pointsRequired} pts)</span>
                </div>
                {r.description && <p className="text-[11px] text-gray-500 mt-0.5">{r.description}</p>}
                <div className="text-xs text-gray-600 mt-1">
                  Reward: {r.discountAmount ? formatAmount(r.discountAmount) + ' off' : r.discountPercent + '% off'}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => r.id !== undefined && setEditingId(r.id)}
                  className="text-xs px-2 py-1.5 text-purple-700 hover:bg-purple-50 rounded-lg min-h-11"
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(r)}
                  className="text-xs px-2 py-1.5 text-gray-700 hover:bg-gray-100 rounded-lg min-h-11"
                >
                  {r.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  className="text-xs px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-lg min-h-11"
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
