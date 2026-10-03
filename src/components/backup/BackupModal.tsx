'use client';

// ---------- «نسخة احتياطية» modal ----------
// Step 1: the SCOPE (الكل · كنيسة · خدمة · فصل — 20261009120000) + what to back
// up (TableSelector, «الكل» default; row counts follow the scope) → step 2:
// progress → the file is downloaded to the device + a row in backup_runs.

import { useEffect, useMemo, useState } from 'react';
import { X, HardDriveDownload, Loader2, CheckCircle2, TriangleAlert, MapPin } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import TableSelector from './TableSelector';
import BackupScopePicker, { type ScopeLookups } from './BackupScopePicker';
import {
  AUTH_USERS_KEY, backupErrorMessage, backupFileName, downloadBackup, exportBackup, fetchBackupTables,
  formatBytes, isFullScope, logBackupRun, scopeLabel, serializeBackup, tableLabel,
  type BackupProgress, type BackupScope, type BackupTableInfo,
} from '@/lib/backup';

export default function BackupModal({
  supabase, catalogue, authRows, actorId, appVersion, lookups, onClose, onDone,
}: {
  supabase: SupabaseClient;
  /** full-database catalogue (used while scope = الكل) */
  catalogue: BackupTableInfo[];
  authRows?: number;
  actorId: string | null;
  appVersion: string;
  lookups: ScopeLookups | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; size: number; rows: number; scope: string } | null>(null);

  const [scope, setScope] = useState<BackupScope | null>(null);
  const [scopedCat, setScopedCat] = useState<BackupTableInfo[] | null>(null);
  const [scopedAuth, setScopedAuth] = useState<number | undefined>();
  const [catLoading, setCatLoading] = useState(false);

  // the catalogue (row counts) follows the scope
  useEffect(() => {
    if (isFullScope(scope)) { setScopedCat(null); setScopedAuth(undefined); return; }
    let alive = true;
    setCatLoading(true);
    fetchBackupTables(supabase, scope)
      .then(async (cat) => {
        if (!alive) return;
        setScopedCat(cat);
        const { data } = await supabase.rpc('backup_dump_auth_users', { p_scope: scope });
        if (alive) setScopedAuth(Array.isArray(data) ? data.length : undefined);
      })
      .catch((e) => { if (alive) setError(backupErrorMessage(e)); })
      .finally(() => { if (alive) setCatLoading(false); });
    return () => { alive = false; };
  }, [scope, supabase]);

  const effCat = scopedCat ?? catalogue;
  const effAuth = scopedCat ? scopedAuth : authRows;

  const all = useMemo(() => new Set([...catalogue.map((t) => t.name), AUTH_USERS_KEY]), [catalogue]);
  const [selected, setSelected] = useState<Set<string>>(all);
  useEffect(() => setSelected(all), [all]);

  const tables = Array.from(selected).filter((n) => n !== AUTH_USERS_KEY);
  const includeAuth = selected.has(AUTH_USERS_KEY);
  const scopeRows = effCat.reduce((s, t) => s + (selected.has(t.name) ? t.rows : 0), 0);

  const run = async () => {
    if (selected.size === 0) { setError('اختر جدولاً واحدًا على الأقل'); return; }
    setBusy(true); setError(null);
    const runId = await logBackupRun(supabase, { kind: 'manual', status: 'running', tables, include_auth: includeAuth, scope: scope ?? null, created_by: actorId });
    try {
      const file = await exportBackup(supabase, { tables, includeAuth, kind: 'manual', appVersion, scope, catalogue: effCat, onProgress: setProgress });
      const name = backupFileName('manual', new Date(), file.scope);
      const size = new Blob([serializeBackup(file)]).size;
      downloadBackup(file, name);
      const rows = Object.values(file.counts).reduce((s, n) => s + n, 0);
      if (runId) {
        await supabase.from('backup_runs').update({
          status: 'done', row_counts: file.counts, size_bytes: size, file_name: name, scope: file.scope ?? null, finished_at: new Date().toISOString(),
        }).eq('id', runId);
      }
      setResult({ name, size, rows, scope: scopeLabel(file.scope) });
      onDone();
    } catch (e) {
      const msg = backupErrorMessage(e);
      setError(msg);
      if (runId) await supabase.from('backup_runs').update({ status: 'failed', error: msg, finished_at: new Date().toISOString() }).eq('id', runId);
    } finally {
      setBusy(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const scoped = !isFullScope(scope);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={busy ? undefined : onClose}>
      <div
        id="backup-modal"
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <HardDriveDownload className="h-5 w-5 text-primary-600" /> نسخة احتياطية جديدة
          </h3>
          <button onClick={onClose} disabled={busy} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="space-y-3 py-6 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
              <p className="font-extrabold">تم تحميل النسخة الاحتياطية على جهازك</p>
              <p className="text-xs font-bold text-primary-700">{result.scope}</p>
              <p className="text-xs text-slate-500" dir="ltr">{result.name}</p>
              <p className="text-xs text-slate-400">{result.rows.toLocaleString('ar-EG')} سجل · {formatBytes(result.size)}</p>
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                احتفظ بالملف في مكان آمن — يحوي بيانات المخدومين{includeAuth ? ' وكلمات المرور المشفّرة للخدام' : ''}.
              </p>
            </div>
          ) : busy ? (
            <div className="space-y-4 py-6">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary-500" />
              <p className="text-center text-sm font-bold">
                {progress?.phase === 'auth' ? 'حسابات دخول الخدام…' : progress?.table ? tableLabel(progress.table) : 'جارٍ التجهيز…'}
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-l from-primary-600 to-primary-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-center text-xs tabular-nums text-slate-400">
                {progress ? `${progress.done.toLocaleString('ar-EG')} / ${progress.total.toLocaleString('ar-EG')} سجل` : ''} · {pct}%
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 rounded-2xl bg-primary-50 px-4 py-3 text-xs font-bold text-primary-700">
                ماذا تريد أن تنسخ؟ اختر «الكل» لنسخة كاملة، أو كنيسة / خدمة / فصل بعينه. الملف يُحمَّل على جهازك بصيغة JSON ويمكن استرجاعه من نفس الصفحة.
              </p>

              <section className="mb-4">
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                  <MapPin className="h-4 w-4 text-primary-500" /> نطاق النسخة
                </h4>
                <BackupScopePicker value={scope} onChange={setScope} lookups={lookups} />
              </section>

              <section>
                <h4 className="mb-2 flex items-center justify-between text-sm font-extrabold text-slate-600">
                  <span>الجداول</span>
                  {catLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </h4>
                <TableSelector
                  available={effCat.map((t) => ({ name: t.name, rows: t.rows, note: scoped && t.scoped === false ? 'يُنسخ كاملاً — غير مرتبط بالهيكل' : undefined }))}
                  selected={selected}
                  onChange={setSelected}
                  authRows={effAuth}
                  compact
                />
              </section>
            </>
          )}
          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
              <TriangleAlert className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="border-t border-indigo-50 px-5 py-3">
          {result ? (
            <button onClick={onClose} className="btn-primary w-full">تم</button>
          ) : (
            <button id="backup-start-btn" onClick={run} disabled={busy || catLoading || selected.size === 0} className="btn-primary flex w-full items-center justify-center gap-2">
              <HardDriveDownload className="h-5 w-5" />
              {scoped
                ? `نسخ ${selected.size === all.size ? 'كل جداول' : `${selected.size} جدول من`} النطاق (${scopeRows.toLocaleString('ar-EG')} سجل)`
                : selected.size === all.size ? 'نسخ الكل وتحميل الملف' : `نسخ ${selected.size} جدول وتحميل الملف`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
