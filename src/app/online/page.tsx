'use client';

// ---------- ONLINE CLASSES HUB (الفصول الأونلاين) ----------
// Every online class in the caller's scope (RLS): live first, then upcoming,
// then past. Scope selectors + status filter + search. «فصل جديد» opens the
// form; tapping a class opens its control room.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Loader2, Video, ChevronLeft, Users, Clock, CalendarClock, ShieldCheck, CheckCircle2, Radio,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OnlineHeader, StatusBadge, PlatformBadge, scopeLabel, fmtDateTime, fmtTime } from '@/components/online/OnlineBits';
import ClassFormModal from '@/components/online/ClassFormModal';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchOnlineClasses, fetchParticipantCounts, isMigrationMissing, MIGRATION_HINT, CLASS_STATUS_LABELS, rulesLabel, classPhase,
  type OnlineClass, type OnlineClassStatus,
} from '@/lib/online-classes';

type Filter = 'all' | OnlineClassStatus;

export default function OnlineHubPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  const [rows, setRows] = useState<OnlineClass[]>([]);
  const [counts, setCounts] = useState<Map<string, { entered: number; present: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchOnlineClasses(supabase, { church: scope.church, service: scope.service, classes: scope.classes });
      setRows(list);
      setCounts(await fetchParticipantCounts(supabase, list.map((r) => r.id)));
      setMigrationMissing(false);
    } catch (e) {
      if (isMigrationMissing(e)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, scope.church, scope.service, scope.classes]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'online-hub', [{ table: 'online_classes' }, { table: 'online_class_participants' }], load, { enabled: approved, delayMs: 1000 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const order = (c: OnlineClass) => (c.status === 'live' ? 0 : c.status === 'scheduled' ? 1 : c.status === 'ended' ? 2 : 3);
    return rows
      .filter((x) => (filter === 'all' || x.status === filter) && (!s || x.title.toLowerCase().includes(s)))
      .sort((a, b) => {
        const d = order(a) - order(b);
        if (d) return d;
        if (a.status === 'scheduled') return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
      });
  }, [rows, search, filter]);

  const kpis = useMemo(() => {
    let present = 0;
    counts.forEach((c) => { present += c.present; });
    return {
      live: rows.filter((r) => r.status === 'live').length,
      upcoming: rows.filter((r) => r.status === 'scheduled').length,
      ended: rows.filter((r) => r.status === 'ended').length,
      present,
    };
  }, [rows, counts]);

  return (
    <AppShell>
      <OnlineHeader
        back="/settings"
        badge={<span className="badge bg-red-100 text-red-700 tabular-nums">{rows.length}</span>}
        info="أنشئ فصلاً بموعد ورابط بث، ثم اضغط «ابدأ» وقت الدرس. المخدومون يدخلون من بوابتهم؛ أرسل فحوص انتباه وأسئلة مباشرة، وعند «أنهِ» يُحسب الحضور تلقائياً بقواعد الفصل."
        actions={
          <button id="oc-new" type="button" onClick={() => setForm(true)} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-red-600 !to-red-500">
            <Plus className="h-4 w-4" /> فصل جديد
          </button>
        }
      />

      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      <section id="oc-stats" className="mb-3 grid grid-cols-4 gap-2">
        {[
          { label: 'مباشر الآن', value: kpis.live, icon: Radio, tone: 'text-red-600' },
          { label: 'قادم', value: kpis.upcoming, icon: CalendarClock, tone: 'text-sky-600' },
          { label: 'منتهٍ', value: kpis.ended, icon: CheckCircle2, tone: 'text-slate-600' },
          { label: 'حضور مُسجَّل', value: kpis.present, icon: Users, tone: 'text-emerald-600' },
        ].map((k) => (
          <div key={k.label} className="card !p-2 text-center">
            <p className={`text-lg font-extrabold tabular-nums ${k.tone}`}>{loading ? '…' : k.value}</p>
            <p className="text-[10px] font-bold text-slate-400">{k.label}</p>
          </div>
        ))}
      </section>

      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="oc-search" className="input-field pr-9" placeholder="ابحث بعنوان الفصل…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ScopeSelectors idPrefix="oc" scope={scope} churches={churches} services={services} classes={classes} />

      <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar">
        {(['all', 'live', 'scheduled', 'ended', 'cancelled'] as Filter[]).map((s) => (
          <button key={s} type="button" id={`oc-filter-${s}`} onClick={() => setFilter(s)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold transition ${filter === s ? 'bg-red-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
            {s === 'all' ? 'الكل' : CLASS_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-red-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Video className="mx-auto mb-3 h-10 w-10 text-red-200" />
          <p className="font-bold">{rows.length === 0 ? 'لا توجد فصول أونلاين بعد — أنشئ أول فصل' : 'لا نتائج'}</p>
        </div>
      ) : (
        <div id="oc-list" className="space-y-2">
          {visible.map((x) => {
            const c = counts.get(x.id) ?? { entered: 0, present: 0 };
            const phase = classPhase(x);
            return (
              <Link key={x.id} id={`oc-row-${x.id}`} href={`/online/${x.id}`}
                className={`card flex items-center gap-3 !p-3 transition hover:bg-red-50/40 ${x.status === 'live' ? 'ring-2 ring-red-200' : x.status === 'cancelled' ? 'opacity-70' : ''}`}>
                <span className={`rounded-xl p-2.5 ${x.status === 'live' ? 'bg-red-600 text-white' : x.status === 'scheduled' ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                  <Video className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-extrabold">{x.title}</span>
                    <StatusBadge status={x.status} />
                    {phase === 'soon' && <span className="badge bg-amber-100 text-amber-700">يبدأ قريباً</span>}
                    {phase === 'overdue' && <span className="badge bg-amber-100 text-amber-700">تأخر البدء</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-400">{scopeLabel(x, churches, services, classes)}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="badge bg-slate-100 text-slate-600"><Clock className="h-3 w-3" /> {fmtDateTime(x.starts_at)} – {fmtTime(x.ends_at)}</span>
                    <PlatformBadge platform={x.platform} />
                    <span className="badge bg-emerald-50 text-emerald-700" title={rulesLabel(x)}><ShieldCheck className="h-3 w-3" /> {x.min_time_percent}٪ · {x.checks_min_success}/{x.checks_required}</span>
                    {c.entered > 0 && <span className="badge bg-primary-100 text-primary-700"><Users className="h-3 w-3" /> {c.entered} دخل{x.status === 'ended' ? ` · ${c.present} حاضر` : ''}</span>}
                  </span>
                </span>
                <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            );
          })}
        </div>
      )}

      {form && (
        <ClassFormModal
          cls={null} churches={churches} services={services} classes={classes}
          onClose={() => setForm(false)}
          onSaved={(saved) => { setForm(false); router.push(`/online/${saved.id}`); }}
        />
      )}
    </AppShell>
  );
}
