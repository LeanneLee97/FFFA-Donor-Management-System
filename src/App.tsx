import { useEffect, useState } from 'react';
import type { Staff } from '../shared/types.ts';

/**
 * Placeholder shell while Phase 1 screens are built (Chris, design section 7).
 * The previous AI Studio demo UI lives on the legacy/ai-studio-demo branch.
 */
export default function App() {
  const [health, setHealth] = useState<{ ok: boolean; ai: string } | null>(null);
  const [me, setMe] = useState<Staff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/health').then((r) => r.json()),
      fetch('/api/me').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/me: ${r.status}`)))),
    ])
      .then(([h, m]) => {
        setHealth(h);
        setMe(m);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Free Food For All</p>
      <h1 className="mt-1 text-2xl font-bold">Donor Management MVP</h1>
      <p className="mt-2 text-slate-600">Phase 1 build in progress. Screens land here as each slice is ready.</p>
      <dl className="mt-6 space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">API</dt>
          <dd>{error ? `Error: ${error}` : health?.ok ? 'Running' : 'Checking…'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">AI drafting</dt>
          <dd>{health?.ai ?? '…'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Signed in as</dt>
          <dd>{me ? `${me.name} (${me.role})` : '…'}</dd>
        </div>
      </dl>
    </main>
  );
}
