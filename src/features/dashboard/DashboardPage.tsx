import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Dashboard, FollowUpReason } from '../../../shared/types.ts';
import { api } from '../../lib/api.ts';
import { REASON } from '../ai-drafting/AiDraftingPage.tsx';

/** DM5: donor figures for FFFA staff. Aggregates only, no names or contact details. */

const sgd = (n: number) => `S$${Math.round(n).toLocaleString('en-SG')}`;
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

/** Simple vertical bars, one per month. */
function MonthBars({ data, value, format }: { data: Dashboard['months']; value: (m: Dashboard['months'][number]) => number; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map(value));
  return (
    <div className="flex h-40 gap-1.5">
      {data.map((m) => (
        <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)}: ${format(value(m))}`}>
          <div className="relative w-full flex-1">
            <div
              className="absolute bottom-0 w-full rounded-t bg-emerald-600/80"
              style={{ height: `${(value(m) / max) * 100}%`, minHeight: value(m) ? 2 : 0 }}
            />
          </div>
          <span className="text-[10px] text-slate-500">{monthLabel(m.month)}</span>
        </div>
      ))}
    </div>
  );
}

function HBars({ rows }: { rows: { label: React.ReactNode; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 font-medium text-slate-900">{r.text}</span>
          </div>
          <div className="h-2 rounded bg-slate-100">
            <div className="h-2 rounded bg-emerald-600/70" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<Dashboard>('/api/dashboard')
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  if (error) return <p className="mx-auto max-w-7xl px-6 py-6 text-sm text-rose-700">{error}</p>;
  if (!data) return <p className="mx-auto max-w-7xl px-6 py-6 text-sm text-slate-500">Loading…</p>;

  const pending = data.follow_ups.reduce((n, f) => n + f.pending, 0);
  const upgrades = data.follow_ups.find((f) => f.reason === 'upgrade_candidate')?.pending ?? 0;

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Dashboard</h2>
        <button onClick={load} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Donors" value={String(data.donors.total)} hint={`${data.donors.active_12m} gave in the last 12 months`} />
        <Stat label="Giving, last 12 months" value={sgd(data.giving_12m_sgd)} hint="Cash gifts" />
        <Stat label="Monthly donors" value={String(data.donors.recurring)} hint={`${sgd(data.monthly_recurring_sgd)} a month`} />
        <Stat label="Major donors" value={String(data.donors.major)} hint="Personal outreach" />
        <Stat label="Follow-ups pending" value={String(pending)} hint={`${upgrades} upgrade ask${upgrades === 1 ? '' : 's'}`} />
        <Stat label="Messages sent (30 days)" value={String(data.ai.sent_30d)} hint={`${data.ai.drafted_30d} drafts made`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Donations by month (S$)">
          <MonthBars data={data.months} value={(m) => m.donations_sgd} format={sgd} />
        </Card>
        <Card title="Donor contacts by month">
          <MonthBars data={data.months} value={(m) => m.engagements} format={(n) => `${n} contacts`} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Pending follow-ups">
          <HBars
            rows={data.follow_ups.map((f) => ({
              label: REASON[f.reason as FollowUpReason]?.label ?? f.reason,
              value: f.pending,
              text: String(f.pending),
            }))}
          />
        </Card>
        <Card title="Donors by tier (internal)">
          <HBars rows={data.tiers.map((t) => ({ label: t.tier[0].toUpperCase() + t.tier.slice(1), value: t.donors, text: String(t.donors) }))} />
        </Card>
        <Card title="Giving by campaign, last 12 months">
          <HBars rows={data.campaigns.map((c) => ({ label: c.campaign, value: c.donations_sgd, text: `${sgd(c.donations_sgd)} · ${c.donors} donors` }))} />
        </Card>
      </div>
    </main>
  );
}
