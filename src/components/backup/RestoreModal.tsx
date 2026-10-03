'use client';

// ---------- «استرجاع» modal ----------
// 1. choose the file (from the device) → parsed & validated
// 2. what to restore: the tables IN THE FILE (TableSelector, «الكل» default)
//    + mode (merge / replace) + confirmation word for replace
// 3. progress (stage → delete → apply → auth) → result

import { useMemo, useRef, useState } from 'react';
import { X, HardDriveUpload, Loader2, CheckCircle2, TriangleAlert, FileJson, Upload, ShieldAlert, MapPin } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import TableSelector from './TableSelector';
import {
  AUTH_USERS_KEY, RESTORE_MODE_LABELS, backupErrorMessage, formatBytes, isFullScope, logBackupRun, parseBackup,
  restoreBackup, restoreWarnings, scopeLabel, tableLabel,
  type BackupFile, type BackupProgress, type BackupTableInfo, type RestoreMode, type RestoreResult,
} from '@/lib/backup';

const PHASE_LABELS: Record<BackupProgress['phase'], string> = {
  dump: 'قراءة', stage: 'رفع البيانات', delete: 'حذف السجلات غير الموجودة في النسخة', apply: 'تطبيق',
  fixup: 'ربط المراجع بين الجداول', auth: 'حسابات الدخول', done: 'انتهى',
};

export default function RestoreModal({
  supabase, catalogue, actorId, onClose, onDone,
}: {
  supabase: SupabaseClient;
  catalogue: BackupTableInfo[];
  actorId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<BackupFile | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [confirmWord, setConfirmWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const known = useMemo(() => new Set(catalogue.map((t) => t.name)), [catalogue]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setFile(null); setResult(null);
    try {
      const parsed = parseBackup(await f.text());
      setFile(parsed);
      setFileMeta({ name: f.name, size: f.size });
      // a scoped file (one church / service / class) can only be merged
      if (!isFullScope(parsed.scope)) { setMode('merge'); setConfirmWord(''); }
      const names = Object.keys(parsed.tables).filter((t) => known.has(t));
      if (parsed.auth_users?.length) names.push(AUTH_USERS_KEY);
      setSelected(new Set(names));
    } catch (e) {
      setError(backupErrorMessage(e));
    }
  };

  const available = useMemo(() => {
    if (!file) return [];
    return Object.entries(file.tables).map(([name, v]) => ({
      name, rows: v.rows.length, note: known.has(name) ? undefined : 'غير موجود في قاعدة البيانات — سيُتجاهل',
    }));
  }, [file, known]);

  const tables = Array.from(selected).filter((t) => t !== AUTH_USERS_KEY && known.has(t));
  const restoreAuth = selected.has(AUTH_USERS_KEY) && !!file?.auth_users?.length;
  const totalRows = tables.reduce((s, t) => s + (file?.tables[t]?.rows.length ?? 0), 0);
  const scopedFile = !!file && !isFullScope(file.scope);
  const canRun = !!file && (tables.length > 0 || restoreAuth) && (mode === 'merge' || (!scopedFile && confirmWord.trim() === 'استبدال'));

  const run = async () => {
    if (!file || !canRun) return;
    setBusy(true); setError(null);
    const runId = await logBackupRun(supabase, {
      kind: 'restore', status: 'running', mode, tables, include_auth: restoreAuth, file_name: fileMeta?.name ?? null,
      size_bytes: fileMeta?.size ?? null, scope: file.scope ?? null, created_by: actorId,
    });
    try {
      const r = await restoreBackup(supabase, { file, tables, mode, restoreAuth, onProgress: setProgress });
      setResult(r);
      const counts = Object.fromEntries(Object.entries(r.tables).map(([k, v]) => [k, v.upserted ?? 0]));
      const warnings = [...(r.auth?.errors ?? []), ...restoreWarnings(r)];
      if (runId) {
        await supabase.from('backup_runs').update({
          status: warnings.length > 0 ? 'partial' : 'done', row_counts: counts, finished_at: new Date().toISOString(),
          error: warnings.length ? warnings.slice(0, 5).join(' | ') : null,
        }).eq('id', runId);
      }
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

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={busy ? undefined : onClose}>
      <div
        id="restore-modal"
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <HardDriveUpload className="h-5 w-5 text-emerald-600" /> استرجاع نسخة احتياطية
          </h3>
          <button onClick={onClose} disabled={busy} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="space-y-3 py-4">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
              <p className="text-center font-extrabold">تم الاسترجاع</p>
              <ul className="divide-y divide-indigo-50 rounded-2xl border border-indigo-50 text-xs">
                {Object.entries(result.tables).map(([t, v]) => (
                  <li key={t} className="flex items-center justify-between px-3 py-2">
                    <span className="font-bold">{tableLabel(t)}</span>
                    <span className="tabular-nums text-slate-500">
                      {v.upserted ?? 0} سجل{v.deleted ? ` · حُذف ${v.deleted}` : ''}
                      {v.skipped ? <span className="text-amber-600"> · تُجاوز {v.skipped}</span> : null}
                      {v.unresolved ? <span className="text-amber-600"> · {v.unresolved} مرجع مفقود</span> : null}
                    </span>
                  </li>
                ))}
                {result.auth && (
                  <li className="flex items-center justify-between px-3 py-2">
                    <span className="font-bold">{tableLabel(AUTH_USERS_KEY)}</span>
                    <span className="tabular-nums text-slate-500">
                      أُنشئ {result.auth.created} · حُدّث {result.auth.updated}{result.auth.failed ? ` · فشل ${result.auth.failed}` : ''}
                    </span>
                  </li>
                )}
              </ul>
              {result.auth?.errors?.length ? (
                <div className="rounded-2xl bg-amber-50 px-4 py-3 text-[11px] text-amber-700">
                  {result.auth.errors.slice(0, 5).map((e, i) => <p key={i} dir="ltr" className="truncate">{e}</p>)}
                </div>
              ) : null}
              {restoreWarnings(result).length > 0 && (
                <div className="space-y-1 rounded-2xl bg-amber-50 px-4 py-3 text-[11px] text-amber-700">
                  <p className="font-bold">اكتمل الاسترجاع مع ملاحظات:</p>
                  {restoreWarnings(result).map((w, i) => <p key={i}>{w}</p>)}
                </div>
              )}
              {result.skipped.length > 0 && (
                <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  جداول في الملف غير موجودة في قاعدة البيانات وتم تجاهلها: {result.skipped.join('، ')}
                </p>
              )}
            </div>
          ) : busy ? (
            <div className="space-y-4 py-6">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-500" />
              <p className="text-center text-sm font-bold">
                {progress ? PHASE_LABELS[progress.phase] : 'جارٍ التجهيز…'}{progress?.table ? ` — ${tableLabel(progress.table)}` : ''}
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-l from-emerald-600 to-emerald-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-center text-xs tabular-nums text-slate-400">{pct}%</p>
              <p className="text-center text-xs font-bold text-amber-600">لا تغلق الصفحة حتى ينتهي الاسترجاع</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 1. file */}
              <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              <button
                id="restore-pick-file"
                type="button"
                onClick={() => inputRef.current?.click()}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 text-right transition ${
                  file ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                {file ? <FileJson className="h-8 w-8 shrink-0 text-emerald-600" /> : <Upload className="h-8 w-8 shrink-0 text-slate-400" />}
                <span className="flex-1 min-w-0">
                  {file && fileMeta ? (
                    <>
                      <span className="block truncate text-sm font-extrabold" dir="ltr">{fileMeta.name}</span>
                      <span className="block text-xs text-slate-500">
                        {formatBytes(fileMeta.size)} · {Object.keys(file.tables).length} جدول
                        {file.auth_users?.length ? ` · ${file.auth_users.length} حساب دخول` : ''}
                        {file.created_at ? ` · ${new Date(file.created_at).toLocaleString('ar-EG')}` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block text-sm font-extrabold">اختر ملف النسخة الاحتياطية من جهازك</span>
                      <span className="block text-xs text-slate-400">ملف JSON تم تحميله من زر «نسخة احتياطية»</span>
                    </>
                  )}
                </span>
              </button>

              {file && (
                <>
                  {/* 1b. scope of the file (20261009) */}
                  <p id="restore-file-scope" className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-xs font-bold ${scopedFile ? 'bg-primary-50 text-primary-700' : 'bg-slate-50 text-slate-500'}`}>
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span>
                      {scopeLabel(file.scope)}
                      {scopedFile && <span className="block font-normal text-primary-600">نسخة لنطاق محدد — تُسترجع بوضع «دمج» فقط؛ الاستبدال كان سيحذف كل ما خارج النطاق.</span>}
                    </span>
                  </p>

                  {/* 2. mode */}
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(RESTORE_MODE_LABELS) as RestoreMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-mode={m}
                        disabled={m === 'replace' && scopedFile}
                        onClick={() => setMode(m)}
                        className={`rounded-2xl border-2 px-3 py-3 text-right transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          mode === m
                            ? m === 'replace' ? 'border-red-400 bg-red-50' : 'border-emerald-400 bg-emerald-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`block text-sm font-extrabold ${m === 'replace' ? 'text-red-700' : ''}`}>{RESTORE_MODE_LABELS[m].label}</span>
                        <span className="block text-[11px] text-slate-500">{RESTORE_MODE_LABELS[m].desc}</span>
                      </button>
                    ))}
                  </div>
                  {mode === 'replace' && (
                    <div className="space-y-2 rounded-2xl bg-red-50 px-4 py-3">
                      <p className="flex items-start gap-2 text-xs font-bold text-red-700">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        الاستبدال يحذف من الجداول المختارة كل سجل غير موجود في النسخة (وما يتبعه بالحذف المتسلسل). اكتب «استبدال» للتأكيد.
                      </p>
                      <input
                        id="restore-confirm-word"
                        value={confirmWord}
                        onChange={(e) => setConfirmWord(e.target.value)}
                        placeholder="استبدال"
                        className="input-field !py-2 text-center"
                      />
                    </div>
                  )}

                  {/* 3. tables */}
                  <p className="text-xs font-bold text-slate-500">ماذا تريد أن تسترجع؟</p>
                  <TableSelector
                    available={available}
                    selected={selected}
                    onChange={setSelected}
                    showAuth={!!file.auth_users?.length}
                    authRows={file.auth_users?.length}
                    compact
                  />
                </>
              )}
            </div>
          )}
          {error && (
            <p className="mt-3 flex items-start gap-2 whitespace-pre-line break-words rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
              <TriangleAlert className="h-4 w-4 shrink-0" /> <span>{error}</span>
            </p>
          )}
        </div>

        <div className="border-t border-indigo-50 px-5 py-3">
          {result ? (
            <button onClick={onClose} className="btn-primary w-full">تم</button>
          ) : (
            <button
              id="restore-start-btn"
              onClick={run}
              disabled={!canRun || busy}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === 'replace' ? 'bg-gradient-to-l from-red-600 to-red-500' : 'bg-gradient-to-l from-emerald-600 to-emerald-500'
              }`}
            >
              <HardDriveUpload className="h-5 w-5" />
              {mode === 'replace' ? 'استبدال' : 'استرجاع'} {tables.length + (restoreAuth ? 1 : 0)} جدول · {totalRows.toLocaleString('ar-EG')} سجل
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
