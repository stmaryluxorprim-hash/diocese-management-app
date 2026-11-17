'use client';

// ---------- طلبات انضمام المخدومين (migration 0042) ----------
// A pending request is a `child_join_requests` row created from /child/signup.
// The reviewer may correct the class before approving; approval upserts the
// person by code, enrolls him and stores the chosen password.

import { cachedLookup } from '@/lib/queries';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import {
  UserCheck, Check, X, Phone, Loader2, IdCard, User, Cake, MapPin, Clock, History, Trash2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import type { Church, Service, ClassRoom, ChildJoinRequest } from '@/lib/types';
import { GENDER_LABELS, CHILD_JOIN_REQUEST_STATUS_LABELS } from '@/lib/types';

// column-level grants: password_hash is NOT selectable → never use '*'
export const CHILD_JOIN_REQUEST_COLUMNS =
  'id, code, name, gender, birthdate, phone, address, notes, image_url, church_id, service_id, class_id, ' +
  'status, decision_note, decided_by, decided_at, person_id, enrollment_id, created_at';

const fmtDate = (d: string | null) => {
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}/${y}`;
};
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

export default function ChildRequestsPanel() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [rows, setRows] = useState<ChildJoinRequest[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('child_join_requests').select(CHILD_JOIN_REQUEST_COLUMNS);
    q = view === 'pending'
      ? q.eq('status', 'pending').order('created_at')
      : q.neq('status', 'pending').order('decided_at', { ascending: false }).limit(100);
    const [{ data: p }, ch, sv, cl] = await Promise.all([
      q,
      cachedLookup<Church>(supabase, 'churches'),
      cachedLookup<Service>(supabase, 'services'),
      cachedLookup<ClassRoom>(supabase, 'classes'),
    ]);
    setRows((p ?? []) as unknown as ChildJoinRequest[]);
    setChurches(ch ?? []);
    setServices(sv ?? []);
    setClasses(cl ?? []);
    setLoading(false);
  }, [supabase, view]);

  useEffect(() => {
    if (profile?.status === 'approved') { setLoading(true); load(); }
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'child-requests-panel', [{ table: 'child_join_requests' }], load, { enabled: !!profile });

  // requests grouped church → service → class (the tree headers carry the scope)
  const lookups = useMemo(() => toLookups(churches, services, classes), [churches, services, classes]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    rows,
    (r, q) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.phone ?? '').includes(q),
  );

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button
          id="child-req-view-pending"
          onClick={() => setView('pending')}
          aria-pressed={view === 'pending'}
          className={`flex items-center justify-center gap-1 rounded-xl py-2 text-sm font-extrabold transition ${view === 'pending' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}
        >
          <Clock className="h-4 w-4" /> قيد المراجعة
        </button>
        <button
          id="child-req-view-history"
          onClick={() => setView('history')}
          aria-pressed={view === 'history'}
          className={`flex items-center justify-center gap-1 rounded-xl py-2 text-sm font-extrabold transition ${view === 'history' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}
        >
          <History className="h-4 w-4" /> السجل
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <UserCheck className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">{view === 'pending' ? 'لا توجد طلبات معلقة 🎉' : 'لا يوجد سجل بعد'}</p>
        </div>
      ) : (
        <>
        <ScopeGroupFilters idPrefix="child-req" scope={scope} onScope={setScope} lookups={lookups}
          search={search} onSearch={setSearch} placeholder="بحث بالاسم أو الكود أو الهاتف..." />
        <ScopeGroups
          idPrefix={view === 'pending' ? 'child-requests-list' : 'child-requests-history'}
          rows={visible}
          lookups={lookups}
          tone="indigo"
          itemName={null}
          emptyText="لا توجد طلبات مطابقة"
          renderItem={(r) => view === 'pending' ? (
            <RequestCard key={r.id} request={r} churches={churches} services={services} classes={classes} onDone={load} />
          ) : (
            <li key={r.id} className="card flex items-center gap-3 !py-3">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-50 flex items-center justify-center">
                {r.image_url ? <Image src={r.image_url} alt={r.name} fill sizes="44px" className="object-cover" /> : <User className="h-5 w-5 text-slate-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold text-sm">{r.name} <span className="text-xs font-normal text-slate-400" dir="ltr">{r.code}</span></p>
                {r.decided_at && <p className="truncate text-xs text-slate-400">{fmtWhen(r.decided_at)}</p>}
                {r.decision_note && <p className="truncate text-xs text-slate-500">📝 {r.decision_note}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${r.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {CHILD_JOIN_REQUEST_STATUS_LABELS[r.status]}
              </span>
              <button
                aria-label="حذف"
                onClick={async () => { await supabase.from('child_join_requests').delete().eq('id', r.id); load(); }}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          )}
        />
        </>
      )}
    </>
  );
}

function RequestCard({
  request, churches, services, classes, onDone,
}: {
  request: ChildJoinRequest;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onDone: () => void;
}) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  const [churchId, setChurchId] = useState(request.church_id ?? '');
  const [serviceId, setServiceId] = useState(request.service_id ?? '');
  // several classes may be ticked: the first approves the request, the others enroll the same child
  const [classIds, setClassIds] = useState<string[]>(request.class_id ? [request.class_id] : []);

  const canPickChurch = profile?.role === 'owner';
  const canPickService = profile?.role === 'owner' || profile?.role === 'church_manager';
  const canPickClass = profile?.role !== 'class_servant';

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => !serviceId || c.service_id === serviceId);
  const pickedClasses = scopedClasses.filter((c) => classIds.includes(c.id));

  const mapError = (m: string) =>
    m.includes('forbidden') ? 'ليس لديك صلاحية على هذا الفصل'
    : m.includes('scope_required') ? 'اختر الكنيسة والخدمة والفصل'
    : m.includes('class_not_in_service') ? 'الفصل لا ينتمي لهذه الخدمة'
    : m.includes('not_pending') ? 'هذا الطلب لم يعد قيد المراجعة'
    : m.includes('not_found') ? 'الطلب غير موجود'
    : 'تعذر تنفيذ العملية، حاول مجدداً';

  const approve = async () => {
    setError('');
    if (!churchId || !serviceId || pickedClasses.length === 0) return setError('اختر الكنيسة والخدمة والفصل');
    const [main, ...others] = pickedClasses;
    setBusy(true);
    const { error: err } = await supabase.rpc('review_child_join_request', {
      p_request: request.id,
      p_approve: true,
      p_note: null,
      p_church: churchId,
      p_service: serviceId,
      p_class: main.id,
    });
    if (err) { setBusy(false); return setError(mapError(err.message ?? '')); }
    // the other ticked classes: same child (by his code), one enrollment each
    const failed: string[] = [];
    for (const c of others) {
      const { error: xe } = await supabase.rpc('add_person_and_enroll', {
        p_church: c.church_id, p_service: c.service_id, p_class: c.id,
        p_name: request.name, p_national_id: request.code, p_gender: request.gender,
        p_birthdate: request.birthdate, p_phone: request.phone, p_address: request.address,
        p_notes: request.notes, p_image_url: request.image_url, p_points: 0, p_password: null,
      });
      if (xe) failed.push(c.name);
    }
    setBusy(false);
    if (failed.length) return setError(`تمت الموافقة، لكن تعذر التسجيل في: ${failed.join('، ')}`);
    onDone();
  };

  const reject = async () => {
    setError('');
    setBusy(true);
    const { error: err } = await supabase.rpc('review_child_join_request', {
      p_request: request.id,
      p_approve: false,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(mapError(err.message ?? ''));
    onDone();
  };

  return (
    <li className="card" data-request-id={request.id}>
      <div className="mb-3 flex items-start gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-gold-50 ring-2 ring-gold-100 flex items-center justify-center">
          {request.image_url ? (
            <Image src={request.image_url} alt={request.name} fill sizes="56px" className="object-cover" />
          ) : (
            <User className="h-7 w-7 text-gold-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{request.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1" dir="ltr"><IdCard className="h-3 w-3" /> {request.code}</span>
            {request.phone && <span className="flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" /> {request.phone}</span>}
            {request.gender && <span>{GENDER_LABELS[request.gender]}</span>}
            {request.birthdate && <span className="flex items-center gap-1"><Cake className="h-3 w-3" /> {fmtDate(request.birthdate)}</span>}
          </p>
          {request.address && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" /> {request.address}</p>}
          {request.notes && <p className="mt-0.5 text-xs text-slate-400">📝 {request.notes}</p>}
          <p className="mt-1 text-[11px] text-slate-400">أُرسل {fmtWhen(request.created_at)}</p>
          {request.person_id === null && (
            <p className="mt-1.5 inline-block rounded-lg bg-primary-50 px-2 py-1 text-xs font-bold text-primary-600">
              طلب الانضمام إلى: {churches.find((c) => c.id === request.church_id)?.name ?? '—'}
              {request.service_id ? ` ← ${services.find((s) => s.id === request.service_id)?.name ?? ''}` : ''}
              {request.class_id ? ` ← ${classes.find((c) => c.id === request.class_id)?.name ?? ''}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <select className="input-field" value={churchId} disabled={!canPickChurch}
          onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassIds([]); }}>
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input-field" value={serviceId} disabled={!canPickService}
          onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}>
          <option value="">اختر الخدمة</option>
          {scopedServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <MultiClassSelect id="child-request-class" value={classIds} onChange={setClassIds} options={scopedClasses}
          showAll={false} allLabel="اختر الفصول" disabled={!canPickClass} />
      </div>

      {rejecting && (
        <textarea
          className="input-field mb-3 min-h-[60px]"
          placeholder="سبب الرفض (اختياري — يظهر للمخدوم)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

      <div className="flex gap-2">
        {!rejecting ? (
          <>
            <button onClick={approve} disabled={busy}
              className="btn-primary flex-1 !py-2.5 flex items-center justify-center gap-1 text-sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              اعتماد
            </button>
            <button onClick={() => setRejecting(true)} disabled={busy}
              className="flex-1 rounded-xl border border-red-200 bg-white py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition flex items-center justify-center gap-1">
              <X className="h-4 w-4" /> رفض
            </button>
          </>
        ) : (
          <>
            <button onClick={() => { setRejecting(false); setNote(''); }} disabled={busy} className="btn-secondary flex-1 !py-2.5 text-sm">إلغاء</button>
            <button onClick={reject} disabled={busy}
              className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition flex items-center justify-center gap-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} تأكيد الرفض
            </button>
          </>
        )}
      </div>
    </li>
  );
}
