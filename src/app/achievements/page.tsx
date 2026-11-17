'use client';

// ---------- ACHIEVEMENTS — admin list (الإنجازات) ----------
// Picture · name · type · points · scope · award type · status, with
// add / edit / activate-deactivate / delete / view earned users. Scoped
// church → service → class selectors, search, realtime on achievements +
// user_achievements. Permissions come from the existing RBAC through
// `achievement_permissions()` (module grant + role + scope).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Loader2, Pencil, Trash2, Eye, EyeOff, Star, Users, Trophy, CalendarCheck, Repeat, Zap, Hand, Lock,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { AchievementsHeader, AchievementThumb, scopeLabel, scopeKind, Toast } from '@/components/achievements/AchievementBits';
import AchievementFormModal from '@/components/achievements/AchievementFormModal';
import EarnersModal from '@/components/achievements/EarnersModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup } from '@/lib/queries';
import {
  fetchAchievements, fetchAwardCounts, fetchAchievementPermissions, setAchievementActive, deleteAchievement,
  isMigrationMissing, MIGRATION_HINT, achievementErrorMessage, ruleLabel, awardModeLabel, KIND_LABELS, NO_PERMISSIONS,
  type Achievement, type AchievementPermissions,
} from '@/lib/achievements';
import type { AppEvent } from '@/lib/types';
import { collapseGroups, type Grouped } from '@/lib/class-groups';

type Filter = 'all' | 'normal' | 'attendance' | 'inactive';

export default function AchievementsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const scope = useScopeState();

  const [rawItems, setItems] = useState<Achievement[]>([]);
  // rows sharing a group_id are ONE achievement covering several classes
  const items = useMemo(() => collapseGroups(rawItems), [rawItems]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [perms, setPerms] = useState<AchievementPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<{ open: boolean; item: Grouped<Achievement> | null }>({ open: false, item: null });
  const [earnersFor, setEarnersFor] = useState<Grouped<Achievement> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    if (!approved) return;
    cachedLookup<AppEvent>(supabase, 'events').then(setEvents);
  }, [supabase, approved]);

  const load = useCallback(async () => {
    try {
      const [rows, p] = await Promise.all([
        fetchAchievements(supabase, { church: scope.church, service: scope.service, classes: scope.classes }),
        fetchAchievementPermissions(supabase),
      ]);
      setItems(rows);
      setPerms(p);
      setCounts(await fetchAwardCounts(supabase, rows.map((r) => r.id)));
      setMigrationMissing(false);
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, scope.church, scope.service, scope.classes]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'achievements-admin', [{ table: 'achievements' }, { table: 'user_achievements' }], load, { enabled: approved, delayMs: 600 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((a) =>
      (filter === 'all' || (filter === 'inactive' ? !a.is_active : a.kind === filter && a.is_active)) &&
      (!s || a.name.toLowerCase().includes(s) || (a.description ?? '').toLowerCase().includes(s))
    );
  }, [items, search, filter]);

  const totals = useMemo(() => ({
    active: items.filter((a) => a.is_active).length,
    attendance: items.filter((a) => a.kind === 'attendance' && a.is_active).length,
    awards: Array.from(counts.values()).reduce((s, n) => s + n, 0),
  }), [items, counts]);

  // awards of an achievement = awards of all its class rows
  const countOf = (a: Grouped<Achievement>) => a.group_rows.reduce((s, r) => s + (counts.get(r.id) ?? 0), 0);
  const inGroup = (a: Grouped<Achievement>, x: Achievement) => (a.group_id ? x.group_id === a.group_id : x.id === a.id);
  const patch = (a: Grouped<Achievement>, p: Partial<Achievement>) => setItems((l) => l.map((x) => (inGroup(a, x) ? { ...x, ...p } : x)));

  const toggleActive = async (a: Grouped<Achievement>) => {
    setBusy(a.id);
    patch(a, { is_active: !a.is_active });
    try { await setAchievementActive(supabase, a.id, !a.is_active, a.group_id); }
    catch (e) { patch(a, { is_active: a.is_active }); flash(achievementErrorMessage(e, 'تعذر التعديل')); }
    finally { setBusy(null); }
  };

  const remove = async (a: Grouped<Achievement>) => {
    const n = countOf(a);
    if (!confirm(`حذف الإنجاز «${a.name}» نهائياً؟${n ? `\nسيُحذف معه سجل ${n} منحة (النقاط الممنوحة تبقى في أرصدة المخدومين).` : ''}`)) return;
    setBusy(a.id);
    try {
      await deleteAchievement(supabase, a.id, a.group_id);
      setItems((l) => l.filter((x) => !inGroup(a, x)));
    } catch (e) { flash(achievementErrorMessage(e, 'تعذر الحذف')); }
    finally { setBusy(null); }
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: 'الكل' },
    { value: 'normal', label: KIND_LABELS.normal },
    { value: 'attendance', label: KIND_LABELS.attendance },
    { value: 'inactive', label: 'غير مفعّل' },
  ];

  return (
    <AppShell>
      <AchievementsHeader badge={<span className="badge bg-amber-100 text-amber-700 tabular-nums">{items.length}</span>} />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>
      )}

      {/* KPIs */}
      <section className="mb-3 grid grid-cols-3 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{totals.active}</p><p className="text-[10px] font-bold text-slate-400">إنجاز مفعّل</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-amber-600">{totals.attendance}</p><p className="text-[10px] font-bold text-slate-400">إنجاز حضور تلقائي</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-primary-600">{totals.awards}</p><p className="text-[10px] font-bold text-slate-400">مرة مُنح</p></div>
      </section>

      {/* search + scope */}
      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="ach-search" className="input-field pr-9" placeholder="ابحث بالاسم أو الوصف..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ScopeSelectors idPrefix="ach" scope={scope} churches={churches} services={services} classes={classes} />

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {perms.create && (
          <button id="ach-add" type="button" onClick={() => setForm({ open: true, item: null })}
            className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-amber-600 !to-amber-500">
            <Plus className="h-4 w-4" /> إضافة إنجاز
          </button>
        )}
        <div id="ach-filters" className="mr-auto flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
              className={`rounded-full px-3 py-1 text-xs font-extrabold ${filter === f.value ? 'bg-amber-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* list */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Trophy className="mx-auto mb-3 h-10 w-10 text-amber-200" />
          <p className="font-bold">{items.length === 0 ? 'لا توجد إنجازات بعد — أضف أول إنجاز' : 'لا نتائج'}</p>
        </div>
      ) : (
        <div id="ach-list" className="card !p-0 overflow-hidden divide-y divide-amber-50">
          {visible.map((a) => {
            const n = countOf(a);
            return (
              <div key={a.id} id={`ach-item-${a.id}`} className={`flex items-start gap-2.5 px-3 py-3 ${!a.is_active ? 'bg-slate-50 opacity-70' : 'bg-white'}`}>
                <AchievementThumb url={a.image_url} name={a.name} size={56} muted={!a.is_active} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">{a.name}</p>
                  {a.description && <p className="truncate text-[11px] text-slate-400">{a.description}</p>}
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">{scopeLabel(a, churches, services, classes, events)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {a.points}</span>
                    <span className={`badge ${a.kind === 'attendance' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>
                      {a.kind === 'attendance' ? <Zap className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
                      {KIND_LABELS[a.kind]}{a.kind === 'attendance' && ` · ${ruleLabel(a)}`}
                    </span>
                    <span className="badge bg-slate-100 text-slate-600">{scopeKind(a)}</span>
                    <span className="badge bg-violet-100 text-violet-700">
                      {a.award_mode === 'multiple' ? <Repeat className="h-3 w-3" /> : <CalendarCheck className="h-3 w-3" />}
                      {awardModeLabel(a)}
                    </span>
                    {!a.is_active && <span className="badge bg-slate-200 text-slate-600"><Lock className="h-3 w-3" /> غير مفعّل</span>}
                    <button type="button" id={`ach-earners-${a.id}`} onClick={() => setEarnersFor(a)}
                      className="badge bg-amber-100 text-amber-700 hover:bg-amber-200">
                      <Users className="h-3 w-3" /> {n} حصلوا عليه
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {perms.edit && (
                    <button type="button" aria-label="تعديل" onClick={() => setForm({ open: true, item: a })} className="rounded-full bg-primary-50 p-2 text-primary-600 hover:bg-primary-100"><Pencil className="h-4 w-4" /></button>
                  )}
                  {perms.edit && (
                    <button type="button" aria-label={a.is_active ? 'إيقاف' : 'تفعيل'} title={a.is_active ? 'إيقاف' : 'تفعيل'} disabled={busy === a.id} onClick={() => toggleActive(a)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                      {a.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                  {perms.delete && (
                    <button type="button" aria-label="حذف" disabled={busy === a.id} onClick={() => remove(a)} className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form.open && (
        <AchievementFormModal
          item={form.item} churches={churches} services={services} classes={classes} events={events}
          onClose={() => setForm({ open: false, item: null })}
          onSaved={() => {
            setForm({ open: false, item: null });
            load();
            flash(form.item ? 'تم حفظ التعديلات' : 'تمت إضافة الإنجاز');
          }}
        />
      )}
      {earnersFor && <EarnersModal achievement={earnersFor} onClose={() => setEarnersFor(null)} onChanged={load} />}
      <Toast msg={toast} />
    </AppShell>
  );
}
