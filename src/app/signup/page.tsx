'use client';

// ---------- SERVANT SIGNUP (تسجيل خادم جديد) — architecture 0037 ----------
// The servant is a PERSON first (same identity table as the children), then
// a *servant enrollment* bound to church → service → class.
//
//   Step 1  مكان الخدمة   ONE OR MORE places church → service → class (0045:
//                         `ScopePicker` — the servant may pick every class he
//                         serves in, even across churches; the first one is
//                         the primary place). The invite link pre-fills the
//                         first place and locks the church / service.
//   Step 2  الكود         typed or scanned QR — looked up in `persons` and,
//                         when known, the data is pre-filled
//   Step 3  البيانات      name · gender · phone · birthdate · address · notes
//                         (same rules as adding a child) + optional photo
//   Step 4  كلمة المرور   password + confirmation
//
// Submit: auth.signUp (login name = the code) → RPC `servant_signup` which
// upserts the person by code and creates the PENDING servant enrollment.
//
// 20261004120000: the page opens ONLY through ?invite=<token> generated in
// the app (دعوة خادم). The invite's scope is locked; the token is passed as
// p_invite and consumed by the RPC.

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  UserPlus, Loader2, Lock, ChevronRight, ChevronLeft, MapPin, IdCard, User, KeyRound,
  ScanLine, Wand2, Camera, Trash2, UserCheck, Check, AlertTriangle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QrScanner from '@/components/store/QrScanner';
import PhotoCropModal from '@/components/PhotoCropModal';
import ScopePicker, { scopeLabel } from '@/components/ScopePicker';
import { generateCode as renderCode, normalizeCodes, type CodesConfig } from '@/lib/code-templates';
import { uploadPhoto } from '@/lib/upload';
import {
  userIdToEmail, codeToUserId, PHONE_PREFIX, PHONE_LOCAL_LENGTH, GENDER_LABELS,
  type Gender, type Church, type Service, type ClassRoom, type SignupCodeLookup, type ServantSignupResult, type ScopeRef,
} from '@/lib/types';
import { verifyPersonPassword, existingKinds, kindsLabel, checkSignupInvite, type InviteCheck } from '@/lib/accounts';
import InviteGate, { useSignupInvite } from '@/components/InviteGate';
import ExistingCodeDialog from '@/components/ExistingCodeDialog';

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
  { n: 1, label: 'مكان الخدمة', icon: MapPin },
  { n: 2, label: 'الكود', icon: IdCard },
  { n: 3, label: 'البيانات', icon: User },
  { n: 4, label: 'كلمة المرور', icon: KeyRound },
];

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      }
    >
      <SignupWizard />
    </Suspense>
  );
}

function SignupWizard() {
  const params = useSearchParams();
  const supabase = createClient();

  // ---- 20261004120000: invite-only — ?invite=<token> must be valid ----
  const inviteToken = params.get('invite');
  const invite = useSignupInvite(supabase, inviteToken, 'servant');
  return (
    <InviteGate invite={invite} kind="servant" token={inviteToken}>
      {invite?.valid && <SignupForm invite={invite} inviteToken={inviteToken ?? ''} />}
    </InviteGate>
  );
}

function SignupForm({ invite, inviteToken }: { invite: InviteCheck; inviteToken: string }) {
  const params = useSearchParams();
  const supabase = createClient();

  // ---- Invite scope (locked when present — the DB applies it anyway) ----
  const inviteChurch = invite.church_id ?? '';
  const inviteService = invite.service_id ?? '';
  const inviteClass = invite.class_id ?? '';
  const churchLocked = !!inviteChurch;
  const serviceLocked = !!inviteService;
  const classLocked = !!inviteClass;

  const [step, setStep] = useState<Step>(1);

  // ---- Step 1: places (0045 — several) ----
  const [scopes, setScopes] = useState<ScopeRef[]>(
    inviteChurch ? [{ church_id: inviteChurch, service_id: inviteService || null, class_id: inviteClass || null }] : []
  );
  // the primary place (first) — used for the code generator + the summary
  const churchId = scopes[0]?.church_id ?? '';
  const serviceId = scopes[0]?.service_id ?? '';
  const classId = scopes[0]?.class_id ?? '';
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [structureLoading, setStructureLoading] = useState(true);
  // the owner's نظام الأكواد — read through the anon-safe RPC (no account yet); null = built-in generator
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

  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);
  const churchName = churches.find((c) => c.id === churchId)?.name;
  const serviceName = services.find((s) => s.id === serviceId)?.name;
  const className = classes.find((c) => c.id === classId)?.name;

  // ---- Step 2: code ----
  // 20261003120000: «تغيير الحساب → إضافة حساب» arrives with ?code=<the person's code>
  const [code, setCode] = useState(params.get('code') ?? '');
  const [showScan, setShowScan] = useState(false);
  const [lookup, setLookup] = useState<SignupCodeLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);

  useEffect(() => {
    const c = code.trim();
    setLookup(null);
    setLookupDone(false);
    if (!c) return;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('signup_lookup_code', { p_code: c });
      setLookup((data as SignupCodeLookup | null) ?? null);
      setChecking(false);
      setLookupDone(true);
    }, 450);
    return () => { clearTimeout(t); setChecking(false); };
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
  const [prefilled, setPrefilled] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const fillFromLookup = (p: SignupCodeLookup) => {
    setName(p.name ?? '');
    setGender(p.gender ?? '');
    setPhoneLocal(p.phone ? p.phone.replace(/^\+2/, '').replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH) : '');
    if (p.birthdate) {
      const [y, m, d] = p.birthdate.split('-');
      setBYear(String(Number(y))); setBMonth(String(Number(m))); setBDay(String(Number(d)));
    }
    setAddress(p.address ?? '');
    if (p.image_url && !photoPreview) setPhotoPreview(p.image_url);
    setPrefilled(true);
  };

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 80 }, (_, i) => currentYear - 10 - i), [currentYear]);
  const daysInMonth = useMemo(() => {
    if (!bMonth) return 31;
    const y = Number(bYear) || 2000;
    return new Date(y, Number(bMonth), 0).getDate();
  }, [bMonth, bYear]);
  useEffect(() => {
    if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth));
  }, [daysInMonth, bDay]);

  const phoneValid = phoneLocal.length === PHONE_LOCAL_LENGTH;

  // 20261003120000: the code already belongs to a person WITH a password
  // (child / priest account) → same person, same password, new servant account
  const linkedAccount = !!lookup && !lookup.family && !lookup.has_account && !!lookup.has_password;
  const linkedKinds = kindsLabel(existingKinds(lookup as never));

  // ---- Step 4: password ----
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // 20261005120000: «الكود مسجّل بالفعل — هل أنت نفس الشخص؟» dialog on step 2.
  // Verified password → it is reused on step 4 (one password per person).
  const [askExisting, setAskExisting] = useState(false);
  const [claimedPassword, setClaimedPassword] = useState('');
  useEffect(() => { setClaimedPassword(''); }, [code]);

  // 20261006120000: the code ALREADY owns a servant account and he opened
  // another invite link (another service / class) → after proving the
  // password we sign him in and file a servant_scope_request for the new
  // places (approved by the responsible person). No second account.
  const [requested, setRequested] = useState<{ requested: number; skipped: number } | null>(null);
  const requestMorePlaces = async (pw: string) => {
    setError('');
    setLoading(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: userIdToEmail(codeToUserId(code)), password: pw });
      if (signErr) throw new Error('bad_login');
      const { data, error: rpcErr } = await supabase.rpc('servant_request_scopes', {
        p_scopes: scopes.length ? scopes : null,
        p_invite: inviteToken || null,
      });
      if (rpcErr) throw rpcErr;
      setRequested((data ?? { requested: 0, skipped: 0 }) as { requested: number; skipped: number });
    } catch (e) {
      const m = (e as Error).message ?? '';
      setError(
        m === 'bad_login' ? 'كلمة المرور غير صحيحة — لا يمكن إضافة مكان خدمة دون إثبات الهوية'
        : m.includes('scopes_required') ? 'اختر مكان الخدمة الجديد في الخطوة الأولى أولًا'
        : m.includes('account_not_approved') ? 'حسابك لم يُعتمد بعد — انتظر اعتماده ثم افتح الرابط مجددًا'
        : m.includes('invite_') ? 'رابط الدعوة لم يعد صالحًا — اطلب رابطًا جديدًا من مسؤول الخدمة'
        : 'تعذر إرسال الطلب، حاول مرة أخرى',
      );
    } finally {
      setLoading(false);
    }
  };

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ---- Navigation with per-step validation ----
  const next = () => {
    setError('');
    if (step === 1) {
      // places are optional — the approver can set them — the picker itself
      // guarantees a consistent church → service → class chain
      setStep(2);
    } else if (step === 2) {
      if (!code.trim()) return setError('اكتب الكود أو امسحه بالكاميرا أو ولّد كودًا');
      if (lookup?.family) return setError('هذا الكود كود عائلة — لا يمكن استخدامه لشخص، اختر كودًا آخر');
      // a code with an account → ask «هل أنت نفس الشخص؟» (password · change code · sign in)
      if ((lookup?.has_account || linkedAccount) && !claimedPassword) { setAskExisting(true); return; }
      if (lookup?.has_account) return setError('هذا الكود مرتبط بحساب خادم بالفعل — اضغط «نعم أنا هو» لإضافة مكان الخدمة إلى حسابك');
      if (lookup && !prefilled) fillFromLookup(lookup);
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
    const userId = codeToUserId(code);

    // 0) 20261003120000: ONE password per person — a code that already has a
    //    password (a child / priest account) must use THAT password here too
    if (linkedAccount) {
      let ok = false;
      try { ok = await verifyPersonPassword(supabase, code, password); } catch { ok = false; }
      if (!ok) {
        setError(`هذا الكود له حساب ${kindsLabel(existingKinds(lookup as never))} بالفعل — اكتب كلمة المرور نفسها (لا يمكن أن يكون للشخص الواحد كلمتا مرور)`);
        setLoading(false);
        return;
      }
    }

    // 0.5) 20261004120000: the invite must still be valid — checked BEFORE the
    //      auth user is created so an expired invite leaves no orphan account
    const stillValid = await checkSignupInvite(supabase, inviteToken, 'servant');
    if (!stillValid.valid) {
      setError('رابط الدعوة لم يعد صالحًا — اطلب رابطًا جديدًا من مسؤول الخدمة');
      setLoading(false);
      return;
    }

    // 1) auth account — the login name IS the code
    const { data, error: signErr } = await supabase.auth.signUp({
      email: userIdToEmail(userId),
      password,
    });
    if (signErr || !data.user) {
      setError(
        signErr?.message?.includes('already registered')
          ? 'هذا الكود مسجّل بحساب بالفعل — سجّل الدخول أو استخدم كودًا آخر'
          : 'حدث خطأ أثناء إنشاء الحساب، حاول مرة أخرى'
      );
      setLoading(false);
      return;
    }

    // 2) optional photo
    let imageUrl: string | null = null;
    if (photoBlob) {
      try { imageUrl = await uploadPhoto(supabase, 'servants', photoBlob, 'servant.webp'); } catch { /* photo is optional */ }
    }

    // 3) person + pending servant enrollment
    const { data: res, error: rpcErr } = await supabase.rpc('servant_signup', {
      p_code: code.trim(),
      p_full_name: name.trim(),
      p_gender: gender || null,
      p_birthdate: composeBirthdate(bDay, bMonth, bYear),
      p_phone: `${PHONE_PREFIX}${phoneLocal}`,
      p_address: address.trim() || null,
      p_notes: notes.trim() || null,
      p_church: churchId || null,
      p_service: serviceId || null,
      p_class: classId || null,
      p_image_url: imageUrl,
      // 0045: every place (the first = primary)
      p_scopes: scopes.length ? scopes : null,
      // 20261004120000: the invite that opened this page
      p_invite: inviteToken,
    });

    if (rpcErr) {
      const m = rpcErr.message ?? '';
      setError(
        m.includes('code_taken') ? 'هذا الكود مستخدم من خادم آخر'
        : m.includes('already_registered') ? 'هذا الحساب مسجّل بالفعل'
        : m.includes('phone_required') ? 'رقم الهاتف مطلوب'
        : m.includes('invite_') ? 'رابط الدعوة لم يعد صالحًا — اطلب رابطًا جديدًا من مسؤول الخدمة'
        : 'تعذر حفظ البيانات، حاول مرة أخرى'
      );
      setLoading(false);
      return;
    }
    void (res as ServantSignupResult);
    // 20261003120000: the typed password becomes the person's ONE password
    // (no-op when he already had the same one)
    await supabase.rpc('servant_mirror_own_password', { p_password: password }).then(() => undefined, () => undefined);

    // Hard navigation so AuthProvider re-initializes with the fresh enrollment
    window.location.href = '/';
  };

  // 20261006120000: existing servant → new places requested, awaiting review
  if (requested) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
        <section id="signup-requested" className="card w-full max-w-md text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-extrabold">
            {requested.requested > 0 ? 'تم إرسال طلب إضافة مكان الخدمة' : 'لا جديد لإضافته'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {requested.requested > 0
              ? `${requested.requested === 1 ? 'مكان واحد' : `${requested.requested} أماكن`} بانتظار اعتماد مسؤول الخدمة — ستظهر في حسابك فور الاعتماد.`
              : 'كل الأماكن المختارة موجودة في حسابك بالفعل أو مطلوبة من قبل.'}
            {requested.skipped > 0 && requested.requested > 0 && ` (${requested.skipped} كانت لديك بالفعل)`}
          </p>
          {scopes.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-right text-xs text-slate-600">
              {scopes.map((s, i) => <li key={i} className="flex items-center gap-1"><MapPin className="h-3 w-3 text-primary-500" />{scopeLabel(s, lookups)}</li>)}
            </ul>
          )}
          <button id="su-go-home" type="button" onClick={() => { window.location.href = '/'; }} className="btn-primary mt-5 w-full">
            الدخول إلى حسابي
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <section id="signup-card" className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 h-20 w-20 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image src={dioceseLogo(192)} alt={`شعار ${BRANDING.dioceseName}`} width={80} height={80} priority className="h-full w-full object-cover" />
          </div>
          <h1 className="text-2xl font-extrabold">تسجيل خادم جديد</h1>
          <p className="mt-1 text-sm text-slate-500">سيتم مراجعة طلبك من المسؤول قبل التفعيل</p>
        </div>

        {/* ---------- Stepper ---------- */}
        <ol id="signup-steps" className="mb-4 grid grid-cols-4 gap-1">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const done = step > s.n;
            const active = step === s.n;
            return (
              <li key={s.n} className="flex flex-col items-center gap-1">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold transition ${
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-primary-600 text-white shadow ring-4 ring-primary-100' : 'bg-slate-100 text-slate-400'
                }`}>
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className={`text-[11px] font-bold ${active ? 'text-primary-700' : 'text-slate-400'}`}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {/* Invite banner when arriving via a scoped link */}
        {(churchLocked || serviceLocked || classLocked) && (
          <div id="invite-banner" className="mb-4 flex items-center gap-2 rounded-2xl bg-gradient-to-l from-primary-600 to-accent-600 px-4 py-3 text-sm font-bold text-white">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              دعوة للانضمام إلى: {churchName ?? '...'}
              {serviceName ? ` ← ${serviceName}` : ''}
              {className ? ` ← ${className}` : ''}
            </span>
          </div>
        )}

        <form onSubmit={submit} className="card space-y-4">
          {/* ============ STEP 1 — scope ============ */}
          {step === 1 && (
            <section id="step-scope" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <MapPin className="h-4 w-4 text-primary-500" /> مكان الخدمة
                <span className="text-xs font-normal text-slate-400">(يمكن للمسؤول تعديله عند القبول)</span>
              </p>
              <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs font-bold text-primary-700">
                تخدم في أكثر من فصل أو خدمة أو كنيسة؟ أضف كل أماكن خدمتك هنا — المكان الأول هو الأساسي.
              </p>
              {structureLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary-500" /></div>
              ) : (
                <ScopePicker
                  idPrefix="su"
                  title={null}
                  value={scopes}
                  onChange={setScopes}
                  lookups={lookups}
                  depth="class"
                  lockChurch={churchLocked ? inviteChurch : null}
                  lockService={serviceLocked ? inviteService : null}
                  emptyText="لم تختر مكاناً بعد — يمكنك المتابعة وسيحدده المسؤول"
                  addLabel={scopes.length ? 'إضافة مكان خدمة آخر' : 'اختيار مكان الخدمة'}
                />
              )}
            </section>
          )}

          {/* ============ STEP 2 — code ============ */}
          {step === 2 && (
            <section id="step-code" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <IdCard className="h-4 w-4 text-primary-500" /> الكود (الرقم القومي / كود الـ QR)
              </p>
              <p className="text-xs text-slate-400">هو نفسه اسم الدخول للتطبيق. اكتبه أو امسح الكارت بالكاميرا — وإن لم يكن لديك كود ولّد واحدًا.</p>
              <div className="flex gap-2">
                <input id="su-code" className="input-field flex-1" dir="ltr" placeholder="اكتب الكود"
                  value={code} onChange={(e) => setCode(e.target.value)} autoComplete="username" />
                <button id="su-code-generate" type="button" onClick={() => setCode(renderCode(codesCfg, 'servant', { churchId, serviceId, classId }))}
                  aria-label="توليد كود تلقائي" title="توليد كود تلقائي"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95">
                  <Wand2 className="h-5 w-5" />
                </button>
                <button id="su-code-scan" type="button" onClick={() => setShowScan((v) => !v)}
                  aria-label="مسح الكود بالكاميرا" title="مسح الكود بالكاميرا" aria-pressed={showScan}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow transition active:scale-95 ${showScan ? 'bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
                  <ScanLine className="h-5 w-5" />
                </button>
              </div>

              {showScan && (
                <QrScanner
                  idPrefix="su"
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
              {lookupDone && lookup?.family && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>هذا الكود كود عائلة — لا يمكن أن يكون كود شخص. استخدم كودًا آخر.</span>
                </div>
              )}
              {lookupDone && lookup && !lookup.family && !lookup.has_account && (
                <div className="rounded-xl bg-emerald-50 px-3 py-2">
                  <p className="flex items-center gap-1 text-xs font-extrabold text-emerald-700">
                    <UserCheck className="h-4 w-4" /> شخص مسجّل بالفعل: {lookup.name}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-emerald-600">
                    {linkedAccount
                      ? `لديه حساب ${linkedKinds} — سيُضاف حساب الخادم لنفس الشخص بنفس كلمة المرور، وستتمكن من التنقل بين الحسابات من زر «تغيير الحساب»`
                      : 'سيتم ربط حسابك بنفس الشخص وتعبئة بياناته في الخطوة التالية'}
                  </p>
                </div>
              )}
              {lookupDone && lookup?.has_account && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    هذا الكود له حساب خادم بالفعل{lookup.name ? ` (${lookup.name})` : ''}. إن كنت أنت — اضغط «التالي» وأثبت كلمة مرورك ليُضاف
                    {scopes.length ? ' مكان الخدمة الذي اخترته' : ' مكان الخدمة الذي دعاك إليه الرابط'} إلى حسابك بعد اعتماد المسؤول — أو{' '}
                    <Link href={`/login?code=${encodeURIComponent(code.trim())}`} className="underline">سجّل الدخول</Link> أو استخدم كودًا آخر.
                  </span>
                </div>
              )}
              {claimedPassword && (
                <p className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> تم التحقق — سيُضاف حساب الخادم لنفس الشخص بكلمة مروره الحالية
                </p>
              )}
              {lookupDone && !lookup && code.trim() && (
                <p className="text-[11px] font-bold text-slate-400">كود جديد — ستُدخل بياناتك في الخطوة التالية</p>
              )}
              {code.trim() && (
                <p className="text-[11px] text-slate-400" dir="ltr">اسم الدخول: <b>{codeToUserId(code)}</b></p>
              )}
            </section>
          )}

          {/* ============ STEP 3 — person data ============ */}
          {step === 3 && (
            <section id="step-data" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <User className="h-4 w-4 text-primary-500" /> البيانات الشخصية
              </p>
              {prefilled && (
                <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
                  تم تعبئة البيانات من الشخص المسجّل بهذا الكود — راجعها وأكمل الناقص
                </p>
              )}

              {/* photo */}
              <div className="flex items-center gap-3">
                <button id="su-photo" type="button" onClick={() => fileInputRef.current?.click()}
                  className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-50 ring-2 ring-primary-100 transition active:scale-95">
                  {photoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="صورتي" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-8 w-8 text-primary-400" />
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
                <label htmlFor="su-name" className="mb-1 block text-xs font-bold text-slate-500">الاسم الكامل *</label>
                <input id="su-name" className="input-field" placeholder="مثال: مينا صموئيل" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
                <div className="grid grid-cols-2 gap-2">
                  <button id="su-gender-male" type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')}
                    className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${gender === 'male' ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300' : 'bg-primary-50 text-primary-600'}`}>
                    {GENDER_LABELS.male} 👨
                  </button>
                  <button id="su-gender-female" type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')}
                    className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${gender === 'female' ? 'bg-pink-500 text-white shadow ring-2 ring-pink-300' : 'bg-pink-50 text-pink-500'}`}>
                    {GENDER_LABELS.female} 👩
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="su-phone" className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف *</label>
                <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
                  <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">{PHONE_PREFIX}</span>
                  <input id="su-phone" type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
                    value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
                    onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
                </div>
                {phoneLocal && !phoneValid && (
                  <p className="mt-1 text-[11px] font-bold text-red-500">الرقم يجب أن يكون {PHONE_LOCAL_LENGTH} رقمًا ({phoneLocal.length}/{PHONE_LOCAL_LENGTH})</p>
                )}
                {phoneValid && <p className="mt-1 text-[11px] font-bold text-emerald-600" dir="ltr">✓ {PHONE_PREFIX}{phoneLocal}</p>}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
                <div className="grid grid-cols-3 gap-2">
                  <select id="su-birth-day" aria-label="اليوم" className="input-field !px-2 text-center" value={bDay} onChange={(e) => setBDay(e.target.value)}>
                    <option value="">اليوم</option>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select id="su-birth-month" aria-label="الشهر" className="input-field !px-2 text-center" value={bMonth} onChange={(e) => setBMonth(e.target.value)}>
                    <option value="">الشهر</option>
                    {MONTHS_AR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select id="su-birth-year" aria-label="السنة" className="input-field !px-2 text-center" value={bYear} onChange={(e) => setBYear(e.target.value)}>
                    <option value="">السنة</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="su-address" className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
                <input id="su-address" className="input-field" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <label htmlFor="su-notes" className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
                <textarea id="su-notes" className="input-field min-h-[70px]" placeholder="أي ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </section>
          )}

          {/* ============ STEP 4 — password ============ */}
          {step === 4 && (
            <section id="step-password" className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                <KeyRound className="h-4 w-4 text-primary-500" /> كلمة المرور
              </p>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <p>الاسم: <b className="text-slate-700">{name}</b></p>
                <p dir="ltr" className="text-right">اسم الدخول: <b className="text-slate-700">{codeToUserId(code)}</b></p>
                {scopes.length <= 1 ? (
                  <p>مكان الخدمة: <b className="text-slate-700">{[churchName, serviceName, className].filter(Boolean).join(' ← ') || 'يحدده المسؤول'}</b></p>
                ) : (
                  <div>
                    <p>أماكن الخدمة ({scopes.length}):</p>
                    <ul className="mt-0.5 list-inside list-disc">
                      {scopes.map((s, i) => <li key={i}><b className="text-slate-700">{scopeLabel(s, lookups)}</b>{i === 0 ? ' (الأساسي)' : ''}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              {linkedAccount && (
                <p id="su-linked-hint" className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                  هذا الكود له حساب {linkedKinds} بالفعل — للشخص الواحد كلمة مرور واحدة لكل حساباته. اكتب كلمة مرورك الحالية هنا.
                </p>
              )}
              <div>
                <label htmlFor="su-password" className="mb-1 block text-xs font-bold text-slate-500">{linkedAccount ? 'كلمة المرور الحالية *' : 'كلمة المرور *'}</label>
                <input id="su-password" type="password" className="input-field" placeholder="••••••••" dir="ltr"
                  value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={linkedAccount ? 'current-password' : 'new-password'} />
              </div>
              <div>
                <label htmlFor="su-confirm" className="mb-1 block text-xs font-bold text-slate-500">تأكيد كلمة المرور *</label>
                <input id="su-confirm" type="password" className="input-field" placeholder="••••••••" dir="ltr"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                {confirm && confirm !== password && <p className="mt-1 text-[11px] font-bold text-red-500">كلمتا المرور غير متطابقتين</p>}
              </div>
            </section>
          )}

          {error && (
            <p id="signup-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          {/* ---------- Nav buttons ---------- */}
          <div className="flex gap-2 pt-1">
            {step > 1 && (
              <button id="su-back" type="button" onClick={back} className="btn-secondary flex items-center justify-center gap-1 !px-4">
                <ChevronRight className="h-4 w-4" /> السابق
              </button>
            )}
            {step < 4 ? (
              <button id="su-next" type="button" onClick={next} disabled={step === 1 && structureLoading}
                className="btn-primary flex flex-1 items-center justify-center gap-1">
                التالي <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <button id="su-submit" type="submit" disabled={loading} className="btn-primary flex flex-1 items-center justify-center gap-2">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                إرسال طلب التسجيل
              </button>
            )}
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          لديك حساب بالفعل؟{' '}
          <Link href="/login" className="font-bold text-primary-600 hover:underline">تسجيل الدخول</Link>
        </p>
      </section>

      {askExisting && (
        <ExistingCodeDialog
          code={code.trim()}
          name={lookup?.name}
          kinds={lookup?.has_account ? ['servant', ...existingKinds(lookup as never).filter((k) => k !== 'servant')] : existingKinds(lookup as never)}
          approverLabel="مسؤول الخدمة"
          onVerified={(pw) => {
            setAskExisting(false);
            if (lookup?.has_account) {
              // same servant account → request the new places (no second account)
              void requestMorePlaces(pw);
              return;
            }
            setClaimedPassword(pw); setPassword(pw); setConfirm(pw);
            if (lookup && !prefilled) fillFromLookup(lookup);
            setStep(3);
          }}
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
