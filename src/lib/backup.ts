import { db } from './db';
import { normalizeUsername } from './auth';
import { hashPassword } from './crypto';
import type { User, UserRole } from './db/types';

export const BACKUP_FORMAT = 'cheftech-pos-backup';
export const BACKUP_VERSION = 1;

const ROLES: UserRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];

interface LegacyStaff {
  username?: unknown;
  role?: unknown;
  active?: unknown;
}

export interface ParsedBackup {
  tables: Record<string, Record<string, unknown>[]>;
  /** Legacy rows keep the password in `password`; this app's own backups already hold `passwordHash`. */
  legacy: boolean;
  /** Staff profiles from cloud — they have no password stored anywhere the POS can read. */
  cloudStaff: LegacyStaff[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A file the owner picks is untrusted input: reject anything that is not a backup before touching the database. */
export function parseBackup(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    throw new Error('That file is not a ChefTech POS backup.');
  }
  if (Number(parsed.version) > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the POS.');
  }
  if (!isRecord(parsed.tables)) throw new Error('The backup file contains no tables.');

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(parsed.tables)) {
    if (!Array.isArray(rows)) continue;
    tables[name] = rows.filter(isRecord);
  }

  const rawCloudStaff = parsed.cloudStaff;
  const cloudStaff = Array.isArray(rawCloudStaff)
    ? rawCloudStaff.filter(isRecord)
    : [];

  return { tables, legacy: parsed.source === 'legacy', cloudStaff };
}

/**
 * Translates legacy passwords to PBKDF2-SHA256 (`pbkdf2:100000:...`).
 * Existing PBKDF2 or 64-char SHA-256 hex hashes are preserved.
 */
export async function translateLegacyPassword(raw: unknown): Promise<{
  passwordHash?: string;
  note: string;
}> {
  const value = typeof raw === 'string' ? raw : '';
  if (!value) return { note: 'no password on file' };
  if (/^\$2[aby]\$/.test(value)) return { note: 'bcrypt password — set a new one' };
  if (value.startsWith('pbkdf2:') || /^[0-9a-f]{64}$/i.test(value)) {
    return { passwordHash: value, note: 'password kept' };
  }
  return { passwordHash: await hashPassword(value), note: 'password kept' };
}

export interface ImportSummary {
  counts: Record<string, number>;
  skipped: string[];
  staff: { username: string; role: string; note: string }[];
}

/** Restores a backup in one transaction; existing rows with the same key are replaced. */
export async function importBackup(text: string, actor: string): Promise<ImportSummary> {
  const parsed = parseBackup(text);
  const known = new Set(db.tables.map((table) => table.name));
  // Never write a table this app does not declare, whatever the file claims.
  const names = Object.keys(parsed.tables).filter((name) => name !== 'users' && known.has(name));
  const skipped = Object.keys(parsed.tables).filter((name) => !known.has(name));

  const counts: Record<string, number> = {};
  const staff: ImportSummary['staff'] = [];

  const usersToWrite: Omit<User, 'id'>[] = [];
  for (const row of parsed.tables.users ?? []) {
    const username = normalizeUsername(String(row.username ?? ''));
    if (!username) continue;
    const role = ROLES.includes(row.role as UserRole) ? (row.role as UserRole) : 'WAITER';
    const { passwordHash, note } = parsed.legacy
      ? await translateLegacyPassword(row.password)
      : { passwordHash: typeof row.passwordHash === 'string' ? row.passwordHash : undefined, note: 'password kept' };
    usersToWrite.push({ username, role, active: row.active !== false, passwordHash });
    staff.push({ username, role, note });
  }
  for (const row of parsed.cloudStaff) {
    const username = normalizeUsername(String(row.username ?? ''));
    // A local account already covers this person; do not overwrite its password with nothing.
    if (!username || usersToWrite.some((user) => user.username === username)) continue;
    const role = ROLES.includes(row.role as UserRole) ? (row.role as UserRole) : 'WAITER';
    usersToWrite.push({ username, role, active: row.active !== false });
    staff.push({ username, role, note: 'Cloud account — set a password' });
  }

  const tables = [...names, 'users'].map((name) => db.table(name));
  await db.transaction('rw', tables, async () => {
    for (const name of names) {
      const rows = parsed.tables[name];
      if (!rows.length) continue;
      await db.table(name).bulkPut(rows);
      counts[name] = rows.length;
    }
    for (const user of usersToWrite) {
      const existing = await db.users.where('username').equals(user.username).first();
      if (existing?.id) {
        // Keep the current password when the backup cannot supply a usable one.
        const patch = { role: user.role, active: user.active };
        await db.users.update(existing.id, user.passwordHash ? { ...patch, passwordHash: user.passwordHash } : patch);
        const note = user.passwordHash ? 'password kept' : 'password unchanged';
        if (!user.passwordHash) staff.find((s) => s.username === user.username)!.note = note;
      } else {
        await db.users.add(user);
      }
    }
    counts.users = usersToWrite.length;
  });

  await db.auditLogs.add({
    timestamp: new Date().toISOString(),
    action: 'DATA_IMPORTED',
    details: `Imported ${parsed.legacy ? 'legacy' : 'POS'} backup (${Object.entries(counts).map(([table, count]) => `${table}: ${count}`).join(', ')})`,
    user: actor,
  });

  return { counts, skipped, staff };
}

/** Full dump of this app's own database, for safekeeping before a risky change. */
export async function collectBackup(): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const table of db.tables) tables[table.name] = await table.toArray();
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), source: 'modern', tables },
    null,
    2,
  );
}
