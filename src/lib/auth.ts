import { db } from './db';
import type { User, UserRole } from './db/types';
import { hashPassword, hmacSign, verifyPassword } from './crypto';
import {
  authBaseUrl,
  getSyncConfig,
  isConfigured,
  loadConfig,
  restBaseUrl,
  supabaseHeaders,
} from './config';
import { setOwnerPin } from './ownerPin';
import { logAudit } from './audit';
import { forgetToken, rememberToken, getAccessToken } from './sync';

export interface SessionUser {
  username: string;
  role: UserRole;
  name?: string;
  email?: string;
  uid?: string;
  sig?: string;
  issuedAt?: number;
}

interface LoginLockState {
  attempts: number;
  lockedUntil: number;
}

const SESSION_KEY = 'loggedUser';
const LOGIN_LOCK_KEY = 'loginLock';
const SESSION_SECRET_KEY = 'sessionHmacSecret';
const ACTIVE_SESSION_KEY = 'activeSessionRecord';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

export function normalizeUsername(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

export function staffUsernameToEmail(username: string): string {
  const clean = normalizeUsername(username);
  if (clean.includes('@')) return clean;
  return `${clean.replace(/[^a-z0-9._-]/g, '')}@cheftech-pos.local`;
}

async function getOrCreateSessionSecret(): Promise<string> {
  const row = await db.settings.get(SESSION_SECRET_KEY);
  if (row?.value && typeof row.value === 'string' && row.value.length >= 32) {
    return row.value;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await db.settings.put({ key: SESSION_SECRET_KEY, value: secret });
  return secret;
}

async function signSessionPayload(user: {
  username: string;
  role: UserRole;
  issuedAt: number;
}): Promise<string> {
  const secret = await getOrCreateSessionSecret();
  return hmacSign(secret, `${user.username}|${user.role}|${user.issuedAt}`);
}

export function readSession(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed?.username || !parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const getCurrentUser = readSession;

export function setCurrentUser(user: SessionUser | null): void {
  try {
    if (!user) {
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    }
  } catch {
    // ignore storage errors
  }
}

async function persistVerifiedSession(user: SessionUser): Promise<SessionUser> {
  const issuedAt = Date.now();
  const sig = await signSessionPayload({
    username: user.username,
    role: user.role,
    issuedAt,
  });
  const signedUser: SessionUser = { ...user, issuedAt, sig };
  await db.settings.put({ key: ACTIVE_SESSION_KEY, value: signedUser });
  setCurrentUser(signedUser);
  return signedUser;
}

async function findLocalUser(username: string): Promise<User | undefined> {
  const clean = normalizeUsername(username);
  const all = await db.users.toArray();
  return all.find((u) => normalizeUsername(u.username) === clean);
}

async function upsertLocalUser(record: {
  username: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
}): Promise<User> {
  const existing = await findLocalUser(record.username);
  if (existing?.id !== undefined) {
    await db.users.update(existing.id, {
      username: record.username,
      passwordHash: record.passwordHash,
      role: record.role,
      active: record.active,
    });
    return { ...existing, ...record };
  }
  const id = await db.users.add({
    username: record.username,
    passwordHash: record.passwordHash,
    role: record.role,
    active: record.active,
  });
  return { id, ...record };
}

/**
 * S-07: Re-validates the active session against HMAC signature, local Dexie DB,
 * and (when online & configured) Supabase Auth + profiles table.
 * Rejects any DevTools sessionStorage role/username tampering.
 */
export async function revalidateSession(): Promise<SessionUser | null> {
  const sessionUser = readSession();
  if (!sessionUser) return null;

  try {
    const storedRecordRow = await db.settings.get(ACTIVE_SESSION_KEY);
    const storedRecord = storedRecordRow?.value as SessionUser | undefined;

    if (!storedRecord || !sessionUser.sig || !sessionUser.issuedAt) {
      signOut();
      return null;
    }

    const expectedSig = await signSessionPayload({
      username: sessionUser.username,
      role: sessionUser.role,
      issuedAt: sessionUser.issuedAt,
    });

    if (
      expectedSig !== sessionUser.sig ||
      storedRecord.sig !== sessionUser.sig ||
      storedRecord.role !== sessionUser.role ||
      storedRecord.username !== sessionUser.username
    ) {
      await logAudit(
        'SECURITY_SESSION_TAMPERED',
        `Detected tampered sessionStorage for user "${sessionUser.username}"`,
        sessionUser.username
      );
      signOut();
      return null;
    }

    const localUser = await findLocalUser(sessionUser.username);
    if (!localUser || localUser.active === false) {
      signOut();
      return null;
    }

    if (localUser.role !== sessionUser.role) {
      return await persistVerifiedSession({
        ...sessionUser,
        role: localUser.role,
      });
    }

    const cfg = getSyncConfig();
    const token = await getAccessToken();
    if (isConfigured(cfg) && token && sessionUser.uid && navigator.onLine) {
      try {
        const res = await fetch(
          `${restBaseUrl(cfg)}/profiles?id=eq.${encodeURIComponent(sessionUser.uid)}&select=role,active,name,username`,
          { headers: supabaseHeaders(cfg, token) }
        );
        if (res.ok) {
          const rows = (await res.json()) as Array<{
            role: UserRole;
            active: boolean;
            name: string;
            username?: string;
          }>;
          const profile = rows[0];
          if (profile) {
            if (!profile.active || !['OWNER', 'MANAGER', 'CASHIER', 'WAITER'].includes(profile.role)) {
              signOut();
              return null;
            }
            if (profile.role !== sessionUser.role && localUser.id !== undefined) {
              await db.users.update(localUser.id, { role: profile.role });
              return await persistVerifiedSession({
                ...sessionUser,
                role: profile.role,
                name: profile.name || sessionUser.name,
              });
            }
          }
        }
      } catch {
        // Network error — allow verified local session to continue
      }
    }

    return sessionUser;
  } catch {
    signOut();
    return null;
  }
}

/**
 * H-01: Initializes configuration without seeding any default '1234' passwords.
 */
export async function initializeApp(): Promise<void> {
  await loadConfig();
}

export async function needsFirstRunSetup(): Promise<boolean> {
  const count = await db.users.count();
  return count === 0;
}

/**
 * H-01: First-run Owner Setup Wizard completion.
 * Creates the initial OWNER account with PBKDF2-hashed password + Owner PIN.
 */
export async function completeFirstRunOwnerSetup(input: {
  username: string;
  name: string;
  email?: string;
  password: string;
  pin: string;
}): Promise<User> {
  const existingCount = await db.users.count();
  if (existingCount > 0) {
    throw new Error('Initial setup has already been completed.');
  }

  const username = normalizeUsername(input.username);
  const name = input.name.trim();
  const password = input.password;
  const pin = input.pin.trim();

  if (!username || username.length < 3) {
    throw new Error('Username must be at least 3 characters.');
  }
  if (!name) {
    throw new Error('Owner display name is required.');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('Owner PIN must be 4 to 8 digits.');
  }

  const email = input.email?.trim().toLowerCase() || staffUsernameToEmail(username);
  const passwordHash = await hashPassword(password);
  let uid: string | undefined;

  const cfg = await loadConfig();
  if (cfg && isConfigured(cfg) && navigator.onLine) {
    try {
      const signUpRes = await fetch(`${authBaseUrl(cfg)}/signup`, {
        method: 'POST',
        headers: supabaseHeaders(cfg),
        body: JSON.stringify({
          email,
          password,
          data: { role: 'OWNER', username, name },
        }),
      });
      if (signUpRes.ok) {
        const data = await signUpRes.json();
        uid = data.user?.id || data.id;
        if (data.access_token && data.refresh_token) {
          rememberToken(data.access_token, data.refresh_token, Number(data.expires_in || 3600));
        }
        // P0: bootstrap_initial_owner() is strictly restricted to trusted administrative processes
        // (service_role or Supabase SQL Editor). Normal authenticated signups cannot elevate themselves.
      }
    } catch {
      // Cloud signup is optional during offline local setup
    }
  }

  const savedUser = await upsertLocalUser({
    username,
    passwordHash,
    role: 'OWNER',
    active: true,
  });

  await setOwnerPin(pin, username);
  await logAudit('FIRST_RUN_SETUP', `Initial OWNER account "${username}" created`, username);

  await persistVerifiedSession({
    username,
    role: 'OWNER',
    name,
    email,
    uid,
  });

  return savedUser;
}

/**
 * L-04: Explicit one-click Demo Mode seeder for CodeCanyon buyers testing the app.
 */
export async function seedDemoEnvironment(): Promise<{
  user: User;
  demoPassword: string;
  demoPin: string;
}> {
  const existingCount = await db.users.count();
  if (existingCount > 0) {
    throw new Error('Cannot seed demo environment when accounts already exist.');
  }

  const randomSuffix = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const demoPassword = `Demo#${randomSuffix}9!`;
  const demoPin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)).slice(0, 4);
  const passwordHash = await hashPassword(demoPassword);

  const owner = await upsertLocalUser({
    username: 'owner',
    passwordHash,
    role: 'OWNER',
    active: true,
  });
  await upsertLocalUser({
    username: 'cashier',
    passwordHash,
    role: 'CASHIER',
    active: true,
  });
  await upsertLocalUser({
    username: 'waiter',
    passwordHash,
    role: 'WAITER',
    active: true,
  });

  await setOwnerPin(demoPin, 'owner');
  await db.settings.put({ key: 'demoMode', value: true });
  await logAudit('DEMO_SEEDED', 'Demo mode accounts initialized', 'owner');

  await persistVerifiedSession({
    username: 'owner',
    role: 'OWNER',
    name: 'Demo Owner',
  });

  return { user: owner, demoPassword, demoPin };
}

async function getLoginLockState(): Promise<LoginLockState> {
  const row = await db.settings.get(LOGIN_LOCK_KEY);
  const val = row?.value as Partial<LoginLockState> | undefined;
  return {
    attempts: Number(val?.attempts || 0),
    lockedUntil: Number(val?.lockedUntil || 0),
  };
}

async function recordFailedLogin(attemptedUser: string): Promise<never> {
  const lock = await getLoginLockState();
  const now = Date.now();
  const attempts = lock.attempts + 1;
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCK_MS : 0;

  await db.settings.put({
    key: LOGIN_LOCK_KEY,
    value: {
      attempts: lockedUntil ? 0 : attempts,
      lockedUntil,
    },
  });

  await logAudit(
    'LOGIN_FAILED',
    `Failed login attempt (${attempts}/${MAX_LOGIN_ATTEMPTS})`,
    attemptedUser || 'unknown'
  );

  if (lockedUntil) {
    const mins = Math.ceil(LOGIN_LOCK_MS / 60_000);
    throw new Error(`Too many login attempts. Try again in ${mins} min.`);
  }

  throw new Error('Invalid username or password.');
}

async function clearLoginLock(): Promise<void> {
  await db.settings.delete(LOGIN_LOCK_KEY);
}

/**
 * Signs in a staff member via Supabase Auth (when configured & online)
 * or local PBKDF2-verified Dexie database (offline-first fallback).
 * Enforces H-04 5-attempt / 5-minute lockout and H-02 PBKDF2 auto-upgrade.
 */
export async function signIn(usernameInput: string, password: string): Promise<User> {
  const rawUser = normalizeUsername(usernameInput);
  if (!rawUser || !password) {
    throw new Error('Username and password are required.');
  }

  // H-04: Check login lockout before attempting authentication
  const lock = await getLoginLockState();
  const now = Date.now();
  if (lock.lockedUntil > now) {
    const mins = Math.ceil((lock.lockedUntil - now) / 60_000);
    throw new Error(`Too many login attempts. Try again in ${mins} min.`);
  }

  const cfg = await loadConfig();
  const email = rawUser.includes('@') ? rawUser : staffUsernameToEmail(rawUser);
  const usernameKey = rawUser.includes('@') ? rawUser.split('@')[0] : rawUser;

  // 1. Try Supabase Auth if configured & online
  if (cfg && isConfigured(cfg) && navigator.onLine) {
    try {
      const res = await fetch(`${authBaseUrl(cfg)}/token?grant_type=password`, {
        method: 'POST',
        headers: supabaseHeaders(cfg),
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        const data = await res.json();
        const accessToken: string = data.access_token;
        const refreshToken: string = data.refresh_token;
        const uid: string = data.user?.id;

        const profRes = await fetch(
          `${restBaseUrl(cfg)}/profiles?id=eq.${encodeURIComponent(uid)}&select=id,username,name,email,role,active`,
          { headers: supabaseHeaders(cfg, accessToken) }
        );

        if (profRes.ok) {
          const profiles = await profRes.json();
          const profile = profiles[0];

          if (profile && profile.active === false) {
            throw new Error('This staff account has been deactivated.');
          }

          const resolvedRole: UserRole =
            profile?.role && ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'].includes(profile.role)
              ? profile.role
              : 'CASHIER';
          const resolvedUsername = normalizeUsername(profile?.username || usernameKey);
          const resolvedName = String(profile?.name || resolvedUsername);

          rememberToken(accessToken, refreshToken, Number(data.expires_in || 3600));

          const pbkdf2Hash = await hashPassword(password);
          const savedUser = await upsertLocalUser({
            username: resolvedUsername,
            passwordHash: pbkdf2Hash,
            role: resolvedRole,
            active: true,
          });

          await clearLoginLock();
          await logAudit('LOGIN', `${resolvedName} (${resolvedRole}) signed in via Supabase Cloud`, resolvedUsername);

          await persistVerifiedSession({
            username: resolvedUsername,
            role: resolvedRole,
            name: resolvedName,
            email,
            uid,
          });

          return savedUser;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('deactivated')) {
        throw err;
      }
      // Fall through to local offline verification if network failed
    }
  }

  // 2. Local Dexie database authentication (PBKDF2 + legacy SHA-256 auto-upgrade)
  const localUser = await findLocalUser(usernameKey);
  if (!localUser || !localUser.passwordHash) {
    return recordFailedLogin(usernameKey);
  }

  if (localUser.active === false) {
    throw new Error('This staff account has been deactivated.');
  }

  const { valid, needsRehash } = await verifyPassword(password, localUser.passwordHash);
  if (!valid) {
    return recordFailedLogin(usernameKey);
  }

  if (needsRehash && localUser.id !== undefined) {
    const upgradedHash = await hashPassword(password);
    await db.users.update(localUser.id, { passwordHash: upgradedHash });
  }

  await clearLoginLock();
  await logAudit('LOGIN', `${localUser.username} (${localUser.role}) signed in locally`, localUser.username);

  await persistVerifiedSession({
    username: localUser.username,
    role: localUser.role,
  });

  return localUser;
}

/**
 * H-01: Allows any signed-in user to change their password (verifies current password first).
 */
export async function changeUserPassword(
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters long.');
  }

  const user = await findLocalUser(username);
  if (!user || !user.passwordHash || user.id === undefined) {
    throw new Error('User account not found.');
  }

  const { valid } = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new Error('Current password is incorrect.');
  }

  const newHash = await hashPassword(newPassword);
  await db.users.update(user.id, { passwordHash: newHash });

  const cfg = getSyncConfig();
  const token = await getAccessToken();
  if (isConfigured(cfg) && token && navigator.onLine) {
    try {
      await fetch(`${authBaseUrl(cfg)}/user`, {
        method: 'PUT',
        headers: supabaseHeaders(cfg, token),
        body: JSON.stringify({ password: newPassword }),
      });
    } catch {
      // ignore offline error
    }
  }

  await logAudit('PASSWORD_CHANGED', `Password updated for "${user.username}"`, user.username);
}

export function signOut(): void {
  const current = readSession();
  forgetToken();
  setCurrentUser(null);
  void db.settings.delete(ACTIVE_SESSION_KEY);
  if (current) {
    void logAudit('LOGOUT', `${current.username} signed out`, current.username);
  }
}
