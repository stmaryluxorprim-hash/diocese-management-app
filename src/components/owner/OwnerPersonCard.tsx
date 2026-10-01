'use client';

// ---------- إدارة الأفراد → one person card ----------
// Shows EVERYTHING the system knows about the person: identity data
// (code · gender · birthdate · phone · address · notes · photo · password
// state · created/edited), his servant account (role · status · places) and
// EVERY enrollment (church ← service ← class, status, attendance, points)
// each labelled with its KIND — كمخدوم · كخادم · ككاهن (20261005120000: the
// priest account is listed as an enrollment of the church too).
// A checkbox selects it for the bulk bar; the action row offers
// تعديل · إضافة تسجيل · دمج · حذف.

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  User, IdCard, Phone, MapPin, StickyNote, CalendarDays, Star, CalendarCheck, School, Layers,
  Church as ChurchIcon, Ban, ShieldCheck, KeyRound, Pencil, Trash2, Plus, CheckSquare, Square,
  ChevronDown, Clock, Copy, Check, Cross, GitMerge,
} from 'lucide-react';
import { GENDER_LABELS, ROLE_LABELS, STATUS_LABELS, type Church, type Service, type ClassRoom } from '@/lib/types';
import { ENROLLMENT_KIND_LABELS, personKinds, type OwnerPersonRow } from '@/lib/owner-persons';

const PRIEST_STATUS: Record<string, string> = { approved: 'مفعّل', pending: 'قيد المراجعة', rejected: 'مرفوض', suspended: 'موقوف' };

const nameOf = (list: { id: string; name: string }[], id: string | null | undefined, fb = '—') =>
  id ? list.find((x) => x.id === id)?.name ?? fb : fb;

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
};

const ageOf = (birthdate: string | null) => {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a >= 0 ? a : null;
};

export default function OwnerPersonCard({
  row, index, selected, onSelect, churches, services, classes, onEdit, onAddScope, onMerge, onDelete, disabled,
}: {
  row: OwnerPersonRow;
  index: number;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onEdit: () => void;
  onAddScope: () => void;
  onMerge?: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isServant = !!row.servant;
  const isPriest = !!row.priest;
  const kinds = personKinds(row);
  const age = ageOf(row.birthdate);
  // 20261006120000: servant places WITHOUT a class (whole church / whole service)
  // have no mirror enrollment row — list them explicitly so the person is never
  // «بدون تسجيلات» while he has a church
  const servantPlaces = row.servant
    ? [{ church_id: row.servant.church_id, service_id: row.servant.service_id, class_id: row.servant.class_id }, ...row.servant.scopes]
        .filter((s) => s.church_id && !s.class_id)
    : [];
  const unenrolled = row.enrollments.length === 0 && !isPriest && servantPlaces.length === 0;
  const enrollmentCount = row.enrollments.length + servantPlaces.length + (isPriest ? 1 : 0);
  const totalPoints = row.enrollments.reduce((s, e) => s + e.points, 0);
  const totalAttendance = row.enrollments.reduce((s, e) => s + e.attendance_count, 0);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(row.national_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <li
      id={`op-row-${row.id}`}
      className={`card relative !p-3 transition ${selected ? 'ring-2 ring-gold-400 bg-gold-50/40' : ''}`}
    >
      <span className="card-num">{index + 1}</span>

      <div className="flex items-start gap-3">
        {/* select */}
        <button
          type="button"
          id={`op-select-${row.id}`}
          onClick={() => onSelect(!selected)}
          aria-pressed={selected}
          aria-label={selected ? 'إلغاء التحديد' : 'تحديد'}
          className={`mt-1 shrink-0 rounded-lg p-1 transition ${selected ? 'text-gold-600' : 'text-slate-300 hover:text-slate-500'}`}
        >
          {selected ? <CheckSquare className="h-6 w-6" /> : <Square className="h-6 w-6" />}
        </button>

        {/* photo */}
        <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-2 ${
          isPriest ? 'bg-violet-50 ring-violet-100 text-violet-400' : isServant ? 'bg-emerald-50 ring-emerald-100 text-emerald-400' : 'bg-primary-50 ring-primary-100 text-primary-300'}`}>
          {row.image_url ? (
            <Image src={row.image_url} alt={row.name} fill sizes="56px" className="object-cover" />
          ) : (
            <User className="h-7 w-7" />
          )}
        </div>

        {/* identity */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">{row.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            {/* every kind the person holds — مخدوم · خادم · كاهن */}
            {kinds.includes('child') && <span className="badge bg-primary-100 text-primary-700"><User className="h-3 w-3" /> مخدوم</span>}
            {isServant && <span className="badge bg-emerald-100 text-emerald-700"><ShieldCheck className="h-3 w-3" /> خادم · {ROLE_LABELS[row.servant!.role]}</span>}
            {isPriest && <span className="badge bg-violet-100 text-violet-700"><Cross className="h-3 w-3" /> كاهن{row.priest!.title ? ` · ${row.priest!.title}` : ''}</span>}
            {kinds.length === 0 && !unenrolled && <span className="badge bg-slate-100 text-slate-600"><User className="h-3 w-3" /> شخص</span>}
            {unenrolled && <span className="badge bg-amber-100 text-amber-700"><Ban className="h-3 w-3" /> بدون تسجيلات</span>}
            {!unenrolled && (
              <span className="badge bg-sky-100 text-sky-700"><School className="h-3 w-3" /> {enrollmentCount} {enrollmentCount === 1 ? 'تسجيل' : 'تسجيلات'}</span>
            )}
            {row.gender && (
              <span className={`badge ${row.gender === 'male' ? 'bg-blue-50 text-blue-600' : 'bg-pink-50 text-pink-600'}`}>{GENDER_LABELS[row.gender]}</span>
            )}
            {age !== null && <span className="badge bg-slate-100 text-slate-600">{age} سنة</span>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            <button type="button" onClick={copyCode} className="flex items-center gap-1 hover:text-primary-600" dir="ltr" title="نسخ الكود">
              <IdCard className="h-3 w-3" /> {row.national_id}
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 opacity-50" />}
            </button>
            {row.phone && <span className="flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" /> {row.phone}</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
          className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
        >
          <ChevronDown className={`h-5 w-5 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* enrollments — always visible (compact), each with its kind */}
      {(row.enrollments.length > 0 || isPriest || servantPlaces.length > 0) && (
        <ul id={`op-enrollments-${row.id}`} className="mt-2.5 space-y-1">
          {servantPlaces.map((s, i) => (
            <li key={`sp-${i}`} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] ring-1 ${
              row.servant!.status === 'approved' ? 'bg-emerald-50/60 ring-emerald-100' : 'bg-slate-100 ring-slate-200'}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-500"><ShieldCheck className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-1 font-bold text-slate-700">
                  <ChurchIcon className="h-3 w-3 text-gold-500" /> {nameOf(churches, s.church_id)}
                  <span className="text-slate-300">←</span>
                  <Layers className="h-3 w-3 text-accent-600" /> {s.service_id ? nameOf(services, s.service_id) : 'كل الخدمات'}
                  {s.service_id && (<><span className="text-slate-300">←</span><School className="h-3 w-3 text-sky-600" /> كل الفصول</>)}
                </span>
              </span>
              {row.servant!.status !== 'approved' && (
                <span className="badge !py-0 bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> {STATUS_LABELS[row.servant!.status]}</span>
              )}
              <span className="badge !py-0 bg-emerald-100 text-emerald-700">{ENROLLMENT_KIND_LABELS.servant.as}</span>
            </li>
          ))}
          {row.enrollments.map((e) => {
            const stopped = e.status === 'stopped';
            const servantRow = e.kind === 'servant';
            return (
              <li key={e.id} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] ring-1 ${
                servantRow ? 'bg-emerald-50/60 ring-emerald-100' : stopped ? 'bg-slate-100 ring-slate-200' : 'bg-primary-50/40 ring-primary-100'}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${servantRow ? 'bg-white text-emerald-500' : 'bg-white text-primary-500'}`}>
                  {servantRow ? <ShieldCheck className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1 font-bold text-slate-700">
                    <ChurchIcon className="h-3 w-3 text-gold-500" /> {nameOf(churches, e.church_id)}
                    <span className="text-slate-300">←</span>
                    <Layers className="h-3 w-3 text-accent-600" /> {nameOf(services, e.service_id)}
                    <span className="text-slate-300">←</span>
                    <School className="h-3 w-3 text-sky-600" /> {nameOf(classes, e.class_id)}
                  </span>
                </span>
                {stopped && <span className="badge !py-0 bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> موقوف</span>}
                <span className={`badge !py-0 ${servantRow ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>
                  {ENROLLMENT_KIND_LABELS[servantRow ? 'servant' : 'child'].as}
                </span>
                <span className="badge !py-0 bg-emerald-100 text-emerald-700"><CalendarCheck className="h-3 w-3" /> {e.attendance_count}</span>
                <span className="badge !py-0 bg-gold-100 text-gold-600"><Star className="h-3 w-3" /> {e.points}</span>
              </li>
            );
          })}
          {isPriest && (
            <li key="priest" className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] ring-1 ${
              row.priest!.status === 'approved' ? 'bg-violet-50/60 ring-violet-100' : 'bg-slate-100 ring-slate-200'}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-violet-500"><Cross className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-1 font-bold text-slate-700">
                  <ChurchIcon className="h-3 w-3 text-gold-500" /> {nameOf(churches, row.priest!.church_id)}
                  {row.priest!.title && <span className="text-slate-500">· {row.priest!.title}</span>}
                </span>
              </span>
              {row.priest!.status !== 'approved' && (
                <span className="badge !py-0 bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> {PRIEST_STATUS[row.priest!.status] ?? row.priest!.status}</span>
              )}
              <span className="badge !py-0 bg-violet-100 text-violet-700">{ENROLLMENT_KIND_LABELS.priest.as}</span>
            </li>
          )}
        </ul>
      )}

      {/* full details */}
      {open && (
        <div id={`op-details-${row.id}`} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <Detail icon={<CalendarDays className="h-3.5 w-3.5" />} label="تاريخ الميلاد" value={row.birthdate ? `${fmtDate(row.birthdate)}${age !== null ? ` (${age} سنة)` : ''}` : '—'} />
            <Detail icon={<User className="h-3.5 w-3.5" />} label="النوع" value={row.gender ? GENDER_LABELS[row.gender] : '—'} />
            <Detail icon={<Phone className="h-3.5 w-3.5" />} label="الهاتف" value={row.phone ?? '—'} ltr />
            <Detail icon={<KeyRound className="h-3.5 w-3.5" />} label="كلمة مرور البوابة" value={row.has_password ? 'مُعيَّنة' : 'الافتراضية (000000)'} />
            <Detail icon={<MapPin className="h-3.5 w-3.5" />} label="العنوان" value={row.address ?? '—'} full />
            <Detail icon={<StickyNote className="h-3.5 w-3.5" />} label="ملاحظات" value={row.notes ?? '—'} full />
            <Detail icon={<Clock className="h-3.5 w-3.5" />} label="أُضيف" value={fmtDate(row.created_at)} />
            <Detail icon={<Clock className="h-3.5 w-3.5" />} label="آخر تعديل" value={fmtDate(row.edited_at)} />
            {row.enrollments.length > 0 && (
              <>
                <Detail icon={<CalendarCheck className="h-3.5 w-3.5" />} label="إجمالي الحضور" value={String(totalAttendance)} />
                <Detail icon={<Star className="h-3.5 w-3.5" />} label="إجمالي النقاط" value={String(totalPoints)} />
              </>
            )}
          </div>

          {row.servant && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px]">
              <p className="flex flex-wrap items-center gap-1.5 font-extrabold text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" /> حساب خادم — {ROLE_LABELS[row.servant.role]}
                <span className={`badge !py-0 ${row.servant.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : row.servant.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {STATUS_LABELS[row.servant.status]}
                </span>
              </p>
              <p className="mt-1 text-emerald-700">
                {row.servant.church_id
                  ? [nameOf(churches, row.servant.church_id), row.servant.service_id ? nameOf(services, row.servant.service_id) : 'كل الخدمات', row.servant.class_id ? nameOf(classes, row.servant.class_id) : 'كل الفصول'].join(' ← ')
                  : 'كل الإيبارشية'}
                {row.servant.scopes.length > 0 && ` · +${row.servant.scopes.length} ${row.servant.scopes.length === 1 ? 'مكان آخر' : 'أماكن أخرى'}`}
              </p>
              <Link href="/servants" className="mt-1 inline-block font-bold text-emerald-700 underline">إدارة الخدام</Link>
            </div>
          )}

          {row.priest && (
            <div className="rounded-xl bg-violet-50 px-3 py-2 text-[11px]">
              <p className="flex flex-wrap items-center gap-1.5 font-extrabold text-violet-800">
                <Cross className="h-3.5 w-3.5" /> حساب كاهن{row.priest.title ? ` — ${row.priest.title}` : ''}
                <span className={`badge !py-0 ${row.priest.status === 'approved' ? 'bg-violet-100 text-violet-700' : row.priest.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {PRIEST_STATUS[row.priest.status] ?? row.priest.status}
                </span>
              </p>
              <p className="mt-1 text-violet-700">{nameOf(churches, row.priest.church_id)}</p>
              <Link href="/owner/priests" className="mt-1 inline-block font-bold text-violet-700 underline">الكهنة</Link>
            </div>
          )}
        </div>
      )}

      {/* actions */}
      <div className={`mt-2.5 grid gap-2 border-t border-slate-100 pt-2.5 ${onMerge ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <button id={`op-edit-${row.id}`} type="button" onClick={onEdit} disabled={disabled}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-primary-50 py-2 text-xs font-bold text-primary-600 transition hover:bg-primary-100 disabled:opacity-60">
          <Pencil className="h-3.5 w-3.5" /> تعديل
        </button>
        <button id={`op-add-${row.id}`} type="button" onClick={onAddScope} disabled={disabled}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-violet-50 py-2 text-xs font-bold text-violet-600 transition hover:bg-violet-100 disabled:opacity-60">
          <Plus className="h-3.5 w-3.5" /> تسجيل
        </button>
        {onMerge && (
          <button id={`op-merge-${row.id}`} type="button" onClick={onMerge} disabled={disabled}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60">
            <GitMerge className="h-3.5 w-3.5" /> دمج
          </button>
        )}
        <button id={`op-delete-${row.id}`} type="button" onClick={onDelete} disabled={disabled}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-60">
          <Trash2 className="h-3.5 w-3.5" /> حذف
        </button>
      </div>
    </li>
  );
}

function Detail({ icon, label, value, ltr, full }: { icon: React.ReactNode; label: string; value: string; ltr?: boolean; full?: boolean }) {
  return (
    <div className={`flex items-start gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 ${full ? 'col-span-2' : ''}`}>
      <span className="mt-0.5 text-primary-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold text-slate-400">{label}</span>
        <span className="block break-words font-bold text-slate-700" dir={ltr ? 'ltr' : undefined}>{value}</span>
      </span>
    </div>
  );
}
