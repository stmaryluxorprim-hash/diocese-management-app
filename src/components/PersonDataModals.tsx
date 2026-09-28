'use client';

// ---------- Person data modals (البيانات job on the children page) ----------
// ViewPersonModal   — عرض البيانات: full person data + QR + all enrollments
// EditPersonModal   — تعديل المخدوم: persons table (identity data) + moves
//                     THIS enrollment to another church / service / class —
//                     same form as إدارة الخدام → تعديل
// DeletePersonModal — حذف الطفل: choose between removing THIS enrollment only
//                     (from class/service/church) or deleting the person
//                     COMPLETELY from the database (cascade via RPC).

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  X, User, Phone, MapPin, StickyNote, IdCard, CalendarDays, Star,
  CalendarCheck, School, Loader2, Save, Trash2, AlertTriangle, Upload,
  Church as ChurchIcon, Layers, Pencil, Wand2, ScanLine, Check, ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { useCodeGenerator } from '@/lib/customization-context';
import type { CodeContext } from '@/lib/code-templates';
import QrScanner from '@/components/store/QrScanner';
import ResetPasswordSection from '@/components/ResetPasswordSection';
import { changeServantCode, resetServantPassword, servantAccountMessage } from '@/lib/servant-account';
import {
  GENDER_LABELS, PHONE_PREFIX, PHONE_LOCAL_LENGTH,
  type Gender, type EnrollmentWithPerson, type Enrollment,
  type Church, type Service, type ClassRoom,
} from '@/lib/types';

// ---------- Shared helpers ----------

const scopeName = (
  id: string,
  list: { id: string; name: string }[],
  fallback: string
) => list.find((x) => x.id === id)?.name ?? fallback;

export function ModalFrame({
  title, icon, onClose, children,
}: {
  title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto no-scrollbar rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">{icon}{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// 1. VIEW — عرض البيانات
// =====================================================================
export function ViewPersonModal({
  enrollment, churches, services, classes, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const person = enrollment.person;
  const [allEnrollments, setAllEnrollments] = useState<Enrollment[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');

  // All enrollments of this person (RLS shows only what the user may see)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('enrollments')
        .select('*')
        .eq('person_id', person.id);
      setAllEnrollments((data ?? []) as Enrollment[]);
    })();
  }, [supabase, person.id]);

  // QR image of the national id
  useEffect(() => {
    QRCode.toDataURL(person.national_id, { width: 220, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [person.national_id]);

  const rows: { icon: React.ReactNode; label: string; value: string | null }[] = [
    { icon: <IdCard className="h-4 w-4 text-primary-600" />, label: 'الرقم القومي / الكود', value: person.national_id },
    { icon: <User className="h-4 w-4 text-primary-600" />, label: 'النوع', value: person.gender ? GENDER_LABELS[person.gender] : null },
    { icon: <CalendarDays className="h-4 w-4 text-primary-600" />, label: 'تاريخ الميلاد', value: person.birthdate },
    { icon: <Phone className="h-4 w-4 text-primary-600" />, label: 'الهاتف', value: person.phone },
    { icon: <MapPin className="h-4 w-4 text-primary-600" />, label: 'العنوان', value: person.address },
    { icon: <StickyNote className="h-4 w-4 text-primary-600" />, label: 'ملاحظات', value: person.notes },
  ];

  return (
    <ModalFrame title="عرض البيانات" icon={<User className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      {/* Identity header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
          {person.image_url ? (
            <Image src={person.image_url} alt={person.name} fill sizes="64px" className="object-cover" />
          ) : (
            <User className="h-8 w-8" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold">{person.name}</p>
          <div className="mt-1.5 flex gap-2">
            <span className="badge bg-emerald-100 text-emerald-700">
              <CalendarCheck className="h-3 w-3" /> {enrollment.attendance_count}
            </span>
            <span className="badge bg-gold-100 text-gold-600">
              <Star className="h-3 w-3" /> {enrollment.points}
            </span>
          </div>
        </div>
      </div>

      {/* QR code */}
      {qrUrl && (
        <div className="mb-4 flex justify-center rounded-2xl border border-indigo-50 bg-slate-50 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="person-qr" src={qrUrl} alt="QR" className="h-36 w-36" />
        </div>
      )}

      {/* Data rows */}
      <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden mb-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className="rounded-xl bg-slate-50 p-2">{r.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold text-slate-400">{r.label}</span>
              <span className="block text-sm font-bold break-words" dir={r.label === 'الهاتف' ? 'ltr' : undefined}>
                {r.value || '—'}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Enrollments across the diocese */}
      <p className="mb-2 text-xs font-extrabold text-slate-500">التسجيلات (الكنيسة ← الخدمة ← الفصل)</p>
      {allEnrollments === null ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
        </div>
      ) : (
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          {allEnrollments.map((en) => (
            <div key={en.id} className={`px-4 py-2.5 ${en.id === enrollment.id ? 'bg-primary-50/50' : ''}`}>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-bold text-slate-700">
                <ChurchIcon className="h-3.5 w-3.5 text-gold-500" />
                {scopeName(en.church_id, churches, 'كنيسة')}
                <span className="text-slate-300">←</span>
                <Layers className="h-3.5 w-3.5 text-accent-600" />
                {scopeName(en.service_id, services, 'خدمة')}
                <span className="text-slate-300">←</span>
                <School className="h-3.5 w-3.5 text-sky-600" />
                {scopeName(en.class_id, classes, 'فصل')}
              </p>
              <div className="mt-1.5 flex gap-2">
                <span className="badge bg-gold-100 text-gold-600">
                  <Star className="h-3 w-3" /> {en.points}
                </span>
                <span className="badge bg-emerald-100 text-emerald-700">
                  <CalendarCheck className="h-3 w-3" /> {en.attendance_count}
                </span>
                {en.id === enrollment.id && (
                  <span className="badge bg-primary-100 text-primary-700">الحالي</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalFrame>
  );
}

// =====================================================================
// 2. EDIT — تعديل البيانات (persons table + THIS enrollment's scope)
// Same form as EditServantModal (إدارة الخدام → تعديل): code (confirmed
// edit) · name · gender · phone (+2) · birthdate · address · notes ·
// الكنيسة → الخدمة → الفصل · photo · reset password.
// Changing the scope MOVES this enrollment (attendance + points follow);
// the person data applies to all his enrollments.
// =====================================================================
export function EditPersonModal({
  enrollment, churches = [], services = [], classes = [], onSaved, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  churches?: Church[];
  services?: Service[];
  classes?: ClassRoom[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const person = enrollment.person;
  // 0042: a servant's mirror row → code/password changes go through the
  // service-role API (auth account must follow the code); his scope is
  // managed from إدارة الخدام, not here.
  const isServant = enrollment.kind === 'servant' && !!enrollment.servant_id;
  const canMove = !isServant && churches.length > 0;

  const [name, setName] = useState(person.name);
  const [gender, setGender] = useState<Gender | ''>(person.gender ?? '');
  const [birthdate, setBirthdate] = useState(person.birthdate ?? '');
  const [phoneLocal, setPhoneLocal] = useState(
    (person.phone ?? '').replace(/^\+2/, '').replace(/\D/g, '').slice(-PHONE_LOCAL_LENGTH)
  );
  const [address, setAddress] = useState(person.address ?? '');
  const [notes, setNotes] = useState(person.notes ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ---- scope of THIS enrollment (church → service → class) ----
  const [churchId, setChurchId] = useState(enrollment.church_id);
  const [serviceId, setServiceId] = useState(enrollment.service_id);
  const [classId, setClassId] = useState(enrollment.class_id);
  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => (!churchId || c.church_id === churchId) && (!serviceId || c.service_id === serviceId));
  const scopeChanged = churchId !== enrollment.church_id || serviceId !== enrollment.service_id || classId !== enrollment.class_id;

  // ---- Code (national id / QR) — shown disabled, edited only through
  //      a confirmed flow: confirm → modal (generate / scan) → confirm ----
  const [code, setCode] = useState(person.national_id);
  const [codeModal, setCodeModal] = useState(false);
  const codeChanged = code.trim() !== person.national_id;

  const startCodeEdit = () => {
    const ok = confirm(
      `⚠️ تعديل الكود (الرقم القومي)\n\nالكود هو هوية «${person.name}» في كل التسجيلات، وهو ما يُطبع على بطاقة الـ QR ويُستخدم للحضور والنقاط ودخول بوابة المخدوم.\n\nتغييره يجعل البطاقة القديمة غير صالحة.\n\nهل تريد المتابعة إلى تعديل الكود؟`
    );
    if (ok) setCodeModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('الاسم مطلوب');
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
    }
    const newCode = code.trim();
    if (!newCode) return setError('الكود (الرقم القومي) مطلوب');
    if (canMove && scopeChanged && (!churchId || !serviceId || !classId)) {
      return setError('اختر الكنيسة والخدمة والفصل الجديد');
    }

    // Final confirmation before persisting a changed code
    if (codeChanged) {
      const ok = confirm(
        `تأكيد تغيير الكود\n\nمن: ${person.national_id}\nإلى: ${newCode}\n\nسيسري التغيير على «${person.name}» في كل تسجيلاته، وستحتاج البطاقة القديمة إلى إعادة طباعة.\n\nهل أنت متأكد؟`
      );
      if (!ok) return;
    }
    if (canMove && scopeChanged) {
      const from = [scopeName(enrollment.church_id, churches, 'الكنيسة'), scopeName(enrollment.service_id, services, 'الخدمة'), scopeName(enrollment.class_id, classes, 'الفصل')].join(' ← ');
      const to = [scopeName(churchId, churches, 'الكنيسة'), scopeName(serviceId, services, 'الخدمة'), scopeName(classId, classes, 'الفصل')].join(' ← ');
      const ok = confirm(
        `نقل «${person.name}»\n\nمن: ${from}\nإلى: ${to}\n\nينتقل معه حضوره ونقاطه في هذا التسجيل.\n\nهل أنت متأكد؟`
      );
      if (!ok) return;
    }

    setBusy(true);

    let image_url = person.image_url;
    if (photoFile) {
      try {
        image_url = await uploadPhoto(supabase, 'persons', photoFile);
      } catch {
        setBusy(false);
        return setError('تعذر رفع الصورة');
      }
    }

    // servant: the login name must follow the code → API first (rolls nothing back on failure)
    if (codeChanged && isServant) {
      const r = await changeServantCode(enrollment.servant_id!, newCode);
      if (!r.ok) { setBusy(false); return setError(servantAccountMessage(r.error)); }
    }

    // 1) person data (all enrollments)
    const { error: err } = await supabase
      .from('persons')
      .update({
        name: name.trim(),
        gender: gender || null,
        birthdate: birthdate || null,
        phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        image_url,
        ...(codeChanged && !isServant ? { national_id: newCode } : {}),
      })
      .eq('id', person.id);

    if (err) {
      setBusy(false);
      if (codeChanged && /code_is_family/i.test(err.message ?? '')) {
        return setError('هذا الكود كود عائلة — لا يمكن استخدامه لشخص، اختر كودًا مختلفًا');
      }
      if (codeChanged && (err.code === '23505' || /duplicate|unique/i.test(err.message ?? ''))) {
        return setError('هذا الكود مستخدم بالفعل لشخص آخر — اختر كودًا مختلفًا');
      }
      return setError('تعذر حفظ التعديلات، حاول مجددًا');
    }

    // 2) move THIS enrollment (scope) — attendance + points follow
    if (canMove && scopeChanged) {
      const { error: me } = await supabase
        .from('enrollments')
        .update({ church_id: churchId, service_id: serviceId, class_id: classId })
        .eq('id', enrollment.id);
      if (me) {
        setBusy(false);
        if (me.code === '23505' || /duplicate|unique/i.test(me.message ?? '')) {
          return setError('هذا المخدوم مسجَّل بالفعل في الفصل المختار — احذف أحد التسجيلين بدلًا من النقل');
        }
        return setError('تم حفظ البيانات لكن تعذر النقل — تأكد من صلاحياتك على الفصل الجديد');
      }
    }

    setBusy(false);
    onSaved();
    onClose();
  };

  return (
    <ModalFrame title={isServant ? 'تعديل الخادم' : 'تعديل المخدوم'} icon={<Pencil className="h-5 w-5 text-amber-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {/* code (national id / QR) — disabled + confirmed edit */}
        <div>
          <div className="flex gap-2">
            <input
              id="edit-person-code"
              className={`input-field flex-1 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${codeChanged ? '!border-amber-300 !bg-amber-50 !text-amber-800' : ''}`}
              dir="ltr"
              value={code}
              disabled
              readOnly
              aria-label="الكود"
            />
            <button
              id="edit-person-code-edit"
              type="button"
              onClick={startCodeEdit}
              disabled={busy}
              aria-label="تعديل الكود"
              title="تعديل الكود"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow transition hover:bg-amber-600 active:scale-95 disabled:opacity-60"
            >
              <Pencil className="h-5 w-5" />
            </button>
          </div>
          {codeChanged ? (
            <p className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
              <span>سيتغير الكود من <span dir="ltr">{person.national_id}</span> إلى <span dir="ltr">{code}</span> عند الحفظ</span>
              <button id="edit-person-code-revert" type="button" onClick={() => setCode(person.national_id)}
                className="shrink-0 rounded-lg bg-white px-2 py-1 text-amber-700 hover:bg-amber-100">تراجع</button>
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400"><IdCard className="inline h-3 w-3" /> الكود = الرقم القومي / QR — اضغط زر التعديل لتغييره (توليد أو مسح كود)</p>
          )}
        </div>

        <input id="edit-person-name" className="input-field" placeholder="الاسم الكامل *" value={name}
          onChange={(e) => setName(e.target.value)} required />

        <div className="grid grid-cols-2 gap-2">
          <button id="edit-person-gender-male" type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')}
            className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'male' ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}>
            {GENDER_LABELS.male}
          </button>
          <button id="edit-person-gender-female" type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')}
            className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'female' ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-500'}`}>
            {GENDER_LABELS.female}
          </button>
        </div>

        <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
          <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">{PHONE_PREFIX}</span>
          <input id="edit-person-phone" type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
            value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
            onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
          <input id="edit-person-birthdate" type="date" className="input-field" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} dir="ltr" />
        </div>
        <input id="edit-person-address" className="input-field" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
        <textarea id="edit-person-notes" className="input-field min-h-[60px]" placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />

        {/* scope of THIS enrollment — الكنيسة → الخدمة → الفصل */}
        {canMove && (
          <>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة</label>
              <select id="edit-person-church" className="input-field" value={churchId}
                onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة</label>
              <select id="edit-person-service" className="input-field" value={serviceId}
                onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}>
                <option value="">اختر الخدمة *</option>
                {scopedServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصل</label>
              <select id="edit-person-class" className="input-field" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">اختر الفصل *</option>
                {scopedClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {scopeChanged && (
              <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                سيُنقل هذا التسجيل إلى النطاق الجديد عند الحفظ — ينتقل معه الحضور والنقاط.
              </p>
            )}
          </>
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
          <Upload className="h-4 w-4" />
          {photoFile ? photoFile.name : person.image_url ? 'تغيير الصورة' : 'إضافة صورة (اختياري)'}
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
        </label>

        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          تعديل البيانات الشخصية يسري على كل تسجيلات الشخص (كل الكنائس والخدمات والفصول)
        </p>

        {/* 0042: password reset — child portal password / servant login password */}
        <ResetPasswordSection
          idPrefix="edit-person-pw"
          title={isServant ? 'إعادة تعيين كلمة مرور الخادم' : 'إعادة تعيين كلمة مرور البوابة'}
          hint={isServant
            ? 'كلمة الدخول للتطبيق بحساب هذا الخادم — تُغلق جلساته الحالية'
            : 'يدخل المخدوم إلى البوابة بكوده وهذه الكلمة — تُغلق جلساته الحالية'}
          onReset={async (pw) => {
            if (isServant) {
              const r = await resetServantPassword(enrollment.servant_id!, pw);
              return r.ok ? null : servantAccountMessage(r.error);
            }
            const { error: e } = await supabase.rpc('admin_set_child_password', { p_person: person.id, p_password: pw });
            if (!e) return null;
            const m = e.message ?? '';
            return m.includes('weak_password') ? 'كلمة المرور قصيرة — 6 أحرف على الأقل'
              : m.includes('forbidden') || m.includes('42501') ? 'ليس لديك صلاحية على هذا المخدوم'
              : 'تعذر تعيين كلمة المرور، حاول مجددًا';
          }}
        />

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
        )}

        <button
          id="edit-person-save"
          type="submit"
          disabled={busy}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          {busy ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
        </button>
      </form>

      {codeModal && (
        <EditCodeModal
          personId={person.id}
          currentCode={person.national_id}
          initialCode={code}
          codeKind={isServant ? 'servant' : 'person'}
          scope={{ churchId: churchId || enrollment.church_id, serviceId: serviceId || enrollment.service_id, classId: classId || enrollment.class_id }}
          onConfirm={(c) => { setCode(c); setCodeModal(false); }}
          onClose={() => setCodeModal(false)}
        />
      )}
    </ModalFrame>
  );
}

// =====================================================================
// 2b. EDIT CODE — تعديل الكود (generate / scan → confirm)
// The chosen code is only staged into the parent form here; it is
// persisted when the user saves the edit form (after a final confirm).
// =====================================================================
export function EditCodeModal({
  personId, currentCode, initialCode, scope, codeKind = 'person', onConfirm, onClose,
}: {
  personId: string;
  currentCode: string;
  initialCode: string;
  /** enrollment scope → church / service / class abbreviations in the owner's code design */
  scope?: CodeContext;
  /** which template of نظام الأكواد the generator follows (servants have their own, 0040) */
  codeKind?: 'person' | 'servant';
  onConfirm: (code: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const genPersonCode = useCodeGenerator(codeKind);
  const [value, setValue] = useState(initialCode);
  const [scanning, setScanning] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [takenBy, setTakenBy] = useState<string | null>(null);
  // 20260930120000: a person code can never equal a FAMILY code
  const [familyName, setFamilyName] = useState<string | null>(null);

  const trimmed = value.trim();
  const changed = trimmed !== currentCode;

  // QR preview of the candidate code
  useEffect(() => {
    if (!trimmed) { setQrUrl(''); return; }
    QRCode.toDataURL(trimmed, { width: 240, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [trimmed]);

  // Is this code already used by ANOTHER person or by a FAMILY? (debounced lookup)
  useEffect(() => {
    setTakenBy(null);
    setFamilyName(null);
    if (!trimmed || trimmed === currentCode) return;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('person_code_lookup', { p_code: trimmed });
      const res = data as { person: { id: string; name: string } | null; family: { id: string; name: string } | null } | null;
      setTakenBy(res?.person && res.person.id !== personId ? res.person.name : null);
      setFamilyName(res?.family?.name ?? null);
      setChecking(false);
    }, 400);
    return () => { clearTimeout(t); setChecking(false); };
  }, [trimmed, currentCode, personId, supabase]);

  const onScanned = (v: string) => {
    const s = v.trim();
    if (!s) return;
    setValue(s);
    setScanning(false);
  };

  const confirmCode = () => {
    if (!trimmed || takenBy || familyName || checking) return;
    if (!changed) return onClose();
    const ok = confirm(
      `اعتماد الكود الجديد؟\n\nمن: ${currentCode}\nإلى: ${trimmed}\n\nسيتم وضعه في نموذج التعديل، ولن يُحفظ إلا بعد ضغط «حفظ التعديلات».`
    );
    if (ok) onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[90vh] overflow-y-auto no-scrollbar rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <IdCard className="h-5 w-5 text-amber-600" />
            تعديل الكود
          </h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          الكود الحالي: <span dir="ltr" className="font-extrabold">{currentCode}</span>
        </p>

        {scanning ? (
          <>
            <QrScanner
              onCode={onScanned}
              idPrefix="edit-person-code-scan"
              autoStart
              hint="شغّل الكاميرا لمسح الكود الجديد"
            />
            <button
              type="button"
              onClick={() => setScanning(false)}
              className="btn-secondary mt-3 w-full"
            >
              رجوع
            </button>
          </>
        ) : (
          <div className="space-y-3">
            {/* Candidate code */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الكود الجديد</label>
              <div className="flex gap-2">
                <input
                  id="edit-code-value"
                  className="input-field flex-1"
                  dir="ltr"
                  placeholder="اكتب الرقم القومي أو ولّد / امسح كودًا"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <button
                  id="edit-code-generate"
                  type="button"
                  onClick={() => setValue(genPersonCode(scope))}
                  aria-label="توليد كود تلقائي"
                  title="توليد كود تلقائي"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
                >
                  <Wand2 className="h-5 w-5" />
                </button>
                <button
                  id="edit-code-scan"
                  type="button"
                  onClick={() => setScanning(true)}
                  aria-label="مسح الكود بالكاميرا"
                  title="مسح الكود بالكاميرا"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow transition hover:bg-orange-600 active:scale-95"
                >
                  <ScanLine className="h-5 w-5" />
                </button>
              </div>
              {checking && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الكود...
                </p>
              )}
              {takenBy && (
                <p className="mt-1 flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                  <UserCheck className="h-4 w-4" />
                  هذا الكود مستخدم بالفعل لـ «{takenBy}» — اختر كودًا مختلفًا
                </p>
              )}
              {familyName && (
                <p className="mt-1 flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                  <UserCheck className="h-4 w-4" />
                  هذا الكود كود عائلة «{familyName}» — لا يمكن استخدامه لشخص
                </p>
              )}
              {!checking && !takenBy && !familyName && changed && trimmed && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> الكود متاح
                </p>
              )}
            </div>

            {/* QR preview */}
            {qrUrl && (
              <div className="flex flex-col items-center rounded-2xl border border-indigo-50 bg-slate-50 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt="QR" className="h-32 w-32" />
                <p className="mt-1 text-sm font-extrabold tracking-widest" dir="ltr">{trimmed}</p>
              </div>
            )}

            <button
              id="edit-code-confirm"
              type="button"
              onClick={confirmCode}
              disabled={!trimmed || !!takenBy || !!familyName || checking || !changed}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Check className="h-5 w-5" />
              تأكيد الكود الجديد
            </button>
            <button type="button" onClick={onClose} className="btn-secondary w-full">
              إلغاء
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// 3. DELETE — حذف الطفل (enrollment only OR full cascade)
// =====================================================================
export function DeletePersonModal({
  enrollment, churches, services, classes, onDeleted, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onDeleted: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const person = enrollment.person;
  const [busy, setBusy] = useState<'enrollment' | 'full' | null>(null);
  const [error, setError] = useState('');

  const churchName = scopeName(enrollment.church_id, churches, 'الكنيسة');
  const serviceName = scopeName(enrollment.service_id, services, 'الخدمة');
  const className = scopeName(enrollment.class_id, classes, 'الفصل');

  // 0042: a servant's mirror row follows his servant enrollment — it is
  // managed from «إدارة الخدام», never deleted here.
  if (enrollment.kind === 'servant') {
    return (
      <ModalFrame title="حذف خادم" icon={<Trash2 className="h-5 w-5 text-red-600" />} onClose={onClose}>
        <div className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-700">
          هذا صف خادم مرتبط بحسابه — يُدار (تعديل النطاق أو الإيقاف أو الحذف) من «إدارة الخدام» في الإعدادات، ويختفي من هنا تلقائيًا.
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">إغلاق</button>
          <Link href="/servants" className="btn-primary flex-1 text-center">إدارة الخدام</Link>
        </div>
      </ModalFrame>
    );
  }

  // Option 1: remove THIS enrollment only (class + service + church binding).
  // FK cascade wipes the enrollment's attendance & points logs.
  const deleteEnrollment = async () => {
    const ok = confirm(
      `سيتم حذف «${person.name}» من:\n${className} — ${serviceName} — ${churchName}\n\nمع حذف كل حضوره ونقاطه في هذا التسجيل فقط.\nبياناته الشخصية وتسجيلاته الأخرى تبقى كما هي.\n\nهل أنت متأكد؟`
    );
    if (!ok) return;
    setBusy('enrollment');
    setError('');
    const { error: err } = await supabase.from('enrollments').delete().eq('id', enrollment.id);
    setBusy(null);
    if (err) return setError('تعذر الحذف — تأكد من صلاحياتك ثم حاول مجددًا');
    onDeleted();
    onClose();
  };

  // Option 2: delete the person COMPLETELY — cascade wipes every
  // enrollment and every attendance / points log in all tables.
  const deleteFull = async () => {
    const ok = confirm(
      `⚠️ حذف نهائي!\n\nسيتم حذف «${person.name}» تمامًا من قاعدة البيانات:\n• بياناته الشخصية\n• كل تسجيلاته في كل الكنائس والخدمات والفصول\n• كل سجلات الحضور والنقاط الخاصة به\n\nلا يمكن التراجع عن هذه الخطوة.\n\nهل أنت متأكد؟`
    );
    if (!ok) return;
    setBusy('full');
    setError('');
    const { error: err } = await supabase.rpc('delete_person_cascade', { p_person: person.id });
    setBusy(null);
    if (err) {
      return setError(
        err.message?.includes('no_access')
          ? 'لا تملك صلاحية الحذف النهائي — لهذا الشخص تسجيلات خارج نطاقك'
          : 'تعذر الحذف النهائي — حاول مجددًا'
      );
    }
    onDeleted();
    onClose();
  };

  return (
    <ModalFrame title="حذف الطفل" icon={<Trash2 className="h-5 w-5 text-red-600" />} onClose={onClose}>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
          {person.image_url ? (
            <Image src={person.image_url} alt={person.name} fill sizes="48px" className="object-cover" />
          ) : (
            <User className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-extrabold truncate">{person.name}</p>
          <p className="text-xs text-slate-400 truncate">
            {className} — {serviceName} — {churchName}
          </p>
        </div>
      </div>

      <p className="mb-3 text-sm font-bold text-slate-600">كيف تريد حذف هذا الطفل؟</p>

      <div className="space-y-3">
        {/* Option 1: enrollment only */}
        <button
          id="delete-enrollment-btn"
          onClick={deleteEnrollment}
          disabled={busy !== null}
          className="w-full rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-right transition hover:bg-amber-100 active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex items-center gap-2 font-extrabold text-amber-700">
            {busy === 'enrollment' ? <Loader2 className="h-5 w-5 animate-spin" /> : <School className="h-5 w-5" />}
            حذف من الفصل والخدمة والكنيسة
          </span>
          <span className="mt-1 block text-xs font-bold text-amber-600/80">
            يُحذف هذا التسجيل فقط مع حضوره ونقاطه — البيانات الشخصية والتسجيلات الأخرى تبقى محفوظة
          </span>
        </button>

        {/* Option 2: full cascade */}
        <button
          id="delete-person-full-btn"
          onClick={deleteFull}
          disabled={busy !== null}
          className="w-full rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-right transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex items-center gap-2 font-extrabold text-red-700">
            {busy === 'full' ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
            حذف الطفل تمامًا من قاعدة البيانات
          </span>
          <span className="mt-1 block text-xs font-bold text-red-600/80">
            حذف نهائي متسلسل (Cascade): البيانات الشخصية + كل التسجيلات + كل سجلات الحضور والنقاط في جميع الجداول
          </span>
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}

      <button
        onClick={onClose}
        disabled={busy !== null}
        className="btn-secondary mt-4 w-full"
      >
        إلغاء
      </button>
    </ModalFrame>
  );
}
