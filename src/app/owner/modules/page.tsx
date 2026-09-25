'use client';

// ---------- OWNER MODULE → صلاحيات الوحدات ----------
// For every module in the registry the owner sees its grants (كنيسة → خدمة
// → فصل, each level can be "all") and can add / remove grants. A module
// with NO grants is hidden from everyone but the owner. Realtime: the side
// menu & settings of every signed-in servant react instantly.
//
// 20260925130000: besides SCOPE grants the owner can name SPECIFIC PEOPLE
// (أشخاص محددون) — a `module_access` row with `servant_id` and no scope. The
// named servant sees the module wherever he is; nobody else is affected.

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight, Layers, Plus, X, Trash2, Loader2, Globe, Church as ChurchIcon, School,
  EyeOff, Eye, ShieldCheck, UserPlus, User, Search, Check,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { cachedLookup } from '@/lib/queries';
import { useModules } from '@/lib/modules-context';
import { MODULES, isPersonGrant, type AppModule, type ModuleAccess } from '@/lib/modules';
import { ROLE_LABELS, SERVANTS_TABLE, type Church, type Service, type ClassRoom, type ServantEnrollment } from '@/lib/types';

type ServantLite = Pick<ServantEnrollment, 'id' | 'full_name' | 'user_id' | 'role' | 'church_id' | 'service_id' | 'class_id' | 'photo_url' | 'status'>;

const ALL = 'all';

export default function OwnerModulesPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const { grants, loading, reload } = useModules();

  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [servants, setServants] = useState<ServantLite[]>([]);
  const [adding, setAdding] = useState<AppModule | null>(null);
  const [addingPerson, setAddingPerson] = useState<AppModule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile?.role !== 'owner') return;
    (async () => {
      const [c, s, cl, sv] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
        supabase.from(SERVANTS_TABLE)
          .select('id, full_name, user_id, role, church_id, service_id, class_id, photo_url, status')
          .neq('role', 'owner').in('status', ['approved', 'suspended']).order('full_name'),
      ]);
      setChurches(c); setServices(s); setClasses(cl);
      setServants((sv.data ?? []) as ServantLite[]);
    })();
  }, [supabase, profile?.role]);

  const servantById = useMemo(() => new Map(servants.map((s) => [s.id, s])), [servants]);

  const byModule = useMemo(() => {
    const m = new Map<string, ModuleAccess[]>();
    for (const g of grants) {
      const list = m.get(g.module_key) ?? [];
      list.push(g);
      m.set(g.module_key, list);
    }
    return m;
  }, [grants]);

  const name = {
    church: (id: string | null) => churches.find((c) => c.id === id)?.name ?? '…',
    service: (id: string | null) => services.find((s) => s.id === id)?.name ?? '…',
    class: (id: string | null) => classes.find((c) => c.id === id)?.name ?? '…',
  };

  const servantScope = (s: ServantLite) => {
    if (!s.church_id) return ROLE_LABELS[s.role];
    const parts = [name.church(s.church_id)];
    if (s.service_id) parts.push(name.service(s.service_id));
    if (s.class_id) parts.push(name.class(s.class_id));
    return `${ROLE_LABELS[s.role]} · ${parts.join(' ← ')}`;
  };

  const scopeLabel = (g: ModuleAccess) => {
    if (isPersonGrant(g)) {
      const s = servantById.get(g.servant_id!);
      return s ? `${s.full_name} — ${servantScope(s)}` : 'خادم …';
    }
    if (g.church_id === null) return 'كل الكنائس';
    if (g.service_id === null) return `${name.church(g.church_id)} ← كل الخدمات`;
    if (g.class_id === null) return `${name.church(g.church_id)} ← ${name.service(g.service_id)} ← كل الفصول`;
    return `${name.church(g.church_id)} ← ${name.service(g.service_id)} ← ${name.class(g.class_id)}`;
  };

  const ScopeIcon = (g: ModuleAccess) =>
    isPersonGrant(g) ? User : g.church_id === null ? Globe : g.service_id === null ? ChurchIcon : g.class_id === null ? Layers : School;

  const removeGrant = useCallback(async (g: ModuleAccess) => {
    setError('');
    setBusy(g.id);
    const { error: err } = await supabase.from('module_access').delete().eq('id', g.id);
    if (err) setError('تعذر حذف الصلاحية — تأكد من تشغيل الترحيل 0024');
    await reload();
    setBusy(null);
  }, [supabase, reload]);

  const hideAll = useCallback(async (m: AppModule) => {
    if (!confirm(`إخفاء وحدة «${m.label}» عن جميع الخدام؟ ستبقى ظاهرة لك فقط.`)) return;
    setError('');
    setBusy(m.key);
    const { error: err } = await supabase.from('module_access').delete().eq('module_key', m.key);
    if (err) setError('تعذر الحذف — تأكد من تشغيل الترحيل 0024');
    await reload();
    setBusy(null);
  }, [supabase, reload]);

  const showAll = useCallback(async (m: AppModule) => {
    setError('');
    setBusy(m.key);
    // one global grant replaces every narrower SCOPE one (person grants stay — harmless)
    await supabase.from('module_access').delete().eq('module_key', m.key).is('servant_id', null);
    const { error: err } = await supabase.from('module_access').insert({
      module_key: m.key, church_id: null, service_id: null, class_id: null, created_by: profile?.id,
    });
    if (err) setError('تعذر الحفظ — تأكد من تشغيل الترحيل 0024');
    await reload();
    setBusy(null);
  }, [supabase, reload, profile?.id]);

  return (
    <AppShell>
      <OwnerGate>
        <section className="mb-4 flex items-center gap-2">
          <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Layers className="h-5 w-5 text-primary-600" />
            صلاحيات الوحدات
            <span className="badge bg-primary-100 text-primary-700">{MODULES.length}</span>
          </h2>
        </section>

        <p className="mb-4 rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700">
          كل صلاحية تربط وحدة بنطاق: كنيسة ← خدمة ← فصل (أي مستوى يمكن أن يكون «الكل»).
          يرى الخادم الوحدة إذا تقاطع نطاقه مع أي صلاحية. وحدة بلا صلاحيات لا تظهر إلا لك.
          ويمكنك أيضاً إظهار الوحدة لـ<b>أشخاص محددين</b> بأسمائهم أينما كانوا — دون باقي خدام نطاقهم.
        </p>

        {error && (
          <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
        ) : (
          <ul className="space-y-4">
            {MODULES.map((m) => {
              const list = byModule.get(m.key) ?? [];
              const scopeList = list.filter((g) => !isPersonGrant(g));
              const personList = list.filter(isPersonGrant);
              const Icon = m.icon;
              const global = scopeList.some((g) => g.church_id === null);
              return (
                <li key={m.key} id={`module-${m.key}`} className="card !p-0 overflow-hidden">
                  {/* module header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-indigo-50">
                    <span className="rounded-xl bg-slate-50 p-2"><Icon className={`h-5 w-5 ${m.color}`} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-sm">{m.label}</p>
                      <p className="text-xs text-slate-400 truncate">{m.desc}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {scopeList.length === 0 && personList.length === 0 ? (
                        <span className="badge bg-slate-100 text-slate-500 flex items-center gap-1">
                          <EyeOff className="h-3 w-3" /> مخفية
                        </span>
                      ) : global ? (
                        <span className="badge bg-emerald-100 text-emerald-700 flex items-center gap-1">
                          <Globe className="h-3 w-3" /> للجميع
                        </span>
                      ) : scopeList.length > 0 ? (
                        <span className="badge bg-primary-100 text-primary-700 flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" /> {scopeList.length} نطاق
                        </span>
                      ) : null}
                      {personList.length > 0 && !global && (
                        <span className="badge bg-violet-100 text-violet-700 flex items-center gap-1">
                          <User className="h-3 w-3" /> {personList.length} شخص
                        </span>
                      )}
                    </div>
                  </div>

                  {/* grants */}
                  {list.length === 0 ? (
                    <p className="px-4 py-4 text-center text-xs font-bold text-slate-400">
                      لا توجد صلاحيات — الوحدة لا تظهر إلا لمالك التطبيق
                    </p>
                  ) : (
                    <ul className="divide-y divide-indigo-50">
                      {[...scopeList, ...personList].map((g) => {
                        const SIcon = ScopeIcon(g);
                        const person = isPersonGrant(g);
                        return (
                          <li key={g.id} className={`flex items-center gap-3 px-4 py-2.5 ${person ? 'bg-violet-50/40' : ''}`}>
                            <SIcon className={`h-4 w-4 shrink-0 ${person ? 'text-violet-500' : 'text-slate-400'}`} />
                            <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-700">{scopeLabel(g)}</span>
                            <button
                              onClick={() => removeGrant(g)}
                              disabled={busy === g.id}
                              aria-label="حذف الصلاحية"
                              className="rounded-xl bg-red-50 p-2 text-red-600 hover:bg-red-100 transition disabled:opacity-50"
                            >
                              {busy === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* actions */}
                  <div className="flex flex-wrap gap-2 px-4 py-3 bg-slate-50/60">
                    <button
                      id={`module-${m.key}-add`}
                      onClick={() => setAdding(m)}
                      className="btn-primary !py-2 !px-3 flex items-center gap-1 text-xs"
                    >
                      <Plus className="h-4 w-4" /> إضافة نطاق
                    </button>
                    <button
                      id={`module-${m.key}-add-person`}
                      onClick={() => setAddingPerson(m)}
                      className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 transition flex items-center gap-1"
                    >
                      <UserPlus className="h-4 w-4" /> أشخاص محددون
                    </button>
                    {!global && (
                      <button
                        onClick={() => showAll(m)}
                        disabled={busy === m.key}
                        className="btn-secondary !py-2 !px-3 flex items-center gap-1 text-xs"
                      >
                        <Eye className="h-4 w-4" /> إظهار للجميع
                      </button>
                    )}
                    {list.length > 0 && (
                      <button
                        onClick={() => hideAll(m)}
                        disabled={busy === m.key}
                        className="mr-auto rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition flex items-center gap-1"
                      >
                        <EyeOff className="h-4 w-4" /> إخفاء عن الجميع
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {adding && (
          <AddGrantModal
            module={adding}
            churches={churches}
            services={services}
            classes={classes}
            existing={(byModule.get(adding.key) ?? []).filter((g) => !isPersonGrant(g))}
            onClose={() => setAdding(null)}
            onSaved={async () => { setAdding(null); await reload(); }}
          />
        )}
        {addingPerson && (
          <AddPersonGrantModal
            module={addingPerson}
            servants={servants}
            servantScope={servantScope}
            existing={(byModule.get(addingPerson.key) ?? []).filter(isPersonGrant)}
            onClose={() => setAddingPerson(null)}
            onSaved={async () => { setAddingPerson(null); await reload(); }}
          />
        )}
      </OwnerGate>
    </AppShell>
  );
}

// ---------- Add grant modal: church → service → class, each may be ALL ----------
function AddGrantModal({
  module, churches, services, classes, existing, onClose, onSaved,
}: {
  module: AppModule;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  existing: ModuleAccess[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [churchId, setChurchId] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');
  const [classId, setClassId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredServices = services.filter((s) => s.church_id === churchId);
  const filteredClasses = classes.filter((c) => c.service_id === serviceId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const row = {
      module_key: module.key,
      church_id: churchId === ALL ? null : churchId,
      service_id: churchId === ALL || serviceId === ALL ? null : serviceId,
      class_id: churchId === ALL || serviceId === ALL || classId === ALL ? null : classId,
      created_by: profile?.id,
    };
    if (!row.church_id && churchId !== ALL) { setError('اختر الكنيسة'); return; }
    if (row.church_id && !row.service_id && serviceId !== ALL) { setError('اختر الخدمة'); return; }
    if (row.service_id && !row.class_id && classId !== ALL) { setError('اختر الفصل'); return; }

    const dup = existing.some(
      (g) => g.church_id === row.church_id && g.service_id === row.service_id && g.class_id === row.class_id
    );
    if (dup) { setError('هذه الصلاحية موجودة بالفعل'); return; }

    setSaving(true);
    const { error: err } = await supabase.from('module_access').insert(row);
    if (err) {
      setError(err.code === '23505' ? 'هذه الصلاحية موجودة بالفعل' : 'تعذر الحفظ — تأكد من تشغيل الترحيل 0024');
      setSaving(false);
      return;
    }
    onSaved();
  };

  const Icon = module.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <Icon className={`h-5 w-5 ${module.color}`} />
            إضافة نطاق — {module.label}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              id="grant-church"
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              <option value={ALL}>✳ كل الكنائس</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {churchId && churchId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
              <select
                id="grant-service"
                className="input-field"
                value={serviceId}
                onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
                required
              >
                <option value="">اختر الخدمة</option>
                <option value={ALL}>✳ كل الخدمات</option>
                {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {churchId !== ALL && serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
              <select
                id="grant-class"
                className="input-field"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                required
              >
                <option value="">اختر الفصل</option>
                <option value={ALL}>✳ كل الفصول</option>
                {filteredClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
            <button id="grant-save" type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              إضافة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Add PERSON grants: pick one or more servants by name ----------
function AddPersonGrantModal({
  module, servants, servantScope, existing, onClose, onSaved,
}: {
  module: AppModule;
  servants: ServantLite[];
  servantScope: (s: ServantLite) => string;
  existing: ModuleAccess[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const already = useMemo(() => new Set(existing.map((g) => g.servant_id!)), [existing]);
  const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const visible = useMemo(() => {
    const nq = norm(q.trim());
    return servants
      .filter((s) => !already.has(s.id))
      .filter((s) => !nq || norm(s.full_name).includes(nq) || s.user_id.toLowerCase().includes(nq))
      .slice(0, 60);
  }, [servants, already, q]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    if (picked.size === 0) { setError('اختر خادماً واحداً على الأقل'); return; }
    setError('');
    setSaving(true);
    const rows = Array.from(picked).map((servant_id) => ({
      module_key: module.key, servant_id, church_id: null, service_id: null, class_id: null, created_by: profile?.id,
    }));
    const { error: err } = await supabase.from('module_access').insert(rows);
    if (err) {
      setError(err.code === '23505' ? 'أحد هؤلاء الخدام مضاف بالفعل' : 'تعذر الحفظ — تأكد من تشغيل ترحيل 20260925130000');
      setSaving(false);
      return;
    }
    onSaved();
  };

  const Icon = module.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <Icon className={`h-5 w-5 ${module.color}`} />
            أشخاص محددون — {module.label}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 rounded-2xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700">
          الخادم المختار يرى الوحدة أينما كان — دون باقي خدام فصله أو خدمته.
        </p>

        <div className="relative mb-2">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="person-grant-search"
            className="input-field !pr-9"
            placeholder="ابحث بالاسم أو الكود..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-50 rounded-2xl border border-slate-100">
          {visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs font-bold text-slate-400">
              {servants.length === 0 ? 'لا يوجد خدام' : already.size > 0 && !q ? 'كل الخدام المطابقين مضافون بالفعل' : 'لا نتائج'}
            </li>
          ) : visible.map((s) => {
            const on = picked.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-right transition ${on ? 'bg-violet-50' : 'hover:bg-slate-50'}`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300'}`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">
                    {s.photo_url ? <Image src={s.photo_url} alt={s.full_name} fill sizes="36px" className="object-cover" /> : <User className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{s.full_name}</span>
                    <span className="block truncate text-[11px] font-bold text-slate-400">{servantScope(s)}{s.status === 'suspended' ? ' · موقوف' : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
          <button id="person-grant-save" type="button" onClick={submit} disabled={saving || picked.size === 0}
            className="btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            إضافة {picked.size > 0 ? `(${picked.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
