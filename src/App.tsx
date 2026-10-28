import { useEffect, useState } from 'react';
import type { Staff } from '../shared/types.ts';
import AiDraftingPage from './features/ai-drafting/AiDraftingPage.tsx';
import DashboardPage from './features/dashboard/DashboardPage.tsx';
import DonorsPage from './features/donors/DonorsPage.tsx';
import ExcelImportPage from './features/excel-import/ExcelImportPage.tsx';
import SettingsPage from './features/settings/SettingsPage.tsx';
import { api } from './lib/api.ts';

/**
 * App shell. Currently hosts the AI drafting screen (DM10); the other Phase 1 screens
 * (Today, Donors, Import, Settings) slot in here as they land (Chris).
 */
export default function App() {
  const [me, setMe] = useState<Staff | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [page, setPage] = useState<'follow-ups' | 'donors' | 'dashboard' | 'import' | 'settings'>('follow-ups');

  useEffect(() => {
    api.get<Staff>('/api/me').then(setMe).catch(() => setMe(null));
    api.get<{ ai: string }>('/api/health').then((h) => setAi(h.ai)).catch(() => setAi(null));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Free Food For All</p>
            <h1 className="text-lg font-bold text-slate-900">Donor management</h1>
          </div>
          <nav className="flex gap-1 text-sm">
            {([['follow-ups', 'Follow-ups'], ['donors', 'Donors'], ['dashboard', 'Dashboard'], ['import', 'Import'], ...(me?.role === 'admin' ? [['settings', 'Settings'] as const] : [])] as const).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`rounded-lg px-3 py-1.5 font-medium ${page === p ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="text-right text-xs text-slate-500">
            {me && (
              <p>
                {me.name} · {me.role}
              </p>
            )}
            {ai && <p>AI: {ai}</p>}
          </div>
        </div>
      </header>
      {page === 'follow-ups' && <AiDraftingPage />}
      {page === 'donors' && <DonorsPage me={me} />}
      {page === 'dashboard' && <DashboardPage />}
      {page === 'import' && <ExcelImportPage />}
      {page === 'settings' && <SettingsPage />}
    </div>
  );
}
