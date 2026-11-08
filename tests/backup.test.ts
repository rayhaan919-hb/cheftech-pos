import { describe, it, expect } from 'vitest';
import { parseBackup, translateLegacyPassword, BACKUP_FORMAT } from '../src/lib/backup';

const backup = (tables: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: BACKUP_FORMAT, version: 1, tables, ...extra });

describe('parseBackup', () => {
  it('rejects anything that is not a POS backup', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{}')).toThrow(/not a ChefTech POS backup/);
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, tables: {} })))
      .toThrow(/newer version/);
  });

  it('keeps only real rows and drops non-array tables', () => {
    const parsed = parseBackup(backup({ menu: [{ id: 'm1' }, null, 'x'], sales: 'nope' }));
    expect(parsed.tables.menu).toEqual([{ id: 'm1' }]);
    expect(parsed.tables.sales).toBeUndefined();
  });

  it('tells a legacy export apart from this app’s own backup', () => {
    expect(parseBackup(backup({}, { source: 'legacy' })).legacy).toBe(true);
    // This app stores hashes directly, so its rows must not be run through the plaintext hash again.
    expect(parseBackup(backup({}, { source: 'modern' })).legacy).toBe(false);
  });

  it('reads cloud staff profiles when present', () => {
    const parsed = parseBackup(backup({}, { cloudStaff: [{ username: 'ali', role: 'CASHIER' }, 3] }));
    expect(parsed.cloudStaff).toEqual([{ username: 'ali', role: 'CASHIER' }]);
  });
});

describe('translateLegacyPassword', () => {
  it('hashes plaintext with PBKDF2 so the legacy account can sign in securely', async () => {
    const result = await translateLegacyPassword('shopPass88!');
    expect(result.passwordHash).toMatch(/^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(result.note).toBe('password kept');
  });

  it('keeps an already-hashed password as-is', async () => {
    const hash = 'a'.repeat(64);
    expect((await translateLegacyPassword(hash)).passwordHash).toBe(hash);
  });

  it('flags bcrypt instead of pretending it can verify it', async () => {
    const result = await translateLegacyPassword('$2b$10$abcdefghijklmnopqrstuv');
    expect(result.passwordHash).toBeUndefined();
    expect(result.note).toMatch(/bcrypt/);
  });

  it('handles a missing password', async () => {
    expect((await translateLegacyPassword(undefined)).note).toBe('no password on file');
  });
});
