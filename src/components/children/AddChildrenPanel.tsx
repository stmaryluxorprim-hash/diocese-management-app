'use client';

// ---------- إضافة مخدومين (single / bulk) ----------
// Lives inside «إدارة المخدومين» (/children/manage?tab=add, migration 0042).
// Single: code (typed / generated / scanned) + photo + data + start points +
//         optional portal PASSWORD (0042 — add_person_and_enroll p_password).
// Bulk:   paste / spreadsheet import with column mapping; an optional default
//         password can be applied to every imported child.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  UserPlus, Users, X, Check, Loader2, QrCode, Camera, Wand2, ScanLine,
  FileSpreadsheet, ClipboardPaste, Upload, Trash2, Star, IdCard, UserCheck, KeyRound, Pencil, SkipForward,
} from 'lucide-react';
import PhotoCropModal from '@/components/PhotoCropModal';
import BulkRowEditModal from '@/components/BulkRowEditModal';
import QrScanner from '@/components/store/QrScanner';
import { useCodeGenerator } from '@/lib/customization-context';
import { monotonicClock } from '@/lib/code-templates';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import {
  normalizePhone, parseFullDate, parseSplitDate, parseGender, parsePastedTable, readSpreadsheet,
  toLatinDigits, phoneToLocalDigits, findRepeatedCodes,
  type DateOrder, type BulkRowEdits, type BulkRowStatus,
} from '@/lib/bulk-import';
import {
  PHONE_PREFIX, PHONE_LOCAL_LENGTH, GENDER_LABELS,
  type Gender, type Church, type Service, type ClassRoom,
  type Person, type AddPersonResult, type ScopeRef,
  DEFAULT_PASSWORD,
} from '@/lib/types';
import ScopePicker from '@/components/ScopePicker';

// ---------- Helpers ----------

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Compose YYYY-MM-DD from separate day/month/year, or null */
const composeBirthdate = (d: string, m: string, y: string): string | null => {
  if (!d || !m || !y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// ---------- Panel ----------

type Tab = 'single' | 'bulk';

export default function AddChildrenPanel() {
  const { profile } = useAuth();
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>('single');
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [{ data: chs }, { data: svs }, { data: cls }] = await Promise.all([
        supabase.from('churches').select('*').order('sort_order').order('name'),
        supabase.from('services').select('*').order('sort_order').order('name'),
        supabase.from('classes').select('*').order('sort_order').order('name'),
      ]);
      setChurches(chs ?? []);
      setServices(svs ?? []);
      setClasses(cls ?? []);
      setLoading(false);
    })();
  }, [profile, supabase]);

  return (
    <>
      {/* ---------- Tabs ---------- */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-indigo-50 p-1">
        <button
          id="tab-single"
          onClick={() => setTab('single')}
          aria-pressed={tab === 'single'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'single' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
          }`}
        >
          <UserPlus className="h-4 w-4" />
          إضافة فردية
        </button>
        <button
          id="tab-bulk"
          onClick={() => setTab('bulk')}
          aria-pressed={tab === 'bulk'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'bulk' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
          }`}
        >
          <Users className="h-4 w-4" />
          إضافة جماعية
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : tab === 'single' ? (
        <SingleAddTab churches={churches} services={services} classes={classes} />
      ) : (
        <BulkAddTab churches={churches} services={services} classes={classes} />
      )}
    </>
  );
}

// ---------- Shared: church → service → class cascading selectors ----------

function useScope(churches: Church[], services: Service[], classes: ClassRoom[]) {
  const { profile } = useAuth();
  const [churchId, setChurchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [classId, setClassId] = useState('');

  // Default from profile scope once data arrives
  useEffect(() => {
    if (!profile) return;
    if (profile.church_id && churches.some((c) => c.id === profile.church_id)) setChurchId(profile.church_id);
    else if (churches.length === 1) setChurchId(churches[0].id);
    if (profile.service_id && services.some((s) => s.id === profile.service_id)) setServiceId(profile.service_id);
    if (profile.class_id && classes.some((c) => c.id === profile.class_id)) setClassId(profile.class_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, churches.length, services.length, classes.length]);

  const visibleServices = useMemo(
    () => services.filter((s) => !churchId || s.church_id === churchId),
    [services, churchId]
  );
  const visibleClasses = useMemo(
    () =>
      classes.filter(
        (c) => (!churchId || c.church_id === churchId) && (!serviceId || c.service_id === serviceId)
      ),
    [classes, churchId, serviceId]
  );

  // Auto-select single options
  useEffect(() => {
    if (!serviceId && visibleServices.length === 1) setServiceId(visibleServices[0].id);
  }, [visibleServices, serviceId]);
  useEffect(() => {
    if (!classId && visibleClasses.length === 1) setClassId(visibleClasses[0].id);
  }, [visibleClasses, classId]);

  const onChurch = (v: string) => { setChurchId(v); setServiceId(''); setClassId(''); };
  const onService = (v: string) => { setServiceId(v); setClassId(''); };

  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  return { churchId, serviceId, classId, visibleServices, visibleClasses, onChurch, onService, setClassId, selectedClass };
}

function ScopeSelectors({
  scope, churches, idPrefix,
}: {
  scope: ReturnType<typeof useScope>; churches: Church[]; idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
        <select
          id={`${idPrefix}-church`}
          className="input-field"
          value={scope.churchId}
          onChange={(e) => scope.onChurch(e.target.value)}
          required
        >
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
        <select
          id={`${idPrefix}-service`}
          className="input-field"
          value={scope.serviceId}
          onChange={(e) => scope.onService(e.target.value)}
          disabled={!scope.churchId}
          required
        >
          <option value="">اختر الخدمة</option>
          {scope.visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
        <select
          id={`${idPrefix}-class`}
          className="input-field"
          value={scope.classId}
          onChange={(e) => scope.setClassId(e.target.value)}
          disabled={!scope.serviceId}
          required
        >
          <option value="">اختر الفصل</option>
          {scope.visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 1 — Single add
// =====================================================================

function SingleAddTab({
  churches, services, classes,
}: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
}) {
  const supabase = createClient();
  const scope = useScope(churches, services, classes);
  // code generator following the owner's نظام الأكواد (scope → church/service/class abbreviations)
  const genPersonCode = useCodeGenerator('person');
  const generateCode = () => genPersonCode({ churchId: scope.churchId, serviceId: scope.serviceId, classId: scope.classId });
  // 0045: OTHER classes to enroll him in at the same time (the selects above = the main class)
  const [extraClasses, setExtraClasses] = useState<ScopeRef[]>([]);
  const pickerLookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);

  // ---- National ID (the QR code) + QR square ----
  const [code, setCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  // Existing person found for the typed national id (cross-scope lookup)
  const [existingPerson, setExistingPerson] = useState<Person | null>(null);
  const [checkingId, setCheckingId] = useState(false);
  // 20260930120000: a person code can never equal a FAMILY code
  const [familyOwner, setFamilyOwner] = useState<string | null>(null);

  useEffect(() => {
    if (!code.trim()) { setQrDataUrl(''); return; }
    QRCode.toDataURL(code.trim(), { width: 320, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [code]);

  // Look up the person by national id (debounced) — one person may be
  // in many churches/services/classes, so we reuse his identity row.
  useEffect(() => {
    const nid = code.trim();
    setExistingPerson(null);
    setFamilyOwner(null);
    if (!nid) return;
    setCheckingId(true);
    const t = setTimeout(async () => {
      const [{ data }, { data: lk }] = await Promise.all([
        supabase.rpc('find_person_by_national_id', { p_national_id: nid }),
        supabase.rpc('person_code_lookup', { p_code: nid }),
      ]);
      const person = Array.isArray(data) ? (data[0] as Person | undefined) : (data as Person | null);
      setExistingPerson(person ?? null);
      setFamilyOwner((lk as { family: { name: string } | null } | null)?.family?.name ?? null);
      setCheckingId(false);
    }, 450);
    return () => { clearTimeout(t); setCheckingId(false); };
  }, [code, supabase]);

  // Autofill the form from the existing person
  const fillFromPerson = (p: Person) => {
    setName(p.name);
    setGender(p.gender ?? '');
    setPhoneLocal(p.phone ? p.phone.replace(/^\+2/, '') : '');
    if (p.birthdate) {
      const [y, m, d] = p.birthdate.split('-');
      setBYear(String(Number(y))); setBMonth(String(Number(m))); setBDay(String(Number(d)));
    }
    setAddress(p.address ?? '');
    setNotes(p.notes ?? '');
  };

  const generateAndShow = () => {
    const c = code.trim() || generateCode();
    setCode(c);
    setShowQr(true);
  };

  // ---- Scan an existing code (national id / printed QR card) with the camera ----
  const [showScan, setShowScan] = useState(false);
  const onScanned = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setCode(v);
    setShowScan(false);
  };

  // ---- Photo square ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');        // object URL for cropper
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRawImage(URL.createObjectURL(file));
  };

  const onCropped = (blob: Blob) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(blob);
    setPhotoPreview(URL.createObjectURL(blob));
    URL.revokeObjectURL(rawImage);
    setRawImage('');
  };

  // ---- Form fields ----
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');   // 11 digits after +2
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [startPoints, setStartPoints] = useState('0');
  // 0042: optional portal password (min 6) — the child logs in with code + password
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState('');

  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 40 }, (_, i) => currentYear - i),
    [currentYear]
  );
  const daysInMonth = useMemo(() => {
    if (!bMonth) return 31;
    const y = Number(bYear) || 2000;
    return new Date(y, Number(bMonth), 0).getDate();
  }, [bMonth, bYear]);

  // Clamp day if month/year change shrinks it
  useEffect(() => {
    if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth));
  }, [daysInMonth, bDay]);

  const phoneValid = phoneLocal === '' || phoneLocal.length === PHONE_LOCAL_LENGTH;

  const resetForm = () => {
    setCode(''); setShowQr(false);
    setExistingPerson(null);
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    setName(''); setGender(''); setPhoneLocal('');
    setBDay(''); setBMonth(''); setBYear('');
    setAddress(''); setNotes(''); setStartPoints('0'); setPassword('');
    setExtraClasses([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSavedName('');

    const cls = scope.selectedClass;
    if (!cls) { setError('اختر الكنيسة والخدمة والفصل'); return; }
    if (!name.trim()) { setError('اكتب اسم المخدوم'); return; }
    if (familyOwner) { setError(`هذا الكود كود عائلة «${familyOwner}» — لا يمكن استخدامه لشخص، اختر كودًا آخر`); return; }
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
      return;
    }
    if (password && password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }

    setSaving(true);
    try {
      // Upload photo first (if any)
      let photoUrl: string | null = null;
      if (photoBlob) {
        photoUrl = await uploadPhoto(supabase, 'persons', photoBlob, 'person.webp');
      }

      const points = Math.max(0, Math.floor(Number(startPoints) || 0));

      // Person-centric flow: the person data goes to the persons table
      // (upsert by national id), then he is registered as an enrollment
      // in this church + service + class — all in one RPC.
      const { data, error: err } = await supabase.rpc('add_person_and_enroll', {
        p_church: cls.church_id,
        p_service: cls.service_id,
        p_class: cls.id,
        p_name: name.trim(),
        p_national_id: code.trim() || null,
        p_gender: gender || null,
        p_birthdate: composeBirthdate(bDay, bMonth, bYear),
        p_phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        p_address: address.trim() || null,
        p_notes: notes.trim() || null,
        p_image_url: photoUrl,
        p_points: points,
        p_password: password || null,
      });

      if (err) {
        setError(/code_is_family/i.test(err.message ?? '')
          ? 'هذا الكود كود عائلة — لا يمكن استخدامه لشخص، اختر كودًا آخر'
          : 'تعذر الحفظ، تأكد من الصلاحيات وحاول مجددًا');
        setSaving(false);
        return;
      }
      const result = data as AddPersonResult;
      if (result?.already_enrolled && extraClasses.length === 0) {
        setError(`"${name.trim()}" مسجّل بالفعل في هذا الفصل`);
        setSaving(false);
        return;
      }

      // 0045: the other classes — same person (by code), one enrollment each
      let extraOk = 0; const extraFail: string[] = [];
      for (const x of extraClasses) {
        if (!x.class_id || !x.service_id || x.class_id === cls.id) continue;
        const { error: xe, data: xd } = await supabase.rpc('add_person_and_enroll', {
          p_church: x.church_id, p_service: x.service_id, p_class: x.class_id,
          p_name: name.trim(), p_national_id: result?.national_id ?? (code.trim() || null),
          p_gender: gender || null, p_birthdate: composeBirthdate(bDay, bMonth, bYear),
          p_phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
          p_address: address.trim() || null, p_notes: notes.trim() || null,
          p_image_url: photoUrl, p_points: points, p_password: null,
        });
        if (xe) extraFail.push(classes.find((c) => c.id === x.class_id)?.name ?? '—');
        else if (!(xd as AddPersonResult)?.already_enrolled) extraOk++;
      }

      const total = (result?.already_enrolled ? 0 : 1) + extraOk;
      setSavedName(
        (result?.person_created ? name.trim() : `${name.trim()} (شخص موجود)`)
        + (extraClasses.length ? ` — سُجّل في ${total} ${total === 1 ? 'فصل' : 'فصول'}` : result?.person_created ? '' : ' — تم تسجيله في الفصل')
      );
      if (extraFail.length) setError(`تعذر التسجيل في: ${extraFail.join('، ')}`);
      resetForm();
      setSaving(false);
    } catch {
      setError('حدث خطأ أثناء رفع الصورة أو الحفظ');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-6">
      {/* ---------- Upper part: two squares (QR / Photo) ---------- */}
      <div className="grid grid-cols-2 gap-3">
        {/* QR square */}
        <button
          id="qr-square"
          type="button"
          onClick={generateAndShow}
          className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
        >
          {qrDataUrl && code ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR" className="h-full w-full rounded-xl object-contain" />
          ) : (
            <>
              <QrCode className="h-10 w-10 text-primary-500" />
              <span className="text-xs font-extrabold text-slate-500">توليد الكود و QR</span>
            </>
          )}
        </button>

        {/* Photo square */}
        <button
          id="photo-square"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 overflow-hidden transition active:scale-95"
        >
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="صورة المخدوم" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <>
              <Camera className="h-10 w-10 text-primary-500" />
              <span className="text-xs font-extrabold text-slate-500">صورة المخدوم</span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          id="photo-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPickFile}
        />
      </div>

      {photoPreview && (
        <button
          id="photo-remove"
          type="button"
          onClick={() => {
            setPhotoBlob(null);
            URL.revokeObjectURL(photoPreview);
            setPhotoPreview('');
          }}
          className="flex items-center gap-1 text-xs font-bold text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
        </button>
      )}

      {/* ---------- Scope ---------- */}
      <div className="card space-y-3">
        <ScopeSelectors scope={scope} churches={churches} idPrefix="single" />

        {/* 0045: enroll him in MORE classes at once */}
        {scope.classId && (
          <ScopePicker
            idPrefix="single-extra"
            title="فصول إضافية"
            hint="المخدوم شخص واحد — يمكن تسجيله في أكثر من فصل أو خدمة أو كنيسة في نفس الوقت (الفصل أعلاه هو الأساسي)"
            value={extraClasses}
            onChange={setExtraClasses}
            lookups={{ ...pickerLookups, classes: classes.filter((c) => c.id !== scope.classId) }}
            depth="class"
            requireLeaf
            primaryLabel={null}
            emptyText="لا توجد فصول إضافية"
            addLabel="إضافة فصل آخر"
          />
        )}

        {/* National ID (the QR code) */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <IdCard className="h-3.5 w-3.5 text-primary-500" />
            الرقم القومي (كود الـ QR)
          </label>
          <div className="flex gap-2">
            <input
              id="single-code"
              className="input-field flex-1"
              dir="ltr"
              placeholder="اكتب الرقم القومي أو ولّد كودًا مؤقتًا"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              id="single-code-generate"
              type="button"
              onClick={() => setCode(generateCode())}
              aria-label="توليد كود تلقائي"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
            >
              <Wand2 className="h-5 w-5" />
            </button>
            <button
              id="single-code-scan"
              type="button"
              onClick={() => setShowScan(true)}
              aria-label="مسح الكود بالكاميرا"
              title="مسح الكود بالكاميرا"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow transition hover:bg-orange-600 active:scale-95"
            >
              <ScanLine className="h-5 w-5" />
            </button>
          </div>
          {checkingId && (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الرقم...
            </p>
          )}
          {familyOwner && (
            <p className="mt-2 flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <UserCheck className="h-4 w-4" />
              هذا الكود كود عائلة «{familyOwner}» — لا يمكن استخدامه لشخص
            </p>
          )}
          {existingPerson && (
            <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-extrabold text-emerald-700">
                <UserCheck className="h-4 w-4" />
                شخص مسجّل بالفعل: {existingPerson.name}
              </p>
              <p className="mt-0.5 text-[11px] font-bold text-emerald-600">
                سيتم ربط نفس الشخص بهذا الفصل دون تكرار بياناته
              </p>
              <button
                type="button"
                onClick={() => fillFromPerson(existingPerson)}
                className="mt-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-extrabold text-white transition active:scale-95"
              >
                تعبئة بياناته في النموذج
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Personal data ---------- */}
      <div className="card space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input
            id="single-name"
            className="input-field"
            placeholder="اسم المخدوم"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {/* Gender */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              id="gender-male"
              type="button"
              aria-pressed={gender === 'male'}
              onClick={() => setGender(gender === 'male' ? '' : 'male')}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${
                gender === 'male'
                  ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-600'
              }`}
            >
              {GENDER_LABELS.male} 👦
            </button>
            <button
              id="gender-female"
              type="button"
              aria-pressed={gender === 'female'}
              onClick={() => setGender(gender === 'female' ? '' : 'female')}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${
                gender === 'female'
                  ? 'bg-pink-500 text-white shadow ring-2 ring-pink-300'
                  : 'bg-pink-50 text-pink-500'
              }`}
            >
              {GENDER_LABELS.female} 👧
            </button>
          </div>
        </div>

        {/* Phone with fixed +2 prefix */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف</label>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
            <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">
              {PHONE_PREFIX}
            </span>
            <input
              id="single-phone"
              type="tel"
              inputMode="numeric"
              className="w-full px-3 py-2.5 text-sm font-bold outline-none"
              placeholder="01xxxxxxxxx"
              value={phoneLocal}
              maxLength={PHONE_LOCAL_LENGTH}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))}
            />
          </div>
          {!phoneValid && (
            <p className="mt-1 text-[11px] font-bold text-red-500">
              الرقم يجب أن يكون {PHONE_LOCAL_LENGTH} رقمًا ({phoneLocal.length}/{PHONE_LOCAL_LENGTH})
            </p>
          )}
          {phoneLocal.length === PHONE_LOCAL_LENGTH && (
            <p className="mt-1 text-[11px] font-bold text-emerald-600" dir="ltr">
              ✓ {PHONE_PREFIX}{phoneLocal}
            </p>
          )}
        </div>

        {/* Birthdate: day / month / year pickers */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
          <div className="grid grid-cols-3 gap-2">
            <select
              id="birth-day"
              aria-label="اليوم"
              className="input-field !px-2 text-center"
              value={bDay}
              onChange={(e) => setBDay(e.target.value)}
            >
              <option value="">اليوم</option>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              id="birth-month"
              aria-label="الشهر"
              className="input-field !px-2 text-center"
              value={bMonth}
              onChange={(e) => setBMonth(e.target.value)}
            >
              <option value="">الشهر</option>
              {MONTHS_AR.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              id="birth-year"
              aria-label="السنة"
              className="input-field !px-2 text-center"
              value={bYear}
              onChange={(e) => setBYear(e.target.value)}
            >
              <option value="">السنة</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
          <input
            id="single-address"
            className="input-field"
            placeholder="العنوان"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
          <textarea
            id="single-notes"
            className="input-field"
            rows={2}
            placeholder="ملاحظات"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <Star className="h-3.5 w-3.5 text-gold-500" /> نقاط البداية
          </label>
          <input
            id="single-start-points"
            type="number"
            min={0}
            className="input-field"
            value={startPoints}
            onChange={(e) => setStartPoints(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <KeyRound className="h-3.5 w-3.5 text-primary-500" /> كلمة مرور البوابة
            <span className="font-normal text-slate-400">(اختياري — 6 أحرف على الأقل)</span>
          </label>
          <input
            id="single-password"
            type="text"
            dir="ltr"
            className="input-field"
            placeholder={`فارغة = الافتراضية ${DEFAULT_PASSWORD}`}
            value={password}
            autoComplete="off"
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-slate-400">بدون كلمة مرور يدخل المخدوم بالافتراضية <b dir="ltr">{DEFAULT_PASSWORD}</b> ويغيّرها من بوابته (القديمة + الجديدة)</p>
          {existingPerson && (
            <p className="mt-1 text-[11px] text-slate-400">لشخص موجود: تُضبط فقط إن لم تكن له كلمة مرور بعد — لإعادة التعيين استخدم «تعديل البيانات»</p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}
      {savedName && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
          ✓ تم حفظ &quot;{savedName}&quot; بنجاح — يمكنك إضافة مخدوم آخر
        </p>
      )}

      <button
        id="single-save"
        type="submit"
        disabled={saving || !phoneValid}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
        حفظ المخدوم
      </button>

      {/* QR fullscreen modal */}
      {showQr && qrDataUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setShowQr(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">الرقم القومي — كود الـ QR</h3>
              <button type="button" onClick={() => setShowQr(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR" className="mx-auto w-full rounded-xl" />
            <p className="mt-2 text-lg font-extrabold tracking-widest" dir="ltr">{code}</p>
          </div>
        </div>
      )}

      {/* Scan-code modal (camera / gallery) */}
      {showScan && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setShowScan(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-extrabold">
                <ScanLine className="h-5 w-5 text-orange-500" />
                مسح الكود بالكاميرا
              </h3>
              <button type="button" onClick={() => setShowScan(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <QrScanner onCode={onScanned} idPrefix="add-person-scan" autoStart hint="شغّل الكاميرا لمسح كود المخدوم" />
            <p className="mt-3 text-center text-[11px] font-bold text-slate-400">
              سيتم وضع الكود الممسوح في خانة الرقم القومي مباشرة
            </p>
          </div>
        </div>
      )}

      {/* Crop modal */}
      {rawImage && (
        <PhotoCropModal
          src={rawImage}
          onDone={onCropped}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }}
        />
      )}
    </form>
  );
}

// =====================================================================
// TAB 2 — Bulk add (Excel import or pasted data + column mapping)
// =====================================================================

type BulkField =
  | 'name' | 'gender' | 'phone'
  | 'birthdate' | 'birth_day' | 'birth_month' | 'birth_year'
  | 'address' | 'notes' | 'points' | 'code' | 'skip';

const BULK_FIELDS: { value: BulkField; label: string }[] = [
  { value: 'skip', label: '— تجاهل —' },
  { value: 'name', label: 'الاسم' },
  { value: 'gender', label: 'النوع' },
  { value: 'phone', label: 'رقم الهاتف' },
  { value: 'birthdate', label: 'تاريخ الميلاد (كامل)' },
  { value: 'birth_day', label: 'يوم الميلاد' },
  { value: 'birth_month', label: 'شهر الميلاد' },
  { value: 'birth_year', label: 'سنة الميلاد' },
  { value: 'address', label: 'العنوان' },
  { value: 'notes', label: 'ملاحظات' },
  { value: 'points', label: 'نقاط' },
  { value: 'code', label: 'الرقم القومي' },
];

/** Guess mapping from a header cell text */
const guessField = (header: string): BulkField => {
  const h = header.trim().toLowerCase();
  if (/اسم|name/.test(h)) return 'name';
  if (/نوع|جنس|gender|sex/.test(h)) return 'gender';
  if (/هاتف|موبايل|تليفون|phone|mobile|tel/.test(h)) return 'phone';
  if (/يوم|day/.test(h)) return 'birth_day';
  if (/شهر|month/.test(h)) return 'birth_month';
  if (/سنة|عام|year/.test(h)) return 'birth_year';
  if (/ميلاد|تاريخ|birth|date|dob/.test(h)) return 'birthdate';
  if (/عنوان|address/.test(h)) return 'address';
  if (/ملاحظ|note/.test(h)) return 'notes';
  if (/نقاط|point/.test(h)) return 'points';
  if (/قومي|كود|national|code|qr/.test(h)) return 'code';
  return 'skip';
};

interface BulkRow {
  key: number;
  cells: string[];
  genderOverride?: Gender | null;   // per-row manual gender (wins over everything)
  edits?: BulkRowEdits;             // manual corrections from the edit modal (win over cells)
  status: BulkRowStatus;            // skipped = not imported (duplicate code …) — reported at the end
  message?: string;
}

function BulkAddTab({
  churches, services, classes,
}: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
}) {
  const supabase = createClient();
  const scope = useScope(churches, services, classes);
  const genPersonCode = useCodeGenerator('person');

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [mapping, setMapping] = useState<BulkField[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ ok: number; fail: number; skipped: number } | null>(null);
  const [editingKey, setEditingKey] = useState<number | null>(null);      // row open in the edit modal
  const excelInputRef = useRef<HTMLInputElement>(null);

  // ---- Import options ----
  const [defaultGender, setDefaultGender] = useState<Gender | ''>('');   // all boys / all girls
  const [autoCodes, setAutoCodes] = useState(false);                     // generate codes
  const [dateOrder, setDateOrder] = useState<DateOrder>('auto');         // dd/mm vs mm/dd
  const [defaultPoints, setDefaultPoints] = useState('0');               // points for every child
  const [defaultPassword, setDefaultPassword] = useState('');            // 0042: portal password for every child (optional)

  const colCount = rows.length ? Math.max(...rows.map((r) => r.cells.length)) : 0;

  const applyData = useCallback((matrix: string[][]) => {
    const clean = matrix
      .map((r) => r.map((c) => String(c ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''));
    if (!clean.length) { setError('لا توجد بيانات'); return; }
    setError('');
    setDone(null);
    setRows(clean.map((cells, i) => ({ key: i, cells, status: 'pending' })));
    const cols = Math.max(...clean.map((r) => r.length));
    const guessed: BulkField[] = Array.from({ length: cols }, (_, i) => guessField(clean[0][i] ?? ''));
    if (!guessed.includes('name') && cols > 0) guessed[0] = 'name';
    setMapping(guessed);
  }, []);

  // ---- Excel import ----
  const onExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      applyData(await readSpreadsheet(file));
    } catch {
      setError('تعذر قراءة ملف الإكسل');
    }
  };

  // ---- Paste import ----
  const applyPaste = () => {
    applyData(parsePastedTable(pasteText));
    setPasteOpen(false);
    setPasteText('');
  };

  const setColMapping = (i: number, f: BulkField) =>
    setMapping((m) => {
      const next = [...m];
      if (f !== 'skip') {
        for (let j = 0; j < next.length; j++) if (next[j] === f) next[j] = 'skip';
      }
      next[i] = f;
      return next;
    });

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);

  const col = useCallback((f: BulkField) => mapping.indexOf(f), [mapping]);
  const cellOf = useCallback(
    (row: BulkRow, f: BulkField) => {
      const idx = col(f);
      return idx === -1 ? '' : (row.cells[idx] ?? '').trim();
    },
    [col]
  );

  const hasGenderData = col('gender') !== -1;
  const hasCodeCol = col('code') !== -1;
  const hasFullDate = col('birthdate') !== -1;
  const hasSplitDate = col('birth_day') !== -1 || col('birth_month') !== -1 || col('birth_year') !== -1;
  const hasPointsCol = col('points') !== -1;

  // ---------- Resolve each row into final values (live preview) ----------
  // Manual edits (row.edits) win over the parsed cells for every field.
  interface Resolved {
    row: BulkRow;
    name: string;
    gender: Gender | null;
    code: string;
    birthdate: string | null;
    birthdateRaw: string;
    phone: string | null | undefined;   // undefined = invalid (→ imported WITHOUT phone, flagged)
    phoneRaw: string;
    points: number;
    address: string;
    notes: string;
    duplicateInBatch: boolean;          // same code appeared in an earlier row → skipped
  }

  const resolved: Resolved[] = useMemo(() => {
    const fallbackPoints = Math.max(0, Math.floor(Number(defaultPoints) || 0));
    const list = dataRows.map((row) => {
      const ed = row.edits ?? {};

      // gender: edit > per-row override > cell value > global default
      let gender: Gender | null = null;
      if (ed.gender !== undefined) gender = ed.gender;
      else if (row.genderOverride !== undefined) gender = row.genderOverride;
      else {
        gender = hasGenderData ? parseGender(cellOf(row, 'gender')) : null;
        if (!gender && defaultGender) gender = defaultGender;
      }

      // code: edit > cell value; else auto-generated when enabled
      let code = (ed.code !== undefined ? ed.code : cellOf(row, 'code')).trim();
      if (!code && autoCodes) code = 'AUTO';   // placeholder — real code generated at import

      // birthdate
      let birthdate: string | null = null;
      let birthdateRaw = '';
      if (ed.birthdate !== undefined) {
        birthdate = ed.birthdate;
      } else if (hasFullDate) {
        birthdateRaw = cellOf(row, 'birthdate');
        birthdate = parseFullDate(birthdateRaw, dateOrder);
      } else if (hasSplitDate) {
        const dRaw = toLatinDigits(cellOf(row, 'birth_day'));
        const mRaw = cellOf(row, 'birth_month');
        const yRaw = toLatinDigits(cellOf(row, 'birth_year'));
        birthdateRaw = [dRaw, mRaw, yRaw].filter(Boolean).join(' / ');
        birthdate = parseSplitDate(dRaw, mRaw, yRaw);
      }

      const rowPoints = hasPointsCol ? cellOf(row, 'points') : '';
      const points = ed.points !== undefined
        ? ed.points
        : rowPoints !== '' && !Number.isNaN(Number(rowPoints))
          ? Math.max(0, Math.floor(Number(rowPoints)))
          : fallbackPoints;

      const phoneRaw = ed.phone !== undefined ? ed.phone : cellOf(row, 'phone');

      return {
        row,
        name: (ed.name !== undefined ? ed.name : cellOf(row, 'name')).trim(),
        gender,
        code,
        birthdate,
        birthdateRaw,
        phone: normalizePhone(phoneRaw),
        phoneRaw,
        points,
        address: ed.address !== undefined ? ed.address : cellOf(row, 'address'),
        notes: ed.notes !== undefined ? ed.notes : cellOf(row, 'notes'),
        duplicateInBatch: false,
      };
    });
    // a code repeated inside the file: the first row keeps it, the rest are skipped
    const repeats = findRepeatedCodes(list.map((r) => (r.row.status === 'ok' ? null : r.code)));
    repeats.forEach((i) => { list[i].duplicateInBatch = true; });
    return list;
  }, [dataRows, cellOf, hasGenderData, defaultGender, autoCodes, hasFullDate, hasSplitDate, dateOrder, hasPointsCol, defaultPoints]);

  // Cycle a row's gender: null → boy → girl → null
  const cycleGender = (key: number) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const current =
          r.genderOverride !== undefined
            ? r.genderOverride
            : (hasGenderData ? parseGender(cellOf(r, 'gender')) : null) || (defaultGender || null);
        const next: Gender | null = current === null ? 'male' : current === 'male' ? 'female' : null;
        return { ...r, genderOverride: next };
      })
    );

  const removeRow = (key: number) => { setRows((rs) => rs.filter((r) => r.key !== key)); setEditingKey(null); };

  // Save the edit-modal patch on a row (also clears an old error so it can be retried)
  const saveEdits = (key: number, edits: BulkRowEdits) => {
    setRows((rs) => rs.map((r) => (r.key === key
      ? { ...r, edits: { ...(r.edits ?? {}), ...edits }, genderOverride: undefined, status: r.status === 'ok' ? 'ok' : 'pending', message: undefined }
      : r)));
    setEditingKey(null);
  };
  const editing = editingKey === null ? null : resolved.find((r) => r.row.key === editingKey) ?? null;
  const editingIndex = editing ? resolved.indexOf(editing) + 1 : 0;

  const nameCol = col('name');
  const invalidPhones = resolved.filter((r) => r.phone === undefined && r.row.status !== 'ok').length;
  const unparsedDates = resolved.filter((r) => r.birthdateRaw && !r.birthdate && r.row.status !== 'ok').length;
  const duplicateCodes = resolved.filter((r) => r.duplicateInBatch && r.row.status !== 'ok').length;

  // ---------- Import ----------
  // Never stops on a bad row: invalid phone / date → the row is imported
  // WITHOUT that value; a duplicated code (in the file or already in the
  // class) → the row is SKIPPED. Everything is reported at the end.
  const doImport = async () => {
    setError('');
    const cls = scope.selectedClass;
    if (!cls) { setError('اختر الكنيسة والخدمة والفصل أولًا'); return; }
    if (nameCol === -1) { setError('حدد عمود الاسم'); return; }
    if (!resolved.length) { setError('لا توجد صفوف للاستيراد'); return; }

    setImporting(true);
    setDone(null);
    let ok = 0, fail = 0, skipped = 0;
    // monotonic clock → timestamp-based codes never collide inside one import
    const tick = monotonicClock();
    const generateCode = () => genPersonCode({ churchId: cls.church_id, serviceId: cls.service_id, classId: cls.id, now: tick() });

    for (const r of resolved) {
      if (r.row.status === 'ok') continue;   // already imported in a previous run

      const setStatus = (status: BulkRow['status'], message?: string) =>
        setRows((rs) => rs.map((x) => (x.key === r.row.key ? { ...x, status, message } : x)));

      if (!r.name) { setStatus('skipped', 'الاسم مفقود'); skipped++; continue; }
      if (r.duplicateInBatch) { setStatus('skipped', `الكود ${r.code} مكرر في الملف`); skipped++; continue; }

      const codeVal = r.code === 'AUTO' ? generateCode() : r.code;
      // a bad phone never blocks the child — he is saved without it
      const phoneDropped = r.phone === undefined;
      const dateDropped = !!r.birthdateRaw && !r.birthdate;

      // Person-centric flow: upsert the person by national id, then
      // register him as an enrollment in this church/service/class.
      const { data, error: err } = await supabase.rpc('add_person_and_enroll', {
        p_church: cls.church_id,
        p_service: cls.service_id,
        p_class: cls.id,
        p_name: r.name,
        p_national_id: codeVal || null,
        p_gender: r.gender,
        p_birthdate: r.birthdate,
        p_phone: phoneDropped ? null : r.phone,
        p_address: r.address || null,
        p_notes: r.notes || null,
        p_points: r.points,
        p_password: defaultPassword.length >= 6 ? defaultPassword : null,
      });
      const result = data as AddPersonResult | null;
      if (err) {
        const m = (err.message ?? '').toLowerCase();
        setStatus('error',
          m.includes('code_is_family') ? `الكود ${codeVal} كود عائلة — لا يمكن استخدامه لشخص`
          : m.includes('no_access') || m.includes('not_approved') ? 'خارج صلاحياتك' : 'فشل الحفظ');
        fail++;
      } else if (result?.already_enrolled) {
        setStatus('skipped', `الكود ${result.national_id} مسجّل بالفعل في الفصل`);
        skipped++;
      } else {
        const notes: string[] = [];
        if (phoneDropped) notes.push('حُفظ بدون هاتف (رقم غير صالح)');
        if (dateDropped) notes.push('حُفظ بدون تاريخ ميلاد (صيغة غير مفهومة)');
        if (!result?.person_created) notes.push('شخص موجود — تم تسجيله في الفصل');
        setStatus('ok', notes.join(' · ') || undefined);
        ok++;
      }
    }
    setImporting(false);
    setDone({ ok, fail, skipped });
  };

  const reset = () => {
    setRows([]); setMapping([]); setDone(null); setError(''); setEditingKey(null);
    setDefaultGender(''); setAutoCodes(false); setDateOrder('auto'); setDefaultPoints('0');
  };

  const pendingCount = resolved.filter((r) => r.row.status !== 'ok').length;
  const willImportCount = resolved.filter((r) => r.row.status !== 'ok' && r.name && !r.duplicateInBatch).length;

  return (
    <div className="space-y-4 pb-6">
      {/* Scope */}
      <div className="card space-y-3">
        <ScopeSelectors scope={scope} churches={churches} idPrefix="bulk" />
      </div>

      {/* Import sources */}
      {rows.length === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <button
            id="bulk-excel-btn"
            type="button"
            onClick={() => excelInputRef.current?.click()}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
          >
            <FileSpreadsheet className="h-10 w-10 text-emerald-500" />
            <span className="text-xs font-extrabold text-slate-500">استيراد من إكسل</span>
            <span className="text-[10px] text-slate-400" dir="ltr">.xlsx / .xls / .csv</span>
          </button>
          <button
            id="bulk-paste-btn"
            type="button"
            onClick={() => setPasteOpen(true)}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
          >
            <ClipboardPaste className="h-10 w-10 text-primary-500" />
            <span className="text-xs font-extrabold text-slate-500">لصق البيانات</span>
            <span className="text-[10px] text-slate-400">من جدول أو نص</span>
          </button>
          <input
            ref={excelInputRef}
            id="bulk-excel-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onExcelFile}
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* ---------- Column mapping ---------- */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-700">١· تحديد الأعمدة</h3>
              <button
                id="bulk-reset"
                type="button"
                onClick={reset}
                className="flex items-center gap-1 text-xs font-bold text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" /> مسح البيانات
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                id="bulk-has-header"
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-primary-600"
              />
              الصف الأول عناوين (يتم تجاهله)
            </label>

            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr>
                    {Array.from({ length: colCount }, (_, i) => (
                      <th key={i} className="p-1">
                        <select
                          id={`bulk-map-${i}`}
                          aria-label={`عمود ${i + 1}`}
                          className={`input-field !w-32 !px-2 !py-1.5 !text-xs font-extrabold ${
                            (mapping[i] ?? 'skip') !== 'skip' ? '!border-primary-300 !bg-primary-50' : ''
                          }`}
                          value={mapping[i] ?? 'skip'}
                          onChange={(e) => setColMapping(i, e.target.value as BulkField)}
                        >
                          {BULK_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, ri) => (
                    <tr key={row.key} className={ri % 2 ? 'bg-slate-50' : ''}>
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} className="max-w-[130px] truncate border-t border-indigo-50 p-1.5 font-bold text-slate-600">
                          {row.cells[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] font-bold text-slate-400">معاينة أول 5 صفوف — إجمالي {dataRows.length} صفًا</p>
          </div>

          {/* ---------- Import options ---------- */}
          <div className="card space-y-4">
            <h3 className="text-sm font-extrabold text-slate-700">٢· خيارات الاستيراد</h3>

            {/* Gender */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">
                النوع {hasGenderData ? '— يُقرأ من العمود، ويمكن تعديل كل صف من المعاينة' : '— لا يوجد عمود نوع، اختر للجميع:'}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  id="bulk-gender-none"
                  type="button"
                  aria-pressed={defaultGender === ''}
                  onClick={() => setDefaultGender('')}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    defaultGender === '' ? 'bg-slate-600 text-white shadow' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {hasGenderData ? 'من العمود' : 'بدون'}
                </button>
                <button
                  id="bulk-gender-boys"
                  type="button"
                  aria-pressed={defaultGender === 'male'}
                  onClick={() => setDefaultGender(defaultGender === 'male' ? '' : 'male')}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    defaultGender === 'male' ? 'bg-primary-600 text-white shadow' : 'bg-primary-50 text-primary-600'
                  }`}
                >
                  الكل ذكور 👦
                </button>
                <button
                  id="bulk-gender-girls"
                  type="button"
                  aria-pressed={defaultGender === 'female'}
                  onClick={() => setDefaultGender(defaultGender === 'female' ? '' : 'female')}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    defaultGender === 'female' ? 'bg-pink-500 text-white shadow' : 'bg-pink-50 text-pink-500'
                  }`}
                >
                  الكل إناث 👧
                </button>
              </div>
              {hasGenderData && defaultGender && (
                <p className="mt-1 text-[11px] font-bold text-amber-600">
                  سيُطبق على الصفوف التي لا يوجد بها نوع صريح فقط
                </p>
              )}
            </div>

            {/* Codes */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الأكواد</label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  id="bulk-auto-codes"
                  type="checkbox"
                  checked={autoCodes}
                  onChange={(e) => setAutoCodes(e.target.checked)}
                  className="h-4 w-4 accent-primary-600"
                />
                <Wand2 className="h-4 w-4 text-primary-500" />
                توليد رقم مؤقت تلقائي (P-XXXXXXXX) {hasCodeCol ? 'للصفوف التي بلا كود' : 'لكل المخدومين'}
              </label>
            </div>

            {/* Date format */}
            {(hasFullDate || hasSplitDate) && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
                {hasFullDate ? (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      id="bulk-date-auto"
                      type="button"
                      aria-pressed={dateOrder === 'auto'}
                      onClick={() => setDateOrder('auto')}
                      className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                        dateOrder === 'auto' ? 'bg-slate-600 text-white shadow' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      تلقائي
                    </button>
                    <button
                      id="bulk-date-dmy"
                      type="button"
                      aria-pressed={dateOrder === 'dmy'}
                      onClick={() => setDateOrder('dmy')}
                      className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                        dateOrder === 'dmy' ? 'bg-primary-600 text-white shadow' : 'bg-primary-50 text-primary-600'
                      }`}
                      dir="ltr"
                    >
                      dd/mm/yyyy
                    </button>
                    <button
                      id="bulk-date-mdy"
                      type="button"
                      aria-pressed={dateOrder === 'mdy'}
                      onClick={() => setDateOrder('mdy')}
                      className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                        dateOrder === 'mdy' ? 'bg-primary-600 text-white shadow' : 'bg-primary-50 text-primary-600'
                      }`}
                      dir="ltr"
                    >
                      mm/dd/yyyy
                    </button>
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
                    التاريخ من 3 أعمدة (يوم/شهر/سنة) — الشهر يُقبل رقمًا أو اسمًا (يناير، January...)
                  </p>
                )}
                {unparsedDates > 0 && (
                  <p className="mt-1 text-[11px] font-bold text-amber-600">
                    ⚠ {unparsedDates} تاريخ لم يُفهم — عدّله من المعاينة أو سيُحفظ المخدوم بدون تاريخ
                  </p>
                )}
              </div>
            )}

            {/* Points */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                <Star className="h-3.5 w-3.5 text-gold-500" />
                نقاط لكل مخدوم {hasPointsCol && '(عمود النقاط له الأولوية)'}
              </label>
              <input
                id="bulk-default-points"
                type="number"
                min={0}
                className="input-field !w-28"
                value={defaultPoints}
                onChange={(e) => setDefaultPoints(e.target.value)}
              />
            </div>

            {/* Password (0042) */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                <KeyRound className="h-3.5 w-3.5 text-primary-500" />
                كلمة مرور البوابة لكل مخدوم <span className="font-normal text-slate-400">(اختياري — 6 أحرف على الأقل)</span>
              </label>
              <input
                id="bulk-default-password"
                type="text"
                dir="ltr"
                className="input-field"
                placeholder={`فارغة = الافتراضية ${DEFAULT_PASSWORD} — يغيّرها المخدوم لاحقًا`}
                value={defaultPassword}
                autoComplete="off"
                onChange={(e) => setDefaultPassword(e.target.value)}
              />
              {defaultPassword && defaultPassword.length < 6 && (
                <p className="mt-1 text-[11px] font-bold text-red-500">قصيرة — لن تُضبط كلمة مرور</p>
              )}
            </div>
          </div>

          {/* ---------- Resolved preview ---------- */}
          <div className="card space-y-2">
            <h3 className="text-sm font-extrabold text-slate-700">٣· المعاينة النهائية</h3>
            <p className="text-[11px] font-bold text-slate-400">اضغط على الاسم أو زر التعديل لتصحيح أي بيان قبل الاستيراد — وعلى النوع لتبديله</p>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr className="text-right text-[11px] font-extrabold text-slate-400">
                    <th className="p-1.5">الاسم</th>
                    <th className="p-1.5">النوع</th>
                    <th className="p-1.5">الكود</th>
                    <th className="p-1.5">الميلاد</th>
                    <th className="p-1.5">الهاتف</th>
                    <th className="p-1.5">نقاط</th>
                    <th className="p-1.5 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((r) => (
                    <tr
                      key={r.row.key}
                      className={
                        r.row.status === 'ok' ? 'bg-emerald-50'
                        : r.row.status === 'error' ? 'bg-red-50'
                        : r.row.status === 'skipped' || r.duplicateInBatch ? 'bg-amber-50'
                        : ''
                      }
                    >
                      <td className="max-w-[120px] truncate border-t border-indigo-50 p-1.5 font-extrabold text-slate-700">
                        {r.row.status === 'ok' ? (
                          r.name
                        ) : (
                          <button type="button" onClick={() => setEditingKey(r.row.key)} className="max-w-full truncate text-right hover:text-primary-600" title="تعديل الصف">
                            {r.name || <span className="text-red-500">؟ بلا اسم</span>}
                            {r.row.edits && <span className="mr-1 text-[10px] text-primary-500">✎</span>}
                          </button>
                        )}
                      </td>
                      <td className="border-t border-indigo-50 p-1">
                        <button
                          type="button"
                          aria-label="تبديل النوع"
                          onClick={() => cycleGender(r.row.key)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-extrabold transition active:scale-95 ${
                            r.gender === 'male' ? 'bg-primary-100 text-primary-700'
                            : r.gender === 'female' ? 'bg-pink-100 text-pink-600'
                            : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {r.gender === 'male' ? '👦 ذكر' : r.gender === 'female' ? '👧 أنثى' : '—'}
                        </button>
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold text-slate-500" dir="ltr">
                        {r.code === 'AUTO' ? <span className="text-primary-500">تلقائي ✨</span> : r.code || '—'}
                        {r.duplicateInBatch && r.row.status !== 'ok' && <span className="ml-1 text-amber-600" title="كود مكرر في الملف — لن يُستورد">⚠ مكرر</span>}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold" dir="ltr">
                        {r.birthdate ? (
                          <span className="text-slate-600">{r.birthdate.split('-').reverse().join('/')}</span>
                        ) : r.birthdateRaw ? (
                          <button type="button" onClick={() => setEditingKey(r.row.key)} className="text-amber-500 underline decoration-dotted" title={`${r.birthdateRaw} — اضغط للتعديل`}>⚠ {r.birthdateRaw}</button>
                        ) : '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold" dir="ltr">
                        {r.phone === undefined ? (
                          <button type="button" onClick={() => setEditingKey(r.row.key)} className="text-amber-500 underline decoration-dotted" title={`${r.phoneRaw} — اضغط للتعديل`}>⚠ {r.phoneRaw}</button>
                        ) : r.phone ? (
                          <span className="text-slate-600">{r.phone}</span>
                        ) : '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-extrabold text-gold-600">{r.points}</td>
                      <td className="border-t border-indigo-50 p-1">
                        {r.row.status === 'ok' ? (
                          <span title={r.row.message}><Check className="h-4 w-4 text-emerald-500" /></span>
                        ) : r.row.status === 'error' ? (
                          <span title={r.row.message}><X className="h-4 w-4 text-red-500" /></span>
                        ) : r.row.status === 'skipped' ? (
                          <span title={r.row.message}><SkipForward className="h-4 w-4 text-amber-500" /></span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="تعديل الصف"
                              onClick={() => setEditingKey(r.row.key)}
                              className="text-slate-300 hover:text-primary-500"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="حذف الصف"
                              onClick={() => removeRow(r.row.key)}
                              className="text-slate-300 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] font-bold text-slate-400">إجمالي {resolved.length} صفًا — كلها معروضة للمراجعة</p>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          {/* ---------- Result summary (after the import) ---------- */}
          {done && (
            <div className="space-y-2">
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                ✓ تم استيراد {done.ok} مخدومًا
                {done.skipped > 0 ? ` · لم يُضف ${done.skipped}` : ''}
                {done.fail > 0 ? ` · فشل ${done.fail}` : ''}
              </p>
              {resolved.some((r) => r.row.status === 'skipped') && (
                <div className="rounded-xl bg-amber-50 p-2 text-[11px] font-bold text-amber-700">
                  <p className="mb-1 flex items-center gap-1"><SkipForward className="h-3.5 w-3.5" /> لم تُضف (مكررة أو ناقصة):</p>
                  <ul className="space-y-0.5">
                    {resolved.map((r, i) => r.row.status === 'skipped' ? (
                      <li key={r.row.key}>صف {i + 1}: {r.name || 'بلا اسم'} — {r.row.message}</li>
                    ) : null)}
                  </ul>
                </div>
              )}
              {resolved.some((r) => r.row.status === 'error') && (
                <div className="rounded-xl bg-red-50 p-2 text-[11px] font-bold text-red-600">
                  <p className="mb-1">فشل الحفظ (عدّل الصف وأعد المحاولة):</p>
                  <ul className="space-y-0.5">
                    {resolved.map((r, i) => r.row.status === 'error' ? (
                      <li key={r.row.key}>صف {i + 1}: {r.name} — {r.row.message}</li>
                    ) : null)}
                  </ul>
                </div>
              )}
              {resolved.some((r) => r.row.status === 'ok' && r.row.message) && (
                <div className="rounded-xl bg-slate-50 p-2 text-[11px] font-bold text-slate-600">
                  <p className="mb-1">أُضيفوا مع ملاحظة:</p>
                  <ul className="space-y-0.5">
                    {resolved.map((r, i) => r.row.status === 'ok' && r.row.message ? (
                      <li key={r.row.key}>صف {i + 1}: {r.name} — {r.row.message}</li>
                    ) : null)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ---------- Pre-import warnings (nothing blocks; everything can be edited) ---------- */}
          {!done && (invalidPhones > 0 || duplicateCodes > 0) && (
            <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
              {invalidPhones > 0 && (
                <p>⚠ {invalidPhones} رقم هاتف غير صالح (يجب {PHONE_LOCAL_LENGTH} رقمًا) — اضغط عليه لتصحيحه، أو سيُحفظ المخدوم بدون هاتف</p>
              )}
              {duplicateCodes > 0 && (
                <p>⚠ {duplicateCodes} كود مكرر في الملف — سيُستورد الأول فقط ويُتجاوز الباقي (عدّل الكود لإضافته)</p>
              )}
            </div>
          )}

          <button
            id="bulk-import"
            type="button"
            onClick={doImport}
            disabled={importing || nameCol === -1 || !scope.classId || pendingCount === 0}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            استيراد {willImportCount} مخدومًا{willImportCount !== pendingCount ? ` (من ${pendingCount})` : ''}
          </button>
        </>
      )}

      {/* Row edit modal */}
      {editing && (
        <BulkRowEditModal
          title="تعديل بيانات المخدوم"
          rowNumber={editingIndex}
          codeLabel="الرقم القومي / الكود"
          showPoints
          values={{
            name: editing.name,
            gender: editing.gender,
            code: editing.code,
            birthdate: editing.birthdate,
            birthdateRaw: editing.birthdateRaw,
            phoneLocal: phoneToLocalDigits(editing.phoneRaw),
            phoneRaw: editing.phoneRaw,
            address: editing.address,
            notes: editing.notes,
            points: editing.points,
          }}
          onSave={(edits) => saveEdits(editing.row.key, edits)}
          onClose={() => setEditingKey(null)}
          onRemove={() => removeRow(editing.row.key)}
        />
      )}

      {/* Paste modal */}
      {pasteOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">لصق البيانات</h3>
              <button type="button" onClick={() => setPasteOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              id="bulk-paste-textarea"
              className="input-field font-mono !text-xs"
              rows={8}
              dir="auto"
              placeholder={'الصق هنا من إكسل أو جوجل شيت...\nكل صف في سطر، الأعمدة مفصولة بـ Tab أو فاصلة'}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              id="bulk-paste-apply"
              type="button"
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="btn-primary mt-3 w-full flex items-center justify-center gap-2"
            >
              <Check className="h-5 w-5" />
              معاينة البيانات
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
