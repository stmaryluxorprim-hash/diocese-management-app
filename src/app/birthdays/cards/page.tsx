'use client';
import { singleClass } from '@/lib/class-multi';

// ---------- BIRTHDAYS — card templates (كروت التهنئة) ----------
// List of birthday card templates scoped church → service? → class?
// (null = all). Create (from the festive default), duplicate, set default,
// delete, open → /birthdays/cards/[id] (design + print). When the page is
// reached from the month view with ?year&month, the print tab of the
// opened template lists that month's children ready to print.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus, Loader2, Copy, Trash2, Star, StarOff, ChevronLeft, IdCard, Printer, X,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ALL } from '@/lib/queries';
import { DEFAULT_BIRTHDAY_DESIGN, DEFAULT_PRINT_SETTINGS, ARABIC_MONTHS } from '@/lib/card-types';
import { ScopeSelectors, useScopeState, useStoreLookups, scopeLabel } from '@/components/store/StoreBits';
import { BirthdayHeader, Toast } from '@/components/birthdays/BirthdayBits';
import {
  type BirthdayCardTemplate, fetchBirthdayTemplates, isMigrationMissing, MIGRATION_HINT, birthdayErrorMessage,
} from '@/lib/birthdays';

export default function BirthdayCardsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const params = useSearchParams();
  const printCtx = params.get('year') && params.get('month')
    ? { year: Number(params.get('year')), month: Number(params.get('month')) }
    : null;
  const ctxQuery = printCtx
    ? `?year=${printCtx.year}&month=${printCtx.month}${params.get('church') ? `&church=${params.get('church')}` : ''}${params.get('service') ? `&service=${params.get('service')}` : ''}${params.get('class') ? `&class=${params.get('class')}` : ''}&tab=print`
    : '';

  const enabled = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, enabled);
  const [templates, setTemplates] = useState<BirthdayCardTemplate[] | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    try { setTemplates(await fetchBirthdayTemplates(supabase)); }
    catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); setTemplates([]); }
  }, [supabase]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useDebouncedRealtime(supabase, 'birthday-card-templates', [{ table: 'birthday_card_templates' }], load, { enabled });

  const duplicate = async (t: BirthdayCardTemplate) => {
    setBusy(t.id);
    const { error } = await supabase.from('birthday_card_templates').insert({
      church_id: t.church_id, service_id: t.service_id, class_id: t.class_id,
      name: `${t.name} (نسخة)`, design: t.design, print_settings: t.print_settings, created_by: profile?.id,
    });
    setBusy(null);
    if (error) flash(birthdayErrorMessage(error)); else load();
  };
  const toggleDefault = async (t: BirthdayCardTemplate) => {
    setBusy(t.id);
    const { error } = await supabase.from('birthday_card_templates').update({ is_default: !t.is_default, edited_by: profile?.id }).eq('id', t.id);
    setBusy(null);
    if (error) flash(birthdayErrorMessage(error)); else load();
  };
  const remove = async (t: BirthdayCardTemplate) => {
    if (!confirm(`حذف قالب «${t.name}»؟`)) return;
    setBusy(t.id);
    const { error } = await supabase.from('birthday_card_templates').delete().eq('id', t.id);
    setBusy(null);
    if (error) flash(birthdayErrorMessage(error)); else load();
  };

  const grouped = useMemo(() => {
    const m = new Map<string, BirthdayCardTemplate[]>();
    (templates ?? []).forEach((t) => { const l = m.get(t.church_id) ?? []; l.push(t); m.set(t.church_id, l); });
    return Array.from(m.entries());
  }, [templates]);

  return (
    <AppShell>
      <BirthdayHeader title="كروت التهنئة" info="نفس محرك تصميم الكروت مع بيانات إضافية لعيد الميلاد (السن الجديدة · يوم وشهر العيد · نقاط الهدية). القالب الأقرب لنطاق المخدوم (فصل ← خدمة ← كنيسة) هو الذي يُستخدم لكارته." />
      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      {printCtx && (
        <p className="mb-3 flex items-start gap-2 rounded-2xl bg-violet-50 px-4 py-3 text-xs font-bold text-violet-800">
          <Printer className="mt-0.5 h-4 w-4 shrink-0" />
          لطباعة كروت مواليد <b>{ARABIC_MONTHS[printCtx.month - 1]} {printCtx.year}</b>: اختر قالباً ← تبويب «الطباعة» يعرض أطفال الشهر جاهزين للطباعة.
        </p>
      )}

      <div className="mb-3 flex justify-end">
        <button id="bd-add-template" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 !px-4 !py-2 text-sm">
          <Plus className="h-4 w-4" /> قالب جديد
        </button>
      </div>

      {templates === null ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-pink-500" /></div>
      ) : templates.length === 0 ? (
        <div className="card py-12 text-center">
          <IdCard className="mx-auto mb-2 h-10 w-10 text-pink-200" />
          <p className="font-extrabold text-slate-500">لا توجد قوالب كروت تهنئة بعد</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary mt-4 !px-5 !py-2 text-sm">أنشئ أول قالب</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map(([churchId, list]) => (
            <section key={churchId} className="card !p-0 overflow-hidden">
              <header className="bg-pink-50 px-3 py-2 text-xs font-extrabold text-pink-800">{churches.find((c) => c.id === churchId)?.name ?? '…'}</header>
              <ul className="divide-y divide-pink-50">
                {list.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                    <button onClick={() => toggleDefault(t)} disabled={busy === t.id} aria-label={t.is_default ? 'إلغاء الافتراضي' : 'جعله افتراضياً'}
                      className={`rounded-full p-1.5 ${t.is_default ? 'text-gold-500' : 'text-slate-300 hover:text-gold-500'}`}>
                      {t.is_default ? <Star className="h-5 w-5 fill-current" /> : <StarOff className="h-5 w-5" />}
                    </button>
                    <Link href={`/birthdays/cards/${t.id}${ctxQuery}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{t.name}</span>
                      <span className="block truncate text-[11px] font-bold text-slate-400">{scopeLabel(t, churches, services, classes)} · {t.design?.width ?? 148}×{t.design?.height ?? 105} مم</span>
                    </Link>
                    <button onClick={() => duplicate(t)} disabled={busy === t.id} aria-label="نسخ" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><Copy className="h-4 w-4" /></button>
                    <button onClick={() => remove(t)} disabled={busy === t.id} aria-label="حذف" className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    <Link href={`/birthdays/cards/${t.id}${ctxQuery}`} aria-label="فتح" className="rounded-full p-1.5 text-slate-300"><ChevronLeft className="h-5 w-5" /></Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {showAdd && (
        <AddTemplateModal
          supabase={supabase} churches={churches} services={services} classes={classes}
          profileChurch={profile?.church_id ?? null} userId={profile?.id}
          onCreated={(id) => { setShowAdd(false); router.push(`/birthdays/cards/${id}${ctxQuery}`); }}
          onClose={() => setShowAdd(false)} onError={flash}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}

function AddTemplateModal({
  supabase, churches, services, classes, profileChurch, userId, onCreated, onClose, onError,
}: {
  supabase: ReturnType<typeof createClient>;
  churches: ReturnType<typeof useStoreLookups>['churches'];
  services: ReturnType<typeof useStoreLookups>['services'];
  classes: ReturnType<typeof useStoreLookups>['classes'];
  profileChurch: string | null; userId?: string;
  onCreated: (id: string) => void; onClose: () => void; onError: (m: string) => void;
}) {
  const scope = useScopeState();
  const [name, setName] = useState('كارت عيد ميلاد');
  const [saving, setSaving] = useState(false);
  const churchId = scope.church !== ALL ? scope.church : (churches.length === 1 ? churches[0].id : profileChurch);

  const create = async () => {
    if (!name.trim()) return;
    if (!churchId) { onError('اختر الكنيسة'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('birthday_card_templates').insert({
      church_id: churchId,
      service_id: scope.service === ALL ? null : scope.service,
      class_id: scope.service === ALL ? null : singleClass(scope.classes),
      name: name.trim(), design: DEFAULT_BIRTHDAY_DESIGN, print_settings: { ...DEFAULT_PRINT_SETTINGS, gapX: 6, gapY: 6 },
      is_default: false, created_by: userId,
    }).select('id').single();
    setSaving(false);
    if (error || !data) { onError(birthdayErrorMessage(error)); return; }
    onCreated(data.id as string);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">قالب كارت تهنئة جديد</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-bold text-slate-500">اسم القالب</span>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="mb-1 text-xs font-bold text-slate-500">النطاق (كنيسة ← خدمة ← فصل، «الكل» = كل ما تحته)</p>
        <ScopeSelectors idPrefix="bd-tpl" scope={scope} churches={churches} services={services} classes={classes} />
        <div className="flex gap-2">
          <button onClick={create} disabled={saving || !name.trim()} className="btn-primary flex-1 !py-2.5">
            {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'إنشاء وفتح المصمم'}
          </button>
          <button onClick={onClose} className="btn-secondary !py-2.5">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
