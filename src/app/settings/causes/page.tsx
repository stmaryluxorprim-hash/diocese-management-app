'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Award, Plus, ArrowRight, Loader2, X, Pencil, Save, Trash2, Star, Eye, Lock,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classTargets } from '@/lib/class-multi';
import { collapseGroups, deleteClassGroup, saveClassGroup, type Grouped } from '@/lib/class-groups';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import type { Cause, ClassRoom, Service, Church, PointsMode } from '@/lib/types';
import { POINTS_MODE_LABELS } from '@/lib/types';
import { defaultLevelLabel } from '@/lib/defaults';

// Sentinel for "all services / all classes" in select controls (null in DB)
const ALL = 'all';

export default function CausesPage() {
  const { profile } = useAuth();
  const { activityCan } = usePermissions();
  const canAdd = activityCan('causes', 'add');
  const canEdit = activityCan('causes', 'edit');
  const canDelete = activityCan('causes', 'delete');
  const canSetDefault = activityCan('causes', 'set_default');
  const supabase = createClient();
  const [causes, setCauses] = useState<Cause[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Grouped<Cause> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: ca }, { data: cl }, { data: sv }, { data: ch }] = await Promise.all([
      supabase.from('causes').select('*').order('name'),
      supabase.from('classes').select('*').order('sort_order').order('name'),
      supabase.from('services').select('*').order('sort_order').order('name'),
      supabase.from('churches').select('*').order('sort_order').order('name'),
    ]);
    setCauses(ca ?? []);
    setClasses(cl ?? []);
    setServices(sv ?? []);
    setChurches(ch ?? []);
    setLoading(false);
  }, [supabase]);

  // Initial fetch — the realtime hook below only reloads on DB change events,
  // so without this the page would sit on the spinner until something changed.
  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'causes-page', [{ table: 'causes' }], load, { enabled: !!profile });

  // church → service → class tree + filter
  const lookups = useMemo(() => toLookups(churches, services, classes), [churches, services, classes]);
  const grouped = useMemo(() => collapseGroups(causes), [causes]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    grouped,
    (ca, q) => ca.name.toLowerCase().includes(q) || (ca.description ?? '').toLowerCase().includes(q),
  );
  const scopeBadge = (ca: Grouped<Cause>) => {
    if (ca.service_id === null) return 'كل الخدمات';
    if (ca.class_ids.length === 0) return 'كل الفصول';
    if (ca.class_ids.length > 1) {
      return ca.class_ids.map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join('، ');
    }
    return null;
  };

  const remove = async (ca: Grouped<Cause>) => {
    if (!confirm(`حذف السبب «${ca.name}»؟ سجلات النقاط المرتبطة به ستبقى بدون سبب.`)) return;
    await deleteClassGroup(supabase, 'causes', ca);
    load();
  };

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Award className="h-5 w-5 text-amber-600" />
            أسباب النقاط
            <span className="badge bg-amber-100 text-amber-700">{grouped.length}</span>
          </h2>
        </div>
        {canAdd && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {!canAdd && !canEdit && !canDelete && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-500">
          <Eye className="h-4 w-4" /> عرض فقط — الإضافة والتعديل تحتاج ملف صلاحيات من مسؤولك
        </p>
      )}

      <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
        النقاط تُسجَّل بسبب (حفظ آية، سلوك، مسابقة...) نطاقه فصل محدد أو كل الفصول أو كل الخدمات،
        وله مقدار نقاط محدد يُضاف أو يُخصم به.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <>
        <ScopeGroupFilters idPrefix="causes" scope={scope} onScope={setScope} lookups={lookups}
          search={search} onSearch={setSearch} placeholder="بحث باسم السبب..." />
        <ScopeGroups
          idPrefix="causes"
          rows={visible}
          lookups={lookups}
          tone="amber"
          itemName={(ca) => ca.name}
          emptyText={grouped.length === 0 ? 'لا توجد أسباب بعد' : 'لا توجد أسباب مطابقة'}
          renderItem={(ca) => (
            <li key={ca.id} className="card flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 ring-2 ring-amber-100">
                <Award className="h-6 w-6 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-extrabold">{ca.name}</p>
                  <span className="badge bg-amber-100 text-amber-700 flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    {ca.points_mode === 'open' ? 'مفتوح' : `${ca.points} نقطة`}
                    {ca.points_mode === 'editable' && ' ✎'}
                  </span>
                  {ca.is_default && (
                    <span className="badge bg-emerald-100 text-emerald-700">{defaultLevelLabel(ca)}</span>
                  )}
                  {scopeBadge(ca) && <span className="badge bg-slate-100 text-slate-500">{scopeBadge(ca)}</span>}
                </div>
                {ca.description && <p className="text-xs text-slate-500 mt-1">{ca.description}</p>}
              </div>
              {(canEdit || canDelete) && (
                <div className="flex shrink-0 gap-1.5">
                  {canEdit && (
                    <button
                      onClick={() => setEditing(ca)}
                      aria-label={`تعديل ${ca.name}`}
                      className="rounded-xl bg-amber-50 p-2 text-amber-600 hover:bg-amber-100 transition"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => remove(ca)}
                      aria-label={`حذف ${ca.name}`}
                      className="rounded-xl bg-red-50 p-2 text-red-600 hover:bg-red-100 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </li>
          )}
        />
        </>
      )}

      {showAdd && (
        <CauseModal
          mode="add"
          churches={churches}
          services={services}
          classes={classes}
          canSetDefault={canSetDefault}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {editing && (
        <CauseModal
          mode="edit"
          cause={editing}
          churches={churches}
          services={services}
          classes={classes}
          canSetDefault={canSetDefault}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function CauseModal({
  mode, cause, churches, services, classes, canSetDefault, onClose, onSaved,
}: {
  mode: 'add' | 'edit';
  cause?: Grouped<Cause>;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  /** `activity.causes.set_default` — without it the default flag is read-only */
  canSetDefault: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const [name, setName] = useState(cause?.name ?? '');
  const [description, setDescription] = useState(cause?.description ?? '');
  const [churchId, setChurchId] = useState(cause?.church_id ?? '');
  const [serviceId, setServiceId] = useState(cause ? (cause.service_id ?? ALL) : '');
  const [classIds, setClassIds] = useState<string[]>(cause ? cause.class_ids : []); // [] = كل الفصول
  const [points, setPoints] = useState(String(cause?.points ?? 1));
  const [pointsMode, setPointsMode] = useState<PointsMode>(cause?.points_mode ?? 'fixed');
  const [isDefault, setIsDefault] = useState<boolean>(cause?.is_default ?? false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : [];
  const filteredClasses = serviceId && serviceId !== ALL
    ? classes.filter((c) => c.church_id === churchId && c.service_id === serviceId)
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    if (!serviceId) return setError('اختر الخدمة أو «كل الخدمات»');
    const pts = Math.max(0, Math.floor(Number(points) || 0));
    setSaving(true);

    const base = {
      church_id: churchId,
      service_id: serviceId === ALL ? null : serviceId,
      name: name.trim(),
      description: description.trim() || null,
      points: pts,
      points_mode: pointsMode,
      is_default: isDefault,
    };

    // One default PER SCOPE (0048): the DB trigger switches off the other
    // default of the SAME church / service / class; defaults of other levels
    // are untouched (class default beats service default beats church default).
    // one record per chosen class (none chosen / «كل الفصول» = one record with no class).
    // Editing updates the existing record to the first class, extra classes become new copies.
    const targets = serviceId === ALL ? [null] : classTargets(classIds);
    let err: { message: string } | null = null;
    try {
      await saveClassGroup<Cause>({
        existing: mode === 'edit' ? cause?.group_rows : undefined,
        targets,
        create: async (cid, gid) => {
          const { data, error } = await supabase.from('causes').insert({ ...base, class_id: cid, group_id: gid, created_by: profile?.id }).select('*').single();
          if (error) throw error;
          return data as Cause;
        },
        update: async (row, cid, gid) => {
          const { data, error } = await supabase.from('causes').update({ ...base, class_id: cid, group_id: gid, edited_by: profile?.id }).eq('id', row.id).select('*').single();
          if (error) throw error;
          return data as Cause;
        },
        remove: async (row) => {
          const { error } = await supabase.from('causes').delete().eq('id', row.id);
          if (error) throw error;
        },
      });
    } catch (ex) {
      err = ex as { message: string };
    }

    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة سبب' : 'تعديل السبب'}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassIds([]); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className="input-field"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}
              required
            >
              <option value="">اختر الخدمة</option>
              <option value={ALL}>✳ كل الخدمات</option>
              {filteredServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
              <MultiClassSelect
                id="form-class"
                value={classIds}
                onChange={setClassIds}
                options={filteredClasses}
                allLabel="✳ كل الفصول"
                className="!py-2.5 !text-sm"
              />
            </div>
          )}
          <input className="input-field" placeholder="اسم السبب * (مثال: حفظ آية)" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">نظام النقاط *</label>
            <div className="grid grid-cols-3 gap-2">
              {(['fixed', 'editable', 'open'] as PointsMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPointsMode(m)}
                  aria-pressed={pointsMode === m}
                  className={`rounded-xl px-2 py-2 text-xs font-bold ring-2 transition ${
                    pointsMode === m
                      ? 'bg-amber-500 text-white ring-amber-500'
                      : 'bg-white text-slate-600 ring-slate-200 hover:ring-amber-300'
                  }`}
                >
                  {POINTS_MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] font-bold text-slate-400">
              ثابت: لا يمكن تغيير الرقم · قابل للتعديل: الرقم افتراضي ويمكن تغييره · مفتوح: يُكتب الرقم كل مرة
            </p>
          </div>

          {pointsMode !== 'open' && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">مقدار النقاط *</label>
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500" />
                <input
                  type="number" min={0} className="input-field" value={points}
                  onChange={(e) => setPoints(e.target.value)} required
                />
              </div>
            </div>
          )}

          {/* Default radio — preselected on children & scanner pages for THIS scope (0048).
              Needs `activity.causes.set_default`; otherwise shown locked. */}
          <label className={`flex flex-col gap-1 rounded-xl px-3 py-2.5 text-sm font-bold ${canSetDefault ? 'bg-emerald-50 text-emerald-700 cursor-pointer' : 'bg-slate-50 text-slate-400'}`}>
            <span className="flex items-center gap-2">
              <input
                id="cause-default-radio"
                type="radio"
                checked={isDefault}
                disabled={!canSetDefault}
                onClick={() => { if (canSetDefault) setIsDefault((v) => !v); }}
                onChange={() => {}}
                className="h-4 w-4 accent-emerald-600"
              />
              {!canSetDefault && <Lock className="h-3.5 w-3.5" />}
              {serviceId === ALL || !serviceId
                ? 'جعله السبب الافتراضي للكنيسة'
                : classIds.length !== 1
                  ? 'جعله السبب الافتراضي للخدمة'
                  : 'جعله السبب الافتراضي للفصل'}
            </span>
            <span className={`text-xs font-normal ${canSetDefault ? 'text-emerald-600/80' : 'text-slate-400'}`}>
              {canSetDefault
                ? 'يُختار تلقائياً عند تسجيل النقاط. الأولوية: افتراضي الفصل ← ثم الخدمة ← ثم الكنيسة.'
                : 'تحديد الافتراضي يحتاج صلاحية «تحديد السبب الافتراضي»'}
            </span>
          </label>
          <textarea className="input-field" placeholder="وصف السبب" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'add' ? <Plus className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {mode === 'add' ? 'حفظ السبب' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
