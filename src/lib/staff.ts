import { db } from './db';
import { logAudit } from './audit';
import type { AdvancePayment, AttendanceStatus, Leave, LeaveStatus, SalaryPayment, StaffMember } from './db/types';

export const STAFF_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'RIDER'];
export const LEAVE_TYPES = ['CASUAL', 'SICK', 'ANNUAL', 'UNPAID'];

/** `month` is 1-based, matching how payroll rows are stored. */
export function currentPeriod(now = new Date()): { year: number; month: number; key: string } {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };
}

export function checkPeriod(key: string): { year: number; month: number } {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function saveStaff(member: StaffMember, user: string): Promise<number> {
  if (member.id) {
    await db.staff.update(member.id, { ...member });
    await logAudit('STAFF_UPDATED', `Updated staff member: ${member.name} (${member.role})`, user);
    return member.id;
  }
  const id = await db.staff.add({ ...member, createdAt: new Date().toISOString() });
  await logAudit('STAFF_ADDED', `Added staff member: ${member.name} (${member.role}), salary ${member.monthlySalary}`, user);
  return id;
}

export async function deleteStaff(member: StaffMember, user: string): Promise<void> {
  await db.staff.delete(member.id!);
  // Attendance, leave and payroll rows are intentionally kept for history.
  await logAudit('STAFF_DELETED', `Deleted staff member: ${member.name}`, user);
}

export async function markAttendance(staffId: number, date: string, status: AttendanceStatus, user: string) {
  const existing = await db.attendance.where({ staffId }).and((a) => a.date === date).first();
  const stamp = { status, markedBy: user, timestamp: new Date().toISOString() };
  if (existing) await db.attendance.update(existing.id!, stamp);
  else await db.attendance.add({ staffId, date, ...stamp });

  const member = await db.staff.get(staffId);
  await logAudit('ATTENDANCE_MARKED', `${member?.name ?? staffId} marked ${status} on ${date}`, user);
}

export async function requestLeave(
  leave: Omit<Leave, 'id' | 'status' | 'requestedAt'>,
  user: string,
): Promise<number> {
  const id = await db.leaves.add({ ...leave, status: 'PENDING', requestedAt: new Date().toISOString() });
  const member = await db.staff.get(leave.staffId);
  await logAudit(
    'LEAVE_REQUESTED',
    `Leave requested for ${member?.name ?? leave.staffId}: ${leave.type} from ${leave.startDate} to ${leave.endDate}`,
    user,
  );
  return id;
}

export async function decideLeave(leave: Leave, status: LeaveStatus, user: string): Promise<void> {
  await db.leaves.update(leave.id!, { status, decidedBy: user, decidedAt: new Date().toISOString() });
  const member = await db.staff.get(leave.staffId);
  await logAudit(
    `LEAVE_${status}`,
    `Leave ${status.toLowerCase()} for ${member?.name ?? leave.staffId} (${leave.startDate} to ${leave.endDate})`,
    user,
  );
}

export function pendingAdvances(advances: AdvancePayment[], staffId: number, period: string): AdvancePayment[] {
  return advances.filter((a) => a.staffId === staffId && a.status === 'PENDING' && a.date.startsWith(period));
}

export interface PayrollRow {
  member: StaffMember;
  baseSalary: number;
  advances: number;
  net: number;
  paid: boolean;
}

export function payrollRows(
  staff: StaffMember[],
  advances: AdvancePayment[],
  payments: SalaryPayment[],
  period: string,
): PayrollRow[] {
  const { year, month } = checkPeriod(period);
  return staff
    .filter((m) => m.status === 'ACTIVE')
    .map((member) => {
      const record = payments.find((p) => p.staffId === member.id && p.year === year && p.month === month);
      // Once paid, show what was actually paid — settled advances no longer count as pending.
      if (record) {
        return {
          member,
          baseSalary: record.baseSalary,
          advances: record.advancesDeducted,
          net: record.netPaid,
          paid: true,
        };
      }
      const owed = pendingAdvances(advances, member.id!, period);
      const advanceTotal = owed.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
      const base = Number(member.monthlySalary) || 0;
      return { member, baseSalary: base, advances: advanceTotal, net: base - advanceTotal, paid: false };
    });
}

export async function paySalary(row: PayrollRow, period: string, user: string): Promise<void> {
  const { year, month } = checkPeriod(period);
  const owed = pendingAdvances(await db.advancePayments.toArray(), row.member.id!, period);
  const advanceTotal = owed.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const base = Number(row.member.monthlySalary) || 0;
  const net = base - advanceTotal;

  await db.transaction('rw', db.salaryPayments, db.advancePayments, async () => {
    await db.salaryPayments.add({
      staffId: row.member.id!,
      year,
      month,
      baseSalary: base,
      advancesDeducted: advanceTotal,
      netPaid: net,
      status: 'PAID',
      paidAt: new Date().toISOString(),
      paidBy: user,
    });
    for (const advance of owed) {
      await db.advancePayments.update(advance.id!, { status: 'SETTLED', settledInPayroll: period });
    }
  });

  await logAudit(
    'SALARY_PAID',
    `Paid ${net} to ${row.member.name} for ${period} (base ${base}, advances ${advanceTotal})`,
    user,
  );
}

export async function recordAdvance(staffId: number, amount: number, date: string, note: string, user: string) {
  await db.advancePayments.add({ staffId, amount, date, note, status: 'PENDING', createdAt: new Date().toISOString() });
  const member = await db.staff.get(staffId);
  await logAudit('ADVANCE_GIVEN', `Advance of ${amount} given to ${member?.name ?? staffId} on ${date}`, user);
}

export async function deleteAdvance(id: number, user: string) {
  await db.advancePayments.delete(id);
  await logAudit('ADVANCE_DELETED', `Deleted advance record #${id}`, user);
}
