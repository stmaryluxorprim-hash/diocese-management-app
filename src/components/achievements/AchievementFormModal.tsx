'use client';

// ---------- Add / edit an achievement ----------
// name · description · picture (compressed webp) · points · scope church →
// service → class → event (null = all) · type (normal / attendance) · award
// mode (once / multiple + max + min days) · attendance requirement
// (N attendances | N in a row) · active.

import { useMemo, useState } from 'react';
import { X, Save, Loader2, Upload, Trash2, Trophy, CalendarCheck, Repeat, Hash } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { useAuth } from '@/lib/auth-context';
import {
  saveAchievement, achievementErrorMessage, KIND_LABELS, AWARD_MODE_LABELS, RULE_LABELS,
  type Achievement, type AchievementKind, type AwardMode, type AttendanceRule, type AchievementInput,
} from '@/lib/achievements';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel, classTargets } from '@/lib/class-multi';
import { AchievementThumb } from '@/components/achievements/AchievementBits';
import type { Church, Service, ClassRoom, AppEvent } from '@/lib/types';

const ALL = 'all';
const NONE = '';

/** Down-scale any picked image to ≤ 512px webp (icons stay tiny). */
async function compressImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const max = 512;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AchievementFormModal({
  item, churches, services, classes, events, onClose, onSaved,
}: {
  item: Achievement | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[]; events: AppEvent[];
  onClose: () => void;
  onSaved: (saved: Achievement) => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const mode = item ? 'edit' : 'add';

  const defaultChurch = item?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [churchId, setChurchId] = useState(defaultChurch);
  const [serviceId, setServiceId] = useState(item ? (item.service_id ?? ALL) : (profile?.service_id ?? ALL));
  const [classIds, setClassIds] = useState<string[]>(classSel(item ? item.class_id : profile?.class_id)); // [] = كل الفصول
  const [eventId, setEventId] = useState(item?.event_id ?? NONE);
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [points, setPoints] = useState(String(item?.points ?? 10));
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [kind, setKind] = useState<AchievementKind>(item?.kind ?? 'normal');
  const [awardMode, setAwardMode] = useState<AwardMode>(item?.award_mode ?? 'once');
  const [maxAwards, setMaxAwards] = useState(item?.max_awards ? String(item.max_awards) : '');
  const [minDays, setMinDays] = useState(item?.min_interval_days ? String(item.min_interval_days) : '');
  const [rule, setRule] = useState<AttendanceRule>(item?.attendance_rule ?? 'count');
  const [target, setTarget] = useState(String(item?.attendance_target ?? 5));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(item?.image_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // scope locks follow the profile (a class servant can only add to his class)
  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';

  const visibleServices = useMemo(() => services.filter((s) => s.church_id === churchId), [services, churchId]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => c.church_id === churchId && (serviceId === ALL || c.service_id === serviceId)),
    [classes, churchId, serviceId]
  );
  // events whose scope overlaps the chosen scope (same rule as the DB trigger)
  const visibleEvents = useMemo(
    () => events.filter((ev) =>
      ev.church_id === churchId &&
      (ev.service_id === null || serviceId === ALL || ev.service_id === serviceId) &&
      // an event of ONE class only fits an achievement of at most that class
      (ev.class_id === null || classIds.length === 0 || (classIds.length === 1 && ev.class_id === classIds[0]))),
    [events, churchId, serviceId, classIds]
  );

  const pickPhoto = (f: File | null) => {
    setPhotoFile(f);
    setRemovePhoto(false);
    if (f) setPhotoPreview(URL.createObjectURL(f));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    if (!name.trim()) return setError('اسم الإنجاز مطلوب');
    const p = parseInt(points, 10);
    if (isNaN(p) || p < 0) return setError('النقاط غير صالحة');
    let mx: number | null = null; let md: number | null = null;
    if (awardMode === 'multiple') {
      if (maxAwards.trim()) { mx = parseInt(maxAwards, 10); if (isNaN(mx) || mx < 1) return setError('الحد الأقصى للمرات غير صالح'); }
      if (minDays.trim()) { md = parseInt(minDays, 10); if (isNaN(md) || md < 0) return setError('الحد الأدنى للأيام غير صالح'); }
    }
    let tg: number | null = null;
    if (kind === 'attendance') {
      tg = parseInt(target, 10);
      if (isNaN(tg) || tg < 1) return setError('العدد المطلوب من الحضور غير صالح');
    }
    setSaving(true);

    let image_url = removePhoto ? null : (item?.image_url ?? null);
    if (photoFile) {
      try {
        const blob = await compressImage(photoFile);
        image_url = await uploadPhoto(supabase, 'achievements', blob, `achievement-${Date.now()}.webp`);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }

    const payload: AchievementInput = {
      church_id: churchId,
      service_id: serviceId === ALL ? null : serviceId,
      event_id: eventId || null,
      name: name.trim(),
      description: description.trim() || null,
      image_url,
      points: p,
      is_active: isActive,
      kind,
      award_mode: awardMode,
      max_awards: mx,
      min_interval_days: md,
      attendance_rule: kind === 'attendance' ? rule : null,
      attendance_target: tg,
    };

    try {
      // one achievement per chosen class (none = all classes); editing updates the
      // existing one to the first class and creates copies for the others
      const targets = serviceId === ALL ? [null] : classTargets(classIds);
      const saved = await saveAchievement(supabase, item?.id ?? null, { ...payload, class_id: targets[0] }, profile?.id);
      for (const cid of targets.slice(1)) {
        await saveAchievement(supabase, null, { ...payload, class_id: cid }, profile?.id);
      }
      onSaved(saved);
    } catch (err) {
      setError(achievementErrorMessage(err, 'تعذر الحفظ، تأكد من الصلاحيات'));
      setSaving(false);
    }
  };

  const Seg = <T extends string>({ value, options, onChange, idPrefix }: {
    value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void; idPrefix: string;
  }) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} id={`${idPrefix}-${o.value}`} type="button" onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition active:scale-95 ${
            value === o.value ? 'bg-amber-600 text-white shadow ring-2 ring-amber-300' : 'bg-white text-slate-600 border border-slate-200'
          }`}>
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        id="achievement-form-modal"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <Trophy className="h-5 w-5 text-amber-600" />
            {mode === 'add' ? 'إضافة إنجاز' : 'تعديل الإنجاز'}
          </h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {/* picture */}
          <div className="flex items-center gap-3">
            <AchievementThumb url={photoPreview} name={name || 'إنجاز'} size={72} />
            <div className="flex-1 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 text-xs font-bold text-amber-700">
                <Upload className="h-4 w-4" />
                {photoFile ? 'تغيير الصورة' : photoPreview ? 'تغيير صورة الإنجاز' : 'إضافة صورة / أيقونة (اختياري)'}
                <input id="achievement-photo" type="file" accept="image/*" className="hidden"
                  onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
              </label>
              {photoPreview && (
                <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null); setRemovePhoto(true); }}
                  className="flex items-center gap-1 text-xs font-bold text-red-500">
                  <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
                </button>
              )}
            </div>
          </div>

          <input id="achievement-name" className="input-field" placeholder="اسم الإنجاز *" value={name}
            onChange={(e) => setName(e.target.value)} required maxLength={120} />
          <textarea id="achievement-description" className="input-field" placeholder="وصف (اختياري)" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">النقاط الممنوحة *</label>
            <input id="achievement-points" type="number" inputMode="numeric" min={0} className="input-field text-center font-extrabold tabular-nums"
              value={points} onChange={(e) => setPoints(e.target.value)} required />
          </div>

          {/* scope */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">النطاق (كنيسة ← خدمة ← فصل ← مناسبة)</label>
            <div className="grid grid-cols-3 gap-2">
              <select id="achievement-church" className={`input-field !px-2 text-xs font-bold ${churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={churchId} onChange={(e) => { setChurchId(e.target.value); setServiceId(ALL); setClassIds([]); setEventId(NONE); }} required>
                <option value="">الكنيسة</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select id="achievement-service" className={`input-field !px-2 text-xs font-bold ${serviceLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={serviceId} onChange={(e) => { setServiceId(e.target.value); setClassIds([]); setEventId(NONE); }}>
                <option value={ALL}>كل الخدمات</option>
                {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <MultiClassSelect id="achievement-class" className={classLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}
                value={classIds} onChange={(ids) => { setClassIds(ids); setEventId(NONE); }} options={visibleClasses}
                disabled={serviceId === ALL} />
            </div>
            <select id="achievement-event" className="input-field mt-2 !px-2 text-xs font-bold" value={eventId}
              onChange={(e) => setEventId(e.target.value)} disabled={!churchId}>
              <option value={NONE}>كل المناسبات (بدون مناسبة محددة)</option>
              {visibleEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
            <p className="mt-1 text-[11px] font-bold text-slate-400">
              اترك الخدمة / الفصل / المناسبة على «الكل» ليكون الإنجاز على مستوى الكنيسة، أو حدّدها ليكون خاصاً بخدمة أو فصل أو مناسبة.
            </p>
          </div>

          {/* type */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">نوع الإنجاز</label>
            <Seg idPrefix="achievement-kind" value={kind} onChange={setKind} options={[
              { value: 'normal', label: KIND_LABELS.normal, icon: <Trophy className="h-4 w-4" /> },
              { value: 'attendance', label: KIND_LABELS.attendance, icon: <CalendarCheck className="h-4 w-4" /> },
            ]} />
            {kind === 'attendance' && (
              <div className="mt-2 rounded-2xl border border-amber-100 bg-amber-50/40 p-3 space-y-2">
                <p className="text-[11px] font-bold text-amber-800">يُمنح تلقائياً عند تسجيل الحضور بمجرد الوصول للشرط:</p>
                <Seg idPrefix="achievement-rule" value={rule} onChange={setRule} options={[
                  { value: 'count', label: RULE_LABELS.count, icon: <Hash className="h-4 w-4" /> },
                  { value: 'streak', label: RULE_LABELS.streak, icon: <Repeat className="h-4 w-4" /> },
                ]} />
                <div className="flex items-center gap-2">
                  <input id="achievement-target" type="number" inputMode="numeric" min={1} className="input-field w-24 text-center font-extrabold tabular-nums"
                    value={target} onChange={(e) => setTarget(e.target.value)} required />
                  <span className="text-xs font-bold text-slate-600">
                    {rule === 'count' ? 'حضور (إجمالي)' : 'مرات متتالية (بدون انقطاع أسبوع)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* award mode */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">طريقة المنح</label>
            <Seg idPrefix="achievement-mode" value={awardMode} onChange={setAwardMode} options={[
              { value: 'once', label: AWARD_MODE_LABELS.once },
              { value: 'multiple', label: AWARD_MODE_LABELS.multiple },
            ]} />
            {awardMode === 'multiple' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">الحد الأقصى للمرات</label>
                  <input id="achievement-max" type="number" inputMode="numeric" min={1} className="input-field text-center font-extrabold tabular-nums"
                    placeholder="بلا حد" value={maxAwards} onChange={(e) => setMaxAwards(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">أقل مدة بين مرتين (أيام)</label>
                  <input id="achievement-min-days" type="number" inputMode="numeric" min={0} className="input-field text-center font-extrabold tabular-nums"
                    placeholder="بلا حد" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold">
            <input id="achievement-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-amber-600" />
            مفعّل (يمكن منحه ويُحسب تلقائياً)
          </label>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

          <button id="achievement-save" type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-amber-600 !to-amber-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'add' ? 'إضافة الإنجاز' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
