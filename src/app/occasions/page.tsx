'use client';

// ---------- OCCASIONS — leader board (لوحة الفعاليات) ----------
// Cards with cover · title · date · place · organizer · seats · counters,
// scoped church → service → class selectors, search, phase filter
// (upcoming / ongoing / past / drafts), realtime on occasions +
// registrations. Permissions come from `occasion_permissions()`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Loader2, Hourglass, CheckCircle2, Ticket, Armchair } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { OccasionsHeader, OccasionCard, Toast } from '@/components/occasions/OccasionBits';
import OccasionFormModal from '@/components/occasions/OccasionFormModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchOccasions, fetchOccasionCounts, fetchOccasionPermissions, occasionPhase,
  isMigrationMissing, MIGRATION_HINT, NO_PERMISSIONS, ZERO_COUNTS,
  type Occasion, type OccasionPermissions, type OccasionCounts,
} from '@/lib/occasions';

type Filter = 'upcoming' | 'past' | 'drafts' | 'all';

export default function OccasionsBoardPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  const [items, setItems] = useState<Occasion[]>([]);
  const [counts, setCounts] = useState<Map<string, OccasionCounts>>(new Map());
  const [perms, setPerms] = useState<OccasionPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [form, setForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const [rows, p] = await Promise.all([
        fetchOccasions(supabase, { church: scope.church, service: scope.service, classes: scope.classes }),
        fetchOccasionPermissions(supabase),
      ]);
      setItems(rows);
      setPerms(p);
      setCounts(await fetchOccasionCounts(supabase, rows.map((r) => r.id)));
      setMigrationMissing(false);
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, scope.church, scope.service, scope.classes]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'occasions-board', [{ table: 'occasions' }, { table: 'occasion_registrations' }], load, { enabled: approved, delayMs: 700 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const now = new Date();
    const list = items.filter((o) => {
      const ph = occasionPhase(o, now);
      const okFilter =
        filter === 'all' ? true :
        filter === 'drafts' ? o.status === 'draft' :
        filter === 'past' ? (ph === 'past' || o.status === 'completed' || o.status === 'cancelled') :
        /* upcoming */ o.status === 'published' && ph !== 'past';
      const okSearch = !s || o.title.toLowerCase().includes(s) || (o.location ?? '').toLowerCase().includes(s) || (o.organizer ?? '').toLowerCase().includes(s);
      return okFilter && okSearch;
    });
    // upcoming: soonest first · others: latest first
    return filter === 'upcoming' ? [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at)) : list;
  }, [items, search, filter]);

  const totals = useMemo(() => {
    const now = new Date();
    const up = items.filter((o) => o.status === 'published' && occasionPhase(o, now) !== 'past');
    const sum = (k: keyof Omit<OccasionCounts, 'occasion_id'>) => up.reduce((s, o) => s + (counts.get(o.id)?.[k] ?? 0), 0);
    return { upcoming: up.length, pending: sum('pending'), confirmed: sum('confirmed'), checked: sum('checked_in') };
  }, [items, counts]);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'upcoming', label: 'القادمة' },
    { value: 'past', label: 'السابقة' },
    { value: 'drafts', label: 'مسودات' },
    { value: 'all', label: 'الكل' },
  ];

  return (
    <AppShell>
      <OccasionsHeader
        badge={<span className="badge bg-cyan-100 text-cyan-700 tabular-nums">{items.length}</span>}
        action={perms.create ? (
          <button id="occ-add" type="button" onClick={() => setForm(true)} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-cyan-600 !to-cyan-500">
            <Plus className="h-4 w-4" /> فعالية
          </button>
        ) : undefined}
      />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>
      )}

      {/* KPIs — upcoming occasions */}
      <section id="occ-kpis" className="mb-3 grid grid-cols-4 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-cyan-600">{totals.upcoming}</p><p className="text-[10px] font-bold text-slate-400">فعالية قادمة</p></div>
        <div className="card !p-2 text-center"><p className="flex items-center justify-center gap-1 text-lg font-extrabold tabular-nums text-amber-600"><Hourglass className="h-3.5 w-3.5" />{totals.pending}</p><p className="text-[10px] font-bold text-slate-400">قيد المراجعة</p></div>
        <div className="card !p-2 text-center"><p className="flex items-center justify-center gap-1 text-lg font-extrabold tabular-nums text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{totals.confirmed}</p><p className="text-[10px] font-bold text-slate-400">مؤكد</p></div>
        <div className="card !p-2 text-center"><p className="flex items-center justify-center gap-1 text-lg font-extrabold tabular-nums text-primary-600"><Ticket className="h-3.5 w-3.5" />{totals.checked}</p><p className="text-[10px] font-bold text-slate-400">سجّل الدخول</p></div>
      </section>

      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="occ-search" className="input-field pr-9" placeholder="ابحث بالعنوان أو المكان أو المنظّم..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ScopeSelectors idPrefix="occ" scope={scope} churches={churches} services={services} classes={classes} />

      <div id="occ-filters" className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
            className={`rounded-full px-3 py-1 text-xs font-extrabold ${filter === f.value ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-cyan-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Armchair className="mx-auto mb-3 h-10 w-10 text-cyan-200" />
          <p className="font-bold">{items.length === 0 ? 'لا توجد فعاليات بعد — أضف أول فعالية' : 'لا نتائج في هذا التصنيف'}</p>
        </div>
      ) : (
        <div id="occ-list" className="grid gap-3 sm:grid-cols-2">
          {visible.map((o) => {
            const c = counts.get(o.id) ?? { occasion_id: o.id, ...ZERO_COUNTS };
            return (
              <OccasionCard key={o.id} id={`occ-item-${o.id}`} o={o} href={`/occasions/${o.id}`} counts={c}
                right={
                  <>
                    {c.pending > 0 && <span className="badge bg-amber-100 text-amber-700"><Hourglass className="h-3 w-3" /> {c.pending}</span>}
                    {c.checked_in > 0 && <span className="badge bg-cyan-100 text-cyan-700"><Ticket className="h-3 w-3" /> {c.checked_in}</span>}
                  </>
                }
              />
            );
          })}
        </div>
      )}

      {form && (
        <OccasionFormModal
          item={null} churches={churches} services={services} classes={classes}
          onClose={() => setForm(false)}
          onSaved={(saved) => { setItems((l) => [saved, ...l]); setForm(false); flash('تمت إضافة الفعالية'); load(); }}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
