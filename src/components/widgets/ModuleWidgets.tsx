'use client';

// ---------- MODULE home widgets — render only when the module is granted ----------
//   OccasionsWidget    — next published occasions (الفعاليات)
//   OnlineLiveWidget   — live / next online class (الفصول الأونلاين)
//   ExamsOpenWidget    — exams open now (الامتحانات)
//   MessagesWidget     — unread conversations (الرسائل)
//   NotificationsWidget— latest inbox items (الإشعارات)
//   StoreRecentWidget  — today's bills (إستبدال النقاط)
//   AchievementsFeedWidget — latest awards (الإنجازات)
// Each widget swallows errors (e.g. migration missing) into an empty state.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Tent, Video, GraduationCap, MessageCircle, Bell, ShoppingBag, Award, MapPin, Users, Radio, ChevronLeft, Megaphone, Receipt,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useAppDate } from '@/lib/app-date-context';
import { useCustomization } from '@/lib/customization-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cairoDayStartISO } from '@/lib/time';
import { fetchOccasions, fetchOccasionCounts, KIND_EMOJI, type Occasion, type OccasionCounts } from '@/lib/occasions';
import { fetchOnlineClasses, PLATFORM_LABELS, type OnlineClass } from '@/lib/online-classes';
import { fetchExams, fetchAttemptStats, examIsOpen, type Exam } from '@/lib/exams';
import { fetchInbox as fetchChatInbox, type ChatConversation } from '@/lib/chat';
import { fetchInbox as fetchNotifInbox, type InboxItem } from '@/lib/notifications';
import { WidgetCard, WidgetEmpty, WidgetSkeleton, Avatar, fmtNum, fmtDayShort, fmtTimeShort, fmtRelative, fmtDur } from './WidgetBits';
import type { WidgetProps } from './CoreWidgets';

// =====================================================================
// Occasions
// =====================================================================
export function OccasionsWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Occasion[] | null>(null);
  const [counts, setCounts] = useState<Map<string, OccasionCounts>>(new Map());
  const max = size === 'half' ? 2 : 3;

  const load = useCallback(async () => {
    try {
      const all = await fetchOccasions(supabase);
      const now = Date.now();
      const up = all
        .filter((o) => o.status === 'published' && new Date(o.ends_at ?? o.starts_at).getTime() >= now - 3_600_000)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, max);
      setRows(up);
      setCounts(await fetchOccasionCounts(supabase, up.map((o) => o.id)));
    } catch { setRows([]); }
  }, [supabase, max]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-occasions', [{ table: 'occasions' }, { table: 'occasion_registrations' }], load, { delayMs: 2000, minIntervalMs: 30_000 });

  return (
    <WidgetCard id="w-occasions" icon={Tent} title={title ?? label('occasions')} tone="cyan" href="/occasions" flush>
      {!rows ? <WidgetSkeleton rows={2} /> : rows.length === 0 ? (
        <WidgetEmpty icon={Tent} text="لا فعاليات قادمة" />
      ) : (
        <ul className="divide-y divide-cyan-50">
          {rows.map((o) => {
            const c = counts.get(o.id);
            const live = new Date(o.starts_at).getTime() <= Date.now();
            return (
              <li key={o.id}>
                <Link href={`/occasions/${o.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-cyan-50/40">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-xl">{KIND_EMOJI[o.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-slate-800">{o.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-400">
                      <span>{fmtDayShort(o.starts_at)} · {fmtTimeShort(o.starts_at)}</span>
                      {o.location && size === 'full' && <span className="flex items-center gap-0.5 truncate"><MapPin className="h-3 w-3" /> {o.location}</span>}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {live ? <span className="badge bg-emerald-100 text-emerald-700">الآن</span> : <span className="badge bg-cyan-50 text-cyan-700">{fmtRelative(o.starts_at)}</span>}
                    {c && <span className="badge bg-slate-100 text-slate-600 tabular-nums"><Users className="h-3 w-3" /> {fmtNum(c.active)}{o.capacity ? ` / ${fmtNum(o.capacity)}` : ''}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Online classes — live now / next
// =====================================================================
export function OnlineLiveWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<OnlineClass[] | null>(null);
  const [liveCount, setLiveCount] = useState<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    try {
      const all = await fetchOnlineClasses(supabase);
      const now = Date.now();
      const live = all.filter((c) => c.status === 'live');
      const next = all.filter((c) => c.status === 'scheduled' && new Date(c.ends_at).getTime() >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const list = [...live, ...next].slice(0, size === 'half' ? 1 : 2);
      setRows(list);
      if (live.length > 0) {
        const { data } = await supabase.from('online_class_participants').select('class_id').in('class_id', live.map((c) => c.id)).limit(2000);
        const m = new Map<string, number>();
        ((data ?? []) as { class_id: string }[]).forEach((r) => m.set(r.class_id, (m.get(r.class_id) ?? 0) + 1));
        setLiveCount(m);
      }
    } catch { setRows([]); }
  }, [supabase, size]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-online', [{ table: 'online_classes' }, { table: 'online_class_participants' }], load, { delayMs: 2000, minIntervalMs: 30_000 });

  const isLive = rows?.some((c) => c.status === 'live');
  return (
    <WidgetCard id="w-online-live" icon={Video} title={title ?? label('online')} tone="red" href="/online" flush
      badge={isLive ? <span className="badge animate-pulse bg-red-500 text-white"><Radio className="h-3 w-3" /> مباشر</span> : undefined}>
      {!rows ? <WidgetSkeleton rows={2} /> : rows.length === 0 ? (
        <WidgetEmpty icon={Video} text="لا فصول أونلاين قادمة" />
      ) : (
        <ul className="divide-y divide-red-50">
          {rows.map((c) => {
            const live = c.status === 'live';
            return (
              <li key={c.id}>
                <Link href={`/online/${c.id}`} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-red-50/40 ${live ? 'bg-red-50/50' : ''}`}>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${live ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <Video className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-slate-800">{c.title}</span>
                    <span className="block text-[11px] font-bold text-slate-400">
                      {PLATFORM_LABELS[c.platform]} · {fmtDayShort(c.starts_at)} {fmtTimeShort(c.starts_at)}
                    </span>
                  </span>
                  {live ? (
                    <span className="badge bg-red-100 text-red-700 tabular-nums"><Users className="h-3 w-3" /> {fmtNum(liveCount.get(c.id) ?? 0)}</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-600">{fmtRelative(c.starts_at)}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Exams open now
// =====================================================================
export function ExamsOpenWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Exam[] | null>(null);
  const [stats, setStats] = useState<Map<string, { total: number; passed: number; inProgress: number }>>(new Map());
  const max = size === 'half' ? 3 : 4;

  const load = useCallback(async () => {
    try {
      const all = await fetchExams(supabase);
      const open = all.filter((x) => examIsOpen(x)).slice(0, max);
      setRows(open);
      setStats(await fetchAttemptStats(supabase, open.map((x) => x.id)));
    } catch { setRows([]); }
  }, [supabase, max]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-exams', [{ table: 'exams' }, { table: 'exam_attempts' }], load, { delayMs: 2500, minIntervalMs: 30_000 });

  return (
    <WidgetCard id="w-exams-open" icon={GraduationCap} title={title ?? label('exams')} tone="violet" href="/exams" flush
      badge={rows && rows.length > 0 ? <span className="badge bg-violet-100 text-violet-700 tabular-nums">{fmtNum(rows.length)} مفتوح</span> : undefined}>
      {!rows ? <WidgetSkeleton rows={2} /> : rows.length === 0 ? (
        <WidgetEmpty icon={GraduationCap} text="لا امتحانات مفتوحة الآن" />
      ) : (
        <ul className="divide-y divide-violet-50">
          {rows.map((x) => {
            const s = stats.get(x.id);
            const left = x.closes_at ? Math.max(0, Math.round((new Date(x.closes_at).getTime() - Date.now()) / 60000)) : null;
            return (
              <li key={x.id}>
                <Link href={`/exams/${x.id}`} className="flex items-center gap-2.5 px-3 py-2 hover:bg-violet-50/40">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold text-slate-800">{x.title}</span>
                    <span className="block text-[10px] font-bold text-slate-400">
                      {s ? `${fmtNum(s.total)} حلّوه · ${fmtNum(s.passed)} نجحوا` : '…'}{left !== null ? ` · يُغلق بعد ${fmtDur(left)}` : ''}
                    </span>
                  </span>
                  {s && s.inProgress > 0 && <span className="badge animate-pulse bg-emerald-100 text-emerald-700 tabular-nums">{fmtNum(s.inProgress)} يحلّ الآن</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Messages — unread conversations
// =====================================================================
export function MessagesWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<{ unread: number; rows: ChatConversation[]; broadcasts: number } | null>(null);
  const max = size === 'half' ? 3 : 4;

  const load = useCallback(async () => {
    try {
      const inbox = await fetchChatInbox(supabase);
      const sorted = [...inbox.conversations].sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.last_at.localeCompare(a.last_at));
      setState({ unread: inbox.total_unread, rows: sorted.slice(0, max), broadcasts: inbox.broadcasts_unread });
    } catch { setState({ unread: 0, rows: [], broadcasts: 0 }); }
  }, [supabase, max]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-messages', [{ table: 'chat_messages' }, { table: 'chat_read_state' }], load, { delayMs: 1500 });

  return (
    <WidgetCard id="w-messages" icon={MessageCircle} title={title ?? label('messages')} tone="sky" href="/messages" flush
      badge={state && state.unread > 0 ? <span className="badge bg-sky-600 text-white tabular-nums">{fmtNum(state.unread)}</span> : undefined}>
      {!state ? <WidgetSkeleton rows={2} /> : state.rows.length === 0 ? (
        <WidgetEmpty icon={MessageCircle} text="لا محادثات بعد" />
      ) : (
        <ul className="divide-y divide-sky-50">
          {state.broadcasts > 0 && (
            <li>
              <Link href="/messages/b" className="flex items-center gap-2.5 bg-sky-50/50 px-3 py-2 hover:bg-sky-50">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700"><Megaphone className="h-4 w-4" /></span>
                <span className="flex-1 text-xs font-extrabold text-slate-800">الإعلانات</span>
                <span className="badge bg-sky-600 text-white tabular-nums">{fmtNum(state.broadcasts)}</span>
              </Link>
            </li>
          )}
          {state.rows.map((c) => {
            const name = c.kind === 'child' ? c.person_name : c.other_name;
            const img = c.kind === 'child' ? c.person_image : c.other_photo;
            return (
              <li key={c.bucket}>
                <Link href={`/messages/${encodeURIComponent(c.bucket)}`} className={`flex items-center gap-2.5 px-3 py-2 hover:bg-sky-50/40 ${c.unread > 0 ? 'bg-sky-50/30' : ''}`}>
                  <Avatar url={img} name={name ?? ''} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${c.unread > 0 ? 'font-extrabold text-slate-900' : 'font-bold text-slate-700'}`}>{name}</span>
                    <span className="block truncate text-[10px] font-bold text-slate-400">{c.last_is_me ? 'أنت: ' : ''}{c.last_body || (c.last_image ? '📷 صورة' : '')}</span>
                  </span>
                  {c.unread > 0 ? <span className="badge bg-sky-600 text-white tabular-nums">{fmtNum(c.unread)}</span> : <span className="text-[10px] font-bold text-slate-300">{fmtRelative(c.last_at)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Notifications — latest inbox
// =====================================================================
export function NotificationsWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<InboxItem[] | null>(null);
  const max = size === 'half' ? 3 : 4;

  const load = useCallback(async () => {
    try { setRows((await fetchNotifInbox(supabase, max)).slice(0, max)); } catch { setRows([]); }
  }, [supabase, max]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-notifs', [{ table: 'notification_recipients' }], load, { delayMs: 1500 });

  const unread = rows?.filter((r) => !r.read_at).length ?? 0;
  return (
    <WidgetCard id="w-notifications" icon={Bell} title={title ?? label('notifications')} tone="indigo" href="/notifications/inbox" flush
      badge={unread > 0 ? <span className="badge bg-indigo-600 text-white tabular-nums">{fmtNum(unread)}</span> : undefined}>
      {!rows ? <WidgetSkeleton rows={2} /> : rows.length === 0 ? (
        <WidgetEmpty icon={Bell} text="لا إشعارات" />
      ) : (
        <ul className="divide-y divide-indigo-50">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={n.link_url ?? '/notifications/inbox'} className={`flex items-start gap-2.5 px-3 py-2 hover:bg-indigo-50/40 ${!n.read_at ? 'bg-indigo-50/30' : ''}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.read_at ? 'bg-indigo-500' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-extrabold text-slate-800">{n.title}</span>
                  <span className="block truncate text-[10px] font-bold text-slate-400">{n.body}</span>
                </span>
                <span className="shrink-0 text-[10px] font-bold text-slate-300">{fmtRelative(n.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Store — today's bills
// =====================================================================
interface OrderRow { id: string; total_points: number; items_count: number; created_at: string; status: string; person: { name: string; image_url: string | null } | null }

export function StoreRecentWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const { now } = useAppDate();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<{ count: number; points: number; rows: OrderRow[] } | null>(null);
  const max = size === 'half' ? 2 : 4;

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('store_orders')
        .select('id, total_points, items_count, created_at, status, person:persons(name, image_url)')
        .gte('created_at', cairoDayStartISO(now()))
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as OrderRow[]).filter((r) => r.status === 'completed');
      setState({ count: rows.length, points: rows.reduce((s, r) => s + r.total_points, 0), rows: rows.slice(0, max) });
    } catch { setState({ count: 0, points: 0, rows: [] }); }
  }, [supabase, now, max]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-store', [{ table: 'store_orders' }], load, { delayMs: 1500, minIntervalMs: 30_000 });

  return (
    <WidgetCard id="w-store-recent" icon={ShoppingBag} title={title ?? label('store')} subtitle="فواتير اليوم" tone="orange" href="/store" flush
      badge={state ? <span className="badge bg-orange-100 text-orange-700 tabular-nums"><Receipt className="h-3 w-3" /> {fmtNum(state.count)} · {fmtNum(state.points)} نقطة</span> : undefined}>
      {!state ? <WidgetSkeleton rows={2} /> : state.rows.length === 0 ? (
        <WidgetEmpty icon={ShoppingBag} text="لا فواتير اليوم" hint="افتح متجراً ثم الكاشير لبدء عملية" />
      ) : (
        <>
          <ul className="divide-y divide-orange-50">
            {state.rows.map((o) => (
              <li key={o.id} className="flex items-center gap-2.5 px-3 py-2">
                <Avatar url={o.person?.image_url} name={o.person?.name ?? ''} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-extrabold text-slate-800">{o.person?.name ?? '—'}</span>
                  <span className="block text-[10px] font-bold text-slate-400">{fmtNum(o.items_count)} صنف · {fmtTimeShort(o.created_at)}</span>
                </span>
                <span className="badge bg-orange-100 text-orange-700 tabular-nums">−{fmtNum(o.total_points)}</span>
              </li>
            ))}
          </ul>
          <Link href="/store" className="flex items-center justify-center gap-1 bg-orange-50/60 py-2 text-[11px] font-extrabold text-orange-700 hover:bg-orange-50">
            المتاجر <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Achievements feed — latest awards
// =====================================================================
interface AwardRow { id: string; points_awarded: number; awarded_at: string; source: string; person: { name: string; image_url: string | null } | null; achievement: { name: string; image_url: string | null } | null }

export function AchievementsFeedWidget({ title, size }: WidgetProps) {
  const { label } = useCustomization();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<AwardRow[] | null>(null);
  const max = size === 'half' ? 3 : 5;

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('user_achievements')
        .select('id, points_awarded, awarded_at, source, person:persons(name, image_url), achievement:achievements(name, image_url)')
        .order('awarded_at', { ascending: false })
        .limit(max);
      if (error) throw error;
      setRows((data ?? []) as unknown as AwardRow[]);
    } catch { setRows([]); }
  }, [supabase, max]);
  useEffect(() => { if (profile) load(); }, [load, profile]);
  useDebouncedRealtime(supabase, 'w-awards', [{ table: 'user_achievements' }], load, { delayMs: 1500, minIntervalMs: 30_000 });

  return (
    <WidgetCard id="w-achievements-feed" icon={Award} title={title ?? label('achievements')} tone="amber" href="/achievements" flush>
      {!rows ? <WidgetSkeleton rows={2} /> : rows.length === 0 ? (
        <WidgetEmpty icon={Award} text="لا إنجازات ممنوحة بعد" />
      ) : (
        <ul className="divide-y divide-amber-50">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 px-3 py-2">
              <Avatar url={a.person?.image_url} name={a.person?.name ?? ''} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-extrabold text-slate-800">{a.person?.name ?? '—'}</span>
                <span className="block truncate text-[10px] font-bold text-slate-400">🏆 {a.achievement?.name ?? '—'} · {fmtRelative(a.awarded_at)}</span>
              </span>
              {a.points_awarded > 0 && <span className="badge bg-gold-100 text-gold-700 tabular-nums">+{fmtNum(a.points_awarded)}</span>}
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
