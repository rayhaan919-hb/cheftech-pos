import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import {
  cloudSessionAvailable,
  createStaffAccount,
  listStaffAccounts,
  setStaffActive,
  type StaffAccount,
} from '../lib/staffAccounts';
import { logAudit } from '../lib/audit';
import type { UserRole } from '../lib/db/types';

const INPUT = 'p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-inner min-w-0';
const ROLES: UserRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];

/** Owner-only staff account manager: create POS logins and disable/enable them. */
export function StaffAccountsSection({ username, notify }: {
  username: string;
  notify: (message: string) => void;
}) {
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('WAITER');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  async function refresh() {
    try {
      setAccounts(await listStaffAccounts());
      setOffline(false);
    } catch (err) {
      setOffline(true);
      notify((err as Error).message);
    }
  }

  useEffect(() => {
    void (async () => {
      if (!(await cloudSessionAvailable())) {
        setOffline(true);
        return;
      }
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    setBusy(true);
    try {
      await createStaffAccount({ displayName, username: newUsername, password, role });
      await logAudit('STAFF_ACCOUNT_CREATED', `Created ${role} account "${newUsername.toLowerCase().trim()}"`, username);
      notify(`Account "${newUsername.toLowerCase().trim()}" created.`);
      setDisplayName('');
      setNewUsername('');
      setPassword('');
      setRole('WAITER');
      await refresh();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(account: StaffAccount) {
    if (account.username === username) {
      notify('You cannot disable your own account.');
      return;
    }
    try {
      await setStaffActive(account, !account.active);
      await logAudit('STAFF_ACCOUNT_UPDATED', `${account.active ? 'Disabled' : 'Enabled'} account "${account.username}"`, username);
      notify(`Account "${account.username}" ${account.active ? 'disabled' : 'enabled'}.`);
      await refresh();
    } catch (err) {
      notify((err as Error).message);
    }
  }

  if (offline) {
    return (
      <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
        <SectionTitle>Staff accounts</SectionTitle>
        <p className="text-[11px] text-gray-500">
          Staff accounts need a cloud sign-in. Sign out and sign back in while online — a session started
          offline or with an expired token can&apos;t manage accounts.
        </p>
      </section>
    );
  }

  return (
    <section className="p-3 rounded-xl border border-gray-200 bg-white space-y-2">
      <SectionTitle>Staff accounts</SectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Display name"
          aria-label="Display name"
          className={INPUT}
        />
        <input
          type="text"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="Username (login)"
          aria-label="Username"
          autoComplete="off"
          className={INPUT}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 6 chars)"
          aria-label="Password"
          autoComplete="new-password"
          className={INPUT}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} aria-label="Role" className={INPUT}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center gap-1.5 disabled:opacity-40"
        >
          <UserPlus className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Creating…' : 'Create account'}
        </button>
      </div>

      {accounts === null ? (
        <p className="text-[11px] text-gray-400 py-1">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-[11px] text-gray-400 py-1">No staff accounts found in the cloud.</p>
      ) : (
        <ul className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
          {accounts.map((account) => (
            <li key={account.uid} className="p-2 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-800 truncate">
                  {account.displayName || account.username}
                  {account.username === username && (
                    <span className="ml-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">You</span>
                  )}
                </p>
                <p className="text-[10px] text-gray-500">@{account.username} · {account.role}</p>
              </div>
              <button
                type="button"
                onClick={() => toggle(account)}
                disabled={account.username === username}
                className={
                  account.active
                    ? 'bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold px-2 py-1.5 rounded-lg disabled:opacity-40'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1.5 rounded-lg disabled:opacity-40'
                }
              >
                {account.active ? 'Disable' : 'Enable'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">{children}</p>;
}
