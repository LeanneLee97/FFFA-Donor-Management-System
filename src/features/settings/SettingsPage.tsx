import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../../lib/api.ts';

/** Admin settings: follow-up rule thresholds, tier giving levels and cadences, impact unit, major-donor rule. */

interface Settings {
  rules: Record<string, number>;
  tiers: { tier: string; min_12m_giving_sgd: number; cadence_days: number }[];
  org: Record<string, string>;
}

const RULES: Record<string, string> = {
  thank_you_after_days: 'Remind to thank a donor after (days)',
  failed_payment_window_days: 'Failed monthly payment: follow up within (days)',
  key_date_window_days: 'Key dates (grant report, renewal): remind before (days)',
  lapsed_recurring_days: 'Monthly donor lapsed after no gift for (days)',
  lapsed_one_off_days: 'One-off donor lapsed after no gift for (days)',
  anniversary_window_days: 'First-gift anniversary: remind within (days)',
  upgrade_same_amount_months: 'Suggest an upgrade after the same monthly gift for (months)',
};
const ORG: Record<string, { label: string; multiline?: boolean }> = {
  impact_unit_sgd: { label: 'Impact unit: S$ that equals one unit' },
  impact_unit_singular: { label: 'Unit name (one)' },
  impact_unit_plural: { label: 'Unit name (many)' },
  major_min_12m_sgd: { label: 'Major donor: giving in 12 months (S$)' },
  major_min_years: { label: 'Major donor: years with FFFA' },
  signature: { label: 'Message sign-off', multiline: true },
};
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none';

export default function SettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<string | null>(null);

  const apply = (s: Settings) => {
    setSaved(s);
    setDraft(JSON.parse(JSON.stringify(s)));
  };

  useEffect(() => {
    api.get<Settings>('/api/settings').then(apply).catch((e: Error) => setError(e.message));
    api.get<{ ai: string }>('/api/health').then((h) => setAi(h.ai)).catch(() => {});
  }, []);

  async function save() {
    if (!saved || !draft) return;
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      // Send only what changed.
      const patch: Record<string, unknown> = {
        rules: Object.fromEntries(Object.entries(draft.rules).filter(([k, v]) => v !== saved.rules[k])),
        org: Object.fromEntries(Object.entries(draft.org).filter(([k, v]) => v !== saved.org[k])),
        tiers: draft.tiers.filter((t, i) => t.min_12m_giving_sgd !== saved.tiers[i].min_12m_giving_sgd || t.cadence_days !== saved.tiers[i].cadence_days),
      };
      apply(await api.patch<Settings>('/api/settings', patch));
      setOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return <div className="mx-auto max-w-3xl px-6 py-6 text-sm text-slate-500">{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500">Changes apply the next time follow-ups are refreshed. Every change is recorded in the activity log.</p>
      </div>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}
      {ok && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Saved.</div>}

      <Card title="When follow-ups appear">
        {Object.keys(RULES).filter((k) => k in draft.rules).map((k) => (
          <Row key={k} label={RULES[k]}>
            <input type="number" min={1} value={draft.rules[k]} onChange={(e) => setDraft({ ...draft, rules: { ...draft.rules, [k]: Number(e.target.value) } })} className={`${inputCls} w-28`} />
          </Row>
        ))}
      </Card>

      <Card title="Tiers (internal only, never shown to donors)">
        <div className="grid grid-cols-[100px_1fr_1fr] gap-2 text-xs text-slate-500"><span /> <span>Giving in 12 months from (S$)</span> <span>Contact every (days)</span></div>
        {draft.tiers.map((t, i) => (
          <div key={t.tier} className="grid grid-cols-[100px_1fr_1fr] items-center gap-2">
            <span className="text-sm font-medium capitalize text-slate-800">{t.tier}</span>
            <input type="number" min={0} disabled={i === 0} value={t.min_12m_giving_sgd} onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((x, j) => (j === i ? { ...x, min_12m_giving_sgd: Number(e.target.value) } : x)) })} className={`${inputCls} disabled:bg-slate-50`} />
            <input type="number" min={1} value={t.cadence_days} onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((x, j) => (j === i ? { ...x, cadence_days: Number(e.target.value) } : x)) })} className={inputCls} />
          </div>
        ))}
      </Card>

      <Card title="Impact, major donors and messages">
        {Object.keys(ORG).filter((k) => k in draft.org).map((k) => (
          <Row key={k} label={ORG[k].label}>
            {ORG[k].multiline ? (
              <textarea rows={3} value={draft.org[k]} onChange={(e) => setDraft({ ...draft, org: { ...draft.org, [k]: e.target.value } })} className={inputCls} />
            ) : (
              <input value={draft.org[k]} onChange={(e) => setDraft({ ...draft, org: { ...draft.org, [k]: e.target.value } })} className={inputCls} />
            )}
          </Row>
        ))}
      </Card>

      <Card title="AI drafting">
        <p className="text-sm text-slate-600">Currently: <b>{ai ?? '…'}</b>. To switch on AI-written drafts, put a Gemini key in the <code className="rounded bg-slate-100 px-1">.env</code> file next to the app (<code className="rounded bg-slate-100 px-1">GEMINI_API_KEY=</code>) and restart. Left blank, the app uses built-in templates. The key is never entered in the browser.</p>
      </Card>

      <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
      </button>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
      <span className="text-sm text-slate-700">{label}</span>
      {children}
    </div>
  );
}
