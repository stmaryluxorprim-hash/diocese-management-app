'use client';

// ---------- تعديل بياناتي — the servant edits his own PERSON (0037) ----------
// Name / phone / photo / gender / birthdate / address live on the servant's
// `persons` row; DB triggers mirror name · phone · photo into his
// servant enrollment. Falls back to the enrollment when no person is bound.

import { useState } from 'react';
import { X, Save, User, Phone, Upload, IdCard, Cake, MapPin, Pencil } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { SERVANTS_TABLE, GENDER_LABELS, PHONE_PREFIX, PHONE_LOCAL_LENGTH, userIdToEmail, codeToUserId, type Gender } from '@/lib/types';
import ResetPasswordSection from '@/components/ResetPasswordSection';
import { EditCodeModal } from '@/components/PersonDataModals';
import { changeServantCode, servantAccountMessage } from '@/lib/servant-account';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, person, refresh } = useAuth();
  const supabase = createClient();

  const [fullName, setFullName] = useState(person?.name ?? profile?.full_name ?? '');
  const [phoneLocal, setPhoneLocal] = useState(
    (person?.phone ?? profile?.phone ?? '').replace(/^\+2/, '').replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH)
  );
  const [gender, setGender] = useState<Gender | ''>(person?.gender ?? '');
  const [birthdate, setBirthdate] = useState(person?.birthdate ?? '');
  const [address, setAddress] = useState(person?.address ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // OWNER ONLY: change MY code (= login name). Same confirmed flow as in
  // إدارة الخدام (generate / scan / type → confirm) → service-role API updates
  // the auth e-mail + servant row + persons.national_id. The default owner
  // created by migration 0002 (code 000000) changes his code here.
  const isOwner = profile?.role === 'owner';
  const currentCode = person?.national_id ?? profile?.user_id ?? '';
  const [code, setCode] = useState(currentCode);
  const [codeModal, setCodeModal] = useState(false);
  const codeChanged = isOwner && code.trim() !== currentCode;
  const startCodeEdit = () => {
    const ok = confirm(
      `⚠️ تعديل كودي\n\nالكود هو اسم دخولك للتطبيق وهويتك في كل التسجيلات وما يُطبع على بطاقتك.\n\nبعد التغيير ستدخل بالكود الجديد ونفس كلمة المرور.\n\nهل تريد المتابعة؟`
    );
    if (ok) setCodeModal(true);
  };

  const save = async () => {
    if (!profile) return;
    if (!fullName.trim()) return setError('الاسم مطلوب');
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
    }
    setBusy(true);
    setError('');

    let photo_url = person?.image_url ?? profile.photo_url ?? null;
    if (photoFile) {
      try {
        photo_url = await uploadPhoto(supabase, 'servants', photoFile);
      } catch {
        setBusy(false);
        return setError('تعذر رفع الصورة');
      }
    }
    const phone = phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : '';

    // 0) my code (owner only) → auth e-mail + user_id + persons.national_id
    if (codeChanged) {
      const ok = confirm(
        `تأكيد تغيير كودي\n\nمن: ${currentCode}\nإلى: ${code.trim()}\n\nستدخل بالكود الجديد من الآن.\n\nهل أنت متأكد؟`
      );
      if (!ok) { setBusy(false); return; }
      const r = await changeServantCode(profile.id, code.trim());
      if (!r.ok) { setBusy(false); return setError(servantAccountMessage(r.error)); }
    }

    let err = null;
    if (person) {
      ({ error: err } = await supabase.from('persons').update({
        name: fullName.trim(),
        phone: phone || null,
        gender: gender || null,
        birthdate: birthdate || null,
        address: address.trim() || null,
        image_url: photo_url,
      }).eq('id', person.id));
    } else {
      ({ error: err } = await supabase
        .from(SERVANTS_TABLE)
        .update({ full_name: fullName.trim(), phone, photo_url })
        .eq('id', profile.id));
    }
    setBusy(false);
    if (err) return setError('تعذر حفظ التعديلات، حاول مجدداً');
    // the auth e-mail changed → refresh the local session so the JWT carries
    // the new e-mail (the session itself stays valid; no re-login needed)
    if (codeChanged) await supabase.auth.refreshSession().catch(() => null);
    await refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-gray-800">تعديل بياناتي</h2>
          <button onClick={onClose} className="rounded-xl bg-gray-100 p-2">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3">
          {isOwner ? (
            /* OWNER: the code is editable (confirmed flow) — everyone else sees it read-only */
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
                <IdCard className="h-3.5 w-3.5" /> الكود / اسم الدخول
              </label>
              <div className="flex gap-2">
                <input
                  id="my-code"
                  className={`input-field flex-1 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${codeChanged ? '!border-amber-300 !bg-amber-50 !text-amber-800' : ''}`}
                  dir="ltr"
                  value={code}
                  disabled
                  readOnly
                  aria-label="الكود"
                />
                <button
                  id="my-code-edit"
                  type="button"
                  onClick={startCodeEdit}
                  disabled={busy}
                  aria-label="تعديل كودي"
                  title="تعديل كودي"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow transition hover:bg-amber-600 active:scale-95 disabled:opacity-60"
                >
                  <Pencil className="h-5 w-5" />
                </button>
              </div>
              {codeChanged ? (
                <p className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                  <span>سيتغير كودك من <span dir="ltr">{currentCode}</span> إلى <span dir="ltr">{code}</span> عند الحفظ</span>
                  <button type="button" onClick={() => setCode(currentCode)} className="shrink-0 rounded-lg bg-white px-2 py-1 text-amber-700 hover:bg-amber-100">تراجع</button>
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">المالك فقط يستطيع تغيير كوده — اضغط زر التعديل (توليد أو مسح أو كتابة كود)</p>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <IdCard className="h-3.5 w-3.5" /> الكود / اسم الدخول:
              <b dir="ltr" className="text-slate-700">{currentCode}</b>
            </p>
          )}

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <User className="h-3.5 w-3.5" /> الاسم الكامل
            </label>
            <input className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="الاسم الكامل" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">النوع</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')}
                className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'male' ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}>
                {GENDER_LABELS.male}
              </button>
              <button type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')}
                className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'female' ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-500'}`}>
                {GENDER_LABELS.female}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <Phone className="h-3.5 w-3.5" /> رقم الهاتف
            </label>
            <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
              <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">{PHONE_PREFIX}</span>
              <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
                value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
                onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <Cake className="h-3.5 w-3.5" /> تاريخ الميلاد
            </label>
            <input type="date" className="input-field" dir="ltr" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <MapPin className="h-3.5 w-3.5" /> العنوان
            </label>
            <input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان" />
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
            <Upload className="h-4 w-4" />
            {photoFile ? photoFile.name : (person?.image_url ?? profile?.photo_url) ? 'تغيير صورتي الشخصية' : 'إضافة صورتي الشخصية (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>

          {/* 0043: change MY login password — OLD + NEW + CONFIRM. The old one is
              verified by re-authenticating (Supabase Auth has no server-side
              «current password» check). A forgotten password is reset by a
              superior from إدارة الخدام (no old password needed there). */}
          <ResetPasswordSection
            idPrefix="my-pw"
            title="تغيير كلمة المرور"
            hint="أدخل كلمتك القديمة ثم الجديدة وتأكيدها — 6 أحرف على الأقل"
            requireCurrent
            onReset={async (pw, current) => {
              const login = person?.national_id ?? profile?.user_id ?? '';
              const { error: e0 } = await supabase.auth.signInWithPassword({
                email: userIdToEmail(codeToUserId(login)),
                password: current ?? '',
              });
              if (e0) return 'كلمة المرور القديمة غير صحيحة';
              const { error: e } = await supabase.auth.updateUser({ password: pw });
              if (!e) {
                // 20261003120000: ONE password per person — mirror to the child / priest side
                await supabase.rpc('servant_mirror_own_password', { p_password: pw }).then(() => undefined, () => undefined);
                return null;
              }
              const m = (e.message ?? '').toLowerCase();
              return m.includes('same') || m.includes('different')
                ? 'اختر كلمة مرور مختلفة عن الحالية'
                : m.includes('weak') || m.includes('at least')
                ? 'كلمة المرور ضعيفة — 6 أحرف على الأقل'
                : 'تعذر تغيير كلمة المرور، حاول مجددًا';
            }}
          />

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          <button onClick={save} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
            <Save className="h-4 w-4" />
            {busy ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>

      {isOwner && codeModal && profile && (
        /* stop the click from bubbling to this modal's backdrop (which would close it) */
        <div onClick={(e) => e.stopPropagation()}>
          <EditCodeModal
            personId={person?.id ?? profile.id}
            currentCode={currentCode}
            initialCode={code}
            codeKind="servant"
            onConfirm={(c) => { setCode(c); setCodeModal(false); }}
            onClose={() => setCodeModal(false)}
          />
        </div>
      )}
    </div>
  );
}
