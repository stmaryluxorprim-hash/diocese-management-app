'use client';

// ---------- BIRTHDAYS MODULE — month view (أعياد الميلاد) ----------
// Who has a birthday this month, DAY BY DAY. ◀ ▶ changes the month (and
// year), church → service → class narrow the list. Per child: call, WhatsApp
// / SMS with the greeting template, gift of points, birthday card (share /
// print), greeting log. Bulk: WhatsApp / SMS ALL not-yet-greeted children
// one after another, gift ALL, print cards for the month (→ /birthdays/cards).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight, ChevronLeft, Loader2, Phone, MessageSquare, Gift, IdCard, Cake, Search, Filter,
  CalendarPlus, FileSpreadsheet, Users, Sparkles, Printer, MessageSquareText, Star, ChevronDown,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useAppDate } from '@/lib/app-date-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cairoParts } from '@/lib/time';
import { ARABIC_MONTHS } from '@/lib/card-types';
import type { CardConstantsData } from '@/components/cards/CardCanvas';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { BirthdayHeader, PersonAvatar, GreetingChips, WhatsAppIcon, Toast } from '@/components/birthdays/BirthdayBits';
import { ComposeGreetingModal, GreetingLogModal, GiftModal, BirthdayCardModal } from '@/components/birthdays/BirthdayModals';
import {
  type BirthdayRow, type BirthdayCardTemplate, type BirthdaySettings,
  fetchBirthdaysInMonth, fetchBirthdayTemplates, fetchBirthdaySettings, effectiveSettings, templateFor,
  logGreeting, giveBirthdayGift, fillBirthdayTemplate, waNumber, weekdayLabel, wasContacted, hasGreeting,
  isMigrationMissing, MIGRATION_HINT, birthdayErrorMessage, buildBirthdaysICS, downloadText, firstName,
} from '@/lib/birthdays';

type Channel = 'whatsapp' | 'sms';
type Filt = 'all' | 'not_greeted' | 'greeted' | 'no_gift' | 'no_phone';
const FILTERS: { value: Filt; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'not_greeted', label: 'لم يُهنَّأ' },
  { value: 'greeted', label: 'هُنِّئ' },
  { value: 'no_gift', label: 'بلا هدية' },
  { value: 'no_phone', label: 'بلا هاتف' },
];

const LS_TEMPLATE = 'bd_message_template';
const LS_CHANNEL = 'bd_message_channel';

export default function BirthdaysMonthPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const { now } = useAppDate();

  // ---------- month / year ----------
  const initial = cairoParts(now());
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const today = cairoParts(now());
  const isCurrentMonth = today.year === year && today.month === month;

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1); };
  const goToday = () => { setYear(today.year); setMonth(today.month); };

  // ---------- scope ----------
  const enabled = profile?.status === 'approved';
  const scope = useScopeState();
  const { churches, services, classes } = useStoreLookups(supabase, enabled);

  // ---------- data ----------
  const [rows, setRows] = useState<BirthdayRow[] | null>(null);
  const [templates, setTemplates] = useState<BirthdayCardTemplate[]>([]);
  const [settings, setSettings] = useState<BirthdaySettings[]>([]);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    try {
      const [r, t, s] = await Promise.all([
        fetchBirthdaysInMonth(supabase, year, month, { church: scope.church, service: scope.service, classes: scope.classes }),
        fetchBirthdayTemplates(supabase),
        fetchBirthdaySettings(supabase),
      ]);
      setRows(r); setTemplates(t); setSettings(s);
    } catch (e) {
      if (isMigrationMissing(e)) setMigrationMissing(true);
      setRows([]);
    }
  }, [supabase, year, month, scope.church, scope.service, scope.classes]);

  useEffect(() => { if (enabled) { setRows(null); load(); } }, [enabled, load]);
  useDebouncedRealtime(
    supabase, 'birthdays-month',
    [{ table: 'birthday_greetings' }, { table: 'birthday_card_templates' }, { table: 'birthday_settings' }, { table: 'persons' }],
    load, { enabled }
  );

  // ---------- message template (per device, seeded from settings) ----------
  const churchForSettings = scope.church !== 'all' ? scope.church : profile?.church_id ?? null;
  const eff = useMemo(() => effectiveSettings(settings, churchForSettings), [settings, churchForSettings]);
  const [template, setTemplate] = useState('');
  const [channel, setChannel] = useState<Channel>('whatsapp');
  useEffect(() => {
    const t = localStorage.getItem(LS_TEMPLATE);
    const c = localStorage.getItem(LS_CHANNEL) as Channel | null;
    if (t) setTemplate(t);
    if (c === 'sms' || c === 'whatsapp') setChannel(c);
  }, []);
  useEffect(() => { if (!template && eff.message_template) setTemplate(eff.message_template); }, [eff.message_template, template]);
  const saveTemplate = (t: string) => { setTemplate(t); localStorage.setItem(LS_TEMPLATE, t); };
  const pickChannel = (c: Channel) => { setChannel(c); localStorage.setItem(LS_CHANNEL, c); };

  // ---------- filters / search ----------
  const [search, setSearch] = useState('');
  const [filt, setFilt] = useState<Filt>('all');
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim();
    return (rows ?? []).filter((r) => {
      if (s && !r.name.includes(s) && !(r.phone ?? '').includes(s) && !r.national_id.includes(s)) return false;
      switch (filt) {
        case 'not_greeted': return r.greetings.length === 0;
        case 'greeted': return r.greetings.length > 0;
        case 'no_gift': return r.gift_points == null;
        case 'no_phone': return !r.phone;
        default: return true;
      }
    });
  }, [rows, search, filt]);

  // group by day
  const byDay = useMemo(() => {
    const m = new Map<number, BirthdayRow[]>();
    filtered.forEach((r) => { const l = m.get(r.birth_day) ?? []; l.push(r); m.set(r.birth_day, l); });
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      greeted: all.filter((r) => r.greetings.length > 0).length,
      gifted: all.filter((r) => r.gift_points != null).length,
      today: isCurrentMonth ? all.filter((r) => r.birth_day === today.day).length : 0,
    };
  }, [rows, isCurrentMonth, today.day]);

  // ---------- helpers ----------
  const namesFor = useCallback((r: BirthdayRow) => ({
    church: churches.find((c) => c.id === r.church_id)?.name ?? '',
    service: services.find((s) => s.id === r.service_id)?.name ?? '',
    class: classes.find((c) => c.id === r.class_id)?.name ?? '',
  }), [churches, services, classes]);

  const constantsFor = useCallback((r: BirthdayRow): CardConstantsData => {
    const n = namesFor(r);
    return {
      church_name: n.church, service_name: n.service, class_name: n.class,
      church_logo_url: churches.find((c) => c.id === r.church_id)?.logo_url ?? null,
      service_logo_url: services.find((s) => s.id === r.service_id)?.photo_url ?? null,
      class_logo_url: classes.find((c) => c.id === r.class_id)?.photo_url ?? null,
    };
  }, [namesFor, churches, services, classes]);

  const giftDefault = (r: BirthdayRow) => effectiveSettings(settings, r.church_id).gift_points;
  const canCancelGift = !!profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  // optimistic: append a greeting locally so the chips update instantly
  const patchGreeting = (r: BirthdayRow, kind: BirthdayRow['greetings'][number]['kind'], message: string | null, points: number | null = null) => {
    setRows((prev) => prev?.map((x) => x.person_id === r.person_id
      ? { ...x, gift_points: kind === 'gift' ? points : x.gift_points,
          greetings: [{ id: `tmp-${Date.now()}`, kind, created_at: new Date().toISOString(), points, message, recorded_by: profile?.id ?? null, recorded_by_name: profile?.full_name ?? null }, ...x.greetings] }
      : x) ?? prev);
  };

  // ---------- actions: one child ----------
  const call = (r: BirthdayRow) => {
    if (!r.phone) return;
    logGreeting(supabase, r, year, 'call', null, profile?.id).catch(() => {});
    patchGreeting(r, 'call', null);
    window.location.href = `tel:${r.phone}`;
  };

  const messageUrl = (r: BirthdayRow, ch: Channel) => {
    const text = template.trim() ? fillBirthdayTemplate(template, r, namesFor(r), r.gift_points) : '';
    if (ch === 'whatsapp') return text ? `https://wa.me/${waNumber(r.phone!)}?text=${encodeURIComponent(text)}` : `https://wa.me/${waNumber(r.phone!)}`;
    return text ? `sms:${r.phone}?body=${encodeURIComponent(text)}` : `sms:${r.phone}`;
  };

  const message = (r: BirthdayRow, ch: Channel = channel) => {
    if (!r.phone) return;
    const text = template.trim() ? fillBirthdayTemplate(template, r, namesFor(r), r.gift_points) : null;
    logGreeting(supabase, r, year, ch, text, profile?.id).catch(() => {});
    patchGreeting(r, ch, text);
    const url = messageUrl(r, ch);
    if (ch === 'whatsapp') window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.href = url;
  };

  // ---------- modals ----------
  const [composeOpen, setComposeOpen] = useState(false);
  const [logRow, setLogRow] = useState<BirthdayRow | null>(null);
  const [giftRow, setGiftRow] = useState<BirthdayRow | null>(null);
  const [cardRow, setCardRow] = useState<BirthdayRow | null>(null);
  const [cardTemplate, setCardTemplate] = useState<BirthdayCardTemplate | null>(null);
  const openCard = (r: BirthdayRow) => { setCardRow(r); setCardTemplate(templateFor(templates, r)); };
  // keep the modal rows fresh after realtime reload
  const liveRow = (r: BirthdayRow | null) => (r ? rows?.find((x) => x.person_id === r.person_id) ?? r : null);

  // ---------- bulk: message everyone not yet messaged, one by one ----------
  const [bulk, setBulk] = useState<{ queue: BirthdayRow[]; index: number; ch: Channel } | null>(null);
  const startBulk = (ch: Channel) => {
    const queue = filtered.filter((r) => r.phone && !hasGreeting(r, [ch]));
    if (queue.length === 0) { flash('لا يوجد مخدوم بهاتف لم تُرسل له بعد'); return; }
    setBulk({ queue, index: 0, ch });
  };
  const bulkSend = () => {
    if (!bulk) return;
    const r = bulk.queue[bulk.index];
    message(r, bulk.ch);
    if (bulk.index + 1 >= bulk.queue.length) { setBulk(null); flash(`تم إرسال التهنئة لـ ${bulk.queue.length} مخدوم ✓`); }
    else setBulk({ ...bulk, index: bulk.index + 1 });
  };
  const bulkSkip = () => {
    if (!bulk) return;
    if (bulk.index + 1 >= bulk.queue.length) setBulk(null);
    else setBulk({ ...bulk, index: bulk.index + 1 });
  };

  // ---------- bulk: gift everyone without a gift ----------
  const [gifting, setGifting] = useState(false);
  const giftAll = async () => {
    const targets = filtered.filter((r) => r.gift_points == null);
    if (targets.length === 0) { flash('كل المخدومين الظاهرين أخذوا هديتهم'); return; }
    const pts = giftDefault(targets[0]);
    if (!confirm(`إهداء ${pts} نقطة لكل مخدوم لم يأخذ هديته (${targets.length} مخدوم)؟`)) return;
    setGifting(true);
    let ok = 0; let fail = 0;
    for (const r of targets) {
      try { await giveBirthdayGift(supabase, r.enrollment_id, year, giftDefault(r), `هدية عيد ميلاد ${year}`); ok++; }
      catch { fail++; }
    }
    setGifting(false);
    await load();
    flash(`🎁 أُهديت النقاط لـ ${ok} مخدوم${fail ? ` — تعذّر ${fail}` : ''}`);
  };

  // ---------- exports ----------
  const exportICS = () => {
    if (!rows?.length) return;
    downloadText(`birthdays-${year}-${String(month).padStart(2, '0')}.ics`, buildBirthdaysICS(rows, year), 'text/calendar;charset=utf-8');
  };
  const exportExcel = async () => {
    if (!rows?.length) return;
    const XLSX = await import('xlsx');
    const data = rows.map((r) => {
      const n = namesFor(r);
      return {
        'اليوم': r.birth_day, 'الاسم': r.name, 'تاريخ الميلاد': r.birthdate, 'يتمّ': r.turns_age,
        'الهاتف': r.phone ?? '', 'الكنيسة': n.church, 'الخدمة': n.service, 'الفصل': n.class,
        'الرصيد': r.points, 'هدية': r.gift_points ?? '', 'التهاني': r.greetings.map((g) => g.kind).join(', '),
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${ARABIC_MONTHS[month - 1]} ${year}`);
    XLSX.writeFile(wb, `birthdays-${year}-${String(month).padStart(2, '0')}.xlsx`);
  };

  const cardsHref = `/birthdays/cards?year=${year}&month=${month}${scope.church !== 'all' ? `&church=${scope.church}` : ''}${scope.service !== 'all' ? `&service=${scope.service}` : ''}${scope.classes.length > 0 ? `&class=${scope.classes.join(',')}` : ''}`;

  return (
    <AppShell>
      <BirthdayHeader />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>
      )}

      {/* ---------- month navigator ---------- */}
      <section id="bd-month-nav" className="card mb-3 !p-2">
        <div className="flex items-center justify-between">
          <button onClick={prevMonth} aria-label="الشهر السابق" className="rounded-xl p-2 hover:bg-pink-50 active:scale-95">
            <ChevronRight className="h-6 w-6 text-pink-600" />
          </button>
          <div className="text-center">
            <p className="text-xl font-extrabold text-slate-800">{ARABIC_MONTHS[month - 1]} <span className="tabular-nums text-pink-600">{year}</span></p>
            {!isCurrentMonth ? (
              <button onClick={goToday} className="text-[11px] font-extrabold text-pink-600 underline-offset-2 hover:underline">الرجوع للشهر الحالي</button>
            ) : (
              <p className="text-[11px] font-bold text-slate-400">الشهر الحالي</p>
            )}
          </div>
          <button onClick={nextMonth} aria-label="الشهر التالي" className="rounded-xl p-2 hover:bg-pink-50 active:scale-95">
            <ChevronLeft className="h-6 w-6 text-pink-600" />
          </button>
        </div>
        {/* month strip */}
        <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto pb-1">
          {ARABIC_MONTHS.map((mName, i) => (
            <button key={mName} onClick={() => setMonth(i + 1)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold transition ${month === i + 1 ? 'bg-pink-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-pink-50'}`}>
              {mName}
            </button>
          ))}
        </div>
      </section>

      <ScopeSelectors idPrefix="bd" scope={scope} churches={churches} services={services} classes={classes} />

      {/* ---------- stats ---------- */}
      <section id="bd-stats" className="mb-3 grid grid-cols-4 gap-2">
        {[
          { label: 'عيد ميلاد', value: stats.total, icon: Cake },
          { label: 'اليوم', value: isCurrentMonth ? stats.today : '—', icon: Sparkles },
          { label: 'هُنِّئوا', value: stats.greeted, icon: MessageSquare },
          { label: 'هدايا', value: stats.gifted, icon: Gift },
        ].map((k) => (
          <div key={k.label} className="card !p-2 text-center">
            <p className="text-lg font-extrabold tabular-nums text-pink-600">{rows ? k.value : '…'}</p>
            <p className="text-[10px] font-bold text-slate-400">{k.label}</p>
          </div>
        ))}
      </section>

      {/* ---------- greeting text + channel + bulk actions ---------- */}
      <section id="bd-actions" className="card mb-3 !p-3">
        <div className="mb-2 flex items-center gap-2">
          <button onClick={() => setComposeOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-pink-50 px-3 py-2 text-right text-xs font-bold text-pink-800">
            <MessageSquareText className="h-4 w-4 shrink-0" />
            <span className="truncate">{template.trim() || 'اكتب نص التهنئة…'}</span>
          </button>
          <div className="flex rounded-xl bg-slate-100 p-0.5">
            <button onClick={() => pickChannel('whatsapp')} aria-label="واتساب" className={`rounded-lg px-2 py-1.5 ${channel === 'whatsapp' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}><WhatsAppIcon className="h-4 w-4" /></button>
            <button onClick={() => pickChannel('sms')} aria-label="SMS" className={`rounded-lg px-2 py-1.5 ${channel === 'sms' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><MessageSquare className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button id="bd-bulk-message" onClick={() => startBulk(channel)} disabled={!rows?.length}
            className="flex flex-col items-center gap-1 rounded-2xl bg-emerald-600 py-2.5 text-[11px] font-extrabold text-white shadow disabled:opacity-40 active:scale-95">
            {channel === 'whatsapp' ? <WhatsAppIcon className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />} تهنئة الجميع
          </button>
          <button id="bd-bulk-gift" onClick={giftAll} disabled={!rows?.length || gifting}
            className="flex flex-col items-center gap-1 rounded-2xl bg-amber-500 py-2.5 text-[11px] font-extrabold text-white shadow disabled:opacity-40 active:scale-95">
            {gifting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gift className="h-5 w-5" />} هدية للجميع
          </button>
          <Link id="bd-bulk-cards" href={cardsHref}
            className="flex flex-col items-center gap-1 rounded-2xl bg-violet-600 py-2.5 text-[11px] font-extrabold text-white shadow active:scale-95">
            <Printer className="h-5 w-5" /> طباعة الكروت
          </Link>
          <div className="relative">
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-col items-center gap-1 rounded-2xl bg-slate-700 py-2.5 text-[11px] font-extrabold text-white shadow active:scale-95">
                <ChevronDown className="h-5 w-5" /> تصدير
              </summary>
              <div className="absolute left-0 z-20 mt-1 w-44 rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl">
                <button onClick={exportICS} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-slate-50"><CalendarPlus className="h-4 w-4 text-pink-600" /> تقويم (ICS)</button>
                <button onClick={exportExcel} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel</button>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ---------- search + filters ---------- */}
      <section className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="bd-search" className="input-field !py-2 !pr-9 text-sm" placeholder="بحث بالاسم أو الهاتف…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setShowFilters((v) => !v)} className={`flex items-center gap-1 rounded-xl border px-3 text-xs font-extrabold ${filt !== 'all' ? 'border-pink-300 bg-pink-50 text-pink-700' : 'border-slate-200 bg-white text-slate-600'}`}>
          <Filter className="h-4 w-4" /> {FILTERS.find((f) => f.value === filt)?.label}
        </button>
      </section>
      {showFilters && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.value} onClick={() => { setFilt(f.value); setShowFilters(false); }}
              className={`rounded-full px-3 py-1 text-xs font-extrabold ${filt === f.value ? 'bg-pink-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{f.label}</button>
          ))}
        </div>
      )}

      {/* ---------- day by day ---------- */}
      {rows === null ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-pink-500" /></div>
      ) : byDay.length === 0 ? (
        <div className="card py-12 text-center">
          <Cake className="mx-auto mb-2 h-10 w-10 text-pink-200" />
          <p className="font-extrabold text-slate-500">لا توجد أعياد ميلاد {filt !== 'all' || search ? 'مطابقة' : `في ${ARABIC_MONTHS[month - 1]}`}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">في النطاق المحدد</p>
        </div>
      ) : (
        <div id="bd-days" className="flex flex-col gap-3">
          {byDay.map(([day, list]) => {
            const isToday = isCurrentMonth && day === today.day;
            const isPast = year < today.year || (year === today.year && (month < today.month || (month === today.month && day < today.day)));
            return (
              <section key={day} id={`bd-day-${day}`} className={`card !p-0 overflow-hidden ${isToday ? 'ring-2 ring-pink-400' : ''}`}>
                <header className={`flex items-center gap-3 px-3 py-2 ${isToday ? 'bg-pink-600 text-white' : isPast ? 'bg-slate-50 text-slate-500' : 'bg-pink-50 text-pink-800'}`}>
                  <span className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl text-center leading-none ${isToday ? 'bg-white/20' : 'bg-white shadow-sm'}`}>
                    <span className={`text-lg font-extrabold tabular-nums ${isToday ? 'text-white' : 'text-pink-600'}`}>{day}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold">{isToday ? '🎉 اليوم' : weekdayLabel(year, month, day)}</span>
                    <span className={`block text-[11px] font-bold ${isToday ? 'text-pink-100' : 'text-slate-400'}`}>{day} {ARABIC_MONTHS[month - 1]} · {list.length} مخدوم</span>
                  </span>
                </header>
                <ul className="divide-y divide-pink-50">
                  {list.map((r) => {
                    const n = namesFor(r);
                    const contacted = wasContacted(r);
                    return (
                      <li key={r.person_id} id={`bd-row-${r.person_id}`} className={`flex items-center gap-3 px-3 py-2.5 ${contacted ? 'bg-emerald-50/40' : ''}`}>
                        <PersonAvatar url={r.image_url} name={r.name} size={46} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold text-slate-800">{r.name}</p>
                          <p className="truncate text-[11px] font-bold text-slate-400">
                            يتمّ <span className="text-pink-600">{r.turns_age}</span> سنة · {n.class || n.service}
                            {r.enrollments_count > 1 && <span className="text-slate-300"> · {r.enrollments_count} تسجيلات</span>}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <GreetingChips greetings={r.greetings} onClick={() => setLogRow(r)} />
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-gold-600"><Star className="h-3 w-3" />{r.points}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <div className="flex gap-1">
                            <button onClick={() => call(r)} disabled={!r.phone} aria-label="اتصال"
                              className={`rounded-xl p-2 ${hasGreeting(r, ['call']) ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700'} disabled:opacity-30 active:scale-95`}>
                              <Phone className="h-4 w-4" />
                            </button>
                            <button onClick={() => message(r)} disabled={!r.phone} aria-label={channel === 'whatsapp' ? 'واتساب' : 'SMS'}
                              className={`rounded-xl p-2 ${hasGreeting(r, ['whatsapp', 'sms']) ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'} disabled:opacity-30 active:scale-95`}>
                              {channel === 'whatsapp' ? <WhatsAppIcon className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                            </button>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setGiftRow(r)} disabled={r.gift_points != null} aria-label="هدية نقاط"
                              className={`rounded-xl p-2 ${r.gift_points != null ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700'} disabled:opacity-100 active:scale-95`}>
                              <Gift className="h-4 w-4" />
                            </button>
                            <button onClick={() => openCard(r)} aria-label="كارت التهنئة"
                              className={`rounded-xl p-2 ${hasGreeting(r, ['card_printed', 'card_shared']) ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'} active:scale-95`}>
                              <IdCard className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-4 flex items-center gap-2 px-1 text-xs font-bold text-slate-400">
        <Users className="h-3.5 w-3.5" />
        كل مخدوم يظهر مرة واحدة حتى لو كان مسجَّلاً في أكثر من فصل — والتهاني والهدية تُسجَّل له مرة واحدة في السنة.
      </p>

      {/* ---------- bulk send stepper ---------- */}
      {bulk && (
        <div className="fixed inset-x-0 bottom-20 z-[60] mx-auto max-w-md px-4">
          <div className="rounded-3xl bg-slate-900 p-4 text-white shadow-2xl">
            <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-300">
              <span>تهنئة الجميع · {bulk.index + 1} / {bulk.queue.length}</span>
              <button onClick={() => setBulk(null)} className="text-slate-400 hover:text-white">إنهاء</button>
            </div>
            <div className="mb-3 flex items-center gap-3">
              <PersonAvatar url={bulk.queue[bulk.index].image_url} name={bulk.queue[bulk.index].name} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{bulk.queue[bulk.index].name}</p>
                <p className="text-[11px] text-slate-400" dir="ltr">{bulk.queue[bulk.index].phone}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={bulkSend} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-2.5 text-sm font-extrabold active:scale-95">
                {bulk.ch === 'whatsapp' ? <WhatsAppIcon className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                إرسال لـ {firstName(bulk.queue[bulk.index].name)}
              </button>
              <button onClick={bulkSkip} className="rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-bold">تخطّي</button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">يفتح التطبيق محادثة كل مخدوم بدوره بالنص المكتوب — أرسل ثم ارجع هنا للتالي</p>
          </div>
        </div>
      )}

      {/* ---------- modals ---------- */}
      {composeOpen && <ComposeGreetingModal template={template} onSave={saveTemplate} onClose={() => setComposeOpen(false)} />}
      {logRow && (
        <GreetingLogModal
          supabase={supabase} row={liveRow(logRow)!} year={year}
          canCancelGift={canCancelGift} currentUserId={profile?.id}
          onChanged={load}
          onGift={() => { setGiftRow(liveRow(logRow)); setLogRow(null); }}
          onCard={() => { openCard(liveRow(logRow)!); setLogRow(null); }}
          onClose={() => setLogRow(null)}
        />
      )}
      {giftRow && (
        <GiftModal supabase={supabase} row={giftRow} year={year} defaultPoints={giftDefault(giftRow)}
          onDone={(m) => { flash(m); load(); }} onClose={() => setGiftRow(null)} />
      )}
      {cardRow && (
        <BirthdayCardModal
          supabase={supabase} row={liveRow(cardRow)!} year={year}
          template={cardTemplate} templates={templates.filter((t) => t.church_id === cardRow.church_id)}
          onPickTemplate={setCardTemplate}
          constants={constantsFor(cardRow)} currentUserId={profile?.id}
          onLogged={(m) => { flash(m); load(); }} onClose={() => setCardRow(null)}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
