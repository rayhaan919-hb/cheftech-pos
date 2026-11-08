import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { toneForAction } from '../lib/audit';
import { Modal } from './Modal';
import type { AuditLog } from '../lib/db/types';

const PAGE = 200;

export function ActivityLogModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const logs = useLive(() => db.auditLogs.reverse().limit(PAGE).toArray(), []) ?? [];

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((log) => `${log.action} ${log.user} ${log.details ?? ''}`.toLowerCase().includes(query));
  }, [logs, search]);

  return (
    <Modal title="Activity Log" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by action, user or details..."
            aria-label="Filter activity log"
            className="w-full pl-10 pr-4 py-2.5 text-sm ring-1 ring-gray-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
          />
        </div>

        <p className="text-[10px] text-gray-500">
          Showing the {PAGE} most recent events{search.trim() ? ` matching "${search.trim()}"` : ''}.
        </p>

        {filtered.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-8">
            {logs.length === 0 ? 'No audit events recorded yet.' : 'No events match that filter.'}
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[52vh] overflow-y-auto custom-scrollbar pr-1">
            {filtered.map((log: AuditLog) => (
              <li key={log.id} className="p-2.5 bg-white rounded-xl border border-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${toneForAction(log.action)}`}>
                    {log.action}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                {log.details && <p className="text-[11px] text-gray-700 mt-1 break-words">{String(log.details)}</p>}
                <p className="text-[10px] text-gray-400 mt-0.5">
                  By {log.user || 'Staff'}
                  {log.saleId ? ` · Sale #${log.saleId}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
