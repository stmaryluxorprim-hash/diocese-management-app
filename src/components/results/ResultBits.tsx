'use client';

// ---------- Exam Results module — shared UI bits ----------
// ResultsHeader : back arrow + module title (+ badge / actions)
// ModuleTabs    : the main sections (الامتحانات · إدخال جماعي · استيراد · التقارير · أنظمة التقدير · نتائج المخدومين)
// StatusBadge   : exam status pill · StudentStatusBadge : per-student status
// GradePill     : colored grade chip · PctBar : tiny percentage bar
// Toast · Field · Toggle · ModalFrame · ConfirmModal · useResultLookups
// ExamPicker    : exam select · Avatar · BarChart · Kpi

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowRight, ClipboardCheck, ClipboardList, Keyboard, FileUp, BarChart3, Percent, Users, X, Loader2, AlertTriangle,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useNavLabel } from '@/lib/customization-context';
import { cachedLookup } from '@/lib/queries';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  EXAM_STATUS_LABELS, EXAM_STATUS_STYLE, STUDENT_STATUS_LABELS, STUDENT_STATUS_STYLE,
  type ResultExamStatus, type StudentStatus, type ResultExam, type GradingGrade,
} from '@/lib/results';

export const TABS = [
  { href: '/results', label: 'الامتحانات', icon: ClipboardList, id: 'res-tab-exams', exact: true },
  { href: '/results/bulk', label: 'إدخال جماعي', icon: Keyboard, id: 'res-tab-bulk' },
  { href: '/results/import', label: 'استيراد', icon: FileUp, id: 'res-tab-import' },
  { href: '/results/reports', label: 'التقارير', icon: BarChart3, id: 'res-tab-reports' },
  { href: '/results/grading', label: 'أنظمة التقدير', icon: Percent, id: 'res-tab-grading' },
  { href: '/results/students', label: 'نتائج المخدومين', icon: Users, id: 'res-tab-students' },
];

export function ResultsHeader({
  title, badge, back = '/settings', actions, tabs = true,
}: { title?: string; badge?: ReactNode; back?: string; actions?: ReactNode; tabs?: boolean }) {
  const name = useNavLabel('results');
  return (
    <>
      <section className="mb-3 flex items-center gap-2">
        <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
          <ClipboardCheck className="h-5 w-5 shrink-0 text-emerald-600" />
          <span className="truncate">{title ?? name}</span>
          {badge}
        </h2>
        {actions}
      </section>
      {tabs && <ModuleTabs />}
    </>
  );
}

export function ModuleTabs() {
  const path = usePathname() ?? '';
  return (
    <nav id="res-tabs" className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {TABS.map((t) => {
        const active = t.exact
          ? path === t.href || (path.startsWith('/results/') && !TABS.some((o) => !o.exact && path.startsWith(o.href)))
          : path.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href} id={t.id} href={t.href} aria-current={active ? 'page' : undefined}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl px-1 text-[12px] font-extrabold transition active:scale-95 ${
              active ? 'bg-emerald-600 text-white shadow ring-2 ring-emerald-300' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function StatusBadge({ status, locked }: { status: ResultExamStatus; locked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`badge ${EXAM_STATUS_STYLE[status]}`}>{EXAM_STATUS_LABELS[status]}</span>
      {locked && <span className="badge bg-slate-800 text-white">🔒 مقفل</span>}
    </span>
  );
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return <span className={`badge ${STUDENT_STATUS_STYLE[status]}`}>{STUDENT_STATUS_LABELS[status]}</span>;
}

/** Colored grade chip; null → «—» */
export function GradePill({ name, color, size = 'sm' }: { name: string | null | undefined; color?: string | null; size?: 'sm' | 'lg' }) {
  if (!name) return <span className="text-slate-300">—</span>;
  const c = color || '#475569';
  return (
    <span
      className={`inline-flex items-center rounded-full font-extrabold ${size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'}`}
      style={{ backgroundColor: `${c}1f`, color: c, border: `1px solid ${c}55` }}
    >
      {name}
    </span>
  );
}

export function gradeOf(grades: GradingGrade[], id: string | null | undefined) {
  return id ? grades.find((g) => g.id === id) ?? null : null;
}

export function PctBar({ pct, color }: { pct: number | null; color?: string | null }) {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: color || (p >= 50 ? '#059669' : '#dc2626') }} />
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="results-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-extrabold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-bold text-slate-400">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, desc, id, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string; id?: string; disabled?: boolean;
}) {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-start disabled:opacity-50">
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-emerald-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'right-0.5' : 'right-[1.375rem]'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        {desc && <span className="block text-[11px] font-bold text-slate-400">{desc}</span>}
      </span>
    </button>
  );
}

export function ModalFrame({ title, icon, onClose, children, wide = false }: {
  title: string; icon: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`no-scrollbar max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">{icon}{title}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Confirmation before a destructive action */
export function ConfirmModal({ title, desc, confirmLabel = 'تأكيد', danger = true, busy, onConfirm, onClose }: {
  title: string; desc: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <ModalFrame title={title} icon={<AlertTriangle className={`h-5 w-5 ${danger ? 'text-red-500' : 'text-amber-500'}`} />} onClose={onClose}>
      <div className="text-sm font-bold text-slate-600">{desc}</div>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1 !py-2.5">إلغاء</button>
        <button type="button" id="res-confirm" disabled={busy} onClick={onConfirm}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 font-extrabold text-white shadow ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} disabled:opacity-50`}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
        </button>
      </div>
    </ModalFrame>
  );
}

export function useResultLookups(supabase: SupabaseClient, enabled: boolean) {
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const [chs, svs, cls] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setChurches(chs); setServices(svs); setClasses(cls);
    })();
  }, [supabase, enabled]);
  return { churches, services, classes };
}

/** Exam select — shows date + status; `exams` are already RLS-scoped */
export function ExamPicker({ exams, value, onChange, id = 'res-exam', placeholder = 'اختر الامتحان…', filter }: {
  exams: ResultExam[]; value: string; onChange: (id: string) => void; id?: string; placeholder?: string; filter?: (x: ResultExam) => boolean;
}) {
  const list = useMemo(() => (filter ? exams.filter(filter) : exams), [exams, filter]);
  return (
    <select id={id} aria-label="اختيار الامتحان" className="input-field appearance-none text-sm font-bold" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}{x.exam_date ? ` · ${x.exam_date}` : ''} · {EXAM_STATUS_LABELS[x.status]}{x.locked ? ' 🔒' : ''}
        </option>
      ))}
    </select>
  );
}

/** Student avatar / initial */
export function Avatar({ name, url, size = 36 }: { name: string; url: string | null; size?: number }) {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center font-extrabold" style={{ fontSize: size * 0.42 }}>{name.trim().charAt(0) || '؟'}</span>
      )}
    </div>
  );
}

/** Simple horizontal bar chart (grade distribution etc.) */
export function BarChart({ items, id }: { items: { name: string; count: number; color: string | null }[]; id?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div id={id} className="space-y-1.5">
      {items.map((it) => (
        <div key={it.name} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate font-bold text-slate-600">{it.name}</span>
          <div className="h-5 flex-1 overflow-hidden rounded-lg bg-slate-100">
            <div className="flex h-full items-center justify-end rounded-lg px-1.5 text-[10px] font-extrabold text-white transition-all"
              style={{ width: `${Math.max(it.count ? 8 : 0, (it.count / max) * 100)}%`, backgroundColor: it.color || '#64748b' }}>
              {it.count > 0 && it.count}
            </div>
          </div>
          <span className="w-6 shrink-0 text-end tabular-nums font-bold text-slate-500">{it.count}</span>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-xs font-bold text-slate-400">لا بيانات</p>}
    </div>
  );
}

export function Kpi({ label, value, tone = 'text-slate-800', sub, id }: { label: string; value: ReactNode; tone?: string; sub?: string; id?: string }) {
  return (
    <div id={id} className="card !p-2.5 text-center">
      <p className={`text-lg font-extrabold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] font-bold text-slate-400">{label}</p>
      {sub && <p className="truncate text-[10px] font-bold text-slate-500">{sub}</p>}
    </div>
  );
}
