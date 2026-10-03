'use client';

// ---------- /owner/backup — النسخ الاحتياطي والاسترجاع (migration 0044 · 20261009120000) ----------
// Part of the OWNER module (وحدة المالك) — only role = owner. Two big
// actions (backup → device, restore ← device), the scheduled backups
// (server, private bucket, downloadable from history) and the history of
// every run. A backup may cover the whole database or ONE church / service /
// class (نطاق النسخة); the old /settings/backup path redirects here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, DatabaseBackup, HardDriveDownload, HardDriveUpload, CalendarClock, Plus, Pencil, Trash2,
  Play, Loader2, History, Download, Crown, KeyRound, Table2, CheckCircle2, XCircle, Clock, Power, MapPin,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import BackupModal from '@/components/backup/BackupModal';
import RestoreModal from '@/components/backup/RestoreModal';
import ScheduleFormModal from '@/components/backup/ScheduleFormModal';
import { fetchScopeLookups, type ScopeLookups } from '@/components/backup/BackupScopePicker';
import {
  FREQUENCY_LABELS, RUN_KIND_LABELS, RUN_STATUS_LABELS, backupErrorMessage, fetchBackupTables, formatBytes, isFullScope, scopeLabel, tableLabel,
  type BackupRun, type BackupSchedule, type BackupTableInfo,
} from '@/lib/backup';
import { WEEKDAY_LABELS } from '@/lib/time';

const APP_VERSION = '0.2.0';

export default function BackupPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const isOwner = profile?.role === 'owner' && profile.status === 'approved';

  const [catalogue, setCatalogue] = useState<BackupTableInfo[]>([]);
  const [authRows, setAuthRows] = useState<number | undefined>();
  const [lookups, setLookups] = useState<ScopeLookups | null>(null);   // churches → services → classes (scope picker)
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showBackup, setShowBackup] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<{ open: boolean; schedule: BackupSchedule | null }>({ open: false, schedule: null });
  const [runningNow, setRunningNow] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCatalogue = useCallback(async () => {
    try {
      const [cat, lk] = await Promise.all([fetchBackupTables(supabase), fetchScopeLookups(supabase)]);
      setCatalogue(cat);
      setLookups(lk);
      const { count } = await supabase.from('servant_enrollments').select('id', { count: 'exact', head: true });
      setAuthRows(count ?? undefined);
      setError(null);
    } catch (e) {
      setError(backupErrorMessage(e));
    }
  }, [supabase]);

  const loadLists = useCallback(async () => {
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from('backup_schedules').select('*').order('created_at'),
      supabase.from('backup_runs').select('*').order('created_at', { ascending: false }).limit(60),
    ]);
    setSchedules((s as BackupSchedule[]) ?? []);
    setRuns((r as BackupRun[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    if (!isOwner) { setLoading(false); return; }
    Promise.all([loadCatalogue(), loadLists()]).finally(() => setLoading(false));
  }, [isOwner, loadCatalogue, loadLists]);

  useDebouncedRealtime(supabase, 'backup-page', [{ table: 'backup_runs' }, { table: 'backup_schedules' }], loadLists, { enabled: isOwner });

  const totalRows = useMemo(() => catalogue.reduce((s, t) => s + t.rows, 0), [catalogue]);

  const toggleSchedule = async (s: BackupSchedule) => {
    await supabase.from('backup_schedules').update({ enabled: !s.enabled }).eq('id', s.id);
    loadLists();
  };
  const removeSchedule = async (s: BackupSchedule) => {
    if (!confirm(`حذف النسخة المجدولة «${s.name}»؟ الملفات المحفوظة تبقى في السجل.`)) return;
    await supabase.from('backup_schedules').delete().eq('id', s.id);
    loadLists();
  };
  const runNow = async (s: BackupSchedule) => {
    setRunningNow(s.id); setNotice(null);
    try {
      const res = await fetch('/api/backup/cron', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule_id: s.id }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; results?: { error?: string }[] };
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setNotice(data.ok ? `تم تنفيذ «${s.name}» وحُفظ الملف — حمّله من السجل.` : `فشلت النسخة: ${data.results?.[0]?.error ?? ''}`);
    } catch (e) {
      setNotice(backupErrorMessage(e));
    } finally {
      setRunningNow(null); loadLists();
    }
  };
  const deleteRun = async (r: BackupRun) => {
    if (!confirm(r.storage_path ? 'حذف هذا السجل وملفه المحفوظ؟' : 'حذف هذا السجل؟')) return;
    if (r.storage_path) {
      await fetch(`/api/backup/file?run=${r.id}`, { method: 'DELETE' });
    } else {
      await supabase.from('backup_runs').delete().eq('id', r.id);
    }
    loadLists();
  };

  const scheduleWhen = (s: BackupSchedule) => {
    const h = s.hour === 0 ? '12 ص' : s.hour < 12 ? `${s.hour} ص` : s.hour === 12 ? '12 م' : `${s.hour - 12} م`;
    if (s.frequency === 'daily') return `يوميًا ${h}`;
    if (s.frequency === 'weekly') return `كل ${WEEKDAY_LABELS[s.weekday]} ${h}`;
    return `يوم ${s.day_of_month} من كل شهر ${h}`;
  };

  return (
    <AppShell>
      <OwnerGate>
      <Header />

      <p className="mb-4 rounded-2xl bg-gold-50 px-4 py-3 text-xs font-bold text-gold-700">
        <Crown className="ml-1 inline h-3.5 w-3.5" />
        أداة خاصة بمالك التطبيق — النسخة الاحتياطية ملف واحد يُحمَّل على جهازك ويحوي <strong>كل البيانات</strong> أو <strong>كنيسة / خدمة / فصلًا بعينه</strong> بما تختاره من الجداول،
        ويمكن استرجاعه من نفس الصفحة — دمجًا أو استبدالاً (نسخ النطاق تُدمَج فقط). النسخ المجدولة تُنفَّذ تلقائيًا على الخادم وتُحمَّل من السجل.
      </p>

      {error && <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}
      {notice && <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">{notice}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <>
          {/* Overview */}
          <section className="card mb-4 grid grid-cols-3 gap-2 text-center">
            <Stat icon={<Table2 className="h-4 w-4 text-primary-500" />} value={catalogue.length} label="جدول" />
            <Stat icon={<DatabaseBackup className="h-4 w-4 text-emerald-500" />} value={totalRows} label="سجل" />
            <Stat icon={<KeyRound className="h-4 w-4 text-amber-500" />} value={authRows ?? 0} label="حساب دخول" />
          </section>

          {/* Actions */}
          <section className="mb-5 grid grid-cols-2 gap-3">
            <button id="open-backup-btn" onClick={() => setShowBackup(true)} className="card flex flex-col items-center gap-2 !py-5 hover:bg-primary-50/40 transition">
              <span className="rounded-2xl bg-primary-100 p-3"><HardDriveDownload className="h-7 w-7 text-primary-600" /></span>
              <span className="font-extrabold">نسخة احتياطية</span>
              <span className="text-[11px] text-slate-400">الكل أو كنيسة / خدمة / فصل — الملف يُحمَّل على الجهاز</span>
            </button>
            <button id="open-restore-btn" onClick={() => setShowRestore(true)} className="card flex flex-col items-center gap-2 !py-5 hover:bg-emerald-50/40 transition">
              <span className="rounded-2xl bg-emerald-100 p-3"><HardDriveUpload className="h-7 w-7 text-emerald-600" /></span>
              <span className="font-extrabold">استرجاع</span>
              <span className="text-[11px] text-slate-400">من ملف على الجهاز — اختر الكل أو جداول محددة</span>
            </button>
          </section>

          {/* Schedules */}
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-500">
                <CalendarClock className="h-4 w-4 text-violet-600" /> النسخ المجدولة
                <span className="badge bg-violet-100 text-violet-700">{schedules.length}</span>
              </h3>
              <button id="add-schedule-btn" onClick={() => setScheduleForm({ open: true, schedule: null })} className="btn-primary !py-1.5 !px-3 flex items-center gap-1 text-xs">
                <Plus className="h-4 w-4" /> جدولة
              </button>
            </div>
            {schedules.length === 0 ? (
              <p className="card text-center text-xs font-bold text-slate-400">لا توجد نسخ مجدولة — أضف جدولة يومية أو أسبوعية أو شهرية.</p>
            ) : (
              <ul className="space-y-2">
                {schedules.map((s) => (
                  <li key={s.id} className={`card flex items-start gap-3 ${s.enabled ? '' : 'opacity-60'}`}>
                    <button onClick={() => toggleSchedule(s)} aria-label={s.enabled ? 'إيقاف' : 'تفعيل'} className={`rounded-xl p-2 ${s.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      <Power className="h-5 w-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold">{s.name}</p>
                        <span className="badge bg-violet-100 text-violet-700">{FREQUENCY_LABELS[s.frequency]}</span>
                        {s.last_status && (
                          <span className={`badge ${s.last_status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            آخر تنفيذ: {s.last_status === 'done' ? 'تمّ' : 'فشل'}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{scheduleWhen(s)} · {s.tables?.length ? `${s.tables.length} جدول` : 'كل الجداول'}{s.include_auth ? ' + حسابات الدخول' : ''} · يحتفظ بآخر {s.keep_last}</p>
                      {!isFullScope(s.scope) && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-primary-600"><MapPin className="h-3 w-3" /> {scopeLabel(s.scope)}</p>
                      )}
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock className="h-3 w-3" />
                        {s.next_run_at ? `التالي: ${new Date(s.next_run_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}` : 'غير مجدول'}
                        {s.last_run_at ? ` · السابق: ${new Date(s.last_run_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button onClick={() => runNow(s)} disabled={runningNow === s.id} aria-label="تشغيل الآن" className="rounded-xl bg-primary-50 p-2 text-primary-600 hover:bg-primary-100 disabled:opacity-50">
                        {runningNow === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button onClick={() => setScheduleForm({ open: true, schedule: s })} aria-label="تعديل" className="rounded-xl bg-violet-50 p-2 text-violet-600 hover:bg-violet-100"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => removeSchedule(s)} aria-label="حذف" className="rounded-xl bg-red-50 p-2 text-red-600 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* History */}
          <section className="mb-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-500">
              <History className="h-4 w-4 text-slate-500" /> السجل
              <span className="badge bg-slate-100 text-slate-600">{runs.length}</span>
            </h3>
            {runs.length === 0 ? (
              <p className="card text-center text-xs font-bold text-slate-400">لا توجد عمليات بعد.</p>
            ) : (
              <ul className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                {runs.map((r) => {
                  const rows = Object.values(r.row_counts ?? {}).reduce((s, n) => s + Number(n || 0), 0);
                  return (
                    <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-0.5 rounded-xl p-2 ${r.kind === 'restore' ? 'bg-emerald-50' : r.kind === 'scheduled' ? 'bg-violet-50' : 'bg-primary-50'}`}>
                        {r.kind === 'restore' ? <HardDriveUpload className="h-4 w-4 text-emerald-600" /> : r.kind === 'scheduled' ? <CalendarClock className="h-4 w-4 text-violet-600" /> : <HardDriveDownload className="h-4 w-4 text-primary-600" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-extrabold">{RUN_KIND_LABELS[r.kind]}{r.mode ? ` · ${r.mode === 'replace' ? 'استبدال' : 'دمج'}` : ''}</p>
                          <span className={`badge ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : r.status === 'failed' ? 'bg-red-100 text-red-700' : r.status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                            {r.status === 'done' ? <CheckCircle2 className="h-3 w-3" /> : r.status === 'failed' ? <XCircle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                            {RUN_STATUS_LABELS[r.status]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {new Date(r.created_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}
                          {' · '}{r.tables.length ? `${r.tables.length} جدول` : 'كل الجداول'}{r.include_auth ? ' + حسابات' : ''}
                          {rows ? ` · ${rows.toLocaleString('ar-EG')} سجل` : ''}{r.size_bytes ? ` · ${formatBytes(r.size_bytes)}` : ''}
                        </p>
                        {!isFullScope(r.scope) && (
                          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-bold text-primary-600"><MapPin className="h-3 w-3 shrink-0" /> {scopeLabel(r.scope)}</p>
                        )}
                        {r.tables.length > 0 && r.tables.length <= 6 && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">{r.tables.map(tableLabel).join(' · ')}</p>
                        )}
                        {r.error && <p className="mt-0.5 truncate text-[11px] text-red-500">{r.error}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {r.storage_path && (
                          <a href={`/api/backup/file?run=${r.id}`} download aria-label="تحميل الملف" className="rounded-xl bg-primary-50 p-2 text-primary-600 hover:bg-primary-100">
                            <Download className="h-4 w-4" />
                          </a>
                        )}
                        <button onClick={() => deleteRun(r)} aria-label="حذف" className="rounded-xl bg-slate-50 p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {showBackup && (
        <BackupModal
          supabase={supabase} catalogue={catalogue} authRows={authRows} actorId={profile?.id ?? null} appVersion={APP_VERSION} lookups={lookups}
          onClose={() => setShowBackup(false)} onDone={loadLists}
        />
      )}
      {showRestore && (
        <RestoreModal
          supabase={supabase} catalogue={catalogue} actorId={profile?.id ?? null}
          onClose={() => setShowRestore(false)} onDone={() => { loadLists(); loadCatalogue(); }}
        />
      )}
      {scheduleForm.open && (
        <ScheduleFormModal
          supabase={supabase} catalogue={catalogue} actorId={profile?.id ?? null} schedule={scheduleForm.schedule} lookups={lookups}
          onClose={() => setScheduleForm({ open: false, schedule: null })} onSaved={loadLists}
        />
      )}
      </OwnerGate>
    </AppShell>
  );
}

function Header() {
  return (
    <section className="mb-4 flex items-center gap-2">
      <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <DatabaseBackup className="h-5 w-5 text-primary-600" />
        النسخ الاحتياطي والاسترجاع
        <Crown className="h-4 w-4 text-gold-500" />
      </h2>
    </section>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div>
      <p className="flex items-center justify-center gap-1 text-lg font-extrabold tabular-nums">{icon}{value.toLocaleString('ar-EG')}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}
