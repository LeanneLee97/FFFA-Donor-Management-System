import { useCallback, useEffect, useState } from 'react';
import { Building2, Download, HandHeart, Loader2, Plus, Search, UserRound } from 'lucide-react';
import type { DonationChannel, DonorListItem, DonorProfile, DonorType, Staff } from '../../../shared/types.ts';
import { api } from '../../lib/api.ts';

/** DM1-DM3, DM8: donor list with search, a profile, logging gifts and notes, and the Excel export. */

const sgd = (n: number | null | undefined) => (n == null ? '–' : `S$${n.toLocaleString('en-SG', { maximumFractionDigits: 2 })}`);
const day = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
const today = () => new Date().toISOString().slice(0, 10);
const CHANNELS: DonationChannel[] = ['giving_sg', 'give_asia', 'bank', 'paynow', 'in_person', 'other'];
const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none';
const btnCls = 'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60';

function nameOf(d: { organisation_name: string | null; first_name: string | null; last_name: string | null; preferred_name: string | null }) {
  return d.organisation_name ?? ([d.first_name, d.last_name].filter(Boolean).join(' ') || d.preferred_name || 'Unnamed');
}

export default function DonorsPage({ me }: { me: Staff | null }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [donors, setDonors] = useState<DonorListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (query.trim()) qs.set('query', query.trim());
    if (type) qs.set('type', type);
    setDonors(await api.get<DonorListItem[]>(`/api/donors?${qs}`));
  }, [query, type]);

  const loadProfile = useCallback(async (id: string) => setProfile(await api.get<DonorProfile>(`/api/donors/${id}`)), []);

  useEffect(() => {
    const t = setTimeout(() => load().catch((e: Error) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    setProfile(null);
    if (selectedId) loadProfile(selectedId).catch((e: Error) => setError(e.message));
  }, [selectedId, loadProfile]);

  const refreshAll = async () => {
    await load();
    if (selectedId) await loadProfile(selectedId);
  };

  async function exportExcel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/export/donors.xlsx');
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `fffa-donors-${today()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1fr_420px]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, organisation, email or mobile" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none" />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
            <option value="">All types</option>
            <option value="individual">Individuals</option>
            <option value="corporate">Corporates</option>
            <option value="grant_funder">Grant funders</option>
          </select>
          <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add donor
          </button>
          {me?.role === 'admin' && (
            <button onClick={exportExcel} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export to Excel
            </button>
          )}
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}
        {adding && <AddDonor onDone={async (id) => { setAdding(false); await load(); setSelectedId(id); }} onError={setError} />}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Donor</th>
                <th className="px-4 py-2">Tier</th>
                <th className="px-4 py-2 text-right">Last 12 months</th>
                <th className="px-4 py-2">Last gift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {donors?.map((d) => (
                <tr key={d.id} onClick={() => setSelectedId(d.id)} className={`cursor-pointer hover:bg-slate-50 ${d.id === selectedId ? 'bg-emerald-50' : ''}`}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-slate-900">
                      {nameOf(d)} {d.summary?.is_major && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Major</span>}
                    </p>
                    {d.organisation_name && <p className="text-xs text-slate-500">Contact: {[d.first_name, d.last_name].filter(Boolean).join(' ') || '–'}</p>}
                  </td>
                  <td className="px-4 py-2 capitalize text-slate-600">{d.summary?.tier ?? '–'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{sgd(d.summary?.giving_12m_sgd)}</td>
                  <td className="px-4 py-2 text-slate-500">{day(d.summary?.last_donation_on)}</td>
                </tr>
              ))}
              {donors?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No donors yet. Use the Import tab to load an Excel file.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">{donors ? `${donors.length} donors` : 'Loading…'}</p>
      </section>

      <aside>
        {!selectedId && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">Select a donor to see their profile and log a donation.</p>}
        {selectedId && !profile && <p className="text-sm text-slate-400">Loading…</p>}
        {profile && <Profile profile={profile} onChanged={refreshAll} onError={setError} />}
      </aside>
    </div>
  );
}

function AddDonor({ onDone, onError }: { onDone: (id: string) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ donor_type: 'individual' as DonorType, organisation_name: '', first_name: '', last_name: '', email: '', mobile: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    api.post<{ id: string }>('/api/donors', f).then((d) => onDone(d.id)).catch((e: Error) => onError(e.message));
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <label className="text-xs text-slate-500">Type<select value={f.donor_type} onChange={set('donor_type')} className={inputCls}><option value="individual">Individual</option><option value="corporate">Corporate</option><option value="grant_funder">Grant funder</option></select></label>
      <label className="text-xs text-slate-500">Organisation<input value={f.organisation_name} onChange={set('organisation_name')} className={inputCls} placeholder="Corporates / funders" /></label>
      <label className="text-xs text-slate-500">First name (or contact)<input value={f.first_name} onChange={set('first_name')} className={inputCls} /></label>
      <label className="text-xs text-slate-500">Last name<input value={f.last_name} onChange={set('last_name')} className={inputCls} /></label>
      <label className="text-xs text-slate-500">Email<input value={f.email} onChange={set('email')} className={inputCls} /></label>
      <label className="text-xs text-slate-500">Mobile<input value={f.mobile} onChange={set('mobile')} className={inputCls} /></label>
      <div className="col-span-2"><button onClick={save} className={btnCls}>Save donor</button></div>
    </div>
  );
}

function Profile({ profile, onChanged, onError }: { profile: DonorProfile; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const { donor: d, summary: s } = profile;
  const isOrg = d.donor_type !== 'individual';
  const [kind, setKind] = useState<'cash' | 'in_kind'>('cash');
  const [g, setG] = useState({ donated_on: today(), amount_sgd: '', in_kind_description: '', estimated_value_sgd: '', channel: 'bank' as DonationChannel, campaign: '', is_recurring: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    onError('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const logGift = () =>
    act(async () => {
      await api.post(`/api/donors/${d.id}/donations`, {
        kind,
        donated_on: g.donated_on,
        channel: g.channel,
        campaign: g.campaign || null,
        ...(kind === 'cash'
          ? { amount_sgd: Number(g.amount_sgd), is_recurring: g.is_recurring, monthly_amount_sgd: g.is_recurring ? Number(g.amount_sgd) : null }
          : { in_kind_description: g.in_kind_description, estimated_value_sgd: g.estimated_value_sgd ? Number(g.estimated_value_sgd) : null }),
      });
      setG({ ...g, amount_sgd: '', in_kind_description: '', estimated_value_sgd: '', campaign: '' });
    });

  const addNote = () => act(async () => { await api.post(`/api/donors/${d.id}/notes`, { body: note }); setNote(''); });

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{isOrg ? <Building2 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}</div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{nameOf(d)}</h2>
          <p className="text-sm text-slate-500">
            {isOrg ? `${[d.first_name, d.last_name].filter(Boolean).join(' ')}${d.contact_title ? `, ${d.contact_title}` : ''} · ` : ''}
            {d.email ?? 'no email'} · {d.mobile ?? 'no mobile'}
          </p>
        </div>
      </div>

      {s?.is_major && (
        <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <HandHeart className="h-4 w-4 shrink-0" /> Major donor: personal outreach from staff, AI drafting is off.
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-sm">
        {[['Last 12 months', sgd(s?.giving_12m_sgd)], ['Tier', s?.tier ?? '–'], ['Years with FFFA', String(s?.years_with_fffa ?? 0)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium capitalize text-slate-900">{v}</dd></div>
        ))}
      </dl>

      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Donations</h3>
        <ul className="max-h-48 space-y-1 overflow-auto text-sm">
          {profile.donations.map((x) => (
            <li key={x.id} className="flex justify-between gap-2">
              <span className={x.payment_status === 'failed' ? 'text-rose-700' : 'text-slate-700'}>
                {x.kind === 'in_kind' ? `In-kind: ${x.in_kind_description}` : `${sgd(x.amount_sgd)}${x.is_recurring ? ' monthly' : ''}`}
                {x.payment_status === 'failed' && ' (failed)'}
                {x.campaign && <span className="text-slate-400"> · {x.campaign}</span>}
              </span>
              <span className="shrink-0 text-slate-400">{day(x.donated_on)}</span>
            </li>
          ))}
          {profile.donations.length === 0 && <li className="text-slate-400">No gifts yet</li>}
        </ul>
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-900">Log a donation</h3>
        <div className="flex gap-2 text-xs">
          {(['cash', 'in_kind'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 ${kind === k ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{k === 'cash' ? 'Cash' : 'In-kind'}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">Date<input type="date" value={g.donated_on} onChange={(e) => setG({ ...g, donated_on: e.target.value })} className={inputCls} /></label>
          {kind === 'cash' ? (
            <label className="text-xs text-slate-500">Amount (S$)<input type="number" min="0" value={g.amount_sgd} onChange={(e) => setG({ ...g, amount_sgd: e.target.value })} className={inputCls} /></label>
          ) : (
            <label className="text-xs text-slate-500">Estimated value (S$)<input type="number" min="0" value={g.estimated_value_sgd} onChange={(e) => setG({ ...g, estimated_value_sgd: e.target.value })} className={inputCls} /></label>
          )}
          {kind === 'in_kind' && <label className="col-span-2 text-xs text-slate-500">What was given<input value={g.in_kind_description} onChange={(e) => setG({ ...g, in_kind_description: e.target.value })} className={inputCls} placeholder="e.g. 200 packs of rice" /></label>}
          <label className="text-xs text-slate-500">Channel<select value={g.channel} onChange={(e) => setG({ ...g, channel: e.target.value as DonationChannel })} className={inputCls}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs text-slate-500">Campaign<input value={g.campaign} onChange={(e) => setG({ ...g, campaign: e.target.value })} className={inputCls} placeholder="optional" /></label>
        </div>
        {kind === 'cash' && (
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={g.is_recurring} onChange={(e) => setG({ ...g, is_recurring: e.target.checked })} /> Monthly (recurring) gift</label>
        )}
        <button onClick={logGift} disabled={busy} className={btnCls}>Save donation</button>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes & key dates</h3>
        <ul className="space-y-1 text-sm text-slate-700">
          {profile.key_dates.map((k) => <li key={k.id}>📅 {k.label ?? k.kind} · {day(k.due_on)}{k.completed_at ? ' (done)' : ''}</li>)}
          {profile.notes.map((n) => <li key={n.id} className="text-slate-600">{n.body}</li>)}
          {profile.key_dates.length + profile.notes.length === 0 && <li className="text-slate-400">Nothing yet</li>}
        </ul>
        <div className="flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a relationship note" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
          <button onClick={addNote} disabled={busy || !note.trim()} className={btnCls}>Add</button>
        </div>
        <p className="text-xs text-slate-400">Don't put NRIC numbers or sensitive details in notes.</p>
      </div>
    </div>
  );
}
