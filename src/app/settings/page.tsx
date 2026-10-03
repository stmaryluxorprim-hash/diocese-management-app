'use client';

import { useEffect, useState } from 'react';
import { BRANDING } from '@/lib/branding';
import Image from 'next/image';
import Link from 'next/link';
import {
  Settings, Church, Layers, School, LogOut, ChevronLeft, User, Phone, ShieldCheck,
  Pencil, Users, CalendarDays, Award, Inbox, PhoneCall, Crown, GraduationCap,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import EditProfileModal from '@/components/EditProfileModal';
import { SwitchAccountButton } from '@/components/SwitchAccountModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ROLE_LABELS } from '@/lib/types';
import { useModules } from '@/lib/modules-context';
import { OWNER_MODULE } from '@/lib/modules';
import { useCustomization } from '@/lib/customization-context';

export default function SettingsPage() {
  const { profile, signOut } = useAuth();
  const [editProfile, setEditProfile] = useState(false);

  // Pending data-change requests from the child portal (scoped by RLS)
  const [supabase] = useState(() => createClient());
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  const loadPending = async () => {
    const { data } = await supabase.rpc('pending_data_requests_count');
    setPendingRequests(typeof data === 'number' ? data : 0);
  };
  useEffect(() => {
    if (profile?.status === 'approved') loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.status]);
  useDebouncedRealtime(supabase, 'settings-dcr-badge', [{ table: 'data_change_requests' }], loadPending, { enabled: !!profile });

  // Pending child signups (0042) — badge on «إدارة المخدومين»
  const [pendingChildren, setPendingChildren] = useState<number | null>(null);
  const loadPendingChildren = async () => {
    const { data } = await supabase.rpc('pending_child_join_requests_count');
    setPendingChildren(typeof data === 'number' ? data : 0);
  };
  useEffect(() => {
    if (profile?.status === 'approved') loadPendingChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.status]);
  useDebouncedRealtime(supabase, 'settings-cjr-badge', [{ table: 'child_join_requests' }], loadPendingChildren, { enabled: !!profile });

  const childrenManageLink = (
    <SettingsLink
      href="/children/manage"
      icon={<GraduationCap className="h-5 w-5 text-gold-600" />}
      label="إدارة المخدومين"
      desc="إضافة فردية وجماعية · طلبات التسجيل · دعوة بالـ QR"
      badge={pendingChildren ?? undefined}
    />
  );

  const { visibleModules, loading: modulesLoading } = useModules();
  const { label } = useCustomization();
  const isOwner = profile?.role === 'owner';
  const isManager =
    profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  return (
    <AppShell>
      <section className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Settings className="h-5 w-5 text-primary-600" />
          {label('settings')}
        </h2>
      </section>

      {/* Profile card */}
      <section id="profile-card" className="card mb-5">
        <div className="flex items-center gap-3">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
            {profile?.photo_url ? (
              <Image src={profile.photo_url} alt={profile.full_name} fill sizes="56px" className="object-cover" />
            ) : (
              <User className="h-7 w-7" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-extrabold truncate">{profile?.full_name}</p>
            <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <span className="badge bg-primary-100 text-primary-700">
                <ShieldCheck className="h-3 w-3" />
                {profile ? ROLE_LABELS[profile.role] : ''}
              </span>
              <span className="flex items-center gap-1" dir="ltr">
                <Phone className="h-3 w-3" /> {profile?.phone}
              </span>
            </p>
          </div>
          <button
            id="edit-profile-btn"
            onClick={() => setEditProfile(true)}
            className="mr-auto rounded-xl bg-primary-50 p-2.5 text-primary-600 hover:bg-primary-100 transition"
            aria-label="تعديل بياناتي"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* Management sections */}
      {isManager && (
        <section id="management-links" className="mb-5">
          <h3 className="mb-2 text-sm font-extrabold text-slate-500">الإدارة</h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {childrenManageLink}
            <SettingsLink
              href="/servants"
              icon={<Users className="h-5 w-5 text-emerald-600" />}
              label="إدارة الخدام"
              desc="الخدام · طلبات الانضمام · دعوة بالـ QR — في صفحة واحدة"
            />
            {(isOwner || profile?.role === 'church_manager') && (
              <SettingsLink
                href="/settings/churches"
                icon={<Church className="h-5 w-5 text-gold-500" />}
                label="إدارة الكنائس"
                desc="إضافة وتعديل الكنائس وشعاراتها"
              />
            )}
            <SettingsLink
              href="/settings/services"
              icon={<Layers className="h-5 w-5 text-accent-600" />}
              label="إدارة الخدمات"
              desc="خدمات الكنيسة (مدارس أحد، شباب...)"
            />
            <SettingsLink
              href="/settings/classes"
              icon={<School className="h-5 w-5 text-sky-600" />}
              label="إدارة الفصول"
              desc="فصول كل خدمة"
            />
            {/* Event = 4th level of the hierarchy (church → service → class → event),
                so its management sits right after classes. */}
            <SettingsLink
              href="/settings/events"
              icon={<CalendarDays className="h-5 w-5 text-violet-600" />}
              label="إدارة المناسبات"
              desc="المستوى الرابع: قداسات واجتماعات ورحلات — الحضور والنقاط والمتابعة تُسجّل عليها"
            />
          </div>
        </section>
      )}

      {/* Activity setup — events & causes (class servants too) */}
      {profile?.status === 'approved' && (
        <section id="activity-links" className="mb-5">
          <h3 className="mb-2 text-sm font-extrabold text-slate-500">النشاط</h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {/* Class servants have no management section — give them the
                events link here so the hierarchy order still holds. */}
            {!isManager && childrenManageLink}
            {!isManager && (
              <SettingsLink
                href="/settings/events"
                icon={<CalendarDays className="h-5 w-5 text-violet-600" />}
                label="إدارة المناسبات"
                desc="المستوى الرابع: قداسات واجتماعات ورحلات — الحضور والنقاط والمتابعة تُسجّل عليها"
              />
            )}
            <SettingsLink
              href="/settings/data-requests"
              icon={<Inbox className="h-5 w-5 text-primary-600" />}
              label="طلبات تعديل البيانات"
              desc="طلبات المخدومين من بوابة المخدوم — موافقة أو رفض"
              badge={pendingRequests ?? undefined}
            />
            <SettingsLink
              href="/settings/causes"
              icon={<Award className="h-5 w-5 text-amber-600" />}
              label="إدارة أسباب النقاط"
              desc="أسباب إضافة أو خصم النقاط (حفظ، سلوك...)"
            />
            <SettingsLink
              href="/settings/call-feedbacks"
              icon={<PhoneCall className="h-5 w-5 text-teal-600" />}
              label="إدارة نتائج الافتقاد"
              desc="نتائج افتقاد المخدومين (سيأتي، مريض، لم يرد...) — اسم ولون وأيقونة"
            />
            {/* Backup & restore (0044) moved into the owner module — /owner/backup (20261009120000) */}
          </div>
        </section>
      )}

      {/* Modules — a separate group: only the modules granted to my scope
          (owner decides in /owner/modules). The owner module comes first for
          the owner and is never part of the grants. */}
      {profile?.status === 'approved' && (
        <section id="modules-links" className="mb-5">
          <h3 className="mb-2 text-sm font-extrabold text-slate-500">الوحدات</h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {isOwner && (
              <SettingsLink
                href={OWNER_MODULE.href}
                icon={<Crown className="h-5 w-5 text-gold-500" />}
                label={label(OWNER_MODULE.key)}
                desc={OWNER_MODULE.desc}
                accent
              />
            )}
            {visibleModules.map((m) => {
              const Icon = m.icon;
              return (
                <SettingsLink
                  key={m.key}
                  href={m.href}
                  icon={<Icon className={`h-5 w-5 ${m.color}`} />}
                  label={label(m.key)}
                  desc={m.desc}
                />
              );
            })}
            {!isOwner && visibleModules.length === 0 && (
              <p id="settings-no-modules" className="px-4 py-4 text-center text-xs font-bold text-slate-400">
                {modulesLoading ? '…' : 'لا توجد وحدات مفعّلة لنطاقك'}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 20261003120000: one person · many accounts — switch without signing out */}
      <div id="settings-session-actions" className="grid grid-cols-2 gap-2">
        <SwitchAccountButton current="servant" />
        <button
          id="logout-btn"
          onClick={signOut}
          className="w-full card flex items-center justify-center gap-2 !py-3.5 font-extrabold text-red-600 hover:bg-red-50 transition"
        >
          <LogOut className="h-5 w-5" />
          تسجيل الخروج
        </button>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        {BRANDING.shortName} — الإصدار 0.2.0
      </p>

      {editProfile && <EditProfileModal onClose={() => setEditProfile(false)} />}
    </AppShell>
  );
}

function SettingsLink({
  href, icon, label, desc, badge, accent,
}: {
  href: string; icon: React.ReactNode; label: string; desc: string; badge?: number; accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3.5 transition ${
        accent ? 'bg-gold-50/60 hover:bg-gold-50' : 'hover:bg-indigo-50/50'
      }`}
    >
      <span className={`rounded-xl p-2 ${accent ? 'bg-gold-100' : 'bg-slate-50'}`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm">{label}</span>
        <span className="block text-xs text-slate-400 truncate">{desc}</span>
      </span>
      {!!badge && (
        <span className="badge bg-gold-500 text-white tabular-nums">{badge}</span>
      )}
      <ChevronLeft className="h-4 w-4 text-slate-300" />
    </Link>
  );
}
