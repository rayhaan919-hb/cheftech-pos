import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { formatAmount } from '../lib/format';
import {
  LEAVE_TYPES, STAFF_ROLES, checkPeriod, currentPeriod, decideLeave, deleteAdvance, deleteStaff,
  markAttendance, payrollRows, paySalary, recordAdvance, requestLeave, saveStaff, today,
} from '../lib/staff';
import type { PayrollRow } from '../lib/staff';
import { Modal } from './Modal';
import type { AttendanceStatus, Leave, SalaryPayment, StaffMember } from '../lib/db/types';

const TABS = ['employees', 'attendance', 'leaves', 'payroll'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  employees: 'Employees',
  attendance: 'Attendance',
  leaves: 'Leaves',
  payroll: 'Payroll',
};

const BLANK: StaffMember = {
  name: '', phone: '', role: 'WAITER', status: 'ACTIVE', joinDate: today(), monthlySalary: 0,
};

export function StaffModal({ username, onClose, notify }: {
  username: string;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('employees');

  return (
    <Modal title="Staff Management" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Staff sections">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border ${
                tab === key ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>

        {tab === 'employees' && <Employees username={username} notify={notify} />}
        {tab === 'attendance' && <AttendanceTab username={username} notify={notify} />}
        {tab === 'leaves' && <LeavesTab username={username} notify={notify} />}
        {tab === 'payroll' && <PayrollTab username={username} notify={notify} />}
      </div>
    </Modal>
  );
}

function Employees({ username, notify }: { username: string; notify: (m: string) => void }) {
  const staff = useLive(() => db.staff.toArray(), []) ?? [];
  const [draft, setDraft] = useState<StaffMember>(BLANK);

  const sorted = [...staff].sort((a, b) => a.name.localeCompare(b.name));

  async function save() {
    if (!draft.name.trim()) {
      notify('Staff name is required.');
      return;
    }
    if (draft.monthlySalary < 0) {
      notify('Salary cannot be negative.');
      return;
    }
    await saveStaff({ ...draft, name: draft.name.trim(), phone: draft.phone.trim() }, username);
    notify(draft.id ? 'Employee updated.' : 'Employee added.');
    setDraft(BLANK);
  }

  return (
    <div className="space-y-3">
      <section className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm space-y-2">
        <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">
          {draft.id ? `Edit Employee #${draft.id}` : 'Add Employee'}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} />
          <Field label="Phone" value={draft.phone} onChange={(phone) => setDraft((d) => ({ ...d, phone }))} />
          <label className="block">
            <Caption>Role</Caption>
            <select
              value={draft.role}
              onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
              aria-label="Staff role"
              className={INPUT}
            >
              {STAFF_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label className="block">
            <Caption>Monthly salary</Caption>
            <input
              type="number"
              min={0}
              value={draft.monthlySalary || ''}
              onChange={(e) => setDraft((d) => ({ ...d, monthlySalary: Number(e.target.value) || 0 }))}
              aria-label="Monthly salary"
              className={INPUT}
            />
          </label>
          <label className="block">
            <Caption>Join date</Caption>
            <input
              type="date"
              value={draft.joinDate}
              onChange={(e) => setDraft((d) => ({ ...d, joinDate: e.target.value }))}
              aria-label="Join date"
              className={INPUT}
            />
          </label>
          <label className="block">
            <Caption>Status</Caption>
            <select
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as StaffMember['status'] }))}
              aria-label="Staff status"
              className={INPUT}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          {draft.id && (
            <button type="button" onClick={() => setDraft(BLANK)} className={GHOST}>Cancel</button>
          )}
          <button type="button" onClick={save} className={PRIMARY}>
            {draft.id ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </section>

      {sorted.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-6 border border-dashed border-gray-200 rounded-xl">
          No staff members yet. Add your first employee above.
        </p>
      ) : (
        <div className="space-y-2 max-h-[38vh] overflow-y-auto custom-scrollbar pr-1">
          {sorted.map((member) => (
            <article key={member.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-xs text-gray-800">{member.name}</span>
                  <Pill tone={member.status === 'ACTIVE' ? 'emerald' : 'gray'}>{member.status}</Pill>
                  <Pill tone="cyan">{member.role}</Pill>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {member.phone || '—'} • Joined {member.joinDate || '—'} •{' '}
                  <span className="font-bold text-gray-700">{formatAmount(member.monthlySalary || 0)}</span>
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button type="button" onClick={() => setDraft(member)} className={GHOST}>Edit</button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Delete this staff member? Their attendance, leave and payroll history will be kept.')) return;
                    await deleteStaff(member, username);
                    notify(`${member.name} deleted.`);
                  }}
                  aria-label={`Delete ${member.name}`}
                  className="bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100"
                >
                  <Trash2 className="w-3 h-3" aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AttendanceTab({ username, notify }: { username: string; notify: (m: string) => void }) {
  const staff = useLive(() => db.staff.toArray(), []) ?? [];
  const attendance = useLive(() => db.attendance.toArray(), []) ?? [];
  const [date, setDate] = useState(today());

  const active = staff.filter((m) => m.status === 'ACTIVE');
  const byStaff = new Map(attendance.filter((a) => a.date === date).map((a) => [a.staffId, a]));
  const marked = active.filter((m) => byStaff.has(m.id!)).length;

  const statuses: Array<{ key: AttendanceStatus; label: string; active: string }> = [
    { key: 'PRESENT', label: 'Present', active: 'bg-emerald-500 text-white' },
    { key: 'ABSENT', label: 'Absent', active: 'bg-red-500 text-white' },
    { key: 'LATE', label: 'Late', active: 'bg-amber-500 text-white' },
    { key: 'HALF_DAY', label: 'Half day', active: 'bg-blue-500 text-white' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <Caption>Date</Caption>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Attendance date"
            className={INPUT}
          />
        </label>
        <p className="text-[11px] font-bold text-gray-600 mb-2">{marked}/{active.length} marked for {date}</p>
      </div>

      {active.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-6 border border-dashed border-gray-200 rounded-xl">
          No active staff members. Add employees first.
        </p>
      ) : (
        <div className="space-y-2 max-h-[42vh] overflow-y-auto custom-scrollbar pr-1">
          {active.map((member) => {
            const current = byStaff.get(member.id!)?.status;
            return (
              <div key={member.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-xs text-gray-800">{member.name}</span>
                  <span className="text-[10px] text-gray-400 font-bold ml-1">{member.role}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {statuses.map(({ key, label, active: activeClass }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={async () => {
                        if (!date) return notify('Pick a date first.');
                        await markAttendance(member.id!, date, key, username);
                      }}
                      aria-pressed={current === key}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${
                        current === key ? activeClass : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeavesTab({ username, notify }: { username: string; notify: (m: string) => void }) {
  const staff = useLive(() => db.staff.toArray(), []) ?? [];
  const leaves = useLive(() => db.leaves.toArray(), []) ?? [];
  const active = staff.filter((m) => m.status === 'ACTIVE');
  const nameOf = (id: number) => staff.find((m) => m.id === id)?.name || `Staff #${id}`;

  const [draft, setDraft] = useState({ staffId: '', startDate: today(), endDate: today(), type: LEAVE_TYPES[0], reason: '' });

  async function submit() {
    if (!draft.staffId) return notify('Select a staff member.');
    if (!draft.startDate || !draft.endDate) return notify('Select start and end dates.');
    if (draft.endDate < draft.startDate) return notify('End date cannot be before start date.');
    await requestLeave(
      { staffId: Number(draft.staffId), startDate: draft.startDate, endDate: draft.endDate, type: draft.type, reason: draft.reason.trim() },
      username,
    );
    setDraft({ staffId: '', startDate: today(), endDate: today(), type: LEAVE_TYPES[0], reason: '' });
    notify('Leave request submitted.');
  }

  const sorted = [...leaves].sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));

  return (
    <div className="space-y-3">
      <section className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm space-y-2">
        <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">Request Leave</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="block col-span-2 sm:col-span-1">
            <Caption>Staff</Caption>
            <select
              value={draft.staffId}
              onChange={(e) => setDraft((d) => ({ ...d, staffId: e.target.value }))}
              aria-label="Leave staff"
              className={INPUT}
            >
              <option value="">-- Select --</option>
              {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block">
            <Caption>From</Caption>
            <input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} aria-label="Leave start date" className={INPUT} />
          </label>
          <label className="block">
            <Caption>To</Caption>
            <input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} aria-label="Leave end date" className={INPUT} />
          </label>
          <label className="block">
            <Caption>Type</Caption>
            <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))} aria-label="Leave type" className={INPUT}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <input
          type="text"
          value={draft.reason}
          onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
          placeholder="Reason (optional)"
          aria-label="Leave reason"
          className={`${INPUT} w-full`}
        />
        <div className="flex justify-end">
          <button type="button" onClick={submit} className={PRIMARY}>Submit Request</button>
        </div>
      </section>

      {sorted.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-6 border border-dashed border-gray-200 rounded-xl">No leave requests yet.</p>
      ) : (
        <div className="space-y-2 max-h-[32vh] overflow-y-auto custom-scrollbar pr-1">
          {sorted.map((leave) => (
            <LeaveRow key={leave.id} leave={leave} name={nameOf(leave.staffId)} username={username} notify={notify} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeaveRow({ leave, name, username, notify }: {
  leave: Leave;
  name: string;
  username: string;
  notify: (m: string) => void;
}) {
  return (
    <article className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-xs text-gray-800">{name}</span>
          <Pill tone="indigo">{leave.type}</Pill>
          <Pill tone={leave.status === 'APPROVED' ? 'emerald' : leave.status === 'REJECTED' ? 'red' : 'amber'}>
            {leave.status}
          </Pill>
        </div>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {leave.startDate} to {leave.endDate}{leave.reason ? ` • ${leave.reason}` : ''}
        </p>
      </div>
      {leave.status === 'PENDING' && (
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={async () => { await decideLeave(leave, 'APPROVED', username); notify('Leave approved.'); }}
            className="text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold px-2 py-1 rounded flex items-center gap-1"
          >
            <Check className="w-3 h-3" aria-hidden /> Approve
          </button>
          <button
            type="button"
            onClick={async () => { await decideLeave(leave, 'REJECTED', username); notify('Leave rejected.'); }}
            className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 font-bold px-2 py-1 rounded flex items-center gap-1"
          >
            <X className="w-3 h-3" aria-hidden /> Reject
          </button>
        </div>
      )}
    </article>
  );
}

function PayrollTab({ username, notify }: { username: string; notify: (m: string) => void }) {
  const staff = useLive(() => db.staff.toArray(), []) ?? [];
  const advances = useLive(() => db.advancePayments.toArray(), []) ?? [];
  const payments = useLive(() => db.salaryPayments.toArray(), []) ?? [];
  const [period, setPeriod] = useState(currentPeriod().key);
  const [advance, setAdvance] = useState({ staffId: '', amount: '', note: '' });

  const active = staff.filter((m) => m.status === 'ACTIVE');
  const rows = payrollRows(staff, advances, payments, period);
  const nameOf = (id: number) => staff.find((m) => m.id === id)?.name || `Staff #${id}`;
  const { year, month } = checkPeriod(period);
  const paidPeriod = payments
    .filter((p) => p.year === year && p.month === month)
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  const unpaidAdvances = [...advances]
    .filter((a) => a.status === 'PENDING')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  async function giveAdvance() {
    const amount = Number(advance.amount);
    if (!advance.staffId) return notify('Select a staff member.');
    if (!(amount > 0)) return notify('Enter an advance amount above zero.');
    await recordAdvance(Number(advance.staffId), amount, today(), advance.note.trim(), username);
    setAdvance({ staffId: advance.staffId, amount: '', note: '' });
    notify('Advance recorded.');
  }

  async function runPayroll(row: PayrollRow) {
    const confirmed = window.confirm(
      `Pay salary to ${row.member.name} for ${period}?\n\nBase: ${formatAmount(row.baseSalary)}\nAdvances deducted: ${formatAmount(row.advances)}\nNet payable: ${formatAmount(row.net)}`,
    );
    if (!confirmed) return;
    await paySalary(row, period, username);
    notify(`Salary paid to ${row.member.name}.`);
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <Caption>Payroll month</Caption>
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          aria-label="Payroll month"
          className={INPUT}
        />
      </label>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Payroll</h4>
        {rows.length === 0 ? (
          <p className="text-gray-400 text-xs text-center py-4 border border-dashed border-gray-200 rounded-xl">
            No active staff members. Add employees first.
          </p>
        ) : (
          <div className="space-y-2 max-h-[26vh] overflow-y-auto custom-scrollbar pr-1">
            {rows.map((row) => (
              <div key={row.member.id} className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-xs text-gray-800">{row.member.name}</span>
                    <Pill tone="cyan">{row.member.role}</Pill>
                    {row.paid && <Pill tone="emerald">PAID</Pill>}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Base <b className="text-gray-700">{formatAmount(row.baseSalary)}</b> − Advances{' '}
                    <b className={row.advances > 0 ? 'text-red-600' : 'text-gray-700'}>{formatAmount(row.advances)}</b> = Net{' '}
                    <b className="text-emerald-700">{formatAmount(row.net)}</b>
                  </p>
                </div>
                {row.paid ? (
                  <span className="text-[10px] font-bold text-gray-400 shrink-0">Already paid</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => runPayroll(row)}
                    className="shrink-0 rounded-xl bg-emerald-600 text-white px-3 py-2 text-[10px] font-black hover:bg-emerald-700"
                  >
                    Pay Salary
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Record advance</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select
            value={advance.staffId}
            onChange={(e) => setAdvance((a) => ({ ...a, staffId: e.target.value }))}
            aria-label="Advance staff"
            className={INPUT}
          >
            <option value="">-- Select --</option>
            {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input
            type="number"
            min={0}
            value={advance.amount}
            onChange={(e) => setAdvance((a) => ({ ...a, amount: e.target.value }))}
            placeholder="Amount"
            aria-label="Advance amount"
            className={INPUT}
          />
          <input
            type="text"
            value={advance.note}
            onChange={(e) => setAdvance((a) => ({ ...a, note: e.target.value }))}
            placeholder="Note (optional)"
            aria-label="Advance note"
            className={INPUT}
          />
          <button type="button" onClick={giveAdvance} className={PRIMARY}>Give Advance</button>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <section className="space-y-1.5">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Outstanding advances</h4>
          {unpaidAdvances.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-3">No outstanding advances.</p>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {unpaidAdvances.map((row) => (
                <li key={row.id} className="p-2 bg-white border border-gray-200 rounded-lg flex items-center gap-2 text-[11px]">
                  <span className="flex-1 min-w-0">
                    <b className="text-gray-800">{nameOf(row.staffId)}</b>{' '}
                    <span className="font-bold text-red-600">{formatAmount(row.amount)}</span>
                    <span className="block text-[10px] text-gray-400">{row.date}{row.note ? ` • ${row.note}` : ''}</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Delete this advance record?')) return;
                      await deleteAdvance(row.id!, username);
                      notify('Advance deleted.');
                    }}
                    aria-label={`Delete advance ${row.id}`}
                    className="bg-red-50 text-red-600 px-1.5 py-1 rounded hover:bg-red-100"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-1.5">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700">Salary paid this month</h4>
          {paidPeriod.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-3">No salary payments recorded for {period}.</p>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {paidPeriod.map((row: SalaryPayment) => (
                <li key={row.id} className="p-2 bg-white border border-gray-200 rounded-lg text-[11px]">
                  <b className="text-gray-800">{nameOf(row.staffId)}</b>{' '}
                  <span className="font-bold text-emerald-700">{formatAmount(row.netPaid)}</span>
                  <span className="block text-[10px] text-gray-400">
                    Base {formatAmount(row.baseSalary)} − advances {formatAmount(row.advancesDeducted)} • by {row.paidBy}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const INPUT =
  'w-full p-2 text-xs ring-1 ring-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-0';
const PRIMARY = 'px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700';
const GHOST = 'px-3 py-1.5 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200';

function Caption({ children }: { children: React.ReactNode }) {
  return <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-0.5">{children}</span>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <Caption>{label}</Caption>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={INPUT}
      />
    </label>
  );
}

const PILL_TONES = {
  emerald: 'bg-emerald-50 text-emerald-700',
  gray: 'bg-gray-100 text-gray-500',
  cyan: 'bg-cyan-50 text-cyan-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
};

function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: React.ReactNode }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${PILL_TONES[tone]}`}>{children}</span>
  );
}
