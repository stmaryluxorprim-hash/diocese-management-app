'use client';

// ---------- Add / edit a shop (متجر) ----------
// name · description · picture (compressed webp) · ACTIVATION switch ·
// the places the shop is connected to: one or MANY rows of
// church → service → class (or «الكل» for the owner). An active shop shows
// up in the child portal for every child whose enrollment is covered by
// one of these places.

import { useMemo, useState } from 'react';
import { X, Save, Loader2, Upload, Trash2, Plus, Power, MapPin, Globe } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { useAuth } from '@/lib/auth-context';
import { saveStoreShop, storeErrorMessage, type StoreShopWithTargets, type ShopTargetInput } from '@/lib/store';
import { ShopThumb, targetLabel } from '@/components/store/StoreBits';
import { compressImage } from '@/components/store/ItemFormModal';
import type { Church, Service, ClassRoom } from '@/lib/types';

const ALL = 'all';
const keyOf = (t: ShopTargetInput) => `${t.church_id ?? ''}|${t.service_id ?? ''}|${t.class_id ?? ''}`;

export default function ShopFormModal({
  shop, churches, services, classes, onClose, onSaved,
}: {
  shop: StoreShopWithTargets | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  onClose: () => void;
  onSaved: (saved: StoreShopWithTargets) => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const mode = shop ? 'edit' : 'add';
  const isOwner = profile?.role === 'owner';

  const defaultChurch = shop?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [churchId, setChurchId] = useState(defaultChurch);
  const [name, setName] = useState(shop?.name ?? '');
  const [description, setDescription] = useState(shop?.description ?? '');
  const [isActive, setIsActive] = useState(shop?.is_active ?? false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(shop?.image_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [targets, setTargets] = useState<ShopTargetInput[]>(
    shop?.targets.map((t) => ({ church_id: t.church_id, service_id: t.service_id, class_id: t.class_id })) ?? []
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // ---- target picker row (church → service → class) ----
  const [tChurch, setTChurch] = useState(defaultChurch || (isOwner ? ALL : ''));
  const [tService, setTService] = useState(profile?.service_id && profile.role !== 'owner' && profile.role !== 'church_manager' ? profile.service_id : ALL);
  const [tClass, setTClass] = useState(profile?.class_id && profile.role === 'class_servant' ? profile.class_id : ALL);
  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';

  const tServices = useMemo(() => services.filter((s) => s.church_id === tChurch), [services, tChurch]);
  const tClasses = useMemo(
    () => classes.filter((c) => c.church_id === tChurch && (tService === ALL || c.service_id === tService)),
    [classes, tChurch, tService]
  );

  const addTarget = () => {
    setError('');
    if (!tChurch) return setError('اختر الكنيسة');
    const t: ShopTargetInput = tChurch === ALL
      ? { church_id: null, service_id: null, class_id: null }
      : { church_id: tChurch, service_id: tService === ALL ? null : tService, class_id: tService === ALL || tClass === ALL ? null : tClass };
    if (targets.some((x) => keyOf(x) === keyOf(t))) return setError('هذا المكان مضاف بالفعل');
    setTargets((l) => [...l, t]);
  };
  const removeTarget = (k: string) => setTargets((l) => l.filter((x) => keyOf(x) !== k));

  const pickPhoto = (f: File | null) => {
    setPhotoFile(f);
    setRemovePhoto(false);
    if (f) setPhotoPreview(URL.createObjectURL(f));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة المالكة للمتجر');
    if (!name.trim()) return setError('اسم المتجر مطلوب');
    if (targets.length === 0) return setError('أضف مكاناً واحداً على الأقل يرتبط به المتجر (كنيسة / خدمة / فصل)');
    setSaving(true);
    let image_url = removePhoto ? null : (shop?.image_url ?? null);
    if (photoFile) {
      try {
        const blob = await compressImage(photoFile);
        image_url = await uploadPhoto(supabase, 'store', blob, `shop-${Date.now()}.webp`);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }
    try {
      const saved = await saveStoreShop(supabase, {
        id: shop?.id, church_id: churchId, name: name.trim(),
        description: description.trim() || null, image_url, is_active: isActive,
      }, targets);
      onSaved(saved);
    } catch (err) {
      setError(storeErrorMessage(err, 'تعذر الحفظ، تأكد من الصلاحيات'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div id="shop-form-modal" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة متجر' : 'تعديل المتجر'}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center gap-3">
            <ShopThumb url={photoPreview} name={name || 'متجر'} size={72} />
            <div className="flex-1 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-orange-300 bg-orange-50/50 px-3 py-2 text-xs font-bold text-orange-700">
                <Upload className="h-4 w-4" />
                {photoPreview ? 'تغيير صورة المتجر' : 'إضافة صورة المتجر (اختياري)'}
                <input id="shop-photo" type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
              </label>
              {photoPreview && (
                <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null); setRemovePhoto(true); }} className="flex items-center gap-1 text-xs font-bold text-red-500">
                  <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
                </button>
              )}
            </div>
          </div>

          <input id="shop-name" className="input-field" placeholder="اسم المتجر *" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          <textarea className="input-field" placeholder="وصف يظهر للمخدوم (اختياري)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

          {churches.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة المالكة للمتجر *</label>
              <select className={`input-field text-sm font-bold ${churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`} value={churchId}
                onChange={(e) => setChurchId(e.target.value)} required>
                <option value="">الكنيسة</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* places */}
          <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-3">
            <p className="mb-2 flex items-center gap-1 text-xs font-extrabold text-orange-800"><MapPin className="h-4 w-4" /> مرتبط بـ (كنيسة ← خدمة ← فصل) — يمكن إضافة أكثر من مكان</p>
            <div className="grid grid-cols-3 gap-2">
              <select id="shop-t-church" className={`input-field !px-2 text-xs font-bold ${churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={tChurch} onChange={(e) => { setTChurch(e.target.value); setTService(ALL); setTClass(ALL); }}>
                {isOwner && <option value={ALL}>الكل — كل الكنائس</option>}
                {!isOwner && !tChurch && <option value="">الكنيسة</option>}
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select id="shop-t-service" className={`input-field !px-2 text-xs font-bold ${serviceLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={tService} disabled={tChurch === ALL || !tChurch} onChange={(e) => { setTService(e.target.value); setTClass(ALL); }}>
                <option value={ALL}>كل الخدمات</option>
                {tServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select id="shop-t-class" className={`input-field !px-2 text-xs font-bold ${classLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
                value={tClass} disabled={tService === ALL} onChange={(e) => setTClass(e.target.value)}>
                <option value={ALL}>كل الفصول</option>
                {tClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button id="shop-add-target" type="button" onClick={addTarget} className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-orange-300 bg-white py-2 text-xs font-extrabold text-orange-700 hover:bg-orange-50">
              <Plus className="h-4 w-4" /> إضافة هذا المكان
            </button>
            {targets.length > 0 && (
              <ul id="shop-targets" className="mt-2 space-y-1">
                {targets.map((t) => {
                  const k = keyOf(t);
                  return (
                    <li key={k} className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-orange-100">
                      {t.church_id === null ? <Globe className="h-3.5 w-3.5 text-orange-600" /> : <MapPin className="h-3.5 w-3.5 text-orange-400" />}
                      <span className="flex-1 truncate">{targetLabel(t, churches, services, classes)}</span>
                      <button type="button" onClick={() => removeTarget(k)} aria-label="إزالة" className="rounded-full p-1 text-red-500 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
            {targets.length === 0 && <p className="mt-2 text-center text-[11px] font-bold text-slate-400">لم يُضَف أي مكان بعد</p>}
          </div>

          <label className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-extrabold transition ${isActive ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>
            <input id="shop-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5 accent-emerald-600" />
            <Power className="h-4 w-4" />
            <span className="flex-1">
              تفعيل المتجر
              <span className="block text-[11px] font-bold text-slate-400">عند التفعيل يظهر المتجر للمخدومين في بوابتهم ويمكنهم إرسال طلبات شراء</span>
            </span>
          </label>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

          <button id="shop-save" type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-orange-600 !to-orange-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'add' ? 'إضافة المتجر' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
