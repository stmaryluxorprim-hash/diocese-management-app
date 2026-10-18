'use client';

// ---------- Extra chart primitives for the four-tab الإحصائيات page ----------
// Pure SVG + Tailwind, RTL-aware, no chart library (same rules as Charts.tsx).
//
//   TabBar          — the 4 page tabs (icon + label, sliding pill)
//   SegmentDonut    — multi-segment donut with a centre number + legend
//   LineAreaChart   — one or more smooth series over the bucket keys
//   Histogram       — distribution bars (times → persons) with axis labels
//   HourProfile     — 24-hour profile (Cairo) of attendance
//   CoverageBar     — «called / not called» split bar with a % and legend
//   Avatar          — image or initial in a rounded square
//   PersonRow       — ranked row with avatar, name, class and badges
//   ProgressTable   — compact table-like list with an inline % bar
//   EmptyState      — consistent empty block

import { useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { UserRound } from 'lucide-react';
import { fmtNum } from '@/components/stats/Charts';

// =====================================================================
// TabBar
// =====================================================================
export function TabBar<T extends string>({
  tabs, value, onChange, id,
}: {
  id?: string;
  tabs: { key: T; label: string; icon: LucideIcon; tone: string }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div id={id} role="tablist" className="grid gap-1 rounded-2xl bg-white p-1 shadow-card ring-1 ring-indigo-50" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => {
        const active = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            id={id ? `${id}-${t.key}` : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-extrabold transition active:scale-95 ${
              active ? `${t.tone} text-white shadow` : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// SegmentDonut
// =====================================================================
export interface DonutSegment { key: string; label: string; value: number; color: string; icon?: ReactNode }

export function SegmentDonut({
  segments, size = 150, thickness = 18, centerLabel, centerValue, emptyText = 'لا توجد بيانات', legend = true, id,
}: {
  id?: string;
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
  emptyText?: string;
  legend?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = 50 - thickness / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.filter((s) => s.value > 0).map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const arc = { ...s, frac, dash: c * frac, start: offset };
    offset += c * frac;
    return arc;
  });
  const shown = active ? segments.find((s) => s.key === active) : null;
  if (total === 0) return <EmptyState text={emptyText} />;
  return (
    <div id={id} className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0 -rotate-90" onMouseLeave={() => setActive(null)}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={50} cy={50} r={r} fill="none"
            stroke={a.color}
            strokeWidth={active === null || active === a.key ? thickness : thickness - 5}
            strokeDasharray={`${Math.max(0, a.dash - 0.8)} ${c - Math.max(0, a.dash - 0.8)}`}
            strokeDashoffset={-a.start}
            opacity={active === null || active === a.key ? 1 : 0.4}
            className="cursor-pointer transition-all duration-500"
            onMouseEnter={() => setActive(a.key)}
            onClick={() => setActive(active === a.key ? null : a.key)}
          />
        ))}
        <g className="rotate-90" style={{ transformOrigin: '50px 50px' }}>
          <text x={50} y={shown ? 45 : 47} textAnchor="middle" dominantBaseline="central" fontSize={shown ? 14 : 17} fontWeight={800} fill={shown ? shown.color : '#1e293b'} style={{ fontFamily: 'inherit' }}>
            {shown ? fmtNum(shown.value) : typeof centerValue === 'number' ? fmtNum(centerValue) : centerValue ?? fmtNum(total)}
          </text>
          <text x={50} y={shown ? 58 : 60} textAnchor="middle" dominantBaseline="central" fontSize={shown ? 5.5 : 6} fontWeight={700} fill="#64748b" style={{ fontFamily: 'inherit' }}>
            {shown ? `${shown.label.slice(0, 18)} · ${Math.round((shown.value / total) * 100)}%` : centerLabel ?? ''}
          </text>
        </g>
      </svg>
      {legend && (
        <ul className="grid w-full flex-1 grid-cols-1 gap-1 xs:grid-cols-2 sm:grid-cols-1">
          {segments.filter((s) => s.value > 0).map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setActive(active === s.key ? null : s.key)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-right text-[11px] font-extrabold transition ${active === s.key ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white" style={{ background: s.color }}>{s.icon ?? <span className="h-2 w-2 rounded-full bg-white/90" />}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{s.label}</span>
                <span className="tabular-nums text-slate-800">{fmtNum(s.value)}</span>
                <span className="w-9 text-left tabular-nums text-slate-400">{Math.round((s.value / total) * 100)}%</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// LineAreaChart — one or more series over bucket keys
// =====================================================================
export interface LineSeries { key: string; label: string; color: string; values: number[]; dashed?: boolean }

export function LineAreaChart({
  id, series, labels, longLabels, height = 170, emptyText = 'لا توجد بيانات في هذه الفترة', valueSuffix = '',
}: {
  id?: string;
  series: LineSeries[];
  labels: string[];
  longLabels?: string[];
  height?: number;
  emptyText?: string;
  valueSuffix?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = useMemo(() => {
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const out: number[] = [];
    for (let v = 0; v <= top; v += step) out.push(v);
    return { values: out, top: Math.max(top, step) };
  }, [max]);
  const W = 100, H = height, padB = 20, padT = 8;
  const plotH = H - padB - padT;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 96 + 2);
  const y = (v: number) => padT + plotH - (v / ticks.top) * plotH;
  const isEmpty = series.length === 0 || series.every((s) => s.values.every((v) => v === 0));
  const showEvery = n > 14 ? Math.ceil(n / 7) : 1;
  const path = (vals: number[]) => {
    if (n === 0) return '';
    if (n === 1) return `M ${x(0)} ${y(vals[0])}`;
    // Catmull-Rom → cubic bezier smoothing (monotone-ish, light tension)
    const pts = vals.map((v, i) => [x(i), y(v)] as const);
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
      const t = 0.18;
      const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
      const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
      d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  };
  if (isEmpty) return <div id={id}><EmptyState text={emptyText} tall /></div>;
  return (
    <div id={id}>
      <div className="relative select-none" dir="ltr">
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex flex-col justify-between pb-[20px] pt-[8px] text-[9px] font-bold tabular-nums text-slate-400">
          {[...ticks.values].reverse().map((v) => <span key={v} className="bg-white/80 px-0.5 leading-none">{fmtNum(v)}</span>)}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: `${H}px` }} onMouseLeave={() => setActive(null)}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${id ?? 'la'}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {ticks.values.map((v) => (
            <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((s, si) => (
            <g key={s.key}>
              {si === 0 && n > 1 && (
                <path d={`${path(s.values)} L ${x(n - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill={`url(#grad-${id ?? 'la'}-${s.key})`} />
              )}
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </g>
          ))}
          {/* hit areas + markers */}
          {labels.map((_, i) => {
            const slot = n <= 1 ? 100 : 96 / (n - 1);
            return (
              <g key={i} onMouseEnter={() => setActive(i)} onClick={() => setActive(active === i ? null : i)} style={{ cursor: 'pointer' }}>
                <rect x={x(i) - slot / 2} y={0} width={slot} height={H - padB} fill="transparent" />
                {active === i && <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="#94a3b8" strokeWidth={0.6} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
                {series.map((s) => (
                  (active === i || n <= 14) && s.values[i] > 0 ? (
                    <circle key={s.key} cx={x(i)} cy={y(s.values[i])} r={active === i ? 1.6 : 1} fill="#fff" stroke={s.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
                  ) : null
                ))}
              </g>
            );
          })}
          {labels.map((l, i) =>
            i % showEvery === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={n > 20 ? 2.5 : 3} fontWeight={700} fill={active === i ? '#4f46e5' : '#94a3b8'} style={{ fontFamily: 'inherit' }}>{l}</text>
            ) : null
          )}
        </svg>
        {active !== null && (
          <div dir="rtl" className="mt-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="mb-1 font-extrabold text-slate-700">{longLabels?.[active] ?? labels[active]}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
              {series.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5 font-bold text-slate-600">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                  <span className="tabular-nums text-slate-800">{fmtNum(s.values[active] ?? 0)}{valueSuffix}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-600">
              <span className="h-2.5 w-5 rounded-full" style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} />
              {s.label}
              <span className="tabular-nums text-slate-400">{fmtNum(s.values.reduce((a, v) => a + v, 0))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}

// =====================================================================
// Histogram — categorical x (e.g. «0 مرات», «1», «2»…) → count
// =====================================================================
export function Histogram({
  id, bars, color = '#4f46e5', height = 130, emptyText = 'لا توجد بيانات', unit = '',
}: {
  id?: string;
  bars: { label: string; value: number; color?: string; hint?: string }[];
  color?: string;
  height?: number;
  emptyText?: string;
  unit?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const total = bars.reduce((a, b) => a + b.value, 0);
  if (bars.length === 0 || total === 0) return <div id={id}><EmptyState text={emptyText} /></div>;
  return (
    <div id={id} className="flex items-end gap-1 overflow-x-auto pb-1" style={{ minHeight: height + 36 }}>
      {bars.map((b, i) => {
        const h = Math.max(3, (b.value / max) * height);
        return (
          <div key={i} className="flex min-w-[2rem] flex-1 flex-col items-center gap-1" title={b.hint ?? `${b.label}: ${b.value}${unit}`}>
            <span className="text-[10px] font-extrabold tabular-nums text-slate-600">{b.value ? fmtNum(b.value) : ''}</span>
            <div className="flex w-full items-end" style={{ height }}>
              <div className="w-full rounded-t-lg transition-all duration-500" style={{ height: h, background: b.color ?? color, opacity: b.value ? 1 : 0.15 }} />
            </div>
            <span className="max-w-full truncate text-[10px] font-bold text-slate-500">{b.label}</span>
            <span className="text-[9px] font-bold tabular-nums text-slate-300">{total ? Math.round((b.value / total) * 100) : 0}%</span>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// HourProfile — 24 Cairo hours
// =====================================================================
export function HourProfile({ rows, color = '#0ea5e9', id }: { id?: string; rows: { hour: number; attendance: number; days: number }[]; color?: string }) {
  const by = new Map(rows.map((r) => [r.hour, r]));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const present = hours.filter((h) => (by.get(h)?.attendance ?? 0) > 0);
  if (present.length === 0) return <div id={id}><EmptyState text="لا توجد بيانات" /></div>;
  const from = Math.max(0, Math.min(...present) - 1), to = Math.min(23, Math.max(...present) + 1);
  const shown = hours.slice(from, to + 1);
  const max = Math.max(1, ...shown.map((h) => by.get(h)?.attendance ?? 0));
  const peak = present.reduce((a, h) => ((by.get(h)?.attendance ?? 0) > (by.get(a)?.attendance ?? 0) ? h : a), present[0]);
  const fmtHour = (h: number) => new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h)));
  return (
    <div id={id}>
      <div className="flex items-end gap-0.5">
        {shown.map((h) => {
          const v = by.get(h)?.attendance ?? 0;
          const hh = Math.max(3, (v / max) * 80);
          return (
            <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${fmtHour(h)}: ${v} حضور في ${by.get(h)?.days ?? 0} يوم`}>
              <span className="text-[9px] font-extrabold tabular-nums text-slate-500">{v ? fmtNum(v) : ''}</span>
              <div className="flex h-[84px] w-full items-end">
                <div className="w-full rounded-t-md transition-all" style={{ height: hh, background: h === peak ? color : `${color}80`, opacity: v ? 1 : 0.15 }} />
              </div>
              <span className={`text-[9px] font-bold ${h === peak ? 'text-slate-700' : 'text-slate-400'}`}>{fmtHour(h).replace(/\s/g, '')}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 rounded-xl bg-sky-50 px-3 py-1.5 text-[11px] font-extrabold text-sky-700">
        ذروة التسجيل: {fmtHour(peak)} — {fmtNum(by.get(peak)?.attendance ?? 0)} حضور
      </p>
    </div>
  );
}

// =====================================================================
// CoverageBar — a / b split with legend (e.g. called vs not called)
// =====================================================================
export function CoverageBar({
  parts, total, label, id,
}: {
  id?: string;
  parts: { key: string; label: string; value: number; color: string }[];
  total: number;
  label?: string;
}) {
  const sum = parts.reduce((a, p) => a + p.value, 0);
  const rest = Math.max(0, total - sum);
  const den = Math.max(1, total);
  return (
    <div id={id}>
      {label && <p className="mb-1.5 flex items-center justify-between text-[11px] font-extrabold text-slate-600"><span>{label}</span><span className="tabular-nums text-slate-400">{fmtNum(total)}</span></p>}
      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100">
        {parts.map((p) => (
          <div key={p.key} className="h-full transition-all duration-500" style={{ width: `${(p.value / den) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1 text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="tabular-nums text-slate-800">{fmtNum(p.value)}</span>
            <span className="tabular-nums text-slate-400">({Math.round((p.value / den) * 100)}%)</span>
          </span>
        ))}
        {rest > 0 && <span className="flex items-center gap-1 text-slate-400"><span className="h-2 w-2 rounded-full bg-slate-200" /> الباقي {fmtNum(rest)}</span>}
      </div>
    </div>
  );
}

// =====================================================================
// Avatar / PersonRow
// =====================================================================
export function Avatar({ url, name, size = 36, tone = 'from-primary-600 to-accent-600' }: { url: string | null; name: string; size?: number; tone?: string }) {
  const s = { width: size, height: size };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="shrink-0 rounded-xl object-cover" style={s} />;
  }
  const initial = (name || '').trim().charAt(0);
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${tone}`} style={s}>
      {initial ? <span className="text-sm font-extrabold">{initial}</span> : <UserRound className="h-4 w-4" />}
    </span>
  );
}

export function PersonRow({
  rank, url, name, sub, badges, trailing, highlight,
}: {
  rank?: number;
  url: string | null;
  name: string;
  sub?: ReactNode;
  badges?: ReactNode;
  trailing?: ReactNode;
  highlight?: 'gold' | 'rose' | 'emerald' | null;
}) {
  const ring = highlight === 'gold' ? 'bg-gold-50' : highlight === 'rose' ? 'bg-rose-50' : highlight === 'emerald' ? 'bg-emerald-50' : 'bg-slate-50';
  return (
    <li className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${ring}`}>
      {rank !== undefined && (
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
          rank === 1 ? 'bg-gold-100 text-gold-700' : rank === 2 ? 'bg-slate-200 text-slate-600' : rank === 3 ? 'bg-orange-100 text-orange-600' : 'bg-white text-slate-500 ring-1 ring-slate-100'
        }`}>{rank}</span>
      )}
      <Avatar url={url} name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-slate-800">{name}</p>
        {sub && <p className="truncate text-[10px] font-bold text-slate-400">{sub}</p>}
      </div>
      {badges && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{badges}</div>}
      {trailing}
    </li>
  );
}

// =====================================================================
// ProgressTable — label · value · % bar — compact rows (by class etc.)
// =====================================================================
export interface ProgressRow {
  key: string;
  label: string;
  sublabel?: string;
  num: number;       // numerator
  den: number;       // denominator (0 → bar hidden)
  color?: string;
  extra?: ReactNode;  // small badges on the right
  onClick?: () => void;
}

export function ProgressTable({ rows, emptyText = 'لا توجد بيانات', id, numLabel }: { id?: string; rows: ProgressRow[]; emptyText?: string; numLabel?: (r: ProgressRow) => string }) {
  if (rows.length === 0) return <div id={id}><EmptyState text={emptyText} /></div>;
  return (
    <ul id={id} className="divide-y divide-slate-100">
      {rows.map((r) => {
        const p = r.den > 0 ? Math.round((r.num / r.den) * 100) : 0;
        const color = r.color ?? (p >= 75 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444');
        const Comp = r.onClick ? 'button' : 'div';
        return (
          <li key={r.key}>
            <Comp type={r.onClick ? 'button' : undefined} onClick={r.onClick} className={`block w-full py-2 text-right ${r.onClick ? 'hover:bg-slate-50' : ''}`}>
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-extrabold text-slate-700">{r.label}</span>
                {r.extra}
                <span className="tabular-nums font-extrabold text-slate-800">{numLabel ? numLabel(r) : `${fmtNum(r.num)} / ${fmtNum(r.den)}`}</span>
                {r.den > 0 && <span className="w-10 text-left text-[11px] font-extrabold tabular-nums" style={{ color }}>{p}%</span>}
              </div>
              {r.den > 0 && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, p)}%`, background: color }} />
                </div>
              )}
              {r.sublabel && <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{r.sublabel}</p>}
            </Comp>
          </li>
        );
      })}
    </ul>
  );
}

// =====================================================================
// EmptyState
// =====================================================================
export function EmptyState({ text, tall = false }: { text: string; tall?: boolean }) {
  return (
    <div className={`flex items-center justify-center rounded-xl bg-slate-50 text-sm font-bold text-slate-400 ${tall ? 'h-40' : 'h-20'}`}>{text}</div>
  );
}

// =====================================================================
// Chips — single-select pill row (presets, filters)
// =====================================================================
export function Chips<T extends string>({ options, value, onChange, tone = 'bg-primary-600', id }: {
  id?: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  tone?: string;
}) {
  return (
    <div id={id} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold transition active:scale-95 ${
            value === o.value ? `${tone} text-white shadow` : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`tabular-nums ${value === o.value ? 'text-white/80' : 'text-slate-400'}`}>{fmtNum(o.count)}</span>}
        </button>
      ))}
    </div>
  );
}
