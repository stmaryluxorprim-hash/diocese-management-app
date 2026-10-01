'use client';

// ---------- إدارة الأفراد → «دمج» — two persons rows → ONE person ----------
// migration 20261005120000. The same human sometimes ends up as TWO rows in
// `persons` (e.g. a servant account registered under one code and a child
// enrollment under another). The owner:
//   1. picks the OTHER person (search by name / code / phone — or the
//      second selected card)
//   2. reviews both side by side and chooses, field by field, which value
//      survives (الكود · الاسم · النوع · الميلاد · الهاتف · العنوان ·
//      الملاحظات · الصورة) — «الأساسي» is the row that stays (its id, its
//      sessions); everything of the other row is moved onto it
//   3. confirms → owner_merge_persons; when the servant Auth account must
//      follow the merged code / password, mergePersons() realigns it through
//      POST /api/servants/account {action:'realign'}.
// Refused by the DB when both rows own a servant account or a priest account.

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { GitMerge, Loader2, Search, User, ShieldCheck, Cross, AlertTriangle, Check, School, IdCard, Star, ArrowLeftRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ModalFrame } from '@/components/PersonDataModals';
import {
  fetchOwnerPersons, mergePersons, ownerPersonsError, personKinds, ENROLLMENT_KIND_LABELS, MERGE_FIELDS,
  type OwnerPersonRow, type MergeField,
} from '@/lib/owner-persons';
import { GENDER_LABELS, type Church, type Service, type ClassRoom } from '@/lib/types';

interface Lookups { churches: Church[]; services: Service[]; classes: ClassRoom[] }

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
};

const display = (f: MergeField, r: OwnerPersonRow): string => {
  switch (f) {
    case 'national_id': return r.national_id;
    case 'name': return r.name;
    case 'gender': return r.gender ? GENDER_LABELS[r.gender] : '—';
    case 'birthdate': return fmtDate(r.birthdate);
    case 'phone': return r.phone ?? '—';
    case 'address': return r.address ?? '—';
    case 'notes': return r.notes ?? '—';
    case 'image_url': return r.image_url ? 'صورة' : '—';
  }
};
const raw = (f: MergeField, r: OwnerPersonRow): string | null =>
  (f === 'national_id' ? r.national_id : f === 'name' ? r.name : (r[f] as string | null)) ?? null;

export default function MergePersonsModal({ first, second, lookups, onDone, onClose }: {
  first: OwnerPersonRow;
  /** pre-chosen second person (two selected cards) — otherwise the owner searches */
  second?: OwnerPersonRow | null;
  lookups: Lookups;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [other, setOther] = useState<OwnerPersonRow | null>(second ?? null);
  const [keepFirst, setKeepFirst] = useState(true);
  const [picks, setPicks] = useState<Record<MergeField, 'a' | 'b'>>({} as Record<MergeField, 'a' | 'b'>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');

  // ---- step 1: search the other person ----
  const [q, setQ] = useState('');
  const [results, setResults] = useState<OwnerPersonRow[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (other) return;
    const s = q.trim();
    if (!s) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetchOwnerPersons(supabase, { search: s, scopeMode: 'all', kind: 'all' }, 0, 20);
        setResults(r.rows.filter((x) => x.id !== first.id));
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, other, first.id, supabase]);

  const a = first, b = other;
  const keep = keepFirst ? a : b;
  const remove = keepFirst ? b : a;

  // default pick per field: the kept row, unless its value is empty and the other's is not
  useEffect(() => {
    if (!b) return;
    const next = {} as Record<MergeField, 'a' | 'b'>;
    for (const { key } of MERGE_FIELDS) {
      const va = raw(key, a), vb = raw(key, b);
      const def: 'a' | 'b' = keepFirst ? 'a' : 'b';
      const alt: 'a' | 'b' = keepFirst ? 'b' : 'a';
      next[key] = (def === 'a' ? va : vb) ? def : (alt === 'a' ? va : vb) ? alt : def;
    }
    setPicks(next);
  }, [a, b, keepFirst]);

  const conflict = useMemo(() => {
    if (!b) return '';
    if (a.servant && b.servant) return 'للشخصين حسابا خادم — احذف أحدهما من إدارة الخدام أولاً ثم ادمج';
    if (a.priest && b.priest) return 'للشخصين حسابا كاهن — احذف أحدهما من الكهنة أولاً ثم ادمج';
    return '';
  }, [a, b]);

  const run = async () => {
    if (!b || !keep || !remove || conflict) return;
    setError(''); setWarn('');
    setBusy(true);
    try {
      const fields: Partial<Record<MergeField, string | null>> = {};
      for (const { key } of MERGE_FIELDS) fields[key] = raw(key, picks[key] === 'a' ? a : b);
      const r = await mergePersons(supabase, keep.id, remove.id, fields);
      const moved = Object.entries(r.moved).reduce((s, [, n]) => s + n, 0);
      let msg = `تم دمج «${remove.name}» في «${keep.name}» — الكود ${r.code}${moved ? ` · ${moved} ${moved === 1 ? 'سجل نُقل' : 'سجلات نُقلت'}` : ''}`;
      if (r.realign_servant) msg += ' — تنبيه: تعذر تحديث حساب دخول الخادم، أعد تعيين كلمة مروره من إدارة الخدام';
      onDone(msg);
      onClose();
    } catch (e) {
      setError(ownerPersonsError(e, 'تعذر الدمج'));
    } finally {
      setBusy(false);
    }
  };

  const Kinds = ({ r }: { r: OwnerPersonRow }) => {
    const ks = personKinds(r);
    return (
      <span className="flex flex-wrap gap-1">
        {ks.length === 0 && <span className="badge !py-0 bg-amber-100 text-amber-700">بدون تسجيلات</span>}
        {ks.includes('child') && <span className="badge !py-0 bg-primary-100 text-primary-700"><User className="h-3 w-3" /> {ENROLLMENT_KIND_LABELS.child.noun}</span>}
        {ks.includes('servant') && <span className="badge !py-0 bg-emerald-100 text-emerald-700"><ShieldCheck className="h-3 w-3" /> {ENROLLMENT_KIND_LABELS.servant.noun}</span>}
        {ks.includes('priest') && <span className="badge !py-0 bg-violet-100 text-violet-700"><Cross className="h-3 w-3" /> {ENROLLMENT_KIND_LABELS.priest.noun}</span>}
      </span>
    );
  };

  const PersonHead = ({ r, side }: { r: OwnerPersonRow; side: 'a' | 'b' }) => {
    const isKeep = (side === 'a') === keepFirst;
    const pts = r.enrollments.reduce((s, e) => s + e.points, 0);
    return (
      <div className={`rounded-2xl p-2.5 ring-2 ${isKeep ? 'bg-gold-50 ring-gold-300' : 'bg-slate-50 ring-slate-200'}`}>
        <div className="flex items-center gap-2">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 text-slate-300">
            {r.image_url ? <Image src={r.image_url} alt={r.name} fill sizes="40px" className="object-cover" /> : <User className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-extrabold">{r.name}</p>
            <p className="flex items-center gap-1 text-[10px] text-slate-500" dir="ltr"><IdCard className="h-3 w-3" /> {r.national_id}</p>
          </div>
        </div>
        <div className="mt-1.5"><Kinds r={r} /></div>
        <p className="mt-1 flex flex-wrap gap-x-2 text-[10px] font-bold text-slate-500">
          <span className="flex items-center gap-0.5"><School className="h-3 w-3" /> {r.enrollments.length} {r.enrollments.length === 1 ? 'تسجيل' : 'تسجيلات'}</span>
          <span className="flex items-center gap-0.5"><Star className="h-3 w-3 text-gold-500" /> {pts}</span>
        </p>
        <button type="button" onClick={() => setKeepFirst(side === 'a')} aria-pressed={isKeep}
          className={`mt-2 w-full rounded-lg py-1 text-[11px] font-extrabold transition ${isKeep ? 'bg-gold-500 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'}`}>
          {isKeep ? '★ الأساسي (يبقى)' : 'اجعله الأساسي'}
        </button>
      </div>
    );
  };

  return (
    <ModalFrame title="دمج شخصين" icon={<GitMerge className="h-5 w-5 text-amber-600" />} onClose={onClose}>
      {!b ? (
        <>
          <p className="mb-3 text-xs text-slate-500">
            سيُدمج <b>{a.name}</b> <span dir="ltr">({a.national_id})</span> مع شخص آخر هو في الحقيقة نفس الإنسان — ابحث عنه:
          </p>
          <div className="relative mb-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="mg-search" autoFocus className="input-field pr-9" placeholder="بحث بالاسم أو الكود أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {searching && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary-500" /></div>}
          <ul id="mg-results" className="max-h-72 space-y-1.5 overflow-y-auto no-scrollbar">
            {!searching && q.trim() && results.length === 0 && <li className="py-4 text-center text-xs font-bold text-slate-400">لا نتائج</li>}
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOther(r)} className="flex w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-right ring-1 ring-slate-100 transition hover:bg-slate-100">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-slate-300">
                    {r.image_url ? <Image src={r.image_url} alt={r.name} fill sizes="36px" className="object-cover" /> : <User className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-extrabold">{r.name}</p>
                    <p className="text-[10px] text-slate-500" dir="ltr">{r.national_id}{r.phone ? ` · ${r.phone}` : ''}</p>
                  </div>
                  <Kinds r={r} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <PersonHead r={a} side="a" />
            <PersonHead r={b} side="b" />
          </div>

          {conflict ? (
            <p className="flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {conflict}
            </p>
          ) : (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-600">
                <ArrowLeftRight className="h-3.5 w-3.5 text-amber-600" /> راجع البيانات واختر القيمة الصحيحة لكل حقل
              </p>
              <ul id="mg-fields" className="space-y-1.5">
                {MERGE_FIELDS.map(({ key, label }) => {
                  const va = display(key, a), vb = display(key, b);
                  const same = raw(key, a) === raw(key, b);
                  return (
                    <li key={key} className="rounded-xl bg-slate-50 p-2">
                      <p className="mb-1 text-[10px] font-bold text-slate-400">{label}{same && <span className="mr-1 text-emerald-600">· متطابق</span>}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['a', 'b'] as const).map((side) => {
                          const on = picks[key] === side;
                          const v = side === 'a' ? va : vb;
                          const r = side === 'a' ? a : b;
                          return (
                            <button key={side} type="button" aria-pressed={on} id={`mg-${key}-${side}`}
                              onClick={() => setPicks((p) => ({ ...p, [key]: side }))}
                              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-right text-[11px] font-bold transition ${
                                on ? 'bg-amber-500 text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'}`}>
                              {on ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0" />}
                              {key === 'image_url' && r.image_url ? (
                                <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md"><Image src={r.image_url} alt="" fill sizes="24px" className="object-cover" /></span>
                              ) : null}
                              <span className="min-w-0 flex-1 truncate" dir={key === 'national_id' || key === 'phone' ? 'ltr' : undefined}>{v}</span>
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <p className="font-extrabold">ماذا سيحدث؟</p>
                <ul className="mt-1 list-disc space-y-0.5 pr-4">
                  <li>تُنقل كل تسجيلات «{remove?.name}» (كمخدوم · كخادم · ككاهن) وحضوره ونقاطه وسجلاته إلى «{keep?.name}» — التسجيل المكرر في نفس الفصل يُدمج بمجموع حضوره ونقاطه.</li>
                  <li>كلمة المرور: كلمة مرور «{keep?.name}» إن وُجدت، وإلا كلمة مرور الآخر.</li>
                  <li>يُحذف الصف «{remove?.name}» نهائيًا — لا تراجع.</li>
                </ul>
              </div>
            </>
          )}

          {warn && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{warn}</p>}
          {error && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            {!second && (
              <button type="button" onClick={() => { setOther(null); setError(''); }} className="btn-secondary !px-3">تغيير</button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
            <button id="mg-submit" type="button" onClick={run} disabled={busy || !!conflict}
              className="btn-primary flex flex-1 items-center justify-center gap-2 !bg-gradient-to-br !from-amber-500 !to-amber-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              دمج
            </button>
          </div>
        </>
      )}
    </ModalFrame>
  );
}
