'use client';

import { useEffect, useState } from 'react';
import { appIcon } from '@/lib/branding';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Layers, CalendarDays, Clock } from 'lucide-react';
import { SwitchAccountButton } from '@/components/SwitchAccountModal';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS } from '@/lib/types';
import { formatCairoDate, formatCairoTime } from '@/lib/time';
import { useAppDate } from '@/lib/app-date-context';
import { useCustomization } from '@/lib/customization-context';

// ---------- Sections ----------
// 1. the SAME 5 items as the bottom bar (decided by the owner in تخصيص
//    التطبيق, resolved for this user);
// 2. everything else the user may see: core pages moved out of the bar,
//    the owner module (role = owner) and every module granted to his scope
//    (registry in `src/lib/modules.ts`, grants in /owner/modules).

interface SideMenuProps {
  open: boolean;
  onClose: () => void;
}

// ---------- Live date & time in app timezone (Africa/Cairo) ----------
// Follows the WORKING DATE from the header button when overridden.
function CairoDateTime({ active }: { active: boolean }) {
  const { now: appNow, isOverridden } = useAppDate();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!active) return;
    setNow(appNow());
    const t = setInterval(() => setNow(appNow()), 1000);
    return () => clearInterval(t);
  }, [active, appNow]);

  return (
    <div
      id="side-menu-datetime"
      className={`border-b border-indigo-100 px-4 py-2.5 ${isOverridden ? 'bg-gold-50' : 'bg-indigo-50/60'}`}
    >
      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
        <CalendarDays className="h-4 w-4 shrink-0 text-primary-600" />
        {now ? formatCairoDate(now) : '—'}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-sm font-extrabold text-primary-700 tabular-nums">
        <Clock className="h-4 w-4 shrink-0 text-primary-600" />
        {now ? formatCairoTime(now) : '—'}
        <span className="mr-auto text-[10px] font-bold text-slate-400">
          {isOverridden ? '⤴ تاريخ مجمّد' : 'بتوقيت القاهرة'}
        </span>
      </p>
    </div>
  );
}

export default function SideMenu({ open, onClose }: SideMenuProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { taskbar, menuRest, loading: navLoading } = useCustomization();

  // Lock body scroll while the menu is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      {/* Backdrop */}
      <div
        id="side-menu-backdrop"
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer — slides in from the right (RTL start side) */}
      <aside
        id="side-menu"
        role="dialog"
        aria-modal="true"
        aria-label="القائمة الجانبية"
        className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* ---------- Header: user data ---------- */}
        <div className="bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 px-4 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
              <Image
                src={profile?.photo_url ?? appIcon(96)}
                alt={profile?.full_name ?? 'الخادم'}
                fill
                sizes="56px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-extrabold leading-tight">
                {profile?.full_name ?? '—'}
              </p>
              <p className="truncate text-xs text-indigo-100">
                {profile ? ROLE_LABELS[profile.role] : ''}
              </p>
            </div>
          </div>
        </div>

        {/* ---------- Cairo date & time (app timezone) ---------- */}
        <CairoDateTime active={open} />

        {/* ---------- Body: main pages + modules ---------- */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {taskbar.map(({ key, href, label, icon: Icon, kind }) => {
              const owner = kind === 'owner';
              return (
                <li key={key}>
                  <Link
                    id={`menu-${key}`}
                    href={href}
                    onClick={onClose}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                      isActive(href)
                        ? owner ? 'bg-gold-100 text-gold-700' : 'bg-primary-100 text-primary-700'
                        : owner ? 'text-gold-700 hover:bg-gold-50' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Horizontal divider */}
          <hr id="side-menu-divider" className="my-4 border-indigo-100" />

          {/* Section 2 — everything not in the bar (core pages moved out,
              owner module, granted modules) */}
          <p className="mb-2 flex items-center gap-2 px-3 text-[11px] font-bold text-slate-400">
            <Layers className="h-3.5 w-3.5" />
            الوحدات
          </p>
          {menuRest.length === 0 ? (
            <p id="side-menu-no-modules" className="px-3 text-xs text-slate-400">
              {navLoading ? '…' : 'لا توجد وحدات مفعّلة لنطاقك'}
            </p>
          ) : (
            <ul className="space-y-1">
              {menuRest.map(({ key, href, label, icon: Icon, kind, color }) => {
                const owner = kind === 'owner';
                return (
                  <li key={key}>
                    <Link
                      id={`menu-${key}`}
                      href={href}
                      onClick={onClose}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                        isActive(href)
                          ? owner ? 'bg-gold-100 text-gold-700' : 'bg-primary-100 text-primary-700'
                          : owner ? 'text-gold-700 hover:bg-gold-50' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${kind === 'module' && !isActive(href) && color ? color : ''}`} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* ---------- Footer: logout ---------- */}
        <div className="grid grid-cols-2 gap-2 border-t border-indigo-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <SwitchAccountButton current="servant" compact />
          <button
            id="side-menu-logout"
            onClick={() => {
              onClose();
              signOut();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-100"
          >
            <LogOut className="h-5 w-5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>
    </>
  );
}
