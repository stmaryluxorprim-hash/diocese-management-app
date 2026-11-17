'use client';

import { cachedLookup } from '@/lib/queries';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IdCard, Plus, ArrowRight, Loader2, X, Trash2, Copy, ChevronLeft, Link2, Printer,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classTargets } from '@/lib/class-multi';
import { collapseGroups, deleteClassGroup, saveClassGroup, rowsOf, type Grouped } from '@/lib/class-groups';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Church, Service, ClassRoom } from '@/lib/types';
import type { CardTemplate } from '@/lib/card-types';
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, hasBack } from '@/lib/card-types';
import BoundPrintTab from '@/components/cards/BoundPrintTab';
import { useNavLabel } from '@/lib/customization-context';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';

const ALL = '__all__';

type Tab = 'templates' | 'print';

export default function CardTemplatesPage() {
  const pageName = useNavLabel('cards');
  const { profile } = useAuth();
  const supabase = createClient();
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [rebinding, setRebinding] = useState<Grouped<CardTemplate> | null>(null);
  const [deleting, setDeleting] = useState<Grouped<CardTemplate> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('templates');

  const load = useCallback(async () => {
    const [t, c, s, cl] = await Promise.all([
      supabase.from('card_templates').select('*').order('created_at', { ascending: false }),
      cachedLookup<Church>(supabase, 'churches'),
      cachedLookup<Service>(supabase, 'services'),
      cachedLookup<ClassRoom>(supabase, 'classes'),
    ]);
    setTemplates((t.data as CardTemplate[]) ?? []);
    setChurches(c);
    setServices(s);
    setClasses(cl);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  // church → service → class tree + filter
  const lookups = useMemo(() => toLookups(churches, services, classes), [churches, services, classes]);
  const grouped = useMemo(() => collapseGroups(templates), [templates]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    grouped,
    (t, q) => t.name.toLowerCase().includes(q),
  );
  const scopeBadge = (t: Grouped<CardTemplate>) => {
    if (t.service_id === null) return 'كل الخدمات';
    if (t.class_ids.length === 0) return 'كل الفصول';
    if (t.class_ids.length > 1) {
      return t.class_ids.map((id) => classes.find((c) => c.id === id)?.name).filter(Boolean).join('، ');
    }
    return null;
  };

  const duplicate = async (t: Grouped<CardTemplate>) => {
    const rows = rowsOf<CardTemplate>(t);
    const gid = rows.length > 1 ? crypto.randomUUID() : null;
    await supabase.from('card_templates').insert(rows.map((r) => ({
      church_id: r.church_id,
      service_id: r.service_id,
      class_id: r.class_id,
      group_id: gid,
      name: `${r.name} (نسخة)`,
      design: r.design,
      print_settings: r.print_settings,
      created_by: profile?.id,
    })));
    load();
  };

  const remove = async () => {
    if (!deleting) return;
    await deleteClassGroup(supabase, 'card_templates', deleting);
    setDeleting(null);
    load();
  };

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <IdCard className="h-5 w-5 text-primary-600" />
            {pageName}
            <span className="badge bg-primary-100 text-primary-700">{grouped.length}</span>
          </h2>
        </div>
        {tab === 'templates' && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> قالب جديد
          </button>
        )}
      </section>

      {/* tabs */}
      <div className="mb-4 flex rounded-2xl bg-white p-1 shadow-card border border-indigo-50 print:hidden">
        <button
          onClick={() => setTab('templates')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'templates' ? 'bg-primary-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <IdCard className="h-4 w-4" /> القوالب
        </button>
        <button
          onClick={() => setTab('print')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'print' ? 'bg-primary-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Printer className="h-4 w-4" /> الطباعة
        </button>
      </div>

      {tab === 'print' ? (
        <BoundPrintTab />
      ) : loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <>
        <ScopeGroupFilters idPrefix="cards" scope={scope} onScope={setScope} lookups={lookups}
          search={search} onSearch={setSearch} placeholder="بحث باسم القالب..." />
        <ScopeGroups
          idPrefix="cards"
          rows={visible}
          lookups={lookups}
          tone="indigo"
          itemName={(t) => t.name}
          emptyText={grouped.length === 0 ? 'لا توجد قوالب بعد — أنشئ قالبك الأول' : 'لا توجد قوالب مطابقة'}
          renderItem={(t) => (
            <li key={t.id} className="card flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 ring-2 ring-primary-100">
                <IdCard className="h-6 w-6 text-primary-500" />
              </div>
              <Link href={`/settings/cards/${t.id}`} className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-extrabold truncate">
                  <span className="truncate">{t.name}</span>
                  {hasBack(t.design) && <span className="badge shrink-0 bg-violet-50 text-violet-600 !py-0 text-[10px]">وجه + ظهر</span>}
                </p>
                {scopeBadge(t) && <p className="mt-0.5 text-[11px] text-slate-400">{scopeBadge(t)}</p>}
              </Link>
              <button
                onClick={() => setRebinding(t)}
                aria-label={`تغيير ربط ${t.name}`}
                title="تغيير الربط (كنيسة / خدمة / فصل)"
                className="shrink-0 rounded-xl bg-gold-50 p-2 text-gold-600 hover:bg-gold-100 transition"
              >
                <Link2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => duplicate(t)}
                aria-label={`نسخ ${t.name}`}
                className="shrink-0 rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-slate-100 transition"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeleting(t)}
                aria-label={`حذف ${t.name}`}
                className="shrink-0 rounded-xl bg-red-50 p-2 text-red-500 hover:bg-red-100 transition"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <Link href={`/settings/cards/${t.id}`} aria-label={`فتح ${t.name}`} className="shrink-0 p-1 text-slate-300">
                <ChevronLeft className="h-5 w-5" />
              </Link>
            </li>
          )}
        />
        </>
      )}

      {showAdd && (
        <AddTemplateModal
          churches={churches}
          services={services}
          classes={classes}
          onClose={() => setShowAdd(false)}
        />
      )}

      {rebinding && (
        <RebindTemplateModal
          template={rebinding}
          churches={churches}
          services={services}
          classes={classes}
          onSaved={() => { setRebinding(null); load(); }}
          onClose={() => setRebinding(null)}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5">
            <h3 className="mb-2 text-lg font-extrabold">حذف القالب؟</h3>
            <p className="mb-4 text-sm text-slate-500">سيتم حذف «{deleting.name}» نهائياً.</p>
            <div className="flex gap-2">
              <button onClick={remove} className="btn-primary flex-1 !from-red-600 !to-red-500">حذف</button>
              <button onClick={() => setDeleting(null)} className="btn-secondary flex-1">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ---------- Rebind modal: change church / service / class of a template ----------
function RebindTemplateModal({
  template, churches, services, classes, onSaved, onClose,
}: {
  template: Grouped<CardTemplate>;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [churchId, setChurchId] = useState(template.church_id);
  const [serviceId, setServiceId] = useState(template.service_id ?? ALL);
  const [classIds, setClassIds] = useState<string[]>(template.class_ids); // [] = كل الفصول
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
    setSaving(true);
    // one template for all chosen classes (rows tied by group_id; the design is copied to new rows)
    const targets = serviceId === ALL ? [null] : classTargets(classIds);
    const scopeOf = (cid: string | null, gid: string | null) => ({ church_id: churchId, service_id: serviceId === ALL ? null : serviceId, class_id: cid, group_id: gid });
    let err: { message: string } | null = null;
    try {
      await saveClassGroup<CardTemplate>({
        existing: template.group_rows,
        targets,
        create: async (cid, gid) => {
          const { data, error } = await supabase.from('card_templates').insert({
            ...scopeOf(cid, gid), name: template.name, design: template.design, print_settings: template.print_settings, created_by: profile?.id,
          }).select('*').single();
          if (error) throw error;
          return data as CardTemplate;
        },
        update: async (row, cid, gid) => {
          const { data, error } = await supabase.from('card_templates').update(scopeOf(cid, gid)).eq('id', row.id).select('*').single();
          if (error) throw error;
          return data as CardTemplate;
        },
        remove: async (row) => {
          const { error } = await supabase.from('card_templates').delete().eq('id', row.id);
          if (error) throw error;
        },
      });
    } catch (ex) {
      err = ex as { message: string };
    }
    setSaving(false);
    if (err) { setError('تعذر الحفظ، تأكد من الصلاحيات'); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">ربط القالب «{template.name}»</h3>
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
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className="input-field"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}
              disabled={!churchId}
              required
            >
              <option value="">اختر الخدمة</option>
              <option value={ALL}>كل الخدمات</option>
              {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصول</label>
              <MultiClassSelect id="card-class" value={classIds} onChange={setClassIds} options={filteredClasses}
                className="!py-2.5 !text-sm" />
            </div>
          )}
          {error && <p className="text-sm font-bold text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ الربط
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Add modal: name + scope, then jump to the designer ----------
function AddTemplateModal({
  churches, services, classes, onClose,
}: {
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [churchId, setChurchId] = useState(churches.length === 1 ? churches[0].id : '');
  const [serviceId, setServiceId] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]); // [] = كل الفصول
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
    setSaving(true);

    // ONE template for all chosen classes (one row per class tied by group_id); the designer opens on the first
    const targets = serviceId === ALL ? [null] : classTargets(classIds);
    const gid = targets.length > 1 ? crypto.randomUUID() : null;
    const { data, error: err } = await supabase
      .from('card_templates')
      .insert(targets.map((cid) => ({
        church_id: churchId,
        service_id: serviceId === ALL ? null : serviceId,
        class_id: cid,
        group_id: gid,
        name: name.trim(),
        design: DEFAULT_DESIGN,
        print_settings: DEFAULT_PRINT_SETTINGS,
        created_by: profile?.id,
      })))
      .select('id');

    if (err || !data || data.length === 0) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    router.push(`/settings/cards/${data[0].id}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">قالب كارت جديد</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">اسم القالب *</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: كارت مدارس الأحد 2026"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassIds([]); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className="input-field"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}
              disabled={!churchId}
              required
            >
              <option value="">اختر الخدمة</option>
              <option value={ALL}>كل الخدمات</option>
              {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصول</label>
              <MultiClassSelect id="card-class" value={classIds} onChange={setClassIds} options={filteredClasses}
                className="!py-2.5 !text-sm" />
            </div>
          )}
          {error && <p className="text-sm font-bold text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              إنشاء وفتح المصمم
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
