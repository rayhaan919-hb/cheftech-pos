import { db } from './db';
import {
  authBaseUrl,
  configManager,
  isConfigured,
  restBaseUrl,
  supabaseHeaders,
} from './config';
import { normalizeUsername, staffUsernameToEmail, completeFirstRunOwnerSetup } from './auth';
import { hashPassword } from './crypto';
import { getAccessToken, rememberToken } from './sync';
import type { UserRole } from './db/types';

const USERNAME_RE = /^[a-z0-9._-]+$/;

export interface StaffAccount {
  uid: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export async function cloudSessionAvailable(): Promise<boolean> {
  // Staff accounts can be managed locally (offline-first) or synced with Supabase when online
  return true;
}

export async function listStaffAccounts(): Promise<StaffAccount[]> {
  const localUsers = await db.users.toArray();
  const byUsername = new Map<string, StaffAccount>();

  for (const u of localUsers) {
    const clean = normalizeUsername(u.username);
    byUsername.set(clean, {
      uid: String(u.id ?? clean),
      username: clean,
      displayName: clean,
      role: u.role,
      active: u.active !== false,
    });
  }

  const config = await configManager.getConfig();
  const token = await getAccessToken();
  if (config && isConfigured(config) && token && navigator.onLine) {
    try {
      const res = await fetch(
        `${restBaseUrl(config)}/profiles?role=in.(OWNER,MANAGER,CASHIER,WAITER)&select=id,username,name,role,active`,
        {
          headers: supabaseHeaders(config, token),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          id: string;
          username?: string;
          name?: string;
          role: UserRole;
          active: boolean;
        }>;
        for (const row of rows) {
          const uname = normalizeUsername(row.username || row.name || row.id);
          if (!uname) continue;
          byUsername.set(uname, {
            uid: row.id,
            username: uname,
            displayName: row.name || uname,
            role: row.role,
            active: row.active !== false,
          });
        }
      }
    } catch {
      // Offline fallback uses local Dexie users
    }
  }

  return Array.from(byUsername.values()).sort((a, b) => a.username.localeCompare(b.username));
}

export async function createStaffAccount(input: {
  displayName: string;
  username: string;
  password: string;
  role: UserRole;
}): Promise<void> {
  const username = normalizeUsername(input.username);
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('Enter a display name.');
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username may only use lowercase letters, numbers, dots, underscores and hyphens.');
  }
  if (input.password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const existingLocal = (await db.users.toArray()).find(
    (u) => normalizeUsername(u.username) === username
  );
  if (existingLocal) {
    throw new Error('That username is already in use.');
  }

  const email = staffUsernameToEmail(username);
  const config = await configManager.getConfig();
  const ownerToken = await getAccessToken();

  if (config && isConfigured(config) && ownerToken && navigator.onLine) {
    const signUpRes = await fetch(`${authBaseUrl(config)}/signup`, {
      method: 'POST',
      headers: supabaseHeaders(config),
      body: JSON.stringify({
        email,
        password: input.password,
        data: { username, name: displayName, role: input.role },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!signUpRes.ok) {
      const errBody = await signUpRes.json().catch(() => ({}));
      const msg = String(errBody?.msg || errBody?.error_description || errBody?.message || '');
      if (/already registered|already exists/i.test(msg)) {
        throw new Error('That username is already in use in the cloud.');
      }
      throw new Error(msg || 'Cloud account creation failed.');
    }

    const signUpData = await signUpRes.json();
    const uid = signUpData.user?.id || signUpData.id;

    if (uid) {
      // Owner updates the newly created profile row with the assigned staff role
      const patchRes = await fetch(`${restBaseUrl(config)}/profiles?id=eq.${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: supabaseHeaders(config, ownerToken),
        body: JSON.stringify({
          username,
          name: displayName,
          email,
          role: input.role,
          active: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!patchRes.ok) {
        throw new Error('Account created, but assigning staff role was rejected by RLS.');
      }
    }
  }

  const passwordHash = await hashPassword(input.password);
  await db.users.add({
    username,
    passwordHash,
    role: input.role,
    active: true,
  });
}

export async function setStaffActive(account: StaffAccount, active: boolean): Promise<void> {
  const localUsers = await db.users.toArray();
  const target = localUsers.find((u) => normalizeUsername(u.username) === normalizeUsername(account.username));
  if (target?.id !== undefined) {
    await db.users.update(target.id, { active });
  }

  const config = await configManager.getConfig();
  const token = await getAccessToken();
  if (config && isConfigured(config) && token && navigator.onLine && account.uid) {
    await fetch(`${restBaseUrl(config)}/profiles?id=eq.${encodeURIComponent(account.uid)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(config, token),
      body: JSON.stringify({ active }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
  }
}

export async function bootstrapOwnerAccount(input: {
  adminEmail?: string;
  displayName: string;
  username: string;
  password: string;
  pin?: string;
}): Promise<{ uid: string; idToken: string }> {
  const user = await completeFirstRunOwnerSetup({
    username: input.username,
    name: input.displayName,
    email: input.adminEmail,
    password: input.password,
    pin: input.pin || '123456',
  });
  const token = (await getAccessToken()) || '';
  if (token) {
    rememberToken(token, token, 3600);
  }
  return { uid: String(user.id ?? user.username), idToken: token };
}
