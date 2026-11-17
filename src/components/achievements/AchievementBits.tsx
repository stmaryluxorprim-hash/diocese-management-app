'use client';

// ---------- Achievements — shared UI bits ----------
// AchievementsHeader : back arrow + title + count badge
// AchievementThumb   : achievement picture or a trophy placeholder
// ProgressBar        : simple «3 / 5» bar for attendance achievements
// EarnedCard         : the card shown in the child portal / servant modals
// scopeLabel         : «كنيسة ← خدمة ← فصل (← مناسبة)»

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Trophy, Star, CalendarDays } from 'lucide-react';
import type { Church, Service, ClassRoom, AppEvent } from '@/lib/types';
import type { Achievement } from '@/lib/achievements';
import { useNavLabel } from '@/lib/customization-context';

export function AchievementsHeader({ title, badge, back = '/settings' }: { title?: string; badge?: React.ReactNode; back?: string }) {
  const name = useNavLabel('achievements');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <Trophy className="h-5 w-5 text-amber-600" />
        {name}
        {title && <span className="text-slate-400 font-bold text-sm">· {title}</span>}
        {badge}
      </h2>
    </section>
  );
}

/** Achievement picture (or trophy placeholder). */
export function AchievementThumb({ url, name, size = 48, className = '', muted = false }: {
  url: string | null; name: string; size?: number; className?: string; muted?: boolean;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl ring-1 ${muted ? 'bg-slate-100 text-slate-300 ring-slate-200' : 'bg-amber-50 text-amber-400 ring-amber-100'} ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} fill sizes={`${size}px`} className={`object-cover ${muted ? 'grayscale opacity-60' : ''}`} />
      ) : (
        <Trophy className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}

/** «3 / 5» progress bar. */
export function ProgressBar({ current, target, label, id }: { current: number; target: number; label?: string; id?: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((Math.min(current, target) / target) * 100)) : 0;
  return (
    <div id={id} className="mt-1.5">
      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
        <span>{label ?? 'التقدم'}</span>
        <span className="tabular-nums" dir="ltr">{Math.min(current, target)} / {target}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={target}>
        <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** «🏆 picture · name · +N نقطة · date» */
export function EarnedCard({ name, image_url, points, awarded_at, sub, id, action }: {
  name: string; image_url: string | null; points: number; awarded_at: string; sub?: string | null; id?: string; action?: React.ReactNode;
}) {
  return (
    <div id={id} className="card flex items-center gap-3 !p-3 ring-1 ring-amber-100">
      <AchievementThumb url={image_url} name={name} size={56} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold text-slate-800">{name}</p>
        {sub && <p className="truncate text-[11px] font-bold text-slate-400">{sub}</p>}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-slate-400">
          <CalendarDays className="h-3 w-3" /> {fmtDate(awarded_at)}
        </p>
      </div>
      <span className={`badge shrink-0 ${points > 0 ? 'bg-gold-100 text-gold-700' : 'bg-slate-100 text-slate-500'}`}>
        <Star className="h-3 w-3" /> {points > 0 ? `+${points}` : '—'}
      </span>
      {action}
    </div>
  );
}

export function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

export function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/** «كنيسة ← خدمة ← فصل (← مناسبة)» */
export function scopeLabel(
  a: Pick<Achievement, 'church_id' | 'service_id' | 'class_id' | 'event_id'> & { class_ids?: string[] },
  churches: Church[], services: Service[], classes: ClassRoom[], events: AppEvent[] = []
) {
  const church = churches.find((c) => c.id === a.church_id)?.name ?? '';
  let s: string;
  if (a.service_id === null) s = `${church} ← كل الخدمات`;
  else {
    const service = services.find((x) => x.id === a.service_id)?.name ?? '';
    if (a.class_ids && a.class_ids.length > 1) s = `${church} ← ${service} ← ${a.class_ids.map((id) => classes.find((c) => c.id === id)?.name ?? '').filter(Boolean).join('، ')}`;
    else if (a.class_id === null) s = `${church} ← ${service} ← كل الفصول`;
    else s = `${church} ← ${service} ← ${classes.find((c) => c.id === a.class_id)?.name ?? ''}`;
  }
  if (a.event_id) s += ` ← ${events.find((e) => e.id === a.event_id)?.name ?? 'مناسبة'}`;
  return s;
}

/** Short scope kind for the list: كنيسة / خدمة / فصل / مناسبة */
export function scopeKind(a: Pick<Achievement, 'service_id' | 'class_id' | 'event_id'>): string {
  if (a.event_id) return 'مناسبة';
  if (a.class_id) return 'فصل';
  if (a.service_id) return 'خدمة';
  return 'كنيسة';
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="achievements-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}
