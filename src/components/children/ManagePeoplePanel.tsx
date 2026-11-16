'use client';

// ---------- إدارة المخدومين → المخدومين (migration 0043) ----------
// THE place where CHILDREN are edited / moved / stopped / deleted. The
// children page and the scanner only VIEW data. Servants have their own
// twin — إدارة الخدام → الخدام (ServantsPanel) — built from the same
// shared pieces (ScopeTree.tsx) so both pages look and behave alike:
//
//   * ScopeFilters: search · كنيسة → خدمة → فصل · الكل / يعمل / موقوف
//   * the list is ALWAYS grouped church → service → class (nested sticky
//     headers, each with a count and ⏸ إيقاف الكل / ▶ تفعيل الكل for that node)
//   * per child: تعديل (data + scope move) · الفصول (0045: add him to MORE
//     classes / remove one — PersonClassesModal) · إيقاف/تفعيل · حذف
//   * «إيقاف / تفعيل نطاق كامل» card → RPC set_enrollments_status

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Trash2, PauseCircle, PlayCircle, IdCard, Phone, School } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchEnrollmentsPage, cachedLookup, ALL } from '@/lib/queries';
import { EditPersonModal, DeletePersonModal } from '@/components/PersonDataModals';
import PersonClassesModal from '@/components/children/PersonClassesModal';
import {
  ScopeFilters, ScopeTreeView, PersonCard, BulkScopeStatusCard, PanelNotice, buildScopeTree,
  type StatusFilter, type ScopeSelection, type ScopeNode,
} from '@/components/ScopeTree';
import { SERVANTS_TABLE, type EnrollmentWithPerson, type Church, type Service, type ClassRoom } from '@/lib/types';

export default function ManagePeoplePanel() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());

  const [rows, setRows] = useState<EnrollmentWithPerson[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // filters
  const [scope, setScope] = useState<ScopeSelection>({ church: ALL, service: ALL, classes: [] });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // modals
  const [editChild, setEditChild] = useState<EnrollmentWithPerson | null>(null);
  const [deleteChild, setDeleteChild] = useState<EnrollmentWithPerson | null>(null);
  const [classesOf, setClassesOf] = useState<EnrollmentWithPerson | null>(null);

  const loadLookups = useCallback(async (force = false) => {
    const [chs, svs, cls] = await Promise.all([
      cachedLookup<Church>(supabase, 'churches', { column: 'name' }, force),
      cachedLookup<Service>(supabase, 'services', { column: 'name' }, force),
      cachedLookup<ClassRoom>(supabase, 'classes', { column: 'name' }, force),
    ]);
    setChurches(chs); setServices(svs); setClasses(cls);
  }, [supabase]);

  const load = useCallback(async () => {
    try {
      // up to 5 pages (1000 rows) — a management screen, still bounded.
      // Status is filtered client-side so the tab counters stay correct.
      const out: EnrollmentWithPerson[] = [];
      let page = 0; let more = false;
      do {
        const r = await fetchEnrollmentsPage(supabase, scope, { page, search: searchQ, kind: 'child', status: 'all' });
        out.push(...r.rows); more = r.hasMore; page++;
      } while (more && page < 5);
      setRows(out);
      setHasMore(more);
    } catch (err) {
      console.error('manage people load failed', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, scope, searchQ]);

  useEffect(() => { if (profile?.status === 'approved') loadLookups(); }, [profile?.status, loadLookups]);
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    setLoading(true);
    load();
  }, [profile?.status, load]);
  useDebouncedRealtime(
    supabase, 'manage-people',
    [{ table: 'enrollments' }, { table: 'persons' }, { table: SERVANTS_TABLE }],
    load,
    { enabled: profile?.status === 'approved' }
  );

  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);

  const counts = useMemo(() => {
    const stopped = rows.filter((r) => r.status === 'stopped').length;
    return { all: rows.length, active: rows.length - stopped, stopped };
  }, [rows]);

  const visible = useMemo(
    () => statusFilter === 'all' ? rows : rows.filter((r) => (statusFilter === 'stopped') === (r.status === 'stopped')),
    [rows, statusFilter]
  );

  const tree = useMemo(() => buildScopeTree(visible, lookups, (e) => e.person.name), [visible, lookups]);

  // 0045: how many classes each person is in (within what the caller sees)
  const classCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.person_id, (m.get(r.person_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const flash = (tone: 'ok' | 'err', text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 4000);
  };

  // ---------- per-row ----------
  const toggleChild = async (e: EnrollmentWithPerson) => {
    const next = e.status === 'stopped' ? 'active' : 'stopped';
    if (next === 'stopped' && !confirm(`إيقاف «${e.person.name}»؟\n\nلن يُسجَّل له حضور أو نقاط ولن يدخل بوابته حتى تعيد تفعيله. بياناته وسجلاته تبقى كما هي.`)) return;
    setBusy(e.id);
    const { error } = await supabase.rpc('set_enrollments_status', { p_status: next, p_enrollment_ids: [e.id] });
    setBusy(null);
    if (error) return flash('err', 'تعذر تغيير الحالة — تأكد من صلاحياتك وتحديث قاعدة البيانات (0043)');
    setRows((rs) => rs.map((r) => (r.id === e.id ? { ...r, status: next } : r)));
    flash('ok', next === 'stopped' ? `تم إيقاف ${e.person.name}` : `تم تفعيل ${e.person.name}`);
  };

  // ---------- node (scope) ----------
  const setNodeStatus = async (n: ScopeNode<EnrollmentWithPerson>, status: 'active' | 'stopped') => {
    if (!n.scope.church) return;
    const verb = status === 'stopped' ? 'إيقاف' : 'تفعيل';
    if (!confirm(`${verb} كل المخدومين في «${n.name}» (${n.rows.length})؟`)) return;
    setBusy(`node:${n.key}`);
    const { data, error } = await supabase.rpc('set_enrollments_status', {
      p_status: status, p_church: n.scope.church, p_service: n.scope.service, p_class: n.scope.class, p_kind: 'child',
    });
    setBusy(null);
    if (error) return flash('err', 'تعذر تنفيذ العملية — تأكد من صلاحياتك على هذا النطاق');
    const r = (data ?? {}) as { children?: number };
    flash('ok', `تم ${verb} ${r.children ?? 0} — ${n.name}`);
    load();
  };

  return (
    <>
      <ScopeFilters
        idPrefix="people"
        search={search} onSearch={setSearch}
        scope={scope} onScope={setScope}
        status={statusFilter} onStatus={setStatusFilter}
        lookups={lookups} counts={counts}
      />

      <BulkScopeStatusCard kind="child" lookups={lookups} initial={scope} stoppedCount={counts.stopped}
        onDone={(msg, ok) => { flash(ok ? 'ok' : 'err', msg); if (ok) load(); }} />

      <PanelNotice notice={notice} />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-sm font-bold text-slate-400">
          {searchQ ? 'لا نتائج' : statusFilter === 'stopped' ? 'لا يوجد مخدومون موقوفون في هذا النطاق' : 'لا يوجد مخدومون في هذا النطاق'}
        </div>
      ) : (
        <>
          <ScopeTreeView
            nodes={tree}
            kind="child"
            idPrefix="people"
            nodeAction={(n) => n.scope.church ? {
              allStopped: n.rows.every((r) => r.status === 'stopped'),
              busy: busy === `node:${n.key}`,
              onToggle: () => setNodeStatus(n, n.rows.every((r) => r.status === 'stopped') ? 'active' : 'stopped'),
            } : null}
            renderRow={(e) => {
              const stopped = e.status === 'stopped';
              const rowBusy = busy === e.id;
              return (
                <PersonCard
                  key={e.id}
                  id={`person-row-${e.id}`}
                  kind="child"
                  name={e.person.name}
                  photo={e.person.image_url}
                  stopped={stopped}
                  badges={(classCount.get(e.person_id) ?? 1) > 1 ? (
                    <span className="badge bg-amber-100 text-amber-700"><School className="h-3 w-3" /> {classCount.get(e.person_id)} فصول</span>
                  ) : undefined}
                  meta={
                    <>
                      <span className="flex items-center gap-1" dir="ltr"><IdCard className="h-3 w-3" /> {e.person.national_id}</span>
                      {e.person.phone && <span className="flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" /> {e.person.phone}</span>}
                    </>
                  }
                  actions={[
                    { id: `edit-${e.id}`, tone: 'primary', icon: <Pencil className="h-3.5 w-3.5" />, label: 'تعديل', onClick: () => setEditChild(e), disabled: rowBusy },
                    { id: `classes-${e.id}`, tone: 'violet', icon: <School className="h-3.5 w-3.5" />, label: 'الفصول', onClick: () => setClassesOf(e), disabled: rowBusy },
                    { id: `stop-${e.id}`, tone: stopped ? 'emerald' : 'amber', busy: rowBusy,
                      icon: stopped ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />,
                      label: stopped ? 'تفعيل' : 'إيقاف', onClick: () => toggleChild(e) },
                    { id: `delete-${e.id}`, tone: 'red', icon: <Trash2 className="h-3.5 w-3.5" />, label: 'حذف', onClick: () => setDeleteChild(e), disabled: rowBusy },
                  ]}
                />
              );
            }}
          />
          {hasMore && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-700">
              تُعرض أول 1000 فقط — ضيّق النطاق أو ابحث بالاسم
            </p>
          )}
        </>
      )}

      {editChild && (
        <EditPersonModal enrollment={editChild} churches={churches} services={services} classes={classes}
          onSaved={load} onClose={() => setEditChild(null)} />
      )}
      {deleteChild && (
        <DeletePersonModal enrollment={deleteChild} churches={churches} services={services} classes={classes}
          onDeleted={load} onClose={() => setDeleteChild(null)} />
      )}
      {classesOf && (
        <PersonClassesModal person={classesOf.person} churches={churches} services={services} classes={classes}
          onChanged={load} onClose={() => setClassesOf(null)} />
      )}
    </>
  );
}
