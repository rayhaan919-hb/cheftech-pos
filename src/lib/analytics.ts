import { db } from './db';
import { isApproved } from './suppliers';
import { getCurrency } from './format';
import type { Expense, Sale } from './db/types';

export type Period = 'day' | 'week' | 'month';

export interface PeriodSummary {
  todaySales: number;
  todayCount: number;
  weekSales: number;
  weekCount: number;
  weekDiscounts: number;
  monthSales: number;
  monthCount: number;
  monthDiscounts: number;
  totalOverallSales: number;
  totalCount: number;
  totalDiscounts: number;
}

const amount = (sale: Sale) => Math.max(0, (Number(sale.total) || 0) - (Number(sale.refundedAmount) || 0));

export async function getPeriodSummary(): Promise<PeriodSummary> {
  const sales = await db.sales.toArray();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekday = new Date(startOfDay).getDay();
  const startOfWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (weekday === 0 ? 6 : weekday - 1),
  ).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const summary: PeriodSummary = {
    todaySales: 0, todayCount: 0,
    weekSales: 0, weekCount: 0, weekDiscounts: 0,
    monthSales: 0, monthCount: 0, monthDiscounts: 0,
    totalOverallSales: 0, totalCount: 0, totalDiscounts: 0,
  };

  for (const sale of sales) {
    const at = new Date(sale.timestamp).getTime();
    if (!Number.isFinite(at)) continue;
    const total = amount(sale);
    const discount = Number(sale.discountAmount) || 0;

    summary.totalOverallSales += total;
    summary.totalDiscounts += discount;
    summary.totalCount++;
    if (at >= startOfDay) {
      summary.todaySales += total;
      summary.todayCount++;
    }
    if (at >= startOfWeek) {
      summary.weekSales += total;
      summary.weekDiscounts += discount;
      summary.weekCount++;
    }
    if (at >= startOfMonth) {
      summary.monthSales += total;
      summary.monthDiscounts += discount;
      summary.monthCount++;
    }
  }
  return summary;
}

export interface Bucket {
  start: number;
  end: number;
  label: string;
  amount: number;
  orders: number;
}

/** Hourly buckets for today, daily buckets for this week or this month. */
export function getBuckets(period: Period, now = new Date()): { buckets: Bucket[]; caption: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hourly = period === 'day';
  const days = period === 'month' ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 7;
  let caption: string;

  if (hourly) {
    caption = `Hourly revenue · ${now.toLocaleDateString('en-PK', { day: 'numeric', month: 'long' })}`;
  } else if (period === 'month') {
    start.setDate(1);
    caption = `Daily revenue · ${now.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })}`;
  } else {
    const weekday = start.getDay();
    start.setDate(start.getDate() + (weekday === 0 ? -6 : 1 - weekday));
    caption = 'Daily revenue · this week';
  }

  const count = hourly ? 24 : days;
  const buckets = Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    if (hourly) date.setHours(index);
    else date.setDate(date.getDate() + index);
    return {
      start: date.getTime(),
      end: hourly
        ? date.getTime() + 3_600_000
        : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
      label: hourly
        ? date.toLocaleTimeString(getCurrency().locale, { hour: 'numeric' })
        : date.toLocaleDateString(getCurrency().locale, { weekday: period === 'week' ? 'short' : undefined, day: 'numeric' }),
      amount: 0,
      orders: 0,
    };
  });
  return { buckets, caption };
}

export interface Ranking {
  name: string;
  metric: number;
  detail: number;
}

export interface AnalyticsReport {
  buckets: Bucket[];
  caption: string;
  orderCount: number;
  topItems: Ranking[];
  topCustomers: Ranking[];
}

export async function getAnalytics(period: Period, categoryId?: string): Promise<AnalyticsReport> {
  const [sales, customers, menu] = await Promise.all([db.sales.toArray(), db.customers.toArray(), db.menu.toArray()]);
  const { buckets, caption } = getBuckets(period);
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const inPeriod = sales.filter((sale) => {
    const at = new Date(sale.timestamp).getTime();
    return Number.isFinite(at) && at >= from && at < to;
  });

  const items = new Map<string, Ranking>();
  const people = new Map<string, Ranking>();
  const profiles = new Map(customers.map((c) => [c.phone || c.id, c.name]));
  const categoryByItem = new Map(menu.map((m) => [m.id, m.categoryId]));

  for (const sale of inPeriod) {
    const at = new Date(sale.timestamp).getTime();
    const bucket = buckets.find((b) => at >= b.start && at < b.end);
    if (bucket) {
      bucket.amount += amount(sale);
      bucket.orders++;
    }

    for (const item of sale.items || []) {
      const qty = Math.max(0, (Number(item.qty) || 0) - (Number(item.refundedQty) || 0));
      if (qty <= 0) continue;
      if (categoryId !== undefined && categoryByItem.get(item.menuItemId || item.id) !== categoryId) continue;
      const name = item.name || 'Unnamed item';
      const row = items.get(name) || { name, metric: 0, detail: 0 };
      row.metric += qty;
      row.detail += qty * (Number(item.price) || 0);
      items.set(name, row);
    }

    const buyer = sale.customer?.phone ? sale.customer : sale.deliveryInfo;
    const phone = buyer?.phone?.replace(/\D/g, '');
    if (!phone) continue;
    const row = people.get(phone) || { name: buyer?.name || profiles.get(phone) || 'Customer', metric: 0, detail: 0 };
    if (buyer?.name) row.name = buyer.name;
    row.metric++;
    row.detail += amount(sale);
    people.set(phone, row);
  }

  return {
    buckets,
    caption,
    orderCount: inPeriod.length,
    topItems: [...items.values()].sort((a, b) => b.metric - a.metric || b.detail - a.detail).slice(0, 5),
    topCustomers: [...people.values()].sort((a, b) => b.metric - a.metric || b.detail - a.detail).slice(0, 5),
  };
}

export interface PnlReport {
  sales: number;
  expenses: number;
  net: number;
  orderCount: number;
}

export async function getPnl(startDate: string, endDate: string): Promise<PnlReport> {
  const [sales, expenses] = await Promise.all([db.sales.toArray(), db.expenses.toArray()]);
  const from = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : -Infinity;
  const to = endDate ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;
  const between = (stamp: string) => {
    const at = new Date(stamp).getTime();
    return at >= from && at <= to;
  };

  const inRange = sales.filter((s) => between(s.timestamp));
  const totalSales = inRange.reduce((sum, s) => sum + amount(s), 0);
  const totalExpenses = expenses
    .filter((e: Expense) => isApproved(e) && between(e.timestamp))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return { sales: totalSales, expenses: totalExpenses, net: totalSales - totalExpenses, orderCount: inRange.length };
}
