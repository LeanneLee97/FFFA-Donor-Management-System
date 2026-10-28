import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import type { ChildPlan, DonorPlan, ImportDecisions, ImportPlan } from '../../../server/services/import.ts';
import { api } from '../../lib/api.ts';
import { downloadTemplate, readWorkbook, type ParsedWorkbook } from './workbook.ts';

/** DM6: upload an Excel workbook in the agreed format, check it, resolve matches, then import. */

const TONE: Record<string, string> = {
  new: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  match: 'bg-sky-50 text-sky-700 ring-sky-200',
  review: 'bg-amber-50 text-amber-800 ring-amber-200',
  duplicate: 'bg-slate-100 text-slate-600 ring-slate-200',
  duplicate_in_file: 'bg-slate-100 text-slate-600 ring-slate-200',
  invalid: 'bg-rose-50 text-rose-700 ring-rose-200',
  orphan: 'bg-rose-50 text-rose-700 ring-rose-200',
};
const LABEL: Record<string, string> = {
  new: 'New',
  match: 'Existing donor',
  review: 'Needs your decision',
  duplicate: 'Already there',
  duplicate_in_file: 'Repeated in file',
  invalid: 'Fix in Excel',
  orphan: 'No matching donor',
};

function Pill({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[status]}`}>{LABEL[status]}</span>;
}

type Result = { donors_created: number; donations_created: number; key_dates_created: number };

export default function ExcelImportPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [decisions, setDecisions] = useState<ImportDecisions>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const check = (p: ParsedWorkbook, d: ImportDecisions) => api.post<ImportPlan>('/api/import/excel/preview', { rows: p.rows, decisions: d }).then(setPlan);

  const onFile = (file: File | undefined) =>
    file &&
    run('read', async () => {
      setResult(null);
      setPlan(null);
      setDecisions({});
      setFileName(file.name);
      const p = await readWorkbook(file);
      setParsed(p);
      if (!p.problems.length) await check(p, {});
    });

  const decide = (row: number, choice: string) =>
    run('check', async () => {
      const next = { ...decisions, [String(row)]: choice };
      setDecisions(next);
      await check(parsed!, next);
    });

  const commit = () =>
    run('commit', async () => {
      const r = await api.post<Result & { plan: ImportPlan }>('/api/import/excel/commit', { rows: parsed!.rows, decisions });
      setResult(r);
      setPlan(null);
      setParsed(null);
      setFileName(null);
    });

  const s = plan?.summary;
  const nothingToWrite = !!s && s.donors_new + s.donations_new + s.key_dates_new === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Import donors from Excel</h2>
        <p className="text-sm text-slate-500">
          Fill in the template, upload it, check the preview, then import. Nothing is saved until you press Import.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-5">
        <button onClick={() => downloadTemplate()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <Download className="h-4 w-4" /> Download template
        </button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          {busy === 'read' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose Excel file
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {fileName && (
          <span className="inline-flex items-center gap-1 text-sm text-slate-600">
            <FileSpreadsheet className="h-4 w-4" /> {fileName}
          </span>
        )}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

      {result && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> Imported {result.donors_created} donors, {result.donations_created} donations and {result.key_dates_created} key dates.
          Open Follow-ups and press the refresh icon to see the follow-ups they trigger.
        </div>
      )}

      {parsed?.problems.map((p) => (
        <div key={p} className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {p}
        </div>
      ))}
      {parsed?.notes.length ? <ul className="list-disc pl-5 text-xs text-slate-500">{parsed.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}

      {plan && s && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="New donors" value={s.donors_new} />
            <Stat label="Existing donors matched" value={s.donors_matched} />
            <Stat label="New donations" value={s.donations_new} />
            <Stat label="New key dates" value={s.key_dates_new} />
            <Stat label="Need your decision" value={s.donors_needing_review} warn={s.donors_needing_review > 0} />
            <Stat label="Rows to fix in Excel" value={s.rows_with_errors} warn={s.rows_with_errors > 0} />
            <Stat label="Skipped (duplicates)" value={s.rows_skipped - s.donors_needing_review} />
          </div>

          <DonorTable rows={plan.donors} decisions={decisions} onDecide={decide} disabled={!!busy} />
          <ChildTable title="Donations" rows={plan.donations} />
          <ChildTable title="Key dates" rows={plan.key_dates} />

          <div className="flex items-center gap-3">
            <button onClick={commit} disabled={!!busy || nothingToWrite} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {busy === 'commit' && <Loader2 className="h-4 w-4 animate-spin" />} Import {s.donors_new} donors, {s.donations_new} donations, {s.key_dates_new} key dates
            </button>
            <p className="text-xs text-slate-500">Rows marked "Fix in Excel", undecided matches and duplicates are skipped. Fix and re-upload to add them.</p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${warn ? 'bg-amber-50' : 'bg-white ring-1 ring-slate-200'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function DonorTable({ rows, decisions, onDecide, disabled }: { rows: DonorPlan[]; decisions: ImportDecisions; onDecide: (row: number, c: string) => void; disabled: boolean }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Donors ({rows.length})</h3>
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map((r) => (
          <li key={r.row} className="space-y-2 px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-800">
                <span className="mr-2 text-xs text-slate-400">Row {r.row}</span>
                {r.name}
                {r.match && <span className="ml-2 text-xs text-slate-500">→ {r.match.name} ({r.match.reason.toLowerCase()})</span>}
              </span>
              <Pill status={r.status} />
            </div>
            {[...r.errors, ...r.warnings].map((m) => (
              <p key={m} className={`text-xs ${r.errors.includes(m) ? 'text-rose-700' : 'text-slate-500'}`}>{m}</p>
            ))}
            {r.status === 'review' && (
              <div className="space-y-1 rounded-lg bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-900">Is this one of these existing donors?</p>
                {r.candidates!.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="radio" name={`d${r.row}`} disabled={disabled} checked={decisions[String(r.row)] === c.id} onChange={() => onDecide(r.row, c.id)} />
                    Yes, same person as {c.name} {c.email ? `· ${c.email}` : ''} <span className="text-slate-400">({c.reason})</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="radio" name={`d${r.row}`} disabled={disabled} checked={decisions[String(r.row)] === 'new'} onChange={() => onDecide(r.row, 'new')} />
                  No, create a new donor
                </label>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-3 text-slate-400">No donor rows.</li>}
      </ul>
    </section>
  );
}

function ChildTable({ title, rows }: { title: string; rows: ChildPlan[] }) {
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">
        {title} ({rows.length})
      </h3>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-auto text-sm">
        {rows.map((r) => (
          <li key={r.row} className="px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-800">
                <span className="mr-2 text-xs text-slate-400">Row {r.row}</span>
                {r.label}
              </span>
              <Pill status={r.status} />
            </div>
            {r.errors.map((m) => (
              <p key={m} className="text-xs text-rose-700">{m}</p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
