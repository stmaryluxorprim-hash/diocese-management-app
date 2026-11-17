'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus, Check, ChevronDown, Loader2, Pencil, Save, Trash2, X, Layers, RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { cachedLookup } from '@/lib/queries';
import { useDebouncedRealtime } from '@/lib/realtime';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classTargets } from '@/lib/class-multi';
import { collapseGroups, deleteClassGroup, saveClassGroup, updateClassGroup, type Grouped } from '@/lib/class-groups';
import type { Church, Service, ClassRoom } from '@/lib/types';
import type { CardPrintProfile, CardPrintSettings } from '@/lib/card-types';
import { normalizePrint, printSettingsEqual, describePrintSettings } from '@/lib/card-types';

const ALL = '__all__';

// Is the migration applied? (PostgREST → 42P01 «relation does not exist»)
const isMissingTable = (msg: string | undefined) =>
  !!msg && /card_print_profiles|schema cache|42P01/i.test(msg);

// ============================================================
// PRINT PROFILES BAR — ملفات الطباعة المحفوظة
// Shown above the paper settings of the designer's print tab, of the
// bound print page and of the birthday-card print tab. A profile is a
// NAMED copy of CardPrintSettings saved in `card_print_profiles`
// (migration 0049), scoped like the templates. «تطبيق» copies the
// profile into the current settings (onApply); «حفظ كملف» stores the
// current settings under a name + scope.
// ============================================================
export default function PrintProfilesBar({
  settings, onApply, card, defaultScope,
}: {
  /** current print settings of the page (template or bound page) */
  settings: CardPrintSettings;
  /** apply a profile → the page copies it into its own settings */
  onApply: (s: CardPrintSettings) => void;
  /** card size — used for the «cols×rows» hint in the list */
  card?: { width: number; height: number };
  /** preselected scope for a NEW profile (e.g. the template's scope) */
  defaultScope?: { church_id: string | null; service_id: string | null; class_id: string | null };
}) {
  const supabase = createClient();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [rawProfiles, setProfiles] = useState<CardPrintProfile[]>([]);
  // rows sharing a group_id are ONE profile covering several classes
  const profiles = useMemo(() => collapseGroups(rawProfiles), [rawProfiles]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false); // migration 0049 not applied
  const [open, setOpen] = useState(false);
  const [saveModal, setSaveModal] = useState<null | { mode: 'new' } | { mode: 'rename'; p: Grouped<CardPrintProfile> }>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const load = useCallback(async () => {
    const [{ data, error }, ch, sv, cl] = await Promise.all([
      supabase.from('card_print_profiles').select('*').order('church_id', { ascending: true, nullsFirst: true }).order('name'),
      cachedLookup<Church>(supabase, 'churches'),
      cachedLookup<Service>(supabase, 'services'),
      cachedLookup<ClassRoom>(supabase, 'classes'),
    ]);
    if (error) {
      if (isMissingTable(error.message)) setUnavailable(true);
      setLoading(false);
      return;
    }
    setProfiles(((data ?? []) as CardPrintProfile[]).map((p) => ({ ...p, settings: normalizePrint(p.settings) })));
    setChurches(ch);
    setServices(sv);
    setClasses(cl);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'card-print-profiles', [{ table: 'card_print_profiles' }], load, { enabled: !unavailable });

  // the saved profile whose settings equal the current ones (if any)
  const activeProfile = useMemo(() => profiles.find((p) => printSettingsEqual(p.settings, settings)) ?? null, [profiles, settings]);

  const scopeLabel = useCallback((p: { church_id: string | null; service_id: string | null; class_id: string | null; class_ids?: string[] }) => {
    if (!p.church_id) return 'مشترك — الكل';
    const ch = churches.find((c) => c.id === p.church_id)?.name ?? 'كنيسة';
    if (!p.service_id) return ch;
    const sv = services.find((s) => s.id === p.service_id)?.name ?? 'خدمة';
    if (p.class_ids && p.class_ids.length > 1) return `${ch} › ${sv} › ${p.class_ids.map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join('، ')}`;
    if (!p.class_id) return `${ch} › ${sv}`;
    const cl = classes.find((c) => c.id === p.class_id)?.name ?? 'فصل';
    return `${ch} › ${sv} › ${cl}`;
  }, [churches, services, classes]);

  // ---------- actions ----------
  const apply = (p: Grouped<CardPrintProfile>) => {
    onApply(normalizePrint(p.settings));
    setOpen(false);
    flash(`تم تطبيق «${p.name}»`);
  };

  const overwrite = async (p: Grouped<CardPrintProfile>) => {
    if (!confirm(`استبدال إعدادات «${p.name}» بالإعدادات الحالية؟`)) return;
    setBusyId(p.id);
    const { error } = await updateClassGroup(supabase, 'card_print_profiles', p, { settings, edited_by: profile?.id });
    setBusyId(null);
    if (error) { alert('تعذّر الحفظ: ' + error.message); return; }
    flash('تم تحديث الملف ✓');
    load();
  };

  const remove = async (p: Grouped<CardPrintProfile>) => {
    if (!confirm(`حذف ملف الطباعة «${p.name}»؟ القوالب التي طُبّق عليها تحتفظ بإعداداتها.`)) return;
    setBusyId(p.id);
    const { error } = await deleteClassGroup(supabase, 'card_print_profiles', p);
    setBusyId(null);
    if (error) { alert('تعذّر الحذف: ' + error.message); return; }
    load();
  };

  if (unavailable) return null; // migration not applied → feature hidden, nothing breaks

  return (
    <section className="card !p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-right"
          aria-expanded={open}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <Layers className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-slate-700">ملفات الطباعة المحفوظة</span>
            <span className="block truncate text-[11px] font-bold text-slate-400">
              {loading ? 'جارٍ التحميل…'
                : activeProfile ? <>الملف الحالي: <span className="text-violet-600">{activeProfile.name}</span></>
                : profiles.length === 0 ? 'لا توجد ملفات بعد — احفظ الإعدادات الحالية كملف لتعيد استخدامها'
                : 'إعدادات مخصّصة (غير محفوظة كملف)'}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={() => setSaveModal({ mode: 'new' })}
          className="btn-primary !py-2 !px-3 flex shrink-0 items-center gap-1 text-xs !from-violet-600 !to-violet-500"
          title="حفظ الإعدادات الحالية كملف طباعة"
        >
          <BookmarkPlus className="h-4 w-4" /> حفظ كملف
        </button>
      </div>

      {toast && <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-center text-xs font-extrabold text-emerald-600">{toast}</p>}

      {open && (
        <ul className="mt-3 space-y-1.5 border-t border-indigo-50 pt-3">
          {profiles.map((p) => {
            const isActive = activeProfile?.id === p.id;
            const canWrite = isOwner || p.church_id !== null; // shared rows are owner-only (RLS)
            return (
              <li
                key={p.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                  isActive ? 'border-violet-300 bg-violet-50' : 'border-slate-100 bg-white'
                }`}
              >
                <button onClick={() => apply(p)} className="min-w-0 flex-1 text-right" title="تطبيق هذا الملف">
                  <span className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700">
                    {isActive && <Check className="h-4 w-4 text-violet-600" />}
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="block truncate text-[10px] font-bold text-slate-400" dir="rtl">
                    {describePrintSettings(p.settings, card)} · <span className="text-gold-600">{scopeLabel(p)}</span>
                  </span>
                </button>
                {busyId === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
                ) : (
                  <>
                    <button
                      onClick={() => apply(p)}
                      className="shrink-0 rounded-lg bg-violet-100 px-2 py-1 text-[11px] font-extrabold text-violet-700 hover:bg-violet-200"
                    >
                      تطبيق
                    </button>
                    {canWrite && (
                      <>
                        <button
                          onClick={() => overwrite(p)}
                          disabled={isActive}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                          title="استبدال إعدادات هذا الملف بالإعدادات الحالية"
                          aria-label={`تحديث ${p.name}`}
                        >
                          <Save className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setSaveModal({ mode: 'rename', p })}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          title="إعادة تسمية / تغيير النطاق"
                          aria-label={`تعديل ${p.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => remove(p)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                          title="حذف الملف"
                          aria-label={`حذف ${p.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
          {profiles.length === 0 && !loading && (
            <li className="py-4 text-center text-xs font-bold text-slate-300">
              لا توجد ملفات طباعة — اضبط الورقة والهوامش ثم «حفظ كملف»
            </li>
          )}
          {activeProfile === null && profiles.length > 0 && (
            <li className="pt-1 text-center text-[11px] font-bold text-slate-400">
              <RotateCcw className="inline h-3 w-3" /> الإعدادات الحالية تختلف عن كل الملفات — احفظها كملف جديد أو حدّث ملفاً موجوداً (زر <Save className="inline h-3 w-3" />).
            </li>
          )}
        </ul>
      )}

      {saveModal && (
        <SaveProfileModal
          mode={saveModal.mode}
          existing={saveModal.mode === 'rename' ? saveModal.p : null}
          settings={settings}
          churches={churches}
          services={services}
          classes={classes}
          isOwner={isOwner}
          defaultScope={defaultScope}
          onSaved={(name) => { setSaveModal(null); flash(`تم حفظ «${name}» ✓`); load(); }}
          onClose={() => setSaveModal(null)}
        />
      )}
    </section>
  );
}

// ---------- save / rename modal ----------
function SaveProfileModal({
  mode, existing, settings, churches, services, classes, isOwner, defaultScope, onSaved, onClose,
}: {
  mode: 'new' | 'rename';
  existing: Grouped<CardPrintProfile> | null;
  settings: CardPrintSettings;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  isOwner: boolean;
  defaultScope?: { church_id: string | null; service_id: string | null; class_id: string | null };
  onSaved: (name: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const { profile } = useAuth();
  const init = existing ?? defaultScope ?? null;
  const [name, setName] = useState(existing?.name ?? '');
  const [churchId, setChurchId] = useState<string>(
    init?.church_id ?? (isOwner ? ALL : churches.length === 1 ? churches[0].id : '')
  );
  const [serviceId, setServiceId] = useState<string>(init?.church_id ? (init.service_id ?? ALL) : ALL);
  const [classIds, setClassIds] = useState<string[]>(existing ? existing.class_ids : []); // [] = كل الفصول
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredServices = churchId && churchId !== ALL ? services.filter((s) => s.church_id === churchId) : [];
  const filteredClasses = serviceId && serviceId !== ALL
    ? classes.filter((c) => c.church_id === churchId && c.service_id === serviceId)
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const n = name.trim();
    if (!n) return setError('اكتب اسم الملف');
    if (!churchId) return setError('اختر النطاق');
    setSaving(true);
    const noClass = churchId === ALL || serviceId === ALL;
    // ONE profile for all chosen classes (rows tied by group_id)
    const targets = noClass ? [null] : classTargets(classIds);
    const rowFor = (cid: string | null, gid: string | null) => ({
      church_id: churchId === ALL ? null : churchId,
      service_id: churchId === ALL || serviceId === ALL ? null : serviceId,
      class_id: cid,
      group_id: gid,
      name: n,
    });
    let err: { message: string } | null = null;
    try {
      await saveClassGroup<CardPrintProfile>({
        existing: mode === 'rename' && existing ? existing.group_rows : undefined,
        targets,
        create: async (cid, gid) => {
          const { data, error } = await supabase.from('card_print_profiles').insert({ ...rowFor(cid, gid), settings: existing?.settings ?? settings, created_by: profile?.id }).select('*').single();
          if (error) throw error;
          return data as CardPrintProfile;
        },
        update: async (row, cid, gid) => {
          const { data, error } = await supabase.from('card_print_profiles').update({ ...rowFor(cid, gid), edited_by: profile?.id }).eq('id', row.id).select('*').single();
          if (error) throw error;
          return data as CardPrintProfile;
        },
        remove: async (row) => {
          const { error } = await supabase.from('card_print_profiles').delete().eq('id', row.id);
          if (error) throw error;
        },
      });
    } catch (ex) {
      err = ex as { message: string };
    }
    setSaving(false);
    if (err) {
      setError(/row-level security|permission/i.test(err.message)
        ? 'ليس لديك صلاحية حفظ ملف على هذا النطاق — اختر نطاقاً ضمن إدارتك'
        : 'تعذّر الحفظ: ' + err.message);
      return;
    }
    onSaved(n);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" dir="rtl">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <Layers className="h-5 w-5 text-violet-600" />
            {mode === 'rename' ? 'تعديل ملف الطباعة' : 'حفظ الإعدادات كملف طباعة'}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {mode === 'new' && (
          <p className="mb-3 rounded-xl bg-violet-50 p-3 text-[11px] font-bold text-violet-700" dir="rtl">
            سيُحفظ: {describePrintSettings(settings)}
          </p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">اسم الملف *</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: A4 — 10 كروت ID"
              maxLength={80}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">متاح لـ *</label>
            <select
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(ALL); setClassIds([]); }}
              required
            >
              <option value="">اختر النطاق</option>
              {isOwner && <option value={ALL}>مشترك — كل الكنائس</option>}
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {churchId && churchId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة</label>
              <select
                className="input-field"
                value={serviceId}
                onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}
              >
                <option value={ALL}>كل الخدمات</option>
                {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {churchId && churchId !== ALL && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصول</label>
              <MultiClassSelect id="print-profile-classes" value={classIds} onChange={setClassIds} options={filteredClasses} />
            </div>
          )}
          <p className="text-[11px] font-bold text-slate-400">
            يرى الملف كل من يخدم داخل هذا النطاق (الفصل يرى ملفات خدمته وكنيسته)، ويعدّله من يدير النطاق.
          </p>
          {error && <p className="text-sm font-bold text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2 !from-violet-600 !to-violet-500">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {mode === 'rename' ? 'حفظ التعديل' : 'حفظ الملف'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
