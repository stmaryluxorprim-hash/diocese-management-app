'use client';

// ---------- Child portal shell ----------
// Same look as the main app: gradient header (church logo + church name +
// service name, side menu button) and a 5-tab bottom bar:
// الرئيسية · الحضور · النقاط · البيانات · الخيارات

import { useEffect, useState, type ReactNode } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, CalendarCheck, Star, Database, SlidersHorizontal, Menu, X, LogOut,
  CalendarDays, Clock, User, GraduationCap, MessageCircle, Video, Trophy, Tent, Bell, Library, Cross, UsersRound, ShoppingBag, type LucideIcon,
} from 'lucide-react';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import type { ChildExam, ChildOnlineClass } from '@/lib/child-portal';
import { formatCairoDate, formatCairoTime } from '@/lib/time';
import type { ChildChatOverview } from '@/lib/chat';
import type { ChildAchievements } from '@/lib/achievements';
import { childOccasionHighlights, type ChildOccasion } from '@/lib/occasions';
import type { InboxItem } from '@/lib/notifications';
import { syncPushRegistration, kickDispatcher } from '@/lib/push';
import { useChildConfession } from '@/components/child/ConfessionBits';
import { useChildFamily } from '@/components/child/FamilyBits';
import { Loader2 } from 'lucide-react';
import RefreshButton from '@/components/RefreshButton';
import { SwitchAccountButton } from '@/components/SwitchAccountModal';

export const CHILD_NAV: { href: string; label: string; icon: LucideIcon; id: string }[] = [
  { href: '/child', label: 'الرئيسية', icon: Home, id: 'child-nav-home' },
  { href: '/child/attendance', label: 'الحضور', icon: CalendarCheck, id: 'child-nav-attendance' },
  { href: '/child/points', label: 'النقاط', icon: Star, id: 'child-nav-points' },
  { href: '/child/data', label: 'البيانات', icon: Database, id: 'child-nav-data' },
  { href: '/child/options', label: 'الخيارات', icon: SlidersHorizontal, id: 'child-nav-options' },
];

const isActive = (pathname: string, href: string) =>
  href === '/child' ? pathname === '/child' : pathname.startsWith(href);

/**
 * The child's exams (module الامتحانات, migration 0027) — read from the
 * shared ChildProvider (fetched once for header + menu + pages).
 * `null` while loading; `[]` when the module isn't granted / nothing is
 * published (the menu entry and the home card then stay hidden).
 */
export function useChildExams(): { exams: ChildExam[] | null; openCount: number; pendingCount: number } {
  const { exams } = useChild();
  const open = (exams ?? []).filter((x) => x.is_open);
  return {
    exams,
    openCount: open.length,
    // open exams the child can still sit (never finished or has attempts left)
    pendingCount: open.filter((x) => x.open_attempt_id || (x.attempts_used === 0 && x.total_questions > 0)).length,
  };
}

/**
 * The child's conversations (module الرسائل, migration 0029) — read from the
 * shared ChildProvider: ONE fetch + ONE realtime subscription for the whole
 * portal. `null` while loading; `[]` when the module isn't granted to any of
 * his enrollments (menu entry, header bell and home card stay hidden).
 */
export function useChildMessages(): { conversations: ChildChatOverview[] | null; unread: number; reload: () => void } {
  const { conversations, reloadMessages } = useChild();
  return {
    conversations,
    unread: (conversations ?? []).reduce((a, c) => a + (c.unread ?? 0), 0),
    reload: reloadMessages,
  };
}


/**
 * The child's online classes (module الفصول الأونلاين, migration 0030) — from
 * the shared ChildProvider. `liveCount` = classes live right now.
 */
export function useChildOnline(): { classes: ChildOnlineClass[] | null; liveCount: number; upcomingCount: number } {
  const { onlineClasses } = useChild();
  const list = onlineClasses ?? [];
  return {
    classes: onlineClasses,
    liveCount: list.filter((c) => c.status === 'live').length,
    upcomingCount: list.filter((c) => c.status === 'scheduled').length,
  };
}

/**
 * The child's achievements (module الإنجازات, migration 0031) — from the
 * shared ChildProvider. `null` while loading; empty lists when the module
 * isn't granted (menu entry + home card stay hidden).
 */
export function useChildAchievements(): { data: ChildAchievements | null; earnedCount: number; inProgress: number; hasAny: boolean } {
  const { achievements } = useChild();
  const earned = achievements?.earned.length ?? 0;
  const prog = achievements?.progress.length ?? 0;
  return { data: achievements, earnedCount: earned, inProgress: prog, hasAny: earned + prog > 0 };
}

/**
 * The child's occasions (module الفعاليات, migration 0032) — from the shared
 * ChildProvider. `null` while loading; `[]` when the module isn't granted
 * (menu entry + home card stay hidden). `open` = I can still register.
 */
export function useChildOccasions(): { list: ChildOccasion[] | null; upcoming: number; open: number; withTicket: number } {
  const { occasions } = useChild();
  const h = childOccasionHighlights(occasions ?? []);
  return { list: occasions, ...h };
}

/**
 * The child's notifications (module الإشعارات, migration 0034) — from the
 * shared ChildProvider. `null` while loading; `[]` when nothing reached him
 * yet (the bell is shown whenever the list is loaded, since the module grant
 * is decided per-send server-side).
 */
export function useChildNotifications(): { list: InboxItem[] | null; unread: number } {
  const { notifications } = useChild();
  return { list: notifications, unread: (notifications ?? []).filter((n) => !n.read_at).length };
}

/**
 * The child's library (module المكتبة, migration 0039) — from the shared
 * ChildProvider. `null` while loading; empty when the module isn't granted
 * to any of his enrollments (menu entry + home card stay hidden).
 */
export function useChildLibrary() {
  const { library, toggleLibraryFavorite } = useChild();
  const subjects = library?.subjects.length ?? 0;
  return {
    data: library,
    hasAny: subjects > 0,
    subjects,
    books: library?.books.length ?? 0,
    lectures: library?.lectures.length ?? 0,
    favorites: library?.favorites.length ?? 0,
    isFav: (kind: 'book' | 'lecture', id: string) => !!library?.favorites.some((f) => (kind === 'book' ? f.book_id === id : f.lecture_id === id)),
    toggleFav: toggleLibraryFavorite,
  };
}

/**
 * The store shops open to the child (module إستبدال النقاط, migration
 * 20261001120000) + his purchase requests — from the shared ChildProvider.
 * `hasAny` = at least one ACTIVE shop is connected to one of his places
 * (menu entry + home card stay hidden otherwise). `pending` = requests
 * waiting for a servant; `approvedUnseen` is not tracked (receipts live in
 * the points page).
 */
export function useChildShops() {
  const { shops, storeRequests, reloadShops } = useChild();
  const list = shops ?? [];
  const reqs = storeRequests ?? [];
  return {
    shops,
    requests: storeRequests,
    reload: reloadShops,
    hasAny: list.length > 0 || reqs.length > 0,
    shopCount: list.length,
    pending: reqs.filter((r) => r.status === 'pending').length,
    approved: reqs.filter((r) => r.status === 'approved').length,
  };
}

// ---------- Header ----------
function ChildHeader({ onMenu }: { onMenu: () => void }) {
  const { profile, token } = useChild();
  const main = profile?.enrollments[0];
  const { conversations, unread } = useChildMessages();
  const { unread: notifUnread } = useChildNotifications();
  const [supabase] = useState(() => createClient());
  // keep this device's push subscription bound to the signed-in child
  useEffect(() => { if (token) { syncPushRegistration(supabase, { kind: 'child', token }); kickDispatcher(); } }, [token, supabase]);
  return (
    <header
      id="child-header"
      className="sticky top-0 z-40 bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 text-white shadow-lg"
    >
      <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
          <Image
            src={main?.church_logo ?? dioceseLogo(96)}
            alt={main?.church_name ?? `شعار ${BRANDING.dioceseName}`}
            fill
            sizes="48px"
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-extrabold truncate leading-tight">
            {main?.church_name ?? BRANDING.dioceseName}
          </h1>
          <p className="text-xs text-indigo-100 truncate">
            {main ? `${main.service_name} · ${main.class_name}` : 'بوابة المخدوم'}
          </p>
        </div>
        {conversations && conversations.length > 0 && (
          <Link
            id="child-messages-bell"
            href="/child/messages"
            aria-label={unread > 0 ? `${unread} رسائل غير مقروءة` : 'الرسائل'}
            className="relative rounded-full p-2 transition hover:bg-white/15"
          >
            <MessageCircle className="h-6 w-6" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-primary-700 tabular-nums">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        )}
        <RefreshButton id="child-refresh-btn" />
        <Link
          id="child-notifications-bell"
          href="/child/notifications"
          aria-label={notifUnread > 0 ? `${notifUnread} إشعارات غير مقروءة` : 'الإشعارات'}
          className="relative rounded-full p-2 transition hover:bg-white/15"
        >
          <Bell className="h-6 w-6" />
          {notifUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-primary-700 tabular-nums">
              {notifUnread > 99 ? '99+' : notifUnread}
            </span>
          )}
        </Link>
        <button
          id="child-menu-btn"
          aria-label="فتح القائمة"
          onClick={onMenu}
          className="rounded-full p-2 hover:bg-white/15 transition -ml-2"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>
    </header>
  );
}

// ---------- Side menu ----------
function ChildSideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout } = useChild();
  const { exams, pendingCount } = useChildExams();
  const { conversations, unread } = useChildMessages();
  const hasMessages = !!conversations && conversations.length > 0;
  const { classes: onlineList, liveCount } = useChildOnline();
  const hasOnline = !!onlineList && onlineList.length > 0;
  const { hasAny: hasAchievements, earnedCount } = useChildAchievements();
  const { list: occList, open: occOpen, withTicket } = useChildOccasions();
  const hasOccasions = !!occList && occList.length > 0;
  const { unread: notifUnread } = useChildNotifications();
  const { hasAny: hasLibrary, favorites: libFavs } = useChildLibrary();
  const { hasAny: hasConfession, pending: confPending, upcoming: confUpcoming } = useChildConfession();
  const { hasFamily, hasPriests: hasFamilyPriests, pending: famPending, upcoming: famUpcoming } = useChildFamily();
  const { hasAny: hasShops, pending: shopPending } = useChildShops();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const person = profile?.person;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        id="child-side-menu"
        role="dialog"
        aria-modal="true"
        className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 p-4 text-white">
          <div className="flex items-start justify-between">
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl bg-white/20 ring-2 ring-gold-300/70">
              {person?.image_url ? (
                <Image src={person.image_url} alt={person.name} fill sizes="56px" className="object-cover" />
              ) : (
                <User className="absolute inset-0 m-auto h-7 w-7" />
              )}
            </div>
            <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-white/15">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-3 font-extrabold truncate">{person?.name ?? '—'}</p>
          <p className="text-xs text-indigo-100">مخدوم</p>
        </div>

        <div className="border-b border-indigo-100 bg-indigo-50/60 px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary-600" />
            {now ? formatCairoDate(now) : '—'}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-extrabold text-primary-700 tabular-nums">
            <Clock className="h-4 w-4 shrink-0 text-primary-600" />
            {now ? formatCairoTime(now) : '—'}
            <span className="mr-auto text-[10px] font-bold text-slate-400">بتوقيت القاهرة</span>
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <p className="mb-1 px-2 text-[11px] font-extrabold text-slate-400">الصفحات</p>
          {CHILD_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  active ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}

          <p className="mb-1 mt-3 px-2 text-[11px] font-extrabold text-slate-400">الوحدات</p>
          <Link
            id="child-nav-notifications"
            href="/child/notifications"
            onClick={onClose}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
              isActive(pathname, '/child/notifications') ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Bell className="h-5 w-5 text-indigo-600" />
            الإشعارات
            {notifUnread > 0 && (
              <span className="mr-auto rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{notifUnread}</span>
            )}
          </Link>
          {hasConfession && (
            <Link
              id="child-nav-confession"
              href="/child/confession"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/confession') ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Cross className="h-5 w-5 text-violet-600" />
              الاعتراف
              {(confPending > 0 || confUpcoming > 0) && (
                <span className="mr-auto rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{confPending > 0 ? confPending : confUpcoming}</span>
              )}
            </Link>
          )}
          {(hasFamily || hasFamilyPriests) && (
            <Link
              id="child-nav-family"
              href="/child/family"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/family') ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <UsersRound className="h-5 w-5 text-violet-600" />
              عائلتي
              {(famPending > 0 || famUpcoming > 0) && (
                <span className="mr-auto rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{famPending > 0 ? famPending : famUpcoming}</span>
              )}
            </Link>
          )}
          {hasShops && (
            <Link
              id="child-nav-store"
              href="/child/store"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/store') ? 'bg-orange-100 text-orange-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ShoppingBag className="h-5 w-5 text-orange-600" />
              المتجر
              {shopPending > 0 && (
                <span className="mr-auto rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{shopPending}</span>
              )}
            </Link>
          )}
          {hasOccasions && (
            <Link
              id="child-nav-occasions"
              href="/child/occasions"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/occasions') ? 'bg-cyan-100 text-cyan-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Tent className="h-5 w-5 text-cyan-600" />
              الفعاليات
              {(occOpen > 0 || withTicket > 0) && (
                <span className="mr-auto rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{occOpen > 0 ? occOpen : withTicket}</span>
              )}
            </Link>
          )}
          {hasOnline && (
            <Link
              id="child-nav-online"
              href="/child/online"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/online') ? 'bg-red-100 text-red-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Video className="h-5 w-5 text-red-600" />
              الفصول الأونلاين
              {liveCount > 0 && (
                <span className="mr-auto flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> مباشر</span>
              )}
            </Link>
          )}
          {hasLibrary && (
            <Link
              id="child-nav-library"
              href="/child/library"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/library') ? 'bg-lime-100 text-lime-800' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Library className="h-5 w-5 text-lime-700" />
              المكتبة
              {libFavs > 0 && (
                <span className="mr-auto rounded-full bg-lime-700 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">⭐ {libFavs}</span>
              )}
            </Link>
          )}
          {hasAchievements && (
            <Link
              id="child-nav-achievements"
              href="/child/achievements"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/achievements') ? 'bg-amber-100 text-amber-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Trophy className="h-5 w-5 text-amber-600" />
              الإنجازات
              {earnedCount > 0 && (
                <span className="mr-auto rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{earnedCount}</span>
              )}
            </Link>
          )}
          {hasMessages && (
            <Link
              id="child-nav-messages"
              href="/child/messages"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                isActive(pathname, '/child/messages') ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <MessageCircle className="h-5 w-5 text-sky-600" />
              الرسائل
              {unread > 0 && (
                <span className="mr-auto rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{unread}</span>
              )}
            </Link>
          )}
          {exams && exams.length > 0 && (
            <>
              <Link
                id="child-nav-exams"
                href="/child/exams"
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  isActive(pathname, '/child/exams') ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <GraduationCap className="h-5 w-5 text-violet-600" />
                الامتحانات
                {pendingCount > 0 && (
                  <span className="mr-auto rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{pendingCount}</span>
                )}
              </Link>
            </>
          )}
        </nav>

        <div className="space-y-2 border-t border-indigo-100 p-3">
          <SwitchAccountButton current="child" compact />
          <button
            id="child-logout-btn"
            onClick={() => { logout(); onClose(); router.replace('/login?as=child'); }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-extrabold text-red-600 hover:bg-red-50 transition"
          >
            <LogOut className="h-5 w-5" />
            خروج من البوابة
          </button>
        </div>
      </aside>
    </>
  );
}

// ---------- Bottom nav ----------
function ChildBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      id="child-bottom-nav"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-indigo-100 shadow-nav pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 max-w-3xl mx-auto">
        {CHILD_NAV.map(({ href, label, icon: Icon, id }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              id={id}
              href={href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition ${
                active ? 'text-primary-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className={`rounded-xl px-3 py-1 transition ${active ? 'bg-primary-100' : ''}`}>
                <Icon className="h-5 w-5" />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------- Shell ----------
export default function ChildShell({ children }: { children: ReactNode }) {
  const { token, profile, loading, error } = useChild();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.replace('/login?as=child');
  }, [loading, token, router]);

  if (loading || (!profile && !error && token)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!token) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <ChildHeader onMenu={() => setMenuOpen(true)} />
      <main id="child-main" className="flex-1 max-w-3xl w-full mx-auto px-4 py-4 pb-24">
        {error && !profile ? (
          <div className="card text-center text-sm font-bold text-red-600">{error}</div>
        ) : (
          children
        )}
      </main>
      <ChildBottomNav />
      <ChildSideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
