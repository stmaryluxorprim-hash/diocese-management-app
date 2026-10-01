'use client';

// ---------- إدارة الخدام — one module page with 4 tabs ----------
//   الخدام            → ServantsPanel     (manage servant enrollments + permissions)
//   إضافة             → AddServantsPanel  (add servants directly — single / bulk, 0041)
//   طلبات الانضمام    → ApprovalsPanel    (pending signups, badge with the count)
//   دعوة خادم (QR)    → InvitePanel       (scoped invite link + QR)
// URL: /servants?tab=servants|add|approvals|invite (old /settings/* paths redirect here)

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Users, UserCheck, UserPlus, QrCode, Loader2, ShieldQuestion } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { SERVANTS_TABLE } from '@/lib/types';
import ServantsPanel from '@/components/servants/ServantsPanel';
import AddServantsPanel from '@/components/servants/AddServantsPanel';
import ApprovalsPanel from '@/components/servants/ApprovalsPanel';
import InvitePanel from '@/components/servants/InvitePanel';

type Tab = 'servants' | 'add' | 'approvals' | 'invite';
const TABS: { key: Tab; label: string; icon: typeof Users; color: string }[] = [
  { key: 'servants', label: 'الخدام', icon: Users, color: 'text-emerald-600' },
  { key: 'add', label: 'إضافة', icon: UserPlus, color: 'text-violet-600' },
  { key: 'approvals', label: 'الطلبات', icon: UserCheck, color: 'text-red-600' },
  { key: 'invite', label: 'دعوة (QR)', icon: QrCode, color: 'text-primary-600' },
];

export default function ServantsModulePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <ServantsModule />
      </Suspense>
    </AppShell>
  );
}

function ServantsModule() {
  const { profile } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());
  const raw = params.get('tab');
  const tab: Tab = raw === 'approvals' || raw === 'invite' || raw === 'add' ? raw : 'servants';
  const [pendingCount, setPendingCount] = useState(0);

  const isManager = !!profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const loadCount = useCallback(async () => {
    // 20261006120000: pending signups + pending new-place requests (RPC);
    // fallback to the plain count before the migration is applied
    const { data, error } = await supabase.rpc('pending_servant_requests_count');
    if (!error && typeof data === 'number') { setPendingCount(data); return; }
    const { count } = await supabase.from(SERVANTS_TABLE).select('id', { count: 'exact', head: true }).eq('status', 'pending');
    setPendingCount(count ?? 0);
  }, [supabase]);
  useEffect(() => { if (profile?.status === 'approved') loadCount(); }, [profile?.status, loadCount]);
  useDebouncedRealtime(supabase, 'servants-module-count', [{ table: SERVANTS_TABLE }, { table: 'servant_scope_requests' }], loadCount, { enabled: isManager });

  const setTab = (t: Tab) => router.replace(t === 'servants' ? '/servants' : `/servants?tab=${t}`);

  if (profile && !isManager) {
    return (
      <div className="card py-12 text-center text-slate-400">
        <ShieldQuestion className="mx-auto mb-3 h-10 w-10" />
        <p className="font-bold">هذه الصفحة متاحة للمسؤولين فقط</p>
      </div>
    );
  }

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="h-5 w-5 text-emerald-600" />
          إدارة الخدام
        </h2>
      </section>

      {/* tabs */}
      <div id="servants-tabs" className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-indigo-50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              id={`servants-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`relative flex items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-[11px] sm:text-sm font-extrabold transition ${
                active ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? t.color : ''}`} />
              {t.label}
              {t.key === 'approvals' && pendingCount > 0 && (
                <span className="absolute -top-1 -left-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white shadow">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'servants' && <ServantsPanel />}
      {tab === 'add' && <AddServantsPanel />}
      {tab === 'approvals' && <ApprovalsPanel />}
      {tab === 'invite' && <InvitePanel />}
    </>
  );
}
