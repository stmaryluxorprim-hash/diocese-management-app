'use client';

// ---------- OWNER MODULE → ملفات الصلاحيات (permission profiles, 0037) ----------
// The owner composes named PERMISSION PROFILES out of the permission
// registry (src/lib/permissions.ts). Managers then connect servants to these
// profiles from إدارة الخدام (the `permissions` table). Realtime everywhere.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, KeyRound, Plus, X, Trash2, Loader2, Pencil, Save, Users, CheckSquare, Square, Check,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { createClient } from '@/lib/supabase/client';
import { usePermissions } from '@/lib/permissions-context';
import {
  PERMISSION_GROUPS, PERMISSIONS, PERMISSION_ICONS, permissionsOfGroup, permissionLabel, LEGACY_ACTIVITY_KEYS,
} from '@/lib/permissions';
import type { PermissionProfile } from '@/lib/types';

const COLORS = ['#1e3a8a', '#7c3aed', '#0f766e', '#b45309', '#be123c', '#0e7490', '#4d7c0f', '#6d28d9', '#c2410c', '#334155'];

export default function OwnerPermissionsPage() {
  const [supabase] = useState(() => createClient());
  const { profiles, grants, loading, reload } = usePermissions();
  const [editing, setEditing] = useState<PermissionProfile | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // how many servants hold each profile (owner sees every grant)
  const holders = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of grants) m.set(g.permission_profile_id, (m.get(g.permission_profile_id) ?? 0) + 1);
    return m;
  }, [grants]);

  const remove = async (p: PermissionProfile) => {
    const n = holders.get(p.id) ?? 0;
    if (!window.confirm(`حذف ملف الصلاحيات «${p.name}»؟${n ? ` سيُزال من ${n} خادم.` : ''}`)) return;
    setBusy(p.id);
    await supabase.from('permission_profiles').delete().eq('id', p.id);
    await reload();
    setBusy(null);
  };

  return (
    <AppShell>
      <OwnerGate>
        <section className="mb-4 flex items-center gap-2">
          <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex flex-1 items-center gap-2 text-lg font-extrabold">
            <KeyRound className="h-5 w-5 text-violet-600" />
            ملفات الصلاحيات
            <span className="badge bg-violet-100 text-violet-700">{profiles.length}</span>
          </h2>
          <button id="pp-add" onClick={() => setEditing('new')} className="btn-primary flex items-center gap-1 !py-2 !px-3 text-sm">
            <Plus className="h-4 w-4" /> ملف جديد
          </button>
        </section>

        <p className="mb-4 rounded-2xl bg-violet-50 px-4 py-3 text-xs font-bold text-violet-700 leading-relaxed">
          ملف الصلاحيات = مجموعة صلاحيات باسم (مثل «خادم فصل»، «كاشير»، «مسؤول حضور»).
          المديرون يربطون كل خادم بملف أو أكثر من <Link href="/servants" className="underline">إدارة الخدام</Link> أو عند قبول طلبه —
          وتظهر الصلاحية للخادم فوراً.
        </p>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
        ) : profiles.length === 0 ? (
          <div className="card py-12 text-center text-slate-400">
            <KeyRound className="mx-auto mb-3 h-10 w-10" />
            <p className="font-bold">لا توجد ملفات صلاحيات بعد</p>
            <button onClick={() => setEditing('new')} className="btn-primary mt-4 inline-flex items-center gap-1 !py-2 !px-4 text-sm">
              <Plus className="h-4 w-4" /> أنشئ أول ملف
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {profiles.map((p) => (
              <li key={p.id} className="card">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow" style={{ backgroundColor: p.color }}>
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold">{p.name}</p>
                    {p.description && <p className="text-xs text-slate-500">{p.description}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                      <span className="badge bg-slate-100 text-slate-600">{p.permissions.length} صلاحية</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {holders.get(p.id) ?? 0} خادم</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.permissions.slice(0, 8).map((k) => (
                        <span key={k} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">
                          {permissionLabel(k)}
                        </span>
                      ))}
                      {p.permissions.length > 8 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">+{p.permissions.length - 8}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                  <button onClick={() => setEditing(p)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-50 py-2 text-xs font-bold text-primary-600 hover:bg-primary-100 transition">
                    <Pencil className="h-3.5 w-3.5" /> تعديل
                  </button>
                  <button onClick={() => remove(p)} disabled={busy === p.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition">
                    {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} حذف
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing && (
          <ProfileModal
            profile={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await reload(); }}
          />
        )}
      </OwnerGate>
    </AppShell>
  );
}

function ProfileModal({
  profile, onClose, onSaved,
}: {
  profile: PermissionProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(profile?.name ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [color, setColor] = useState(profile?.color ?? COLORS[0]);
  // Legacy coarse activity keys (saved before 20260925130000) are expanded
  // to their fine keys when the profile is opened, so the owner sees and
  // saves the granular form.
  const [keys, setKeys] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const k of profile?.permissions ?? []) {
      if (LEGACY_ACTIVITY_KEYS[k]) PERMISSIONS.filter((p) => p.key.startsWith(`${k}.`)).forEach((p) => s.add(p.key));
      else s.add(k);
    }
    return s;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (k: string) => setKeys((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleGroup = (g: string) => {
    const ks = permissionsOfGroup(g).map((p) => p.key);
    const all = ks.every((k) => keys.has(k));
    setKeys((s) => { const n = new Set(s); ks.forEach((k) => (all ? n.delete(k) : n.add(k))); return n; });
  };

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('اكتب اسم الملف');
    if (keys.size === 0) return setError('اختر صلاحية واحدة على الأقل');
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      color,
      permissions: PERMISSIONS.filter((p) => keys.has(p.key)).map((p) => p.key),
    };
    const { error: err } = profile
      ? await supabase.from('permission_profiles').update(payload).eq('id', profile.id)
      : await supabase.from('permission_profiles').insert(payload);
    setSaving(false);
    if (err) return setError(err.message.includes('uq_permission_profiles_name') || err.message.includes('duplicate') ? 'يوجد ملف بهذا الاسم' : 'تعذر الحفظ');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <KeyRound className="h-5 w-5 text-violet-600" /> {profile ? 'تعديل ملف الصلاحيات' : 'ملف صلاحيات جديد'}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <input id="pp-name" className="input-field" placeholder="اسم الملف * (مثال: خادم فصل)" value={name} onChange={(e) => setName(e.target.value)} />
          <input id="pp-desc" className="input-field" placeholder="وصف مختصر (اختياري)" value={description} onChange={(e) => setDescription(e.target.value)} />

          <div>
            <p className="mb-1 text-xs font-bold text-slate-500">اللون</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full ring-2 transition ${color === c ? 'ring-slate-800 scale-110' : 'ring-transparent'}`}
                  style={{ backgroundColor: c }}>
                  {color === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>الصلاحيات *</span>
              <span className="badge bg-violet-100 text-violet-700">{keys.size} / {PERMISSIONS.length}</span>
            </p>
            <div className="space-y-2">
              {PERMISSION_GROUPS.map((g) => {
                const ks = permissionsOfGroup(g.key);
                const on = ks.filter((p) => keys.has(p.key)).length;
                const GIcon = g.icon;
                return (
                  <div key={g.key} className="rounded-2xl border border-slate-100">
                    <button type="button" onClick={() => toggleGroup(g.key)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-right">
                      {on === ks.length ? <CheckSquare className="h-4 w-4 text-violet-600" /> : <Square className={`h-4 w-4 ${on ? 'text-violet-400' : 'text-slate-300'}`} />}
                      <GIcon className={`h-4 w-4 ${g.color}`} />
                      <span className="flex-1 text-sm font-extrabold">{g.label}</span>
                      <span className="text-[11px] font-bold text-slate-400">{on}/{ks.length}</span>
                    </button>
                    <ul className="divide-y divide-slate-50 border-t border-slate-100">
                      {ks.map((p) => {
                        const Icon = PERMISSION_ICONS[p.key] ?? KeyRound;
                        const checked = keys.has(p.key);
                        return (
                          <li key={p.key}>
                            <button type="button" onClick={() => toggle(p.key)} aria-pressed={checked}
                              className={`flex w-full items-start gap-2 px-3 py-2 text-right transition ${checked ? 'bg-violet-50/60' : 'hover:bg-slate-50'}`}>
                              {checked ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
                              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-bold">{p.label}</span>
                                <span className="block text-[11px] text-slate-400">{p.desc}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button id="pp-save" onClick={save} disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            {profile ? 'حفظ التعديلات' : 'إنشاء الملف'}
          </button>
        </div>
      </div>
    </div>
  );
}
