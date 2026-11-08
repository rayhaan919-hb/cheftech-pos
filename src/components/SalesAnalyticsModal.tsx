import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import { getAnalytics, getPeriodSummary } from '../lib/analytics';
import type { AnalyticsReport, Period } from '../lib/analytics';
import { formatAmount, currencySymbol } from '../lib/format';
import { Modal } from './Modal';

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

export function SalesAnalyticsModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>('week');
  const [category, setCategory] = useState<string>('');
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getPeriodSummary>> | null>(null);
  const categories = useLive(() => db.categories.toArray(), []) ?? [];

  useEffect(() => {
    let active = true;
    Promise.all([getAnalytics(period, category || undefined), getPeriodSummary()]).then(([nextReport, nextSummary]) => {
      if (!active) return;
      setReport(nextReport);
      setSummary(nextSummary);
    });
    return () => {
      active = false;
    };
  }, [period, category]);

  return (
    <Modal title="Sales Analytics" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="Today" value={summary?.todaySales} note={`${summary?.todayCount ?? 0} orders`} />
          <Stat
            label="This week"
            value={summary?.weekSales}
            note={`${summary?.weekCount ?? 0} orders · ${formatAmount(summary?.weekDiscounts ?? 0)} off`}
          />
          <Stat
            label="This month"
            value={summary?.monthSales}
            note={`${summary?.monthCount ?? 0} orders · ${formatAmount(summary?.monthDiscounts ?? 0)} off`}
          />
          <Stat
            label="All time"
            value={summary?.totalOverallSales}
            note={`${summary?.totalCount ?? 0} orders · ${formatAmount(summary?.totalDiscounts ?? 0)} off`}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              aria-pressed={period === key}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${
                period === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
            className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <section className="p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <p className="text-[11px] font-bold text-gray-500">{report?.caption ?? 'Loading…'}</p>
          {report && report.orderCount > 0 ? (
            <TrendChart buckets={report.buckets} period={period} />
          ) : (
            <div className="min-h-[180px] flex items-center justify-center text-xs text-gray-400">
              No sales recorded for this period
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Rankings
            title="Top items"
            rows={report?.topItems ?? []}
            empty="No item sales in this period"
            metric={(row) => `${row.metric} sold`}
            detail={(row) => formatAmount(row.detail)}
          />
          <Rankings
            title="Top customers"
            rows={report?.topCustomers ?? []}
            empty="No identified customer orders in this period"
            metric={(row) => `${row.metric} ${row.metric === 1 ? 'order' : 'orders'}`}
            detail={(row) => formatAmount(row.detail)}
          />
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, note }: { label: string; value?: number; note: string }) {
  return (
    <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-100">
      <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-sm font-black text-gray-900 tabular-nums">{formatAmount(value ?? 0)}</p>
      <p className="text-[10px] text-gray-500">{note}</p>
    </div>
  );
}

function TrendChart({ buckets, period }: { buckets: AnalyticsReport['buckets']; period: Period }) {
  const width = 760;
  const height = 240;
  const pad = { top: 18, right: 18, bottom: 34, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...buckets.map((b) => b.amount)) || 1;

  const points = buckets.map((bucket, index) => ({
    x: pad.left + (buckets.length === 1 ? plotW / 2 : (index * plotW) / (buckets.length - 1)),
    y: pad.top + plotH - (bucket.amount / max) * plotH,
    bucket,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${pad.left},${pad.top + plotH} ${line} ${pad.left + plotW},${pad.top + plotH}`;
  const step = period === 'month' ? 5 : period === 'day' ? 3 : 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Sales trend chart">
      <title>{`Sales trend, total ${formatAmount(buckets.reduce((sum, b) => sum + b.amount, 0))}`}</title>
      {[0, 1, 2, 3].map((index) => {
        const y = pad.top + (index * plotH) / 3;
        const value = max * (1 - index / 3);
        return (
          <g key={index}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#cbd5e1" strokeDasharray="3 5" />
            <text x={pad.left - 8} y={y + 4} fill="#64748b" textAnchor="end" fontSize={10}>
              {value >= 1000 ? `${currencySymbol()} ${(value / 1000).toFixed(1)}k` : `${currencySymbol()} ${Math.round(value)}`}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="#7dd3c7" opacity={0.12} />
      <polyline points={line} fill="none" stroke="#0d9488" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {points.map(({ x, y, bucket }, index) => (
        <g key={bucket.start}>
          <circle cx={x} cy={y} r={3.5} fill="#0d9488">
            <title>{`${bucket.label}: ${formatAmount(bucket.amount)}`}</title>
          </circle>
          {(index % step === 0 || index === points.length - 1) && (
            <text x={x} y={height - 8} fill="#64748b" textAnchor="middle" fontSize={10}>
              {bucket.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Rankings({ title, rows, empty, metric, detail }: {
  title: string;
  rows: AnalyticsReport['topItems'];
  empty: string;
  metric: (row: AnalyticsReport['topItems'][number]) => string;
  detail: (row: AnalyticsReport['topItems'][number]) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.metric));
  return (
    <section className="p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
      <h4 className="text-[10px] font-black uppercase tracking-wider text-gray-700 mb-2">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">{empty}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, index) => (
            <div key={row.name}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-4 text-[11px] font-semibold text-gray-500">{index + 1}.</span>
                  <span className="truncate text-xs font-semibold text-gray-800" title={row.name}>{row.name}</span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-teal-700">{metric(row)}</span>
              </div>
              <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(6, (row.metric / max) * 100)}%` }} />
              </div>
              <p className="ml-6 mt-0.5 text-[10px] text-gray-500">{detail(row)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
