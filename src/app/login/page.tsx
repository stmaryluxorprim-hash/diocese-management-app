'use client';

// ---------- Unified login (دخول الخادم / دخول المخدوم / دخول الكاهن) ----------
// One page, three entries. Both use the CODE (national id / QR) as the login
// name — scanned with the camera / picked from the gallery or typed — plus a
// password, a «تذكرني» switch and a signup link.
//   * servant → Supabase Auth (email = code@diocese.app)
//   * child   → child_login RPC (migration 0042) → session token
//   * priest  → priest_login RPC (migration 20260927120000) → session token

import { Suspense, useCallback, useEffect, useState } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  LogIn, Loader2, User, Lock, QrCode, Keyboard, Eye, EyeOff, UserPlus, Users, GraduationCap, Cross,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { userIdToEmail, codeToUserId } from '@/lib/types';
import { childLogin, fetchChildProfile, setChildToken, childErrorMessage, getChildToken } from '@/lib/child-portal';
import { priestLogin, fetchPriestProfile, setPriestToken, priestErrorMessage, getPriestToken } from '@/lib/priest-portal';
import QrScanner from '@/components/store/QrScanner';
import { SERVANT_NO_REMEMBER_KEY, SERVANT_TAB_ALIVE_KEY } from '@/lib/session';
import { logActivity } from '@/lib/activity';

type LoginKind = 'servant' | 'child' | 'priest';

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

  const [kind, setKind] = useState<LoginKind>(params.get('as') === 'child' ? 'child' : params.get('as') === 'priest' ? 'priest' : 'servant');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [scan, setScan] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // a child / priest that is already signed in goes straight to the portal
  useEffect(() => {
    if (kind === 'child' && getChildToken()) router.replace('/child');
    if (kind === 'priest' && getPriestToken()) router.replace('/priest');
  }, [kind, router]);

  const switchKind = (k: LoginKind) => {
    setKind(k);
    setError('');
    setScan(false);
    const url = new URL(window.location.href);
    if (k === 'servant') url.searchParams.delete('as');
    else url.searchParams.set('as', k);
    window.history.replaceState(null, '', url.toString());
  };

  const onScanned = useCallback((value: string) => {
    setCode(value.trim());
    setScan(false);
    setError('');
    // focus the password box so the flow continues without a tap
    setTimeout(() => document.getElementById('login-password')?.focus(), 50);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = code.trim();
    if (!clean) { setError('أدخل الكود أو امسحه'); return; }
    if (!password) { setError('أدخل كلمة المرور'); return; }
    setLoading(true);

    if (kind === 'servant') {
      const { error: err } = await supabase.auth.signInWithPassword({
        // 0037: the login name IS the servant's code (national id / QR)
        email: userIdToEmail(codeToUserId(clean)),
        password,
      });
      if (err) {
        // 0047: failed attempts are logged (anon may log auth.* only)
        void logActivity(supabase, 'auth.login_failed', { meta: { code: clean.slice(0, 40) } });
        setError('بيانات الدخول غير صحيحة، تأكد من الكود وكلمة المرور');
        setLoading(false);
        return;
      }
      void logActivity(supabase, 'auth.login', { meta: { remember, ua: navigator.userAgent.slice(0, 120) } });
      // 20261003120000: ONE password per person — the Auth password just proved
      // itself, so the person's credentials row converges to it (no-op when equal)
      await supabase.rpc('servant_mirror_own_password', { p_password: password }).then(() => undefined, () => undefined);
      try {
        if (remember) {
          window.localStorage.removeItem(SERVANT_NO_REMEMBER_KEY);
        } else {
          window.localStorage.setItem(SERVANT_NO_REMEMBER_KEY, '1');
          window.sessionStorage.setItem(SERVANT_TAB_ALIVE_KEY, '1');
        }
      } catch { /* private mode */ }
      router.replace('/');
      router.refresh();
      return;
    }

    if (kind === 'priest') {
      try {
        const r = await priestLogin(supabase, clean, password, remember);
        await fetchPriestProfile(supabase, r.token);
        setPriestToken(r.token, remember);
        router.replace('/priest');
      } catch (err) {
        setError(priestErrorMessage(err, 'تعذّر تسجيل الدخول، حاول مجدداً'));
        setLoading(false);
      }
      return;
    }

    // child
    try {
      const r = await childLogin(supabase, clean, password, remember);
      await fetchChildProfile(supabase, r.token);
      setChildToken(r.token, remember);
      router.replace('/child');
    } catch (err) {
      setError(childErrorMessage(err, 'تعذّر تسجيل الدخول، حاول مجدداً'));
      setLoading(false);
    }
  };

  const isChild = kind === 'child';
  const isPriest = kind === 'priest';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-8">
      <section id="login-card" className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image
              src={dioceseLogo(192)}
              alt={`شعار ${BRANDING.dioceseName}`}
              width={112}
              height={112}
              priority
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-extrabold">{BRANDING.dioceseName}</h1>
          <p className="text-sm text-slate-500 mt-1">سجّل دخولك للمتابعة</p>
        </div>

        {/* servant / child switch */}
        <div id="login-kind-switch" role="tablist" className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
          <button
            id="login-as-servant"
            type="button"
            role="tab"
            aria-selected={kind === 'servant'}
            onClick={() => switchKind('servant')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-extrabold transition sm:text-sm ${
              kind === 'servant' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
            }`}
          >
            <Users className="h-4 w-4" /> الخادم
          </button>
          <button
            id="login-as-child"
            type="button"
            role="tab"
            aria-selected={isChild}
            onClick={() => switchKind('child')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-extrabold transition sm:text-sm ${
              isChild ? 'bg-white text-gold-700 shadow' : 'text-slate-500'
            }`}
          >
            <GraduationCap className="h-4 w-4" /> المخدوم
          </button>
          <button
            id="login-as-priest"
            type="button"
            role="tab"
            aria-selected={isPriest}
            onClick={() => switchKind('priest')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-extrabold transition sm:text-sm ${
              isPriest ? 'bg-white text-violet-700 shadow' : 'text-slate-500'
            }`}
          >
            <Cross className="h-4 w-4" /> الكاهن
          </button>
        </div>

        <form onSubmit={handleLogin} className="card space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="login-user-id" className="block text-sm font-bold">
                الكود {isChild ? '(كود الكارت)' : isPriest ? '(كود الكاهن)' : '(اسم الدخول)'}
              </label>
              <button
                id="login-toggle-scan"
                type="button"
                onClick={() => setScan((s) => !s)}
                className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:underline"
              >
                {scan ? <Keyboard className="h-3.5 w-3.5" /> : <QrCode className="h-3.5 w-3.5" />}
                {scan ? 'إدخال يدوي' : 'مسح الكود'}
              </button>
            </div>
            {scan ? (
              <QrScanner
                idPrefix="login"
                autoStart
                hint="وجّه الكاميرا نحو كود الكارت أو اختر صورته من المعرض"
                onCode={onScanned}
              />
            ) : (
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="login-user-id"
                  className="input-field pr-9"
                  placeholder="الكود / الرقم القومي"
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoComplete="username"
                  inputMode="text"
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-bold">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                className="input-field pr-9 pl-10"
                placeholder="••••••••"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                onClick={() => setShowPw((s) => !s)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-600">
            <input
              id="login-remember"
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-primary-600"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            تذكرني على هذا الجهاز
          </label>

          {error && (
            <p id="login-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
              {error}
            </p>
          )}

          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className={`w-full flex items-center justify-center gap-2 ${isChild ? 'btn-primary !bg-gradient-to-br !from-gold-500 !to-gold-700' : isPriest ? 'btn-primary !bg-gradient-to-br !from-violet-600 !to-violet-800' : 'btn-primary'}`}
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            تسجيل الدخول
          </button>

          <Link
            id="login-signup-link"
            href={isChild ? '/child/signup' : isPriest ? '/priest/signup' : '/signup'}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <UserPlus className="h-5 w-5" />
            {isChild ? 'إنشاء حساب مخدوم' : isPriest ? 'إنشاء حساب كاهن' : 'إنشاء حساب خادم'}
          </Link>
        </form>

        <p className="mt-5 text-center text-xs text-slate-400">
          {isChild
            ? 'المخدوم يدخل بكود الكارت وكلمة المرور التي ضبطها الخادم أو اختارها عند التسجيل.'
            : isPriest
              ? 'الكاهن يدخل بكوده وكلمة المرور؛ الحساب الجديد يحتاج موافقة مالك التطبيق.'
              : 'الخادم يدخل بكوده وكلمة المرور؛ الحساب الجديد يحتاج موافقة المسؤول.'}
        </p>
      </section>
    </main>
  );
}
