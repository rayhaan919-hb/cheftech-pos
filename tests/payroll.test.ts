import { describe, it, expect } from 'vitest';
import { payrollRows } from '../src/lib/staff';
import type { AdvancePayment, SalaryPayment, StaffMember } from '../src/lib/db/types';

const member = (id: number, salary: number, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): StaffMember => ({
  id, name: `Staff ${id}`, phone: '', role: 'WAITER', status, joinDate: '2026-01-01', monthlySalary: salary,
});

const advance = (staffId: number, amount: number, date: string, status: 'PENDING' | 'SETTLED' = 'PENDING'): AdvancePayment => ({
  id: staffId * 100 + amount, staffId, amount, date, status,
});

describe('payrollRows', () => {
  it('deducts only pending advances dated inside the payroll month', () => {
    const rows = payrollRows(
      [member(1, 50_000), member(2, 30_000, 'INACTIVE')],
      [advance(1, 5_000, '2026-10-03'), advance(1, 2_000, '2026-10-20', 'SETTLED'), advance(1, 9_000, '2026-09-30')],
      [],
      '2026-10',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].advances).toBe(5_000);
    expect(rows[0].net).toBe(45_000);
  });

  it('flags a member paid in the same month and year', () => {
    const paid: SalaryPayment[] = [{
      staffId: 1, month: 10, year: 2026, baseSalary: 50_000, advancesDeducted: 0,
      netPaid: 50_000, status: 'PAID', paidAt: '', paidBy: 'owner',
    }];
    expect(payrollRows([member(1, 50_000)], [], paid, '2026-10')[0].paid).toBe(true);
    expect(payrollRows([member(1, 50_000)], [], paid, '2026-11')[0].paid).toBe(false);
  });

  it('replays the recorded payment for an already-paid month instead of recomputing', () => {
    const paid: SalaryPayment[] = [{
      staffId: 1, month: 10, year: 2026, baseSalary: 45_000, advancesDeducted: 5_000,
      netPaid: 40_000, status: 'PAID', paidAt: '', paidBy: 'owner',
    }];
    const [row] = payrollRows(
      [member(1, 45_000)],
      [advance(1, 5_000, '2026-10-20', 'SETTLED')],
      paid,
      '2026-10',
    );
    expect(row).toMatchObject({ advances: 5_000, net: 40_000 });
  });
});
