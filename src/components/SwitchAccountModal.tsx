'use client';

// ---------- «تغيير الحساب» — switch between the accounts of ONE person ----------
// (migration 20261003120000). Opened from the button next to «تسجيل الخروج»
// in the servant settings, the child options and the priest options.
// Lists every account of the signed-in person (servant · child · priest —
// no duplicates), marks the current one, and switches WITHOUT signing out
// or typing the password (`switchAccount`).

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { X, Loader2, Users, GraduationCap, Cross, ArrowLeftRight, Check, Clock, Ban, type LucideIcon } from 'lucide-react';
import {
  fetchMyAccounts, switchAccount, currentSessionToken, accountUsable, accountErrorMessage, accountRowKey, isCurrentRow,
  ACCOUNT_KIND_LABELS, ACCOUNT_STATUS_LABELS,
  type AccountKind, type MyAccounts, type PersonAccount,
} from '@/lib/accounts';

const ICONS: Record<AccountKind, LucideIcon> = { servant: Users, child: GraduationCap, priest: Cross };
const COLORS: Record<AccountKind, string> = {
  servant: 'bg-primary-50 text-primary-700 ring-primary-200',
  child: 'bg-gold-50 text-gold-700 ring-gold-200',
  priest: 'bg-violet-50 text-violet-700 ring-violet-200',
};
const ROLE_AR: Record<string, string> = {
  owner: 'مالك التطبيق', church_manager: 'مدير كنيسة', service_manager: 'مسؤول خدمة', class_servant: 'خادم فصل',
};

export default function SwitchAccountModal({ current, onClose }: { current: AccountKind; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<MyAccounts | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyAccounts(supabase, current, currentSessionToken(current))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(accountErrorMessage(e, 'تعذّر تحميل الحسابات')); });
    return () => { cancelled = true; };
  }, [supabase, current]);

  // 20261004120000: every row is ONE enrollment — the servant switches the
  // place of his login, the child the class, the priest his single account
  const go = async (a: PersonAccount) => {
    const key = accountRowKey(a);
    if (busy || !data || isCurrentRow(a, data)) return;
    setBusy(key); setError('');
    try {
      const href = await switchAccount(supabase, current, {
        kind: a.kind, enrollment_id: a.enrollment_id,
        church_id: a.church_id ?? null, service_id: a.service_id ?? null, class_id: a.class_id ?? null,
      }, { remember: true });
      // hard navigation: every portal boots its provider from storage / cookies
      window.location.href = href;
    } catch (e) {
      setError(accountErrorMessage(e));
      setBusy(null);
    }
  };

  const accounts = data?.accounts ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        id="switch-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-account-title"
        className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-xl bg-slate-100 p-2"><ArrowLeftRight className="h-5 w-5 text-slate-600" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="switch-account-title" className="text-base font-extrabold">تغيير الحساب</h2>
            <p className="truncate text-xs text-slate-400">
              {data ? <>{data.person.name} · <span dir="ltr">{data.person.code}</span></> : 'كود واحد · كلمة مرور واحدة · حسابات متعددة'}
            </p>
          </div>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {!data && !error && (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-500" /></div>
        )}

        {data && (
          <ul id="switch-account-list" className="space-y-2">
            {accounts.map((a) => {
              const key = accountRowKey(a);
              return <AccountRow key={key} a={a} isCurrent={isCurrentRow(a, data)} busy={busy === key} disabled={!!busy} onPick={() => go(a)} />;
            })}
          </ul>
        )}

        {data && (
          <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2.5 text-[11px] font-bold text-slate-500">
            كل سطر = تسجيل واحد (مكان خدمة · فصل · حساب الكاهن) وتعمل الجلسة عليه وحده. لإضافة تسجيل جديد لنفس الكود استخدم رابط الدعوة من المسؤول — بنفس كلمة المرور.
          </p>
        )}

        {error && <p id="switch-account-error" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

        <p className="mt-4 text-center text-[11px] text-slate-400">التبديل لا يحتاج كلمة المرور ولا تسجيل الخروج — الجلسة الحالية تُغلق وتُفتح جلسة الحساب المختار.</p>
      </div>
    </div>
  );
}

function AccountRow({ a, isCurrent, busy, disabled, onPick }: {
  a: PersonAccount; isCurrent: boolean; busy: boolean; disabled: boolean; onPick: () => void;
}) {
  const Icon = ICONS[a.kind];
  const usable = accountUsable(a);
  const places = a.label2 ? [a.label2] : [];
  const sub = a.kind === 'servant' && a.role ? ROLE_AR[a.role] ?? a.role : a.kind === 'priest' && a.title ? a.title : null;
  return (
    <li>
      <button
        id={`switch-account-${a.kind}-${a.enrollment_id.slice(0, 8)}${a.class_id ? '-' + a.class_id.slice(0, 8) : ''}`}
        type="button"
        disabled={isCurrent || !usable || disabled}
        onClick={onPick}
        aria-current={isCurrent ? 'true' : undefined}
        className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-right ring-1 transition ${
          isCurrent ? 'bg-emerald-50 ring-emerald-200' : usable ? 'bg-white ring-slate-200 hover:bg-slate-50 active:scale-[0.99]' : 'bg-slate-50 ring-slate-100 opacity-70'
        }`}
      >
        <span className={`mt-0.5 rounded-xl p-2 ring-1 ${COLORS[a.kind]}`}><Icon className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-extrabold">{ACCOUNT_KIND_LABELS[a.kind]}</span>
            {sub && <span className="text-[11px] font-bold text-slate-400">{sub}</span>}
            {isCurrent ? (
              <span className="mr-auto flex items-center gap-0.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white"><Check className="h-3 w-3" /> الحالي</span>
            ) : !usable ? (
              <span className="mr-auto flex items-center gap-0.5 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
                {a.status === 'pending' ? <Clock className="h-3 w-3" /> : <Ban className="h-3 w-3" />} {ACCOUNT_STATUS_LABELS[a.status] ?? a.status}
              </span>
            ) : null}
          </span>
          {places.length > 0 && (
            <span className="mt-1 block space-y-0.5">
              {places.slice(0, 3).map((p, i) => <span key={i} className="block truncate text-[11px] font-bold text-slate-500">{p}</span>)}
              {places.length > 3 && <span className="block text-[11px] font-bold text-slate-400">+{places.length - 3} أماكن أخرى</span>}
            </span>
          )}
        </span>
        {busy ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-slate-400" /> : !isCurrent && usable ? <ArrowLeftRight className="mt-1 h-4 w-4 text-slate-300" /> : null}
      </button>
    </li>
  );
}

/** the «تغيير الحساب» button — placed BESIDE «تسجيل الخروج» everywhere */
export function SwitchAccountButton({ current, className = '', compact = false }: { current: AccountKind; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        id={`switch-account-btn-${current}`}
        type="button"
        onClick={() => setOpen(true)}
        className={className || (compact
          ? 'flex w-full items-center justify-center gap-2 rounded-xl bg-primary-50 px-3 py-2.5 text-sm font-bold text-primary-700 transition hover:bg-primary-100'
          : 'card flex w-full items-center justify-center gap-2 !py-3.5 font-extrabold text-primary-700 transition hover:bg-primary-50')}
      >
        <ArrowLeftRight className="h-5 w-5" />
        تغيير الحساب
      </button>
      {open && <SwitchAccountModal current={current} onClose={() => setOpen(false)} />}
    </>
  );
}
