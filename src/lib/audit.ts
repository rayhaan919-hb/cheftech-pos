import { db } from './db';

/** Badge tone for an action name; unmapped actions fall through to neutral gray. */
export function toneForAction(action: string): string {
  if (/DELETE|REJECT|FAILED|DENIED/.test(action)) return 'bg-red-50 text-red-700 border-red-200';
  if (/ADD|CREATE|LOGIN/.test(action)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (/UPDATE|EDIT|ADJUST|SET|MARKED|APPROVED/.test(action)) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

/** Port of app.js logAudit — never throws; a failed audit write must not block the action. */
export async function logAudit(action: string, details: string, user: string, saleId?: number): Promise<void> {
  try {
    await db.auditLogs.add({ timestamp: new Date().toISOString(), action, details, saleId, user });
  } catch (err) {
    console.warn('Audit log write failed:', err);
  }
}
