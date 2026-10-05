'use client';

// ---------- CHILD SIGNUP (تسجيل مخدوم جديد) — migration 0042 ----------
// Mirrors the servant wizard:
//   Step 1  الفصل        church → service → class (REQUIRED; pre-filled &
//                        locked from the invite link)
//   Step 2  الكود        typed or scanned QR (or generated) — looked up
//                        through child_signup_lookup_code
//   Step 3  البيانات     name · gender · phone · birthdate · address · notes
//                        + optional photo
//   Step 4  كلمة المرور  password + confirmation
// Submit → RPC child_signup → a PENDING join request the class servant
// reviews in «إدارة المخدومين → الطلبات». The page then polls
// child_signup_status and offers the login button once approved.
//
// 20261004120000: opens ONLY through ?invite=<token> (دعوة مخدوم) — the
// invite's scope is locked and the token is consumed by child_signup. A code
// that already has a child account may enroll in ANOTHER class (same
// password); only the same class is refused (already_registered).

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  UserPlus, Loader2, Lock, ChevronRight, ChevronLeft, MapPin, IdCard, User, KeyRound,
  ScanLine, Wand2, Camera, Trash2, UserCheck, Check, AlertTriangle, Clock, CheckCircle2, XCircle, LogIn,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { LIVE_POLL_MS } from '@/lib/realtime';
import { kindsLabel, type AccountKind, type InviteCheck } from '@/lib/accounts';
import InviteGate, { useSignupInvite } from '@/components/InviteGate';
import ExistingCodeDialog from '@/components/ExistingCodeDialog';
import QrScanner from '@/components/store/QrScanner';
import PhotoCropModal from '@/components/PhotoCropModal';
import { generateCode as renderCode, normalizeCodes, type CodesConfig } from '@/lib/code-templates';
import { uploadPhoto } from '@/lib/upload';
import {
  PHONE_PREFIX, PHONE_LOCAL_LENGTH, GENDER_LABELS,
  type Gender, type Church, type Service, type ClassRoom,
} from '@/lib/types';
import {
  childSignup, childSignupLookupCode, childSignupStatus, childErrorMessage,
  getChildSignupRequest, setChildSignupRequest, type ChildSignupLookup,
} from '@/lib/child-portal';

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const composeBirthdate = (d: string, m: string, y: string): string | null => {
  if (!d || !m || !y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

type Step = 1 | 2 | 3 | 4;
const STEPS: { n: Step; label: string; icon: typeof MapPin }[] = [
  { n: 1, label: 'الفصل', icon: MapPin },
  { n: 2, label: 'الكود', icon: IdCard },
  { n: 3, label: 'البيانات', icon: User },
  { n: 4, label: 'كلمة المرور', icon: KeyRound },
];

export default function ChildSignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
        </div>
      }
    >
      <ChildSignupWizard />
    </Suspense>
  );
}

function ChildSignupWizard() {
  const params = useSearchParams();
  const supabase = createClient();
  const inviteToken = params.get('invite');
  const invite = useSignupInvite(supabase, inviteToken, 'child');
  return (
    <InviteGate invite={invite} kind="child" token={inviteToken}>
      {invite?.valid && <ChildSignupForm invite={invite} inviteToken={inviteToken ?? ''} />}
    </InviteGate>
  );
}

function ChildSignupForm({ invite, inviteToken }: { invite: InviteCheck; inviteToken: string }) {
  const params = useSearchParams();
  const supabase = createClient();

  // ---- Invite scope (locked when present) ----
  const inviteChurch = invite.church_id ?? '';
  const inviteService = invite.service_id ?? '';
  const inviteClass = invite.class_id ?? '';
  const churchLocked = !!inviteChurch;
  const serviceLocked = !!inviteService;
  const classLocked = !!inviteClass;

  const [step, setStep] = useState<Step>(1);

  // ---- pending request (come back to the waiting screen) ----
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => { setRequestId(getChildSignupRequest()); }, []);

  // ---- Step 1: scope ----
  const [churchId, setChurchId] = useState(inviteChurch);
  const [serviceId, setServiceId] = useState(inviteService);
  const [classId, setClassId] = useState(inviteClass);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [structureLoading, setStructureLoading] = useState(true);
  const [codesCfg, setCodesCfg] = useState<CodesConfig | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: ch }, { data: sv }, { data: cl }, { data: cod }] = await Promise.all([
        supabase.from('churches').select('*').order('sort_order').order('name'),
        supabase.from('services').select('*').order('sort_order').order('name'),
        supabase.from('classes').select('*').order('sort_order').order('name'),
        supabase.rpc('code_settings'),
      ]);
      setChurches(ch ?? []);
      setServices(sv ?? []);
      setClasses(cl ?? []);
      setCodesCfg(cod ? normalizeCodes(cod) : null);
      setStructureLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => (!serviceId || c.service_id === serviceId) && (!churchId || c.church_id === churchId));
  const churchName = churches.find((c) => c.id === churchId)?.name;
  const serviceName = services.find((s) => s.id === serviceId)?.name;
  const className = classes.find((c) => c.id === classId)?.name;

  // ---- Step 2: code ----
  // 20261003120000: «تغيير الحساب → إضافة حساب» arrives with ?code=<the person's code>
  const [code, setCode] = useState(params.get('code') ?? '');
  const [showScan, setShowScan] = useState(false);
  const [lookup, setLookup] = useState<ChildSignupLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);

  useEffect(() => {
    const c = code.trim();
    setLookup(null);
    setLookupDone(false);
    if (!c) return;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await childSignupLookupCode(supabase, c);
        setLookup(r);
        if (r.exists && r.name && !name) setName(r.name);
      } catch { setLookup(null); }
      setChecking(false);
      setLookupDone(true);
    }, 450);
    return () => { clearTimeout(t); setChecking(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, supabase]);

  // ---- Step 3: person data ----
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 60 }, (_, i) => currentYear - i), [currentYear]);
  const daysInMonth = useMemo(() => {
    if (!bMonth) return 31;
    const y = Number(bYear) || 2000;
    return new Date(y, Number(bMonth), 0).getDate();
  }, [bMonth, bYear]);
  useEffect(() => {
    if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth));
  }, [daysInMonth, bDay]);

  const phoneValid = !phoneLocal || phoneLocal.length === PHONE_LOCAL_LENGTH;

  // ---- Step 4: password ----
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 20261003120000: a code that already has a password AND a child enrollment =
  // an existing child account (log in). A code with a password but NO child
  // enrollment (servant / priest) → same person, same password, a child
  // account is added after the servant approves.
  // 20261004120000: an existing child account is NOT a blocker any more — the
  // same person may be enrolled in another class (same password); the RPC
  // refuses only the same class.
  const isChildAccount = !!lookup?.has_password && !!lookup?.is_child;
  const linkedAccount = !!lookup?.has_password && !lookup?.family;
  const existingKindList = ([lookup?.is_servant && 'servant', lookup?.is_child && 'child', lookup?.is_priest && 'priest'].filter(Boolean)) as AccountKind[];
  const linkedKinds = kindsLabel(existingKindList);

  // 20261005120000: «الكود مسجّل بالفعل — هل أنت نفس الشخص؟» on step 2; the verified
  // password is reused on step 4
  const [askExisting, setAskExisting] = useState(false);
  const [claimedPassword, setClaimedPassword] = useState('');
  useEffect(() => { setClaimedPassword(''); }, [code]);

  const next = () => {
    setError('');
    if (step === 1) {
      if (!churchId || !serviceId || !classId) return setError('اختر الكنيسة والخدمة والفصل');
      setStep(2);
    } else if (step === 2) {
      if (!code.trim()) return setError('اكتب الكود أو امسحه بالكاميرا أو ولّد كودًا');
      if (lookup?.family) return setError('هذا الكود كود عائلة — لا يمكن استخدامه لشخص، اختر كودًا آخر');
      if (lookup?.pending) return setError('يوجد طلب تسجيل قيد المراجعة لهذا الكود');
      if (linkedAccount && !claimedPassword) { setAskExisting(true); return; }
      setStep(3);
    } else if (step === 3) {
      if (!name.trim()) return setError('اكتب الاسم الكامل');
      if (!phoneValid) return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
      setStep(4);
    }
  };
  const back = () => { setError(''); setStep((s) => (s > 1 ? ((s - 1) as Step) : s)); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    if (password !== confirm) return setError('كلمتا المرور غير متطابقتين');
    setLoading(true);

    let imageUrl: string | null = null;
    if (photoBlob) {
      try { imageUrl = await uploadPhoto(supabase, 'child-requests', photoBlob, 'child.webp'); } catch { /* optional */ }
    }

    try {
      const r = await childSignup(supabase, {
        code,
        name,
        password,
        gender: gender || null,
        birthdate: composeBirthdate(bDay, bMonth, bYear),
        phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        image_url: imageUrl,
        church_id: churchId,
        service_id: serviceId,
        class_id: classId,
        invite: inviteToken,
      });
      setChildSignupRequest(r.request_id);
      setRequestId(r.request_id);
    } catch (err) {
      setError(childErrorMessage(err, 'تعذر إرسال الطلب، حاول مرة أخرى'));
    } finally {
      setLoading(false);
    }
  };

  const selectCls = (locked: boolean) =>
    `input-field ${locked ? 'bg-gold-50 text-gold-800 font-bold pointer-events-none' : ''}`;

  if (requestId) {
    return (
      <PendingScreen
        requestId={requestId}
        onReset={() => { setChildSignupRequest(null); setRequestId(null); setStep(1); }}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <section id="child-signup-card" className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 h-20 w-20 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image src={dioceseLogo(192)} alt={`شعار ${BRANDING.dioceseName}`} width={80} height={80} priority className="h-full w-full object-cover" />
          </div>
          <h1 className="text-2xl font-extrabold">تسجيل مخدوم جديد</h1>
          <p className="mt-1 text-sm text-slate-500">سيراجع خادم الفصل طلبك قبل التفعيل</p>
        </div>

        <ol id="child-signup-steps" className="mb-4 grid grid-cols-4 gap-1">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const done = step > s.n;
            const active = step === s.n;
            return (
              <li key={s.n} className="flex flex-col items-center gap-1">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold transition ${
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-gold-500 text-white shadow ring-4 ring-gold-100' : 'bg-slate-100 text-slate-400'
                }`}>
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className={`text-[11px] font-bold ${active ? 'text-gold-700' : 'text-slate-400'}`}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {(churchLocked || serviceLocked || classLocked) && (
          <div id="child-invite-banner" className="mb-4 flex items-center gap-2 rounded-2xl bg-gradient-to-l from-gold-500 to-gold-700 px-4 py-3 text-sm font-bold text-white">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              دعوة للانضمام إلى: {churchName ?? '...'}
              {serviceName ? ` ← ${serviceName}` : ''}
              {className ? ` ← ${className}` : ''}
            </span>
          </div>
        )}

        <form onSubmit={submit} className="card space-y-4">
          {step === 1 && (
            <section id="cs-step-scope" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <MapPin className="h-4 w-4 text-gold-500" /> الفصل الذي تنتمي إليه *
              </p>
              {structureLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-gold-500" /></div>
              ) : (
                <>
                  <div>
                    <label htmlFor="cs-church" className="mb-1 block text-xs font-bold text-slate-500">الكنيسة</label>
                    <select id="cs-church" className={selectCls(churchLocked)} value={churchId}
                      onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
                      tabIndex={churchLocked ? -1 : 0}>
                      <option value="">اختر الكنيسة</option>
                      {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cs-service" className="mb-1 block text-xs font-bold text-slate-500">الخدمة</label>
                    <select id="cs-service" className={selectCls(serviceLocked)} value={serviceId}
                      onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
                      disabled={!churchId} tabIndex={serviceLocked ? -1 : 0}>
                      <option value="">{churchId ? 'اختر الخدمة' : 'اختر الكنيسة أولاً'}</option>
                      {scopedServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cs-class" className="mb-1 block text-xs font-bold text-slate-500">الفصل</label>
                    <select id="cs-class" className={selectCls(classLocked)} value={classId}
                      onChange={(e) => setClassId(e.target.value)}
                      disabled={!serviceId} tabIndex={classLocked ? -1 : 0}>
                      <option value="">{serviceId ? 'اختر الفصل' : 'اختر الخدمة أولاً'}</option>
                      {scopedClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </>
              )}
            </section>
          )}

          {step === 2 && (
            <section id="cs-step-code" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <IdCard className="h-4 w-4 text-gold-500" /> الكود (كود الكارت / الرقم القومي)
              </p>
              <p className="text-xs text-slate-400">هو نفسه اسم الدخول للبوابة. اكتبه أو امسح الكارت بالكاميرا — وإن لم يكن لديك كارت ولّد كودًا.</p>
              <div className="flex gap-2">
                <input id="cs-code" className="input-field flex-1" dir="ltr" placeholder="اكتب الكود"
                  value={code} onChange={(e) => setCode(e.target.value)} autoComplete="username" />
                <button id="cs-code-generate" type="button" onClick={() => setCode(renderCode(codesCfg, 'person', { churchId, serviceId, classId }))}
                  aria-label="توليد كود تلقائي" title="توليد كود تلقائي"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500 text-white shadow transition hover:bg-gold-600 active:scale-95">
                  <Wand2 className="h-5 w-5" />
                </button>
                <button id="cs-code-scan" type="button" onClick={() => setShowScan((v) => !v)}
                  aria-label="مسح الكود بالكاميرا" title="مسح الكود بالكاميرا" aria-pressed={showScan}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow transition active:scale-95 ${showScan ? 'bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
                  <ScanLine className="h-5 w-5" />
                </button>
              </div>

              {showScan && (
                <QrScanner
                  idPrefix="cs"
                  autoStart
                  hint="وجّه الكاميرا إلى كود الـ QR على الكارت"
                  onCode={(v) => { const t = v.trim(); if (t) { setCode(t); setShowScan(false); } }}
                />
              )}

              {checking && (
                <p className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الكود...
                </p>
              )}
              {lookupDone && lookup?.exists && !lookup.family && !lookup.pending && (
                <div className="rounded-xl bg-emerald-50 px-3 py-2">
                  <p className="flex items-center gap-1 text-xs font-extrabold text-emerald-700">
                    <UserCheck className="h-4 w-4" /> {linkedAccount ? 'شخص' : 'مخدوم'} مسجّل بالفعل: {lookup.name}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-emerald-600">
                    {isChildAccount
                      ? 'لديه حساب مخدوم — سيُضاف تسجيل في هذا الفصل لنفس الشخص بنفس كلمة المرور بعد موافقة الخادم (لا يمكن التسجيل في فصله الحالي مرة أخرى)'
                      : linkedAccount
                      ? `لديه حساب ${linkedKinds} — سيُضاف حساب المخدوم لنفس الشخص بنفس كلمة المرور بعد موافقة الخادم`
                      : 'سيُربط حسابك بنفس المخدوم بعد موافقة الخادم'}
                  </p>
                </div>
              )}
              {lookupDone && lookup?.family && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>هذا الكود كود عائلة — لا يمكن أن يكون كود شخص. استخدم كودًا آخر.</span>
                </div>
              )}
              {lookupDone && lookup?.pending && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>يوجد طلب تسجيل قيد المراجعة لهذا الكود — انتظر رد الخادم.</span>
                </div>
              )}
              {lookupDone && lookup && !lookup.exists && !lookup.family && code.trim() && (
                <p className="text-[11px] font-bold text-slate-400">كود جديد — ستُدخل بياناتك في الخطوة التالية</p>
              )}
              {claimedPassword && (
                <p className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> تم التحقق — سيُضاف التسجيل لنفس الشخص بكلمة مروره الحالية بعد موافقة الخادم
                </p>
              )}
            </section>
          )}

          {step === 3 && (
            <section id="cs-step-data" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <User className="h-4 w-4 text-gold-500" /> البيانات الشخصية
              </p>

              <div className="flex items-center gap-3">
                <button id="cs-photo" type="button" onClick={() => fileInputRef.current?.click()}
                  className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gold-50 ring-2 ring-gold-100 transition active:scale-95">
                  {photoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="صورتي" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-8 w-8 text-gold-400" />
                  )}
                </button>
                <div className="text-xs">
                  <p className="font-extrabold text-slate-600">الصورة الشخصية <span className="font-normal text-slate-400">(اختياري)</span></p>
                  {photoBlob && (
                    <button type="button" onClick={() => { setPhotoBlob(null); if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview); setPhotoPreview(''); }}
                      className="mt-1 flex items-center gap-1 font-bold text-red-500">
                      <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setRawImage(URL.createObjectURL(f)); }} />
              </div>

              <div>
                <label htmlFor="cs-name" className="mb-1 block text-xs font-bold text-slate-500">الاسم الكامل *</label>
                <input id="cs-name" className="input-field" placeholder="مثال: مينا صموئيل" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
                <div className="grid grid-cols-2 gap-2">
                  <button id="cs-gender-male" type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')}
                    className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${gender === 'male' ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300' : 'bg-primary-50 text-primary-600'}`}>
                    {GENDER_LABELS.male} 👦
                  </button>
                  <button id="cs-gender-female" type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')}
                    className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${gender === 'female' ? 'bg-pink-500 text-white shadow ring-2 ring-pink-300' : 'bg-pink-50 text-pink-500'}`}>
                    {GENDER_LABELS.female} 👧
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="cs-phone" className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف</label>
                <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-gold-300" dir="ltr">
                  <span className="flex items-center bg-gold-50 px-3 text-sm font-extrabold text-gold-700">{PHONE_PREFIX}</span>
                  <input id="cs-phone" type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
                    value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
                    onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
                </div>
                {phoneLocal && !phoneValid && (
                  <p className="mt-1 text-[11px] font-bold text-red-500">الرقم يجب أن يكون {PHONE_LOCAL_LENGTH} رقمًا ({phoneLocal.length}/{PHONE_LOCAL_LENGTH})</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
                <div className="grid grid-cols-3 gap-2">
                  <select id="cs-birth-day" aria-label="اليوم" className="input-field !px-2 text-center" value={bDay} onChange={(e) => setBDay(e.target.value)}>
                    <option value="">اليوم</option>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select id="cs-birth-month" aria-label="الشهر" className="input-field !px-2 text-center" value={bMonth} onChange={(e) => setBMonth(e.target.value)}>
                    <option value="">الشهر</option>
                    {MONTHS_AR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select id="cs-birth-year" aria-label="السنة" className="input-field !px-2 text-center" value={bYear} onChange={(e) => setBYear(e.target.value)}>
                    <option value="">السنة</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="cs-address" className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
                <input id="cs-address" className="input-field" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cs-notes" className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
                <textarea id="cs-notes" className="input-field min-h-[70px]" placeholder="أي ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </section>
          )}

          {step === 4 && (
            <section id="cs-step-password" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <KeyRound className="h-4 w-4 text-gold-500" /> كلمة المرور
              </p>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <p>الاسم: <b className="text-slate-700">{name}</b></p>
                <p dir="ltr" className="text-right">الكود: <b className="text-slate-700">{code.trim()}</b></p>
                <p>الفصل: <b className="text-slate-700">{[churchName, serviceName, className].filter(Boolean).join(' ← ')}</b></p>
              </div>
              {linkedAccount && (
                <p id="cs-linked-hint" className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                  هذا الكود له حساب {linkedKinds} بالفعل — للشخص الواحد كلمة مرور واحدة لكل حساباته. اكتب كلمة مرورك الحالية هنا.
                </p>
              )}
              <div>
                <label htmlFor="cs-password" className="mb-1 block text-xs font-bold text-slate-500">{linkedAccount ? 'كلمة المرور الحالية *' : 'كلمة المرور *'}</label>
                <input id="cs-password" type="password" className="input-field" placeholder="••••••••" dir="ltr"
                  value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={linkedAccount ? 'current-password' : 'new-password'} minLength={6} />
              </div>
              <div>
                <label htmlFor="cs-confirm" className="mb-1 block text-xs font-bold text-slate-500">تأكيد كلمة المرور *</label>
                <input id="cs-confirm" type="password" className="input-field" placeholder="••••••••" dir="ltr"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                {confirm && confirm !== password && <p className="mt-1 text-[11px] font-bold text-red-500">كلمتا المرور غير متطابقتين</p>}
              </div>
            </section>
          )}

          {error && (
            <p id="child-signup-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            {step > 1 && (
              <button id="cs-back" type="button" onClick={back} className="btn-secondary flex items-center justify-center gap-1 !px-4">
                <ChevronRight className="h-4 w-4" /> السابق
              </button>
            )}
            {step < 4 ? (
              <button id="cs-next" type="button" onClick={next} disabled={step === 1 && structureLoading}
                className="btn-primary flex flex-1 items-center justify-center gap-1 !bg-gradient-to-br !from-gold-500 !to-gold-700">
                التالي <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <button id="cs-submit" type="submit" disabled={loading} className="btn-primary flex flex-1 items-center justify-center gap-2 !bg-gradient-to-br !from-gold-500 !to-gold-700">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                إرسال طلب التسجيل
              </button>
            )}
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          لديك حساب بالفعل؟{' '}
          <Link href="/login?as=child" className="font-bold text-gold-700 hover:underline">تسجيل الدخول</Link>
        </p>
      </section>

      {askExisting && (
        <ExistingCodeDialog
          code={code.trim()}
          name={lookup?.name}
          kinds={existingKindList}
          approverLabel="خادم الفصل"
          onVerified={(pw) => { setClaimedPassword(pw); setPassword(pw); setConfirm(pw); setAskExisting(false); setStep(3); }}
          onChangeCode={() => { setAskExisting(false); setCode(''); setLookup(null); setLookupDone(false); }}
          onClose={() => setAskExisting(false)}
        />
      )}

      {rawImage && (
        <PhotoCropModal
          src={rawImage}
          onDone={(blob) => {
            if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
            setPhotoBlob(blob);
            setPhotoPreview(URL.createObjectURL(blob));
            URL.revokeObjectURL(rawImage);
            setRawImage('');
          }}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }}
        />
      )}
    </main>
  );
}

/** Waiting screen — polls the request status every 15 s and on focus. */
function PendingScreen({ requestId, onReset }: { requestId: string; onReset: () => void }) {
  const supabase = createClient();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'missing'>('pending');
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      setChecking(true);
      try {
        const r = await childSignupStatus(supabase, requestId);
        if (!alive) return;
        if (!r) { setStatus('missing'); return; }
        setStatus(r.status);
        setNote(r.decision_note);
        setCode(r.code);
      } catch {
        if (alive) setStatus('missing');
      } finally {
        if (alive) setChecking(false);
      }
    };
    check();
    const t = setInterval(() => { if (document.visibilityState === 'visible') check(); }, LIVE_POLL_MS.signup); // live wait screen: 45 s, visible only
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [requestId, supabase]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <section id="child-signup-pending" className="card w-full max-w-md space-y-4 text-center">
        {status === 'pending' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-500">
              <Clock className="h-8 w-8" />
            </span>
            <h1 className="text-xl font-extrabold">طلبك قيد المراجعة</h1>
            <p className="text-sm text-slate-500">سيراجع خادم الفصل طلبك ويُفعّل حسابك. تُحدَّث هذه الصفحة تلقائياً.</p>
            {code && <p className="text-xs text-slate-400" dir="ltr">الكود: <b>{code}</b></p>}
            {checking && <Loader2 className="mx-auto h-5 w-5 animate-spin text-amber-500" />}
          </>
        )}
        {status === 'approved' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <h1 className="text-xl font-extrabold">تم قبول طلبك 🎉</h1>
            <p className="text-sm text-slate-500">يمكنك الآن الدخول إلى البوابة بكودك وكلمة المرور التي اخترتها.</p>
            <Link
              id="cs-go-login"
              href={`/login?as=child&code=${encodeURIComponent(code)}`}
              onClick={() => setChildSignupRequest(null)}
              className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-gold-500 !to-gold-700"
            >
              <LogIn className="h-5 w-5" /> تسجيل الدخول
            </Link>
          </>
        )}
        {status === 'rejected' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
              <XCircle className="h-8 w-8" />
            </span>
            <h1 className="text-xl font-extrabold">تم رفض الطلب</h1>
            {note && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{note}</p>}
            <p className="text-sm text-slate-500">تواصل مع خادم فصلك، أو أعد التسجيل بالبيانات الصحيحة.</p>
            <button id="cs-retry" type="button" onClick={onReset} className="btn-secondary w-full">تسجيل جديد</button>
          </>
        )}
        {status === 'missing' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <AlertTriangle className="h-8 w-8" />
            </span>
            <h1 className="text-xl font-extrabold">لم نجد الطلب</h1>
            <p className="text-sm text-slate-500">ربما حُذف الطلب. يمكنك التسجيل مجدداً.</p>
            <button type="button" onClick={onReset} className="btn-secondary w-full">تسجيل جديد</button>
          </>
        )}
        <p className="text-xs text-slate-400">
          <Link href="/login?as=child" className="font-bold text-gold-700 hover:underline">الرجوع لصفحة الدخول</Link>
        </p>
      </section>
    </main>
  );
}
