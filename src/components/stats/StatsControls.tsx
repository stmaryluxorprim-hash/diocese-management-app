'use client';

// ---------- Shared controls of the four-tab الإحصائيات page ----------
//   PeriodBar   — window presets (اليوم · هذا الأسبوع · هذا الشهر · 30 يوم ·
//                 3 أشهر · هذه السنة · مخصص) + custom dates + bucket pills
//   EventSelect — «كل المناسبات» or ONE event of the scope
//   ErrorBox    — migration hint shared by the tabs

import { AlertTriangle } from 'lucide-react';
import { BUCKET_LABELS, type Bucket, type Period } from '@/lib/stats';
import { WINDOW_PRESETS, windowLabel, type WindowPreset } from '@/lib/stats-period';
import { Chips } from '@/components/stats/Charts2';
import type { AppEvent } from '@/lib/types';
import { ALL } from '@/lib/queries';

export function PeriodBar({
  preset, onPreset, period, custom, onCustom, bucket, onBucket, today, tone, showBucket = true, id,
}: {
  id?: string;
  preset: WindowPreset;
  onPreset: (p: WindowPreset) => void;
  period: Period;
  custom: { from: string; to: string };
  onCustom: (c: { from: string; to: string }) => void;
  bucket: Bucket;
  onBucket: (b: Bucket) => void;
  today: string;
  tone: string;
  showBucket?: boolean;
}) {
  return (
    <div id={id} className="card !py-3">
      <Chips
        tone={tone}
        value={preset}
        onChange={onPreset}
        options={[...WINDOW_PRESETS, { value: 'custom' as WindowPreset, label: 'مخصص' }]}
      />
      {preset === 'custom' && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-bold text-slate-500">
            من
            <input type="date" value={custom.from} max={today} onChange={(e) => e.target.value && onCustom({ ...custom, from: e.target.value })} className="input-field mt-0.5 !px-2 !py-2 tabular-nums" />
          </label>
          <label className="text-[10px] font-bold text-slate-500">
            إلى
            <input type="date" value={custom.to} max={today} onChange={(e) => e.target.value && onCustom({ ...custom, to: e.target.value })} className="input-field mt-0.5 !px-2 !py-2 tabular-nums" />
          </label>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-bold text-slate-400">{windowLabel(period)}</p>
        {showBucket && period.from !== period.to && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {(['day', 'week', 'month'] as Bucket[]).map((b) => (
              <button key={b} type="button" onClick={() => onBucket(b)} className={`rounded-md px-2 py-1 text-[10px] font-extrabold transition ${bucket === b ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {BUCKET_LABELS[b]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function EventSelect({ events, value, onChange, id }: { id?: string; events: AppEvent[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} aria-label="اختيار المناسبة" className="input-field appearance-none !px-2 !py-2.5 text-xs font-bold" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={ALL}>كل المناسبات</option>
      {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
    </select>
  );
}

export function ErrorBox({ error, migration }: { error: string; migration: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p>{error}</p>
        <p className="mt-1 font-medium text-rose-500">تأكد من تشغيل الترحيل {migration} في Supabase.</p>
      </div>
    </div>
  );
}
