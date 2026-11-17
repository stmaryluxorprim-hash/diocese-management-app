'use client';

// ---------- Add participants to an occasion (leader) ----------
// Server-paged search over the enrollments the leader can see, narrowed to
// the occasion scope. Children already registered are shown with their
// status; free ones get a «＋» that registers them (confirmed or pending).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, Plus, Check, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchEnrollmentsPage, ALL } from '@/lib/queries';
import type { EnrollmentWithPerson, ClassRoom } from '@/lib/types';
import { registerParticipant, occasionErrorMessage, REG_STATUS_LABELS, type Occasion, type Participant, type RegistrationStatus } from '@/lib/occasions';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { PersonAvatar, RegStatusBadge } from '@/components/occasions/OccasionBits';

export default function AddParticipantModal({
  occasion, participants, classes, onClose, onAdded,
}: {
  occasion: Occasion;
  participants: Participant[];
  classes: ClassRoom[];
  onClose: () => void;
  onAdded: (p: { enrollment_id: string; status: RegistrationStatus }) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]); // [] = كل الفصول
  const [rows, setRows] = useState<EnrollmentWithPerson[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [asStatus, setAsStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 350); return () => clearTimeout(t); }, [search]);

  const byEnrollment = useMemo(() => new Map(participants.map((p) => [p.enrollment_id, p])), [participants]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => c.church_id === occasion.church_id && (occasion.service_id === null || c.service_id === occasion.service_id)),
    [classes, occasion]
  );

  const load = useCallback(async (pg: number, append: boolean) => {
    setLoading(true);
    try {
      const res = await fetchEnrollmentsPage(supabase, {
        church: occasion.church_id,
        service: occasion.service_id ?? ALL,
        classes: occasion.class_id ? [occasion.class_id] : classIds,
      }, { page: pg, pageSize: 60, search: debounced });
      setRows((l) => (append ? [...l, ...res.rows] : res.rows));
      setHasMore(res.hasMore);
      setPage(pg);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [supabase, occasion, classIds, debounced]);

  useEffect(() => { load(0, false); }, [load]);

  const add = async (e: EnrollmentWithPerson) => {
    setBusy(e.id); setError('');
    try {
      const r = await registerParticipant(supabase, occasion.id, e.id, asStatus);
      onAdded({ enrollment_id: e.id, status: r.status });
    } catch (err) {
      setError(occasionErrorMessage(err, 'تعذر التسجيل'));
    } finally { setBusy(null); }
  };

  const activeCount = participants.filter((p) => p.status !== 'cancelled').length;
  const full = occasion.capacity !== null && activeCount >= occasion.capacity;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div id="occ-add-participant-modal" className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="flex items-center gap-2 text-lg font-extrabold"><UserPlus className="h-5 w-5 text-cyan-600" /> إضافة مشاركين</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-2 px-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="occ-add-search" className="input-field pr-9" placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-2">
            {!occasion.class_id && visibleClasses.length > 1 && (
              <MultiClassSelect id="occ-add-class" className="!py-2" value={classIds} onChange={setClassIds} options={visibleClasses} />
            )}
            <div className="grid flex-1 grid-cols-2 gap-1">
              {(['confirmed', 'pending'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setAsStatus(s)} aria-pressed={asStatus === s}
                  className={`h-10 rounded-xl text-xs font-extrabold ${asStatus === s ? (s === 'confirmed' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white') : 'bg-white text-slate-500 border border-slate-200'}`}>
                  يُضاف {REG_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          {full && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">اكتمل العدد ({occasion.capacity}) — ألغِ تسجيلاً أو زد السعة لإضافة المزيد.</p>}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        </div>

        <div id="occ-add-list" className="mt-2 flex-1 divide-y divide-indigo-50 overflow-y-auto px-2 pb-4">
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-cyan-500" /></div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-slate-400">لا نتائج</p>
          ) : rows.map((e) => {
            const p = e.person;
            const reg = byEnrollment.get(e.id);
            const taken = !!reg && reg.status !== 'cancelled';
            return (
              <div key={e.id} id={`occ-add-row-${e.id}`} className="flex items-center gap-2.5 px-2 py-2">
                <PersonAvatar url={p.image_url} name={p.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{p.name}</p>
                  <p className="truncate text-[11px] font-bold text-slate-400">{classes.find((c) => c.id === e.class_id)?.name ?? ''}{p.phone ? ` · ${p.phone}` : ''}</p>
                </div>
                {taken ? (
                  <RegStatusBadge status={reg!.status} />
                ) : (
                  <button type="button" disabled={busy === e.id || full} onClick={() => add(e)} aria-label="إضافة"
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition active:scale-95 disabled:opacity-40 ${asStatus === 'confirmed' ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                    {busy === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : reg ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                )}
              </div>
            );
          })}
          {hasMore && (
            <button type="button" onClick={() => load(page + 1, true)} disabled={loading} className="btn-secondary mt-2 w-full !py-2 text-sm">
              {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'المزيد'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
