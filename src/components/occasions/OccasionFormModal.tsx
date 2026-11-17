'use client';

// ---------- Add / edit an occasion ----------
// title · kind · cover picture (compressed webp) · description · scope
// church → service → class (null = all) · start / end · location (+ map
// link) · organizer (+ phone) · registration deadline · capacity ·
// auto-confirm · check-in points · status. On CREATE the leader can also
// pick the initial checklist items (suggestions + free text).

import { useMemo, useState } from 'react';
import {
  X, Save, Loader2, Upload, Trash2, Tent, CalendarDays, MapPin, User, Users, Clock, Star, ListChecks, Plus,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { useAuth } from '@/lib/auth-context';
import {
  saveOccasion, addChecklistItem, occasionErrorMessage, toLocalInput, fromLocalInput,
  KIND_LABELS, KIND_EMOJI, OCCASION_STATUS_LABELS, CHECKLIST_SUGGESTIONS,
  type Occasion, type OccasionInput, type OccasionKind, type OccasionStatus,
} from '@/lib/occasions';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel, classTargets } from '@/lib/class-multi';
import { OccasionCover } from '@/components/occasions/OccasionBits';
import type { Church, Service, ClassRoom } from '@/lib/types';

const ALL = 'all';

/** Down-scale any picked image to ≤ 1024px webp (covers stay light). */
async function compressImage(file: File, max = 1024): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const KINDS: OccasionKind[] = ['trip', 'conference', 'celebration', 'activity', 'other'];

export default function OccasionFormModal({
  item, churches, services, classes, onClose, onSaved,
}: {
  item: Occasion | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  onClose: () => void;
  onSaved: (saved: Occasion) => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const mode = item ? 'edit' : 'add';

  const defaultChurch = item?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [churchId, setChurchId] = useState(defaultChurch);
  const [serviceId, setServiceId] = useState(item ? (item.service_id ?? ALL) : (profile?.service_id ?? ALL));
  const [classIds, setClassIds] = useState<string[]>(classSel(item ? item.class_id : profile?.class_id)); // [] = كل الفصول
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<OccasionKind>(item?.kind ?? 'trip');
  const [description, setDescription] = useState(item?.description ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(item?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(item?.ends_at ?? null));
  const [location, setLocation] = useState(item?.location ?? '');
  const [locationUrl, setLocationUrl] = useState(item?.location_url ?? '');
  const [organizer, setOrganizer] = useState(item?.organizer ?? profile?.full_name ?? '');
  const [organizerPhone, setOrganizerPhone] = useState(item?.organizer_phone ?? profile?.phone ?? '');
  const [deadline, setDeadline] = useState(toLocalInput(item?.registration_deadline ?? null));
  const [capacity, setCapacity] = useState(item?.capacity ? String(item.capacity) : '');
  const [autoConfirm, setAutoConfirm] = useState(item?.auto_confirm ?? false);
  const [points, setPoints] = useState(String(item?.checkin_points ?? 0));
  const [status, setStatus] = useState<OccasionStatus>(item?.status ?? 'published');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(item?.image_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  // initial checklist (create only)
  const [checklist, setChecklist] = useState<string[]>(item ? [] : ['الدفع', 'إذن ولي الأمر']);
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';

  const visibleServices = useMemo(() => services.filter((s) => s.church_id === churchId), [services, churchId]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => c.church_id === churchId && (serviceId === ALL || c.service_id === serviceId)),
    [classes, churchId, serviceId]
  );

  const pickPhoto = (f: File | null) => {
    setPhotoFile(f);
    setRemovePhoto(false);
    if (f) setPhotoPreview(URL.createObjectURL(f));
  };

  const toggleSuggestion = (s: string) =>
    setChecklist((l) => (l.includes(s) ? l.filter((x) => x !== s) : [...l, s]));
  const addCustom = () => {
    const v = newItem.trim();
    if (!v) return;
    if (!checklist.includes(v)) setChecklist((l) => [...l, v]);
    setNewItem('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    if (!title.trim()) return setError('عنوان الفعالية مطلوب');
    const startsIso = fromLocalInput(startsAt);
    if (!startsIso) return setError('موعد البداية مطلوب');
    const endsIso = fromLocalInput(endsAt);
    if (endsIso && new Date(endsIso) < new Date(startsIso)) return setError('وقت الانتهاء يجب أن يكون بعد البداية');
    const deadlineIso = fromLocalInput(deadline);
    if (deadlineIso && new Date(deadlineIso) > new Date(startsIso)) return setError('آخر موعد للتسجيل يجب أن يكون قبل بداية الفعالية');
    let cap: number | null = null;
    if (capacity.trim()) { cap = parseInt(capacity, 10); if (isNaN(cap) || cap < 1) return setError('السعة غير صالحة'); }
    const p = parseInt(points || '0', 10);
    if (isNaN(p) || p < 0) return setError('النقاط غير صالحة');
    setSaving(true);

    let image_url = removePhoto ? null : (item?.image_url ?? null);
    if (photoFile) {
      try {
        const blob = await compressImage(photoFile);
        image_url = await uploadPhoto(supabase, 'occasions', blob, `occasion-${Date.now()}.webp`);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }

    const payload: Omit<OccasionInput, 'class_id'> = {
      church_id: churchId,
      service_id: serviceId === ALL ? null : serviceId,
      title: title.trim(),
      description: description.trim() || null,
      image_url,
      kind,
      starts_at: startsIso,
      ends_at: endsIso,
      location: location.trim() || null,
      location_url: locationUrl.trim() || null,
      organizer: organizer.trim() || null,
      organizer_phone: organizerPhone.trim() || null,
      registration_deadline: deadlineIso,
      capacity: cap,
      auto_confirm: autoConfirm,
      checkin_points: p,
      status,
    };

    try {
      // one occasion per chosen class (none = all classes); editing updates the
      // existing one to the first class and creates copies for the others
      const targets = serviceId === ALL ? [null] : classTargets(classIds);
      const saved = await saveOccasion(supabase, item?.id ?? null, { ...payload, class_id: targets[0] }, profile?.id);
      const created = [saved];
      for (const cid of targets.slice(1)) created.push(await saveOccasion(supabase, null, { ...payload, class_id: cid }, profile?.id));
      if (!item && checklist.length > 0) {
        // best effort — the occasion is saved even if an item fails
        await Promise.all(created.flatMap((oc) => checklist.map((label, i) => addChecklistItem(supabase, oc.id, label, true, i + 1, profile?.id).catch(() => null))));
      }
      onSaved(saved);
    } catch (err) {
      setError(occasionErrorMessage(err, 'تعذر الحفظ، تأكد من الصلاحيات'));
      setSaving(false);
    }
  };

  const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-500">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] font-bold text-slate-400">{hint}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        id="occasion-form-modal"
        className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <Tent className="h-5 w-5 text-cyan-600" />
            {mode === 'add' ? 'إضافة فعالية' : 'تعديل الفعالية'}
          </h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {/* cover */}
          <div>
            <OccasionCover url={photoPreview} title={title || 'فعالية'} kind={kind} className="h-32 w-full rounded-2xl" />
            <div className="mt-2 flex items-center gap-2">
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300 bg-cyan-50/50 px-3 py-2 text-xs font-bold text-cyan-700">
                <Upload className="h-4 w-4" />
                {photoPreview ? 'تغيير الصورة' : 'إضافة صورة الفعالية (اختياري)'}
                <input id="occasion-photo" type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
              </label>
              {photoPreview && (
                <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null); setRemovePhoto(true); }}
                  aria-label="إزالة الصورة" className="rounded-xl bg-red-50 p-2 text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <input id="occasion-title" className="input-field font-extrabold" placeholder="عنوان الفعالية *" value={title}
            onChange={(e) => setTitle(e.target.value)} required maxLength={140} />

          {/* kind */}
          <div id="occasion-kind" className="grid grid-cols-5 gap-1.5">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-extrabold transition active:scale-95 ${
                  kind === k ? 'bg-cyan-600 text-white shadow ring-2 ring-cyan-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
                <span className="text-lg leading-none">{KIND_EMOJI[k]}</span>{KIND_LABELS[k]}
              </button>
            ))}
          </div>

          <textarea id="occasion-description" className="input-field" placeholder="وصف الفعالية (البرنامج، ما يجب إحضاره، ملاحظات…)" rows={3}
            value={description} onChange={(e) => setDescription(e.target.value)} />

          {/* scope */}
          <Field label="لمن هذه الفعالية؟ (كنيسة ← خدمة ← فصل)" hint="اترك الخدمة / الفصل على «الكل» لفعالية على مستوى الكنيسة أو الخدمة.">
            <div className="grid grid-cols-3 gap-2">
              <select id="occasion-church" className={`input-field !px-2 text-xs font-bold ${churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={churchId} onChange={(e) => { setChurchId(e.target.value); setServiceId(ALL); setClassIds([]); }} required>
                <option value="">الكنيسة</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select id="occasion-service" className={`input-field !px-2 text-xs font-bold ${serviceLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={serviceId} onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}>
                <option value={ALL}>كل الخدمات</option>
                {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <MultiClassSelect id="occasion-class" className={classLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}
                value={classIds} onChange={setClassIds} options={visibleClasses} disabled={serviceId === ALL} />
            </div>
          </Field>

          {/* when */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="البداية *">
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600" />
                <input id="occasion-starts" type="datetime-local" className="input-field !pr-9 text-xs font-bold" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
              </div>
            </Field>
            <Field label="الانتهاء">
              <input id="occasion-ends" type="datetime-local" className="input-field text-xs font-bold" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>

          {/* where */}
          <div className="grid grid-cols-1 gap-2">
            <div className="relative">
              <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rose-500" />
              <input id="occasion-location" className="input-field !pr-9" placeholder="المكان (مثال: دير الأنبا …)" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <input id="occasion-location-url" className="input-field text-xs" dir="ltr" placeholder="رابط الخريطة (Google Maps) — اختياري" value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)} />
          </div>

          {/* organizer */}
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <User className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-500" />
              <input id="occasion-organizer" className="input-field !pr-9" placeholder="المنظّم" value={organizer} onChange={(e) => setOrganizer(e.target.value)} />
            </div>
            <input id="occasion-organizer-phone" className="input-field text-center tabular-nums" dir="ltr" inputMode="tel" placeholder="هاتف المنظّم" value={organizerPhone} onChange={(e) => setOrganizerPhone(e.target.value)} />
          </div>

          {/* registration */}
          <div className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-800"><Users className="h-4 w-4" /> التسجيل</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="آخر موعد للتسجيل">
                <div className="relative">
                  <Clock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-500" />
                  <input id="occasion-deadline" type="datetime-local" className="input-field !pr-9 text-xs font-bold" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                </div>
              </Field>
              <Field label="السعة (عدد الأماكن)">
                <input id="occasion-capacity" type="number" inputMode="numeric" min={1} className="input-field text-center font-extrabold tabular-nums" placeholder="بلا حد" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold">
              <input id="occasion-auto-confirm" type="checkbox" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} className="h-4 w-4 accent-cyan-600" />
              <span className="flex-1">تأكيد تلقائي عند «أنا مشارك»</span>
              <span className="text-[11px] font-bold text-slate-400">{autoConfirm ? 'مؤكد فوراً' : 'قيد المراجعة أولاً'}</span>
            </label>
            <Field label="نقاط عند تسجيل الدخول">
              <div className="relative">
                <Star className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500" />
                <input id="occasion-points" type="number" inputMode="numeric" min={0} className="input-field !pr-9 text-center font-extrabold tabular-nums" value={points} onChange={(e) => setPoints(e.target.value)} />
              </div>
            </Field>
          </div>

          {/* initial checklist (create) */}
          {mode === 'add' && (
            <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700"><ListChecks className="h-4 w-4 text-cyan-600" /> قائمة التحقق للمشاركين</p>
              <div id="occasion-checklist-suggestions" className="flex flex-wrap gap-1.5">
                {Array.from(new Set([...CHECKLIST_SUGGESTIONS, ...checklist])).map((s) => (
                  <button key={s} type="button" onClick={() => toggleSuggestion(s)} aria-pressed={checklist.includes(s)}
                    className={`rounded-full px-3 py-1 text-xs font-extrabold ${checklist.includes(s) ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                    {checklist.includes(s) ? '✓ ' : ''}{s}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input id="occasion-checklist-new" className="input-field !py-2 text-sm" placeholder="عنصر آخر…" value={newItem}
                  onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
                <button type="button" onClick={addCustom} aria-label="إضافة عنصر" className="btn-secondary !px-3 !py-2"><Plus className="h-4 w-4" /></button>
              </div>
              <p className="text-[11px] font-bold text-slate-400">يمكن تعديل القائمة لاحقاً من صفحة الفعالية.</p>
            </div>
          )}

          {/* status */}
          <Field label="الحالة">
            <div id="occasion-status" className="grid grid-cols-4 gap-1.5">
              {(['draft', 'published', 'completed', 'cancelled'] as OccasionStatus[]).map((s) => (
                <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
                  className={`h-10 rounded-xl text-xs font-extrabold transition active:scale-95 ${
                    status === s ? (s === 'cancelled' ? 'bg-red-500 text-white' : s === 'published' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white') : 'bg-white text-slate-600 border border-slate-200'}`}>
                  {OCCASION_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </Field>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

          <button id="occasion-save" type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-cyan-600 !to-cyan-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'add' ? 'إضافة الفعالية' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
