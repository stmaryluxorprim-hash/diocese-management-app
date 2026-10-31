'use client';

// ---------- OWNER MODULE → حماية الدخول (20261019120000) ----------
// The database counts wrong passwords per code and per IP and locks the
// door for a while (login_throttle). Here the owner:
//   • sees who is locked / who is failing right now (login_locks)
//   • lifts a lock — one row or everything (login_unlock)
//   • tunes the limits (app_settings.login_limits — read by login_limits()).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldAlert, Loader2, Unlock, RefreshCw, Save, Check, Globe, KeyRound, Clock } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchLoginLocks, unlockLogin, fetchLoginLimits, saveLoginLimits, DEFAULT_LOGIN_LIMITS, type LoginLock, type LoginLimits } from '@/lib/login-security';

const FIELDS: { key: keyof LoginLimits; label: string; hint: string; min: number; max: number }[] = [
  { key: 'code_max', label: 'محاولات خاطئة لكل كود', hint: 'بعدها يُقفل هذا الكود', min: 2, max: 50 },
  { key: 'code_window_min', label: 'خلال (دقائق)', hint: 'نافذة عدّ المحاولات للكود', min: 1, max: 1440 },
  { key: 'code_lock_min', label: 'مدة قفل الكود (دقائق)', hint: 'تتضاعف مع كل قفل جديد', min: 1, max: 1440 },
  { key: 'ip_max', label: 'محاولات خاطئة لكل جهاز/شبكة (IP)', hint: 'أعلى لأن شبكة الكنيسة قد تجمع عشرات الأجهزة', min: 5, max: 500 },
  { key: 'ip_window_min', label: 'خلال (دقائق)', hint: 'نافذة عدّ المحاولات للـ IP', min: 1, max: 1440 },
  { key: 'ip_lock_min', label: 'مدة قفل الـ IP (دقائق)', hint: 'تتضاعف مع كل قفل جديد', min: 1, max: 1440 },
  { key: 'max_lock_min', label: 'أقصى مدة قفل (دقائق)', hint: 'سقف المضاعفة', min: 5, max: 10080 },
];

export default function OwnerLoginSecurityPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [locks, setLocks] = useState<LoginLock[] | null>(null);
  const [limits, setLimits] = useState<LoginLimits>(DEFAULT_LOGIN_LIMITS);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const [l, lim] = await Promise.all([fetchLoginLocks(supabase), fetchLoginLimits(supabase)]);
      setLocks(l); setLimits(lim); setDirty(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'تعذّر التحميل');
    }
  }, [supabase]);

  useEffect(() => { if (profile?.role === 'owner') void reload(); }, [profile?.role, reload]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const unlock = async (key: string | null) => {
    setBusy(key ?? '*'); setError('');
    try { await unlockLogin(supabase, key); await reload(); }
    catch (e) { setError((e as { message?: string })?.message ?? 'تعذّر فك القفل'); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setError(''); setSaved(false);
    try { await saveLoginLimits(supabase, limits, profile?.id ?? null); setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch (e) { setError((e as { message?: string })?.message ?? 'تعذّر الحفظ'); }
    finally { setBusy(null); }
  };

  const lockedNow = (locks ?? []).filter((l) => l.locked && l.locked_until && new Date(l.locked_until).getTime() > now);
  const failing = (locks ?? []).filter((l) => !lockedNow.includes(l));

  return (
    <AppShell>
      <OwnerGate>
        <section className="mb-4 flex items-center gap-2">
          <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><ShieldAlert className="h-5 w-5 text-amber-600" /> حماية الدخول</h2>
          <button type="button" onClick={() => void reload()} aria-label="تحديث" className="mr-auto rounded-full p-1.5 hover:bg-slate-100"><RefreshCw className="h-4 w-4 text-slate-500" /></button>
        </section>

        <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          قاعدة البيانات تعدّ كلمات المرور الخاطئة لكل <b>كود</b> ولكل <b>جهاز/شبكة (IP)</b>. عند تجاوز الحد يُوقف الدخول مؤقتاً
          بلا أي تحقق من كلمة المرور (فلا تُستهلك قدرة الخادم). الدخول الصحيح يصفّر عدّاد الكود. من هنا ترى المقفولين وتفكّ القفل وتضبط الحدود.
        </p>

        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

        {/* ---- locked now ---- */}
        <section id="login-locks" className="card mb-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-extrabold text-slate-600">المقفولون الآن</h3>
            <span className={`badge tabular-nums ${lockedNow.length ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{lockedNow.length}</span>
            {lockedNow.length > 0 && (
              <button id="login-unlock-all" type="button" disabled={!!busy} onClick={() => void unlock(null)} className="btn-secondary mr-auto flex items-center gap-1 !px-3 !py-1.5 text-xs">
                {busy === '*' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />} فك الكل
              </button>
            )}
          </div>
          {!locks ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : lockedNow.length === 0 ? (
            <p className="py-3 text-center text-xs font-bold text-slate-400">لا يوجد كود أو جهاز مقفول الآن</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lockedNow.map((l) => <LockRow key={l.key} l={l} now={now} busy={busy === l.key} disabled={!!busy} onUnlock={() => void unlock(l.key)} />)}
            </ul>
          )}
        </section>

        {/* ---- failing in the last day ---- */}
        {failing.length > 0 && (
          <section id="login-failing" className="card mb-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-slate-600">محاولات خاطئة خلال ٢٤ ساعة</h3>
              <span className="badge bg-slate-100 text-slate-500 tabular-nums">{failing.length}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {failing.slice(0, 50).map((l) => <LockRow key={l.key} l={l} now={now} busy={busy === l.key} disabled={!!busy} onUnlock={() => void unlock(l.key)} />)}
            </ul>
          </section>
        )}

        {/* ---- limits ---- */}
        <section id="login-limits" className="card">
          <h3 className="mb-3 text-sm font-extrabold text-slate-600">الحدود</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs font-bold">{f.label}</span>
                <input
                  id={`login-limit-${f.key}`}
                  type="number" inputMode="numeric" min={f.min} max={f.max} dir="ltr"
                  className="input-field"
                  value={limits[f.key]}
                  onChange={(e) => { setLimits((v) => ({ ...v, [f.key]: Number(e.target.value) })); setDirty(true); }}
                />
                <span className="mt-0.5 block text-[11px] text-slate-400">{f.hint}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button id="login-limits-save" type="button" disabled={!dirty || busy === 'save'} onClick={() => void save()} className="btn-primary flex items-center gap-2">
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? 'تم الحفظ' : 'حفظ الحدود'}
            </button>
            <button type="button" onClick={() => { setLimits(DEFAULT_LOGIN_LIMITS); setDirty(true); }} className="btn-secondary text-xs">القيم الافتراضية</button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            الافتراضي: ٥ محاولات خاطئة للكود خلال ١٥ دقيقة ← قفل ١٥ دقيقة (يتضاعف) · ٤٠ محاولة للـ IP خلال ١٠ دقائق ← قفل ١٠ دقائق · أقصى قفل ٤ ساعات.
            الحدود تسري فوراً على كل أبواب الدخول (الخادم · المخدوم · الكاهن).
          </p>
        </section>
      </OwnerGate>
    </AppShell>
  );
}

function LockRow({ l, now, busy, disabled, onUnlock }: { l: LoginLock; now: number; busy: boolean; disabled: boolean; onUnlock: () => void }) {
  const until = l.locked_until ? new Date(l.locked_until).getTime() : 0;
  const left = Math.max(0, Math.ceil((until - now) / 60000));
  const isIp = l.kind === 'ip';
  return (
    <li className="flex items-center gap-3 py-2">
      <span className={`rounded-xl p-2 ${isIp ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-violet-600'}`}>
        {isIp ? <Globe className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-extrabold" dir="ltr">{l.subject}</span>
          {l.person_name && <span className="truncate text-xs font-bold text-slate-500">{l.person_name}</span>}
          {isIp && l.last_code && <span className="truncate text-[11px] text-slate-400" dir="ltr">آخر كود: {l.last_code}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] font-bold text-slate-400">
          {l.locked && left > 0 ? (
            <span className="flex items-center gap-1 text-red-600"><Clock className="h-3 w-3" /> مقفول · يُفتح بعد {left} دقيقة</span>
          ) : (
            <span>{l.fails} محاولات خاطئة</span>
          )}
          {l.lock_count > 0 && <span>· قُفل {l.lock_count} مرة</span>}
          {l.last_fail_at && <span>· آخر محاولة {new Date(l.last_fail_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
        </span>
      </span>
      <button type="button" disabled={disabled} onClick={onUnlock} aria-label="فك القفل / تصفير" className="rounded-xl p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
      </button>
    </li>
  );
}
