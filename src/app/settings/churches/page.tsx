'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Church as ChurchIcon, Plus, ArrowRight, Loader2, Upload, X, Pencil, Save } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { IMMUTABLE_CACHE_SECONDS } from '@/lib/upload';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { invalidateLookup } from '@/lib/queries';
import { ReorderButtons, moveScopeItem } from '@/components/ReorderButtons';
import type { Church } from '@/lib/types';

export default function ChurchesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Church | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);
  const [orderError, setOrderError] = useState('');
  // Edit per level: owner → all churches, church manager → his own church (matches RLS)
  const canEditChurch = (c: Church) => {
    if (!profile) return false;
    if (profile.role === 'owner') return true;
    if (profile.role === 'church_manager') return c.id === profile.church_id;
    return false;
  };

  const load = useCallback(async () => {
    const { data } = await supabase.from('churches').select('*').order('sort_order').order('name');
    setChurches(data ?? []);
    setLoading(false);
  }, [supabase]);

  // Initial fetch — the realtime hook below only reloads on DB change events,
  // so without this the page would sit on the spinner until something changed.
  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'churches-page', [{ table: 'churches' }], load, { enabled: !!profile });

  // ▲ ▼ — the owner decides which church comes first everywhere in the app
  const canReorder = profile?.role === 'owner';
  const move = async (c: Church, dir: -1 | 1) => {
    setMoving(c.id); setOrderError('');
    try {
      const next = await moveScopeItem(supabase, 'churches', churches, c.id, dir);
      if (next) { setChurches(next.map((x, i) => ({ ...x, sort_order: i + 1 }))); invalidateLookup('churches'); }
    } catch {
      setOrderError('تعذر حفظ الترتيب، تأكد من الصلاحيات');
    } finally { setMoving(null); }
  };

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <ChurchIcon className="h-5 w-5 text-gold-500" />
            الكنائس
            <span className="badge bg-gold-100 text-gold-600">{churches.length}</span>
          </h2>
        </div>
        {profile?.role === 'owner' && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <ul className="space-y-3">
          {orderError && <li className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{orderError}</li>}
          {canReorder && churches.length > 1 && (
            <li className="px-1 text-[11px] font-bold text-slate-400">استخدم ▲ ▼ لترتيب الكنائس — هذا الترتيب يظهر في كل القوائم</li>
          )}
          {churches.map((c, i) => (
            <li key={c.id} className="card flex items-center gap-3">
              {canReorder && (
                <ReorderButtons index={i} count={churches.length} busy={moving === c.id} label={c.name} tone="primary" onMove={(d) => move(c, d)} />
              )}
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary-50 ring-2 ring-primary-100 flex items-center justify-center">
                {c.logo_url ? (
                  <Image src={c.logo_url} alt={c.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <ChurchIcon className="h-6 w-6 text-primary-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold truncate">{c.name}</p>
                {c.address && <p className="text-xs text-slate-400 truncate">{c.address}</p>}
              </div>
              {canEditChurch(c) && (
                <button
                  onClick={() => setEditing(c)}
                  aria-label={`تعديل ${c.name}`}
                  className="shrink-0 rounded-xl bg-primary-50 p-2 text-primary-600 hover:bg-primary-100 transition"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {churches.length === 0 && (
            <li className="card py-12 text-center text-slate-400 font-bold">لا توجد كنائس بعد</li>
          )}
        </ul>
      )}

      {showAdd && <AddChurchModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <EditChurchModal church={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </AppShell>
  );
}

function EditChurchModal({ church, onClose, onSaved }: { church: Church; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [name, setName] = useState(church.name);
  const [address, setAddress] = useState(church.address ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    let logo_url = church.logo_url;
    if (logoFile) {
      const path = `${Date.now()}-${logoFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('church-logos').upload(path, logoFile, { cacheControl: IMMUTABLE_CACHE_SECONDS });
      if (upErr) {
        setError('تعذر رفع الشعار');
        setSaving(false);
        return;
      }
      logo_url = supabase.storage.from('church-logos').getPublicUrl(path).data.publicUrl;
    }

    const { error: err } = await supabase
      .from('churches')
      .update({ name: name.trim(), address: address.trim() || null, logo_url })
      .eq('id', church.id);
    if (err) {
      setError('تعذر الحفظ — هذه العملية متاحة لمالك التطبيق فقط');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">تعديل الكنيسة</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className="input-field" placeholder="اسم الكنيسة *" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <input className="input-field" placeholder="العنوان" value={address}
            onChange={(e) => setAddress(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
            <Upload className="h-4 w-4" />
            {logoFile ? logoFile.name : 'تغيير شعار الكنيسة (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ التعديلات
          </button>
        </form>
      </div>
    </div>
  );
}

function AddChurchModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    let logo_url: string | null = null;
    if (logoFile) {
      const path = `${Date.now()}-${logoFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('church-logos').upload(path, logoFile, { cacheControl: IMMUTABLE_CACHE_SECONDS });
      if (upErr) {
        setError('تعذر رفع الشعار');
        setSaving(false);
        return;
      }
      logo_url = supabase.storage.from('church-logos').getPublicUrl(path).data.publicUrl;
    }

    const { error: err } = await supabase.from('churches').insert({
      name: name.trim(),
      address: address.trim() || null,
      logo_url,
    });
    if (err) {
      setError('تعذر الحفظ — هذه العملية متاحة لمالك التطبيق فقط');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">إضافة كنيسة</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className="input-field" placeholder="اسم الكنيسة *" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <input className="input-field" placeholder="العنوان" value={address}
            onChange={(e) => setAddress(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
            <Upload className="h-4 w-4" />
            {logoFile ? logoFile.name : 'رفع شعار الكنيسة (صورة)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ الكنيسة
          </button>
        </form>
      </div>
    </div>
  );
}
