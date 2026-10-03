'use client';

// ---------- Scheduled backup — add / edit ----------
// name · frequency (daily / weekly + weekday / monthly + day) · hour (Cairo)
// · scope (الكل · كنيسة · خدمة · فصل — 20261009120000) · what to back up (all or
// a selection) · keep last N files.

import { useMemo, useState } from 'react';
import { X, CalendarClock, Save, Loader2, MapPin } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import TableSelector from './TableSelector';
import BackupScopePicker, { type ScopeLookups } from './BackupScopePicker';
import { AUTH_USERS_KEY, FREQUENCY_LABELS, scopeIds, type BackupFrequency, type BackupSchedule, type BackupScope, type BackupTableInfo } from '@/lib/backup';
import { WEEKDAY_LABELS } from '@/lib/time';

export default function ScheduleFormModal({
  supabase, catalogue, actorId, schedule, lookups, onClose, onSaved,
}: {
  supabase: SupabaseClient;
  catalogue: BackupTableInfo[];
  actorId: string | null;
  schedule: BackupSchedule | null;
  lookups: ScopeLookups | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const allNames = useMemo(() => [...catalogue.map((t) => t.name), AUTH_USERS_KEY], [catalogue]);
  const [name, setName] = useState(schedule?.name ?? 'نسخة مجدولة');
  const [frequency, setFrequency] = useState<BackupFrequency>(schedule?.frequency ?? 'weekly');
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.day_of_month ?? 1);
  const [hour, setHour] = useState(schedule?.hour ?? 3);
  const [keepLast, setKeepLast] = useState(schedule?.keep_last ?? 10);
  const [place, setPlace] = useState<BackupScope | null>(scopeIds(schedule?.scope));
  const [scope, setScope] = useState<'all' | 'custom'>(schedule?.tables?.length ? 'custom' : 'all');
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (!schedule) return new Set(allNames);
    const s = new Set(schedule.tables?.length ? schedule.tables : catalogue.map((t) => t.name));
    if (schedule.include_auth) s.add(AUTH_USERS_KEY);
    return s;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setError(null);
    const tables = scope === 'all' ? null : Array.from(selected).filter((t) => t !== AUTH_USERS_KEY);
    const includeAuth = scope === 'all' ? true : selected.has(AUTH_USERS_KEY);
    if (scope === 'custom' && (tables?.length ?? 0) === 0 && !includeAuth) { setError('اختر جدولاً واحدًا على الأقل'); setSaving(false); return; }
    // the scope is stored with its names so the list can show them without a lookup
    let scopeInfo: Record<string, unknown> | null = null;
    if (place) {
      const { data, error: se } = await supabase.rpc('backup_scope_describe', { p_scope: place });
      if (se) { setError(se.message); setSaving(false); return; }
      scopeInfo = (data as Record<string, unknown> | null) ?? null;
    }
    const row = {
      name: name.trim() || 'نسخة مجدولة', frequency, weekday, day_of_month: dayOfMonth, hour, keep_last: keepLast,
      tables, include_auth: includeAuth, scope: scopeInfo,
    };
    const q = schedule
      ? supabase.from('backup_schedules').update(row).eq('id', schedule.id)
      : supabase.from('backup_schedules').insert({ ...row, created_by: actorId });
    const { error: err } = await q;
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved(); onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div
        id="schedule-modal"
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-white animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <CalendarClock className="h-5 w-5 text-violet-600" /> {schedule ? 'تعديل النسخة المجدولة' : 'نسخة احتياطية مجدولة'}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">الاسم</span>
            <input id="schedule-name" value={name} onChange={(e) => setName(e.target.value)} className="input-field" />
          </label>

          <div>
            <span className="mb-1 block text-xs font-bold text-slate-500">التكرار</span>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FREQUENCY_LABELS) as BackupFrequency[]).map((f) => (
                <button
                  key={f} type="button" data-frequency={f} onClick={() => setFrequency(f)}
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${frequency === f ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  {FREQUENCY_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {frequency === 'weekly' && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-500">اليوم</span>
                <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="input-field">
                  {WEEKDAY_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                </select>
              </label>
            )}
            {frequency === 'monthly' && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-500">يوم الشهر</span>
                <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className="input-field">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">الساعة (بتوقيت القاهرة)</span>
              <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="input-field">
                {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                  <option key={h} value={h}>{h === 0 ? '12 ص' : h < 12 ? `${h} ص` : h === 12 ? '12 م' : `${h - 12} م`}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">الاحتفاظ بآخر</span>
              <select value={keepLast} onChange={(e) => setKeepLast(Number(e.target.value))} className="input-field">
                {[3, 5, 10, 20, 30, 60].map((n) => <option key={n} value={n}>{n} نسخ</option>)}
              </select>
            </label>
          </div>

          <div>
            <span className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><MapPin className="h-3.5 w-3.5 text-violet-500" /> نطاق النسخة</span>
            <BackupScopePicker value={place} onChange={setPlace} lookups={lookups} idPrefix="schedule-scope" accent="violet" />
          </div>

          <div>
            <span className="mb-1 block text-xs font-bold text-slate-500">ماذا تنسخ؟</span>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setScope('all')} className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${scope === 'all' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                الكل (يشمل الجداول الجديدة مستقبلاً)
              </button>
              <button type="button" onClick={() => setScope('custom')} className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${scope === 'custom' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                جداول محددة
              </button>
            </div>
            {scope === 'custom' && (
              <TableSelector available={catalogue.map((t) => ({ name: t.name, rows: t.rows }))} selected={selected} onChange={setSelected} compact />
            )}
          </div>

          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
            تُنفَّذ النسخ المجدولة على الخادم وتُحفظ في مخزن خاص بالتطبيق؛ تجدها في «السجل» وتحمّلها على جهازك بضغطة. يفحص الخادم النسخ المستحقة مرة يوميًا (Vercel Cron ~4:30 ص بتوقيت القاهرة)، فالنسخة المستحقة تُنفَّذ في أول فحص بعد موعدها.
          </p>
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">{error}</p>}
        </div>

        <div className="border-t border-indigo-50 px-5 py-3">
          <button id="schedule-save-btn" onClick={save} disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />} حفظ
          </button>
        </div>
      </div>
    </div>
  );
}
