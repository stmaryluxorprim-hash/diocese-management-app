'use client';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { inClasses, singleClass } from '@/lib/class-multi';

// ---------- SHEPHERDS MODULE (الأشابين) — my group picker ----------
// Every servant (أشبين) is bound to a group of children. This page lets him
// pick children from his scope into HIS group and remove them again.
//   • A child can be in ONE group only — a child already chosen by another
//     servant is shown as taken («في مجموعة فلان») and can't be picked
//     (the DB unique index is the real wall; 23505 → friendly message).
//   • Two tabs: «مجموعتي» (my children, remove) and «اختيار» (scoped list
//     of pickable children, add). Search + church/service/class selectors.
//   • Realtime on shepherd_groups → other servants' picks appear instantly.
// The children page then shows a «مجموعتي» button that narrows its list to
// this group (everything else works the same).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { appIcon } from '@/lib/branding';
import Link from 'next/link';
import Image from 'next/image';
import {
  HeartHandshake, ArrowRight, Search, Loader2, Plus, X, Check, Users, UserPlus,
  Lock, ChevronDown, School, Trash2,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import InfoTip from '@/components/InfoTip';
import { PersonAvatar } from '@/components/CallFeedback';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime, scopeFilter } from '@/lib/realtime';
import {
  fetchEnrollmentsPage, fetchMyGroupEnrollments, cachedLookup, ALL, PAGE_SIZE,
} from '@/lib/queries';
import type {
  EnrollmentWithPerson, Church, Service, ClassRoom, ShepherdClaim, ShepherdGroupSummary,
} from '@/lib/types';
import { useNavLabel } from '@/lib/customization-context';

type Tab = 'mine' | 'pick';

export default function ShepherdsPage() {
  const pageName = useNavLabel('shepherds');
  const { profile, scopes } = useAuth();
  const [supabase] = useState(() => createClient());
  const isManager = !!profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const [tab, setTab] = useState<Tab>('mine');
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ---------- lookups + scope selectors ----------
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [churchFilter, setChurchFilter] = useState(ALL);
  const [serviceFilter, setServiceFilter] = useState(ALL);
  const [classFilter, setClassFilter] = useState<string[]>([]);
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [chs, svs, cls] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setChurches(chs); setServices(svs); setClasses(cls);
    })();
  }, [supabase, profile?.status]);
  const visibleServices = useMemo(
    () => services.filter((s) => churchFilter === ALL || s.church_id === churchFilter),
    [services, churchFilter]
  );
  const visibleClasses = useMemo(
    () => classes.filter((c) =>
      (churchFilter === ALL || c.church_id === churchFilter) &&
      (serviceFilter === ALL || c.service_id === serviceFilter)),
    [classes, churchFilter, serviceFilter]
  );
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? 'فصل غير معروف';

  // ---------- my group + claims of everyone ----------
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState<EnrollmentWithPerson[]>([]);
  const [claims, setClaims] = useState<Map<string, ShepherdClaim>>(new Map());
  const [summary, setSummary] = useState<ShepherdGroupSummary[]>([]);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loadingMine, setLoadingMine] = useState(true);

  const loadGroup = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('shepherd_groups').select('enrollment_id').eq('servant_id', profile.id).limit(2000);
    if (error) { setMigrationMissing(true); setLoadingMine(false); return; }
    setMigrationMissing(false);
    const ids = new Set((data ?? []).map((r: { enrollment_id: string }) => r.enrollment_id));
    setGroupIds(ids);
    const [rows, claimsRes, sumRes] = await Promise.all([
      fetchMyGroupEnrollments(supabase, ids, { church: ALL, service: ALL }),
      supabase.rpc('shepherd_claims'),
      isManager ? supabase.rpc('shepherd_group_summary') : Promise.resolve({ data: null }),
    ]);
    setMine(rows);
    const m = new Map<string, ShepherdClaim>();
    ((claimsRes.data ?? []) as ShepherdClaim[]).forEach((c) => m.set(c.enrollment_id, c));
    setClaims(m);
    setSummary(((sumRes as { data: ShepherdGroupSummary[] | null }).data ?? []) as ShepherdGroupSummary[]);
    setLoadingMine(false);
  }, [supabase, profile, isManager]);

  useEffect(() => { if (profile?.status === 'approved') loadGroup(); }, [profile?.status, loadGroup]);

  // ---------- pickable list (scoped + paged) ----------
  const [pool, setPool] = useState<EnrollmentWithPerson[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolPage, setPoolPage] = useState(0);
  const [poolMore, setPoolMore] = useState(false);
  const loadPool = useCallback(async (page: number, append: boolean) => {
    setPoolLoading(true);
    try {
      const { rows, hasMore } = await fetchEnrollmentsPage(
        supabase, { church: churchFilter, service: serviceFilter, classes: classFilter },
        { page, search: searchQ }
      );
      setPool((prev) => {
        if (!append) return rows;
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setPoolMore(hasMore);
      setPoolPage(page);
    } catch (err) {
      console.error('load pool failed', err);
    } finally {
      setPoolLoading(false);
    }
  }, [supabase, churchFilter, serviceFilter, classFilter, searchQ]);
  useEffect(() => {
    if (tab === 'pick' && profile?.status === 'approved') loadPool(0, false);
  }, [tab, profile?.status, loadPool]);

  // Realtime — any claim / release by anyone
  const rtFilter = scopeFilter(profile, scopes);
  useDebouncedRealtime(
    supabase, 'shepherd-groups',
    [{ table: 'shepherd_groups', filter: rtFilter }],
    loadGroup, { enabled: profile?.status === 'approved', delayMs: 600 }
  );

  // ---------- actions ----------
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const addToGroup = async (e: EnrollmentWithPerson) => {
    if (!profile) return;
    setBusy(e.id);
    const { error } = await supabase.from('shepherd_groups').insert({
      servant_id: profile.id, enrollment_id: e.id,
      // scope re-filled by trigger from the enrollment
      church_id: e.church_id, service_id: e.service_id, class_id: e.class_id,
    });
    setBusy(null);
    if (error?.code === '23505') { flash(`${e.person.name} — اختاره خادم آخر بالفعل`); loadGroup(); return; }
    if (error) { flash('تعذر الإضافة — تأكد من تشغيل تحديث قاعدة البيانات (0025)'); return; }
    // optimistic
    setGroupIds((s) => new Set(s).add(e.id));
    setMine((m) => (m.some((x) => x.id === e.id) ? m : [...m, e]));
    setClaims((c) => new Map(c).set(e.id, {
      enrollment_id: e.id, servant_id: profile.id, servant_name: profile.full_name,
      servant_photo: profile.photo_url, created_at: new Date().toISOString(),
    }));
  };

  const removeFromGroup = async (e: EnrollmentWithPerson) => {
    setBusy(e.id);
    const { error } = await supabase.from('shepherd_groups').delete().eq('enrollment_id', e.id);
    setBusy(null);
    if (error) { flash('تعذر الإزالة'); return; }
    setGroupIds((s) => { const n = new Set(s); n.delete(e.id); return n; });
    setMine((m) => m.filter((x) => x.id !== e.id));
    setClaims((c) => { const n = new Map(c); n.delete(e.id); return n; });
  };

  // ---------- derived ----------
  const myFiltered = useMemo(() => {
    const s = searchQ.toLowerCase();
    return mine.filter((e) =>
      (churchFilter === ALL || e.church_id === churchFilter) &&
      (serviceFilter === ALL || e.service_id === serviceFilter) &&
      inClasses(classFilter, e.class_id) &&
      (!s || e.person.name.toLowerCase().includes(s) ||
        (e.person.phone ?? '').includes(s) || e.person.national_id.includes(s))
    );
  }, [mine, searchQ, churchFilter, serviceFilter, classFilter]);

  // group by class — the manager's manual order of the classes (then name), persons by name
  const classOrder = (id: string) => classes.find((c) => c.id === id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const groupByClass = (list: EnrollmentWithPerson[]) => {
    const m = new Map<string, EnrollmentWithPerson[]>();
    list.forEach((e) => { const a = m.get(e.class_id) ?? []; a.push(e); m.set(e.class_id, a); });
    return Array.from(m.entries())
      .map(([classId, kids]) => ({
        classId, name: className(classId),
        kids: [...kids].sort((a, b) => a.person.name.localeCompare(b.person.name, 'ar')),
      }))
      .sort((a, b) => (classOrder(a.classId) - classOrder(b.classId)) || a.name.localeCompare(b.name, 'ar'));
  };
  const myGroups = useMemo(() => groupByClass(myFiltered), [myFiltered, classes]); // eslint-disable-line react-hooks/exhaustive-deps
  const poolGroups = useMemo(() => groupByClass(pool), [pool, classes]); // eslint-disable-line react-hooks/exhaustive-deps

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => openGroups[id] ?? true;
  const toggle = (id: string) => setOpenGroups((g) => ({ ...g, [id]: !isOpen(id) }));

  const freeCount = pool.filter((e) => !claims.has(e.id)).length;

  return (
    <AppShell>
      <section className="mb-3 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <HeartHandshake className="h-5 w-5 text-teal-600" />
          {pageName}
          <span id="my-group-count" className="badge bg-teal-100 text-teal-700 tabular-nums">{mine.length}</span>
          <InfoTip title={pageName}>اختر المخدومين الذين تتابعهم بنفسك — يظهرون معًا من زر «مجموعتي» في صفحة المخدومين. المخدوم لا يكون إلا في مجموعة خادم واحد.</InfoTip>
        </h2>
      </section>

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          ⚠️ الوحدة تحتاج تشغيل تحديث قاعدة البيانات <code dir="ltr">0025_shepherd_groups.sql</code> في Supabase أولاً.
        </p>
      )}

      {/* ---------- Tabs ---------- */}
      <div id="shepherd-tabs" className="mb-3 grid grid-cols-2 gap-2">
        <button
          id="tab-mine" type="button" aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}
          className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${
            tab === 'mine' ? 'bg-teal-600 text-white shadow ring-2 ring-teal-300' : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          <Users className="h-4 w-4" /> مجموعتي <span className="tabular-nums opacity-80">({mine.length})</span>
        </button>
        <button
          id="tab-pick" type="button" aria-pressed={tab === 'pick'} onClick={() => setTab('pick')}
          className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${
            tab === 'pick' ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300' : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          <UserPlus className="h-4 w-4" /> اختيار مخدومين
        </button>
      </div>

      {/* ---------- Search + scope selectors ---------- */}
      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          id="shepherd-search" className="input-field pr-9"
          placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..."
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <select
          id="shepherd-church" aria-label="اختيار الكنيسة"
          className="input-field appearance-none !px-2 text-xs font-bold"
          value={churchFilter} disabled={churches.length <= 1}
          onChange={(e) => { setChurchFilter(e.target.value); setServiceFilter(ALL); setClassFilter([]); }}
        >
          <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
          {churches.length > 1 && churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          id="shepherd-service" aria-label="اختيار الخدمة"
          className="input-field appearance-none !px-2 text-xs font-bold"
          value={serviceFilter} disabled={visibleServices.length <= 1}
          onChange={(e) => { setServiceFilter(e.target.value); setClassFilter([]); }}
        >
          <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
          {visibleServices.length > 1 && visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <MultiClassSelect
          id="shepherd-class" ariaLabel="اختيار الفصول"
          value={classFilter} disabled={visibleClasses.length <= 1}
          onChange={setClassFilter} options={visibleClasses}
        />
      </div>

      {/* ---------- MY GROUP ---------- */}
      {tab === 'mine' && (
        loadingMine ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-teal-500" /></div>
        ) : myGroups.length === 0 ? (
          <div className="card py-12 text-center text-slate-400">
            <HeartHandshake className="mx-auto mb-3 h-10 w-10 text-teal-300" />
            <p className="font-bold">{mine.length === 0 ? 'مجموعتك فارغة' : 'لا نتائج بهذه الفلاتر'}</p>
            {mine.length === 0 && (
              <button id="go-pick" type="button" onClick={() => setTab('pick')} className="btn-primary mt-4 inline-flex items-center gap-1 !py-2 !px-4 text-sm">
                <UserPlus className="h-4 w-4" /> اختيار مخدومين
              </button>
            )}
          </div>
        ) : (
          <div id="my-group-list" className="space-y-3">
            {myGroups.map((g) => (
              <ClassGroup key={g.classId} name={g.name} count={g.kids.length} open={isOpen(g.classId)} onToggle={() => toggle(g.classId)}>
                {g.kids.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <PersonAvatar name={e.person.name} imageUrl={e.person.image_url} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold">{e.person.name}</p>
                      <p className="truncate text-xs text-slate-400" dir="ltr">{e.person.phone ?? '—'}</p>
                    </div>
                    <button
                      id={`remove-${e.id}`} type="button" aria-label="إزالة من مجموعتي"
                      disabled={busy === e.id} onClick={() => removeFromGroup(e)}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 shadow transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
                    >
                      {busy === e.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <X className="h-5 w-5" />}
                    </button>
                  </li>
                ))}
              </ClassGroup>
            ))}
          </div>
        )
      )}

      {/* ---------- PICK ---------- */}
      {tab === 'pick' && (
        <>
          <p className="mb-2 flex items-center justify-between px-1 text-xs font-bold text-slate-500">
            <span>المتاح للاختيار: <span className="text-emerald-600 tabular-nums">{freeCount}</span></span>
            <span>المختار من الآخرين: <span className="text-slate-400 tabular-nums">{pool.length - freeCount - pool.filter((e) => groupIds.has(e.id)).length}</span></span>
          </p>
          {poolLoading && pool.length === 0 ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
          ) : poolGroups.length === 0 ? (
            <div className="card py-12 text-center text-slate-400">
              <Users className="mx-auto mb-3 h-10 w-10" />
              <p className="font-bold">لا يوجد مخدومين</p>
            </div>
          ) : (
            <div id="pick-list" className="space-y-3">
              {poolGroups.map((g) => (
                <ClassGroup key={g.classId} name={g.name} count={g.kids.length} open={isOpen(g.classId)} onToggle={() => toggle(g.classId)}>
                  {g.kids.map((e) => {
                    const inMine = groupIds.has(e.id);
                    const claim = !inMine ? claims.get(e.id) : undefined;
                    const taken = !!claim;
                    return (
                      <li key={e.id} className={`flex items-center gap-3 px-4 py-3 ${inMine ? 'bg-teal-50' : taken ? 'bg-slate-50' : 'bg-white'}`}>
                        <PersonAvatar name={e.person.name} imageUrl={e.person.image_url} />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-extrabold ${taken ? 'text-slate-400' : ''}`}>{e.person.name}</p>
                          {inMine ? (
                            <p className="flex items-center gap-1 text-xs font-bold text-teal-600"><Check className="h-3 w-3" /> في مجموعتي</p>
                          ) : taken ? (
                            <p className="flex items-center gap-1 text-xs font-bold text-slate-400">
                              <Lock className="h-3 w-3" /> في مجموعة {claim.servant_name}
                              {claim.servant_photo && (
                                <span className="relative inline-block h-4 w-4 overflow-hidden rounded-full">
                                  <Image src={claim.servant_photo} alt={claim.servant_name} fill sizes="16px" className="object-cover" />
                                </span>
                              )}
                            </p>
                          ) : (
                            <p className="truncate text-xs text-slate-400" dir="ltr">{e.person.phone ?? '—'}</p>
                          )}
                        </div>
                        {inMine ? (
                          <button
                            id={`pick-remove-${e.id}`} type="button" aria-label="إزالة من مجموعتي"
                            disabled={busy === e.id} onClick={() => removeFromGroup(e)}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-600 text-white shadow transition hover:bg-red-500 active:scale-95 disabled:opacity-50"
                          >
                            {busy === e.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                          </button>
                        ) : taken ? (
                          isManager ? (
                            <button
                              id={`pick-free-${e.id}`} type="button" aria-label="تحرير المخدوم من مجموعة الخادم" title="تحرير من المجموعة (للمسؤولين)"
                              disabled={busy === e.id} onClick={() => removeFromGroup(e)}
                              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-500 shadow-none transition hover:bg-red-100 hover:text-red-500 active:scale-95 disabled:opacity-50"
                            >
                              {busy === e.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-300"><Lock className="h-4 w-4" /></span>
                          )
                        ) : (
                          <button
                            id={`pick-add-${e.id}`} type="button" aria-label="إضافة إلى مجموعتي"
                            disabled={busy === e.id} onClick={() => addToGroup(e)}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50"
                          >
                            {busy === e.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ClassGroup>
              ))}
              {poolMore && (
                <button
                  id="pick-load-more" type="button" disabled={poolLoading} onClick={() => loadPool(poolPage + 1, true)}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
                >
                  {poolLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                  عرض {PAGE_SIZE} مخدوم إضافيين
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ---------- Managers: groups overview ---------- */}
      {isManager && summary.length > 0 && (
        <section id="groups-summary" className="mt-6">
          <h3 className="mb-2 text-sm font-extrabold text-slate-500">مجموعات الخدام في نطاقك</h3>
          <ul className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {summary.map((s) => (
              <li key={s.servant_id} className="flex items-center gap-3 px-4 py-3">
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-slate-100">
                  <Image src={s.servant_photo ?? appIcon(96)} alt={s.servant_name} fill sizes="36px" className="object-cover" />
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-bold">
                  {s.servant_name}{s.servant_id === profile?.id && <span className="mr-1 text-xs text-teal-600">(أنا)</span>}
                </p>
                <span className="badge bg-teal-100 text-teal-700 tabular-nums">{s.children} مخدوم</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {toast && (
        <div id="shepherd-toast" role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
          {toast}
        </div>
      )}
    </AppShell>
  );
}

// ---------- Collapsible class group ----------
function ClassGroup({
  name, count, open, onToggle, children,
}: { name: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button
        type="button" onClick={onToggle}
        className={`flex w-full items-center justify-between border border-indigo-50 bg-white px-4 py-3 ${
          open ? 'rounded-t-2xl border-b-indigo-100' : 'rounded-2xl shadow-card'
        }`}
      >
        <span className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
          <School className="h-4 w-4 text-primary-600" />
          {name}
          <span className="badge bg-primary-100 text-primary-700 tabular-nums">{count}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="divide-y divide-indigo-100 overflow-hidden rounded-b-2xl border border-t-0 border-indigo-100 bg-white">
          {children}
        </ul>
      )}
    </div>
  );
}
