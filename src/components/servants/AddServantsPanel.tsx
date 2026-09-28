'use client';

// ---------- إدارة الخدام → إضافة خدام (فردي / جماعي) — migration 0041 ----------
// A manager ADDS servants himself instead of waiting for them to sign up:
//   • فردي  — one form: role + scope → code (typed / scanned / generated)
//             → person data (same rules as a child) → password → profiles.
//   • جماعي — Excel / pasted table → column mapping → options → preview →
//             import; credentials (code + password) exported as Excel.
// Both call POST /api/servants/create (server: auth admin + RPC
// admin_add_servant). The servant is APPROVED immediately and logs in with
// code + password.

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  UserPlus, Users, Loader2, Wand2, ScanLine, Camera, Trash2, IdCard, Eye, EyeOff,
  Check, AlertTriangle, UserCheck, Copy, RefreshCw, ShieldCheck, MapPin, User, Lock,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { useCodeGenerator } from '@/lib/customization-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { generatePassword } from '@/lib/bulk-import';
import QrScanner from '@/components/store/QrScanner';
import PhotoCropModal from '@/components/PhotoCropModal';
import BulkAddServants from '@/components/servants/BulkAddServants';
import { useServantScope, RoleScopeFields, ProfileChips, postAddServants, outcomeLabel } from '@/components/servants/AddServantBits';
import {
  GENDER_LABELS, PHONE_PREFIX, PHONE_LOCAL_LENGTH, codeToUserId, DEFAULT_PASSWORD,
  type Church, type Service, type ClassRoom, type Gender, type ServantEnrollment, type AdminCodeLookup,
} from '@/lib/types';

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

type Mode = 'single' | 'bulk';

export default function AddServantsPanel({ onAdded }: { onAdded?: () => void }) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>('single');
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [{ data: ch }, { data: sv }, { data: cl }] = await Promise.all([
        supabase.from('churches').select('*').order('sort_order').order('name'),
        supabase.from('services').select('*').order('sort_order').order('name'),
        supabase.from('classes').select('*').order('sort_order').order('name'),
      ]);
      setChurches(ch ?? []); setServices(sv ?? []); setClasses(cl ?? []);
      setLoading(false);
    })();
  }, [profile?.status, supabase]);

  if (!profile) return null;

  return (
    <div className="space-y-4 pb-6">
      <div id="add-servants-mode" className="grid grid-cols-2 gap-1 rounded-2xl bg-indigo-50 p-1">
        <button id="add-mode-single" onClick={() => setMode('single')} aria-pressed={mode === 'single'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${mode === 'single' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
          <UserPlus className="h-4 w-4" /> إضافة فردية
        </button>
        <button id="add-mode-bulk" onClick={() => setMode('bulk')} aria-pressed={mode === 'bulk'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${mode === 'bulk' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
          <Users className="h-4 w-4" /> إضافة جماعية
        </button>
      </div>

      <p className="flex items-start gap-2 rounded-2xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        الخادم المُضاف هنا يُعتمد فورًا ويدخل التطبيق بالكود وكلمة المرور — بدون طلب انضمام.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : mode === 'single' ? (
        <SingleAddServant approver={profile} churches={churches} services={services} classes={classes} onAdded={onAdded} />
      ) : (
        <BulkAddServants approver={profile} churches={churches} services={services} classes={classes} onAdded={onAdded} />
      )}
    </div>
  );
}

// =====================================================================
// فردي — one servant
// =====================================================================
function SingleAddServant({
  approver, churches, services, classes, onAdded,
}: {
  approver: ServantEnrollment; churches: Church[]; services: Service[]; classes: ClassRoom[]; onAdded?: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const { profiles: permissionProfiles, reload: reloadPermissions } = usePermissions();
  const scope = useServantScope(approver, churches, services, classes);
  const genCode = useCodeGenerator('servant');

  // ---- code ----
  const [code, setCode] = useState('');
  const [showScan, setShowScan] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [lookup, setLookup] = useState<AdminCodeLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!code.trim()) { setQrDataUrl(''); return; }
    QRCode.toDataURL(code.trim(), { width: 240, margin: 1 }).then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, [code]);

  useEffect(() => {
    const c = code.trim();
    setLookup(null); setPrefilled(false);
    if (!c) return;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('admin_servant_code_lookup', { p_code: c });
      setLookup((data as AdminCodeLookup | null) ?? null);
      setChecking(false);
    }, 400);
    return () => { clearTimeout(t); setChecking(false); };
  }, [code, supabase]);

  // ---- person data ----
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // ---- photo ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const fillFromLookup = (p: NonNullable<AdminCodeLookup['person']>) => {
    setName(p.name ?? '');
    setGender(p.gender ?? '');
    setPhoneLocal(p.phone ? p.phone.replace(/^\+2/, '').replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH) : '');
    if (p.birthdate) {
      const [y, m, d] = p.birthdate.split('-');
      setBYear(String(Number(y))); setBMonth(String(Number(m))); setBDay(String(Number(d)));
    }
    setAddress(p.address ?? '');
    setNotes(p.notes ?? '');
    if (p.image_url && !photoBlob) setPhotoPreview(p.image_url);
    setPrefilled(true);
  };

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 80 }, (_, i) => currentYear - 10 - i), [currentYear]);
  const daysInMonth = useMemo(() => (bMonth ? new Date(Number(bYear) || 2000, Number(bMonth), 0).getDate() : 31), [bMonth, bYear]);
  useEffect(() => { if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth)); }, [daysInMonth, bDay]);

  // ---- password + profiles ----
  // 0043: the DEFAULT password (000000) — the manager may generate / type another
  const [password, setPassword] = useState<string>(DEFAULT_PASSWORD);
  const [showPw, setShowPw] = useState(true);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ name: string; code: string; password: string } | null>(null);

  const phoneValid = phoneLocal === '' || phoneLocal.length === PHONE_LOCAL_LENGTH;
  const loginTaken = !!lookup?.login_taken || !!lookup?.person?.has_account;
  // 20260930120000: a person code can never equal a FAMILY code
  const familyOwner = lookup?.family ?? null;

  const resetForm = () => {
    setCode(''); setLookup(null); setPrefilled(false);
    setName(''); setGender(''); setPhoneLocal(''); setBDay(''); setBMonth(''); setBYear('');
    setAddress(''); setNotes('');
    setPhotoBlob(null); if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview); setPhotoPreview('');
    setPassword(DEFAULT_PASSWORD); setSelectedProfiles([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setDone(null);
    const scopeErr = scope.validate();
    if (scopeErr) return setError(scopeErr);
    if (!code.trim()) return setError('اكتب الكود أو امسحه أو ولّد كودًا');
    if (familyOwner) return setError(`هذا الكود كود عائلة «${familyOwner}» — لا يمكن استخدامه لشخص`);
    if (loginTaken) return setError('هذا الكود مرتبط بحساب خادم بالفعل');
    if (!name.trim()) return setError('اكتب الاسم الكامل');
    if (!phoneValid) return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
    if (password.length < 6) return setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');

    setSaving(true);
    let imageUrl: string | null = null;
    if (photoBlob) {
      try { imageUrl = await uploadPhoto(supabase, 'servants', photoBlob, 'servant.webp'); } catch { /* optional */ }
    }
    const [outcome] = await postAddServants([{
      code: code.trim(),
      full_name: name.trim(),
      password,
      role: scope.role,
      ...scope.payloadScope,
      gender: gender || null,
      birthdate: bDay && bMonth && bYear ? `${bYear}-${String(bMonth).padStart(2, '0')}-${String(bDay).padStart(2, '0')}` : null,
      phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      image_url: imageUrl,
      profile_ids: selectedProfiles,
    }]);
    setSaving(false);
    if (!outcome.ok) { setError(outcomeLabel(outcome)); return; }
    setDone({ name: name.trim(), code: outcome.national_id, password });
    resetForm();
    await reloadPermissions();
    onAdded?.();
  };

  const copyCreds = async () => {
    if (!done) return;
    try { await navigator.clipboard.writeText(`${done.name}\nالكود: ${done.code}\nكلمة المرور: ${done.password}`); } catch { /* ignore */ }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {done && (
        <div id="add-done" className="card space-y-2 !border-emerald-200 !bg-emerald-50">
          <p className="flex items-center gap-2 text-sm font-extrabold text-emerald-700">
            <UserCheck className="h-5 w-5" /> تمت إضافة {done.name} واعتماده
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs" dir="ltr">
            <div className="rounded-xl bg-white px-3 py-2">
              <p className="text-[10px] font-bold text-slate-400">الكود / اسم الدخول</p>
              <p className="font-mono font-extrabold text-slate-700 break-all">{done.code}</p>
            </div>
            <div className="rounded-xl bg-white px-3 py-2">
              <p className="text-[10px] font-bold text-slate-400">كلمة المرور</p>
              <p className="font-mono font-extrabold text-slate-700 break-all">{done.password}</p>
            </div>
          </div>
          <p className="text-[11px] font-bold text-emerald-600">سلّم هذه البيانات للخادم — تظهر مرة واحدة فقط.</p>
          <button type="button" id="add-copy-creds" onClick={copyCreds}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-200">
            <Copy className="h-3.5 w-3.5" /> نسخ البيانات
          </button>
        </div>
      )}

      {/* 1 — role + scope */}
      <div className="card space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <MapPin className="h-4 w-4 text-primary-500" /> ١ · الدور ومكان الخدمة
        </p>
        <RoleScopeFields scope={scope} approver={approver} churches={churches} services={services} classes={classes} idPrefix="add" />
      </div>

      {/* 2 — code */}
      <div className="card space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <IdCard className="h-4 w-4 text-primary-500" /> ٢ · الكود <span className="text-xs font-normal text-slate-400">(= اسم الدخول)</span>
        </p>
        <div className="flex gap-2">
          <input id="add-code" className="input-field flex-1" dir="ltr" placeholder="اكتب الكود أو الرقم القومي"
            value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <button id="add-code-generate" type="button"
            onClick={() => setCode(genCode({ churchId: scope.churchId, serviceId: scope.serviceId, classId: scope.classId }))}
            aria-label="توليد كود" title="توليد كود"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95">
            <Wand2 className="h-5 w-5" />
          </button>
          <button id="add-code-scan" type="button" onClick={() => setShowScan((v) => !v)} aria-pressed={showScan}
            aria-label="مسح الكود بالكاميرا" title="مسح الكود بالكاميرا"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow transition active:scale-95 ${showScan ? 'bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
            <ScanLine className="h-5 w-5" />
          </button>
        </div>
        {showScan && (
          <QrScanner idPrefix="add-servant" autoStart hint="وجّه الكاميرا إلى كود الـ QR على الكارت"
            onCode={(v) => { const t = v.trim(); if (t) { setCode(t); setShowScan(false); } }} />
        )}
        {checking && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الكود...</p>
        )}
        {familyOwner && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> هذا الكود كود عائلة «{familyOwner}» — لا يمكن استخدامه لشخص.
          </p>
        )}
        {lookup && loginTaken && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> هذا الكود مرتبط بحساب خادم بالفعل — استخدم كودًا آخر.
          </p>
        )}
        {lookup && !loginTaken && lookup.person && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2">
            <p className="flex items-center gap-1 text-xs font-extrabold text-emerald-700">
              <UserCheck className="h-4 w-4" /> شخص مسجّل: {lookup.person.name}
            </p>
            {!prefilled && (
              <button type="button" id="add-prefill" onClick={() => lookup.person && fillFromLookup(lookup.person)}
                className="rounded-lg bg-white px-2 py-1 text-[11px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">
                تعبئة بياناته
              </button>
            )}
          </div>
        )}
        {code.trim() && (
          <div className="flex items-center gap-3">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR" className="h-16 w-16 rounded-lg ring-1 ring-slate-200" />
            )}
            <p className="text-[11px] text-slate-400" dir="ltr">اسم الدخول: <b>{codeToUserId(code)}</b></p>
          </div>
        )}
      </div>

      {/* 3 — person data */}
      <div className="card space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <User className="h-4 w-4 text-primary-500" /> ٣ · البيانات الشخصية
        </p>
        <div className="flex items-center gap-3">
          <button id="add-photo" type="button" onClick={() => fileInputRef.current?.click()}
            className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-50 ring-2 ring-primary-100 transition active:scale-95">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="الصورة" className="h-full w-full object-cover" />
            ) : <Camera className="h-7 w-7 text-primary-400" />}
          </button>
          <div className="text-xs">
            <p className="font-extrabold text-slate-600">الصورة <span className="font-normal text-slate-400">(اختياري)</span></p>
            {photoBlob && (
              <button type="button" onClick={() => { setPhotoBlob(null); if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview); setPhotoPreview(''); }}
                className="mt-1 flex items-center gap-1 font-bold text-red-500"><Trash2 className="h-3.5 w-3.5" /> إزالة</button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setRawImage(URL.createObjectURL(f)); }} />
        </div>

        <input id="add-name" className="input-field" placeholder="الاسم الكامل *" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="grid grid-cols-2 gap-2">
          <button id="add-gender-male" type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')}
            className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'male' ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}>
            {GENDER_LABELS.male}
          </button>
          <button id="add-gender-female" type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')}
            className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'female' ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-500'}`}>
            {GENDER_LABELS.female}
          </button>
        </div>

        <div className={`flex items-stretch overflow-hidden rounded-xl border bg-white focus-within:ring-2 focus-within:ring-primary-300 ${phoneValid ? 'border-indigo-100' : 'border-red-300'}`} dir="ltr">
          <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">{PHONE_PREFIX}</span>
          <input id="add-phone" type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
            value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
            onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
          <div className="grid grid-cols-3 gap-2">
            <select id="add-bday" className="input-field" value={bDay} onChange={(e) => setBDay(e.target.value)}>
              <option value="">يوم</option>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select id="add-bmonth" className="input-field" value={bMonth} onChange={(e) => setBMonth(e.target.value)}>
              <option value="">شهر</option>
              {MONTHS_AR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select id="add-byear" className="input-field" value={bYear} onChange={(e) => setBYear(e.target.value)}>
              <option value="">سنة</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <input id="add-address" className="input-field" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
        <textarea id="add-notes" className="input-field min-h-[56px]" placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {/* 4 — password + profiles */}
      <div className="card space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <Lock className="h-4 w-4 text-primary-500" /> ٤ · كلمة المرور والصلاحيات
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input id="add-password" type={showPw ? 'text' : 'password'} className="input-field pl-10 font-mono" dir="ltr"
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} />
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'إخفاء' : 'إظهار'}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button id="add-password-generate" type="button" onClick={() => { setPassword(generatePassword()); setShowPw(true); }}
            aria-label="توليد كلمة مرور" title="توليد كلمة مرور"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 active:scale-95">
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
        <p className="text-[11px] font-bold text-slate-400">
          الافتراضية <b dir="ltr">{DEFAULT_PASSWORD}</b> — 6 أحرف على الأقل؛ يغيّرها الخادم لاحقًا من ملفه (القديمة + الجديدة)، أو يعيد مسؤوله تعيينها.
          {password !== DEFAULT_PASSWORD && (
            <button type="button" onClick={() => { setPassword(DEFAULT_PASSWORD); setShowPw(true); }} className="mr-1 text-primary-600 underline">استخدم الافتراضية</button>
          )}
        </p>
        <ProfileChips profiles={permissionProfiles} selected={selectedProfiles} idPrefix="add"
          onToggle={(id) => setSelectedProfiles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

      <button id="add-submit" type="submit" disabled={saving || loginTaken || !!familyOwner} className="btn-primary w-full flex items-center justify-center gap-2">
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
        إضافة الخادم واعتماده
      </button>

      {rawImage && (
        <PhotoCropModal src={rawImage}
          onDone={(blob) => {
            if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
            setPhotoBlob(blob); setPhotoPreview(URL.createObjectURL(blob));
            URL.revokeObjectURL(rawImage); setRawImage('');
          }}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }} />
      )}
    </form>
  );
}
