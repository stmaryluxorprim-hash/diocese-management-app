'use client';

// Small shared pieces for the child portal pages

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { User, ListChecks } from 'lucide-react';
import InfoTip from '@/components/InfoTip';
import { APP_TZ } from '@/lib/time';
import { onAppResume } from '@/lib/realtime';
import type { ChildPerson } from '@/lib/child-portal';

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ,
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ, day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(iso));

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

/** 'YYYY-MM-DD' (Cairo calendar day) → long Arabic date with weekday */
export const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

export function Avatar({ person, size = 64, className = '' }: { person: ChildPerson; size?: number; className?: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 text-white ring-2 ring-gold-300/70 ${className}`}
      style={{ width: size, height: size }}
    >
      {person.image_url ? (
        <Image src={person.image_url} alt={person.name} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="card py-10 text-center text-slate-400">
      <ListChecks className="mx-auto mb-2 h-8 w-8" />
      <p className="text-sm font-bold">{text}</p>
    </div>
  );
}

export function PageTitle({ icon, title, sub, info }: { icon: React.ReactNode; title: string; sub?: string; info?: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="flex items-center gap-2 text-lg font-extrabold">{icon}{title}{info && <InfoTip title={title}>{info}</InfoTip>}</h2>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </section>
  );
}

export function Kpi({ label, value, tone, icon }: { label: string; value: string | number; tone: string; icon: React.ReactNode }) {
  return (
    <div className={`card flex items-center gap-3 ${tone}`}>
      <span className="rounded-xl bg-white/70 p-2">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold tabular-nums leading-tight">{value}</p>
        <p className="text-xs font-bold text-slate-500 truncate">{label}</p>
      </div>
    </div>
  );
}

/**
 * Hook: generic list loader for the child RPC pages. `key` identifies the
 * inputs (e.g. the token + counters); the list is reloaded whenever it
 * changes and again when the tab becomes visible.
 */
export function usePortalList<T>(load: (() => Promise<T[]>) | null, key: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!load) return;
    try {
      setRows(await load());
      setError('');
    } catch {
      setError('تعذر تحميل البيانات');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    reload();
    return onAppResume(reload); // 20261017120000: real resume only, not every glance
  }, [reload]);
  return { rows, error, reload };
}
