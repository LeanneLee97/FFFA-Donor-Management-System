import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Copy,
  HandHeart,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import type {
  AiDraft,
  Donation,
  DonorProfile,
  EngagementChannel,
  FollowUpReason,
  QueueItem,
} from '../../../shared/types.ts';
import { api, ApiRequestError } from '../../lib/api.ts';

/**
 * DM10 demo screen: follow-up queue → donor context → AI draft → edit → approve → send → history.
 * The full Today queue and donor profile screens (Chris) can reuse these pieces.
 */

const REASON: Record<FollowUpReason, { label: string; tone: string }> = {
  thank_you_due: { label: 'Thank-you due', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  failed_payment: { label: 'Failed payment', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  key_date: { label: 'Key date', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  cadence_due: { label: 'Going cold', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  lapsed: { label: 'Lapsed', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
  anniversary: { label: 'Anniversary', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  upgrade_candidate: { label: 'Upgrade ask', tone: 'bg-teal-50 text-teal-700 ring-teal-200' },
  manual: { label: 'Check-in', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
};

const CHANNELS: EngagementChannel[] = ['email', 'whatsapp', 'call', 'meeting', 'other'];

const sgd = (n: number | null | undefined) =>
  n == null ? '–' : `S$${n.toLocaleString('en-SG', { maximumFractionDigits: 2 })}`;

function formatDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dueLabel(iso: string) {
  const days = Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  if (days === 0) return 'Due today';
  return days > 0 ? `Due in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} overdue`;
}

function tenure(s: DonorProfile['summary'] | undefined) {
  if (!s?.first_donation_on) return '–';
  if (s.years_with_fffa < 1) return 'Under 1 yr';
  return `${s.years_with_fffa} yr${s.years_with_fffa === 1 ? '' : 's'}`;
}

function giftLabel(d: Donation) {
  if (d.kind === 'in_kind') return `In-kind: ${d.in_kind_description}`;
  return `${sgd(d.amount_sgd)}${d.is_recurring ? ' monthly' : ''}`;
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>;
}

export default function AiDraftingPage() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<EngagementChannel>('email');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = queue?.find((q) => q.id === selectedId) ?? null;

  const loadQueue = useCallback(async () => {
    const items = await api.get<QueueItem[]>('/api/follow-ups');
    setQueue(items);
    return items;
  }, []);

  useEffect(() => {
    loadQueue()
      .then((items) => setSelectedId((id) => id ?? items[0]?.id ?? null))
      .catch((e: Error) => setError(e.message));
  }, [loadQueue]);

  // Load the donor and any draft already in progress whenever the selection changes.
  useEffect(() => {
    setError(null);
    setProfile(null);
    const item = queue?.find((q) => q.id === selectedId);
    showDraft(item?.open_draft ?? null);
    if (!item) return;
    api.get<DonorProfile>(`/api/donors/${item.donor_id}`).then(setProfile).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function showDraft(d: AiDraft | null) {
    setDraft(d);
    setSubject(d?.subject ?? '');
    setBody(d?.body_final ?? d?.body_generated ?? '');
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiRequestError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const generate = () =>
    run('generate', async () => {
      showDraft(await api.post<AiDraft>(`/api/follow-ups/${selectedId}/draft`));
      await loadQueue();
    });

  const approve = () =>
    run('approve', async () => {
      showDraft(await api.post<AiDraft>(`/api/drafts/${draft!.id}/approve`, { subject, body }));
      await loadQueue();
    });

  const discard = () =>
    run('discard', async () => {
      await api.post(`/api/drafts/${draft!.id}/discard`);
      showDraft(null);
      await loadQueue();
    });

  const markSent = () =>
    run('send', async () => {
      await api.post(`/api/drafts/${draft!.id}/mark-sent`, { channel });
      const name = selected?.donor_name ?? 'the donor';
      const items = await loadQueue();
      setSelectedId(items[0]?.id ?? null);
      setNotice(`Sent and saved to ${name}'s history. Follow-up closed.`);
    });

  const copy = () => navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => setNotice('Copied to clipboard.'));

  const mailto = profile?.donor.email
    ? `mailto:${profile.donor.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[340px_1fr]">
      {/* Queue */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Follow-ups</h2>
          <button onClick={() => loadQueue().catch((e: Error) => setError(e.message))} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        {!queue && <p className="text-sm text-slate-500">Loading…</p>}
        {queue?.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No open follow-ups. Run <code className="rounded bg-slate-100 px-1">npm run demo</code> to load demo donors.
          </p>
        )}
        <ul className="space-y-2">
          {queue?.map((q) => (
            <li key={q.id}>
              <button
                onClick={() => {
                  setNotice(null);
                  setSelectedId(q.id);
                }}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  q.id === selectedId ? 'border-emerald-500 bg-white shadow-sm ring-1 ring-emerald-500' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{q.organisation_name ?? q.donor_name}</p>
                    {q.organisation_name && <p className="truncate text-xs text-slate-500">Contact: {q.donor_name}</p>}
                  </div>
                  <Pill className={REASON[q.reason].tone}>{REASON[q.reason].label}</Pill>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{dueLabel(q.due_on)}</span>
                  {q.key_date_label && <span className="truncate">· {q.key_date_label}</span>}
                  {q.is_major && <Pill className="bg-amber-100 text-amber-900 ring-amber-300">Major donor</Pill>}
                  {q.open_draft && <Pill className="bg-slate-100 text-slate-700 ring-slate-200">{q.open_draft.status === 'approved' ? 'Approved' : 'Draft'}</Pill>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Detail */}
      <section className="space-y-4">
        {notice && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> {notice}
          </div>
        )}
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

        {!selected && queue && queue.length > 0 && <p className="text-sm text-slate-500">Select a follow-up.</p>}

        {selected && (
          <>
            <DonorCard item={selected} profile={profile} />

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                  <Sparkles className="h-4 w-4 text-emerald-600" /> Follow-up message
                </h3>
                {draft && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Pill className={draft.source === 'ai' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}>
                      {draft.source === 'ai' ? 'AI draft' : 'Template'}
                    </Pill>
                    <span>{draft.prompt_version}</span>
                  </div>
                )}
              </div>

              {selected.is_major ? (
                <div className="flex gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                  <HandHeart className="h-5 w-5 shrink-0" />
                  <p>
                    <b>Personal outreach.</b> This is a major donor (S$5,000+ a year, 3+ years with FFFA, or tagged by staff), so AI drafting is
                    turned off. Please reach out personally and log the conversation on their profile.
                  </p>
                </div>
              ) : !draft ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-slate-600">
                    Generate a draft from this donor's history and notes. Contact details are never sent to the AI, and nothing is sent until you
                    approve it.
                  </p>
                  <button onClick={generate} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                    {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate draft
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-500">Subject</span>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      disabled={draft.status !== 'draft'}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-500">Message</span>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      disabled={draft.status !== 'draft'}
                      rows={12}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                    />
                  </label>

                  {draft.status === 'draft' && (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={approve} disabled={!!busy || !body.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                        {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                      </button>
                      <button onClick={generate} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        <RefreshCw className="h-4 w-4" /> Regenerate
                      </button>
                      <button onClick={discard} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-60">
                        <Trash2 className="h-4 w-4" /> Discard
                      </button>
                    </div>
                  )}

                  {draft.status === 'approved' && (
                    <div className="space-y-3 rounded-lg bg-slate-50 p-4">
                      <p className="text-sm text-slate-700">Approved. Send it from your own email or WhatsApp, then mark it as sent so it's saved to the donor's history.</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={copy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                          <Copy className="h-4 w-4" /> Copy
                        </button>
                        {mailto && (
                          <a href={mailto} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                            <Mail className="h-4 w-4" /> Open in email
                          </a>
                        )}
                        <span className="mx-1 h-6 w-px bg-slate-300" />
                        <select value={channel} onChange={(e) => setChannel(e.target.value as EngagementChannel)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                          {CHANNELS.map((c) => (
                            <option key={c} value={c}>
                              Sent by {c}
                            </option>
                          ))}
                        </select>
                        <button onClick={markSent} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                          {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Mark as sent
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <History profile={profile} />
          </>
        )}
      </section>
    </div>
  );
}

function DonorCard({ item, profile }: { item: QueueItem; profile: DonorProfile | null }) {
  const d = profile?.donor;
  const s = profile?.summary;
  const isOrg = item.donor_type !== 'individual';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{isOrg ? <Building2 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-900">{item.organisation_name ?? item.donor_name}</h2>
          <p className="text-sm text-slate-500">
            {isOrg ? `${item.donor_name}${d?.contact_title ? `, ${d.contact_title}` : ''} · ${item.donor_type === 'grant_funder' ? 'Grant funder' : 'Corporate'}` : 'Individual donor'}
            {d?.programme_interest.length ? ` · Interested in ${d.programme_interest.join(', ')}` : ''}
          </p>
        </div>
      </div>

      {!profile ? (
        <p className="mt-4 text-sm text-slate-400">Loading donor…</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Last 12 months" value={sgd(s?.giving_12m_sgd)} />
            <Stat label="With FFFA" value={tenure(s)} />
            <Stat label="Tier (internal)" value={s?.tier ? s.tier[0].toUpperCase() + s.tier.slice(1) : '–'} />
            <Stat label="Last contact" value={s?.last_engaged_on ? formatDate(s.last_engaged_on) : 'None logged'} />
          </dl>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Recent gifts</h4>
              <ul className="space-y-1 text-sm">
                {profile.donations.slice(0, 4).map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <span className={g.payment_status === 'failed' ? 'text-rose-700' : 'text-slate-700'}>
                      {giftLabel(g)}
                      {g.payment_status === 'failed' && ' (failed)'}
                      {g.campaign && <span className="text-slate-400"> · {g.campaign}</span>}
                    </span>
                    <span className="shrink-0 text-slate-400">{formatDate(g.donated_on)}</span>
                  </li>
                ))}
                {profile.donations.length === 0 && <li className="text-slate-400">No gifts yet</li>}
              </ul>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Notes & key dates</h4>
              <ul className="space-y-1 text-sm text-slate-700">
                {profile.key_dates.map((k) => (
                  <li key={k.id}>
                    📅 {k.label ?? k.kind} · {formatDate(k.due_on)}
                  </li>
                ))}
                {profile.notes.map((n) => (
                  <li key={n.id} className="text-slate-600">
                    {n.body}
                  </li>
                ))}
                {profile.key_dates.length + profile.notes.length === 0 && <li className="text-slate-400">Nothing yet</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function History({ profile }: { profile: DonorProfile | null }) {
  if (!profile) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 font-semibold text-slate-900">Conversation history</h3>
      {profile.engagements.length === 0 ? (
        <p className="text-sm text-slate-500">No messages logged yet. Sent messages appear here so the history stays with FFFA.</p>
      ) : (
        <ul className="space-y-3">
          {profile.engagements.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-xs text-slate-500">
                <span className="capitalize">{e.channel}</span>
                <span>{formatDate(e.engaged_on)}</span>
              </div>
              {e.message_subject && <p className="mt-1 font-medium text-slate-800">{e.message_subject}</p>}
              {e.message_body ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-emerald-700">Show message</summary>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{e.message_body}</p>
                </details>
              ) : (
                e.summary && <p className="mt-1 text-slate-600">{e.summary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
