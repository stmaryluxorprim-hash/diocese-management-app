'use client';

// ---------- Activity log — shared UI bits ----------
// ActivityHeader   : back arrow + module name + optional right slot
// ActorChip        : servant / child / system avatar + name + role
// ActionBadge      : verb-toned pill with icon (سجّل حضور · عدّل بيانات …)
// ActivityItem     : one timeline row (tap → details drawer)
// ActivityDetails  : bottom-sheet with the full row: who · what · where ·
//                    diff table (قبل / بعد) · meta
//                    (20261010120000: NO technical codes — action keys,
//                    table names, UUIDs and raw column names are gone; the
//                    sheet speaks Arabic only. The data is still in the
//                    row for filters / export.)
// LoadMoreBar      : «تعمّق أكثر» with the 10 / 100 / 1000 picker
// Toast / Empty

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight, History, User, Users, Cpu, X, Clock, MapPin, Layers, ChevronDown, Loader2,
  Filter, Sparkles, Cross } from 'lucide-react';
import { useNavLabel } from '@/lib/customization-context';
import {
  describe, columnLabel, fmtDateTime, relTime, ROLE_LABELS, OP_LABELS, TONE_CLASSES, PAGE_SIZES, ACTOR_KIND_LABELS,
  type ActivityRow, type ActorKind, type PageSize,
} from '@/lib/activity';

// ---------- Header ----------
export function ActivityHeader({ title, badge, back = '/settings', right }: {
  title?: string; badge?: ReactNode; back?: string; right?: ReactNode;
}) {
  const name = useNavLabel('activity');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
        <History className="h-5 w-5 shrink-0 text-slate-700" />
        <span className="truncate">{title ?? name}</span>
        {badge}
      </h2>
      {right}
    </section>
  );
}

// ---------- Actor ----------
const ACTOR_TONES: Record<ActorKind, string> = {
  servant: 'bg-primary-100 text-primary-700',
  child: 'bg-pink-100 text-pink-700',
  priest: 'bg-violet-100 text-violet-700',
  system: 'bg-slate-200 text-slate-600',
};

export function ActorAvatar({ kind, className = 'h-9 w-9' }: { kind: ActorKind; className?: string }) {
  const Icon = kind === 'servant' ? User : kind === 'child' ? Users : kind === 'priest' ? Cross : Cpu;
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full ${ACTOR_TONES[kind]} ${className}`}>
      <Icon className="h-[55%] w-[55%]" />
    </div>
  );
}

export function ActorChip({ kind, name, role, count, onClick, active }: {
  kind: ActorKind; name: string | null; role?: string | null; count?: number; onClick?: () => void; active?: boolean;
}) {
  const label = name ?? (kind === 'system' ? 'النظام' : ACTOR_KIND_LABELS[kind]);
  const inner = (
    <>
      <ActorAvatar kind={kind} className="h-7 w-7" />
      <span className="min-w-0 truncate text-sm font-extrabold">{label}</span>
      {role && <span className="hidden text-[11px] font-bold text-slate-400 sm:inline">{ROLE_LABELS[role] ?? role}</span>}
      {count !== undefined && <span className="badge bg-slate-100 text-slate-600 tabular-nums">{count}</span>}
    </>
  );
  if (!onClick) return <div className="flex items-center gap-2">{inner}</div>;
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start transition ${active ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-slate-50'}`}>
      {inner}
    </button>
  );
}

// ---------- Action badge ----------
export function ActionBadge({ row, size = 'sm' }: { row: ActivityRow; size?: 'sm' | 'md' }) {
  const d = describe(row);
  const Icon = d.icon;
  return (
    <span className={`badge ${TONE_CLASSES[d.tone]} ${size === 'md' ? '!px-3 !py-1 text-sm' : ''}`}>
      <Icon className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} />
      {d.verb} {row.op !== 'EVENT' && d.noun}
    </span>
  );
}

// ---------- One row ----------
export function ActivityItem({ row, onOpen, onActor, onTarget, showActor = true }: {
  row: ActivityRow; onOpen: (r: ActivityRow) => void;
  onActor?: (r: ActivityRow) => void; onTarget?: (r: ActivityRow) => void; showActor?: boolean;
}) {
  const d = describe(row);
  const G = d.group.icon;
  return (
    <li className="relative">
      <button type="button" onClick={() => onOpen(row)}
        className="flex w-full items-start gap-3 rounded-2xl border border-indigo-50 bg-white p-3 text-start shadow-card transition hover:bg-slate-50 active:scale-[0.995]">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${d.group.bg} ${d.group.color}`}>
          <G className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showActor && (
              <span role="link" tabIndex={-1}
                onClick={(e) => { if (onActor) { e.stopPropagation(); onActor(row); } }}
                className={`inline-flex items-center gap-1 text-sm font-extrabold text-slate-800 ${onActor ? 'hover:underline' : ''}`}>
                <ActorAvatar kind={row.actor_kind} className="h-5 w-5" /> {d.actor}
              </span>
            )}
            <ActionBadge row={row} />
            {d.target && (
              <span role="link" tabIndex={-1}
                onClick={(e) => { if (onTarget && row.target_person_id) { e.stopPropagation(); onTarget(row); } }}
                className={`truncate text-sm font-bold text-primary-700 ${onTarget && row.target_person_id ? 'hover:underline' : ''}`}>
                {d.target}
              </span>
            )}
          </div>
          {d.details.length > 0 && (
            <p className="mt-1 truncate text-xs font-bold text-slate-500">{d.details.join(' · ')}</p>
          )}
          <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
            <Clock className="h-3 w-3" /> {relTime(row.created_at)}
            <span className="text-slate-300">·</span>
            <span>{fmtDateTime(row.created_at)}</span>
            <span className="text-slate-300">·</span>
            <span>{d.group.label}</span>
            {row.source === 'app' && <><span className="text-slate-300">·</span><Sparkles className="h-3 w-3" /> حدث</>}
          </p>
        </div>
      </button>
    </li>
  );
}

// ---------- Details drawer ----------
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="w-20 shrink-0 font-bold text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 break-words font-bold text-slate-800">{children}</span>
    </div>
  );
}

/** Human rendering of one value — identifiers are hidden, not shown as codes. */
function Val({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
  if (typeof v === 'boolean') return <>{v ? 'نعم' : 'لا'}</>;
  if (typeof v === 'object') return <span className="text-slate-400">{Array.isArray(v) ? `${v.length} عنصر` : 'بيانات مركّبة'}</span>;
  const s = String(v);
  if (isUuid(s)) return <span className="text-slate-400">معرّف</span>;
  if (/^https?:\/\//.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="text-primary-600 underline break-all">رابط</a>;
  return <span className="break-words">{s}</span>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);
/** Columns that only carry identifiers / bookkeeping — never worth a row in the diff table. */
const HIDDEN_DIFF_COLUMNS = new Set([
  'id', 'edited_at', 'updated_at', 'edited_by', 'updated_by', 'created_at', 'created_by', 'batch_id', 'token', 'token_hash',
]);
/** `_id` columns are references — except the person's code (national_id) and the login name (user_id), which ARE the data. */
const MEANINGFUL_ID_COLUMNS = new Set(['national_id', 'user_id']);
export const isTechnicalColumn = (k: string) =>
  HIDDEN_DIFF_COLUMNS.has(k) || k.endsWith('_hash') || (k.endsWith('_id') && !MEANINGFUL_ID_COLUMNS.has(k));

export function ActivityDetails({ row, onClose, onFilterActor, onFilterTarget, onFilterBatch, onFilterAction, scopeNames }: {
  row: ActivityRow | null; onClose: () => void;
  onFilterActor?: (r: ActivityRow) => void; onFilterTarget?: (r: ActivityRow) => void;
  onFilterBatch?: (r: ActivityRow) => void; onFilterAction?: (r: ActivityRow) => void;
  scopeNames?: (r: ActivityRow) => string | null;
}) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);
  if (!row) return null;
  const d = describe(row);
  const keys = Array.from(new Set([...Object.keys(row.old_data ?? {}), ...Object.keys(row.new_data ?? {})]))
    .filter((k) => !isTechnicalColumn(k))
    .sort((a, b) => (row.changed?.includes(a) ? 0 : 1) - (row.changed?.includes(b) ? 0 : 1) || a.localeCompare(b));
  const scope = scopeNames?.(row) ?? null;
  const G = d.group.icon;

  return (
    <div id="activity-details" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${d.group.bg} ${d.group.color}`}><G className="h-6 w-6" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-400">{d.group.label} · {OP_LABELS[row.op]}</p>
            <p className="text-base font-extrabold leading-tight text-slate-900">{d.sentence}</p>
            <p className="mt-0.5 text-xs font-bold text-slate-400">{fmtDateTime(row.created_at)} · {relTime(row.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100 px-3">
          <Row icon={<User className="h-4 w-4" />} label="الفاعل">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <ActorAvatar kind={row.actor_kind} className="h-5 w-5" /> {d.actor}
              <span className="badge bg-slate-100 text-slate-500">{ROLE_LABELS[row.actor_role ?? ''] ?? row.actor_role ?? ACTOR_KIND_LABELS[row.actor_kind]}</span>
              {onFilterActor && row.actor_id && (
                <button type="button" onClick={() => onFilterActor(row)} className="badge bg-primary-50 text-primary-700 hover:bg-primary-100"><Filter className="h-3 w-3" /> كل عملياته</button>
              )}
            </span>
          </Row>
          <Row icon={<Sparkles className="h-4 w-4" />} label="العملية">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <ActionBadge row={row} size="md" />
              {onFilterAction && <button type="button" onClick={() => onFilterAction(row)} className="badge bg-primary-50 text-primary-700 hover:bg-primary-100"><Filter className="h-3 w-3" /> مثلها</button>}
            </span>
          </Row>
          {d.target && (
            <Row icon={<Users className="h-4 w-4" />} label="على">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {d.target}
                {row.target_kind && <span className="badge bg-slate-100 text-slate-500">{TARGET_LABELS[row.target_kind] ?? row.target_kind}</span>}
                {onFilterTarget && row.target_person_id && (
                  <button type="button" onClick={() => onFilterTarget(row)} className="badge bg-primary-50 text-primary-700 hover:bg-primary-100"><Filter className="h-3 w-3" /> كل ما حدث له</button>
                )}
              </span>
            </Row>
          )}
          {(scope || row.church_id) && (
            <Row icon={<MapPin className="h-4 w-4" />} label="النطاق">{scope ?? '—'}</Row>
          )}
          {row.batch_size > 1 && (
            <Row icon={<Layers className="h-4 w-4" />} label="جماعية">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {row.batch_size} صف في عملية واحدة
                {onFilterBatch && row.batch_id && <button type="button" onClick={() => onFilterBatch(row)} className="badge bg-primary-50 text-primary-700 hover:bg-primary-100"><Filter className="h-3 w-3" /> عرض الكل</button>}
              </span>
            </Row>
          )}
        </div>

        {keys.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-extrabold text-slate-500">
              {row.op === 'UPDATE' ? 'ما تغيّر (قبل ← بعد)' : row.op === 'DELETE' ? 'الصف المحذوف' : 'البيانات'}
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-start font-bold">الحقل</th>
                    {row.op !== 'INSERT' && <th className="px-2 py-1.5 text-start font-bold">قبل</th>}
                    {row.op !== 'DELETE' && <th className="px-2 py-1.5 text-start font-bold">بعد</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keys.map((k) => {
                    const changed = row.changed?.includes(k);
                    return (
                      <tr key={k} className={changed ? 'bg-amber-50/60' : ''}>
                        <td className="px-2 py-1.5 font-extrabold text-slate-700">{columnLabel(k)}</td>
                        {row.op !== 'INSERT' && <td className="px-2 py-1.5 text-rose-700"><Val v={row.old_data?.[k]} /></td>}
                        {row.op !== 'DELETE' && <td className="px-2 py-1.5 text-emerald-700"><Val v={row.new_data?.[k]} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {row.meta && Object.entries(row.meta).some(([k]) => !isTechnicalColumn(k) && k !== 'ua' && k !== 'user_agent') && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-extrabold text-slate-500">تفاصيل إضافية</p>
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100 px-3 text-xs">
              {Object.entries(row.meta).filter(([k]) => !isTechnicalColumn(k) && k !== 'ua' && k !== 'user_agent').map(([k, v]) => (
                <div key={k} className="flex gap-2 py-1.5"><span className="w-28 shrink-0 font-bold text-slate-500">{columnLabel(k)}</span><span className="min-w-0 flex-1 font-bold text-slate-800"><Val v={v} /></span></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const TARGET_LABELS: Record<string, string> = {
  person: 'مخدوم', servant: 'خادم', church: 'كنيسة', service: 'خدمة', class: 'فصل', event: 'مناسبة', cause: 'سبب',
  feedback: 'نتيجة افتقاد', item: 'صنف', content: 'محتوى', module: 'وحدة', setting: 'إعداد', message: 'رسالة',
};

// ---------- Load more ----------
export function LoadMoreBar({ pageSize, onPageSize, onMore, loading, done, loaded, total }: {
  pageSize: PageSize; onPageSize: (n: PageSize) => void; onMore: () => void; loading: boolean; done: boolean; loaded: number; total?: number | null;
}) {
  return (
    <div id="activity-load-more" className="card mt-3 flex flex-col items-center gap-3 !py-4">
      <p className="text-xs font-bold text-slate-500">
        تم تحميل <span className="tabular-nums text-slate-800">{loaded.toLocaleString('ar-EG')}</span>
        {total !== null && total !== undefined && <> من <span className="tabular-nums text-slate-800">{total.toLocaleString('ar-EG')}</span></>} عملية
      </p>
      <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
        {PAGE_SIZES.map((n) => (
          <button key={n} type="button" onClick={() => onPageSize(n)}
            className={`rounded-lg px-3 py-1.5 text-xs font-extrabold tabular-nums transition ${pageSize === n ? 'bg-white text-primary-700 shadow' : 'text-slate-500 hover:text-slate-800'}`}>
            {n.toLocaleString('ar-EG')}
          </button>
        ))}
      </div>
      {done ? (
        <p className="text-xs font-bold text-slate-400">وصلت إلى نهاية السجل</p>
      ) : (
        <button id="activity-dig" type="button" onClick={onMore} disabled={loading}
          className="btn-primary inline-flex items-center gap-2 !py-2.5 !px-5 text-sm !from-slate-800 !to-slate-700">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
          تعمّق أكثر — حمّل {pageSize.toLocaleString('ar-EG')} عملية أقدم
        </button>
      )}
    </div>
  );
}

// ---------- Toast / Empty ----------
export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="activity-toast" role="status" className="fixed inset-x-4 bottom-24 z-[90] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export function Empty({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="card py-12 text-center text-slate-400">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">{icon}</div>
      <p className="text-sm font-bold">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
