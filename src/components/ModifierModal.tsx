import { useState } from 'react';
import { Modal } from './Modal';
import { composeModifiedItem } from '../lib/cart';
import { formatAmount } from '../lib/format';
import type { CartItem, MenuItem, ModifierSelection } from '../lib/db/types';

export function ModifierModal({ item, onCancel, onAdd, notify }: {
  item: MenuItem;
  onCancel: () => void;
  onAdd: (cartItem: CartItem) => void;
  notify: (message: string) => void;
}) {
  const groups = item.modifierGroups ?? [];
  const [picked, setPicked] = useState<Record<string, number[]>>({});

  function toggle(groupId: string, index: number, multiple: boolean) {
    setPicked((current) => {
      const existing = current[groupId] ?? [];
      const next = multiple
        ? existing.includes(index)
          ? existing.filter((i) => i !== index)
          : [...existing, index]
        : [index];
      return { ...current, [groupId]: next };
    });
  }

  const selections: ModifierSelection[] = groups.flatMap((group) =>
    (picked[group.id] ?? []).map((index) => {
      const option = group.options[index];
      return { group: group.name, name: option.name, price: Number(option.price) || 0 };
    }),
  );

  const total = composeModifiedItem(item, selections).price;

  function confirm() {
    const missing = groups.find((g) => g.required && !(picked[g.id] ?? []).length);
    if (missing) {
      notify(`Please select an option for "${missing.name}".`);
      return;
    }

    onAdd(composeModifiedItem(item, selections));
  }

  return (
    <Modal
      title={`Customize: ${item.name}`}
      onClose={onCancel}
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
            Cancel
          </button>
          <button type="button" onClick={confirm} className="flex-1 py-3 rounded-xl font-bold bg-emerald-500 text-white hover:bg-emerald-600">
            Add — {formatAmount(total)}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {groups.map((group) => (
          <fieldset key={group.id} className="space-y-1.5">
            <legend className="text-xs font-bold text-gray-700 mb-1">
              {group.name} {group.required && <span className="text-red-500">*</span>}
            </legend>
            {group.options.map((option, index) => {
              const checked = (picked[group.id] ?? []).includes(index);
              return (
                <label
                  key={option.name}
                  className="flex items-center justify-between gap-2 p-2 border border-gray-200 rounded-lg text-xs bg-gray-50 cursor-pointer hover:bg-white"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type={group.multiple ? 'checkbox' : 'radio'}
                      name={`modgroup_${group.id}`}
                      checked={checked}
                      onChange={() => toggle(group.id, index, !!group.multiple)}
                      className="accent-indigo-600"
                    />
                    {option.name}
                  </span>
                  <span className={`font-bold ${option.price >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {option.price >= 0 ? '+' : ''}
                    {formatAmount(option.price)}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
