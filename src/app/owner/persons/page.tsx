'use client';

// ---------- OWNER MODULE → إدارة الأفراد (/owner/persons) ----------
// EVERY person in the system (children AND servants — the `persons` table)
// with all his data and ALL his enrollments, in one owner-only page:
//   * filters: search · الكل / مخدومون / خدام / كهنة · كنيسة → خدمة → فصل ·
//     «بدون تسجيلات» (persons in no enrollment) · النوع
//   * per person: تعديل (persons data) · تسجيل (add an enrollment of ANY
//     kind — كمخدوم / كخادم / ككاهن, 20261005120000) · دمج (merge with
//     another persons row that is the same human) · حذف (cascade)
//   * multi-select (per card, select page, select all matches) + bulk bar:
//     إضافة إلى فصول · حذف من نطاق · حذف نهائي · دمج (exactly two selected)
// Data: RPCs of 20260923120000_owner_persons_management.sql +
// 20261005120000_person_enrollment_kinds_merge.sql (owner only).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Users, Search, Loader2, ChevronRight, ChevronLeft, CheckSquare, Square, X, Plus,
  UserMinus, Trash2, Church as ChurchIcon, Layers, School, Ban, ShieldCheck, User, RefreshCw, Cross, GitMerge,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup, ALL } from '@/lib/queries';
import { ScopeSelect, PanelNotice } from '@/components/ScopeTree';
import { EditPersonModal } from '@/components/PersonDataModals';
import OwnerPersonCard from '@/components/owner/OwnerPersonCard';
import AddEnrollmentModal from '@/components/owner/AddEnrollmentModal';
import MergePersonsModal from '@/components/owner/MergePersonsModal';
import { BulkEnrollModal, BulkUnenrollModal, BulkDeleteModal } from '@/components/owner/OwnerBulkModals';
import {
  fetchOwnerPersons, fetchOwnerPersonsCounts, ownerPersonsError, OWNER_PAGE_SIZE,
  type OwnerPersonRow, type OwnerPersonsCounts, type PersonKindFilter, type ScopeMode,
} from '@/lib/owner-persons';
import {
  SERVANTS_TABLE, GENDER_LABELS,
  type Church, type Service, type ClassRoom, type Gender, type EnrollmentWithPerson, type Person,
} from '@/lib/types';

type BulkModal = 'enroll' | 'unenroll' | 'delete' | 'merge' | null;

export default function OwnerPersonsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());

  // lookups
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);

  // filters
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [kind, setKind] = useState<PersonKindFilter>('all');
  const [unenrolledOnly, setUnenrolledOnly] = useState(false);
  const [church, setChurch] = useState(ALL);
  const [service, setService] = useState(ALL);
  const [cls, setCls] = useState(ALL);
  const [gender, setGender] = useState<Gender | ''>('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const scopeMode: ScopeMode = unenrolledOnly ? 'none' : church !== ALL ? 'scope' : 'all';
  // any filter change → first page
  useEffect(() => { setPage(0); }, [searchQ, kind, unenrolledOnly, church, service, cls, gender]);

  // data
  const [rows, setRows] = useState<OwnerPersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<OwnerPersonsCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const flash = (tone: 'ok' | 'err', text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 5000);
  };

  // selection (person ids — survives paging / filtering)
  const [selected, setSelected] = useState<Map<string, OwnerPersonRow>>(new Map());
  const [bulk, setBulk] = useState<BulkModal>(null);
  const [selectingAll, setSelectingAll] = useState(false);

  // per-row modals
  const [editRow, setEditRow] = useState<OwnerPersonRow | null>(null);
  const [enrollRow, setEnrollRow] = useState<OwnerPersonRow | null>(null);
  const [mergeRow, setMergeRow] = useState<OwnerPersonRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<OwnerPersonRow | null>(null);

  const loadLookups = useCallback(async (force = false) => {
    const [chs, svs, cls] = await Promise.all([
      cachedLookup<Church>(supabase, 'churches', { column: 'name' }, force),
      cachedLookup<Service>(supabase, 'services', { column: 'name' }, force),
      cachedLookup<ClassRoom>(supabase, 'classes', { column: 'name' }, force),
    ]);
    setChurches(chs); setServices(svs); setClasses(cls);
  }, [supabase]);

  const filter = useMemo(() => ({
    search: searchQ,
    scopeMode,
    church: church === ALL ? null : church,
    service: service === ALL ? null : service,
    class: cls === ALL ? null : cls,
    gender: gender || null,
    kind,
  }), [searchQ, scopeMode, church, service, cls, gender, kind]);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        fetchOwnerPersons(supabase, filter, page),
        fetchOwnerPersonsCounts(supabase),
      ]);
      setRows(r.rows);
      setTotal(r.total);
      setCounts(c);
      setLoadError('');
      // keep the selection in sync with fresh data (name / enrollments may have changed)
      setSelected((s) => {
        if (s.size === 0) return s;
        const n = new Map(s);
        for (const row of r.rows) if (n.has(row.id)) n.set(row.id, row);
        return n;
      });
    } catch (e) {
      console.error('owner persons load failed', e);
      setLoadError(ownerPersonsError(e, 'تعذر تحميل الأفراد'));
    } finally {
      setLoading(false);
    }
  }, [supabase, filter, page]);

  const isOwner = profile?.status === 'approved' && profile.role === 'owner';
  useEffect(() => { if (isOwner) loadLookups(); }, [isOwner, loadLookups]);
  useEffect(() => {
    if (!isOwner) return;
    setLoading(true);
    load();
  }, [isOwner, load]);
  useDebouncedRealtime(
    supabase, 'owner-persons',
    [{ table: 'persons' }, { table: 'enrollments' }, { table: SERVANTS_TABLE }, { table: 'priests' }],
    load,
    { enabled: isOwner }
  );

  // ---------- selection helpers ----------
  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleRow = (row: OwnerPersonRow, on: boolean) =>
    setSelected((s) => { const n = new Map(s); if (on) n.set(row.id, row); else n.delete(row.id); return n; });
  const togglePage = () =>
    setSelected((s) => {
      const n = new Map(s);
      if (pageAllSelected) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.set(r.id, r));
      return n;
    });
  const selectAllMatches = async () => {
    setSelectingAll(true);
    try {
      const n = new Map(selected);
      let p = 0;
      // bounded: at most 5000 persons
      while (p * 500 < Math.min(total, 5000)) {
        const r = await fetchOwnerPersons(supabase, filter, p, 500);
        r.rows.forEach((x) => n.set(x.id, x));
        if (r.rows.length < 500) break;
        p++;
      }
      setSelected(n);
    } catch (e) {
      flash('err', ownerPersonsError(e));
    } finally {
      setSelectingAll(false);
    }
  };
  const clearSelection = () => setSelected(new Map());
  const selectedRows = useMemo(() => Array.from(selected.values()), [selected]);

  // ---------- per-row adapters (reuse the shared modals) ----------
  const asPerson = (r: OwnerPersonRow): Person => ({ ...r, created_by: null, edited_by: null });
  const asEnrollment = (r: OwnerPersonRow): EnrollmentWithPerson => {
    const first = r.enrollments.find((e) => e.kind === 'child') ?? r.enrollments[0];
    return {
      id: first?.id ?? '', person_id: r.id,
      church_id: first?.church_id ?? '', service_id: first?.service_id ?? '', class_id: first?.class_id ?? '',
      attendance_count: first?.attendance_count ?? 0, points: first?.points ?? 0,
      created_at: r.created_at, created_by: null, edited_at: r.edited_at, edited_by: null,
      kind: r.servant ? 'servant' : 'child', servant_id: r.servant?.id ?? null, status: first?.status ?? 'active',
      person: asPerson(r),
    };
  };

  const visibleServices = services.filter((s) => church === ALL || s.church_id === church);
  const visibleClasses = classes.filter((c) => (church === ALL || c.church_id === church) && (service === ALL || c.service_id === service));
  const pages = Math.max(1, Math.ceil(total / OWNER_PAGE_SIZE));
  const anyFilter = searchQ || kind !== 'all' || unenrolledOnly || church !== ALL || gender;

  return (
    <AppShell>
      <OwnerGate>
        {/* header */}
        <section className="mb-3 flex items-center gap-2">
          <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex flex-1 items-center gap-2 text-lg font-extrabold">
            <Users className="h-5 w-5 text-gold-500" />
            إدارة الأفراد
            {counts && <span className="badge bg-gold-100 text-gold-700 tabular-nums">{counts.total}</span>}
          </h2>
          <button type="button" onClick={() => { setLoading(true); loadLookups(true); load(); }} aria-label="تحديث" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </section>

        {/* counters */}
        {counts && (
          <div id="op-counters" className={`mb-3 grid gap-2 ${counts.priests !== undefined ? 'grid-cols-5' : 'grid-cols-4'}`}>
            <Counter icon={<Users className="h-4 w-4" />} label="الكل" value={counts.total} tone="bg-slate-50 text-slate-700" active={kind === 'all' && !unenrolledOnly}
              onClick={() => { setKind('all'); setUnenrolledOnly(false); }} />
            <Counter icon={<User className="h-4 w-4" />} label="مخدومون" value={counts.children} tone="bg-primary-50 text-primary-700" active={kind === 'child' && !unenrolledOnly}
              onClick={() => { setKind('child'); setUnenrolledOnly(false); }} />
            <Counter icon={<ShieldCheck className="h-4 w-4" />} label="خدام" value={counts.servants} tone="bg-emerald-50 text-emerald-700" active={kind === 'servant' && !unenrolledOnly}
              onClick={() => { setKind('servant'); setUnenrolledOnly(false); }} />
            {counts.priests !== undefined && (
              <Counter icon={<Cross className="h-4 w-4" />} label="كهنة" value={counts.priests} tone="bg-violet-50 text-violet-700" active={kind === 'priest' && !unenrolledOnly}
                onClick={() => { setKind('priest'); setUnenrolledOnly(false); }} />
            )}
            <Counter icon={<Ban className="h-4 w-4" />} label="بدون تسجيل" value={counts.unenrolled} tone="bg-amber-50 text-amber-700" active={unenrolledOnly}
              onClick={() => { setUnenrolledOnly((v) => !v); setKind('all'); }} />
          </div>
        )}

        {/* filters */}
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="op-search" className="input-field pr-9" placeholder="بحث بالاسم أو الهاتف أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="مسح" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className={`grid grid-cols-3 gap-2 ${unenrolledOnly ? 'opacity-50 pointer-events-none' : ''}`}>
            <ScopeSelect id="op-church" icon={<ChurchIcon className="h-3.5 w-3.5 text-gold-500" />} value={church}
              onChange={(v) => { setChurch(v); setService(ALL); setCls(ALL); }} all="كل الكنائس" options={churches} />
            <ScopeSelect id="op-service" icon={<Layers className="h-3.5 w-3.5 text-accent-600" />} value={service}
              onChange={(v) => { setService(v); setCls(ALL); }} all="كل الخدمات" options={visibleServices} />
            <ScopeSelect id="op-class" icon={<School className="h-3.5 w-3.5 text-sky-600" />} value={cls}
              onChange={setCls} all="كل الفصول" options={visibleClasses} />
          </div>
          <div className="flex items-center gap-2">
            <div id="op-kind" role="tablist" className="grid flex-1 grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
              {([['all', 'الكل'], ['child', 'مخدومون'], ['servant', 'خدام'], ['priest', 'كهنة']] as [PersonKindFilter, string][]).map(([v, l]) => (
                <button key={v} id={`op-kind-${v}`} type="button" role="tab" aria-selected={kind === v} onClick={() => setKind(v)}
                  className={`h-8 rounded-lg text-[11px] font-extrabold transition ${kind === v ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>
                  {l}
                </button>
              ))}
            </div>
            <select id="op-gender" className="input-field !w-auto !py-1.5 !text-xs" value={gender} onChange={(e) => setGender(e.target.value as Gender | '')}>
              <option value="">كل الأنواع</option>
              <option value="male">{GENDER_LABELS.male}</option>
              <option value="female">{GENDER_LABELS.female}</option>
            </select>
            <button id="op-unenrolled" type="button" aria-pressed={unenrolledOnly} onClick={() => setUnenrolledOnly((v) => !v)}
              className={`flex h-9 items-center gap-1 rounded-xl px-3 text-[11px] font-extrabold transition ${unenrolledOnly ? 'bg-amber-500 text-white shadow' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
              <Ban className="h-3.5 w-3.5" /> بدون تسجيلات
            </button>
          </div>
        </div>

        <PanelNotice notice={notice} />

        {/* list toolbar */}
        <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500">
          <button id="op-select-page" type="button" onClick={togglePage} disabled={rows.length === 0}
            className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-100 disabled:opacity-50">
            {pageAllSelected ? <CheckSquare className="h-4 w-4 text-gold-600" /> : <Square className="h-4 w-4" />}
            {pageAllSelected ? 'إلغاء تحديد الصفحة' : 'تحديد الصفحة'}
          </button>
          {total > rows.length && (
            <button id="op-select-all" type="button" onClick={selectAllMatches} disabled={selectingAll}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-gold-700 hover:bg-gold-50 disabled:opacity-50">
              {selectingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
              تحديد كل النتائج ({total})
            </button>
          )}
          <span className="flex-1 text-left tabular-nums">
            {loading ? '' : `${total} ${total === 1 ? 'شخص' : 'أشخاص'}${anyFilter ? ' (مُرشَّح)' : ''}`}
          </span>
        </div>

        {/* list */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
        ) : loadError ? (
          <div className="card py-10 text-center text-sm font-bold text-red-600">{loadError}</div>
        ) : rows.length === 0 ? (
          <div className="card py-12 text-center text-sm font-bold text-slate-400">
            {unenrolledOnly ? 'كل الأشخاص مسجَّلون في فصل واحد على الأقل 🎉' : anyFilter ? 'لا نتائج لهذه المرشحات' : 'لا يوجد أشخاص في النظام بعد'}
          </div>
        ) : (
          <ul id="op-list" className="space-y-2">
            {rows.map((r, i) => (
              <OwnerPersonCard
                key={r.id}
                row={r}
                index={page * OWNER_PAGE_SIZE + i}
                selected={selected.has(r.id)}
                onSelect={(on) => toggleRow(r, on)}
                churches={churches} services={services} classes={classes}
                onEdit={() => setEditRow(r)}
                onAddScope={() => setEnrollRow(r)}
                onMerge={() => setMergeRow(r)}
                onDelete={() => setDeleteRow(r)}
              />
            ))}
          </ul>
        )}

        {/* pager */}
        {!loading && pages > 1 && (
          <div id="op-pager" className="mt-3 flex items-center justify-center gap-3 text-xs font-bold text-slate-600">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="السابق"
              className="rounded-xl bg-white p-2 ring-1 ring-slate-200 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="tabular-nums">صفحة {page + 1} من {pages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="التالي"
              className="rounded-xl bg-white p-2 ring-1 ring-slate-200 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* bulk bar */}
        {selected.size > 0 && (
          <div id="op-bulk-bar" className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 px-3">
            <div className="mx-auto max-w-3xl rounded-2xl bg-slate-900 p-2.5 text-white shadow-2xl ring-1 ring-white/10">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-extrabold">
                <CheckSquare className="h-4 w-4 text-gold-400" />
                <span className="flex-1">{selected.size} {selected.size === 1 ? 'شخص محدد' : 'أشخاص محددون'}</span>
                <button id="op-bulk-clear" type="button" onClick={clearSelection} className="flex items-center gap-1 rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10">
                  <X className="h-3.5 w-3.5" /> إلغاء التحديد
                </button>
              </div>
              <div className={`grid gap-2 ${selected.size === 2 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {selected.size === 2 && (
                  <button id="op-bulk-merge" type="button" onClick={() => setBulk('merge')}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gold-500 text-xs font-extrabold transition hover:bg-gold-400 active:scale-95">
                    <GitMerge className="h-4 w-4" /> دمج الاثنين
                  </button>
                )}
                <button id="op-bulk-enroll" type="button" onClick={() => setBulk('enroll')}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-violet-500 text-xs font-extrabold transition hover:bg-violet-400 active:scale-95">
                  <Plus className="h-4 w-4" /> إضافة إلى فصول
                </button>
                <button id="op-bulk-unenroll" type="button" onClick={() => setBulk('unenroll')}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-amber-500 text-xs font-extrabold transition hover:bg-amber-400 active:scale-95">
                  <UserMinus className="h-4 w-4" /> حذف من نطاق
                </button>
                <button id="op-bulk-delete" type="button" onClick={() => setBulk('delete')}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-600 text-xs font-extrabold transition hover:bg-red-500 active:scale-95">
                  <Trash2 className="h-4 w-4" /> حذف نهائي
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- modals ---------- */}
        {bulk === 'enroll' && (
          <BulkEnrollModal rows={selectedRows} lookups={lookups} onClose={() => setBulk(null)}
            onDone={(m) => { flash('ok', m); load(); }} />
        )}
        {bulk === 'unenroll' && (
          <BulkUnenrollModal rows={selectedRows} lookups={lookups} onClose={() => setBulk(null)}
            onDone={(m) => { flash('ok', m); load(); }} />
        )}
        {bulk === 'delete' && (
          <BulkDeleteModal rows={selectedRows} onClose={() => setBulk(null)}
            onDone={(m) => { flash('ok', m); clearSelection(); load(); }} />
        )}
        {bulk === 'merge' && selectedRows.length === 2 && (
          <MergePersonsModal first={selectedRows[0]} second={selectedRows[1]} lookups={lookups} onClose={() => setBulk(null)}
            onDone={(m) => { flash('ok', m); clearSelection(); load(); }} />
        )}

        {editRow && (
          <EditPersonModal enrollment={asEnrollment(editRow)} onSaved={load} onClose={() => setEditRow(null)} />
        )}
        {enrollRow && (
          <AddEnrollmentModal row={enrollRow} lookups={lookups} onClose={() => setEnrollRow(null)}
            onDone={(m) => { flash('ok', m); load(); }} />
        )}
        {mergeRow && (
          <MergePersonsModal first={mergeRow} lookups={lookups} onClose={() => setMergeRow(null)}
            onDone={(m) => { flash('ok', m); setSelected((s) => { const n = new Map(s); n.delete(mergeRow.id); return n; }); load(); }} />
        )}
        {deleteRow && (
          <BulkDeleteModal rows={[deleteRow]} onClose={() => setDeleteRow(null)}
            onDone={(m) => { flash('ok', m); setSelected((s) => { const n = new Map(s); n.delete(deleteRow.id); return n; }); load(); }} />
        )}
      </OwnerGate>
    </AppShell>
  );
}

function Counter({ icon, label, value, tone, active, onClick }: {
  icon: React.ReactNode; label: string; value: number; tone: string; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 rounded-2xl px-2 py-2 text-center transition ${tone} ${active ? 'ring-2 ring-gold-400 shadow' : 'ring-1 ring-black/5 hover:shadow'}`}>
      <span className="flex items-center gap-1 text-[10px] font-bold opacity-80">{icon} {label}</span>
      <span className="text-base font-extrabold tabular-nums">{value}</span>
    </button>
  );
}
