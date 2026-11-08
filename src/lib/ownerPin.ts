import { db } from './db';
import { hashPassword, sha256, verifyPassword } from './crypto';
import { logAudit } from './audit';

const PIN_KEY = 'ownerPin';
const LOCK_KEY = 'ownerPinLock';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

interface PinRecord {
  hash: string;
  salt?: string;
  updatedAt: string;
}

interface LockState {
  attempts: number;
  lockedUntil: number;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(String(pin || '').trim());
}

export async function hasOwnerPin(): Promise<boolean> {
  const row = await db.settings.get(PIN_KEY);
  const val = row?.value as PinRecord | string | undefined;
  if (!val) return false;
  if (typeof val === 'string') return val.length > 0;
  return Boolean(val.hash);
}

export async function setOwnerPin(pin: string, actor = 'OWNER'): Promise<void> {
  const clean = String(pin || '').trim();
  if (!isValidPin(clean)) {
    throw new Error('Owner PIN must be 4 to 8 digits.');
  }
  const hash = await hashPassword(clean);
  const record: PinRecord = {
    hash,
    updatedAt: new Date().toISOString(),
  };
  await db.settings.put({ key: PIN_KEY, value: record });
  await db.settings.delete(LOCK_KEY);
  await logAudit('OWNER_PIN_SET', 'Owner PIN configured/updated', actor);
}

export async function clearOwnerPin(actor = 'OWNER'): Promise<void> {
  await db.settings.delete(PIN_KEY);
  await db.settings.delete(LOCK_KEY);
  await logAudit('OWNER_PIN_CLEARED', 'Owner PIN cleared', actor);
}

async function getLockState(): Promise<LockState> {
  const row = await db.settings.get(LOCK_KEY);
  const val = row?.value as Partial<LockState> | undefined;
  return {
    attempts: Number(val?.attempts || 0),
    lockedUntil: Number(val?.lockedUntil || 0),
  };
}

export async function verifyOwnerPin(pin: string): Promise<boolean> {
  const lock = await getLockState();
  const now = Date.now();
  if (lock.lockedUntil > now) {
    const mins = Math.ceil((lock.lockedUntil - now) / 60_000);
    throw new Error(`Too many failed PIN attempts. Try again in ${mins} min.`);
  }

  const row = await db.settings.get(PIN_KEY);
  const rawVal = row?.value as PinRecord | string | undefined;
  if (!rawVal) {
    throw new Error('Owner PIN is not configured yet.');
  }

  const clean = String(pin || '').trim();
  let matched = false;

  if (typeof rawVal === 'string') {
    const res = await verifyPassword(clean, rawVal);
    matched = res.valid;
    if (matched && res.needsRehash) {
      await setOwnerPin(clean);
    }
  } else if (rawVal.hash) {
    if (rawVal.hash.startsWith('pbkdf2:')) {
      const res = await verifyPassword(clean, rawVal.hash);
      matched = res.valid;
    } else if (rawVal.salt) {
      const candidate = await sha256(`${rawVal.salt}:${clean}`);
      matched = candidate === rawVal.hash;
      if (matched) {
        await setOwnerPin(clean);
      }
    }
  }

  if (matched) {
    await db.settings.delete(LOCK_KEY);
    return true;
  }

  const attempts = lock.attempts + 1;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? now + LOCK_MS : 0;
  await db.settings.put({
    key: LOCK_KEY,
    value: { attempts: lockedUntil ? 0 : attempts, lockedUntil },
  });
  await logAudit('OWNER_PIN_FAILED', `Failed Owner PIN attempt (${attempts}/${MAX_ATTEMPTS})`, 'OWNER');

  if (lockedUntil) {
    const mins = Math.ceil(LOCK_MS / 60_000);
    throw new Error(`Too many failed PIN attempts. Locked for ${mins} minutes.`);
  }

  return false;
}
