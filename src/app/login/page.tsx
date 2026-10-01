'use client';

// ---------- ONE login page (20261004120000) ----------
// The person enters his CODE (typed / scanned) + his ONE password. The
// database (`account_login`) verifies the password and returns every account
// of the person — one row per enrollment (servant per place · child per class
// · priest). ONE account → he goes straight in. SEVERAL → he picks which one
// to use (`account_session_from_login` mints that session; servant sessions go
// through /api/account/switch for the Auth cookie).
//
// Legacy: a servant / priest whose password was never mirrored into
// `person_credentials` gets `password_unknown` → we sign him in through
// Supabase Auth directly (the mirror catches up on success) and he lands on
// the servant app.
//
// There is NO signup link here: signing up is possible only from the invite
// link / QR a manager generates inside the app (?invite=…).

import { Suspense, useCallback, useEffect, useState } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  LogIn, Loader2, User, Lock, QrCode, Keyboard, Eye, EyeOff, Users, GraduationCap, Cross, ArrowRight, Check, Clock, Ban, type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { userIdToEmail, codeToUserId } from '@/lib/types';
import { getChildToken } from '@/lib/child-portal';
import { getPriestToken } from '@/lib/priest-portal';
import QrScanner from '@/components/store/QrScanner';
import { SERVANT_NO_REMEMBER_KEY, SERVANT_TAB_ALIVE_KEY } from '@/lib/session';
import { logActivity } from '@/lib/activity';
import {
  accountLogin, sessionFromLogin, accountUsable, accountErrorMessage,
  ACCOUNT_KIND_LABELS, ACCOUNT_STATUS_LABELS,
  type AccountKind, type LoginResult, type PersonAccount,
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [code, setCode] = useState(params.get('code') ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [scan, setScan] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // step 2: the person has several accounts → pick one
  const [login, setLogin] = useState<LoginResult | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  // a child / priest that is already signed in goes straight to his portal
  useEffect(() => {
    if (getChildToken()) router.replace('/child');
    else if (getPriestToken()) router.replace('/priest');
  }, [router]);

  const onScanned = useCallback((value: string) => {
    setCode(value.trim());
    setScan(false);
    setError('');
    setTimeout(() => document.getElementById('login-password')?.focus(), 50);
  }, []);

  const rememberFlags = (on: boolean) => {
    try {
      if (on) window.localStorage.removeItem(SERVANT_NO_REMEMBER_KEY);
      else { window.localStorage.setItem(SERVANT_NO_REMEMBER_KEY, '1'); window.sessionStorage.setItem(SERVANT_TAB_ALIVE_KEY, '1'); }
    } catch { /* private mode */ }
  };

  /** legacy servant / priest whose password lives only in Supabase Auth */
  const legacyAuthLogin = async (clean: string): Promise<boolean> => {
    const { error: err } = await supabase.auth.signInWithPassword({ email: userIdToEmail(codeToUserId(clean)), password });
    if (err) return false;
    void logActivity(supabase, 'auth.login', { meta: { remember, ua: navigator.userAgent.slice(0, 120), legacy: true } });
    // the Auth password just proved itself → it becomes the person's ONE password
    await supabase.rpc('servant_mirror_own_password', { p_password: password }).then(() => undefined, () => undefined);
    rememberFlags(remember);
    router.replace('/');
    router.refresh();
    return true;
  };

  const enter = async (grant: string, a: PersonAccount) => {
    setPicking(`${a.kind}:${a.enrollment_id}:${a.class_id ?? ''}:${a.service_id ?? ''}:${a.church_id ?? ''}`);
    setError('');
    try {
      const href = await sessionFromLogin(supabase, grant, a, remember);
      if (a.kind === 'servant') rememberFlags(remember);
      window.location.href = href;
    } catch (e) {
      const msg = (e as { message?: string } | null)?.message ?? '';
      if (msg.includes('session_expired')) {
        // the 5-minute grant expired → back to the password
        setLogin(null);
        setError('انتهت مهلة اختيار الحساب — أدخل كلمة المرور مجدداً');
      } else if (msg.includes('not_configured') && a.kind === 'servant') {
        // no service key on the server → the Auth password still works directly
        const ok = await legacyAuthLogin(code.trim());
        if (!ok) setError(accountErrorMessage(e));
      } else {
        setError(accountErrorMessage(e));
      }
      setPicking(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = code.trim();
    if (!clean) { setError('أدخل الكود أو امسحه'); return; }
    if (!password) { setError('أدخل كلمة المرور'); return; }
    setLoading(true);
    try {
      const r = await accountLogin(supabase, clean, password, remember);
      const usable = r.accounts.filter(accountUsable);
      if (usable.length === 1 && r.accounts.length === 1) {
        // ONE account → straight in
        await enter(r.grant, usable[0]);
        return;
      }
      setLogin(r);
      setLoading(false);
    } catch (err) {
      const msg = (err as { message?: string } | null)?.message ?? '';
      if (msg.includes('password_unknown')) {
        // legacy servant / priest (password only in Auth) → Supabase Auth directly
        const ok = await legacyAuthLogin(clean);
        if (ok) return;
        void logActivity(supabase, 'auth.login_failed', { meta: { code: clean.slice(0, 40) } });
        setError('بيانات الدخول غير صحيحة، تأكد من الكود وكلمة المرور');
      } else if (msg.includes('wrong_password') || msg.includes('unknown_code')) {
        void logActivity(supabase, 'auth.login_failed', { meta: { code: clean.slice(0, 40) } });
        setError('بيانات الدخول غير صحيحة، تأكد من الكود وكلمة المرور');
      } else {
        setError(accountErrorMessage(err, 'تعذّر تسجيل الدخول، حاول مجدداً'));
      }
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-8">
      <section id="login-card" className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image src={dioceseLogo(192)} alt={`شعار ${BRANDING.dioceseName}`} width={112} height={112} priority className="h-full w-full object-cover" />
          </div>
          <h1 className="text-2xl font-extrabold">{BRANDING.dioceseName}</h1>
          <p className="mt-1 text-sm text-slate-500">{login ? 'اختر الحساب الذي تريد الدخول به' : 'سجّل دخولك للمتابعة'}</p>
        </div>

        {login ? (
          <section id="login-pick" className="card space-y-3">
            <div className="flex items-center gap-3">
              {login.person.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={login.person.image_url} alt="" className="h-12 w-12 rounded-2xl object-cover ring-2 ring-primary-100" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600"><User className="h-6 w-6" /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{login.person.name}</p>
                <p className="text-xs text-slate-400" dir="ltr">{login.person.code}</p>
              </div>
            </div>
            <p className="rounded-xl bg-primary-50 px-3 py-2 text-[11px] font-bold text-primary-700">
              لديك {login.accounts.length} حسابات بنفس الكود وكلمة المرور — كل جلسة تعمل على حساب واحد، وتستطيع التبديل لاحقًا من زر «تغيير الحساب».
            </p>
            <ul id="login-accounts" className="space-y-2">
              {login.accounts.map((a) => {
                const Icon = ICONS[a.kind];
                const usable = accountUsable(a);
                const key = `${a.kind}:${a.enrollment_id}:${a.class_id ?? ''}:${a.service_id ?? ''}:${a.church_id ?? ''}`;
                const sub = a.kind === 'servant' && a.role ? ROLE_AR[a.role] ?? a.role : a.kind === 'priest' && a.title ? a.title : null;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={!usable || !!picking}
                      onClick={() => enter(login.grant, a)}
                      className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-right ring-1 transition ${
                        usable ? 'bg-white ring-slate-200 hover:bg-slate-50 active:scale-[0.99]' : 'bg-slate-50 ring-slate-100 opacity-70'
                      }`}
                    >
                      <span className={`mt-0.5 rounded-xl p-2 ring-1 ${COLORS[a.kind]}`}><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-extrabold">{ACCOUNT_KIND_LABELS[a.kind]}</span>
                          {sub && <span className="text-[11px] font-bold text-slate-400">{sub}</span>}
                          {!usable && (
                            <span className="mr-auto flex items-center gap-0.5 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
                              {a.status === 'pending' ? <Clock className="h-3 w-3" /> : <Ban className="h-3 w-3" />} {ACCOUNT_STATUS_LABELS[a.status] ?? a.status}
                            </span>
                          )}
                        </span>
                        {a.label2 && <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-500">{a.label2}</span>}
                      </span>
                      {picking === key ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-slate-400" /> : usable ? <Check className="mt-1 h-4 w-4 text-slate-300" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {error && <p id="login-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
            <button type="button" onClick={() => { setLogin(null); setPassword(''); setError(''); }} className="btn-secondary flex w-full items-center justify-center gap-1">
              <ArrowRight className="h-4 w-4" /> رجوع
            </button>
          </section>
        ) : (
          <form onSubmit={handleLogin} className="card space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="login-user-id" className="block text-sm font-bold">الكود (كود الكارت)</label>
                <button id="login-toggle-scan" type="button" onClick={() => setScan((s) => !s)} className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:underline">
                  {scan ? <Keyboard className="h-3.5 w-3.5" /> : <QrCode className="h-3.5 w-3.5" />}
                  {scan ? 'إدخال يدوي' : 'مسح الكود'}
                </button>
              </div>
              {scan ? (
                <QrScanner idPrefix="login" autoStart hint="وجّه الكاميرا نحو كود الكارت أو اختر صورته من المعرض" onCode={onScanned} />
              ) : (
                <div className="relative">
                  <User className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input id="login-user-id" className="input-field pr-9" placeholder="الكود / الرقم القومي" dir="ltr" value={code}
                    onChange={(e) => setCode(e.target.value)} required autoComplete="username" inputMode="text" />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-bold">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="login-password" type={showPw ? 'text' : 'password'} className="input-field pr-9 pl-10" placeholder="••••••••" dir="ltr"
                  value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                <button type="button" aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShowPw((s) => !s)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-600">
              <input id="login-remember" type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-primary-600" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              تذكرني على هذا الجهاز
            </label>

            {error && <p id="login-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

            <button id="login-submit" type="submit" disabled={loading} className="btn-primary flex w-full items-center justify-center gap-2">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
              تسجيل الدخول
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-xs text-slate-400">
          كود واحد وكلمة مرور واحدة لكل حساباتك — خادم أو مخدوم أو كاهن. التسجيل الجديد يتم من رابط الدعوة الذي يرسله لك المسؤول.
        </p>
      </section>
    </main>
  );
}
