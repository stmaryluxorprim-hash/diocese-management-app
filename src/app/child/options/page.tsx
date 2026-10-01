'use client';

// ---------- Child portal — الخيارات ----------
// Profile summary, quick links, refresh, install hint, and logout.

import { useState } from 'react';
import { BRANDING } from '@/lib/branding';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  SlidersHorizontal, LogOut, RefreshCw, ChevronLeft, Database, CalendarCheck, Star, Camera,
  Pencil, Church, Layers, School, Loader2, Info, ShieldCheck, Smartphone, KeyRound, Eye, EyeOff, CheckCircle2,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { SwitchAccountButton } from '@/components/SwitchAccountModal';
import { Avatar, PageTitle, fmtDate } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { childChangePassword, childErrorMessage } from '@/lib/child-portal';

export default function ChildOptionsPage() {
  return (
    <ChildShell>
      <OptionsContent />
    </ChildShell>
  );
}

function OptionsContent() {
  const { profile, refresh, logout } = useChild();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  if (!profile) return null;
  const { person, enrollments } = profile;

  const doRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <>
      <PageTitle icon={<SlidersHorizontal className="h-5 w-5 text-primary-600" />} title="الخيارات" />

      {/* Profile card */}
      <section className="card mb-5 flex items-center gap-3">
        <Avatar person={person} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">{person.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
            <ShieldCheck className="h-3 w-3" /> مخدوم · مسجل منذ {fmtDate(person.created_at)}
          </p>
        </div>
        <Link href="/child/data" aria-label="بياناتي" className="rounded-xl bg-primary-50 p-2.5 text-primary-600 hover:bg-primary-100">
          <Pencil className="h-4 w-4" />
        </Link>
      </section>

      {/* Data & requests */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">بياناتي</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <OptLink href="/child/data" icon={<Pencil className="h-5 w-5 text-primary-600" />} label="طلب تعديل البيانات" desc="الاسم، تاريخ الميلاد، الهاتف، العنوان — بموافقة الخادم" />
          <OptLink href="/child/data" icon={<Camera className="h-5 w-5 text-gold-600" />} label="تغيير الصورة" desc="ارفع صورة جديدة لكارتك — تظهر بعد الموافقة" />
          <OptLink href="/child/data" icon={<Database className="h-5 w-5 text-accent-600" />} label="كارتي وكود الـ QR" desc="عرض الكود وحفظه على الهاتف" />
        </div>
      </section>

      {/* Records */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">السجلات</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <OptLink href="/child/attendance" icon={<CalendarCheck className="h-5 w-5 text-emerald-600" />} label="سجل الحضور" desc="كل مرات الحضور بالتاريخ والوقت" />
          <OptLink href="/child/points" icon={<Star className="h-5 w-5 text-gold-600" />} label="سجل النقاط" desc="الرصيد وكل الإضافات والخصومات" />
        </div>
      </section>

      {/* Enrollments */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">تسجيلاتي</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          {enrollments.map((e) => (
            <div key={e.id} className="px-4 py-3 text-xs font-bold text-slate-600 space-y-0.5">
              <p className="flex items-center gap-1.5"><Church className="h-3.5 w-3.5 text-gold-500" /> {e.church_name}</p>
              <p className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-accent-600" /> {e.service_name}</p>
              <p className="flex items-center gap-1.5"><School className="h-3.5 w-3.5 text-sky-600" /> {e.class_name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* App */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">التطبيق</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <button
            id="child-refresh-btn"
            onClick={doRefresh}
            disabled={refreshing}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/50 transition"
          >
            <span className="rounded-xl bg-slate-50 p-2">
              {refreshing ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" /> : <RefreshCw className="h-5 w-5 text-primary-600" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">تحديث البيانات</span>
              <span className="block text-xs text-slate-400">إعادة تحميل الحضور والنقاط والبيانات</span>
            </span>
          </button>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="rounded-xl bg-slate-50 p-2"><Smartphone className="h-5 w-5 text-slate-500" /></span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">إضافة للشاشة الرئيسية</span>
              <span className="block text-xs text-slate-400">من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية» لفتح البوابة كتطبيق</span>
            </span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="rounded-xl bg-slate-50 p-2"><Info className="h-5 w-5 text-slate-500" /></span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">عن البوابة</span>
              <span className="block text-xs text-slate-400">تدخل بكودك وكلمة مرورك — لا يمكنك تعديل الحضور أو النقاط، وأي تعديل في البيانات يحتاج موافقة الخادم</span>
            </span>
          </div>
        </div>
      </section>

      {/* Password (0042) */}
      <ChangePasswordCard />

      {/* Switch account (20261003120000) + Logout */}
      {!confirmOut ? (
        <div id="child-session-actions" className="grid grid-cols-2 gap-2">
          <SwitchAccountButton current="child" />
          <button
            id="child-options-logout"
            onClick={() => setConfirmOut(true)}
            className="w-full card flex items-center justify-center gap-2 !py-3.5 font-extrabold text-red-600 hover:bg-red-50 transition"
          >
            <LogOut className="h-5 w-5" />
            خروج من البوابة
          </button>
        </div>
      ) : (
        <div className="card space-y-3 border-red-100">
          <p className="text-center text-sm font-bold">ستحتاج لإدخال كودك وكلمة المرور مرة أخرى للدخول — متأكد؟</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmOut(false)} className="btn-secondary flex-1">إلغاء</button>
            <button
              id="child-options-logout-confirm"
              onClick={() => { logout(); router.replace('/login?as=child'); }}
              className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-700"
            >
              خروج
            </button>
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">بوابة المخدوم — {BRANDING.shortName}</p>
    </>
  );
}

function ChangePasswordCard() {
  const { token } = useChild();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) { setError('كلمة المرور الجديدة قصيرة — 6 أحرف على الأقل'); return; }
    if (next !== confirm) { setError('تأكيد كلمة المرور غير مطابق'); return; }
    if (!token) return;
    setBusy(true);
    try {
      await childChangePassword(supabase, token, current, next);
      // 20261003120000: ONE password per person — push it to the servant login too
      await fetch('/api/account/sync-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'child', token, password: next }),
      }).catch(() => undefined);
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      setTimeout(() => { setDone(false); setOpen(false); }, 1800);
    } catch (err) {
      setError(childErrorMessage(err, 'تعذّر تغيير كلمة المرور'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-5">
      <h2 className="mb-2 px-1 text-xs font-extrabold text-slate-400">الحساب</h2>
      <div className="card !p-0 overflow-hidden">
        <button
          id="child-change-password-btn"
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/50 transition"
        >
          <span className="rounded-xl bg-slate-50 p-2"><KeyRound className="h-5 w-5 text-primary-600" /></span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-sm">تغيير كلمة المرور</span>
            <span className="block text-xs text-slate-400">كلمة مرور واحدة لكل حساباتك (خادم · مخدوم · كاهن) — تُغلق الجلسات الأخرى بعد التغيير</span>
          </span>
          <ChevronLeft className={`h-4 w-4 text-slate-300 transition ${open ? '-rotate-90' : ''}`} />
        </button>
        {open && (
          <form onSubmit={submit} className="space-y-3 border-t border-slate-100 px-4 py-4">
            <div className="relative">
              <input
                id="child-pw-current"
                type={show ? 'text' : 'password'}
                className="input-field pl-10"
                dir="ltr"
                placeholder="كلمة المرور الحالية"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShow((x) => !x)} aria-label="إظهار" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <input
              id="child-pw-new"
              type={show ? 'text' : 'password'}
              className="input-field"
              dir="ltr"
              placeholder="كلمة المرور الجديدة (6 أحرف على الأقل)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
            <input
              id="child-pw-confirm"
              type={show ? 'text' : 'password'}
              className="input-field"
              dir="ltr"
              placeholder="تأكيد كلمة المرور الجديدة"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
            {done && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> تم تغيير كلمة المرور
              </p>
            )}
            <button id="child-pw-submit" type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              حفظ كلمة المرور
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function OptLink({ href, icon, label, desc }: { href: string; icon: React.ReactNode; label: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition">
      <span className="rounded-xl bg-slate-50 p-2">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm">{label}</span>
        <span className="block text-xs text-slate-400 truncate">{desc}</span>
      </span>
      <ChevronLeft className="h-4 w-4 text-slate-300" />
    </Link>
  );
}
