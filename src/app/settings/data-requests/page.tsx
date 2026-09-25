'use client';

// ---------- طلبات تعديل البيانات (from the child portal) ----------
// Class servants, service managers, church managers and the owner see the
// requests of the persons in their scope (RLS: can_access_person) and
// approve (applies the change to `persons`) or reject, with an optional
// note back to the child. Realtime on data_change_requests.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight, Check, X, Loader2, Inbox, User, Camera, Pencil, Clock, Layers, ChevronLeft, History, Eye,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ModalFrame } from '@/components/PersonDataModals';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  REQUEST_STATUS_LABELS, REQUEST_KIND_LABELS, FIELD_LABELS, childErrorMessage,
  type DataChangeRequest, type RequestStatus,
} from '@/lib/child-portal';
import { GENDER_LABELS, type Gender, type Person } from '@/lib/types';
import { APP_TZ } from '@/lib/time';

type Row = DataChangeRequest & {
  person: Pick<Person, 'id' | 'name' | 'image_url' | 'national_id'> | null;
  decider: { full_name: string } | null;
};

const STATUS_STYLE: Record<RequestStatus, string> = {
  pending: 'bg-gold-100 text-gold-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

const display = (field: string, v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'gender') return GENDER_LABELS[v as Gender] ?? v;
  return v;
};

export default function DataRequestsPage() {
  const { profile } = useAuth();
  const { activityCan } = usePermissions();
  const canApprove = activityCan('data_requests', 'approve');
  const canReject = activityCan('data_requests', 'reject');
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scopeNames, setScopeNames] = useState<Record<string, string>>({});
  const [decide, setDecide] = useState<{ row: Row; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    let q = supabase
      .from('data_change_requests')
      .select('*, person:persons(id, name, image_url, national_id), decider:servant_enrollments!data_change_requests_decided_by_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(200);
    q = tab === 'pending' ? q.eq('status', 'pending') : q.neq('status', 'pending');
    const { data } = await q;
    const list = (data ?? []) as unknown as Row[];
    setRows(list);

    // scope label per person (first enrollment: service · class)
    const ids = Array.from(new Set(list.map((r) => r.person_id)));
    if (ids.length) {
      const { data: enr } = await supabase
        .from('enrollments')
        .select('person_id, services(name), classes(name)')
        .in('person_id', ids);
      const map: Record<string, string> = {};
      ((enr ?? []) as unknown as { person_id: string; services: { name: string } | null; classes: { name: string } | null }[]).forEach((e) => {
        const label = `${e.services?.name ?? ''} · ${e.classes?.name ?? ''}`;
        map[e.person_id] = map[e.person_id] ? `${map[e.person_id]} / ${label}` : label;
      });
      setScopeNames(map);
    }
  }, [supabase, tab]);

  useEffect(() => {
    if (profile?.status === 'approved') { setRows(null); load(); }
  }, [profile?.status, load]);

  useDebouncedRealtime(
    supabase, 'data-requests-page',
    [{ table: 'data_change_requests' }],
    load,
    { enabled: !!profile }
  );

  const submitDecision = async () => {
    if (!decide) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('review_data_change_request', {
      p_request: decide.row.id,
      p_approve: decide.approve,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) { setError(childErrorMessage(err, 'تعذر تنفيذ القرار')); return; }
    setDecide(null);
    setNote('');
    load();
  };

  return (
    <AppShell>
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-primary-600">
        <ArrowRight className="h-4 w-4" /> الإعدادات
      </Link>
      <section className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Inbox className="h-5 w-5 text-primary-600" /> طلبات تعديل البيانات
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          طلبات المخدومين من بوابة المخدوم — الموافقة تطبّق التعديل على بيانات الشخص مباشرة
        </p>
      </section>

      <div className="mb-4 flex gap-2">
        <button
          id="dcr-tab-pending"
          onClick={() => setTab('pending')}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${tab === 'pending' ? 'bg-primary-600 text-white shadow' : 'bg-white text-slate-500 border border-slate-200'}`}
        >
          <Clock className="inline h-3.5 w-3.5 ml-1" /> قيد المراجعة {rows && tab === 'pending' ? `(${rows.length})` : ''}
        </button>
        <button
          id="dcr-tab-history"
          onClick={() => setTab('history')}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${tab === 'history' ? 'bg-primary-600 text-white shadow' : 'bg-white text-slate-500 border border-slate-200'}`}
        >
          <History className="inline h-3.5 w-3.5 ml-1" /> السجل
        </button>
      </div>

      {!rows ? (
        <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-primary-500" /></div>
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Inbox className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">{tab === 'pending' ? 'لا توجد طلبات قيد المراجعة' : 'لا يوجد سجل بعد'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <article key={r.id} id={`dcr-${r.id}`} className="card">
              {/* Person header */}
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
                  {r.person?.image_url ? (
                    <Image src={r.person.image_url} alt={r.person.name} fill sizes="48px" className="object-cover" />
                  ) : (
                    <User className="absolute inset-0 m-auto h-6 w-6" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">{r.person?.name ?? '—'}</p>
                  <p className="truncate text-[11px] font-bold text-slate-400 flex items-center gap-1">
                    <Layers className="h-3 w-3" /> {scopeNames[r.person_id] ?? '…'}
                  </p>
                </div>
                <div className="text-left">
                  <span className={`badge ${STATUS_STYLE[r.status]}`}>
                    {r.kind === 'photo' ? <Camera className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    {REQUEST_KIND_LABELS[r.kind]}
                  </span>
                  <p className="mt-1 text-[10px] font-bold text-slate-400">{fmt(r.created_at)}</p>
                </div>
              </div>

              {/* Diff */}
              {r.kind === 'photo' ? (
                <div className="mt-3 flex items-center justify-center gap-4 rounded-xl bg-slate-50 p-3">
                  <div className="text-center">
                    <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200">
                      {r.previous.image_url ? <Image src={r.previous.image_url} alt="الحالية" fill sizes="80px" className="object-cover" /> : <User className="absolute inset-0 m-auto h-8 w-8 text-slate-400" />}
                    </div>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">الحالية</p>
                  </div>
                  <ChevronLeft className="h-5 w-5 text-slate-300" />
                  <div className="text-center">
                    <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-xl ring-2 ring-gold-300">
                      {r.changes.image_url && <Image src={r.changes.image_url} alt="الجديدة" fill sizes="80px" className="object-cover" />}
                    </div>
                    <p className="mt-1 text-[10px] font-bold text-gold-700">الجديدة</p>
                  </div>
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
                  {Object.keys(r.changes).map((k) => (
                    <li key={k} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-20 shrink-0 text-xs font-bold text-slate-500">{FIELD_LABELS[k] ?? k}</span>
                      <span className="text-slate-400 line-through" dir={k === 'phone' ? 'ltr' : undefined}>{display(k, r.previous[k])}</span>
                      <ChevronLeft className="h-3.5 w-3.5 text-slate-300" />
                      <span className="font-extrabold" dir={k === 'phone' ? 'ltr' : undefined}>{display(k, r.changes[k])}</span>
                    </li>
                  ))}
                </ul>
              )}
              {r.note && <p className="mt-2 text-xs text-slate-500">ملاحظة المخدوم: <span className="font-bold">{r.note}</span></p>}

              {/* Actions / decision */}
              {r.status === 'pending' ? (
                canApprove || canReject ? (
                  <div className="mt-3 flex gap-2">
                    {canReject && (
                      <button
                        id={`dcr-reject-${r.id}`}
                        onClick={() => { setDecide({ row: r, approve: false }); setNote(''); setError(''); }}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-extrabold text-red-600 hover:bg-red-100"
                      >
                        <X className="h-4 w-4" /> رفض
                      </button>
                    )}
                    {canApprove && (
                      <button
                        id={`dcr-approve-${r.id}`}
                        onClick={() => { setDecide({ row: r, approve: true }); setNote(''); setError(''); }}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-500 px-3 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-600"
                      >
                        <Check className="h-4 w-4" /> موافقة
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
                    <Eye className="h-3.5 w-3.5" /> عرض فقط — الموافقة / الرفض تحتاج ملف صلاحيات
                  </p>
                )
              ) : (
                <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-400">
                  <span className={`badge ${STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
                  <span>
                    {r.decider?.full_name ? `${r.decider.full_name} · ` : ''}{r.decided_at ? fmt(r.decided_at) : ''}
                  </span>
                </div>
              )}
              {r.decision_note && <p className="mt-1.5 text-xs text-slate-500">الرد: <span className="font-bold">{r.decision_note}</span></p>}
            </article>
          ))}
        </div>
      )}

      {decide && (
        <ModalFrame
          title={decide.approve ? 'تأكيد الموافقة' : 'تأكيد الرفض'}
          icon={decide.approve ? <Check className="h-5 w-5 text-emerald-600" /> : <X className="h-5 w-5 text-red-600" />}
          onClose={() => setDecide(null)}
        >
          <div className="space-y-3">
            <p className="text-sm">
              {decide.approve
                ? <>سيتم تطبيق {REQUEST_KIND_LABELS[decide.row.kind]} على بيانات <b>{decide.row.person?.name}</b> في كل تسجيلاته.</>
                : <>سيتم رفض طلب {REQUEST_KIND_LABELS[decide.row.kind]} الخاص بـ <b>{decide.row.person?.name}</b>.</>}
            </p>
            <div>
              <label htmlFor="dcr-note" className="mb-1 block text-xs font-bold text-slate-500">ملاحظة للمخدوم (اختياري)</label>
              <textarea id="dcr-note" className="input-field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={decide.approve ? 'مثال: تم — شكراً' : 'مثال: الصورة غير واضحة'} />
            </div>
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setDecide(null)} className="btn-secondary flex-1">إلغاء</button>
              <button
                id="dcr-confirm"
                onClick={submitDecision}
                disabled={busy}
                className={`flex flex-1 items-center justify-center gap-1 rounded-xl px-4 py-3 font-bold text-white ${decide.approve ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : decide.approve ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {decide.approve ? 'موافقة' : 'رفض'}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </AppShell>
  );
}
