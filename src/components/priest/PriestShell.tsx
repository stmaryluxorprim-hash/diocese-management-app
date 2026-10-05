'use client';

// ---------- Priest portal shell (بوابة الكاهن) ----------
// Same look as the other two portals: gradient header (church logo · church
// name · priest name), a side menu (every page) and a 5-tab bottom bar:
// الرئيسية · المعترفين · العائلات · الزيارات · الخيارات

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, Users, CalendarClock, PhoneCall, SlidersHorizontal, Menu, X, LogOut, CalendarDays, Clock, User, Loader2, Cross, UsersRound, MapPinned, Footprints, type LucideIcon,
} from 'lucide-react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import RefreshButton from '@/components/RefreshButton';
import { SwitchAccountButton } from '@/components/SwitchAccountModal';
import { usePriest } from '@/lib/priest-context';
import { formatCairoDate, formatCairoTime } from '@/lib/time';

interface NavItem { href: string; label: string; icon: LucideIcon; id: string; group?: string }
/** every page (side menu) */
export const PRIEST_MENU: NavItem[] = [
  { href: '/priest', label: 'الرئيسية', icon: Home, id: 'priest-nav-home' },
  { href: '/priest/confessors', label: 'المعترفين', icon: Users, id: 'priest-nav-confessors', group: 'الاعتراف' },
  { href: '/priest/appointments', label: 'مواعيد الاعتراف', icon: CalendarClock, id: 'priest-nav-appointments', group: 'الاعتراف' },
  { href: '/priest/followup', label: 'افتقاد المعترفين', icon: PhoneCall, id: 'priest-nav-followup', group: 'الاعتراف' },
  { href: '/priest/areas', label: 'المناطق والشوارع', icon: MapPinned, id: 'priest-nav-areas', group: 'الافتقاد الأسري' },
  { href: '/priest/families', label: 'العائلات', icon: UsersRound, id: 'priest-nav-families', group: 'الافتقاد الأسري' },
  { href: '/priest/visits', label: 'الزيارات', icon: Footprints, id: 'priest-nav-visits', group: 'الافتقاد الأسري' },
  { href: '/priest/options', label: 'الخيارات', icon: SlidersHorizontal, id: 'priest-nav-options' },
];
/** the 5 tabs of the bottom bar */
export const PRIEST_NAV: NavItem[] = [PRIEST_MENU[0], PRIEST_MENU[1], PRIEST_MENU[5], PRIEST_MENU[6], PRIEST_MENU[7]];

type Counts = { pending_appointments: number; overdue: number; pending_visits: number; today_visits: number } | undefined;
function navBadge(href: string, counts: Counts): number {
  if (!counts) return 0;
  switch (href) {
    case '/priest/appointments': return counts.pending_appointments;
    case '/priest/confessors': return counts.pending_appointments;
    case '/priest/followup': return counts.overdue;
    case '/priest/visits': return counts.pending_visits + counts.today_visits;
    default: return 0;
  }
}

const isActive = (pathname: string, href: string) => (href === '/priest' ? pathname === '/priest' : pathname.startsWith(href));

function PriestHeader({ onMenu }: { onMenu: () => void }) {
  const { profile } = usePriest();
  return (
    <header id="priest-header" className="sticky top-0 z-40 bg-gradient-to-l from-violet-800 via-violet-700 to-fuchsia-700 text-white shadow-lg">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
          <Image src={profile?.church.logo_url ?? dioceseLogo(96)} alt={profile?.church.name ?? BRANDING.dioceseName} fill sizes="48px" className="object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-extrabold leading-tight">{profile?.church.name ?? BRANDING.dioceseName}</h1>
          <p className="truncate text-xs text-violet-100">
            {profile ? `${profile.priest.title ? `${profile.priest.title} ` : ''}${profile.person.name}` : 'بوابة الكاهن'}
          </p>
        </div>
        <RefreshButton id="priest-refresh-btn" />
        <button id="priest-menu-btn" aria-label="فتح القائمة" onClick={onMenu} className="-ml-2 rounded-full p-2 transition hover:bg-white/15"><Menu className="h-6 w-6" /></button>
      </div>
    </header>
  );
}

function PriestSideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout } = usePriest();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  const person = profile?.person;
  const counts = profile?.counts;

  return (
    <>
      <div onClick={onClose} aria-hidden="true" className={`fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
      <aside id="priest-side-menu" role="dialog" aria-modal="true" className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="bg-gradient-to-l from-violet-800 via-violet-700 to-fuchsia-700 p-4 text-white">
          <div className="flex items-start justify-between">
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl bg-white/20 ring-2 ring-gold-300/70">
              {person?.image_url ? <Image src={person.image_url} alt={person.name} fill sizes="56px" className="object-cover" /> : <Cross className="absolute inset-0 m-auto h-7 w-7" />}
            </div>
            <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-white/15"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-3 truncate font-extrabold">{profile ? `${profile.priest.title ? `${profile.priest.title} ` : ''}${person?.name}` : '—'}</p>
          <p className="text-xs text-violet-100">كاهن · {profile?.church.name}</p>
        </div>
        <div className="border-b border-indigo-100 bg-violet-50/60 px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><CalendarDays className="h-4 w-4 shrink-0 text-violet-600" />{now ? formatCairoDate(now) : '—'}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-extrabold text-violet-700 tabular-nums"><Clock className="h-4 w-4 shrink-0 text-violet-600" />{now ? formatCairoTime(now) : '—'}<span className="mr-auto text-[10px] font-bold text-slate-400">بتوقيت القاهرة</span></p>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {PRIEST_MENU.map(({ href, label, icon: Icon, group }, i) => {
            const active = isActive(pathname, href);
            const badge = navBadge(href, counts);
            const showGroup = group && PRIEST_MENU[i - 1]?.group !== group;
            return (
              <div key={href}>
                {showGroup && <p className="mb-1 mt-2 px-2 text-[11px] font-extrabold text-slate-400">{group}</p>}
                <Link href={href} onClick={onClose} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${active ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <Icon className="h-5 w-5" />{label}
                  {!!badge && <span className="mr-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{badge}</span>}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-indigo-100 p-3">
          <SwitchAccountButton current="priest" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-extrabold text-primary-700 transition hover:bg-primary-50" />
          <button id="priest-logout-btn" onClick={() => { logout(); onClose(); router.replace('/login?as=priest'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-extrabold text-red-600 transition hover:bg-red-50"><LogOut className="h-5 w-5" /> خروج من البوابة</button>
        </div>
      </aside>
    </>
  );
}

function PriestBottomNav() {
  const pathname = usePathname();
  const { profile } = usePriest();
  const counts = profile?.counts;
  return (
    <nav id="priest-bottom-nav" className="fixed inset-x-0 bottom-0 z-40 border-t border-indigo-100 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-nav backdrop-blur">
      <div className="mx-auto grid max-w-3xl grid-cols-5">
        {PRIEST_NAV.map(({ href, label, icon: Icon, id }) => {
          const active = isActive(pathname, href);
          const badge = navBadge(href, counts);
          return (
            <Link key={href} id={id} href={href} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition ${active ? 'text-violet-700' : 'text-slate-400 hover:text-slate-600'}`}>
              <span className={`relative rounded-xl px-3 py-1 transition ${active ? 'bg-violet-100' : ''}`}>
                <Icon className="h-5 w-5" />
                {!!badge && <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-extrabold text-white tabular-nums">{badge > 99 ? '99+' : badge}</span>}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function PriestShell({ children }: { children: ReactNode }) {
  const { token, profile, loading, error } = usePriest();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (!loading && !token) router.replace('/login?as=priest'); }, [loading, token, router]);
  if (loading || (!profile && !error && token)) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-500" /></div>;
  }
  if (!token) return null;
  return (
    <div className="flex min-h-screen flex-col">
      <PriestHeader onMenu={() => setMenuOpen(true)} />
      <main id="priest-main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24">
        {error && !profile ? <div className="card text-center text-sm font-bold text-red-600">{error}</div> : children}
      </main>
      <PriestBottomNav />
      <PriestSideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

/** Shared page title for the priest pages */
export function PriestTitle({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <section className="mb-4 flex items-start justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">{icon}{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      {action}
    </section>
  );
}

export function PersonPhoto({ name, url, size = 44 }: { name: string; url: string | null; size?: number }) {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white ring-2 ring-white shadow-sm" style={{ width: size, height: size }}>
      {url ? <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" /> : <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />}
    </div>
  );
}
