'use client';

// ---------- Add / edit an item of ONE shop ----------
// 20261002120000: the shop is the container — the item belongs to the shop
// given in `shop` (its places are the shop's; church_id is copied by the DB).
// code (= QR label, unique per shop, auto-suggested) · name · description
// · picture (compressed to a small webp) · price in points · stock · active.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Save, Loader2, Upload, Shuffle, QrCode, Trash2, Store, MapPin, Globe } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { useAuth } from '@/lib/auth-context';
import { storeErrorMessage, type StoreShopWithTargets } from '@/lib/store';
import { useCodeGenerator } from '@/lib/customization-context';
import { ItemThumb, targetLabel } from '@/components/store/StoreBits';
import type { StoreItem, Church, Service, ClassRoom } from '@/lib/types';

/** Down-scale any picked image to ≤ 640px webp (keeps storage tiny). */
export async function compressImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const max = 640;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.8));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ItemFormModal({
  item, shop, churches, services, classes, onClose, onSaved,
}: {
  item: StoreItem | null;
  /** the shop the item lives in (20261002120000) */
  shop: StoreShopWithTargets;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  onClose: () => void;
  onSaved: (saved: StoreItem) => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const mode = item ? 'edit' : 'add';
  const genItemCode = useCodeGenerator('store_item');

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(String(item?.price ?? 1));
  const [stock, setStock] = useState(String(item?.stock ?? 0));
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(item?.image_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // code suggestion follows the owner's نظام الأكواد — scoped to the shop's
  // church (the code is unique per shop)
  const suggestCode = useCallback(() => genItemCode({
    churchId: shop.church_id, serviceId: null, classId: null,
  }), [genItemCode, shop.church_id]);
  // pre-fill a suggestion once when ADDING (the generator is ready after the context loads)
  const suggestedOnce = useRef(false);
  useEffect(() => {
    if (mode !== 'add' || suggestedOnce.current) return;
    suggestedOnce.current = true;
    setCode((c) => c || suggestCode());
  }, [mode, suggestCode]);

  const pickPhoto = (f: File | null) => {
    setPhotoFile(f);
    setRemovePhoto(false);
    if (f) setPhotoPreview(URL.createObjectURL(f));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!code.trim()) return setError('الكود مطلوب');
    if (!name.trim()) return setError('اسم الصنف مطلوب');
    const p = parseInt(price, 10);
    const s = parseInt(stock, 10);
    if (isNaN(p) || p < 0) return setError('السعر بالنقاط غير صالح');
    if (isNaN(s) || s < 0) return setError('الكمية غير صالحة');
    setSaving(true);

    let image_url = removePhoto ? null : (item?.image_url ?? null);
    if (photoFile) {
      try {
        const blob = await compressImage(photoFile);
        image_url = await uploadPhoto(supabase, 'store', blob, `${code.trim()}.webp`);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }

    // the item lives in the shop: its places are the shop's (the DB copies
    // church_id from the shop and clears service / class)
    const payload = {
      shop_id: shop.id,
      church_id: shop.church_id,
      service_id: null,
      class_id: null,
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
      image_url,
      price: p,
      stock: s,
      is_active: isActive,
    };

    const res = mode === 'add'
      ? await supabase.from('store_items').insert({ ...payload, created_by: profile?.id }).select('*').single()
      : await supabase.from('store_items').update(payload).eq('id', item!.id).select('*').single();

    if (res.error) {
      setError(storeErrorMessage(res.error, 'تعذر الحفظ، تأكد من الصلاحيات'));
      setSaving(false);
      return;
    }
    onSaved(res.data as StoreItem);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        id="item-form-modal"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة صنف' : 'تعديل الصنف'}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {/* picture */}
          <div className="flex items-center gap-3">
            <ItemThumb url={photoPreview} name={name || 'صنف'} size={72} />
            <div className="flex-1 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-orange-300 bg-orange-50/50 px-3 py-2 text-xs font-bold text-orange-700">
                <Upload className="h-4 w-4" />
                {photoFile ? 'تغيير الصورة' : photoPreview ? 'تغيير صورة الصنف' : 'إضافة صورة الصنف (اختياري)'}
                <input id="item-photo" type="file" accept="image/*" className="hidden"
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

          {/* code */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكود (يُطبع كـ QR) *</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <QrCode className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="item-code" className="input-field pr-9 font-mono" dir="ltr" value={code}
                  onChange={(e) => setCode(e.target.value)} required maxLength={64} />
              </div>
              <button type="button" onClick={() => setCode(suggestCode())} aria-label="كود عشوائي" title="كود عشوائي"
                className="btn-secondary !px-3"><Shuffle className="h-4 w-4" /></button>
            </div>
          </div>

          <input id="item-name" className="input-field" placeholder="اسم الصنف *" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <textarea className="input-field" placeholder="وصف (اختياري)" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">السعر بالنقاط *</label>
              <input id="item-price" type="number" inputMode="numeric" min={0} className="input-field text-center font-extrabold tabular-nums"
                value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الكمية المتاحة *</label>
              <input id="item-stock" type="number" inputMode="numeric" min={0} className="input-field text-center font-extrabold tabular-nums"
                value={stock} onChange={(e) => setStock(e.target.value)} required />
            </div>
          </div>

          {/* the shop (fixed — the item lives inside it) */}
          <div className="rounded-xl bg-orange-50 px-3 py-2">
            <p className="flex items-center gap-1 text-xs font-bold text-orange-700"><Store className="h-3.5 w-3.5" /> المتجر: {shop.name}</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {shop.targets.length === 0 && <li className="badge bg-red-50 text-red-500">المتجر غير مرتبط بأي مكان</li>}
              {shop.targets.map((t) => (
                <li key={t.id} className="badge bg-white text-orange-700">
                  {t.church_id === null ? <Globe className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                  {targetLabel(t, churches, services, classes)}
                </li>
              ))}
            </ul>
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold">
            <input id="item-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-orange-600" />
            متاح للبيع (الكاشير وبوابة المخدوم)
          </label>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

          <button id="item-save" type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-orange-600 !to-orange-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'add' ? 'إضافة الصنف' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
