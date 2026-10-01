'use client';

// ---------- Priest portal — الخيارات ----------
// Profile card · edit my data (name · title · phone · address · photo) ·
// change password · reminder days · refresh · logout.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal, KeyRound, LogOut, RefreshCw, Loader2, Check, Pencil, Camera, Bell } from 'lucide-react';
import PriestShell, { PriestTitle, PersonPhoto } from '@/components/priest/PriestShell';
import PhotoCropModal from '@/components/PhotoCropModal';
import { SwitchAccountButton } from '@/components/SwitchAccountModal';
import { usePriest } from '@/lib/priest-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { PHONE_PREFIX, PHONE_LOCAL_LENGTH } from '@/lib/types';
import { priestChangePassword, updatePriestSelf, setPriestReminderDays, priestErrorMessage } from '@/lib/priest-portal';

export default function PriestOptionsPage() {
  return <PriestShell><Options /></PriestShell>;
}

function Options() {
  const { profile, token, refresh, logout, reloadAll } = usePriest();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  if (!profile) return null;
  const { person, priest, church } = profile;

  return (
    <>
      <PriestTitle icon={<SlidersHorizontal className="h-5 w-5 text-violet-600" />} title="الخيارات" />
      <section className="card mb-4 flex items-center gap-3">
        <PersonPhoto name={person.name} url={person.image_url} size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-extrabold">{priest.title ? `${priest.title} ` : ''}{person.name}</p>
          <p className="text-xs text-slate-500">{church.name}</p>
          <p className="text-xs text-slate-400" dir="ltr">{person.national_id}</p>
        </div>
      </section>

      <EditSection />
      <ReminderSection />
      <PasswordSection />

      <section className="mb-5">
        <h2 className="mb-2 px-1 text-xs font-extrabold text-slate-400">عام</h2>
        <div className="card !p-0 overflow-hidden divide-y divide-indigo-50">
          <button type="button" onClick={async () => { setRefreshing(true); await refresh(); reloadAll(); setRefreshing(false); }} className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/50">
            <span className="rounded-xl bg-slate-50 p-2">{refreshing ? <Loader2 className="h-5 w-5 animate-spin text-violet-600" /> : <RefreshCw className="h-5 w-5 text-violet-600" />}</span>
            <span className="text-sm font-bold">تحديث البيانات</span>
          </button>
          {/* 20261003120000: one person · many accounts */}
          <SwitchAccountButton current="priest" className="flex w-full items-center gap-3 px-4 py-3.5 text-right text-sm font-extrabold text-primary-700 hover:bg-primary-50 [&>svg]:rounded-xl [&>svg]:bg-primary-50 [&>svg]:p-2 [&>svg]:h-9 [&>svg]:w-9" />
          {!confirmOut ? (
            <button id="priest-logout" type="button" onClick={() => setConfirmOut(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-right text-red-600 hover:bg-red-50">
              <span className="rounded-xl bg-red-50 p-2"><LogOut className="h-5 w-5" /></span><span className="text-sm font-extrabold">خروج من البوابة</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-3 text-sm font-bold">
              <span className="flex-1 text-slate-600">تأكيد الخروج؟</span>
              <button type="button" onClick={() => { logout(); router.replace('/login?as=priest'); }} className="rounded-xl bg-red-600 px-3 py-1.5 text-white">خروج</button>
              <button type="button" onClick={() => setConfirmOut(false)} className="rounded-xl bg-slate-100 px-3 py-1.5">إلغاء</button>
            </div>
          )}
        </div>
      </section>
      <p className="text-center text-[11px] text-slate-400">تعديل الكنيسة أو إيقاف الحساب أو حذفه — من مالك التطبيق فقط.</p>
    </>
  );
}

function EditSection() {
  const { profile, token, refresh } = usePriest();
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile?.person.name ?? '');
  const [title, setTitle] = useState(profile?.priest.title ?? '');
  const [phoneLocal, setPhoneLocal] = useState((profile?.person.phone ?? '').replace(PHONE_PREFIX, ''));
  const [address, setAddress] = useState(profile?.person.address ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const save = async (extra: Record<string, string | null> = {}) => {
    if (!token) return;
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) { setErr(`الهاتف ${PHONE_LOCAL_LENGTH} رقمًا`); return; }
    setBusy(true); setErr('');
    try {
      await updatePriestSelf(supabase, token, { name, title, phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : '', address, ...extra });
      await refresh(); setOk(true); setTimeout(() => setOk(false), 1500);
    } catch (e) { setErr(priestErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="mb-4">
      <h2 className="mb-2 px-1 text-xs font-extrabold text-slate-400">بياناتي</h2>
      <div className="card !p-0 overflow-hidden">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/50">
          <span className="rounded-xl bg-slate-50 p-2"><Pencil className="h-5 w-5 text-violet-600" /></span>
          <span className="flex-1 text-sm font-bold">تعديل بياناتي</span>
        </button>
        {open && (
          <div className="space-y-2 border-t border-indigo-50 p-4">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="relative"><PersonPhoto name={name} url={profile?.person.image_url ?? null} size={56} /><span className="absolute -bottom-1 -left-1 rounded-full bg-violet-600 p-1 text-white"><Camera className="h-3 w-3" /></span></button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setRawImage(URL.createObjectURL(f)); }} />
              <div className="grid flex-1 grid-cols-3 gap-2">
                <input className="input-field !px-2" placeholder="اللقب" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="اللقب" />
                <input className="input-field col-span-2" placeholder="الاسم" value={name} onChange={(e) => setName(e.target.value)} aria-label="الاسم" />
              </div>
            </div>
            <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white" dir="ltr">
              <span className="flex items-center bg-violet-50 px-3 text-sm font-extrabold text-violet-700">{PHONE_PREFIX}</span>
              <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx" value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH} onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
            </div>
            <input className="input-field" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="العنوان" />
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <button type="button" disabled={busy} onClick={() => save()} className="btn-primary flex w-full items-center justify-center gap-1 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <Check className="h-4 w-4" /> : null} حفظ</button>
          </div>
        )}
      </div>
      {rawImage && (
        <PhotoCropModal src={rawImage}
          onDone={async (blob) => { URL.revokeObjectURL(rawImage); setRawImage(''); try { const url = await uploadPhoto(supabase, 'priests', blob, 'priest.webp'); await save({ image_url: url }); } catch { setErr('تعذّر رفع الصورة'); } }}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }} />
      )}
    </section>
  );
}

function ReminderSection() {
  const { profile, token, refresh, reloadAll } = usePriest();
  const [supabase] = useState(() => createClient());
  const [days, setDays] = useState(String(profile?.priest.reminder_days ?? 40));
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    const n = Number(days);
    if (!token || !Number.isInteger(n) || n < 1 || n > 365) { setErr('بين 1 و365'); return; }
    setBusy(true); setErr('');
    try { await setPriestReminderDays(supabase, token, n); await refresh(); reloadAll(); setOk(true); setTimeout(() => setOk(false), 1500); }
    catch (e) { setErr(priestErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="mb-4">
      <h2 className="mb-2 px-1 text-xs font-extrabold text-slate-400">التذكير</h2>
      <div className="card flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-xl bg-slate-50 p-2"><Bell className="h-5 w-5 text-rose-500" /></span>
        <span className="font-bold text-slate-600">تنبيه بعد</span>
        <input type="number" min={1} max={365} className="input-field !w-20 text-center" value={days} onChange={(e) => setDays(e.target.value)} aria-label="عدد الأيام" />
        <span className="font-bold text-slate-600">يومًا بلا اعتراف</span>
        <button type="button" disabled={busy} onClick={save} className="btn-primary !px-3 !py-1.5 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <Check className="h-4 w-4" /> : 'حفظ'}</button>
        {err && <span className="text-xs font-bold text-red-600">{err}</span>}
      </div>
    </section>
  );
}

function PasswordSection() {
  const { token } = usePriest();
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (next.length < 6) return setErr('6 أحرف على الأقل');
    if (next !== confirm) return setErr('كلمتا المرور غير متطابقتين');
    if (!token) return;
    setBusy(true);
    try {
      await priestChangePassword(supabase, token, current, next);
      // 20261003120000: ONE password per person — push it to the servant login too
      await fetch('/api/account/sync-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'priest', token, password: next }),
      }).catch(() => undefined);
      setDone(true); setCurrent(''); setNext(''); setConfirm(''); setTimeout(() => { setDone(false); setOpen(false); }, 1800); }
    catch (er) { setErr(priestErrorMessage(er, 'تعذّر تغيير كلمة المرور')); } finally { setBusy(false); }
  };
  return (
    <section className="mb-4">
      <h2 className="mb-2 px-1 text-xs font-extrabold text-slate-400">الحساب</h2>
      <div className="card !p-0 overflow-hidden">
        <button id="priest-change-password-btn" type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/50">
          <span className="rounded-xl bg-slate-50 p-2"><KeyRound className="h-5 w-5 text-violet-600" /></span>
          <span className="flex-1 min-w-0"><span className="block text-sm font-bold">تغيير كلمة المرور</span><span className="block text-xs text-slate-400">كلمة مرور واحدة لكل حساباتك — تُغلق الجلسات الأخرى تلقائياً</span></span>
        </button>
        {open && (
          <form onSubmit={submit} className="space-y-2 border-t border-indigo-50 p-4">
            <input type="password" className="input-field" dir="ltr" placeholder="كلمة المرور الحالية" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            <input type="password" className="input-field" dir="ltr" placeholder="الجديدة" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={6} />
            <input type="password" className="input-field" dir="ltr" placeholder="تأكيد الجديدة" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            {done && <p className="flex items-center gap-1 text-xs font-bold text-emerald-700"><Check className="h-4 w-4" /> تم التغيير</p>}
            <button type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ'}</button>
          </form>
        )}
      </div>
    </section>
  );
}
