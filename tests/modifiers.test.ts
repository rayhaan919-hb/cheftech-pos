import { describe, it, expect } from 'vitest';
import { composeModifiedItem } from '../src/lib/cart';
import { normalizePhone } from '../src/lib/customers';
import type { MenuItem } from '../src/lib/db/types';

const zinger: MenuItem = { id: 'm1', categoryId: 'cat_burgers', name: 'Zinger Burger', price: 650 };

describe('composeModifiedItem', () => {
  it('adds option prices to the base price', () => {
    const line = composeModifiedItem(zinger, [
      { group: 'Size', name: 'Large', price: 200 },
      { group: 'Extras', name: 'Cheese', price: 80 },
    ]);
    expect(line.price).toBe(930);
    expect(line.name).toBe('Zinger Burger (Large, Cheese)');
    expect(line.qty).toBe(1);
  });

  it('keys the same combination identically regardless of pick order', () => {
    const a = composeModifiedItem(zinger, [
      { group: 'Size', name: 'Large', price: 200 },
      { group: 'Extras', name: 'Cheese', price: 80 },
    ]);
    const b = composeModifiedItem(zinger, [
      { group: 'Extras', name: 'Cheese', price: 80 },
      { group: 'Size', name: 'Large', price: 200 },
    ]);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe('m1::Extras:Cheese|Size:Large');
  });

  it('keeps different combinations as separate cart lines', () => {
    const large = composeModifiedItem(zinger, [{ group: 'Size', name: 'Large', price: 200 }]);
    const regular = composeModifiedItem(zinger, [{ group: 'Size', name: 'Regular', price: 0 }]);
    expect(large.id).not.toBe(regular.id);
  });

  it('falls back to the plain id when nothing is selected', () => {
    expect(composeModifiedItem(zinger, [])).toMatchObject({ id: 'm1', name: 'Zinger Burger', price: 650 });
  });
});

describe('normalizePhone', () => {
  it('accepts 5–15 digits and rejects anything else', () => {
    expect(normalizePhone('03001234567')).toBe('03001234567');
    expect(normalizePhone(' 03001234567 ')).toBe('03001234567');
    expect(normalizePhone('1234')).toBe('');
    expect(normalizePhone('0300-1234567')).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});
