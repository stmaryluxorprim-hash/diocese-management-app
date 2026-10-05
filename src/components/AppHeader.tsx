'use client';

// ---------- App header ----------
// Logo + church / service names on the start side; on the end side the
// ICONS decided by the OWNER in تخصيص التطبيق (app_settings.navigation):
// built-in widgets (تاريخ العمل · جرس الرسائل · جرس الإشعارات) and quick
// links to any page / module, each with an optional custom icon — followed
// by the fixed side-menu button. Widgets bound to a module only render when
// the module is granted to the signed-in user.

import { useState } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import Image from 'next/image';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS } from '@/lib/types';
import SideMenu from '@/components/SideMenu';
import AppDateButton from '@/components/AppDateButton';
import MessagesBell from '@/components/messages/MessagesBell';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import LiveStatusChip from '@/components/LiveStatusChip';
import { useCustomization } from '@/lib/customization-context';
import { resolveIcon, HEADER_WIDGET_BY_KEY } from '@/lib/navigation';

export default function AppHeader() {
  const { profile, church, service } = useAuth();
  const { header } = useCustomization();
  const [menuOpen, setMenuOpen] = useState(false);

  const hasNotifBell = header.some((h) => h.widget === 'notifications');

  return (
    <>
      <header
        id="app-header"
        className="sticky top-0 z-40 bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 text-white shadow-lg"
      >
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          {/* Church logo (uploaded picture) */}
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
            <Image
              src={church?.logo_url ?? dioceseLogo(96)}
              alt={church?.name ?? `شعار ${BRANDING.dioceseName}`}
              fill
              sizes="48px"
              className="object-cover"
            />
          </div>

          {/* Church name + service name below it */}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-extrabold truncate leading-tight">
              {church?.name ?? BRANDING.dioceseName}
            </h1>
            <p className="text-xs text-indigo-100 truncate">
              {service?.name ?? (profile ? ROLE_LABELS[profile.role] : '')}
            </p>
          </div>

          {/* «غير متصل» — the realtime bus is down, screens may be stale (tap = refresh) */}
          <LiveStatusChip />

          {/* Owner-arranged header icons */}
          <div id="header-icons" className="flex items-center gap-0.5">
            {header.map((item) => {
              if (item.widget === 'date') return <AppDateButton key={item.key} />;
              if (item.widget === 'messages') {
                return (
                  <MessagesBell
                    key={item.key}
                    icon={resolveIcon(item.icon, HEADER_WIDGET_BY_KEY.messages.icon)}
                  />
                );
              }
              if (item.widget === 'notifications') {
                return (
                  <NotificationsBell
                    key={item.key}
                    icon={resolveIcon(item.icon, HEADER_WIDGET_BY_KEY.notifications.icon)}
                  />
                );
              }
              if (item.link) {
                const Icon = item.link.icon;
                return (
                  <Link
                    key={item.key}
                    id={`header-link-${item.link.key}`}
                    href={item.link.href}
                    aria-label={item.link.label}
                    title={item.link.label}
                    className="rounded-full p-2 transition hover:bg-white/15"
                  >
                    <Icon className="h-6 w-6" />
                  </Link>
                );
              }
              return null;
            })}
          </div>

          {/* The notifications bell also syncs push registration + kicks the
              scheduler — keep it mounted (invisible) when the owner removed
              it from the header. */}
          {!hasNotifBell && <NotificationsBell hidden />}

          {/* Side menu button — fixed at the end of the header */}
          <button
            id="side-menu-btn"
            aria-label="فتح القائمة"
            onClick={() => setMenuOpen(true)}
            className="rounded-full p-2 hover:bg-white/15 transition -ml-2"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* Side drawer menu */}
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
